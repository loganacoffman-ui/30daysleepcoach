import { detectTimeZone, isValidTimeZone } from './onboarding/profileFields';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const DAILY_CHECK_IN_CHANNEL_ID = 'daily-check-in';
const DAILY_CHECK_IN_STORAGE_KEY = '@30daysleepcoach/daily-check-in-notification-id';
const PUSH_DEVICE_KEY = '@30daysleepcoach/push-device';
const DAILY_CHECK_IN_TIME_KEY = '@30daysleepcoach/daily-check-in-time';

export type DailyReminderScheduleResult =
  | { status: 'scheduled'; identifier: string }
  | { status: 'denied' }
  | { status: 'unsupported' };

export type DailyReminderState = {
  enabled: boolean;
  clock: string;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const isPermissionAuthorized = (
  permissions: Notifications.NotificationPermissionsStatus,
) => {
  if (Platform.OS !== 'ios') {
    return permissions.granted;
  }

  const authorizationStatus = permissions.ios?.status;
  return (
    authorizationStatus === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    authorizationStatus === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    authorizationStatus === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
};

const prepareAndroidChannel = async () => {
  if (Platform.OS !== 'android') {
    return;
  }

  await Notifications.setNotificationChannelAsync(DAILY_CHECK_IN_CHANNEL_ID, {
    name: 'Daily check-in reminders',
    description: 'A reminder to record how last night went.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
};

const requestNotificationPermission = async () => {
  await prepareAndroidChannel();

  const currentPermissions = await Notifications.getPermissionsAsync();
  if (isPermissionAuthorized(currentPermissions)) {
    return true;
  }

  const requestedPermissions =
    Platform.OS === 'ios'
      ? await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: false,
            allowSound: true,
          },
        })
      : await Notifications.requestPermissionsAsync();

  return isPermissionAuthorized(requestedPermissions);
};

const parseReminderTime = (clock: string) => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock);
  if (!match) {
    throw new Error('Choose a valid daily reminder time.');
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
};

// Serialize registration, foreground refresh, and opt-out so a late token lookup
// cannot turn reminders back on after the user disables them or signs out.
let reminderWork: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = reminderWork.then(work, work);
  reminderWork = result.catch(() => undefined);
  return result;
}

type PushDevice = { id: string; userId: string };
async function storedDevice(): Promise<PushDevice | null> {
  const stored = await AsyncStorage.getItem(PUSH_DEVICE_KEY);
  return stored ? JSON.parse(stored) : null;
}

async function cancelLegacyReminder() {
  const identifier = await AsyncStorage.getItem(DAILY_CHECK_IN_STORAGE_KEY);
  if (identifier && Platform.OS !== 'web') {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  }
  // Keep this key until registration succeeds, so an offline migration retries.
  return identifier;
}

async function registerPushReminder(clock: string, userId: string, devicePushToken?: Notifications.DevicePushToken, timezone = detectTimeZone()): Promise<string> {
  parseReminderTime(clock);
  if (!isValidTimeZone(timezone)) throw new Error('Choose a valid time zone.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('Push notifications are not configured for this app.');
  const token = await Notifications.getExpoPushTokenAsync({ projectId, ...(devicePushToken ? { devicePushToken } : {}) });
  if (await currentUserId() !== userId) throw new Error('The signed-in account changed. Please try again.');
  const previous = await storedDevice();
  const now = new Date().toISOString();
  const values = {
    user_id: userId,
    expo_push_token: token.data,
    platform: Platform.OS,
    app_variant: Constants.expoConfig?.extra?.appVariant ?? 'production',
    timezone,
    reminder_time: clock,
    enabled: true,
    disabled_at: null,
    last_registered_at: now,
    updated_at: now,
  };
  // Updating the same row also handles token rotation without leaving a second
  // reminder enabled, and preserves last_sent_local_date when the clock changes.
  const query = previous?.userId === userId
    ? supabase.from('push_notification_devices').update(values).eq('id', previous.id).eq('user_id', userId)
    : supabase.from('push_notification_devices').upsert(values, { onConflict: 'expo_push_token' });
  let { data, error } = await query.select('id').maybeSingle();
  if (error) throw error;
  if (!data) {
    // A removed server row must not leave the local opt-in impossible to enable.
    ({ data, error } = await supabase.from('push_notification_devices')
      .upsert(values, { onConflict: 'expo_push_token' }).select('id').single());
    if (error) throw error;
  }
  if (!data) throw new Error('The reminder could not be registered. Please try again.');
  try {
    await AsyncStorage.multiSet([
      [PUSH_DEVICE_KEY, JSON.stringify({ id: data.id, userId })],
      [DAILY_CHECK_IN_TIME_KEY, clock],
    ]);
  } catch (storageError) {
    if (previous?.id !== data.id) {
      await supabase.from('push_notification_devices').delete().eq('id', data.id).eq('user_id', userId);
    }
    throw storageError;
  }
  await AsyncStorage.removeItem(DAILY_CHECK_IN_STORAGE_KEY);
  return data.id;
}

async function currentUserId() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error('Sign in to enable daily reminders.');
  return data.session.user.id;
}

async function cancelReminder(identifier?: string) {
  const device = await storedDevice();
  const legacy = await AsyncStorage.getItem(DAILY_CHECK_IN_STORAGE_KEY);
  if (identifier && identifier !== device?.id && identifier !== legacy) return;
  await cancelLegacyReminder();
  if (device) {
    // Delete on opt-out/sign-out so the same push token can later be registered
    // by another account without conflicting with the old account's RLS row.
    const { error } = await supabase.from('push_notification_devices')
      .delete().eq('id', device.id).eq('user_id', device.userId);
    if (error) throw error;
  }
  await AsyncStorage.multiRemove([PUSH_DEVICE_KEY, DAILY_CHECK_IN_STORAGE_KEY]);
}

export function saveDailyCheckInReminderTime(clock: string) {
  return serialize(async () => {
    parseReminderTime(clock);
    await AsyncStorage.setItem(DAILY_CHECK_IN_TIME_KEY, clock);
  });
}

export function getDailyCheckInReminderState(fallbackClock: string): Promise<DailyReminderState> {
  return serialize(async () => {
    const clock = await AsyncStorage.getItem(DAILY_CHECK_IN_TIME_KEY) ?? fallbackClock;
    if (Platform.OS === 'web') return { enabled: false, clock };
    if (!isPermissionAuthorized(await Notifications.getPermissionsAsync())) {
      await cancelReminder();
      return { enabled: false, clock };
    }
    const device = await storedDevice();
    if (!device) return { enabled: false, clock };
    const userId = await currentUserId();
    if (device.userId !== userId) return { enabled: false, clock };
    const { data, error } = await supabase.from('push_notification_devices')
      .select('enabled, reminder_time').eq('id', device.id).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return { enabled: data?.enabled === true, clock: data?.reminder_time.slice(0, 5) ?? clock };
  });
}

export function scheduleDailyCheckInReminder(clock: string, timezone = detectTimeZone()): Promise<DailyReminderScheduleResult> {
  return serialize(async () => {
    if (Platform.OS === 'web') return { status: 'unsupported' };
    parseReminderTime(clock);
    if (!await requestNotificationPermission()) return { status: 'denied' };
    const userId = await currentUserId();
    await cancelLegacyReminder();
    return { status: 'scheduled', identifier: await registerPushReminder(clock, userId, undefined, timezone) };
  });
}

// No permission prompt here: only an existing opt-in may be refreshed/migrated.
// Retry on launch/foreground to pick up token and timezone changes.
export function syncDailyCheckInReminder(userId: string, fallbackClock: string, devicePushToken?: Notifications.DevicePushToken, timezone = detectTimeZone()) {
  return serialize(async () => {
    if (Platform.OS === 'web') return;
    const legacy = await cancelLegacyReminder();
    const device = await storedDevice();
    if (!legacy && device?.userId !== userId) return;
    if (await currentUserId() !== userId) return;
    if (!isPermissionAuthorized(await Notifications.getPermissionsAsync())) {
      await cancelReminder();
      return;
    }
    await prepareAndroidChannel();
    const clock = await AsyncStorage.getItem(DAILY_CHECK_IN_TIME_KEY) ?? fallbackClock;
    await registerPushReminder(clock, userId, devicePushToken, timezone);
  });
}

export function cancelDailyCheckInReminder(identifier?: string) {
  return serialize(() => cancelReminder(identifier));
}

export function clearDailyCheckInReminder() {
  return serialize(async () => {
    await cancelReminder();
    await AsyncStorage.removeItem(DAILY_CHECK_IN_TIME_KEY);
  });
}
