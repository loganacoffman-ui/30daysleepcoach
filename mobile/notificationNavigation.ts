import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Subscribe after authentication/onboarding so a cold-start tap is kept until
// the user's daily view can actually be opened.
export function subscribeToDailyCheckInNotifications(openYourDay: () => void) {
  if (Platform.OS === 'web') return () => undefined;
  let lastHandled: string | null = null;
  const handle = (response: Notifications.NotificationResponse | null) => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const { request, date } = response.notification;
    const data = request.content.data;
    if (data?.kind !== 'daily-check-in' && data?.destination !== 'today') return;
    const key = `${request.identifier}:${date}`;
    if (lastHandled === key) return;
    lastHandled = key;
    openYourDay();
    Notifications.clearLastNotificationResponse();
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  handle(Notifications.getLastNotificationResponse());
  return () => subscription.remove();
}
