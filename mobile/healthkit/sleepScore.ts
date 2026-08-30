export const SLEEP_SCORE_VERSION = 'sleep-coach-v1';

export type SleepScoreInput = {
  asleepMinutes: number;
  awakeMinutes: number;
  inBedMinutes: number;
  remMinutes: number;
  deepMinutes: number;
  stagedMinutes: number;
};

export type SleepScoreResult = {
  score: number | null;
  components: {
    duration: number;
    efficiency: number;
    remShare: number | null;
    deepShare: number | null;
  };
  efficiency: number;
};

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

export function calculateSleepCoachScore(input: SleepScoreInput): SleepScoreResult {
  const denominator = input.inBedMinutes > 0
    ? input.inBedMinutes
    : input.asleepMinutes + input.awakeMinutes;
  const efficiency = denominator > 0 ? clamp(input.asleepMinutes / denominator) : 0;
  const duration = clamp(input.asleepMinutes / 480);
  const efficiencyComponent = clamp((efficiency - 0.7) / 0.25);
  const hasReliableStages =
    input.asleepMinutes >= 120 && input.stagedMinutes / input.asleepMinutes >= 0.5;
  const remShare = hasReliableStages
    ? clamp((input.remMinutes / input.asleepMinutes) / 0.2)
    : null;
  const deepShare = hasReliableStages
    ? clamp((input.deepMinutes / input.asleepMinutes) / 0.13)
    : null;

  return {
    score: hasReliableStages
      ? Math.round(100 * (
        0.4 * duration
        + 0.25 * efficiencyComponent
        + 0.2 * (remShare ?? 0)
        + 0.15 * (deepShare ?? 0)
      ))
      : null,
    components: {
      duration,
      efficiency: efficiencyComponent,
      remShare,
      deepShare,
    },
    efficiency,
  };
}
