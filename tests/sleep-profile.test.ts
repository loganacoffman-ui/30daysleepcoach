import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { detectTimeZone, restoreOnboardingTimeZone, shiftClock, timeZoneOptions, validateSleepProfile } from '../mobile/onboarding/profileFields';
import { loadSleepProfile, saveSleepProfile } from '../mobile/onboarding/profileRepository';

const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../mobile/supabase', () => ({ supabase: { from: mock.from } }));
vi.mock('../mobile/sleep/sourcePreference', () => ({ loadPreferredSleepSource: async () => 'oura' }));

const user = { id: 'profile-owner' } as User;
const draft = { primaryConcern: 'unrefreshed' as const, typicalBedtime: '00:00', typicalWakeTime: '08:45', timezone: 'America/Los_Angeles' };
const row = { display_name: 'Sleeper', primary_concern: 'unrefreshed', typical_bedtime: '00:00:00', typical_wake_time: '08:45:00', timezone: draft.timezone, intake_answers: { reminder_time: '09:15', first_experiment: 'Morning walk' }, onboarding_completed_at: '2026-09-17T10:00:00Z' };
let query: { update: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; single: ReturnType<typeof vi.fn>; maybeSingle: ReturnType<typeof vi.fn> };

beforeEach(() => {
  query = { update: vi.fn(), select: vi.fn(), eq: vi.fn(), single: vi.fn().mockResolvedValue({ data: row, error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) };
  for (const method of ['update', 'select', 'eq'] as const) query[method].mockReturnValue(query);
  mock.from.mockReset().mockReturnValue(query);
});
afterEach(() => vi.restoreAllMocks());

describe('editable sleep profile persistence', () => {
  it('saves only editable fields for the signed-in user and reads the saved values back', async () => {
    expect(await saveSleepProfile(user, draft)).toEqual(draft);
    expect(query.update).toHaveBeenCalledWith({ primary_concern: 'unrefreshed', typical_bedtime: '00:00:00', typical_wake_time: '08:45:00', timezone: 'America/Los_Angeles' });
    expect(query.eq).toHaveBeenCalledWith('user_id', user.id);
    expect(await loadSleepProfile(user)).toEqual({ ...draft, displayName: 'Sleeper', preferredSleepSource: 'oura', reminderTime: '09:15', firstExperiment: 'Morning walk', onboardingCompletedAt: row.onboarding_completed_at });
  });

  it('does not report success on a denied, missing, or failed update', async () => {
    query.single.mockResolvedValueOnce({ data: null, error: new Error('Offline') });
    await expect(saveSleepProfile(user, draft)).rejects.toThrow('Offline');
    query.single.mockResolvedValueOnce({ data: null, error: null });
    await expect(saveSleepProfile(user, draft)).rejects.toThrow('could not be saved');
  });

  it.each([
    { ...draft, typicalBedtime: '24:00' },
    { ...draft, typicalWakeTime: '07:60' },
    { ...draft, timezone: 'Mars/Olympus' },
    { ...draft, primaryConcern: 'invalid' as never },
  ])('rejects invalid profile data before a database write: %j', async invalid => {
    await expect(saveSleepProfile(user, invalid)).rejects.toThrow();
    expect(mock.from).not.toHaveBeenCalled();
  });

  it('accepts overnight and daytime schedules and wraps adjustments across midnight', () => {
    expect(validateSleepProfile(draft)).toBeNull();
    expect(validateSleepProfile({ ...draft, typicalBedtime: '09:00', typicalWakeTime: '17:00' })).toBeNull();
    expect(shiftClock('23:45', 15)).toBe('00:00');
    expect(shiftClock('00:00', -15)).toBe('23:45');
    expect(shiftClock('08:45', 15)).toBe('09:00');
  });
});

describe('onboarding time zone detection and choices', () => {
  it('infers a device zone for new and legacy default-UTC profiles', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'Asia/Kathmandu' } as Intl.ResolvedDateTimeFormatOptions);
    expect(detectTimeZone()).toBe('Asia/Kathmandu');
    expect(restoreOnboardingTimeZone(undefined, undefined)).toBe('Asia/Kathmandu');
    expect(restoreOnboardingTimeZone(undefined, 'UTC')).toBe('Asia/Kathmandu');
  });

  it('preserves a deliberate override, including UTC, when resuming onboarding', () => {
    expect(restoreOnboardingTimeZone('UTC', 'America/Los_Angeles')).toBe('UTC');
    expect(restoreOnboardingTimeZone('Europe/Paris', 'UTC')).toBe('Europe/Paris');
    expect(restoreOnboardingTimeZone(undefined, 'Australia/Adelaide')).toBe('Australia/Adelaide');
    expect(restoreOnboardingTimeZone('invalid', 'Europe/London')).toBe('Europe/London');
  });

  it('falls back safely when device zone detection is unavailable', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => { throw new Error('Unavailable'); });
    expect(detectTimeZone()).toBe('UTC');
  });

  it('offers global zones, fractional offsets, UTC, and the current device alias', () => {
    const zones = timeZoneOptions('Asia/Kathmandu', 'America/Los_Angeles');
    expect(zones).toEqual(expect.arrayContaining(['UTC', 'Asia/Kathmandu', 'America/Los_Angeles', 'Australia/Adelaide', 'Pacific/Chatham', 'Europe/London']));
    expect(new Set(zones).size).toBe(zones.length);
  });
});
