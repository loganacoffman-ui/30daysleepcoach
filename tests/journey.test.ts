import { describe, expect, it } from 'vitest';
import { journeyEntries } from '../mobile/progress/journey';

const row = (date: string, completed: string | null = 'done') => ({ checkin_date: date, completed_at: completed, manual_sleep_score: 0 });
describe('30 day journey', () => {
  it('fills consecutive slots across calendar gaps, excluding unfinished entries and duplicate dates', () => {
    const entries = journeyEntries([row('2026-09-15'), row('2026-07-01'), row('2026-07-01'), row('2026-09-14', null)]);
    expect(entries.map(entry => entry.checkin_date)).toEqual(['2026-07-01', '2026-09-15']);
    expect(entries[0].manual_sleep_score).toBe(0);
  });
  it('keeps the original first 30 completions after the journey ends', () => {
    const rows = Array.from({ length: 31 }, (_, i) => row(`2026-08-${String(i + 1).padStart(2, '0')}`));
    expect(journeyEntries(rows.reverse())).toHaveLength(30);
    expect(journeyEntries(rows).at(-1)?.checkin_date).toBe('2026-08-30');
    expect(journeyEntries([])).toEqual([]);
  });
});
