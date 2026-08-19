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
create function public.complete_sleep_onboarding(
  p_user_id uuid,
  p_primary_concern text,
  p_typical_bedtime time without time zone,
  p_typical_wake_time time without time zone,
  p_intake_answers jsonb,
  p_intake_version integer,
  p_behavior_date date,
  p_behavior text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'Cannot complete onboarding for another user'
      using errcode = '42501';
  end if;

  insert into public.behavior_commitments (
    user_id,
    behavior_date,
    behavior,
    status,
    updated_at
  )
  values (
    p_user_id,
    p_behavior_date,
    p_behavior,
    'committed',
    now()
  )
  on conflict (user_id, behavior_date)
  do update set
    behavior = excluded.behavior,
    status = 'committed',
    updated_at = now();

  insert into public.sleep_profiles (
    user_id,
    primary_concern,
    typical_bedtime,
    typical_wake_time,
    intake_answers,
    intake_version,
    onboarding_completed_at
  )
  values (
    p_user_id,
    p_primary_concern,
    p_typical_bedtime,
    p_typical_wake_time,
    p_intake_answers,
    p_intake_version,
    now()
  )
  on conflict (user_id)
  do update set
    primary_concern = excluded.primary_concern,
    typical_bedtime = excluded.typical_bedtime,
    typical_wake_time = excluded.typical_wake_time,
    intake_answers = excluded.intake_answers,
    intake_version = excluded.intake_version,
    onboarding_completed_at = excluded.onboarding_completed_at;
end;
$$;
revoke all on function public.complete_sleep_onboarding(
  uuid,
  text,
  time without time zone,
  time without time zone,
  jsonb,
  integer,
  date,
  text
) from public, anon;
grant execute on function public.complete_sleep_onboarding(
  uuid,
  text,
  time without time zone,
  time without time zone,
  jsonb,
  integer,
  date,
  text
) to authenticated;
