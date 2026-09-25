-- Run after the usage migration on a disposable/local database. Always rolls back.
begin;
set local timezone = 'America/Los_Angeles';

insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000091'),
  ('00000000-0000-4000-8000-000000000092');

insert into public.llm_usage_events (
  id, user_id, request_id, attempt_index, provider, bucket, operation, requested_model,
  started_at, status, usage_status, input_tokens, output_tokens, cache_read_input_tokens,
  cache_creation_input_tokens, cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
  pricing_version, input_usd_per_million, output_usd_per_million,
  cache_read_usd_per_million, cache_write_5m_usd_per_million, cache_write_1h_usd_per_million
) values (
  '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000091',
  '00000000-0000-4000-8000-000000000051', 1, 'anthropic', 'chat', 'coach_chat', 'claude-sonnet-4-6',
  '2026-09-01 00:01:00+00', 'completed', 'complete', 100, 20, 500, 300, 200, 100,
  'test', 3, 15, .30, 3.75, 6
);

insert into public.llm_usage_events (
  id, user_id, request_id, attempt_index, provider, bucket, operation, requested_model,
  started_at, status, usage_status
) values
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000091',
   '00000000-0000-4000-8000-000000000051', 2, 'anthropic', 'chat', 'coach_chat', 'claude-sonnet-4-6',
   '2026-09-01 23:59:59+00', 'pending', 'unavailable'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000092',
   '00000000-0000-4000-8000-000000000052', 1, 'anthropic', 'greeting', 'coach_greeting', 'claude-sonnet-4-6',
   '2026-09-02 00:00:00+00', 'network_error', 'unavailable');

do $$
declare r record;
begin
  select * into strict r from public.llm_usage_events where id = '00000000-0000-4000-8000-000000000001';
  if r.total_tokens <> 920 or r.estimated_cost_usd <> .0021 then
    raise exception 'Incorrect token or cache-inclusive cost calculation: %', row_to_json(r);
  end if;
  select * into strict r from public.llm_usage_report('2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z', 'day');
  if r.period_start <> '2026-09-01 00:00:00+00'::timestamptz
    or r.provider_attempts <> 2 or r.pending_attempts <> 1 or r.unpriced_attempts <> 1
    or r.incomplete_usage_attempts <> 1 or r.known_estimated_cost_usd <> .0021 then
    raise exception 'Day grouping, exclusive end, or unknown cost counts incorrect: %', row_to_json(r);
  end if;
  select * into strict r from public.llm_usage_report('2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', 'week', '00000000-0000-4000-8000-000000000091');
  if r.period_start <> '2026-08-31 00:00:00+00'::timestamptz or r.provider_attempts <> 2 then
    raise exception 'Week must start Monday UTC';
  end if;
  select * into strict r from public.llm_usage_report('2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', 'month', '00000000-0000-4000-8000-000000000092');
  if r.period_start <> '2026-09-01 00:00:00+00'::timestamptz or r.provider_attempts <> 1
    or r.known_estimated_cost_usd is not null then
    raise exception 'Unknown-only group must have NULL cost';
  end if;
  begin
    perform * from public.llm_usage_report('2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', 'hour');
    raise exception 'Invalid granularity accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform * from public.llm_usage_report('2026-10-01T00:00:00Z', '2026-09-01T00:00:00Z');
    raise exception 'Reversed range accepted';
  exception when invalid_parameter_value then null; end;

end;
$$;

-- Partial token observations and incomplete cache breakdowns never become a price.
update public.llm_usage_events set usage_status = 'partial' where id = '00000000-0000-4000-8000-000000000001';
do $$ begin
  if (select estimated_cost_usd is not null from public.llm_usage_events where id = '00000000-0000-4000-8000-000000000001') then
    raise exception 'Partial usage incorrectly priced';
  end if;
end $$;
update public.llm_usage_events set usage_status = 'complete', cache_creation_1h_input_tokens = null
where id = '00000000-0000-4000-8000-000000000001';
do $$ begin
  if (select estimated_cost_usd is not null from public.llm_usage_events where id = '00000000-0000-4000-8000-000000000001') then
    raise exception 'Unknown cache TTL incorrectly priced';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.llm_usage_events'::regclass) then
    raise exception 'RLS must be enabled';
  end if;
  if has_table_privilege('authenticated', 'public.llm_usage_events', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'public.llm_usage_events', 'SELECT,INSERT,UPDATE,DELETE')
    or has_function_privilege('authenticated', 'public.llm_usage_report(timestamptz,timestamptz,text,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.llm_usage_report(timestamptz,timestamptz,text,uuid)', 'EXECUTE') then
    raise exception 'Clients must not access usage records or reports';
  end if;
end $$;

set local role service_role;
select * from public.llm_usage_report('2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z');
update public.llm_usage_events set status = 'incomplete' where id = '00000000-0000-4000-8000-000000000002';
reset role;

delete from auth.users where id = '00000000-0000-4000-8000-000000000091';
do $$ begin
  if exists (select 1 from public.llm_usage_events where user_id = '00000000-0000-4000-8000-000000000091') then
    raise exception 'Account deletion must remove per-user ledger';
  end if;
end $$;
rollback;
