-- Run after migrations. Disposable identities and all operations roll back.
begin;
create temporary table admin_test_ids (admin_id uuid, session_id uuid, test_id uuid, normal_id uuid, marker uuid, operation_id uuid);
insert into admin_test_ids values(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
insert into auth.users(id, email, raw_app_meta_data, created_at)
  select admin_id, 'admin-' || admin_id || '@example.test', '{"role":"admin"}', now() from admin_test_ids;
insert into auth.users(id, email, raw_app_meta_data, created_at)
  select test_id, 'sleepcoach-test+sql-check@example.test', jsonb_build_object('test_user_tool','sleepcoach-test-v1','test_user_marker',marker), now() from admin_test_ids;
insert into auth.users(id, email, raw_user_meta_data, created_at)
  select normal_id, 'normal-' || normal_id || '@example.test', '{"role":"admin","test_user_tool":"sleepcoach-test-v1"}', now() from admin_test_ids;
insert into auth.sessions(id, user_id) select session_id, admin_id from admin_test_ids;
select set_config('request.jwt.claims', jsonb_build_object('sub',admin_id,'role','authenticated','session_id',session_id)::text, true) from admin_test_ids;

-- Run through the same grants as the real caller, not as postgres.
set local role authenticated;
select public.admin_test_user_action('list');
reset role;

do $$
declare ids record; fixtures jsonb; payload jsonb; listed jsonb; denied boolean;
begin
  select * into ids from admin_test_ids;
  if has_table_privilege('authenticated','public.admin_test_users','INSERT')
    or has_table_privilege('authenticated','public.admin_test_users','SELECT')
    or has_function_privilege('anon','public.admin_test_user_action(text,uuid,jsonb)','EXECUTE')
    or has_function_privilege('service_role','public.admin_test_user_action(text,uuid,jsonb)','EXECUTE') then
    raise exception 'Unexpected direct client access';
  end if;
  -- Forged user-editable admin metadata cannot authorize direct RPC access.
  perform set_config('request.jwt.claims', jsonb_build_object('sub',ids.normal_id,'role','authenticated','session_id',ids.session_id)::text, true);
  denied := false;
  begin perform public.admin_test_user_action('list');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Forged admin metadata accepted'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',ids.admin_id,'role','authenticated','session_id',ids.session_id)::text, true);
  denied := false;
  begin perform public.admin_test_user_action('claim',ids.test_id,jsonb_build_object('operation_id',ids.operation_id));
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Unregistered tagged identity was mutable'; end if;
  -- Ordinary real-format users and forged user_metadata must never be adopted.
  denied := false;
  begin perform public.admin_test_user_action('register',ids.normal_id,jsonb_build_object('operation_id',ids.operation_id));
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Ordinary account was adopted'; end if;

  perform public.admin_test_user_action('register',ids.test_id,jsonb_build_object(
    'operation_id',ids.operation_id,'marker',ids.marker,'email','sleepcoach-test+sql-check@example.test'));
  fixtures := jsonb_build_object(
    'options',jsonb_build_object('emailConfirmed',true),
    'profile',jsonb_build_object('primary_concern','night_waking','typical_bedtime','22:30','typical_wake_time','06:30',
      'timezone','America/Los_Angeles','intake_answers',jsonb_build_object('current_step','complete'), 'onboarding_completed_at',now()),
    'checkins',jsonb_build_array(jsonb_build_object('checkin_date','2026-10-01','timezone','America/Los_Angeles',
      'feeling',75,'morning_feeling','rested','suspected_factor','stress','note','Synthetic SQL test',
      'manual_sleep_score',75,'manual_sleep_submitted_at',now(),'completed_at',now())),
    'commitments',jsonb_build_array(jsonb_build_object('behavior_date','2026-10-01','behavior','Synthetic experiment','status','completed')),
    'recommendations',jsonb_build_array(jsonb_build_object('recommendation_date','2026-10-01','pattern','Synthetic pattern',
      'meaning','Synthetic meaning','action','Synthetic action','why','Synthetic why','source_context','{}'::jsonb,
      'prompt_version','test','model','sleepcoach-test-v1','generated_at',now())),
    'entries',jsonb_build_array(jsonb_build_object('date','Oct 1, 2026','ts',1790856000000,'hrv',55,'sleep_score',75,
      'bedtime','22:30','waketime','06:30','night_wake','1','note','Synthetic note','pos','[]'::jsonb,'neg','[]'::jsonb))
  );
  payload := jsonb_build_object('operation_id',ids.operation_id,'fixtures',fixtures);
  perform public.admin_test_user_action('seed',ids.test_id,payload);
  if (select count(*) from public.daily_checkins where user_id=ids.test_id) <> 1
    or (select count(*) from public.entries where user_id=ids.test_id) <> 1
    or (select count(*) from public.coach_recommendations where user_id=ids.test_id) <> 1
    or (select email_confirmed_at is null from auth.users where id=ids.test_id) then
    raise exception 'Seed state incorrect';
  end if;
  select value into listed from jsonb_array_elements(public.admin_test_user_action('list'))
    where value->>'user_id' = ids.test_id::text;
  if listed->>'onboarding_step' <> 'complete' or (listed->>'checkin_count')::integer <> 1
    or (listed->>'feedback_count')::integer <> 1 or listed->>'primary_concern' <> 'night_waking'
    or listed->>'last_checkin_date' <> '2026-10-01' or not (listed->>'manageable')::boolean then
    raise exception 'Inventory does not reflect current account state';
  end if;
  if public.admin_test_user_action('inspect',ids.test_id)->>'email' <> 'sleepcoach-test+sql-check@example.test' then
    raise exception 'Direct guarded inventory lookup failed';
  end if;
  perform public.admin_test_user_action('claim',ids.test_id,payload);
  denied := false;
  begin perform public.admin_test_user_action('claim',ids.test_id,jsonb_build_object('operation_id',gen_random_uuid()));
  exception when lock_not_available then denied := true; end;
  if not denied then raise exception 'Concurrent mutation allowed'; end if;

  -- A constraint failure after deletes must roll back the whole reset.
  denied := false;
  begin perform public.admin_test_user_action('seed',ids.test_id,
    jsonb_set(payload,'{fixtures,checkins,0,manual_sleep_score}','999'::jsonb));
  exception when check_violation then denied := true; end;
  if not denied or (select count(*) from public.entries where user_id=ids.test_id) <> 1
    or (select count(*) from public.daily_checkins where user_id=ids.test_id) <> 1 then
    raise exception 'Failed reset lost existing data';
  end if;
  -- Reset confirmed -> unconfirmed and revoke all refreshable test sessions.
  insert into auth.sessions(id,user_id) values(gen_random_uuid(),ids.test_id);
  payload := jsonb_set(payload,'{fixtures,options,emailConfirmed}','false'::jsonb);
  perform public.admin_test_user_action('seed',ids.test_id,payload);
  if (select email_confirmed_at is not null from auth.users where id=ids.test_id)
    or exists(select 1 from auth.sessions where user_id=ids.test_id) then raise exception 'Auth state was not reset'; end if;

  -- Registry alone cannot authorize a changed protected identity.
  update auth.users set raw_app_meta_data='{}' where id=ids.test_id;
  denied := false;
  begin perform public.admin_test_user_action('claim',ids.test_id,payload);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Changed metadata passed safety guard'; end if;
  update auth.users set raw_app_meta_data=jsonb_build_object('test_user_tool','sleepcoach-test-v1','test_user_marker',ids.marker) where id=ids.test_id;

  -- Revocation is immediate even when the JWT still claims admin.
  update auth.users set raw_app_meta_data='{}' where id=ids.admin_id;
  denied := false;
  begin perform public.admin_test_user_action('list');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Revoked admin accepted'; end if;
  update auth.users set raw_app_meta_data='{"role":"admin"}' where id=ids.admin_id;
  delete from auth.sessions where id=ids.session_id;
  denied := false;
  begin perform public.admin_test_user_action('list');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Revoked session accepted'; end if;
  insert into auth.sessions(id,user_id) values(ids.session_id,ids.admin_id);

  perform public.admin_test_user_action('claim',ids.test_id,payload);
  perform public.admin_test_user_action('clear',ids.test_id,payload);
  delete from auth.users where id=ids.test_id;
  if exists(select 1 from public.admin_test_users where user_id=ids.test_id)
    or not exists(select 1 from auth.users where id=ids.normal_id)
    or not exists(select 1 from public.admin_test_user_events where test_user_id=ids.test_id) then
    raise exception 'Cleanup or audit preservation failed';
  end if;
end;
$$;
select 'admin test-user SQL checks passed' as result;
rollback;
