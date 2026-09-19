import { beforeEach, expect, it, vi } from 'vitest';
import { createSupabaseTodayRepository } from '../mobile/today/supabaseTodayRepository';
import { resolveSleep, sleepResolutionKey } from '../mobile/sleep/dailySleepContract';
import { DAILY_COACH_PROMPT_VERSION } from '../supabase/functions/_shared/coaching-cache';

const state = vi.hoisted(() => ({ checkin: null as any, wearable: null as any, recommendation: null as any, writes: [] as any[] }));
vi.mock('../mobile/coach/coachRepository', () => ({ invalidateCoachContext: vi.fn() }));
vi.mock('../mobile/healthkit/appleHealth', () => ({ syncAppleHealthForDate: vi.fn().mockResolvedValue(null) }));
vi.mock('../mobile/sleep/sourcePreference', () => ({ loadPreferredSleepSource: async () => null, isUnavailableSleepSchemaError: () => false }));
vi.mock('../mobile/supabase', () => ({ supabase: {
  functions: { invoke: async () => ({ data: { data: state.wearable ? [state.wearable] : [] } }) },
  from: (table: string) => {
    const query: any = {
      select: () => query, eq: () => query, lt: () => query, order: () => query, limit: () => query, maybeSingle: () => query, single: () => query,
      upsert: (record: any) => { state.writes.push({ table, record }); return query; },
      then: (resolve: any) => resolve({ data: table === 'daily_checkins' ? state.checkin : table === 'coach_recommendations' ? state.recommendation : null, error: null, count: 1 }),
    };
    return query;
  },
} }));
const repository = createSupabaseTodayRepository({ id: 'u' } as any, undefined, 'unrefreshed' as any);
const date = new Date().toLocaleDateString('en-CA');
beforeEach(() => {
  state.checkin = { id: 'c', checkin_date: date, manual_sleep_score: 62, manual_sleep_submitted_at: new Date().toISOString(), morning_feeling: 'tired' };
  state.wearable = null; state.writes = [];
  state.recommendation = { pattern: 'Pattern', meaning: 'Meaning', action: 'Action', prompt_version: DAILY_COACH_PROMPT_VERSION,
    source_context: { sleep_resolution_key: sleepResolutionKey(resolveSleep(date, [], state.checkin)) } };
});
it('keeps unchanged manual coaching but hides it after a wearable arrives, retaining the manual entry', async () => {
  expect((await repository.loadToday()).dailyCoaching?.action).toBe('Action');
  state.wearable = { day: date, score: 85, source: 'oura' };
  const snapshot = await repository.loadToday();
  expect(snapshot.dailyCoaching).toBeNull();
  expect(snapshot.checkin?.manualSleepScore).toBe(62);
  expect(snapshot.syncedSleep?.score).toBe(85);
  expect(state.writes.filter(write => write.table === 'daily_checkins')).toEqual([]);
});
it('hides cached advice without sleep evidence, and advice generated before the new contract', async () => {
  state.checkin = null;
  expect((await repository.loadToday()).dailyCoaching).toBeNull();
  state.wearable = { day: date, score: 85 };
  state.recommendation.prompt_version = 'old';
  expect((await repository.loadToday()).dailyCoaching).toBeNull();
});
it('saving a qualitative check-in does not erase an earlier manual record', async () => {
  await repository.saveCheckin({ morningFeeling: 'tired', suspectedFactor: '', note: 'Restless' } as any);
  const write = state.writes.find(write => write.table === 'daily_checkins').record;
  expect(write).not.toHaveProperty('manual_sleep_score');
  expect(write).not.toHaveProperty('manual_sleep_submitted_at');
});
