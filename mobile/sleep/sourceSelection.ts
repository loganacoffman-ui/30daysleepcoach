import type { SleepSource } from '../onboarding/types';

export type WearableSleep = {
  day: string;
  score: number;
  source: SleepSource;
  scoreVersion?: string | null;
  totalSleepMinutes?: number | null;
};

export const isSleepSource = (value: unknown): value is SleepSource =>
  value === 'apple_health' || value === 'health_connect' || value === 'oura';

export const sleepSourceLabel = (source: string | null) =>
  source === 'apple_health' ? 'Apple Health' : source === 'health_connect' ? 'Health Connect' : source === 'oura' ? 'Oura' : 'Manual';

const sourceOrder = (preferred: SleepSource | null): SleepSource[] => {
  const fallback: SleepSource[] = ['oura', 'apple_health', 'health_connect'];
  return preferred ? [preferred, ...fallback.filter(source => source !== preferred)] : fallback;
};

export function selectWearableSleepForDate(
  rows: WearableSleep[],
  date: string,
  preferred: SleepSource | null,
) {
  const matches = rows.filter(row => row.day === date);
  for (const source of sourceOrder(preferred)) {
    const match = matches.find(row => row.source === source);
    if (match) return match;
  }
  return null;
}

export function resolveWearableSleepHistory(
  rows: WearableSleep[],
  preferred: SleepSource | null,
) {
  const dates = [...new Set(rows.map(row => row.day))].sort((a, b) => b.localeCompare(a));
  return dates
    .map(date => selectWearableSleepForDate(rows, date, preferred))
    .filter((row): row is WearableSleep => row !== null);
}
