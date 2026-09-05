import { describe, expect, it } from 'vitest';

import { experimentInsights, feelingTrend, mergeSleepPoints, rankSleepSignals, rollingDeltas, weeklyFeeling } from '../mobile/progress/progressInsights';

describe('progress intelligence', () => {
  it('prefers wearable scores and falls back to manual scores', () => {
    const points = mergeSleepPoints([
      { checkin_date: '2026-09-01', manual_sleep_score: 71, morningFeeling: 'tired', note: null, suspected_factor: null },
      { checkin_date: '2026-09-02', manual_sleep_score: 82, morningFeeling: 'rested', note: null, suspected_factor: null },
    ], [{ date: '2026-09-02', score: 88, source: 'oura' }]);
    expect(points.map(point => [point.date, point.score, point.source])).toEqual([
      ['2026-09-01', 71, 'manual'], ['2026-09-02', 88, 'oura'],
    ]);
  });

  it('uses the previous night until a seven-night baseline exists', () => {
    const result = rollingDeltas([
      { date: '2026-09-01', score: 70, source: 'manual' },
      { date: '2026-09-02', score: 80, source: 'manual' },
      { date: '2026-09-03', score: 84, source: 'manual' },
    ]);
    expect(result[0].delta).toBeNull();
    expect(result[1]).toMatchObject({ delta: 10, comparison: 'previous night' });
    expect(result[2]).toMatchObject({ delta: 4, comparison: 'previous night' });
  });

  it('uses the rolling seven-night average after seven prior scores', () => {
    const result = rollingDeltas([70, 72, 74, 76, 78, 80, 82, 84].map((score, index) => ({
      date: `2026-09-${String(index + 1).padStart(2, '0')}`,
      score,
      source: 'manual' as const,
    })));
    expect(result[7]).toMatchObject({ delta: 8, comparison: '7-night baseline' });
  });

  it('keeps experiments in learning until repeated outcomes exist', () => {
    const points = [
      { date: '2026-09-01', score: 70, source: 'manual' as const },
      { date: '2026-09-02', score: 72, source: 'manual' as const },
      { date: '2026-09-03', score: 82, source: 'manual' as const },
      { date: '2026-09-04', score: 84, source: 'manual' as const },
    ];
    const insight = experimentInsights([
      { behavior_date: '2026-09-02', behavior: 'Read for 15 minutes', status: 'completed' },
      { behavior_date: '2026-09-03', behavior: 'Read for 15 minutes', status: 'completed' },
    ], points)[0];
    expect(insight.verdict).toBe('Likely helpful');
    expect(insight.averageDelta).toBeGreaterThanOrEqual(3);
  });

  it('uses feeling categories only to describe direction', () => {
    const result = feelingTrend([
      { checkin_date: '2026-09-01', manual_sleep_score: null, morningFeeling: 'tired', note: null, suspected_factor: null },
      { checkin_date: '2026-09-02', manual_sleep_score: null, morningFeeling: 'okay', note: null, suspected_factor: null },
      { checkin_date: '2026-09-03', manual_sleep_score: null, morningFeeling: 'rested', note: null, suspected_factor: null },
      { checkin_date: '2026-09-04', manual_sleep_score: null, morningFeeling: 'great', note: null, suspected_factor: null },
    ]);
    expect(result).toEqual({ current: 'great', direction: 'up' });
  });

  it('summarizes the week rather than returning only the latest feeling', () => {
    const result = weeklyFeeling([
      { checkin_date: '2026-09-01', manual_sleep_score: null, morningFeeling: 'tired', note: null, suspected_factor: null },
      { checkin_date: '2026-09-02', manual_sleep_score: null, morningFeeling: 'okay', note: null, suspected_factor: null },
      { checkin_date: '2026-09-03', manual_sleep_score: null, morningFeeling: 'great', note: null, suspected_factor: null },
    ]);
    expect(result).toEqual({ feeling: 'okay', count: 3 });
  });

  it('promotes only repeated material factors into ranked signals', () => {
    const points = [70, 60, 72, 62].map((score, index) => ({ date: `2026-09-0${index + 1}`, score, source: 'manual' as const }));
    const checkins = [
      { checkin_date: '2026-09-02', manual_sleep_score: 60, morningFeeling: 'tired' as const, note: null, suspected_factor: 'late_meal' },
      { checkin_date: '2026-09-04', manual_sleep_score: 62, morningFeeling: 'tired' as const, note: null, suspected_factor: 'late_meal' },
      { checkin_date: '2026-09-03', manual_sleep_score: 72, morningFeeling: 'rested' as const, note: null, suspected_factor: 'noise' },
    ];
    expect(rankSleepSignals(checkins, [], points)).toEqual([expect.objectContaining({ label: 'late_meal', count: 2, averageDelta: -10, confidence: 'Early signal' })]);
  });
});
