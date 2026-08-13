create table public.sleep_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  primary_concern text,
  typical_bedtime time without time zone,
  typical_wake_time time without time zone,
  safety_flags jsonb not null default '{}'::jsonb,
  intake_answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(intake_answers) = 'object'),
  intake_version integer not null default 1
    check (intake_version > 0),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sleep_profiles enable row level security;

create policy "Users can read their sleep profile"
  on public.sleep_profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their sleep profile"
  on public.sleep_profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their sleep profile"
  on public.sleep_profiles
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their sleep profile"
  on public.sleep_profiles
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.sleep_profiles to authenticated;
revoke all on public.sleep_profiles from anon;

create function public.set_sleep_profiles_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_sleep_profiles_updated_at() from public, anon, authenticated;

create trigger set_sleep_profiles_updated_at
before update on public.sleep_profiles
for each row
execute function public.set_sleep_profiles_updated_at();
