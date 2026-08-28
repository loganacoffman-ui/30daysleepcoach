alter table public.daily_checkins
  add column if not exists manual_sleep_score smallint
    check (manual_sleep_score between 0 and 100),
  add column if not exists manual_sleep_submitted_at timestamptz;

comment on column public.daily_checkins.manual_sleep_score is
  'Self-reported sleep score used only when wearable data is unavailable.';

comment on column public.daily_checkins.manual_sleep_submitted_at is
  'Records the user explicitly chose the manual fallback for this sleep period.';
