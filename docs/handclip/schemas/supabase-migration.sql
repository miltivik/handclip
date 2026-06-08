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
  is_admin boolean not null default false,
  exports_this_month integer not null default 0,
  last_export_reset_at timestamptz,
  polar_customer_id text,
  polar_subscription_id text,
  polar_product_id text,
  subscription_status text,
  subscription_current_period_end timestamptz,
  expo_push_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists polar_customer_id text;
alter table public.profiles add column if not exists polar_subscription_id text;
alter table public.profiles add column if not exists polar_product_id text;
alter table public.profiles add column if not exists subscription_status text;
alter table public.profiles add column if not exists subscription_current_period_end timestamptz;

-- Marcar admin manualmente (reemplazar email):
-- update public.profiles p
-- set is_admin = true, updated_at = now()
-- from auth.users u
-- where p.id = u.id and u.email = 'admin@example.com';

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
  type text not null check (type in ('transcription', 'clip_analysis', 'render', 'edit_prompt')),
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

-- Evitar que usuarios cambien admin/billing/quota desde cliente.
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, expo_push_token, updated_at) on public.profiles to authenticated;

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

-- Bucket: thumbnails (público)
insert into storage.buckets (id, name, public) values ('thumbnails', 'thumbnails', true);

-- ============================================================
-- 7. AI PROVIDER CONNECTIONS (mobile OAuth + API-key)
-- ============================================================

create table if not exists public.ai_provider_connections (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in (
    'openai-codex',
    'anthropic',
    'openai',
    'openrouter',
    'deepseek',
    'google',
    'mistral',
    'groq',
    'xai',
    'minimax',
    'zai',
    'minimax-token-plan',
    'zai-coding-plan',
    'custom'
  )),
  connection_type text not null default 'oauth' check (connection_type in ('oauth', 'api-key', 'openai-compatible')),
  model text,
  base_url text,
  credentials_ciphertext text not null,
  credentials_iv text not null,
  credentials_tag text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, connection_type)
);
create unique index if not exists idx_ai_provider_connections_one_active
  on public.ai_provider_connections(user_id) where is_active;
alter table public.ai_provider_connections enable row level security;

-- Update previously deployed tables.
do $$
declare
  has_old_unique boolean;
begin
  -- 1. Drop the old (user_id, provider) unique constraint, if present.
  select exists (
    select 1 from pg_constraint
    where conname = 'ai_provider_connections_user_id_provider_key'
  ) into has_old_unique;
  if has_old_unique then
    alter table public.ai_provider_connections
      drop constraint ai_provider_connections_user_id_provider_key;
  end if;
  -- 2. Drop any other unique index on (user_id, provider) so the new one
  --    can replace it without conflicting.
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'ai_provider_connections'
      and indexname = 'ai_provider_connections_user_id_provider_key'
  ) then
    drop index public.ai_provider_connections_user_id_provider_key;
  end if;
end $$;

-- Add connection_type / model / base_url columns on already deployed tables
-- before recreating constraints that reference them.
alter table public.ai_provider_connections
  add column if not exists connection_type text not null default 'oauth';
alter table public.ai_provider_connections
  add column if not exists model text;
alter table public.ai_provider_connections
  add column if not exists base_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_provider_connections_connection_type_check'
  ) then
    alter table public.ai_provider_connections
      add constraint ai_provider_connections_connection_type_check
      check (connection_type in ('oauth', 'api-key', 'openai-compatible'));
  end if;
end $$;

-- Recreate the (user_id, provider, connection_type) unique constraint on
-- every install so existing deployments pick it up.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_provider_connections_user_id_provider_connection_type_key'
  ) then
    alter table public.ai_provider_connections
      add constraint ai_provider_connections_user_id_provider_connection_type_key
      unique (user_id, provider, connection_type);
  end if;
end $$;

-- Make sure the provider check constraint is up to date.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'ai_provider_connections_provider_check'
  ) then
    alter table public.ai_provider_connections
      drop constraint ai_provider_connections_provider_check;
  end if;
  begin
    alter table public.ai_provider_connections
      add constraint ai_provider_connections_provider_check
      check (provider in (
        'openai-codex',
        'anthropic',
        'openai',
        'openrouter',
        'deepseek',
        'google',
        'mistral',
        'groq',
        'xai',
        'minimax',
        'zai',
        'minimax-token-plan',
        'zai-coding-plan',
        'custom'
      ));
    exception when duplicate_object then null;
  end;
end $$;
