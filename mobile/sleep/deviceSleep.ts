import { Platform } from 'react-native';
import { syncAppleHealthForDate } from '../healthkit/appleHealth';
import { syncHealthConnectForDate } from '../healthconnect/healthConnect';
import { createAsyncMemo } from '../cache/asyncMemo';
import { localDateKey } from '../healthkit/sleepAggregation';

const sync = (userId: string, date: string) =>
  Platform.OS === 'android'
    ? syncHealthConnectForDate(userId, date)
    : syncAppleHealthForDate(userId, date);

const memo = createAsyncMemo<Awaited<ReturnType<typeof sync>>>(60_000);
export const syncDeviceSleepForDate = (userId: string, date = localDateKey()) =>
  memo.run(`${userId}:${date}`, () => sync(userId, date));
