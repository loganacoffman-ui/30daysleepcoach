export type JourneyCheckin = { checkin_date: string; completed_at: string | null; manual_sleep_score: number | null };

// Calendar gaps do not consume a slot. A day's edits never add another slot.
export function journeyEntries(rows: JourneyCheckin[]) {
  const dates = new Map<string, JourneyCheckin>();
  for (const row of rows) if (row.completed_at) dates.set(row.checkin_date, row);
  return [...dates.values()].sort((a, b) => a.checkin_date.localeCompare(b.checkin_date)).slice(0, 30);
}
