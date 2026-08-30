import type { User } from '@supabase/supabase-js';
import { getAdaptiveExperiment } from '../coaching/experiments';
import type { ExperimentHistory } from '../coaching/experiments';
import type { PrimaryConcern } from '../onboarding/types';
import { supabase } from '../supabase';
import { normalizeMorningFeeling } from './feeling';
import type { DailyCheckinDraft, TodayRepository } from './types';

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

type OuraSleepDay = { day: string; score?: number };

const decisionMessage = (decision: 'start'|'repeat'|'simplify'|'advance') => ({
  start: 'We’re starting with one small, high-impact anchor.',
  repeat: 'Consistency is more useful than rushing ahead, so we’re keeping tonight familiar.',
  simplify: 'Last night was hard to fit in, so tonight’s version is intentionally easier.',
  advance: 'You completed the last step, so tonight builds gently on that success.',
}[decision]);

export const createSupabaseTodayRepository = (user: User, greetingName: string | undefined, primaryConcern: PrimaryConcern): TodayRepository => ({
  async loadToday() {
    const date = localDate();
    const appOpenResult = await supabase.from('app_open_days').upsert(
      { user_id: user.id, opened_date: date },
      { onConflict: 'user_id,opened_date', ignoreDuplicates: true },
    );
    if (appOpenResult.error) throw appOpenResult.error;
    const [checkinResult, commitmentResult, historyResult, ouraResult, openDaysResult] = await Promise.all([
      supabase.from('daily_checkins').select('id, checkin_date, morning_feeling, feeling, manual_sleep_score, manual_sleep_submitted_at, suspected_factor, note, completed_at').eq('user_id', user.id).eq('checkin_date', date).maybeSingle(),
      supabase.from('behavior_commitments').select('id, behavior_date, behavior, status').eq('user_id', user.id).eq('behavior_date', date).maybeSingle(),
      supabase.from('behavior_commitments').select('id, behavior_date, behavior, status').eq('user_id', user.id).lt('behavior_date', date).order('behavior_date', { ascending: false }).limit(7),
      supabase.functions.invoke<{ data?: OuraSleepDay[] }>('oura-proxy', {
        body: { endpoint: 'daily_sleep', start_date: date, end_date: date },
      }),
      supabase.from('app_open_days').select('opened_date', { count: 'exact', head: true }).eq('user_id', user.id),
    ]);
    if (checkinResult.error) throw checkinResult.error;
    if (commitmentResult.error) throw commitmentResult.error;
    if (historyResult.error) throw historyResult.error;
    if (openDaysResult.error) throw openDaysResult.error;

    const history = (historyResult.data ?? []) as Array<ExperimentHistory & {id:string;behavior_date:string}>;
    const selected = getAdaptiveExperiment(primaryConcern, history);
    let current = commitmentResult.data;
    if (!current) {
      const { data, error } = await supabase.from('behavior_commitments').upsert({
        user_id:user.id, behavior_date:date, behavior:selected.behavior, status:'committed', updated_at:new Date().toISOString(),
      }, { onConflict:'user_id,behavior_date' }).select('id, behavior_date, behavior, status').single();
      if (error) throw error;
      current = data;
    }

    const previous = history.find(item => item.status === 'committed') ?? null;
    const checkin = checkinResult.data;
    const wearableScore = ouraResult.error
      ? null
      : ouraResult.data?.data?.find(item => item.day === date && typeof item.score === 'number')?.score ?? null;
    const manualScore = typeof checkin?.manual_sleep_score === 'number'
      ? checkin.manual_sleep_score
      : null;
    return {
      date,
      dayNumber: Math.max(openDaysResult.count ?? 1, 1),
      greetingName,
      coachingMessage: decisionMessage(selected.decision),
      checkin: checkin ? { id:checkin.id, checkinDate:checkin.checkin_date, morningFeeling:normalizeMorningFeeling(checkin.morning_feeling, checkin.feeling) ?? 'okay', manualSleepScore:manualScore ?? undefined, suspectedFactor:checkin.suspected_factor || undefined, note:checkin.note || undefined, completedAt:checkin.completed_at } : null,
      sleepData: typeof wearableScore === 'number'
        ? { status: 'wearable', score: wearableScore }
        : typeof manualScore === 'number' && checkin?.manual_sleep_submitted_at
          ? { status: 'manual', score: manualScore }
          : { status: 'missing', score: null },
      commitment: current ? { id:current.id, behaviorDate:current.behavior_date, behavior:current.behavior, why:selected.why, status:current.status } : null,
      previousCommitment: previous ? { id:previous.id, behaviorDate:previous.behavior_date, behavior:previous.behavior, status:previous.status } : null,
    };
  },
  async saveCheckin(draft: DailyCheckinDraft) {
    const date=localDate(); const completedAt=new Date().toISOString();
    const manualSleep = typeof draft.manualSleepScore === 'number';
    const {data,error}=await supabase.from('daily_checkins').upsert({user_id:user.id,checkin_date:date,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',morning_feeling:draft.morningFeeling,manual_sleep_score:manualSleep?draft.manualSleepScore:null,manual_sleep_submitted_at:manualSleep?completedAt:null,suspected_factor:draft.suspectedFactor||null,note:draft.note?.trim()||null,completed_at:completedAt,updated_at:completedAt},{onConflict:'user_id,checkin_date'}).select('id, checkin_date, morning_feeling, manual_sleep_score, suspected_factor, note, completed_at').single();
    if(error) throw error;
    return {id:data.id,checkinDate:data.checkin_date,morningFeeling:data.morning_feeling,manualSleepScore:data.manual_sleep_score??undefined,suspectedFactor:data.suspected_factor||undefined,note:data.note||undefined,completedAt:data.completed_at};
  },
  async saveManualSleepScore(score) {
    const date = localDate();
    const submittedAt = new Date().toISOString();
    const { error } = await supabase.from('daily_checkins').update({
      manual_sleep_score: score,
      manual_sleep_submitted_at: submittedAt,
      updated_at: submittedAt,
    }).eq('user_id', user.id).eq('checkin_date', date);
    if (error) throw error;
  },
  async updateCommitmentStatus(id,status) {
    const updatedAt=new Date().toISOString();
    const {error}=await supabase.from('behavior_commitments').update({status,updated_at:updatedAt}).eq('id',id).eq('user_id',user.id);
    if(error) throw error;

    // Re-select after recording the reflection so today's coaching adapts immediately.
    const date=localDate();
    const {data:history,error:historyError}=await supabase.from('behavior_commitments').select('behavior, status').eq('user_id',user.id).lt('behavior_date',date).order('behavior_date',{ascending:false}).limit(7);
    if(historyError) throw historyError;
    const next=getAdaptiveExperiment(primaryConcern,(history??[]) as ExperimentHistory[]);
    const {error:nextError}=await supabase.from('behavior_commitments').upsert({user_id:user.id,behavior_date:date,behavior:next.behavior,status:'committed',updated_at:updatedAt},{onConflict:'user_id,behavior_date'});
    if(nextError) throw nextError;
  },
});
