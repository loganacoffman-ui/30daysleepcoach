import { expect, it } from 'vitest';
import { withDailySleepSummary } from '../supabase/functions/_shared/dailyCoachingContext';

it('calculates a seven-night range without inventing a narrower trend', () => {
  const context = withDailySleepSummary({ date: '2026-09-23', wearable_sleep: [77, 78, 76, 69, 65, 63, 64].map((score, i) => ({ day: `2026-09-${17+i}`, source: 'oura', score })) });
  expect(context.sleep_summary.by_source[0]).toMatchObject({ nights: 7, min_score: 63, max_score: 78, mean_score: 70.3, first: { score: 77 }, latest: { score: 64 } });
});
it('never combines provider/version changes, manual ratings or invalid scores into a wearable trend', () => {
  const context = withDailySleepSummary({ date: '2026-09-23', subjective_checkins: [{ manual_sleep_score: 10 }], wearable_sleep: [
    { day: '2026-09-17', source: 'oura', score: 80 },
    { day: '2026-09-21', source: 'apple_health', scoreVersion: 'v1', score: 60 },
    { day: '2026-09-22', source: 'apple_health', scoreVersion: 'v2', score: 70 },
    { day: '2026-09-23', source: 'apple_health', scoreVersion: 'v2', score: 72 },
    { day: '2026-09-23', source: 'apple_health', scoreVersion: 'v2', score: 72 },
    { day: '2026-09-24', source: 'oura', score: 20 },
    { day: '2026-09-15', source: 'oura', score: 30 },
    { day: '2026-09-20', source: 'oura', score: 101 },
  ] });
  expect(context.sleep_summary.by_source).toHaveLength(3);
  expect(context.sleep_summary.by_source.find(row => row.score_version === 'v2')).toMatchObject({ nights: 2, min_score: 70, max_score: 72 });
});

it('renders exact source-separated facts, including conflicting manual ratings', async () => {
  const { groundedDailyPattern } = await import('../supabase/functions/_shared/dailyCoachingContext');
  const base = { date: '2026-09-23', wearable_sleep: [
    { day: '2026-09-21', source: 'oura', score: 85 },
    { day: '2026-09-22', source: 'apple_health', score: 62 },
    { day: '2026-09-23', source: 'apple_health', score: 64 },
  ], sleep_resolution: { source: 'apple_health', score: 64, manual: null } };
  expect(groundedDailyPattern(base)).toBe('Sleep Coach scored 64; 2 comparable nights ranged from 62 to 64.');
  expect(groundedDailyPattern({ ...base, sleep_resolution: { source: 'apple_health', score: 64, manual: { score: 35 } } }))
    .toBe('Sleep Coach scored 64; your own sleep rating was 35.');
  expect(groundedDailyPattern({ ...base, sleep_resolution: { source: 'manual', score: 0 } }))
    .toBe('You rated your sleep 0/100; this is a self-reported score.');
});
