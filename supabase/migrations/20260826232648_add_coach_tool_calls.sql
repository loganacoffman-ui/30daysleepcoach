-- Persist model-requested coach tools separately from chat messages so tools can
-- require confirmation, be resumed safely, and retain an audit trail.
create table public.coach_tool_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.coach_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null check (char_length(tool_name) between 1 and 64),
  scope_key text not null check (char_length(scope_key) between 1 and 120),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'cancelled', 'failed', 'expired')),
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  output jsonb check (output is null or jsonb_typeof(output) = 'object'),
  requires_confirmation boolean not null default true,
  provider_call_id text,
  confirmed_at timestamptz,
  executed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep the domain history even though behavior_commitments remains one active
-- row per user and night.
create table public.behavior_commitment_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  behavior_commitment_id uuid not null references public.behavior_commitments(id) on delete cascade,
  tool_call_id uuid not null unique references public.coach_tool_calls(id) on delete restrict,
  behavior_date date not null,
  previous_behavior text not null check (char_length(trim(previous_behavior)) > 0),
  replacement_behavior text not null check (char_length(trim(replacement_behavior)) > 0),
  user_reason text not null check (char_length(trim(user_reason)) between 1 and 500),
  coach_rationale text not null check (char_length(trim(coach_rationale)) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.coach_tool_calls enable row level security;
alter table public.behavior_commitment_changes enable row level security;

create policy "Users can read their coach tool calls"
  on public.coach_tool_calls for select to authenticated
  using (auth.uid() = user_id);
create policy "Users can create coach tool calls in their conversations"
  on public.coach_tool_calls for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.coach_conversations conversation
      where conversation.id = conversation_id
        and conversation.user_id = auth.uid()
    )
  );
create policy "Users can update their coach tool calls"
  on public.coach_tool_calls for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can read their experiment change history"
  on public.behavior_commitment_changes for select to authenticated
  using (auth.uid() = user_id);
create policy "Users can create their experiment change history"
  on public.behavior_commitment_changes for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.behavior_commitments commitment
      where commitment.id = behavior_commitment_id
        and commitment.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.coach_tool_calls tool_call
      where tool_call.id = tool_call_id
        and tool_call.user_id = auth.uid()
    )
  );

revoke all on public.coach_tool_calls from anon;
revoke all on public.behavior_commitment_changes from anon;
grant select, insert, update on public.coach_tool_calls to authenticated;
grant select, insert on public.behavior_commitment_changes to authenticated;

create index coach_tool_calls_conversation_created_idx
  on public.coach_tool_calls (conversation_id, created_at desc);
create index coach_tool_calls_user_status_idx
  on public.coach_tool_calls (user_id, status, created_at desc);
create unique index coach_tool_calls_one_pending_scope_idx
  on public.coach_tool_calls (user_id, tool_name, scope_key)
  where status = 'pending';
create index behavior_commitment_changes_user_date_idx
  on public.behavior_commitment_changes (user_id, behavior_date desc);

-- Confirmation and replacement happen in one transaction. This is a security
-- invoker function, so RLS and the authenticated caller's grants still apply.
create or replace function public.confirm_coach_experiment_change(
  requested_tool_call_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tool_call public.coach_tool_calls;
  commitment public.behavior_commitments;
  replacement_behavior text;
  user_reason text;
  coach_rationale text;
  result jsonb;
begin
  select *
  into tool_call
  from public.coach_tool_calls
  where id = requested_tool_call_id
    and user_id = auth.uid()
  for update;

  if tool_call.id is null then
    raise exception 'Tool call not found';
  end if;

  if tool_call.tool_name <> 'sleep_experiment_propose_change' then
    raise exception 'Unsupported tool call';
  end if;

  if tool_call.status = 'completed' then
    return tool_call.output;
  end if;

  if tool_call.status <> 'pending' or tool_call.expires_at <= now() then
    raise exception 'This experiment change is no longer pending';
  end if;

  replacement_behavior := trim(coalesce(tool_call.input->>'replacement_experiment', ''));
  user_reason := trim(coalesce(tool_call.input->>'user_reason', ''));
  coach_rationale := trim(coalesce(tool_call.input->>'coach_rationale', ''));

  if replacement_behavior = ''
    or char_length(replacement_behavior) > 300
    or user_reason = ''
    or char_length(user_reason) > 500
    or coach_rationale = ''
    or char_length(coach_rationale) > 500
  then
    raise exception 'The experiment change proposal is incomplete';
  end if;

  select *
  into commitment
  from public.behavior_commitments
  where id = (tool_call.input->>'behavior_commitment_id')::uuid
    and user_id = auth.uid()
  for update;

  if commitment.id is null
    or commitment.behavior_date <> (tool_call.input->>'behavior_date')::date
    or commitment.status <> 'committed'
    or commitment.behavior <> tool_call.input->>'previous_experiment'
  then
    raise exception 'Tonight''s active experiment has changed since this proposal';
  end if;

  update public.behavior_commitments
  set behavior = replacement_behavior,
      updated_at = now()
  where id = commitment.id;

  update public.coach_recommendations
  set action = replacement_behavior,
      why = coach_rationale,
      source_context = source_context || jsonb_build_object(
        'experiment_change_tool_call_id', tool_call.id,
        'experiment_changed_at', now()
      )
  where user_id = auth.uid()
    and recommendation_date = commitment.behavior_date;

  insert into public.behavior_commitment_changes (
    user_id,
    behavior_commitment_id,
    tool_call_id,
    behavior_date,
    previous_behavior,
    replacement_behavior,
    user_reason,
    coach_rationale
  )
  values (
    auth.uid(),
    commitment.id,
    tool_call.id,
    commitment.behavior_date,
    commitment.behavior,
    replacement_behavior,
    user_reason,
    coach_rationale
  );

  result := jsonb_build_object(
    'behavior_commitment_id', commitment.id,
    'behavior_date', commitment.behavior_date,
    'previous_experiment', commitment.behavior,
    'previous_status', 'replaced',
    'replacement_experiment', replacement_behavior,
    'user_reason', user_reason,
    'coach_rationale', coach_rationale
  );

  update public.coach_tool_calls
  set status = 'completed',
      output = result,
      confirmed_at = now(),
      executed_at = now(),
      updated_at = now()
  where id = tool_call.id;

  return result;
end;
$$;

revoke all on function public.confirm_coach_experiment_change(uuid) from public;
grant execute on function public.confirm_coach_experiment_change(uuid) to authenticated;
