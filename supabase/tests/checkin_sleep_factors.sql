-- Standalone migration regression: CI supplies a minimal daily_checkins table.
begin;

do $$
declare
  factors text[];
  stored public.daily_checkins%rowtype;
  rejected boolean;
begin
  -- Legacy NULL, skipped, custom, and every supported category remain writable.
  for factors in select candidate from (values
    (null::text[]), (array[]::text[]), (array['other']),
    (array['none']), (array['unknown']),
    (array['stress','caffeine','late_meal','alcohol','screens','temperature',
      'noise','light','exercise','naps','irregular_schedule','travel','illness',
      'pain','medication','bathroom','caregiving','bed_partner','wind_down','other'])
  ) valid(candidate) loop
    insert into public.daily_checkins(id, suspected_factors, note)
      values (1, factors, 'The new mattress smell kept me awake.');
    select * into stored from public.daily_checkins where id = 1;
    assert stored.suspected_factors is not distinct from factors;
    assert stored.note = 'The new mattress smell kept me awake.';
    delete from public.daily_checkins where id = 1;
  end loop;

  for factors in select candidate from (values
    (array['invented']), (array['stress','stress']), (array['']),
    (array['Stress']), (array['other','other']), (array['stress',null]),
    (array[null]::text[]), (array['none','noise']), (array['unknown','noise']),
    (array_fill('stress'::text, array[23])),
    (array[['stress','noise']]), ('[0:0]={stress}'::text[])
  ) invalid(candidate) loop
    rejected := false;
    begin
      insert into public.daily_checkins(id, suspected_factors) values (1, factors);
    exception when check_violation then
      rejected := true;
    end;
    assert rejected, format('Accepted invalid factors: %s', factors);
  end loop;

  insert into public.daily_checkins(id, suspected_factors) values (1, array['caffeine','noise']);
  select * into stored from public.daily_checkins where id = 1;
  assert stored.suspected_factor = 'caffeine';
  rejected := false;
  begin
    update public.daily_checkins set suspected_factors = array['noise','noise'] where id = 1;
  exception when check_violation then
    rejected := true;
  end;
  assert rejected, 'Duplicate factors accepted on UPDATE';

  update public.daily_checkins set suspected_factor = 'stress' where id = 1;
  select * into stored from public.daily_checkins where id = 1;
  assert stored.suspected_factors is null and stored.suspected_factor = 'stress';
  update public.daily_checkins set suspected_factors = array['other'] where id = 1;
  select * into stored from public.daily_checkins where id = 1;
  assert stored.suspected_factor = 'other';
end;
$$;

rollback;
