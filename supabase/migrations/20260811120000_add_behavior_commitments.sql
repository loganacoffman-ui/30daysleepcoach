create table if not exists public.behavior_commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  behavior_date date not null,
  behavior text not null check (char_length(trim(behavior)) > 0),
  status text not null default 'committed' check (status in ('committed', 'completed', 'partial', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, behavior_date)
);
alter table public.behavior_commitments enable row level security;
create policy "Users can read their behavior commitments" on public.behavior_commitments for select using (auth.uid() = user_id);
create policy "Users can create their behavior commitments" on public.behavior_commitments for insert with check (auth.uid() = user_id);
create policy "Users can update their behavior commitments" on public.behavior_commitments for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their behavior commitments" on public.behavior_commitments for delete using (auth.uid() = user_id);
create index if not exists behavior_commitments_user_date_idx on public.behavior_commitments (user_id, behavior_date desc);
