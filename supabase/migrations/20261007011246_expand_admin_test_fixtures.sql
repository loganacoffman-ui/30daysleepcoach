-- Keep the existing caller/registry checks and transaction boundary for all fixtures.
-- The operation stays claimed while the Edge Function submits external memories.
alter table public.admin_test_users add column memory_seed jsonb not null default '{}';

create or replace function private.admin_test_user_action(p_action text, p_user_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target auth.users;
  managed public.admin_test_users;
  row_data jsonb;
  message_data jsonb;
  conversation_id uuid;
  user_message_id uuid;
  result jsonb;
  token uuid := nullif(p_payload->>'operation_id', '')::uuid;
  table_name text;
begin
  if actor is null or not exists (
    select 1 from auth.users u join auth.sessions s on s.user_id = u.id
    where u.id = actor and u.raw_app_meta_data->>'role' = 'admin'
      and u.raw_app_meta_data->>'test_user_tool' is distinct from 'sleepcoach-test-v1'
      and s.id::text = auth.jwt()->>'session_id'
      and (s.not_after is null or s.not_after > now())
      and (u.banned_until is null or u.banned_until < now())
  ) then raise exception 'Admin access required' using errcode = '42501'; end if;

  if p_action = 'list' then
    select coalesce(jsonb_agg(r order by r.created_at desc, r.user_id), '[]') into result from (
      select t.user_id, t.email, t.marker, t.created_at, t.updated_at, t.options, t.status, t.memory_seed,
        (select count(*) from public.coach_conversations c where c.user_id = t.user_id) as chat_count,
        (select count(*) from public.coach_messages c where c.user_id = t.user_id) as message_count,
        (select count(*) from public.sleep_nights n where n.user_id = t.user_id) as wearable_count,
        (select count(*) from public.daily_checkins c where c.user_id = t.user_id and c.manual_sleep_score is not null) as manual_score_count,
        u.email_confirmed_at is not null as email_confirmed,
        s.onboarding_completed_at is not null as onboarding_complete,
        case when s.onboarding_completed_at is not null then 'complete'
          else coalesce(s.intake_answers->>'current_step', 'intro') end as onboarding_step,
        s.primary_concern, s.typical_bedtime, s.typical_wake_time, s.timezone,
        u.last_sign_in_at,
        (select count(*) from public.coach_recommendations c where c.user_id = t.user_id) as feedback_count,
        (select max(c.checkin_date) from public.daily_checkins c where c.user_id = t.user_id) as last_checkin_date,
        (u.email = t.email and u.raw_app_meta_data->>'test_user_tool' = 'sleepcoach-test-v1'
          and u.raw_app_meta_data->>'test_user_marker' = t.marker::text
          and u.raw_app_meta_data->>'role' is distinct from 'admin') is true as manageable,
        (select count(*) from public.daily_checkins c where c.user_id = t.user_id) as checkin_count
      from public.admin_test_users t join auth.users u on u.id = t.user_id
      left join public.sleep_profiles s on s.user_id = t.user_id
      order by t.created_at desc, t.user_id limit 200 offset (greatest(0, least(coalesce((p_payload->>'page')::integer, 0), 100000)) * 200)
    ) r;
    return result;
  end if;
  if p_user_id is null or p_user_id = actor then
    raise exception 'A separate managed test account is required' using errcode = '42501';
  end if;

  -- Serialize account mutations; repeat the identity checks within every RPC.
  select * into target from auth.users where id = p_user_id for update;
  if target.id is null or target.email !~ '^sleepcoach-test\+[a-z0-9][a-z0-9-]{0,31}@[a-z0-9.-]+$'
    or target.raw_app_meta_data->>'test_user_tool' is distinct from 'sleepcoach-test-v1'
    or target.raw_app_meta_data->>'role' = 'admin' then
    raise exception 'Target is not a managed test account' using errcode = '42501';
  end if;

  if p_action = 'register' then
    if target.created_at < now() - interval '10 minutes'
      or target.raw_app_meta_data->>'test_user_marker' is distinct from p_payload->>'marker'
      or target.email is distinct from p_payload->>'email' or token is null then
      raise exception 'Only newly created test identities can be registered' using errcode = '42501';
    end if;
    insert into public.admin_test_users(user_id, email, marker, created_by, operation_id, operation_started_at)
      values (target.id, target.email, (p_payload->>'marker')::uuid, actor, token, now());
  end if;
  select * into managed from public.admin_test_users where user_id = p_user_id for update;
  if managed.user_id is null or managed.email is distinct from target.email
    or managed.marker::text is distinct from target.raw_app_meta_data->>'test_user_marker' then
    raise exception 'Test registry and protected identity do not match' using errcode = '42501';
  end if;

  if p_action = 'inspect' then return to_jsonb(managed); end if;
  if p_action = 'register' then
    insert into public.admin_test_user_events(actor_id, test_user_id, action) values(actor, p_user_id, 'create');
    return to_jsonb(managed);
  elsif p_action = 'claim' then
    if token is null then raise exception 'Operation token required'; end if;
    -- Longer than the Edge Function maximum runtime, so abandoned operations can
    -- be retried without overlapping a still-running worker.
    if managed.operation_id is not null and managed.operation_started_at > now() - interval '15 minutes' then
      raise exception 'Another operation is in progress. Retry later.' using errcode = '55P03';
    end if;
    update public.admin_test_users set operation_id = token, operation_started_at = now(), status = 'working'
      where user_id = p_user_id;
    return to_jsonb(managed);
  end if;
  if token is null or token is distinct from managed.operation_id then
    raise exception 'Operation token mismatch' using errcode = '42501';
  end if;
  if p_action = 'finish' then
    if coalesce((p_payload->>'memory_count')::integer, -1) not between 0 and 26 then raise exception 'Invalid memory count'; end if;
    update public.admin_test_users set status = 'ready', operation_id = null, operation_started_at = null,
      memory_seed = jsonb_build_object('facts_submitted', (p_payload->>'memory_count')::integer,
        'event_id', p_payload->>'memory_event_id', 'submitted_at', now()), updated_at = now()
      where user_id = p_user_id;
    insert into public.admin_test_user_events(actor_id, test_user_id, action) values(actor, p_user_id, 'seed_finished');
    return jsonb_build_object('ok', true);
  end if;
  if p_action = 'fail' then
    update public.admin_test_users set operation_id = null, operation_started_at = null, status = 'error', updated_at = now() where user_id = p_user_id;
    insert into public.admin_test_user_events(actor_id, test_user_id, action) values(actor, p_user_id, 'failed');
    return jsonb_build_object('ok', true);
  end if;
  if p_action not in ('seed', 'clear') then raise exception 'Unknown operation'; end if;

  -- Explicit allowlist, always scoped to the independently verified UUID.
  -- Delete restrictive FK children before their parents. An error rolls back
  -- the entire replacement, including the old profile and history.
  foreach table_name in array array[
    'behavior_commitment_changes', 'coach_tool_calls', 'coach_messages', 'coach_conversations',
    'coach_recommendations', 'coach_profile_summaries', 'behavior_commitments', 'daily_checkins',
    'sleep_nights', 'sleep_profiles', 'entries', 'ai_cache', 'app_open_days',
    'push_notification_devices', 'oura_oauth_states', 'oura_connections', 'llm_usage_events'
  ] loop
    execute format('delete from public.%I where user_id = $1', table_name) using p_user_id;
  end loop;
  delete from auth.sessions where user_id = p_user_id;
  delete from auth.refresh_tokens where user_id = p_user_id::text;

  if p_action = 'clear' then
    insert into public.admin_test_user_events(actor_id, test_user_id, action) values(actor, p_user_id, 'delete_prepared');
    return to_jsonb(managed);
  end if;
  if jsonb_typeof(p_payload->'fixtures') is distinct from 'object'
    or jsonb_typeof(p_payload#>'{fixtures,options,emailConfirmed}') is distinct from 'boolean'
    or jsonb_array_length(p_payload#>'{fixtures,checkins}') > 90 then raise exception 'Invalid fixtures'; end if;

  if jsonb_array_length(coalesce(p_payload#>'{fixtures,conversations}', '[]')) > 20
    or jsonb_array_length(coalesce(p_payload#>'{fixtures,sleepNights}', '[]')) > 90 then raise exception 'Fixture limit exceeded'; end if;

  -- Auth's email_confirm=false does not reliably undo prior confirmation.
  -- This narrowly guarded update enables that test scenario while preserving
  -- the UUID and password. Clear pending email changes as well.
  update auth.users set
    email_confirmed_at = case when (p_payload#>>'{fixtures,options,emailConfirmed}')::boolean then now() else null end,
    confirmation_token = '', confirmation_sent_at = null,
    recovery_token = '', recovery_sent_at = null,
    email_change = '', email_change_token_new = '', email_change_token_current = '',
    email_change_confirm_status = 0, email_change_sent_at = null,
    updated_at = now()
    where id = p_user_id;
  delete from auth.one_time_tokens where user_id = p_user_id;

  row_data := p_payload#>'{fixtures,profile}';
  insert into public.sleep_profiles(user_id, primary_concern, typical_bedtime, typical_wake_time, timezone, intake_answers, intake_version, onboarding_completed_at, preferred_sleep_source)
  values(p_user_id, row_data->>'primary_concern', (row_data->>'typical_bedtime')::time,
    (row_data->>'typical_wake_time')::time, row_data->>'timezone', row_data->'intake_answers', 1,
    (row_data->>'onboarding_completed_at')::timestamptz, row_data->>'preferred_sleep_source');
  for row_data in select value from jsonb_array_elements(p_payload#>'{fixtures,checkins}') loop
    insert into public.daily_checkins(user_id, checkin_date, timezone, feeling, morning_feeling, suspected_factor, note, manual_sleep_score, manual_sleep_submitted_at, completed_at)
    values(p_user_id, (row_data->>'checkin_date')::date, row_data->>'timezone', (row_data->>'feeling')::smallint,
      row_data->>'morning_feeling', row_data->>'suspected_factor', row_data->>'note', (row_data->>'manual_sleep_score')::smallint,
      (row_data->>'manual_sleep_submitted_at')::timestamptz, (row_data->>'completed_at')::timestamptz);
    insert into public.app_open_days(user_id, opened_date) values(p_user_id, (row_data->>'checkin_date')::date);
  end loop;
  for row_data in select value from jsonb_array_elements(p_payload#>'{fixtures,commitments}') loop
    insert into public.behavior_commitments(user_id, behavior_date, behavior, status)
      values(p_user_id, (row_data->>'behavior_date')::date, row_data->>'behavior', row_data->>'status');
  end loop;
  for row_data in select value from jsonb_array_elements(p_payload#>'{fixtures,recommendations}') loop
    insert into public.coach_recommendations(user_id, recommendation_date, pattern, meaning, action, why, source_context, prompt_version, model, generated_at)
    values(p_user_id, (row_data->>'recommendation_date')::date, row_data->>'pattern', row_data->>'meaning', row_data->>'action',
      row_data->>'why', row_data->'source_context', row_data->>'prompt_version', row_data->>'model', (row_data->>'generated_at')::timestamptz);
  end loop;
  for row_data in select value from jsonb_array_elements(p_payload#>'{fixtures,entries}') loop
    insert into public.entries(user_id, date, ts, hrv, sleep_score, bedtime, waketime, night_wake, note, pos, neg)
    values(p_user_id, row_data->>'date', (row_data->>'ts')::bigint, (row_data->>'hrv')::integer,
      (row_data->>'sleep_score')::integer, row_data->>'bedtime', row_data->>'waketime', row_data->>'night_wake', row_data->>'note',
      array(select jsonb_array_elements_text(row_data->'pos')), array(select jsonb_array_elements_text(row_data->'neg')));
  end loop;
  for row_data in select value from jsonb_array_elements(p_payload#>'{fixtures,sleepNights}') loop
    insert into public.sleep_nights(user_id, provider, sleep_date, sleep_score, score_version, score_components,
      total_sleep_minutes, awake_minutes, in_bed_minutes, rem_minutes, deep_minutes, core_minutes,
      sleep_efficiency, source_name, timezone, synced_at)
    values(p_user_id, 'apple_health', (row_data->>'sleep_date')::date, (row_data->>'sleep_score')::smallint,
      'synthetic-v1', '{"synthetic":true}', (row_data->>'total_sleep_minutes')::integer,
      (row_data->>'awake_minutes')::integer, (row_data->>'in_bed_minutes')::integer,
      (row_data->>'rem_minutes')::integer, (row_data->>'deep_minutes')::integer, (row_data->>'core_minutes')::integer,
      (row_data->>'sleep_efficiency')::numeric, 'Synthetic Apple Health', row_data->>'timezone', (row_data->>'synced_at')::timestamptz);
  end loop;
  for row_data in select value from jsonb_array_elements(p_payload#>'{fixtures,conversations}') loop
    if jsonb_typeof(row_data->'messages') is distinct from 'array'
      or jsonb_array_length(row_data->'messages') not between 2 and 60 then raise exception 'Invalid chat messages'; end if;
    insert into public.coach_conversations(user_id, title, created_at, updated_at)
    values(p_user_id, row_data->>'title', (row_data->>'created_at')::timestamptz, (row_data->>'updated_at')::timestamptz)
      returning id into conversation_id;
    user_message_id := null;
    for message_data in select value from jsonb_array_elements(row_data->'messages') loop
      if message_data->>'role' = 'user' then user_message_id := gen_random_uuid(); end if;
      insert into public.coach_messages(id, user_id, conversation_id, role, content, metadata, created_at)
      values(case when message_data->>'role' = 'user' then user_message_id else gen_random_uuid() end,
        p_user_id, conversation_id, message_data->>'role', message_data->>'content',
        jsonb_build_object('synthetic', true, 'model', 'sleepcoach-test-v1') ||
          case when message_data->>'role' = 'assistant' then jsonb_build_object('responding_to', user_message_id) else '{}'::jsonb end,
        (message_data->>'created_at')::timestamptz);
    end loop;
  end loop;
  update public.admin_test_users set options = p_payload#>'{fixtures,options}', memory_seed = '{}',
    status = case when coalesce((p_payload->>'defer_finish')::boolean, false) then 'working' else 'ready' end,
    operation_id = case when coalesce((p_payload->>'defer_finish')::boolean, false) then token else null end,
    operation_started_at = case when coalesce((p_payload->>'defer_finish')::boolean, false) then now() else null end, updated_at = now() where user_id = p_user_id;
  insert into public.admin_test_user_events(actor_id, test_user_id, action) values(actor, p_user_id, 'seed');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function private.admin_test_user_action(text, uuid, jsonb) from public, anon, service_role;
grant execute on function private.admin_test_user_action(text, uuid, jsonb) to authenticated;

