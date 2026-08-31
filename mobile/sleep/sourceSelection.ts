import type { SleepSource } from '../onboarding/types';

export type WearableSleep = {
  day: string;
  score: number;
  source: SleepSource;
  scoreVersion?: string | null;
  totalSleepMinutes?: number | null;
};

const sourceOrder = (preferred: SleepSource | null): SleepSource[] =>
  preferred === 'apple_health'
    ? ['apple_health', 'oura']
    : ['oura', 'apple_health'];

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
