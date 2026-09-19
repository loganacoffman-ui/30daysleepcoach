import type { User } from '@supabase/supabase-js';

import { loadPreferredSleepSource } from '../sleep/sourcePreference';
import { supabase } from '../supabase';
import type { PrimaryConcern, SleepProfile, SleepSource } from './types';
import { validateSleepProfile, type SleepProfileDraft } from './profileFields';

type ProfileRow = {
  display_name: string | null;
  primary_concern: string;
  typical_bedtime: string | null;
  typical_wake_time: string | null;
  timezone: string;
  intake_answers: { reminder_time?: string; first_experiment?: string } | null;
  onboarding_completed_at: string | null;
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
  const [{ data, error }, preferredSleepSource] = await Promise.all([
    supabase
      .from('sleep_profiles')
      .select('display_name, primary_concern, typical_bedtime, typical_wake_time, timezone, intake_answers, onboarding_completed_at')
      .eq('user_id', user.id)
      .maybeSingle(),
    loadPreferredSleepSource(user.id),
  ]);
  if (error) throw error;
  return data ? asProfile(data as ProfileRow, preferredSleepSource) : null;
}

export async function saveSleepProfile(user: User, draft: SleepProfileDraft): Promise<SleepProfileDraft> {
  const validationError = validateSleepProfile(draft);
  if (validationError) throw new Error(validationError);
  const { data, error } = await supabase.from('sleep_profiles').update({
    primary_concern: draft.primaryConcern,
    typical_bedtime: `${draft.typicalBedtime}:00`,
    typical_wake_time: `${draft.typicalWakeTime}:00`,
    timezone: draft.timezone,
  }).eq('user_id', user.id)
    .select('primary_concern, typical_bedtime, typical_wake_time, timezone').single();
  if (error) throw error;
  if (!data) throw new Error('Your profile could not be saved. Please try again.');
  return {
    primaryConcern: data.primary_concern as PrimaryConcern,
    typicalBedtime: data.typical_bedtime.slice(0, 5),
    typicalWakeTime: data.typical_wake_time.slice(0, 5),
    timezone: data.timezone,
  };
}
