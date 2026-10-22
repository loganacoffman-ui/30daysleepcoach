-- Shared across Edge workers; clients must never control provider evidence or flags.
create table public.coach_runtime_cache (
  user_id uuid not null references auth.users(id) on delete cascade,
  cache_key text not null,
  value jsonb not null,
  expires_at timestamptz not null,
  primary key (user_id, cache_key)
);
create table public.coach_generation_leases (
  user_id uuid not null references auth.users(id) on delete cascade,
  cache_key text not null,
  owner uuid not null,
  expires_at timestamptz not null,
  primary key (user_id, cache_key)
);
alter table public.coach_runtime_cache enable row level security;
alter table public.coach_generation_leases enable row level security;
revoke all on public.coach_runtime_cache, public.coach_generation_leases from public, anon, authenticated;
grant all on public.coach_runtime_cache, public.coach_generation_leases to service_role;

create function public.claim_coach_generation(p_user_id uuid, p_key text, p_owner uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  -- Opportunistic per-user cleanup keeps dated wearable cache entries bounded.
  delete from public.coach_runtime_cache where user_id = p_user_id and expires_at < now() - interval '1 hour';
  insert into public.coach_generation_leases(user_id, cache_key, owner, expires_at)
    values (p_user_id, p_key, p_owner, now() + interval '120 seconds')
  on conflict (user_id, cache_key) do update
    set owner = excluded.owner, expires_at = excluded.expires_at
    where public.coach_generation_leases.expires_at <= now();
  return found;
end;
$$;
revoke all on function public.claim_coach_generation(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_coach_generation(uuid, text, uuid) to service_role;

-- A single statement/snapshot verifies all stored evidence after generation.
-- Only the backend can pass a user ID; no SECURITY DEFINER or client grants.
create function public.daily_coach_evidence_revision(p_user_id uuid, p_date date, p_expected_oura jsonb default null)
returns text language sql stable security invoker set search_path = '' as $$
  select md5(jsonb_build_object(
    'profile', (select to_jsonb(p) - 'updated_at' - 'created_at' from public.sleep_profiles p where user_id = p_user_id),
    'checkins', (select jsonb_agg(to_jsonb(c) - 'updated_at' - 'created_at' order by checkin_date)
      from public.daily_checkins c where user_id = p_user_id and checkin_date between p_date - 13 and p_date),
    'nights', (select jsonb_agg(to_jsonb(n) - 'updated_at' - 'synced_at' - 'created_at' order by sleep_date, provider)
      from public.sleep_nights n where user_id = p_user_id and sleep_date between p_date - 13 and p_date),
    'adherence', (select jsonb_agg(to_jsonb(b) - 'updated_at' - 'created_at' order by behavior_date, id)
      from public.behavior_commitments b where user_id = p_user_id and behavior_date >= p_date - 13 and behavior_date < p_date),
    'reports', (select jsonb_agg(to_jsonb(r) order by created_at desc, id desc) from (
      select id, content, created_at from public.coach_messages where user_id = p_user_id and role = 'user'
        and created_at between now() - interval '30 days' and now()
      order by created_at desc, id desc limit 40) r),
    'oura_connection', (select updated_at from public.oura_connections where user_id = p_user_id),
    'oura', (select value from public.coach_runtime_cache where user_id = p_user_id
      and cache_key = 'oura:daily_sleep:' || (p_date - 13)::text || ':' || p_date::text)
  )::text)
  -- Refuse a snapshot if a correction or reconnect landed after the Oura read
  -- but before this baseline. Otherwise a stale payload could receive a new revision.
  where p_expected_oura is null or exists (
    select 1 from public.coach_runtime_cache r join public.oura_connections c on c.user_id = r.user_id
    where r.user_id = p_user_id and r.cache_key = 'oura:daily_sleep:' || (p_date - 13)::text || ':' || p_date::text
      and r.value = p_expected_oura and c.updated_at = (p_expected_oura->>'connectionVersion')::timestamptz
  );
$$;
revoke all on function public.daily_coach_evidence_revision(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.daily_coach_evidence_revision(uuid, date, jsonb) to service_role;
