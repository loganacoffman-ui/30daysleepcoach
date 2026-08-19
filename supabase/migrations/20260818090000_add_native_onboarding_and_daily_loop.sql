alter table public.sleep_profiles add column if not exists display_name text;
alter table public.sleep_profiles add column if not exists timezone text not null default 'UTC';

create table if not exists public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkin_date date not null,
  timezone text not null,
  feeling smallint check (feeling between 0 and 100),
  suspected_factor text,
  note text check (char_length(note) <= 280),
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);

alter table public.daily_checkins enable row level security;

create policy "Users can read their daily checkins" on public.daily_checkins for select using (auth.uid() = user_id);
create policy "Users can create their daily checkins" on public.daily_checkins for insert with check (auth.uid() = user_id);
create policy "Users can update their daily checkins" on public.daily_checkins for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their daily checkins" on public.daily_checkins for delete using (auth.uid() = user_id);

create index if not exists daily_checkins_user_date_idx on public.daily_checkins (user_id, checkin_date desc);
