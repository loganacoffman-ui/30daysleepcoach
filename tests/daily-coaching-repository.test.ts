import { beforeEach, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { SleepProfile } from '../mobile/onboarding/types';
import { supabase } from '../mobile/supabase';
import { invalidateCoachContext, loadDailyCoaching, localDate } from '../mobile/coach/coachRepository';

vi.mock('../mobile/supabase', () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('../mobile/node_modules/expo/fetch.js', () => ({ fetch: vi.fn() }));
vi.mock('../mobile/healthkit/appleHealth', () => ({ syncAppleHealthForDate: vi.fn().mockResolvedValue({ status: 'unavailable' }) }));
vi.mock('../mobile/sleep/sourcePreference', () => ({
  isUnavailableSleepSchemaError: () => false,
  loadPreferredSleepSource: async () => 'oura',
}));

const user = { id: 'daily-user' } as User;
const profile = { primaryConcern: 'unrefreshed', typicalBedtime: '23:00', typicalWakeTime: '07:00', timezone: 'UTC' } as SleepProfile;
const report = { pattern: 'Pattern', meaning: 'Meaning', action: 'Dim lights', why: 'Wind down', generated_at: '2026-08-27T09:00:00Z' };
let score = 79;
let checkins: Record<string, unknown>[] = [];
const adherenceQueries: { gte?: string; lte?: string; limit?: number }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  invalidateCoachContext(user.id);
  score = 79;
  checkins = [];
  adherenceQueries.length = 0;
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const filters: typeof adherenceQueries[number] = {};
    if (table === 'behavior_commitments') adherenceQueries.push(filters);
    const query = {
      select: () => query, eq: () => query, order: () => query,
      gte: (_column: string, value: string) => { filters.gte = value; return query; },
      lte: (_column: string, value: string) => { filters.lte = value; return query; },
      limit: (count: number) => { filters.limit = count; return query; },
      then: (resolve: (value: unknown) => unknown) => resolve({ data: table === 'daily_checkins' ? checkins : [], error: null }),
    };
    return query as never;
  });
  vi.mocked(supabase.functions.invoke).mockImplementation(async (name: string) => ({
    data: name === 'oura-proxy' ? { data: [{ day: localDate(), score }] } : { status: 'ok', recommendation: report },
    error: null,
  }) as never);
});

it('revalidation bypasses the source memo without forcing regeneration', async () => {
  await loadDailyCoaching(user, profile, { freshSources: true });
  score = 88;
  expect(await loadDailyCoaching(user, profile, { freshSources: true })).toEqual({
    pattern: report.pattern, meaning: report.meaning, action: report.action, why: report.why, generatedAt: report.generated_at,
  });
  const requests = vi.mocked(supabase.functions.invoke).mock.calls.filter(([name]) => name === 'sleep-coach');
  expect(requests).toHaveLength(2);
  expect(requests[0][1]?.body).toMatchObject({ refresh: false, coachContext: { wearable_sleep: [{ day: localDate(), score: 79, source: 'oura' }] } });
  expect(requests[1][1]?.body).toMatchObject({ refresh: false, coachContext: { wearable_sleep: [{ day: localDate(), score: 88, source: 'oura' }] } });
  // A generated commitment cannot displace a prior row at a row-count limit.
  expect(adherenceQueries).toHaveLength(2);
  expect(adherenceQueries[0]).toEqual({ gte: expect.any(String), lte: localDate() });
});

it('preserves manual reports alongside wearable evidence during revalidation', async () => {
  checkins = [{ checkin_date: localDate(), manual_sleep_score: 60, manual_sleep_submitted_at: '2026-08-27T09:00:00Z', note: 'Restless night' }];
  await loadDailyCoaching(user, profile, { freshSources: true });
  const request = vi.mocked(supabase.functions.invoke).mock.calls.find(([name]) => name === 'sleep-coach');
  expect(request?.[1]?.body).toMatchObject({ refresh: false, coachContext: { subjective_checkins: [expect.objectContaining({ manual_sleep_score: 60, note: 'Restless night' })], wearable_sleep: [{ day: localDate(), score: 79, source: 'oura' }] } });
});
