import type { User } from '@supabase/supabase-js';

import { asSleepSource, isUnavailableSleepSchemaError, loadLocalPreferredSleepSource } from '../sleep/sourcePreference';
import { supabase } from '../supabase';
import type { PrimaryConcern, SleepProfile, SleepSource } from './types';

type ProfileRow = {
  display_name: string | null;
  primary_concern: string;
  typical_bedtime: string | null;
  typical_wake_time: string | null;
  timezone: string;
  intake_answers: { reminder_time?: string; first_experiment?: string } | null;
  onboarding_completed_at: string | null;
  preferred_sleep_source?: string | null;
};

const asProfile = (row: ProfileRow, preferredSleepSource: SleepSource | null): SleepProfile | null => {
  if (!row.onboarding_completed_at) return null;
  return {
    displayName: row.display_name ?? '',
    primaryConcern: row.primary_concern as PrimaryConcern,
    typicalBedtime: row.typical_bedtime?.slice(0, 5) ?? '',
    typicalWakeTime: row.typical_wake_time?.slice(0, 5) ?? '',
    timezone: row.timezone,
    preferredSleepSource,
    reminderTime: row.intake_answers?.reminder_time ?? '',
    firstExperiment: row.intake_answers?.first_experiment ?? '',
    onboardingCompletedAt: row.onboarding_completed_at,
  };
};

export async function loadSleepProfile(user: User): Promise<SleepProfile | null> {
  const columns = 'display_name, primary_concern, typical_bedtime, typical_wake_time, timezone, intake_answers, onboarding_completed_at';
  const readProfile = (includeSource: boolean) =>
    supabase
      .from('sleep_profiles')
      .select(includeSource ? `${columns}, preferred_sleep_source` : columns)
      .eq('user_id', user.id)
      .maybeSingle();
  const [result, localSource] = await Promise.all([
    readProfile(true),
    loadLocalPreferredSleepSource(user.id),
  ]);
  // Retain compatibility with installations predating the sleep-source column.
  const { data, error } = result.error && isUnavailableSleepSchemaError(result.error)
    ? await readProfile(false)
    : result;
  if (error) throw error;
  const row = data as ProfileRow | null;
  return row ? asProfile(row, asSleepSource(row.preferred_sleep_source) ?? localSource) : null;
}
