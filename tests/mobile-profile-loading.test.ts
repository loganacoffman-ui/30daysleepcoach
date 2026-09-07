import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../mobile/node_modules/@supabase/supabase-js';

const mocks = vi.hoisted(() => ({ read: vi.fn(), localSource: vi.fn(), select: vi.fn() }));
vi.mock('../mobile/supabase', () => ({
  supabase: { from: () => ({ select: (columns: string) => {
    mocks.select(columns);
    return { eq: () => ({ maybeSingle: mocks.read }) };
  } }) },
}));
vi.mock('../mobile/sleep/sourcePreference', () => ({
  asSleepSource: (source: unknown) => source === 'oura' || source === 'apple_health' ? source : null,
  loadLocalPreferredSleepSource: mocks.localSource,
  isUnavailableSleepSchemaError: (error: { code: string }) => error.code === '42703',
}));
import { loadSleepProfile } from '../mobile/onboarding/profileRepository';

const user = { id: 'user-1' } as User;
const row = {
  display_name: 'Test', primary_concern: 'night_waking', typical_bedtime: '22:00:00',
  typical_wake_time: '06:00:00', timezone: 'America/Los_Angeles', intake_answers: {},
  onboarding_completed_at: '2026-08-30', preferred_sleep_source: 'oura',
};
beforeEach(() => { vi.resetAllMocks(); mocks.localSource.mockResolvedValue('apple_health'); });

describe('profile loading after login', () => {
  it('loads profile and remote source in one request', async () => {
    mocks.read.mockResolvedValue({ data: row, error: null });
    await expect(loadSleepProfile(user)).resolves.toMatchObject({ preferredSleepSource: 'oura', displayName: 'Test' });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.select).toHaveBeenCalledWith(expect.stringContaining('preferred_sleep_source'));
  });

  it('uses the local source preference when the remote value is empty', async () => {
    mocks.read.mockResolvedValue({ data: { ...row, preferred_sleep_source: null }, error: null });
    await expect(loadSleepProfile(user)).resolves.toMatchObject({ preferredSleepSource: 'apple_health' });
  });

  it.each([null, { ...row, onboarding_completed_at: null }])('returns onboarding only after a successful missing/incomplete profile read', async data => {
    mocks.read.mockResolvedValue({ data, error: null });
    await expect(loadSleepProfile(user)).resolves.toBeNull();
  });

  it('rejects a failed request instead of reporting missing onboarding', async () => {
    mocks.read.mockResolvedValue({ data: null, error: { message: 'Service unavailable', code: '503' } });
    await expect(loadSleepProfile(user)).rejects.toMatchObject({ message: 'Service unavailable' });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    mocks.read.mockResolvedValue({ data: row, error: null });
    await expect(loadSleepProfile(user)).resolves.toMatchObject({ displayName: 'Test' });
  });

  it('retains compatibility with the older profile schema', async () => {
    mocks.read.mockResolvedValueOnce({ data: null, error: { code: '42703' } })
      .mockResolvedValueOnce({ data: { ...row, preferred_sleep_source: undefined }, error: null });
    await expect(loadSleepProfile(user)).resolves.toMatchObject({ preferredSleepSource: 'apple_health' });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.select.mock.calls[1][0]).not.toContain('preferred_sleep_source');
  });
});
