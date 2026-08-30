import {
  calculateSleepCoachScore,
  SLEEP_SCORE_VERSION,
} from './sleepScore';

export type HealthSleepSample = {
  uuid: string;
  value: number;
  startDate: Date;
  endDate: Date;
  sourceName: string;
  sourceBundleIdentifier: string;
};

export type NormalizedHealthSleepNight = {
  sleepDate: string;
  sleepScore: number | null;
  scoreVersion: string;
  scoreComponents: Record<string, number | null>;
  bedtimeStart: string;
  bedtimeEnd: string;
  totalSleepMinutes: number;
  awakeMinutes: number;
  inBedMinutes: number;
  remMinutes: number;
  deepMinutes: number;
  coreMinutes: number;
  efficiency: number;
  sourceName: string;
  sourceBundleIdentifier: string;
  providerRecordId: string;
};

type Interval = { start: number; end: number };

const ASLEEP_VALUES = new Set([1, 3, 4, 5]);
const STAGED_VALUES = new Set([3, 4, 5]);
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

export const localDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

export function sleepQueryWindow(sleepDate: string) {
  const target = new Date(`${sleepDate}T12:00:00`);
  const start = new Date(target);
  start.setDate(start.getDate() - 1);
  return { start, end: target };
}

const unionDurationMinutes = (intervals: Interval[]) => {
  if (!intervals.length) return 0;
  const ordered = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let current = { ...ordered[0] };
  for (const interval of ordered.slice(1)) {
    if (interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end);
    } else {
      total += current.end - current.start;
      current = { ...interval };
    }
  }
  total += current.end - current.start;
  return total / 60000;
};

const toInterval = (sample: HealthSleepSample): Interval => ({
  start: sample.startDate.getTime(),
  end: sample.endDate.getTime(),
});

const splitSessions = (samples: HealthSleepSample[]) => {
  const ordered = [...samples].sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime(),
  );
  const sessions: HealthSleepSample[][] = [];
  let sessionEnd = 0;
  for (const sample of ordered) {
    const start = sample.startDate.getTime();
    const end = sample.endDate.getTime();
    if (!sessions.length || start > sessionEnd + THREE_HOURS_MS) {
      sessions.push([sample]);
      sessionEnd = end;
    } else {
      sessions[sessions.length - 1].push(sample);
      sessionEnd = Math.max(sessionEnd, end);
    }
  }
  return sessions;
};

const asleepMinutesFor = (samples: HealthSleepSample[]) =>
  unionDurationMinutes(samples.filter(sample => ASLEEP_VALUES.has(sample.value)).map(toInterval));

const pickPrincipalSession = (samples: HealthSleepSample[]) =>
  splitSessions(samples)
    .map(session => ({
      session,
      asleepMinutes: asleepMinutesFor(session),
      stagedMinutes: unionDurationMinutes(
        session.filter(sample => STAGED_VALUES.has(sample.value)).map(toInterval),
      ),
      end: Math.max(...session.map(sample => sample.endDate.getTime())),
    }))
    .filter(candidate => candidate.asleepMinutes >= 120)
    .sort((a, b) =>
      b.asleepMinutes - a.asleepMinutes
      || b.stagedMinutes - a.stagedMinutes
      || b.end - a.end,
    )[0];

export function aggregateSleepNight(
  samples: HealthSleepSample[],
  sleepDate: string,
): NormalizedHealthSleepNight | null {
  const { start, end } = sleepQueryWindow(sleepDate);
  const windowStart = start.getTime();
  const windowEnd = end.getTime();
  const grouped = new Map<string, HealthSleepSample[]>();

  for (const sample of samples) {
    const sampleStart = sample.startDate.getTime();
    const sampleEnd = sample.endDate.getTime();
    if (
      !Number.isFinite(sampleStart)
      || !Number.isFinite(sampleEnd)
      || sampleEnd <= sampleStart
      || sampleEnd <= windowStart
      || sampleStart >= windowEnd
    ) continue;
    const clipped = {
      ...sample,
      startDate: new Date(Math.max(sampleStart, windowStart)),
      endDate: new Date(Math.min(sampleEnd, windowEnd)),
    };
    const key = sample.sourceBundleIdentifier || sample.sourceName || 'unknown';
    grouped.set(key, [...(grouped.get(key) ?? []), clipped]);
  }

  const selected = [...grouped.values()]
    .map(pickPrincipalSession)
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((a, b) => {
      // When durations differ substantially (>50%), prefer the longer session
      const ratio = Math.min(a.asleepMinutes, b.asleepMinutes)
        / Math.max(a.asleepMinutes, b.asleepMinutes);
      if (ratio < 0.5) return b.asleepMinutes - a.asleepMinutes;
      // Among comparable sessions, prefer staged detail
      return Number(b.stagedMinutes / b.asleepMinutes >= 0.5)
        - Number(a.stagedMinutes / a.asleepMinutes >= 0.5)
        || b.asleepMinutes - a.asleepMinutes
        || b.stagedMinutes - a.stagedMinutes
        || b.end - a.end;
    },
    )[0];
  if (!selected) return null;

  const session = selected.session;
  const intervalsFor = (values: Set<number>) =>
    session.filter(sample => values.has(sample.value)).map(toInterval);
  const asleepMinutes = unionDurationMinutes(intervalsFor(ASLEEP_VALUES));
  const awakeMinutes = unionDurationMinutes(intervalsFor(new Set([2])));
  const recordedInBedMinutes = unionDurationMinutes(intervalsFor(new Set([0])));
  const observedSessionMinutes = unionDurationMinutes(intervalsFor(new Set([1, 2, 3, 4, 5])));
  const inBedMinutes = Math.max(recordedInBedMinutes, observedSessionMinutes);
  const remMinutes = unionDurationMinutes(intervalsFor(new Set([5])));
  const deepMinutes = unionDurationMinutes(intervalsFor(new Set([4])));
  const coreMinutes = unionDurationMinutes(intervalsFor(new Set([3])));
  const stagedMinutes = unionDurationMinutes(intervalsFor(STAGED_VALUES));
  const score = calculateSleepCoachScore({
    asleepMinutes,
    awakeMinutes,
    inBedMinutes,
    remMinutes,
    deepMinutes,
    stagedMinutes,
  });
  const bedtimeStart = new Date(Math.min(...session.map(item => item.startDate.getTime())));
  const bedtimeEnd = new Date(Math.max(...session.map(item => item.endDate.getTime())));
  const source = session[0];

  return {
    sleepDate,
    sleepScore: score.score,
    scoreVersion: SLEEP_SCORE_VERSION,
    scoreComponents: score.components,
    bedtimeStart: bedtimeStart.toISOString(),
    bedtimeEnd: bedtimeEnd.toISOString(),
    totalSleepMinutes: Math.round(asleepMinutes),
    awakeMinutes: Math.round(awakeMinutes),
    inBedMinutes: Math.round(inBedMinutes),
    remMinutes: Math.round(remMinutes),
    deepMinutes: Math.round(deepMinutes),
    coreMinutes: Math.round(coreMinutes),
    efficiency: Math.round(score.efficiency * 1000) / 1000,
    sourceName: source.sourceName,
    sourceBundleIdentifier: source.sourceBundleIdentifier,
    providerRecordId: session.map(item => item.uuid).sort().join(','),
  };
}
