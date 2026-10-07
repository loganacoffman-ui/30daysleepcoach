import { Platform } from 'react-native';
import { syncAppleHealthForDate } from '../healthkit/appleHealth';
import { syncHealthConnectForDate } from '../healthconnect/healthConnect';

export const syncDeviceSleepForDate = (userId: string, date?: string) =>
  Platform.OS === 'android'
    ? syncHealthConnectForDate(userId, date)
    : syncAppleHealthForDate(userId, date);
