-- =============================================================================
-- 20260816_project_shares.sql
-- Collaboration: share projects via unguessable links (read-only viewers).
--
-- Run in Supabase SQL Editor (idempotent). Owners manage shares through the
-- API (service role); anonymous viewers resolve tokens only through the
-- public endpoint, never via direct Postgrest access.
-- =============================================================================

create table if not exists public.project_shares (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_shares_project
  on public.project_shares(project_id);

create index if not exists idx_project_shares_active_token
  on public.project_shares(token)
  where revoked_at is null;

alter table public.project_shares enable row level security;

-- Owners can list their own share links.
drop policy if exists "project_shares owner select" on public.project_shares;
create policy "project_shares owner select"
  on public.project_shares for select
  using (auth.uid() = created_by);

-- Owners can create links only for their own projects.
drop policy if exists "project_shares owner insert" on public.project_shares;
create policy "project_shares owner insert"
  on public.project_shares for insert
  with check (
    auth.uid() = created_by
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  );

-- Owners can update (revoke / set expiry) their own links.
drop policy if exists "project_shares owner update" on public.project_shares;
create policy "project_shares owner update"
  on public.project_shares for update
  using (auth.uid() = created_by);

-- No anon/authenticated SELECT policy on token: resolving a share token is
-- exclusively an API (service role) operation.
