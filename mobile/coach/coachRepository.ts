import type { User } from '@supabase/supabase-js';

import type { SleepProfile } from '../onboarding/types';
import { supabase } from '../supabase';

export type DailyCoaching = {
  pattern: string;
  meaning: string;
  action: string;
  why: string;
  generatedAt: string;
};

const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const daysAgo = (count: number) => {
  const date = new Date();
  date.setDate(date.getDate() - count);
  return localDate(date);
};

export const loadDailyCoaching = async (user: User, profile: SleepProfile): Promise<DailyCoaching> => {
  const [checkinsResult, commitmentsResult, ouraResult] = await Promise.all([
    supabase.from('daily_checkins').select('checkin_date, feeling, suspected_factor, note, completed_at').eq('user_id', user.id).order('checkin_date', { ascending: false }).limit(14),
    supabase.from('behavior_commitments').select('behavior_date, behavior, status').eq('user_id', user.id).order('behavior_date', { ascending: false }).limit(14),
    supabase.functions.invoke<{ data?: Array<{ day: string; score?: number }> }>('oura-proxy', {
      body: { endpoint: 'daily_sleep', start_date: daysAgo(14), end_date: localDate() },
    }),
  ]);

  if (checkinsResult.error) throw checkinsResult.error;
  if (commitmentsResult.error) throw commitmentsResult.error;

  const { data, error } = await supabase.functions.invoke<{
    status?: string;
    recommendation?: { pattern: string; meaning: string; action: string; why: string; generated_at: string };
  }>('sleep-coach', {
    body: {
      mode: 'daily_coach',
      cacheKey: `daily_coach_${localDate()}`,
      coachContext: {
        date: localDate(),
        profile: {
          primary_concern: profile.primaryConcern,
          goal: profile.goal,
          typical_bedtime: profile.typicalBedtime,
          typical_wake_time: profile.typicalWakeTime,
          timezone: profile.timezone,
        },
        subjective_checkins: checkinsResult.data ?? [],
        experiment_adherence: commitmentsResult.data ?? [],
        oura_sleep: ouraResult.error ? [] : ouraResult.data?.data ?? [],
      },
    },
  });

  if (error || data?.status !== 'ok' || !data.recommendation) {
    throw error ?? new Error('Your daily coaching could not be generated.');
  }

  return {
    pattern: data.recommendation.pattern,
    meaning: data.recommendation.meaning,
    action: data.recommendation.action,
    why: data.recommendation.why,
    generatedAt: data.recommendation.generated_at,
  };
};
