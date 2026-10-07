import { describe, expect, it } from 'vitest';
import { healthConnectSleepSamples } from '../mobile/healthconnect/sleepAdapter';
import { aggregateSleepNight, sleepQueryWindow } from '../mobile/healthkit/sleepAggregation';
import { selectWearableSleepForDate } from '../mobile/sleep/sourceSelection';
import type { RecordResult } from '../mobile/node_modules/react-native-health-connect';
const day = '2026-10-06';
const start = sleepQueryWindow(day).start.getTime();
const time = (h: number) => new Date(start + h * 3600000).toISOString();
const session = (origin = 'com.fitbit.FitbitMobile'): RecordResult<'SleepSession'> => ({
  startTime: time(10), endTime: time(19), metadata: { id: origin, dataOrigin: origin },
  stages: [
    { startTime: time(10), endTime: time(11), stage: 1 },
    { startTime: time(11), endTime: time(15), stage: 4 },
    { startTime: time(15), endTime: time(17), stage: 5 },
    { startTime: time(17), endTime: time(19), stage: 6 },
  ],
});
describe('Health Connect sleep normalization', () => {
  it('maps Pixel Watch stages and excludes awake time from sleep', () => {
    const night = aggregateSleepNight(healthConnectSleepSamples([session()]), day)!;
    expect(night).toMatchObject({ totalSleepMinutes: 480, awakeMinutes: 60, coreMinutes: 240, deepMinutes: 120, remMinutes: 120 });
    expect(night.sleepScore).toBeGreaterThan(0);
  });
  it('does not double count duplicate sessions or multiple source apps', () => {
    const one = aggregateSleepNight(healthConnectSleepSamples([session()]), day)!;
    const duplicate = aggregateSleepNight(healthConnectSleepSamples([session(), session(), session('other')]), day)!;
    expect(duplicate.totalSleepMinutes).toBe(one.totalSleepMinutes);
    expect(duplicate.sleepScore).toBe(one.sleepScore);
  });
  it('does not fabricate sleep from unknown stages or stage-less sessions', () => {
    const record = session(); record.stages = [{ startTime: time(10), endTime: time(19), stage: 0 }];
    expect(healthConnectSleepSamples([record])).toEqual([]);
    record.stages = [];
    expect(healthConnectSleepSamples([record])).toEqual([]);
  });
  it('keeps generic sleeping as duration without inventing a score', () => {
    const record = session(); record.stages = [{ startTime: time(11), endTime: time(19), stage: 2 }];
    expect(aggregateSleepNight(healthConnectSleepSamples([record]), day)).toMatchObject({ totalSleepMinutes: 480, sleepScore: null });
  });
  it('clips malformed stage boundaries to the session and discards invalid stages', () => {
    const record = session(); record.stages = [
      { startTime: time(0), endTime: time(25), stage: 4 },
      { startTime: 'invalid', endTime: time(25), stage: 5 },
    ];
    const samples = healthConnectSleepSamples([record]);
    expect(samples).toHaveLength(1);
    expect(samples[0].startDate.toISOString()).toBe(record.startTime);
    expect(samples[0].endDate.toISOString()).toBe(record.endTime);
  });
  it('honors Health Connect preference and falls back when its score is missing', () => {
    const rows = [{ day, score: 77, source: 'health_connect' as const }, { day, score: 88, source: 'oura' as const }];
    expect(selectWearableSleepForDate(rows, day, 'health_connect')?.score).toBe(77);
    expect(selectWearableSleepForDate(rows.slice(1), day, 'health_connect')?.score).toBe(88);
  });
});
