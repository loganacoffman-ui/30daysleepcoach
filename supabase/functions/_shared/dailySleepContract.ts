export const DAILY_COACH_PROMPT_VERSION = "native-daily-v7-resolved-sleep";

export type SleepEvidence = {
  day: string;
  score: number;
  source: string;
};
export type ManualEvidence = {
  checkin_date?: unknown;
  manual_sleep_score?: unknown;
  manual_sleep_submitted_at?: unknown;
};
export const validSleepScore = (score: unknown): score is number =>
  typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100;

// Manual reports remain independent evidence even when a wearable arrives later.
export function resolveSleep(date: string, wearable: SleepEvidence[], checkin?: ManualEvidence | null) {
  const night = wearable.find(row => row.day === date && validSleepScore(row.score));
  const manual = checkin?.checkin_date === date && validSleepScore(checkin.manual_sleep_score)
    && typeof checkin.manual_sleep_submitted_at === 'string' && Number.isFinite(Date.parse(checkin.manual_sleep_submitted_at))
    ? { score: checkin.manual_sleep_score, submitted_at: checkin.manual_sleep_submitted_at } : null;
  return {
    date,
    source: night?.source ?? (manual ? 'manual' : 'missing'),
    score: night?.score ?? manual?.score ?? null,
    manual,
  };
}

export const sleepResolutionKey = (resolution: ReturnType<typeof resolveSleep>) => JSON.stringify(resolution);
