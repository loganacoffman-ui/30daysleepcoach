import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  permissions: vi.fn(), requestPermissions: vi.fn(), token: vi.fn(), cancelLocal: vi.fn(),
  channel: vi.fn(), from: vi.fn(), getSession: vi.fn(), os: 'ios',
}));
vi.mock('../mobile/node_modules/@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => mock.storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { mock.storage.set(key, value); },
  removeItem: async (key: string) => { mock.storage.delete(key); },
  multiSet: async (entries: [string, string][]) => { entries.forEach(([key, value]) => mock.storage.set(key, value)); },
  multiRemove: async (keys: string[]) => { keys.forEach(key => mock.storage.delete(key)); },
} }));
vi.mock('../mobile/node_modules/react-native', () => ({ Platform: { get OS() { return mock.os; } } }));
vi.mock('../mobile/node_modules/expo-constants', () => ({ default: { expoConfig: { extra: { eas: { projectId: 'project' }, appVariant: 'production' } } } }));
vi.mock('../mobile/node_modules/expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  getPermissionsAsync: mock.permissions, requestPermissionsAsync: mock.requestPermissions,
  getExpoPushTokenAsync: mock.token, cancelScheduledNotificationAsync: mock.cancelLocal,
  setNotificationChannelAsync: mock.channel, AndroidImportance: { HIGH: 4 },
  IosAuthorizationStatus: { AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
}));
vi.mock('../mobile/supabase', () => ({ supabase: { from: mock.from, auth: { getSession: mock.getSession } } }));

import { cancelDailyCheckInReminder, clearDailyCheckInReminder, getDailyCheckInReminderState, scheduleDailyCheckInReminder, syncDailyCheckInReminder } from '../mobile/notifications';

const legacyKey = '@30daysleepcoach/daily-check-in-notification-id';
const timeKey = '@30daysleepcoach/daily-check-in-time';
const deviceKey = '@30daysleepcoach/push-device';
let query: ReturnType<typeof makeQuery>;
function makeQuery() {
  const query = {
    update: vi.fn(), upsert: vi.fn(), delete: vi.fn(), select: vi.fn(), eq: vi.fn(),
    single: vi.fn().mockResolvedValue({ data: { id: 'device' }, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'device', enabled: true, reminder_time: '08:15:00' }, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  for (const key of ['update', 'upsert', 'delete', 'select', 'eq'] as const) query[key].mockReturnValue(query);
  return query;
}
function registered() { mock.storage.set(deviceKey, JSON.stringify({ id: 'device', userId: 'user' })); mock.storage.set(timeKey, '08:15'); }

beforeEach(() => {
  vi.clearAllMocks();
  mock.storage.clear();
  mock.os = 'ios';
  mock.permissions.mockResolvedValue({ granted: true, ios: { status: 2 } });
  mock.token.mockResolvedValue({ data: 'ExpoPushToken[token]' });
  mock.cancelLocal.mockResolvedValue(undefined);
  mock.getSession.mockResolvedValue({ data: { session: { user: { id: 'user' } } }, error: null });
  query = makeQuery();
  mock.from.mockReturnValue(query);
});

describe('mobile check-in push registration', () => {
  it('registers the account, local timezone, and clock for server-side completion checks', async () => {
    expect(await scheduleDailyCheckInReminder('08:15')).toEqual({ status: 'scheduled', identifier: 'device' });
    expect(mock.token).toHaveBeenCalledWith({ projectId: 'project' });
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user', expo_push_token: 'ExpoPushToken[token]', reminder_time: '08:15', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, enabled: true }), { onConflict: 'expo_push_token' });
    expect(JSON.parse(mock.storage.get(deviceKey)!)).toEqual({ id: 'device', userId: 'user' });
  });

  it('migrates existing reminders without a permission prompt and cancels unconditional local delivery', async () => {
    mock.storage.set(legacyKey, 'old-local'); mock.storage.set(timeKey, '09:30');
    await syncDailyCheckInReminder('user', '07:30');
    expect(mock.cancelLocal).toHaveBeenCalledWith('old-local');
    expect(mock.requestPermissions).not.toHaveBeenCalled();
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ reminder_time: '09:30' }), expect.anything());
    expect(mock.storage.has(legacyKey)).toBe(false);
  });

  it('keeps migration intent for retry when offline, but stops the old local reminder first', async () => {
    mock.storage.set(legacyKey, 'old-local');
    mock.token.mockRejectedValueOnce(new Error('Offline'));
    await expect(syncDailyCheckInReminder('user', '07:30')).rejects.toThrow('Offline');
    expect(mock.cancelLocal).toHaveBeenCalledWith('old-local');
    expect(mock.storage.get(legacyKey)).toBe('old-local');
    await syncDailyCheckInReminder('user', '07:30');
    expect(mock.storage.has(legacyKey)).toBe(false);
  });

  it('does not opt users in during foreground refresh or reuse another account’s opt-in', async () => {
    await syncDailyCheckInReminder('user', '07:30');
    registered();
    await syncDailyCheckInReminder('another-user', '07:30');
    expect(mock.token).not.toHaveBeenCalled();
  });

  it('updates the same row on token or clock changes without resetting daily delivery history', async () => {
    registered();
    await scheduleDailyCheckInReminder('09:00');
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ reminder_time: '09:00' }));
    expect(query.update.mock.calls[0][0]).not.toHaveProperty('last_sent_local_date');
    expect(query.eq).toHaveBeenCalledWith('id', 'device');
    expect(query.upsert).not.toHaveBeenCalled();
  });

  it('uses a rotated native token directly instead of requesting another native token', async () => {
    registered();
    const devicePushToken = { type: 'ios' as const, data: 'rotated-token' };
    await syncDailyCheckInReminder('user', '07:30', devicePushToken);
    expect(mock.token).toHaveBeenCalledWith({ projectId: 'project', devicePushToken });
  });

  it('can recreate a server registration removed since this device last opened', async () => {
    registered();
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await scheduleDailyCheckInReminder('08:15')).toEqual({ status: 'scheduled', identifier: 'device' });
    expect(query.upsert).toHaveBeenCalled();
  });

  it('reports the server registration state rather than looking for a local schedule', async () => {
    registered();
    expect(await getDailyCheckInReminderState('07:30')).toEqual({ enabled: true, clock: '08:15' });
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await getDailyCheckInReminderState('07:30')).toEqual({ enabled: false, clock: '08:15' });
  });

  it('disables remote delivery when OS permission is revoked', async () => {
    registered(); mock.permissions.mockResolvedValue({ granted: false, ios: { status: 1 } });
    expect(await getDailyCheckInReminderState('07:30')).toEqual({ enabled: false, clock: '08:15' });
    expect(query.delete).toHaveBeenCalled();
    expect(mock.storage.has(deviceKey)).toBe(false);
  });

  it('waits for an in-flight registration before signing out and leaves no enabled device', async () => {
    let resolveToken!: (token: { data: string }) => void;
    mock.token.mockReturnValueOnce(new Promise(resolve => { resolveToken = resolve; }));
    const scheduled = scheduleDailyCheckInReminder('08:15');
    const cleared = clearDailyCheckInReminder();
    await vi.waitFor(() => expect(mock.token).toHaveBeenCalled());
    resolveToken({ data: 'ExpoPushToken[token]' });
    await Promise.all([scheduled, cleared]);
    expect(query.delete).toHaveBeenCalled();
    expect(mock.storage.size).toBe(0);
    await syncDailyCheckInReminder('user', '07:30');
    expect(mock.token).toHaveBeenCalledTimes(1);
  });

  it('only rolls back the registration matching the supplied identifier', async () => {
    registered();
    await cancelDailyCheckInReminder('some-old-id');
    expect(query.delete).not.toHaveBeenCalled();
    await cancelDailyCheckInReminder('device');
    expect(query.delete).toHaveBeenCalled();
    expect(mock.storage.get(timeKey)).toBe('08:15');
  });

  it('does not persist an enabled preference when registration fails', async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error('Database unavailable') });
    await expect(scheduleDailyCheckInReminder('08:15')).rejects.toThrow('Database unavailable');
    expect(mock.storage.has(deviceKey)).toBe(false);
  });

  it('returns denied or unsupported without registering and prepares the Android channel before its token', async () => {
    mock.permissions.mockResolvedValueOnce({ granted: false, ios: { status: 1 } });
    mock.requestPermissions.mockResolvedValueOnce({ granted: false, ios: { status: 1 } });
    expect(await scheduleDailyCheckInReminder('08:15')).toEqual({ status: 'denied' });
    mock.os = 'web';
    expect(await scheduleDailyCheckInReminder('08:15')).toEqual({ status: 'unsupported' });
    expect(mock.token).not.toHaveBeenCalled();
    mock.os = 'android';
    await scheduleDailyCheckInReminder('08:15');
    expect(mock.channel).toHaveBeenCalledWith('daily-check-in', expect.anything());
    expect(mock.channel.mock.invocationCallOrder[0]).toBeLessThan(mock.token.mock.invocationCallOrder[0]);
  });
});
