import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from './supabase';

const DAILY_CHECK_IN_CHANNEL_ID = 'daily-check-in';
const DAILY_CHECK_IN_STORAGE_KEY = '@30daysleepcoach/daily-check-in-notification-id';
const DAILY_CHECK_IN_TIME_KEY = '@30daysleepcoach/daily-check-in-time';
const EXPO_PUSH_TOKEN_KEY = '@30daysleepcoach/expo-push-token';
const REMOTE_IDENTIFIER_PREFIX = 'remote:';

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

const currentTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

async function upsertRemotePushDevice(clock: string) {
  if (Platform.OS === 'web') return null;

  await prepareAndroidChannel();
  const permissions = await Notifications.getPermissionsAsync();
  if (!isPermissionAuthorized(permissions)) return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('The Expo project ID is missing from this build.');

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;

  const expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const registeredAt = new Date().toISOString();
  const { error } = await supabase.from('push_notification_devices').upsert({
    user_id: userData.user.id,
    expo_push_token: expoPushToken,
    platform: Platform.OS,
    app_variant: String(Constants.expoConfig?.extra?.appVariant ?? 'production'),
    timezone: currentTimezone(),
    reminder_time: clock,
    enabled: true,
    disabled_at: null,
    last_registered_at: registeredAt,
    updated_at: registeredAt,
  }, { onConflict: 'expo_push_token' });
  if (error) throw error;

  await AsyncStorage.setItem(EXPO_PUSH_TOKEN_KEY, expoPushToken);
  return expoPushToken;
}

export async function syncRemotePushRegistration(fallbackClock = '08:00') {
  const [identifier, storedClock] = await Promise.all([
    AsyncStorage.getItem(DAILY_CHECK_IN_STORAGE_KEY),
    AsyncStorage.getItem(DAILY_CHECK_IN_TIME_KEY),
  ]);
  if (!identifier) return null;
  const clock = storedClock ?? fallbackClock;
  const token = await upsertRemotePushDevice(clock);
  if (token && !identifier.startsWith(REMOTE_IDENTIFIER_PREFIX)) {
    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => undefined);
    await AsyncStorage.setItem(DAILY_CHECK_IN_STORAGE_KEY, `${REMOTE_IDENTIFIER_PREFIX}${token}`);
  }
  return token;
}

export async function disableRemotePushDevice() {
  const token = await AsyncStorage.getItem(EXPO_PUSH_TOKEN_KEY);
  if (!token) return;
  const disabledAt = new Date().toISOString();
  const { error } = await supabase.from('push_notification_devices').update({
    enabled: false,
    disabled_at: disabledAt,
    updated_at: disabledAt,
  }).eq('expo_push_token', token);
  if (error) throw error;
}

export async function sendTestPushNotification() {
  const { data, error } = await supabase.functions.invoke('send-push-notifications', {
    body: { action: 'test' },
  });
  if (error) throw error;
  if (!data?.sent) throw new Error(data?.error ?? 'The test notification could not be sent.');
}

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

export async function saveDailyCheckInReminderTime(clock: string) {
  parseReminderTime(clock);
  await AsyncStorage.setItem(DAILY_CHECK_IN_TIME_KEY, clock);
}

export async function getDailyCheckInReminderState(
  fallbackClock: string,
): Promise<DailyReminderState> {
  const [storedIdentifier, storedClock] = await Promise.all([
    AsyncStorage.getItem(DAILY_CHECK_IN_STORAGE_KEY),
    AsyncStorage.getItem(DAILY_CHECK_IN_TIME_KEY),
  ]);
  const clock = storedClock ?? fallbackClock;

  if (!storedIdentifier || Platform.OS === 'web') {
    return { enabled: false, clock };
  }

  const permissions = await Notifications.getPermissionsAsync();
  const isRemote = storedIdentifier.startsWith(REMOTE_IDENTIFIER_PREFIX);
  const isScheduled = isRemote || (await Notifications.getAllScheduledNotificationsAsync()).some(
    (notification) => notification.identifier === storedIdentifier,
  );

  if (!isPermissionAuthorized(permissions) || !isScheduled) {
    await cancelDailyCheckInReminder(storedIdentifier);
    return { enabled: false, clock };
  }

  return { enabled: true, clock };
}

export async function scheduleDailyCheckInReminder(
  clock: string,
): Promise<DailyReminderScheduleResult> {
  if (Platform.OS === 'web') {
    return { status: 'unsupported' };
  }

  const { hour, minute } = parseReminderTime(clock);
  const permissionGranted = await requestNotificationPermission();
  if (!permissionGranted) {
    return { status: 'denied' };
  }

  const previousIdentifier = await AsyncStorage.getItem(DAILY_CHECK_IN_STORAGE_KEY);
  try {
    const token = await upsertRemotePushDevice(clock);
    if (token) {
      const identifier = `${REMOTE_IDENTIFIER_PREFIX}${token}`;
      await AsyncStorage.multiSet([
        [DAILY_CHECK_IN_STORAGE_KEY, identifier],
        [DAILY_CHECK_IN_TIME_KEY, clock],
      ]);
      if (previousIdentifier && !previousIdentifier.startsWith(REMOTE_IDENTIFIER_PREFIX)) {
        await Notifications.cancelScheduledNotificationAsync(previousIdentifier).catch(() => undefined);
      }
      return { status: 'scheduled', identifier };
    }
  } catch {
    // Preserve the offline local reminder when remote registration is unavailable.
  }

  const content: Notifications.NotificationContentInput = {
    title: 'How did you sleep?',
    body: 'Take a minute to check in so your coach can refine your next step.',
    data: {
      destination: 'today',
      kind: 'daily-check-in',
    },
    sound: 'default',
  };

  const identifier =
    Platform.OS === 'ios'
      ? await Notifications.scheduleNotificationAsync({
          content,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
            hour,
            minute,
            repeats: true,
          },
        })
      : await Notifications.scheduleNotificationAsync({
          content,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            channelId: DAILY_CHECK_IN_CHANNEL_ID,
            hour,
            minute,
          },
        });

  try {
    await AsyncStorage.multiSet([
      [DAILY_CHECK_IN_STORAGE_KEY, identifier],
      [DAILY_CHECK_IN_TIME_KEY, clock],
    ]);
  } catch (error) {
    await Notifications.cancelScheduledNotificationAsync(identifier);
    throw error;
  }

  if (previousIdentifier &&
      previousIdentifier !== identifier &&
      !previousIdentifier.startsWith(REMOTE_IDENTIFIER_PREFIX)) {
    await Notifications.cancelScheduledNotificationAsync(previousIdentifier).catch(() => undefined);
  }

  return { status: 'scheduled', identifier };
}

export async function cancelDailyCheckInReminder(identifier?: string) {
  const storedIdentifier = await AsyncStorage.getItem(DAILY_CHECK_IN_STORAGE_KEY);
  const identifierToCancel = identifier ?? storedIdentifier;

  if (identifier && storedIdentifier !== identifier) {
    return;
  }

  if (identifierToCancel && !identifierToCancel.startsWith(REMOTE_IDENTIFIER_PREFIX)) {
    await Notifications.cancelScheduledNotificationAsync(identifierToCancel).catch(() => undefined);
  }
  await AsyncStorage.removeItem(DAILY_CHECK_IN_STORAGE_KEY);
  await disableRemotePushDevice();
}

export async function clearDailyCheckInReminder() {
  await cancelDailyCheckInReminder();
  await disableRemotePushDevice().catch(() => undefined);
  await AsyncStorage.removeItem(DAILY_CHECK_IN_TIME_KEY);
  await AsyncStorage.removeItem(EXPO_PUSH_TOKEN_KEY);
}
