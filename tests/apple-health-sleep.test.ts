import { describe, expect, it } from 'vitest';

import {
  aggregateSleepNight,
  sleepQueryWindow,
} from '../mobile/healthkit/sleepAggregation';
import type { HealthSleepSample } from '../mobile/healthkit/sleepAggregation';
import { calculateSleepCoachScore } from '../mobile/healthkit/sleepScore';
import {
  resolveWearableSleepHistory,
  selectWearableSleepForDate,
} from '../mobile/sleep/sourceSelection';

const sample = (
  uuid: string,
  value: number,
  start: string,
  end: string,
  sourceBundleIdentifier = 'com.apple.health',
): HealthSleepSample => ({
  uuid,
  value,
  startDate: new Date(start),
  endDate: new Date(end),
  sourceName: sourceBundleIdentifier === 'com.apple.health' ? 'Apple Watch' : 'Other',
  sourceBundleIdentifier,
});

describe('Apple Health nightly aggregation', () => {
  it('uses local noon-to-noon boundaries for the night ending on a date', () => {
    const window = sleepQueryWindow('2026-08-30');
    expect(window.start.getHours()).toBe(12);
    expect(window.end.getHours()).toBe(12);
    expect(window.start.getDate()).toBe(29);
    expect(window.end.getDate()).toBe(30);
  });

  it('does not double count in-bed and stage intervals', () => {
    const night = aggregateSleepNight([
      sample('in-bed', 0, '2026-08-30T05:00:00Z', '2026-08-30T13:00:00Z'),
      sample('awake', 2, '2026-08-30T05:00:00Z', '2026-08-30T05:30:00Z'),
      sample('core', 3, '2026-08-30T05:30:00Z', '2026-08-30T09:30:00Z'),
      sample('deep', 4, '2026-08-30T09:30:00Z', '2026-08-30T11:00:00Z'),
      sample('rem', 5, '2026-08-30T11:00:00Z', '2026-08-30T13:00:00Z'),
    ], '2026-08-30');

    expect(night).not.toBeNull();
    expect(night?.totalSleepMinutes).toBe(450);
    expect(night?.inBedMinutes).toBe(480);
    expect(night?.awakeMinutes).toBe(30);
    expect(night?.sleepScore).not.toBeNull();
  });

  it('selects the source with detailed stages instead of combining duplicate streams', () => {
    const night = aggregateSleepNight([
      sample('other-asleep', 1, '2026-08-30T04:00:00Z', '2026-08-30T13:00:00Z', 'com.other.sleep'),
      sample('apple-core', 3, '2026-08-30T05:00:00Z', '2026-08-30T10:00:00Z'),
      sample('apple-deep', 4, '2026-08-30T10:00:00Z', '2026-08-30T11:30:00Z'),
      sample('apple-rem', 5, '2026-08-30T11:30:00Z', '2026-08-30T13:00:00Z'),
    ], '2026-08-30');

    expect(night?.sourceBundleIdentifier).toBe('com.apple.health');
    expect(night?.totalSleepMinutes).toBe(480);
  });

  it('returns no nightly record when there is no principal sleep session', () => {
    expect(aggregateSleepNight([
      sample('nap', 3, '2026-08-29T20:00:00Z', '2026-08-29T21:00:00Z'),
    ], '2026-08-30')).toBeNull();
  });

  it('prefers the longest session over a staged daytime nap from the same source', () => {
    const night = aggregateSleepNight([
      sample('nap-core', 3, '2026-08-29T20:00:00Z', '2026-08-29T23:00:00Z'),
      sample('overnight', 1, '2026-08-30T04:00:00Z', '2026-08-30T12:00:00Z'),
    ], '2026-08-30');

    expect(night?.totalSleepMinutes).toBe(480);
    expect(night?.bedtimeStart).toBe('2026-08-30T04:00:00.000Z');
  });
});

describe('Sleep Coach score', () => {
  it('is bounded at 100 for ideal-or-higher inputs', () => {
    expect(calculateSleepCoachScore({
      asleepMinutes: 540,
      awakeMinutes: 0,
      inBedMinutes: 540,
      remMinutes: 120,
      deepMinutes: 90,
      stagedMinutes: 540,
    }).score).toBe(100);
  });

  it('does not invent a score without reliable staged sleep', () => {
    expect(calculateSleepCoachScore({
      asleepMinutes: 420,
      awakeMinutes: 30,
      inBedMinutes: 450,
      remMinutes: 0,
      deepMinutes: 0,
      stagedMinutes: 0,
    }).score).toBeNull();
  });
});

describe('wearable source selection', () => {
  const rows = [
    { day: '2026-08-30', score: 80, source: 'oura' as const },
    { day: '2026-08-30', score: 74, source: 'apple_health' as const },
    { day: '2026-08-29', score: 77, source: 'oura' as const },
  ];

  it('honors the preferred source for a date', () => {
    expect(selectWearableSleepForDate(rows, '2026-08-30', 'apple_health')?.score).toBe(74);
  });

  it('falls back when the preferred source has no score', () => {
    expect(selectWearableSleepForDate(rows, '2026-08-29', 'apple_health')?.source).toBe('oura');
  });

  it('resolves one score per day in newest-first order', () => {
    expect(resolveWearableSleepHistory(rows, 'apple_health')).toEqual([
      rows[1],
      rows[2],
    ]);
  });
});
