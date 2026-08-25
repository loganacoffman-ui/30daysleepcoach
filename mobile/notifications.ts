import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const DAILY_CHECK_IN_CHANNEL_ID = 'daily-check-in';
const DAILY_CHECK_IN_STORAGE_KEY = '@30daysleepcoach/daily-check-in-notification-id';
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

  const [permissions, scheduledNotifications] = await Promise.all([
    Notifications.getPermissionsAsync(),
    Notifications.getAllScheduledNotificationsAsync(),
  ]);
  const isScheduled = scheduledNotifications.some(
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

  if (previousIdentifier && previousIdentifier !== identifier) {
    await Notifications.cancelScheduledNotificationAsync(previousIdentifier).catch(() => undefined);
  }

  return { status: 'scheduled', identifier };
}

export async function cancelDailyCheckInReminder(identifier?: string) {
  const storedIdentifier = await AsyncStorage.getItem(DAILY_CHECK_IN_STORAGE_KEY);
  const identifierToCancel = identifier ?? storedIdentifier;

  if (!identifierToCancel || (identifier && storedIdentifier !== identifier)) {
    return;
  }

  await Notifications.cancelScheduledNotificationAsync(identifierToCancel).catch(() => undefined);
  await AsyncStorage.removeItem(DAILY_CHECK_IN_STORAGE_KEY);
}

export async function clearDailyCheckInReminder() {
  await cancelDailyCheckInReminder();
  await AsyncStorage.removeItem(DAILY_CHECK_IN_TIME_KEY);
}
