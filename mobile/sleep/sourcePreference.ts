import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SleepSource } from '../onboarding/types';
import { supabase } from '../supabase';

const preferenceKey = (userId: string) => `sleep-coach:preferred-sleep-source:${userId}`;

const asSleepSource = (value: unknown): SleepSource | null =>
  value === 'apple_health' || value === 'oura' ? value : null;

export const isUnavailableSleepSchemaError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  return (
    (code === '42703' && message.includes('preferred_sleep_source'))
    || code === '42P01'
    || code === 'PGRST204'
    || code === 'PGRST205'
  );
};

export async function loadPreferredSleepSource(userId: string): Promise<SleepSource | null> {
  const localPreference = asSleepSource(await AsyncStorage.getItem(preferenceKey(userId)));
  const { data, error } = await supabase
    .from('sleep_profiles')
    .select('preferred_sleep_source')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (isUnavailableSleepSchemaError(error)) return localPreference;
    throw error;
  }
  return asSleepSource(data?.preferred_sleep_source) ?? localPreference;
}

export async function savePreferredSleepSource(userId: string, source: SleepSource) {
  await AsyncStorage.setItem(preferenceKey(userId), source);
  const { error } = await supabase
    .from('sleep_profiles')
    .update({ preferred_sleep_source: source, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error && !isUnavailableSleepSchemaError(error)) throw error;
}

export async function clearPreferredSleepSource(userId: string) {
  await AsyncStorage.removeItem(preferenceKey(userId));
  const { error } = await supabase
    .from('sleep_profiles')
    .update({ preferred_sleep_source: null, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('preferred_sleep_source', 'apple_health');
  if (error && !isUnavailableSleepSchemaError(error)) throw error;
}
