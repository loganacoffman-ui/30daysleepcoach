import type { User } from '@supabase/supabase-js';
import { getAdaptiveExperiment } from '../coaching/experiments';
import type { ExperimentHistory } from '../coaching/experiments';
import type { PrimaryConcern } from '../onboarding/types';
import { supabase } from '../supabase';
import type { DailyCheckinDraft, TodayRepository } from './types';

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

const decisionMessage = (decision: 'start'|'repeat'|'simplify'|'advance') => ({
  start: 'We’re starting with one small, high-impact anchor.',
  repeat: 'Consistency is more useful than rushing ahead, so we’re keeping tonight familiar.',
  simplify: 'Last night was hard to fit in, so tonight’s version is intentionally easier.',
  advance: 'You completed the last step, so tonight builds gently on that success.',
}[decision]);

export const createSupabaseTodayRepository = (user: User, greetingName: string | undefined, primaryConcern: PrimaryConcern): TodayRepository => ({
  async loadToday() {
    const date = localDate();
    const [checkinResult, commitmentResult, historyResult] = await Promise.all([
      supabase.from('daily_checkins').select('id, checkin_date, feeling, suspected_factor, note, completed_at').eq('user_id', user.id).eq('checkin_date', date).maybeSingle(),
      supabase.from('behavior_commitments').select('id, behavior_date, behavior, status').eq('user_id', user.id).eq('behavior_date', date).maybeSingle(),
      supabase.from('behavior_commitments').select('id, behavior_date, behavior, status').eq('user_id', user.id).lt('behavior_date', date).order('behavior_date', { ascending: false }).limit(7),
    ]);
    if (checkinResult.error) throw checkinResult.error;
    if (commitmentResult.error) throw commitmentResult.error;
    if (historyResult.error) throw historyResult.error;

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
    return {
      date,
      dayNumber: Math.min(history.length + 1, 7),
      greetingName,
      coachingMessage: decisionMessage(selected.decision),
      checkin: checkin ? { id:checkin.id, checkinDate:checkin.checkin_date, feeling:checkin.feeling, suspectedFactor:checkin.suspected_factor || undefined, note:checkin.note || undefined, completedAt:checkin.completed_at } : null,
      commitment: current ? { id:current.id, behaviorDate:current.behavior_date, behavior:current.behavior, why:selected.why, status:current.status } : null,
      previousCommitment: previous ? { id:previous.id, behaviorDate:previous.behavior_date, behavior:previous.behavior, status:previous.status } : null,
    };
  },
  async saveCheckin(draft: DailyCheckinDraft) {
    const date=localDate(); const completedAt=new Date().toISOString();
    const {data,error}=await supabase.from('daily_checkins').upsert({user_id:user.id,checkin_date:date,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',feeling:draft.feeling,suspected_factor:draft.suspectedFactor||null,note:draft.note?.trim()||null,completed_at:completedAt,updated_at:completedAt},{onConflict:'user_id,checkin_date'}).select('id, checkin_date, feeling, suspected_factor, note, completed_at').single();
    if(error) throw error;
    return {id:data.id,checkinDate:data.checkin_date,feeling:data.feeling,suspectedFactor:data.suspected_factor||undefined,note:data.note||undefined,completedAt:data.completed_at};
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
