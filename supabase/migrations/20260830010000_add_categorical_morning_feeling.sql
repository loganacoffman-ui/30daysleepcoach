alter table public.daily_checkins
  add column if not exists morning_feeling text;

alter table public.daily_checkins
  drop constraint if exists daily_checkins_morning_feeling_check;

alter table public.daily_checkins
  add constraint daily_checkins_morning_feeling_check
  check (morning_feeling is null or morning_feeling in ('exhausted', 'tired', 'okay', 'rested', 'great'));

update public.daily_checkins
set morning_feeling = case
  when feeling <= 20 then 'exhausted'
  when feeling <= 40 then 'tired'
  when feeling <= 60 then 'okay'
  when feeling <= 80 then 'rested'
  else 'great'
end
where morning_feeling is null
  and feeling is not null;

comment on column public.daily_checkins.morning_feeling is
  'Categorical self-reported morning feeling. Separate from wearable and manual sleep scores.';
