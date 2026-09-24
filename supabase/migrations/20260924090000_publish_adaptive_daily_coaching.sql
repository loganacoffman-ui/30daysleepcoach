-- Publish the recommendation and incomplete experiment together. Preserve an
-- audit trail of decisions and never relabel already reported adherence.
create table public.daily_coaching_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recommendation_date date not null,
  decision text not null check (decision in ('continue','simplify','replace','clarify')),
  reason text not null,
  previous_experiment jsonb,
  action text not null,
  created_at timestamptz not null default now()
);
alter table public.daily_coaching_decisions enable row level security;
create policy "Users can read their coaching decisions" on public.daily_coaching_decisions for select to authenticated using (auth.uid() = user_id);
create policy "Users can record their coaching decisions" on public.daily_coaching_decisions for insert to authenticated with check (auth.uid() = user_id);
grant select, insert on public.daily_coaching_decisions to authenticated;

create or replace function public.publish_daily_coaching(
  p_date date, p_expected_experiment jsonb, p_expected_generated_at timestamptz, p_record jsonb
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_row public.behavior_commitments;
  previous jsonb;
  current_saved_at timestamptz;
  source jsonb;
  kind text := p_record->'source_context'->'decision'->>'kind';
  reason text := p_record->'source_context'->'decision'->>'reason';
  action_text text := p_record->>'action';
  generated timestamptz := (p_record->>'generated_at')::timestamptz;
begin
  p_expected_experiment := nullif(p_expected_experiment, 'null'::jsonb);
  if uid is null then raise exception 'Authentication required'; end if;
  if kind is null or kind not in ('continue','simplify','replace','clarify')
    or coalesce(length(trim(reason)),0) not between 1 and 500
    or coalesce(length(trim(action_text)),0) not between 1 and 500
    or p_date is null or generated is null then raise exception 'Invalid coaching decision'; end if;
  -- Serialize competing publications, including the first experiment for a day.
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_date::text, 0));
  select * into current_row from public.behavior_commitments
    where user_id=uid and behavior_date=p_date for update;
  previous := case when current_row.id is null then null else
    jsonb_build_object('id',current_row.id,'behavior',current_row.behavior,'status',current_row.status,'updated_at',current_row.updated_at) end;
  -- Compare timestamp values, not alternate ISO encodings from PostgREST.
  if (previous is null) <> (p_expected_experiment is null)
    or (previous is not null and (
      current_row.id::text is distinct from p_expected_experiment->>'id'
      or current_row.behavior is distinct from p_expected_experiment->>'behavior'
      or current_row.status is distinct from p_expected_experiment->>'status'
      or current_row.updated_at is distinct from (p_expected_experiment->>'updated_at')::timestamptz
    )) then return jsonb_build_object('status','experiment_changed'); end if;
  select generated_at into current_saved_at from public.coach_recommendations
    where user_id=uid and recommendation_date=p_date for update;
  if current_saved_at is distinct from p_expected_generated_at then
    return jsonb_build_object('status','coaching_changed');
  end if;
  if kind='continue' and current_row.id is not null and current_row.behavior <> action_text then
    raise exception 'Continue must retain the existing action';
  end if;
  if kind <> 'clarify' then
    if current_row.id is null then
      insert into public.behavior_commitments(user_id,behavior_date,behavior,status,updated_at)
        values(uid,p_date,action_text,'committed',generated) returning * into current_row;
    elsif current_row.status='committed' and current_row.behavior <> action_text then
      update public.behavior_commitments set behavior=action_text, updated_at=generated
        where id=current_row.id and user_id=uid returning * into current_row;
    end if;
  end if;
  source := coalesce(p_record->'source_context','{}'::jsonb) || jsonb_build_object(
    'commitment_snapshot',case when current_row.id is null then null else
      jsonb_build_object('id',current_row.id,'behavior',current_row.behavior,'status',current_row.status,'updated_at',current_row.updated_at) end);
  insert into public.coach_recommendations(user_id,recommendation_date,pattern,meaning,action,why,source_context,prompt_version,model,generated_at)
    values(uid,p_date,p_record->>'pattern',p_record->>'meaning',action_text,p_record->>'why',source,p_record->>'prompt_version',p_record->>'model',generated)
    on conflict(user_id,recommendation_date) do update set
      pattern=excluded.pattern,meaning=excluded.meaning,action=excluded.action,why=excluded.why,
      source_context=excluded.source_context,prompt_version=excluded.prompt_version,model=excluded.model,generated_at=excluded.generated_at;
  insert into public.daily_coaching_decisions(user_id,recommendation_date,decision,reason,previous_experiment,action)
    values(uid,p_date,kind,reason,previous,action_text);
  return jsonb_build_object('status','ok','recommendation',jsonb_build_object(
    'decision',kind,'pattern',p_record->>'pattern','meaning',p_record->>'meaning','action',action_text,'why',p_record->>'why','generated_at',generated));
end;
$$;
revoke all on function public.publish_daily_coaching(date,jsonb,timestamptz,jsonb) from public, anon;
grant execute on function public.publish_daily_coaching(date,jsonb,timestamptz,jsonb) to authenticated;
