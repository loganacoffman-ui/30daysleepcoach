-- Backend-only inference ledger. One row per actual provider attempt, including retries.
create table public.llm_usage_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  attempt_index integer not null check (attempt_index > 0),
  provider text not null check (provider = 'anthropic'),
  bucket text not null check (bucket in ('chat', 'daily_checkin', 'sleep_profile', 'greeting')),
  operation text not null,
  requested_model text not null,
  response_model text,
  provider_request_id text,
  provider_message_id text,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('pending', 'completed', 'http_error', 'network_error', 'stream_error', 'incomplete')),
  usage_status text not null check (usage_status in ('unavailable', 'partial', 'complete')),
  http_status integer check (http_status between 100 and 599),
  error_type text,
  stop_reason text,
  raw_usage jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_usage) = 'object'),
  input_tokens bigint check (input_tokens >= 0),
  output_tokens bigint check (output_tokens >= 0),
  cache_read_input_tokens bigint check (cache_read_input_tokens >= 0),
  cache_creation_input_tokens bigint check (cache_creation_input_tokens >= 0),
  cache_creation_5m_input_tokens bigint check (cache_creation_5m_input_tokens >= 0),
  cache_creation_1h_input_tokens bigint check (cache_creation_1h_input_tokens >= 0),
  pricing_version text,
  input_usd_per_million numeric(12,6) check (input_usd_per_million >= 0),
  output_usd_per_million numeric(12,6) check (output_usd_per_million >= 0),
  cache_read_usd_per_million numeric(12,6) check (cache_read_usd_per_million >= 0),
  cache_write_5m_usd_per_million numeric(12,6) check (cache_write_5m_usd_per_million >= 0),
  cache_write_1h_usd_per_million numeric(12,6) check (cache_write_1h_usd_per_million >= 0),
  total_tokens bigint generated always as (
    input_tokens + output_tokens + cache_read_input_tokens + cache_creation_input_tokens
  ) stored,
  estimated_cost_usd numeric generated always as (
    case when usage_status = 'complete' and pricing_version is not null
      and cache_creation_5m_input_tokens + cache_creation_1h_input_tokens = cache_creation_input_tokens
    then (
      input_tokens::numeric * input_usd_per_million
      + output_tokens::numeric * output_usd_per_million
      + cache_read_input_tokens::numeric * cache_read_usd_per_million
      + cache_creation_5m_input_tokens::numeric * cache_write_5m_usd_per_million
      + cache_creation_1h_input_tokens::numeric * cache_write_1h_usd_per_million
    ) / 1000000 end
  ) stored,
  unique (request_id, attempt_index),
  check (usage_status <> 'complete' or (
    input_tokens is not null and output_tokens is not null
    and cache_read_input_tokens is not null and cache_creation_input_tokens is not null
  )),
  check (status <> 'pending' or finished_at is null)
);

comment on table public.llm_usage_events is
  'Per-attempt Anthropic usage. No prompts or replies. NULL cost means unknown, never free. Account deletion cascades.';
comment on column public.llm_usage_events.started_at is
  'UTC reporting attribution uses provider-attempt start time, including attempts crossing midnight.';
comment on column public.llm_usage_events.raw_usage is
  'Provider usage only; streaming cumulative snapshots are merged, not summed.';
comment on column public.llm_usage_events.estimated_cost_usd is
  'Standard API token cost estimate at captured rates, before taxes/credits. NULL for partial/unpriced usage.';

create index llm_usage_events_user_started_idx on public.llm_usage_events(user_id, started_at);
create index llm_usage_events_started_idx on public.llm_usage_events(started_at);
create index llm_usage_events_pending_idx on public.llm_usage_events(started_at) where status = 'pending';

alter table public.llm_usage_events enable row level security;
-- No client policies: users may neither forge usage nor read the internal cost ledger.
revoke all on public.llm_usage_events from public, anon, authenticated;
grant select, insert, update on public.llm_usage_events to service_role;

-- One bounded reporting function for UTC days, ISO weeks (Monday), or calendar months.
-- Reads as the caller, never with owner privileges; callable only by the backend/admin.
create function public.llm_usage_report(
  p_start timestamptz,
  p_end timestamptz,
  p_granularity text default 'day',
  p_user_id uuid default null
)
returns table (
  period_start timestamptz,
  user_id uuid,
  bucket text,
  model text,
  provider_attempts bigint,
  completed_attempts bigint,
  pending_attempts bigint,
  incomplete_usage_attempts bigint,
  unpriced_attempts bigint,
  observed_input_tokens numeric,
  observed_output_tokens numeric,
  observed_cache_read_tokens numeric,
  observed_cache_creation_tokens numeric,
  known_estimated_cost_usd numeric
)
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if p_granularity is null or p_granularity not in ('day', 'week', 'month') then
    raise exception 'p_granularity must be day, week, or month' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_start >= p_end then
    raise exception 'Provide p_start < p_end (exclusive)' using errcode = '22023';
  end if;
  return query
  select
    date_trunc(p_granularity, e.started_at at time zone 'UTC') at time zone 'UTC',
    e.user_id, e.bucket, coalesce(e.response_model, e.requested_model),
    count(*),
    count(*) filter (where e.status = 'completed'),
    count(*) filter (where e.status = 'pending'),
    count(*) filter (where e.usage_status <> 'complete'),
    count(*) filter (where e.estimated_cost_usd is null),
    sum(e.input_tokens), sum(e.output_tokens),
    sum(e.cache_read_input_tokens), sum(e.cache_creation_input_tokens),
    sum(e.estimated_cost_usd)
  from public.llm_usage_events e
  where e.started_at >= p_start and e.started_at < p_end
    and (p_user_id is null or e.user_id = p_user_id)
  group by 1, 2, 3, 4
  order by 1, 2, 3, 4;
end;
$$;

revoke all on function public.llm_usage_report(timestamptz, timestamptz, text, uuid) from public, anon, authenticated;
grant execute on function public.llm_usage_report(timestamptz, timestamptz, text, uuid) to service_role;
