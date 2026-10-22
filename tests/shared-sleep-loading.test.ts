import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { supabase } from '../mobile/supabase';
import { invalidateOuraSleep, loadOuraSleep } from '../mobile/oura/ouraSleep';
import { syncDeviceSleepForDate } from '../mobile/sleep/deviceSleep';
import { syncAppleHealthForDate } from '../mobile/healthkit/appleHealth';
import { syncHealthConnectForDate } from '../mobile/healthconnect/healthConnect';
import { Platform } from '../mobile/node_modules/react-native';
vi.mock('../mobile/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('../mobile/node_modules/react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../mobile/healthkit/appleHealth', () => ({ syncAppleHealthForDate: vi.fn() }));
vi.mock('../mobile/healthconnect/healthConnect', () => ({ syncHealthConnectForDate: vi.fn() }));
const invoke = vi.mocked(supabase.functions.invoke);
beforeEach(() => { vi.clearAllMocks(); invalidateOuraSleep(); });
afterEach(() => vi.useRealTimers());

it('shares Oura reads across callers, isolates accounts and rolls over at midnight', async () => {
  invoke.mockResolvedValue({ data: { data: [{ day: '2026-10-22', score: 81 }] }, error: null } as never);
  await Promise.all([loadOuraSleep('alice', '2026-10-22'), loadOuraSleep('alice', '2026-10-22')]);
  await loadOuraSleep('alice', '2026-10-22');
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0][1]?.body).toEqual({ endpoint: 'daily_sleep', start_date: '2026-09-17', end_date: '2026-10-22' });
  await loadOuraSleep('bob', '2026-10-22');
  await loadOuraSleep('alice', '2026-10-23');
  expect(invoke).toHaveBeenCalledTimes(3);
  invalidateOuraSleep();
  await loadOuraSleep('alice', '2026-10-23');
  expect(invoke).toHaveBeenCalledTimes(4);
});

it('expires successful Oura data and retries failures without caching an outage', async () => {
  vi.useFakeTimers();
  invoke.mockResolvedValue({ data: { data: [] }, error: null } as never);
  await loadOuraSleep('alice');
  await vi.advanceTimersByTimeAsync(60_000);
  invoke.mockResolvedValueOnce({ data: null, error: new Error('Unavailable') } as never);
  expect((await loadOuraSleep('alice')).error).toBeTruthy();
  expect((await loadOuraSleep('alice')).error).toBeNull();
  expect(invoke).toHaveBeenCalledTimes(3);
});

it('bounds slow Oura reads so manual check-in remains available', async () => {
  vi.useFakeTimers();
  invoke.mockImplementation((_name, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => reject(new Error('timeout')));
  }));
  const request = loadOuraSleep('slow-user');
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await request).toMatchObject({ data: null, error: expect.any(Error) });
});

it.each(['ios', 'android'])('shares %s sync in flight and for one minute, scoped to account and date', async os => {
  vi.useFakeTimers();
  Platform.OS = os as any;
  const native = vi.mocked(os === 'ios' ? syncAppleHealthForDate : syncHealthConnectForDate);
  let finish!: (result: any) => void;
  native.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  native.mockResolvedValue({ status: 'no_data' });
  const first = syncDeviceSleepForDate(os, '2026-10-22');
  await vi.advanceTimersByTimeAsync(65_000);
  const second = syncDeviceSleepForDate(os, '2026-10-22');
  expect(native).toHaveBeenCalledTimes(1);
  finish({ status: 'no_data' });
  await Promise.all([first, second]);
  await syncDeviceSleepForDate(os, '2026-10-22');
  expect(native).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  await syncDeviceSleepForDate(os, '2026-10-22');
  await syncDeviceSleepForDate(`${os}-other`, '2026-10-22');
  await syncDeviceSleepForDate(os, '2026-10-23');
  expect(native).toHaveBeenCalledTimes(4);
});
