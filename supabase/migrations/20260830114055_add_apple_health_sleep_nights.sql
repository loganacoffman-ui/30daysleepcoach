alter table public.sleep_profiles
  add column if not exists preferred_sleep_source text
    check (preferred_sleep_source in ('apple_health', 'oura'));

comment on column public.sleep_profiles.preferred_sleep_source is
  'The wearable source preferred by the user when more than one source has data.';

create table if not exists public.sleep_nights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('apple_health', 'oura')),
  sleep_date date not null,
  sleep_score smallint check (sleep_score between 0 and 100),
  score_version text,
  score_components jsonb not null default '{}'::jsonb
    check (jsonb_typeof(score_components) = 'object'),
  bedtime_start timestamptz,
  bedtime_end timestamptz,
  total_sleep_minutes integer check (total_sleep_minutes >= 0),
  awake_minutes integer check (awake_minutes >= 0),
  in_bed_minutes integer check (in_bed_minutes >= 0),
  rem_minutes integer check (rem_minutes >= 0),
  deep_minutes integer check (deep_minutes >= 0),
  core_minutes integer check (core_minutes >= 0),
  sleep_efficiency numeric check (sleep_efficiency between 0 and 1),
  source_name text,
  source_bundle_id text,
  provider_record_id text,
  timezone text not null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, sleep_date)
);

comment on table public.sleep_nights is
  'Normalized wearable sleep metrics. Apple Health rows contain an app-derived Sleep Coach score, not Apple Sleep Score.';
comment on column public.sleep_nights.score_version is
  'Version of the app-owned scoring formula; null for provider-owned scores.';
comment on column public.sleep_nights.provider_record_id is
  'Stable source sample identity used for diagnostics and idempotent reprocessing; contains no raw HealthKit payload.';

alter table public.sleep_nights enable row level security;

create policy "Users can read their sleep nights"
  on public.sleep_nights for select to authenticated
  using (auth.uid() = user_id);
create policy "Users can create their sleep nights"
  on public.sleep_nights for insert to authenticated
  with check (auth.uid() = user_id);
create policy "Users can update their sleep nights"
  on public.sleep_nights for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "Users can delete their sleep nights"
  on public.sleep_nights for delete to authenticated
  using (auth.uid() = user_id);

revoke all on public.sleep_nights from anon;
grant select, insert, update, delete on public.sleep_nights to authenticated;

create index if not exists sleep_nights_user_date_idx
  on public.sleep_nights (user_id, sleep_date desc);
