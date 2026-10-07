import type { RecordResult } from 'react-native-health-connect';
import type { HealthSleepSample } from '../healthkit/sleepAggregation';

// Health Connect: awake=1, sleeping=2, out of bed=3, light=4, deep=5, REM=6.
// Convert only measured stages to the existing source-neutral scoring input.
// Unknown periods and stage-less sessions must not become invented sleep.
const stageValues: Record<number, number> = { 1: 2, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 };
export function healthConnectSleepSamples(records: RecordResult<'SleepSession'>[]): HealthSleepSample[] {
  return records.flatMap(record => {
    const origin = record.metadata?.dataOrigin || 'Health Connect';
    const id = record.metadata?.id || `${origin}:${record.startTime}:${record.endTime}`;
    const sessionStart = Date.parse(record.startTime);
    const sessionEnd = Date.parse(record.endTime);
    if (!Number.isFinite(sessionStart) || !Number.isFinite(sessionEnd) || sessionEnd <= sessionStart) return [];
    return (record.stages ?? []).flatMap((stage, index) => {
      const value = stageValues[stage.stage];
      const start = Math.max(sessionStart, Date.parse(stage.startTime));
      const end = Math.min(sessionEnd, Date.parse(stage.endTime));
      if (value === undefined || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
      return [{ uuid: `${id}:${index}`, value, startDate: new Date(start), endDate: new Date(end),
        sourceName: origin === 'com.fitbit.FitbitMobile' ? 'Google Health / Fitbit' : origin,
        sourceBundleIdentifier: origin }];
    });
  });
}
