-- Run after the performance migration on a disposable database. Always rolls back.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000081'), ('00000000-0000-4000-8000-000000000082');

do $$
declare
  alice uuid := '00000000-0000-4000-8000-000000000081';
  bob uuid := '00000000-0000-4000-8000-000000000082';
  first_owner uuid := '00000000-0000-4000-8000-000000000001';
  next_owner uuid := '00000000-0000-4000-8000-000000000002';
  before_revision text;
  expected_oura jsonb;
begin
  if has_table_privilege('authenticated', 'public.coach_runtime_cache', 'INSERT')
    or has_table_privilege('anon', 'public.coach_runtime_cache', 'SELECT')
    or has_table_privilege('authenticated', 'public.coach_generation_leases', 'UPDATE')
    or has_function_privilege('authenticated', 'public.claim_coach_generation(uuid,text,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.daily_coach_evidence_revision(uuid,date,jsonb)', 'EXECUTE') then
    raise exception 'Client roles can access server cache or privileged RPCs';
  end if;
  if not has_function_privilege('service_role', 'public.claim_coach_generation(uuid,text,uuid)', 'EXECUTE') then
    raise exception 'Backend cannot acquire leases';
  end if;
  if exists(select 1 from pg_proc where oid in ('public.claim_coach_generation(uuid,text,uuid)'::regprocedure,
    'public.daily_coach_evidence_revision(uuid,date,jsonb)'::regprocedure) and prosecdef) then
    raise exception 'Performance RPCs must not be SECURITY DEFINER';
  end if;
  if not public.claim_coach_generation(alice, 'daily', first_owner) then raise exception 'Initial lease failed'; end if;
  if public.claim_coach_generation(alice, 'daily', next_owner) then raise exception 'Active owner was replaced'; end if;
  if not public.claim_coach_generation(bob, 'daily', next_owner) then raise exception 'Users share a lease'; end if;
  update public.coach_generation_leases set expires_at = now() - interval '1 second' where user_id = alice;
  if not public.claim_coach_generation(alice, 'daily', next_owner) then raise exception 'Expired lease was not reclaimed'; end if;
  delete from public.coach_generation_leases where user_id = alice and owner = first_owner;
  if not exists(select 1 from public.coach_generation_leases where user_id = alice and owner = next_owner) then
    raise exception 'Old worker removed new ownership';
  end if;

  before_revision := public.daily_coach_evidence_revision(alice, current_date);
  insert into public.daily_checkins(user_id, checkin_date, timezone, note) values (alice, current_date, 'UTC', 'Original');
  if before_revision = public.daily_coach_evidence_revision(alice, current_date) then raise exception 'Check-in did not invalidate revision'; end if;
  before_revision := public.daily_coach_evidence_revision(alice, current_date);
  update public.daily_checkins set note = 'Corrected' where user_id = alice;
  if before_revision = public.daily_coach_evidence_revision(alice, current_date) then raise exception 'Correction did not invalidate revision'; end if;
  before_revision := public.daily_coach_evidence_revision(alice, current_date);
  insert into public.daily_checkins(user_id, checkin_date, timezone, note) values (bob, current_date, 'UTC', 'Other user');
  if before_revision <> public.daily_coach_evidence_revision(alice, current_date) then raise exception 'Other user invalidated revision'; end if;
  insert into public.coach_runtime_cache values (alice, 'oura:daily_sleep:' || (current_date - 13)::text || ':' || current_date::text,
    '{"connectionVersion":"v1","body":{"data":[{"score":80}]}}', now() + interval '1 minute');
  if before_revision = public.daily_coach_evidence_revision(alice, current_date) then raise exception 'Oura evidence did not invalidate revision'; end if;
  before_revision := public.daily_coach_evidence_revision(alice, current_date);
  update public.coach_runtime_cache set expires_at = now() + interval '2 minutes' where user_id = alice;
  if before_revision <> public.daily_coach_evidence_revision(alice, current_date) then raise exception 'TTL-only change invalidated revision'; end if;

  insert into public.oura_connections(user_id, access_token, refresh_token, expires_at, updated_at)
    values (alice, 'fixture-access', 'fixture-refresh', now() + interval '1 hour', now());
  expected_oura := jsonb_build_object('connectionVersion', now(), 'body', '{"data":[{"score":80}]}'::jsonb);
  update public.coach_runtime_cache set value = expected_oura where user_id = alice;
  if public.daily_coach_evidence_revision(alice, current_date, expected_oura) is null then
    raise exception 'Matching Oura snapshot rejected';
  end if;
  update public.coach_runtime_cache set value = jsonb_set(value, '{body,data,0,score}', '90') where user_id = alice;
  if public.daily_coach_evidence_revision(alice, current_date, expected_oura) is not null then
    raise exception 'Stale Oura snapshot accepted after correction';
  end if;
  update public.coach_runtime_cache set value = expected_oura where user_id = alice;
  update public.oura_connections set updated_at = now() + interval '1 second' where user_id = alice;
  if public.daily_coach_evidence_revision(alice, current_date, expected_oura) is not null then
    raise exception 'Stale Oura snapshot accepted after reconnect';
  end if;
end;
$$;

-- The real privilege check, not only catalog inspection.
set local role authenticated;
do $$ begin
  begin
    insert into public.coach_runtime_cache values ('00000000-0000-4000-8000-000000000081', 'model', '{}', now());
    raise exception 'Client forged cache';
  exception when insufficient_privilege then null; end;
  begin
    perform public.daily_coach_evidence_revision('00000000-0000-4000-8000-000000000082', current_date);
    raise exception 'Client read another user revision';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
