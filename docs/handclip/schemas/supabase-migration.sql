-- ============================================================
-- HandClip MVP — Supabase Migration
-- Ejecutar en SQL Editor de Supabase Dashboard
-- ============================================================

-- 1. EXTENSIONES
create extension if not exists "uuid-ossp";

-- 2. TABLAS

-- profiles (extiende auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  exports_this_month integer not null default 0,
  last_export_reset_at timestamptz,
  expo_push_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- projects
create table if not exists public.projects (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  source_video_url text,
  source_duration float,
  status text not null default 'uploading' check (status in ('uploading', 'processing', 'ready', 'failed')),
  timeline jsonb,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- clips (candidatos detectados por IA)
create table if not exists public.clips (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  start_time float not null,
  end_time float not null,
  duration float,
  confidence_score integer not null check (confidence_score >= 0 and confidence_score <= 100),
  reasons jsonb not null default '[]',
  suggested_caption text,
  transcript_snippet text,
  mood_tags jsonb default '[]',
  platform_targets jsonb default '[]',
  status text not null default 'candidate' check (status in ('candidate', 'selected', 'edited', 'exported')),
  user_edited boolean not null default false,
  created_at timestamptz not null default now()
);

-- subtitles (word-level timestamps)
create table if not exists public.subtitles (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  clip_id uuid references public.clips(id) on delete cascade,
  segments jsonb not null default '[]',
  language text not null default 'unknown',
  created_at timestamptz not null default now()
);

-- exports (videos renderizados)
create table if not exists public.exports (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  clip_id uuid references public.clips(id) on delete set null,
  preset text not null check (preset in ('tiktok', 'reels', 'shorts', 'draft', 'hq')),
  status text not null default 'queued' check (status in ('queued', 'rendering', 'completed', 'failed')),
  output_url text,
  file_size bigint,
  duration float,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- jobs (estado de procesamiento)
create table if not exists public.jobs (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null check (type in ('transcription', 'clip_analysis', 'render')),
  status text not null default 'queued' check (status in ('queued', 'active', 'completed', 'failed')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  result jsonb,
  bullmq_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. ÍNDICES
create index if not exists idx_projects_user_id on public.projects(user_id);
create index if not exists idx_clips_project_id on public.clips(project_id);
create index if not exists idx_exports_project_id on public.exports(project_id);
create index if not exists idx_jobs_project_id on public.jobs(project_id);

-- Composite indexes for hot query paths. The worker polls jobs by
-- project_id + status; mobile lists exports/clips by project_id +
-- status. Without these, every query hits a sequential scan filtered
-- on the second column.
create index if not exists idx_jobs_project_status on public.jobs(project_id, status);
create index if not exists idx_exports_project_status on public.exports(project_id, status);
create index if not exists idx_clips_project_status on public.clips(project_id, status);
-- BullMQ ID lookup is constant-time (jobsService.getJob joins BullMQ
-- by this column); the existing primary-key index on id doesn't help.
create index if not exists idx_jobs_bullmq_id on public.jobs(bullmq_id);

-- 4. TRIGGER para profiles (crear perfil al registrarse)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. RLS — POLÍTICAS

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.clips enable row level security;
alter table public.subtitles enable row level security;
alter table public.exports enable row level security;
alter table public.jobs enable row level security;

-- profiles: usuario ve su propio perfil
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

-- projects: dueño CRUD
create policy "Users can manage own projects" on public.projects
  for all using (auth.uid() = user_id);

-- clips: dueño a través del proyecto
create policy "Users can manage clips of own projects" on public.clips
  for all using (
    auth.uid() = (select user_id from public.projects where id = project_id)
  );

-- subtitles: misma lógica
create policy "Users can manage subtitles of own projects" on public.subtitles
  for all using (
    auth.uid() = (select user_id from public.projects where id = project_id)
  );

-- exports: dueño a través del proyecto
create policy "Users can view own exports" on public.exports
  for select using (
    auth.uid() = (select user_id from public.projects where id = project_id)
  );

-- jobs: dueño a través del proyecto
create policy "Users can view own jobs" on public.jobs
  for select using (
    auth.uid() = (select user_id from public.projects where id = project_id)
  );

-- 6. STORAGE BUCKETS (ejecutar en SQL Editor también)
-- O crearlos desde Supabase Dashboard > Storage

-- Bucket: source-videos (privado)
insert into storage.buckets (id, name, public) values ('source-videos', 'source-videos', false);
create policy "Users can upload own videos" on storage.objects
  for insert with check (bucket_id = 'source-videos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Users can read own videos" on storage.objects
  for select using (bucket_id = 'source-videos' and auth.uid()::text = (storage.foldername(name))[1]);

-- Bucket: exports (privado, acceso vía signed URL)
insert into storage.buckets (id, name, public) values ('exports', 'exports', false);
create policy "Users can read own exports" on storage.objects
  for select using (bucket_id = 'exports' and auth.uid()::text = (storage.foldername(name))[1]);

-- Bucket: thumbnails (acceso vía signed URL, no listado público)
insert into storage.buckets (id, name, public) values ('thumbnails', 'thumbnails', false);
create policy "Users can manage own thumbnails" on storage.objects
  for all using (bucket_id = 'thumbnails' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "Users can view thumbnails via signed URL" on storage.objects;
create policy "Users can view thumbnails via signed URL" on storage.objects
  for select using (bucket_id = 'thumbnails' and auth.uid()::text = (storage.foldername(name))[1]);

-- 7. ATOMIC EXPORT COUNTER (evita race condition)
create or replace function increment_export_count(user_id uuid)
returns table(allowed boolean, count integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_count integer;
  last_reset timestamptz;
  now_ts timestamptz := now();
begin
  select exports_this_month, last_export_reset_at
  into current_count, last_reset
  from public.profiles
  where id = user_id
  for update;

  -- Reset on new month
  if last_reset is null
     or extract(month from last_reset) != extract(month from now_ts)
     or extract(year from last_reset) != extract(year from now_ts) then
    current_count := 0;
  end if;

  if current_count < 3 then
    update public.profiles
    set exports_this_month = current_count + 1,
        last_export_reset_at = now_ts
    where id = user_id;
    return query select true, current_count + 1;
  else
    return query select false, current_count;
  end if;
end;
$$;

-- 7b. Rollback: refund one export slot (for fair-fail in render processor)
create or replace function decrement_export_count(user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles
  set exports_this_month = greatest(exports_this_month - 1, 0)
  where id = user_id;
end;
$$;

revoke execute on function decrement_export_count(uuid) from public;
grant execute on function decrement_export_count(uuid) to authenticated;


-- Lock down execute permission: only authenticated users may call the quota RPC
revoke execute on function increment_export_count(uuid) from public;
grant execute on function increment_export_count(uuid) to authenticated;
