-- Extend existing checks without changing ownership policies or stored rows.
alter table public.sleep_profiles
  drop constraint sleep_profiles_preferred_sleep_source_check,
  add constraint sleep_profiles_preferred_sleep_source_check
    check (preferred_sleep_source in ('apple_health', 'oura', 'health_connect'));
alter table public.sleep_nights
  drop constraint sleep_nights_provider_check,
  add constraint sleep_nights_provider_check
    check (provider in ('apple_health', 'oura', 'health_connect'));
comment on table public.sleep_nights is
  'Normalized wearable sleep metrics. Apple Health and Health Connect use the app-derived Sleep Coach score, not a provider-owned score.';
