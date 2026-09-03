import { describe, expect, it } from 'vitest';

import { experimentInsights, feelingTrend, mergeSleepPoints, rollingDeltas } from '../mobile/progress/progressInsights';

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

  it('calculates score movement only after a meaningful baseline exists', () => {
    const result = rollingDeltas([
      { date: '2026-09-01', score: 70, source: 'manual' },
      { date: '2026-09-02', score: 80, source: 'manual' },
      { date: '2026-09-03', score: 84, source: 'manual' },
    ]);
    expect(result[1].delta).toBeNull();
    expect(result[2].delta).toBe(9);
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
});
