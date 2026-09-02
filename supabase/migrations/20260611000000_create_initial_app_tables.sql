create table if not exists public.ai_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cache_key text not null,
  content text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (user_id, cache_key)
);
create index if not exists ai_cache_user_key_idx
  on public.ai_cache (user_id, cache_key);
alter table public.ai_cache enable row level security;
create policy "Users can read own cache"
  on public.ai_cache
  for select
  using (auth.uid() = user_id);
create policy "Users can insert own cache"
  on public.ai_cache
  for insert
  with check (auth.uid() = user_id);
create policy "Users can update own cache"
  on public.ai_cache
  for update
  using (auth.uid() = user_id);
create policy "Users can delete own cache"
  on public.ai_cache
  for delete
  using (auth.uid() = user_id);
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  date text not null,
  ts bigint not null,
  hrv integer not null,
  sleep_score integer,
  bedtime text,
  waketime text,
  night_wake text,
  note text,
  pos text[],
  neg text[],
  user_id uuid not null default auth.uid() references auth.users(id)
);
alter table public.entries enable row level security;
create policy "Users can view own entries"
  on public.entries
  for select
  using (auth.uid() = user_id);
create policy "Users can insert own entries"
  on public.entries
  for insert
  with check (auth.uid() = user_id);
create policy "Users can update own entries"
  on public.entries
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "Users can delete own entries"
  on public.entries
  for delete
  using (auth.uid() = user_id);
grant all on table public.ai_cache to anon, authenticated, service_role;
grant all on table public.entries to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;
