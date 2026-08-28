create table if not exists public.app_open_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  opened_date date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, opened_date)
);

alter table public.app_open_days enable row level security;

create policy "Users can read their app open days"
  on public.app_open_days for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can record their app open days"
  on public.app_open_days for insert to authenticated
  with check (auth.uid() = user_id);

revoke all on public.app_open_days from anon;
grant select, insert on public.app_open_days to authenticated;

insert into public.app_open_days (user_id, opened_date)
select user_id, checkin_date
from public.daily_checkins
on conflict (user_id, opened_date) do nothing;

insert into public.app_open_days (user_id, opened_date)
select user_id, date::date
from public.entries
where date ~ '^\d{4}-\d{2}-\d{2}$'
on conflict (user_id, opened_date) do nothing;
