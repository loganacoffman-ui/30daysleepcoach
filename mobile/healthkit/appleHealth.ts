import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  isHealthDataAvailable,
  queryCategorySamples,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';
import { Platform } from 'react-native';

import { supabase } from '../supabase';
import {
  clearPreferredSleepSource,
  isUnavailableSleepSchemaError,
  loadPreferredSleepSource,
  savePreferredSleepSource,
} from '../sleep/sourcePreference';
import {
  aggregateSleepNight,
  localDateKey,
  sleepQueryWindow,
} from './sleepAggregation';
import type {
  HealthSleepSample,
  NormalizedHealthSleepNight,
} from './sleepAggregation';

const SLEEP_TYPE = 'HKCategoryTypeIdentifierSleepAnalysis' as const;
const enabledKey = (userId: string) => `sleep-coach:apple-health-enabled:${userId}`;

export type AppleHealthSyncResult =
  | { status: 'unavailable' | 'disabled' | 'no_data' | 'storage_unavailable' }
  | { status: 'synced'; night: NormalizedHealthSleepNight };

export const isAppleHealthAvailable = () =>
  Platform.OS === 'ios' && isHealthDataAvailable();

export const isAppleHealthEnabled = async (userId: string) =>
  isAppleHealthAvailable() && await AsyncStorage.getItem(enabledKey(userId)) === 'true';

const readSleepSamples = async (sleepDate: string): Promise<HealthSleepSample[]> => {
  const window = sleepQueryWindow(sleepDate);
  const samples = await queryCategorySamples(SLEEP_TYPE, {
    limit: -1,
    ascending: true,
    filter: {
      date: {
        startDate: window.start,
        endDate: window.end,
      },
    },
  });
  return samples.map(sample => ({
    uuid: sample.uuid,
    value: sample.value,
    startDate: sample.startDate,
    endDate: sample.endDate,
    sourceName: sample.sourceRevision.source.name,
    sourceBundleIdentifier: sample.sourceRevision.source.bundleIdentifier,
  }));
};

export async function syncAppleHealthForDate(
  userId: string,
  sleepDate = localDateKey(),
): Promise<AppleHealthSyncResult> {
  if (!isAppleHealthAvailable()) return { status: 'unavailable' };
  if (!await isAppleHealthEnabled(userId)) return { status: 'disabled' };

  const night = aggregateSleepNight(await readSleepSamples(sleepDate), sleepDate);
  if (!night) return { status: 'no_data' };

  const syncedAt = new Date().toISOString();
  const { error } = await supabase.from('sleep_nights').upsert({
    user_id: userId,
    provider: 'apple_health',
    sleep_date: night.sleepDate,
    sleep_score: night.sleepScore,
    score_version: night.scoreVersion,
    score_components: night.scoreComponents,
    bedtime_start: night.bedtimeStart,
    bedtime_end: night.bedtimeEnd,
    total_sleep_minutes: night.totalSleepMinutes,
    awake_minutes: night.awakeMinutes,
    in_bed_minutes: night.inBedMinutes,
    rem_minutes: night.remMinutes,
    deep_minutes: night.deepMinutes,
    core_minutes: night.coreMinutes,
    sleep_efficiency: night.efficiency,
    source_name: night.sourceName,
    source_bundle_id: night.sourceBundleIdentifier,
    provider_record_id: night.providerRecordId,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    synced_at: syncedAt,
    updated_at: syncedAt,
  }, { onConflict: 'user_id,provider,sleep_date' });
  if (error && isUnavailableSleepSchemaError(error)) {
    return { status: 'storage_unavailable' };
  }
  if (error) throw error;
  return { status: 'synced', night };
}

export async function connectAppleHealth(
  userId: string,
  sleepDate = localDateKey(),
): Promise<AppleHealthSyncResult> {
  if (!isAppleHealthAvailable()) return { status: 'unavailable' };
  await requestAuthorization({ toRead: [SLEEP_TYPE] });
  await AsyncStorage.setItem(enabledKey(userId), 'true');
  if (!await loadPreferredSleepSource(userId)) {
    await savePreferredSleepSource(userId, 'apple_health');
  }
  return syncAppleHealthForDate(userId, sleepDate);
}

export async function disableAppleHealth(userId: string) {
  const { error } = await supabase
    .from('sleep_nights')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'apple_health');
  if (error && !isUnavailableSleepSchemaError(error)) throw error;

  await clearPreferredSleepSource(userId);
  await AsyncStorage.removeItem(enabledKey(userId));
}
