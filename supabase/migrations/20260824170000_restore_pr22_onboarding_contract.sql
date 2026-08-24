-- Restore PR #22's onboarding vocabulary as the canonical sleep profile contract.
-- The superseded four-step flow briefly wrote three alternate concern values and
-- a free-form `goal` answer. Normalize those rows without touching profiles that
-- already use Isaiah's original intake payload.

update public.sleep_profiles
set
  primary_concern = case primary_concern
    when 'staying_asleep' then 'night_waking'
    when 'waking_tired' then 'unrefreshed'
    when 'schedule' then 'irregular_schedule'
    else primary_concern
  end,
  intake_answers = (intake_answers - 'goal') || jsonb_strip_nulls(jsonb_build_object(
    'current_step', 'complete',
    'primary_concern', case primary_concern
      when 'staying_asleep' then 'night_waking'
      when 'waking_tired' then 'unrefreshed'
      when 'schedule' then 'irregular_schedule'
      else primary_concern
    end,
    'typical_bedtime', case
      when typical_bedtime is null then null
      else to_char(typical_bedtime, 'HH24:MI')
    end,
    'typical_wake_time', case
      when typical_wake_time is null then null
      else to_char(typical_wake_time, 'HH24:MI')
    end
  )),
  updated_at = now()
where primary_concern in ('staying_asleep', 'waking_tired', 'schedule');

alter table public.sleep_profiles
  drop constraint if exists sleep_profiles_primary_concern_check;

alter table public.sleep_profiles
  add constraint sleep_profiles_primary_concern_check
  check (
    primary_concern is null
    or primary_concern in (
      'falling_asleep',
      'night_waking',
      'early_waking',
      'unrefreshed',
      'irregular_schedule'
    )
  );

comment on column public.sleep_profiles.primary_concern is
  'Canonical PR #22 concern key: falling_asleep, night_waking, early_waking, unrefreshed, or irregular_schedule.';

comment on column public.sleep_profiles.intake_answers is
  'Versioned PR #22 onboarding payload, including progress, follow-up, first experiment, and reminder time.';
