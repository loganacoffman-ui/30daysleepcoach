export type JourneyCheckin = { checkin_date: string; completed_at: string | null; manual_sleep_score: number | null };
export type JourneyMonth = { key: string; checkins: number; leadingBlanks: number; days: string[] };

export const JOURNEY_LENGTH = 30;

// Calendar gaps do not consume a slot. A day's edits never add another slot.
export function journeyEntries(rows: JourneyCheckin[]) {
  const dates = new Map<string, JourneyCheckin>();
  for (const row of rows) if (row.completed_at) dates.set(row.checkin_date, row);
  return [...dates.values()].sort((a, b) => a.checkin_date.localeCompare(b.checkin_date));
}

// Newest month first, each laid out as a Sunday-first calendar. Months without
// a single check-in are left out rather than shown as empty grids.
export function journeyMonths(entries: JourneyCheckin[]): JourneyMonth[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.checkin_date.slice(0, 7);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => b.localeCompare(a)).map(([key, checkins]) => {
    const [year, month] = key.split('-').map(Number);
    const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      key,
      checkins,
      leadingBlanks: new Date(Date.UTC(year, month - 1, 1)).getUTCDay(),
      days: Array.from({ length }, (_, index) => `${key}-${String(index + 1).padStart(2, '0')}`),
    };
  });
}
