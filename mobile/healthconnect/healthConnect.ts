import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getSdkStatus, SdkAvailabilityStatus, initialize, getGrantedPermissions, requestPermission, readRecords, openHealthConnectSettings } from 'react-native-health-connect';
import type { RecordResult } from 'react-native-health-connect';
import { supabase } from '../supabase';
import { aggregateSleepNight, localDateKey, sleepQueryWindow } from '../healthkit/sleepAggregation';
import type { NormalizedHealthSleepNight } from '../healthkit/sleepAggregation';
import { clearPreferredSleepSource, loadPreferredSleepSource, savePreferredSleepSource } from '../sleep/sourcePreference';
import { healthConnectSleepSamples } from './sleepAdapter';

const enabledKey = (userId: string) => `sleep-coach:health-connect-enabled:${userId}`;
export type HealthConnectSyncResult =
  | { status: 'unavailable' | 'disabled' | 'denied' }
  | { status: 'no_data' }
  | { status: 'synced'; night: NormalizedHealthSleepNight };

// Disconnect cannot race a foreground sync and have deleted cloud rows reappear.
let pending: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = pending.then(work, work);
  pending = next.catch(() => undefined);
  return next;
}
export async function isHealthConnectAvailable() {
  return Platform.OS === 'android' && await getSdkStatus() === SdkAvailabilityStatus.SDK_AVAILABLE;
}
export const isHealthConnectEnabled = async (userId: string) =>
  Platform.OS === 'android' && await AsyncStorage.getItem(enabledKey(userId)) === 'true';
export const manageHealthConnectPermissions = () => openHealthConnectSettings();
const hasSleepRead = (permissions: Awaited<ReturnType<typeof requestPermission>>) =>
  permissions.some(p => p.recordType === 'SleepSession' && p.accessType === 'read');
async function assertUser(userId: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.user.id !== userId) throw new Error('Sign in again to sync sleep.');
}

async function sync(userId: string, sleepDate: string, days: number): Promise<HealthConnectSyncResult> {
  if (!await isHealthConnectEnabled(userId)) return { status: 'disabled' };
  if (!await isHealthConnectAvailable() || !await initialize()) return { status: 'unavailable' };
  if (!hasSleepRead(await getGrantedPermissions())) return { status: 'denied' };
  await assertUser(userId);
  const dates = Array.from({ length: days }, (_, index) => {
    const date = new Date(`${sleepDate}T12:00:00`);
    date.setDate(date.getDate() - index);
    return localDateKey(date);
  });
  const start = sleepQueryWindow(dates[dates.length - 1]).start;
  const end = sleepQueryWindow(sleepDate).end;
  const records: RecordResult<'SleepSession'>[] = [];
  let pageToken: string | undefined;
  const seenTokens = new Set<string>();
  do {
    const page = await readRecords('SleepSession', { timeRangeFilter: {
      operator: 'between', startTime: start.toISOString(), endTime: end.toISOString(),
    }, pageSize: 1000, pageToken });
    records.push(...page.records);
    pageToken = page.pageToken || undefined;
    if (pageToken && seenTokens.has(pageToken)) throw new Error('Sleep sync could not finish. Please refresh again.');
    if (pageToken) seenTokens.add(pageToken);
  } while (pageToken);
  // Do not upload an unfinished session, or mutate stored rows after permission loss.
  const samples = healthConnectSleepSamples(records.filter(record => Date.parse(record.endTime) <= Date.now()));
  if (!hasSleepRead(await getGrantedPermissions())) return { status: 'denied' };
  const nights = dates.map(date => ({ date, night: aggregateSleepNight(samples, date) }));
  const now = new Date().toISOString();
  for (const { date, night } of nights) {
    await assertUser(userId);
    if (!night) {
      const { error } = await supabase.from('sleep_nights').delete().eq('user_id', userId)
        .eq('provider', 'health_connect').eq('sleep_date', date);
      if (error) throw error;
      continue;
    }
    const { error } = await supabase.from('sleep_nights').upsert({
      user_id: userId, provider: 'health_connect', sleep_date: date,
      sleep_score: night.sleepScore, score_version: night.scoreVersion, score_components: night.scoreComponents,
      bedtime_start: night.bedtimeStart, bedtime_end: night.bedtimeEnd,
      total_sleep_minutes: night.totalSleepMinutes, awake_minutes: night.awakeMinutes,
      in_bed_minutes: night.inBedMinutes, rem_minutes: night.remMinutes, deep_minutes: night.deepMinutes,
      core_minutes: night.coreMinutes, sleep_efficiency: night.efficiency,
      source_name: night.sourceName, source_bundle_id: night.sourceBundleIdentifier,
      provider_record_id: night.providerRecordId, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      synced_at: now, updated_at: now,
    }, { onConflict: 'user_id,provider,sleep_date' });
    if (error) throw error;
  }
  const today = nights[0].night;
  return today ? { status: 'synced', night: today } : { status: 'no_data' };
}

export const syncHealthConnectForDate = (userId: string, date = localDateKey()) =>
  serialize(() => sync(userId, date, 3));
export const connectHealthConnect = (userId: string) => serialize(async (): Promise<HealthConnectSyncResult> => {
  if (!await isHealthConnectAvailable() || !await initialize()) return { status: 'unavailable' };
  await assertUser(userId);
  const permissions = await requestPermission([{ accessType: 'read', recordType: 'SleepSession' }]);
  if (!hasSleepRead(permissions)) return { status: 'denied' };
  await AsyncStorage.setItem(enabledKey(userId), 'true');
  if (!await loadPreferredSleepSource(userId)) await savePreferredSleepSource(userId, 'health_connect');
  return sync(userId, localDateKey(), 14);
});
export const disableHealthConnect = (userId: string) => serialize(async () => {
  // Stop device sync even if the network fails; a retry can finish cloud deletion.
  await AsyncStorage.removeItem(enabledKey(userId));
  await assertUser(userId);
  const { error } = await supabase.from('sleep_nights').delete().eq('user_id', userId).eq('provider', 'health_connect');
  if (error) throw error;
  await clearPreferredSleepSource(userId, 'health_connect');
});
