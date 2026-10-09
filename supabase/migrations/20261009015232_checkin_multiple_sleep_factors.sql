-- Deploy before the updated sleep-coach function and mobile app.
-- NULL denotes an older writer; readers fall back to suspected_factor.
alter table public.daily_checkins add column suspected_factors text[];

-- Match the application vocabulary and uniqueness rules at the write boundary.
-- Custom descriptions remain unrestricted in note and use the 'other' category.
create function public.valid_checkin_sleep_factors(factors text[]) returns boolean
language sql immutable security invoker set search_path = '' as $$
  select factors is null or (
    (cardinality(factors) = 0 or (array_ndims(factors) = 1 and array_lower(factors, 1) = 1))
    and factors <@ array[
      'stress', 'caffeine', 'late_meal', 'alcohol', 'screens', 'temperature',
      'noise', 'light', 'exercise', 'naps', 'irregular_schedule', 'travel',
      'illness', 'pain', 'medication', 'bathroom', 'caregiving', 'bed_partner',
      'wind_down', 'other', 'none', 'unknown'
    ]::text[]
    -- COUNT(DISTINCT) also excludes NULL, so NULL elements fail this check.
    and cardinality(factors) = (select count(distinct factor) from unnest(factors) as items(factor))
    and (cardinality(factors) <= 1 or not (factors && array['none', 'unknown']))
  );
$$;

alter table public.daily_checkins add constraint daily_checkins_suspected_factors_check
  check (public.valid_checkin_sleep_factors(suspected_factors));

-- Keep old mobile releases able to edit their single factor, and preserve the
-- first factor for existing consumers when a new client writes the full set.
create function public.sync_checkin_sleep_factors() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' then
    if new.suspected_factors is not distinct from old.suspected_factors
       and new.suspected_factor is distinct from old.suspected_factor then
      new.suspected_factors := null;
    end if;
  end if;
  if new.suspected_factors is not null then
    new.suspected_factor := new.suspected_factors[1];
  end if;
  return new;
end;
$$;
revoke all on function public.sync_checkin_sleep_factors() from public;
create trigger sync_checkin_sleep_factors before insert or update
  on public.daily_checkins for each row execute function public.sync_checkin_sleep_factors();

comment on column public.daily_checkins.suspected_factors is
  'All self-reported sleep influences. NULL falls back to legacy suspected_factor; empty array means skipped. Original wording is retained in note.';
