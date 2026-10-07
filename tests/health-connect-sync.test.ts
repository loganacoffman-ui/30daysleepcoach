import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  storage: new Map<string, string>(), user: 'user-1', os: 'android',
  status: vi.fn(), initialize: vi.fn(), granted: vi.fn(), request: vi.fn(), read: vi.fn(),
  upsert: vi.fn(), remove: vi.fn(), filters: [] as [string, unknown][],
}));
vi.mock('../mobile/node_modules/react-native', () => ({ Platform: { get OS() { return state.os; } } }));
vi.mock('../mobile/node_modules/@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => state.storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { state.storage.set(key, value); },
  removeItem: async (key: string) => { state.storage.delete(key); },
} }));
vi.mock('../mobile/node_modules/react-native-health-connect', () => ({
  getSdkStatus: state.status, SdkAvailabilityStatus: { SDK_AVAILABLE: 3 }, initialize: state.initialize,
  getGrantedPermissions: state.granted, requestPermission: state.request, readRecords: state.read, openHealthConnectSettings: vi.fn(),
}));
vi.mock('../mobile/sleep/sourcePreference', () => ({
  clearPreferredSleepSource: vi.fn(), loadPreferredSleepSource: async () => null, savePreferredSleepSource: vi.fn(),
}));
vi.mock('../mobile/supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: state.user } } } }) },
  from: () => {
    const query = { delete: () => { state.remove(); return query; },
      eq: (key: string, value: unknown) => { state.filters.push([key, value]); return query; },
      upsert: state.upsert, then: (resolve: Function) => resolve({ error: null }),
    }; return query;
  },
} }));
import { connectHealthConnect, disableHealthConnect, syncHealthConnectForDate } from '../mobile/healthconnect/healthConnect';
import { sleepQueryWindow } from '../mobile/healthkit/sleepAggregation';
const enabled = 'sleep-coach:health-connect-enabled:user-1';
const permission = [{ accessType: 'read', recordType: 'SleepSession' }];
beforeEach(() => {
  vi.clearAllMocks(); state.storage.clear(); state.storage.set(enabled, 'true'); state.user = 'user-1'; state.os = 'android'; state.filters = [];
  state.status.mockResolvedValue(3); state.initialize.mockResolvedValue(true);
  state.granted.mockResolvedValue(permission); state.request.mockResolvedValue(permission);
  state.read.mockResolvedValue({ records: [] }); state.upsert.mockResolvedValue({ error: null });
});
it('does not read or write after sleep permission is revoked', async () => {
  state.granted.mockResolvedValue([]);
  expect(await syncHealthConnectForDate('user-1')).toEqual({ status: 'denied' });
  expect(state.read).not.toHaveBeenCalled(); expect(state.remove).not.toHaveBeenCalled(); expect(state.upsert).not.toHaveBeenCalled();
});
it('does not persist opt-in when permission is denied', async () => {
  state.storage.clear(); state.request.mockResolvedValue([]);
  expect(await connectHealthConnect('user-1')).toEqual({ status: 'denied' });
  expect(state.storage.has(enabled)).toBe(false);
});
it('does not read another signed-in account’s device health data', async () => {
  state.user = 'other'; await expect(syncHealthConnectForDate('user-1')).rejects.toThrow('Sign in again');
  expect(state.read).not.toHaveBeenCalled();
});
it('uses all pages, saves normalized stages, and scopes writes to the account and source', async () => {
  const date = '2026-10-01'; const start = sleepQueryWindow(date).start.getTime();
  const time = (hours: number) => new Date(start + hours * 3600000).toISOString();
  state.read.mockResolvedValueOnce({ records: [], pageToken: 'next' }).mockResolvedValueOnce({ records: [{
    startTime: time(10), endTime: time(18), metadata: { id: 'session', dataOrigin: 'com.fitbit.FitbitMobile' },
    stages: [{ startTime: time(10), endTime: time(14), stage: 4 }, { startTime: time(14), endTime: time(16), stage: 5 }, { startTime: time(16), endTime: time(18), stage: 6 }],
  }] });
  expect((await syncHealthConnectForDate('user-1', date)).status).toBe('synced');
  expect(state.read.mock.calls[1][1].pageToken).toBe('next');
  expect(state.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1', provider: 'health_connect', total_sleep_minutes: 480 }), { onConflict: 'user_id,provider,sleep_date' });
  expect(state.upsert.mock.calls[0][0]).not.toHaveProperty('stages');
});
it('does not delete existing data if reading fails partway through pagination', async () => {
  state.read.mockResolvedValueOnce({ records: [], pageToken: 'next' }).mockRejectedValueOnce(new Error('offline'));
  await expect(syncHealthConnectForDate('user-1')).rejects.toThrow('offline');
  expect(state.remove).not.toHaveBeenCalled();
});
it('removes stale imported nights after a successful empty read', async () => {
  expect((await syncHealthConnectForDate('user-1')).status).toBe('no_data');
  expect(state.remove).toHaveBeenCalledTimes(3);
  expect(state.filters).toContainEqual(['provider', 'health_connect']);
  expect(state.filters).toContainEqual(['user_id', 'user-1']);
});
it('serializes disconnect behind a sync, then prevents queued sync from recreating rows', async () => {
  let finish!: (value: unknown) => void;
  state.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const reading = syncHealthConnectForDate('user-1');
  await vi.waitFor(() => expect(state.read).toHaveBeenCalled());
  const disconnect = disableHealthConnect('user-1');
  const after = syncHealthConnectForDate('user-1');
  finish({ records: [] });
  await reading; await disconnect;
  expect(await after).toEqual({ status: 'disabled' });
  expect(state.storage.has(enabled)).toBe(false);
  expect(state.read).toHaveBeenCalledTimes(1);
});
