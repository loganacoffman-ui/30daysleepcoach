import { beforeEach, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { SleepProfile } from '../mobile/onboarding/types';
import { supabase } from '../mobile/supabase';
import { invalidateCoachContext, loadDailyCoaching, localDate } from '../mobile/coach/coachRepository';

vi.mock('../mobile/supabase', () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('../mobile/node_modules/expo/fetch.js', () => ({ fetch: vi.fn() }));
vi.mock('../mobile/sleep/deviceSleep', () => ({ syncDeviceSleepForDate: vi.fn().mockResolvedValue({ status: 'unavailable' }) }));
vi.mock('../mobile/sleep/sourcePreference', () => ({
  isUnavailableSleepSchemaError: () => false,
  loadPreferredSleepSource: async () => 'oura',
}));

const user = { id: 'daily-user' } as User;
const profile = { primaryConcern: 'unrefreshed', typicalBedtime: '23:00', typicalWakeTime: '07:00', timezone: 'UTC' } as SleepProfile;
const report = { pattern: 'Pattern', meaning: 'Meaning', action: 'Dim lights', why: 'Wind down', generated_at: '2026-08-27T09:00:00Z' };
beforeEach(() => {
  vi.clearAllMocks();
  invalidateCoachContext(user.id);
  vi.mocked(supabase.from).mockImplementation(() => { throw new Error('Daily coaching must not preload client evidence'); });
  vi.mocked(supabase.functions.invoke).mockResolvedValue({
    data: { status: 'ok', recommendation: report }, error: null,
  } as never);
});

it('revalidates directly on the server without client context reads or forced regeneration', async () => {
  await loadDailyCoaching(user, profile, { freshSources: true });
  expect(await loadDailyCoaching(user, profile, { freshSources: true })).toEqual({
    pattern: report.pattern, meaning: report.meaning, action: report.action, why: report.why, generatedAt: report.generated_at,
  });
  const requests = vi.mocked(supabase.functions.invoke).mock.calls.filter(([name]) => name === 'sleep-coach');
  expect(requests).toHaveLength(2);
  expect(requests[0][1]?.body).toMatchObject({ refresh: false, coachContext: { date: localDate() } });
  expect(requests[1][1]?.body).toMatchObject({ refresh: false, coachContext: { date: localDate() } });
  expect(supabase.from).not.toHaveBeenCalled();
  expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
});

it('only forces regeneration for an explicit refresh, still without preloading evidence', async () => {
  await loadDailyCoaching(user, profile, { refresh: true });
  expect(supabase.functions.invoke).toHaveBeenCalledWith('sleep-coach', {
    body: { mode: 'daily_coach', refresh: true, coachContext: { date: localDate() } },
  });
  expect(supabase.from).not.toHaveBeenCalled();
});

it('serializes overlapping requests so later evidence is checked after the first result is saved', async () => {
  const invoke = vi.mocked(supabase.functions.invoke);
  const original = invoke.getMockImplementation()!;
  let release!: () => void;
  let held = false;
  invoke.mockImplementation(async (...args) => {
    if (args[0] === 'sleep-coach' && !held) {
      held = true;
      await new Promise<void>(resolve => { release = resolve; });
    }
    return original(...args);
  });
  const requests = () => invoke.mock.calls.filter(([name]) => name === 'sleep-coach');
  const first = loadDailyCoaching(user, profile, { freshSources: true });
  await vi.waitFor(() => expect(requests()).toHaveLength(1));
  const second = loadDailyCoaching(user, profile, { freshSources: true });
  // Let context loads and invoke settle if a second request incorrectly starts.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(requests()).toHaveLength(1);
  release();
  await Promise.all([first, second]);
  expect(requests()).toHaveLength(2);
  expect(requests()[0][1]?.body).toMatchObject({ refresh: false, coachContext: { date: localDate() } });
  expect(requests()[1][1]?.body).toMatchObject({ refresh: false, coachContext: { date: localDate() } });
});

it('allows a queued retry after a failed request without forcing regeneration', async () => {
  const invoke = vi.mocked(supabase.functions.invoke);
  const original = invoke.getMockImplementation()!;
  let fail!: () => void;
  let held = false;
  invoke.mockImplementation(async (...args) => {
    if (args[0] === 'sleep-coach' && !held) {
      held = true;
      await new Promise<void>((_resolve, reject) => { fail = () => reject(new Error('Connection lost')); });
    }
    return original(...args);
  });
  const first = loadDailyCoaching(user, profile, { freshSources: true }).catch(error => error);
  await vi.waitFor(() => expect(held).toBe(true));
  const retry = loadDailyCoaching(user, profile, { freshSources: true });
  fail();
  expect(await first).toMatchObject({ message: 'Connection lost' });
  expect(await retry).toMatchObject({ action: report.action });
  const requests = invoke.mock.calls.filter(([name]) => name === 'sleep-coach');
  expect(requests).toHaveLength(2);
  expect(requests[1][1]?.body).toMatchObject({ refresh: false });
});
