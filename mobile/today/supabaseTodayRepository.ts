import type { User } from '@supabase/supabase-js';
import { syncAppleHealthForDate } from '../healthkit/appleHealth';
import type { PrimaryConcern } from '../onboarding/types';
import { selectWearableSleepForDate } from '../sleep/sourceSelection';
import type { WearableSleep } from '../sleep/sourceSelection';
import {
  isUnavailableSleepSchemaError,
  loadPreferredSleepSource,
} from '../sleep/sourcePreference';
import { supabase } from '../supabase';
import { normalizeMorningFeeling } from './feeling';
import type { DailyCheckinDraft, TodayRepository } from './types';

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

type OuraSleepDay = { day: string; score?: number };

export const createSupabaseTodayRepository = (user: User, greetingName: string | undefined, _primaryConcern: PrimaryConcern): TodayRepository => ({
  async loadToday() {
    const date = localDate();
    await syncAppleHealthForDate(user.id, date).catch(() => undefined);
    const appOpenResult = await supabase.from('app_open_days').upsert(
      { user_id: user.id, opened_date: date },
      { onConflict: 'user_id,opened_date', ignoreDuplicates: true },
    );
    if (appOpenResult.error) throw appOpenResult.error;
    const [checkinResult, commitmentResult, historyResult, recommendationResult, ouraResult, openDaysResult, appleHealthResult, preferredSleepSource] = await Promise.all([
      supabase.from('daily_checkins').select('id, checkin_date, morning_feeling, feeling, manual_sleep_score, manual_sleep_submitted_at, suspected_factor, note, completed_at').eq('user_id', user.id).eq('checkin_date', date).maybeSingle(),
      supabase.from('behavior_commitments').select('id, behavior_date, behavior, status').eq('user_id', user.id).eq('behavior_date', date).maybeSingle(),
      supabase.from('behavior_commitments').select('id, behavior_date, behavior, status').eq('user_id', user.id).lt('behavior_date', date).order('behavior_date', { ascending: false }).limit(7),
      supabase.from('coach_recommendations').select('action, why').eq('user_id', user.id).eq('recommendation_date', date).maybeSingle(),
      supabase.functions.invoke<{ data?: OuraSleepDay[] }>('oura-proxy', {
        body: { endpoint: 'daily_sleep', start_date: date, end_date: date },
      }),
      supabase.from('app_open_days').select('opened_date', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('sleep_nights').select('sleep_date, sleep_score, score_version, total_sleep_minutes').eq('user_id', user.id).eq('provider', 'apple_health').eq('sleep_date', date).maybeSingle(),
      loadPreferredSleepSource(user.id),
    ]);
    if (checkinResult.error) throw checkinResult.error;
    if (commitmentResult.error) throw commitmentResult.error;
    if (historyResult.error) throw historyResult.error;
    if (recommendationResult.error) throw recommendationResult.error;
    if (openDaysResult.error) throw openDaysResult.error;
    if (appleHealthResult.error && !isUnavailableSleepSchemaError(appleHealthResult.error)) {
      throw appleHealthResult.error;
    }

    const history = historyResult.data ?? [];
    const current = commitmentResult.data;
    const firstDifferentExperiment = current
      ? history.findIndex(item => item.behavior !== current.behavior)
      : 0;
    const previousRunNights = firstDifferentExperiment === -1
      ? history.length
      : firstDifferentExperiment;

    const previous = history.find(item => item.status === 'committed') ?? null;
    const checkin = checkinResult.data;
    const wearableRows: WearableSleep[] = [];
    const ouraDay = ouraResult.error
      ? null
      : ouraResult.data?.data?.find(item => item.day === date && typeof item.score === 'number') ?? null;
    if (ouraDay && typeof ouraDay.score === 'number') {
      wearableRows.push({ day: ouraDay.day, score: ouraDay.score, source: 'oura' });
    }
    if (typeof appleHealthResult.data?.sleep_score === 'number') {
      wearableRows.push({
        day: appleHealthResult.data.sleep_date,
        score: appleHealthResult.data.sleep_score,
        source: 'apple_health',
        scoreVersion: appleHealthResult.data.score_version,
        totalSleepMinutes: appleHealthResult.data.total_sleep_minutes,
      });
    }
    const wearable = selectWearableSleepForDate(
      wearableRows,
      date,
      preferredSleepSource,
    );
    const manualScore = typeof checkin?.manual_sleep_score === 'number'
      ? checkin.manual_sleep_score
      : null;
    return {
      date,
      dayNumber: Math.max(openDaysResult.count ?? 1, 1),
      greetingName,
      coachingMessage: current ? 'One focused experiment, tracked long enough to learn from it.' : undefined,
      checkin: checkin ? { id:checkin.id, checkinDate:checkin.checkin_date, morningFeeling:normalizeMorningFeeling(checkin.morning_feeling, checkin.feeling) ?? 'okay', manualSleepScore:manualScore ?? undefined, suspectedFactor:checkin.suspected_factor || undefined, note:checkin.note || undefined, completedAt:checkin.completed_at } : null,
      sleepData: wearable
        ? { status: 'wearable', score: wearable.score, source: wearable.source }
        : typeof manualScore === 'number' && checkin?.manual_sleep_submitted_at
          ? { status: 'manual', score: manualScore, source: 'manual' }
          : { status: 'missing', score: null, source: null },
      commitment: current ? {
        id: current.id,
        behaviorDate: current.behavior_date,
        behavior: current.behavior,
        why: recommendationResult.data?.action === current.behavior ? recommendationResult.data?.why : undefined,
        status: current.status,
        runDay: Math.min(3, previousRunNights + 1),
        runLength: 3,
      } : null,
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

  },
});
