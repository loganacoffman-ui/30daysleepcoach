export const SLEEP_SCORE_VERSION = 'sleep-coach-v2';

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
    efficiency: number | null;
    remShare: number | null;
    deepShare: number | null;
  };
  efficiency: number | null;
};

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

// Weight of each component of a score. A component that could not be measured is
// left out and the rest are renormalised, so an unmeasurable one never counts as
// a perfect one.
const WEIGHTS = { duration: 0.4, efficiency: 0.25, remShare: 0.2, deepShare: 0.15 };

export function calculateSleepCoachScore(input: SleepScoreInput): SleepScoreResult {
  // Efficiency is asleep time over time in bed. A source that logged no awake
  // time and no in-bed period gives no evidence of either, which leaves asleep
  // over asleep — a flawless night nothing actually measured. Efficiency is
  // unknown for that night rather than 1.
  const tracksTimeAwake = input.awakeMinutes > 0 || input.inBedMinutes > input.asleepMinutes;
  const denominator = input.inBedMinutes > 0
    ? input.inBedMinutes
    : input.asleepMinutes + input.awakeMinutes;
  const efficiency = tracksTimeAwake && denominator > 0
    ? clamp(input.asleepMinutes / denominator)
    : null;
  const duration = clamp(input.asleepMinutes / 480);
  const efficiencyComponent = efficiency === null
    ? null
    : clamp((efficiency - 0.7) / 0.25);
  const hasReliableStages =
    input.asleepMinutes >= 120 && input.stagedMinutes / input.asleepMinutes >= 0.5;
  const remShare = hasReliableStages
    ? clamp((input.remMinutes / input.asleepMinutes) / 0.2)
    : null;
  const deepShare = hasReliableStages
    ? clamp((input.deepMinutes / input.asleepMinutes) / 0.13)
    : null;

  const measured = ([
    [WEIGHTS.duration, duration],
    [WEIGHTS.efficiency, efficiencyComponent],
    [WEIGHTS.remShare, remShare],
    [WEIGHTS.deepShare, deepShare],
  ] as const).filter((part): part is readonly [number, number] => part[1] !== null);
  const totalWeight = measured.reduce((sum, [weight]) => sum + weight, 0);

  return {
    score: hasReliableStages && totalWeight > 0
      ? Math.round(
        100 * measured.reduce((sum, [weight, value]) => sum + weight * value, 0) / totalWeight,
      )
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
