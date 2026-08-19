import type { User } from '@supabase/supabase-js';

import { supabase } from '../supabase';
import { getStarterExperiment, localISODate } from '../coaching/experiments';
import type { OnboardingDraft, PrimaryConcern, SleepProfile } from './types';

type ProfileRow = {
  display_name: string | null;
  primary_concern: string;
  typical_bedtime: string | null;
  typical_wake_time: string | null;
  timezone: string;
  safety_flags: { needs_clinical_followup?: boolean } | null;
  intake_answers: { goal?: string } | null;
  onboarding_completed_at: string | null;
};

const normalizeTime = (value: string) => {
  const compact = value.trim().toLowerCase().replace(/\s+/g, '');
  const match = compact.match(/^(\d{1,2})(?::(\d{1,2}))?(a|am|p|pm)?$/);
  if (!match) throw new Error(`Enter a valid time, such as 10:30 PM or 22:30.`);
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const period = match[3]?.charAt(0);
  if (minute > 59 || (period ? hour < 1 || hour > 12 : hour > 23)) {
    throw new Error(`Enter a valid time, such as 10:30 PM or 22:30.`);
  }
  if (period === 'a' && hour === 12) hour = 0;
  if (period === 'p' && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const asProfile = (row: ProfileRow): SleepProfile | null => {
  if (!row.onboarding_completed_at) return null;
  return {
    displayName: row.display_name ?? '',
    primaryConcern: row.primary_concern as PrimaryConcern,
    typicalBedtime: row.typical_bedtime?.slice(0, 5) ?? '',
    typicalWakeTime: row.typical_wake_time?.slice(0, 5) ?? '',
    timezone: row.timezone,
    goal: row.intake_answers?.goal ?? '',
    safetyConcern: row.safety_flags?.needs_clinical_followup ?? false,
    onboardingCompletedAt: row.onboarding_completed_at,
  };
};

export async function loadSleepProfile(user: User): Promise<SleepProfile | null> {
  const { data, error } = await supabase
    .from('sleep_profiles')
    .select('display_name, primary_concern, typical_bedtime, typical_wake_time, timezone, safety_flags, intake_answers, onboarding_completed_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data ? asProfile(data as ProfileRow) : null;
}

export async function saveSleepProfile(user: User, draft: OnboardingDraft): Promise<SleepProfile> {
  const completedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('sleep_profiles')
    .upsert({
      user_id: user.id,
      display_name: draft.displayName.trim() || null,
      primary_concern: draft.primaryConcern,
      typical_bedtime: draft.typicalBedtime ? normalizeTime(draft.typicalBedtime) : null,
      typical_wake_time: draft.typicalWakeTime ? normalizeTime(draft.typicalWakeTime) : null,
      timezone: draft.timezone,
      safety_flags: { needs_clinical_followup: draft.safetyConcern },
      intake_answers: { goal: draft.goal.trim() },
      intake_version: 1,
      onboarding_completed_at: completedAt,
      updated_at: completedAt,
    })
    .select('display_name, primary_concern, typical_bedtime, typical_wake_time, timezone, safety_flags, intake_answers, onboarding_completed_at')
    .single();
  if (error) throw error;
  const experiment = getStarterExperiment(draft.primaryConcern);
  const { error: commitmentError } = await supabase.from('behavior_commitments').upsert(
    {
      user_id: user.id,
      behavior_date: localISODate(),
      behavior: experiment.behavior,
      status: 'committed',
      updated_at: completedAt,
    },
    { onConflict: 'user_id,behavior_date' },
  );
  if (commitmentError) throw commitmentError;
  return asProfile(data as ProfileRow)!;
}
