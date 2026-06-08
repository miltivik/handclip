-- ============================================================
-- HandClip — Jobs: extend type enum + add idempotency columns
-- Idempotent: safe to re-run.
-- Run AFTER 001 (supabase-migration.sql) and 002 (20260607_jobs_idempotency.sql).
-- ============================================================

-- 1. Drop and recreate jobs.type check to include 'edit_prompt'.
--    Some installs may have an auto-generated constraint name; both naming
--    conventions are tried so the migration is idempotent.
alter table public.jobs
  drop constraint if exists jobs_type_check;

do $$
declare
  cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.jobs'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ~* '\mtype\M'
      and (
        pg_get_constraintdef(con.oid) ilike '%transcription%'
        or pg_get_constraintdef(con.oid) ilike '%clip_analysis%'
        or pg_get_constraintdef(con.oid) ilike '%render%'
        or pg_get_constraintdef(con.oid) ilike '%edit_prompt%'
      )
  loop
    execute format('alter table public.jobs drop constraint %I', cname);
  end loop;
end $$;

alter table public.jobs
  add constraint jobs_type_check
  check (type in ('transcription', 'clip_analysis', 'render', 'edit_prompt'));

-- 2. Add idempotency columns if they don't already exist (covered by 002 too,
--    but we re-declare so this migration is runnable in isolation).
alter table public.jobs
  add column if not exists client_request_id text;

alter table public.jobs
  add column if not exists user_id uuid references public.profiles(id) on delete cascade;

-- 3. Backfill user_id from projects for existing rows.
update public.jobs j
  set user_id = p.user_id
  from public.projects p
  where j.project_id = p.id and j.user_id is null;

-- 4. Idempotency: same (user_id, type, client_request_id) returns same job.
--    Partial: terminal rows (failed/completed) are excluded so the same
--    client_request_id can be reused for a retry after a failure.
do $$
declare
  idxname text;
begin
  for idxname in
    select indexname from pg_indexes
    where schemaname = 'public' and tablename = 'jobs'
      and indexname in ('uniq_jobs_user_type_clientreq')
  loop
    execute format('drop index if exists public.%I', idxname);
  end loop;
end $$;

create unique index uniq_jobs_user_type_clientreq
  on public.jobs (user_id, type, client_request_id)
  where client_request_id is not null
    and status not in ('failed', 'completed');

-- 5. Active-jobs lookup: filter by user_id + status without joining projects.
create index if not exists idx_jobs_user_status_updated
  on public.jobs (user_id, status, updated_at desc);

-- 6. "Latest job for project" lookup.
create index if not exists idx_jobs_project_type_updated
  on public.jobs (project_id, type, updated_at desc);
