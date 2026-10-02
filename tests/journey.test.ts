import { describe, expect, it } from 'vitest';
import { journeyEntries, journeyMonths } from '../mobile/progress/journey';

const row = (date: string, completed: string | null = 'done') => ({ checkin_date: date, completed_at: completed, manual_sleep_score: 0 });
describe('30 day journey', () => {
  it('fills consecutive slots across calendar gaps, excluding unfinished entries and duplicate dates', () => {
    const entries = journeyEntries([row('2026-09-15'), row('2026-07-01'), row('2026-07-01'), row('2026-09-14', null)]);
    expect(entries.map(entry => entry.checkin_date)).toEqual(['2026-07-01', '2026-09-15']);
    expect(entries[0].manual_sleep_score).toBe(0);
  });
  it('keeps counting check-ins past 30, oldest first', () => {
    const rows = Array.from({ length: 31 }, (_, i) => row(`2026-08-${String(i + 1).padStart(2, '0')}`));
    const entries = journeyEntries(rows.reverse());
    expect(entries).toHaveLength(31);
    expect(entries[0].checkin_date).toBe('2026-08-01');
    expect(entries.at(-1)?.checkin_date).toBe('2026-08-31');
    expect(journeyEntries([])).toEqual([]);
  });
});

describe('journey months', () => {
  it('groups check-ins into newest-first calendar months, skipping months without any', () => {
    const months = journeyMonths(journeyEntries([row('2026-06-30'), row('2026-09-01'), row('2026-09-14'), row('2024-02-10')]));
    expect(months.map(month => [month.key, month.checkins])).toEqual([['2026-09', 2], ['2026-06', 1], ['2024-02', 1]]);
    // September 2026 starts on a Tuesday; February 2024 is a leap month.
    expect(months[0].leadingBlanks).toBe(2);
    expect(months[0].days).toHaveLength(30);
    expect(months[0].days[0]).toBe('2026-09-01');
    expect(months[2].days.at(-1)).toBe('2024-02-29');
    expect(journeyMonths([])).toEqual([]);
  });
});
