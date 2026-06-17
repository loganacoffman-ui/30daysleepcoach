import { describe, it, expect } from 'vitest';
import {
  avg,
  ga,
  sc,
  hc,
  parseMarkdown,
  normalizeNumber,
  formatOuraTime,
  toTimeInputValue,
  formatGeneratedAt,
  extractCheckinScore,
  formatShortDate,
  calc7DayTrend,
  getBaselineEntryCount,
  getRecentBaselineEntries,
  getEntryCountLast14Days,
  getLatestByDay,
  getByDay,
  getSleepDataForCoach,
  getBriefingCacheKey,
  getRecommendationCacheKey,
  renderCoachEmpty,
  nightWakeLabel,
} from '../lib/sleep-utils.mjs';

// ── avg ──────────────────────────────────────────────

describe('avg', () => {
  it('returns rounded average of numeric array', () => {
    expect(avg([80, 90, 70])).toBe(80);
  });

  it('rounds to nearest integer', () => {
    expect(avg([1, 2])).toBe(2); // 1.5 rounds to 2
  });

  it('ignores non-finite values', () => {
    expect(avg([100, NaN, 'foo', 80])).toBe(90);
  });

  it('coerces string numbers', () => {
    expect(avg(['70', '80'])).toBe(75);
  });

  it('returns null for empty array', () => {
    expect(avg([])).toBeNull();
  });

  it('returns null when all values are non-finite', () => {
    expect(avg([NaN, Infinity, 'abc'])).toBeNull();
  });

  it('handles single value', () => {
    expect(avg([42])).toBe(42);
  });
});

// ── ga ──────────────────────────────────────────────

describe('ga', () => {
  it('returns rounded average', () => {
    expect(ga([85, 90, 75])).toBe(83);
  });

  it('returns null for empty array', () => {
    expect(ga([])).toBeNull();
  });

  it('handles single element', () => {
    expect(ga([77])).toBe(77);
  });
});

// ── sc (sleep-score color) ──────────────────────────

describe('sc', () => {
  it('returns green for score >= 75', () => {
    expect(sc(75)).toBe('#16a34a');
    expect(sc(100)).toBe('#16a34a');
  });

  it('returns gray for 60-74', () => {
    expect(sc(60)).toBe('#52525b');
    expect(sc(74)).toBe('#52525b');
  });

  it('returns red for score < 60', () => {
    expect(sc(59)).toBe('#dc2626');
    expect(sc(0)).toBe('#dc2626');
  });
});

// ── hc (HRV color) ─────────────────────────────────

describe('hc', () => {
  it('returns green for HRV >= 55', () => {
    expect(hc(55)).toBe('#16a34a');
    expect(hc(100)).toBe('#16a34a');
  });

  it('returns gray for 40-54', () => {
    expect(hc(40)).toBe('#52525b');
    expect(hc(54)).toBe('#52525b');
  });

  it('returns red for HRV < 40', () => {
    expect(hc(39)).toBe('#dc2626');
    expect(hc(10)).toBe('#dc2626');
  });
});

// ── parseMarkdown ───────────────────────────────────

describe('parseMarkdown', () => {
  it('wraps text in <p> tags', () => {
    expect(parseMarkdown('Hello')).toBe('<p>Hello</p>');
  });

  it('converts **bold** to <strong>', () => {
    expect(parseMarkdown('**bold text**')).toContain('<strong>bold text</strong>');
  });

  it('splits on double newlines into paragraphs', () => {
    const result = parseMarkdown('Para 1\n\nPara 2');
    expect(result).toBe('<p>Para 1</p><p>Para 2</p>');
  });

  it('converts single newlines to <br>', () => {
    const result = parseMarkdown('Line 1\nLine 2');
    expect(result).toBe('<p>Line 1<br>Line 2</p>');
  });

  it('styles arrow characters', () => {
    const result = parseMarkdown('Go → here');
    expect(result).toContain('<span style="color:var(--accent)">→</span>');
  });

  it('handles empty string', () => {
    expect(parseMarkdown('')).toBe('');
  });

  it('filters out whitespace-only paragraphs', () => {
    const result = parseMarkdown('A\n\n   \n\nB');
    expect(result).toBe('<p>A</p><p>B</p>');
  });
});

// ── normalizeNumber ─────────────────────────────────

describe('normalizeNumber', () => {
  it('returns number for valid input', () => {
    expect(normalizeNumber(42)).toBe(42);
    expect(normalizeNumber('3.14')).toBeCloseTo(3.14);
  });

  it('returns null for NaN', () => {
    expect(normalizeNumber('abc')).toBeNull();
    expect(normalizeNumber(NaN)).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(normalizeNumber(Infinity)).toBeNull();
    expect(normalizeNumber(-Infinity)).toBeNull();
  });

  it('returns 0 for zero', () => {
    expect(normalizeNumber(0)).toBe(0);
  });

  it('returns null for null/undefined', () => {
    expect(normalizeNumber(null)).toBe(0); // Number(null) === 0
    expect(normalizeNumber(undefined)).toBeNull(); // Number(undefined) === NaN
  });
});

// ── formatOuraTime ──────────────────────────────────

describe('formatOuraTime', () => {
  it('returns empty string for falsy input', () => {
    expect(formatOuraTime(null)).toBe('');
    expect(formatOuraTime('')).toBe('');
    expect(formatOuraTime(undefined)).toBe('');
  });

  it('returns empty string for invalid date', () => {
    expect(formatOuraTime('not-a-date')).toBe('');
  });

  it('formats valid ISO timestamp', () => {
    const result = formatOuraTime('2026-06-15T23:30:00');
    expect(result).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/i);
  });
});

// ── toTimeInputValue ────────────────────────────────

describe('toTimeInputValue', () => {
  it('returns empty string for falsy input', () => {
    expect(toTimeInputValue(null)).toBe('');
    expect(toTimeInputValue('')).toBe('');
  });

  it('returns HH:MM for valid date', () => {
    const result = toTimeInputValue('2026-06-15T09:05:00');
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('returns empty string for invalid date', () => {
    expect(toTimeInputValue('garbage')).toBe('');
  });
});

// ── formatGeneratedAt ───────────────────────────────

describe('formatGeneratedAt', () => {
  it('says "Generated today" for same-day timestamps', () => {
    const now = new Date('2026-06-17T10:00:00');
    const result = formatGeneratedAt('2026-06-17T08:30:00', now);
    expect(result).toMatch(/^Generated today at /);
  });

  it('shows date for different-day timestamps', () => {
    const now = new Date('2026-06-17T10:00:00');
    const result = formatGeneratedAt('2026-06-15T08:30:00', now);
    expect(result).toMatch(/^Generated /);
    expect(result).not.toContain('today');
  });
});

// ── extractCheckinScore ─────────────────────────────

describe('extractCheckinScore', () => {
  it('extracts a score from note text', () => {
    const entry = { note: 'Check-in: Energy 8/10, Mood 7/10.' };
    expect(extractCheckinScore(entry, 'Energy')).toBe(8);
    expect(extractCheckinScore(entry, 'Mood')).toBe(7);
  });

  it('returns null when label is not found', () => {
    const entry = { note: 'Check-in: Energy 8/10.' };
    expect(extractCheckinScore(entry, 'Focus')).toBeNull();
  });

  it('returns null for missing note', () => {
    expect(extractCheckinScore({}, 'Energy')).toBeNull();
    expect(extractCheckinScore(null, 'Energy')).toBeNull();
  });

  it('returns null for out-of-range values', () => {
    expect(extractCheckinScore({ note: 'Energy 0/10' }, 'Energy')).toBeNull();
    expect(extractCheckinScore({ note: 'Energy 11/10' }, 'Energy')).toBeNull();
  });

  it('handles "Stress/load" label with slash', () => {
    const entry = { note: 'Stress/load 6/10' };
    expect(extractCheckinScore(entry, 'Stress/load')).toBe(6);
  });

  it('is case-insensitive', () => {
    const entry = { note: 'energy 5/10' };
    expect(extractCheckinScore(entry, 'Energy')).toBe(5);
  });
});

// ── formatShortDate ─────────────────────────────────

describe('formatShortDate', () => {
  it('formats entry with ts', () => {
    const entry = { ts: new Date('2026-06-15').getTime() };
    const result = formatShortDate(entry);
    expect(result).toMatch(/6\/15/);
  });

  it('formats entry with date string', () => {
    const entry = { date: 'Jun 15, 2026' };
    const result = formatShortDate(entry);
    expect(result).toMatch(/6\/15/);
  });

  it('falls back to raw date for invalid input', () => {
    const entry = { date: 'invalid-date, something' };
    expect(formatShortDate(entry)).toBe('invalid-date');
  });

  it('handles null/undefined', () => {
    expect(formatShortDate(null)).toBe('');
    expect(formatShortDate(undefined)).toBe('');
  });
});

// ── calc7DayTrend ───────────────────────────────────

describe('calc7DayTrend', () => {
  function makeEntry(ts, sleep_score) {
    return { ts, sleep_score };
  }

  it('returns null delta with fewer than 4 scored entries', () => {
    const entries = [makeEntry(3, 80), makeEntry(2, 70), makeEntry(1, 60)];
    expect(calc7DayTrend(entries)).toEqual({ delta: null, count: 0 });
  });

  it('returns null delta when prior window has < 3 entries', () => {
    const entries = [
      makeEntry(7, 80), makeEntry(6, 75), makeEntry(5, 90), makeEntry(4, 85),
      // only 0 prior entries
    ];
    expect(calc7DayTrend(entries).delta).toBeNull();
  });

  it('calculates positive trend', () => {
    // Recent 7: avg 90
    // Prior 7: avg 70
    const recent = Array.from({ length: 7 }, (_, i) => makeEntry(20 - i, 90));
    const prior = Array.from({ length: 7 }, (_, i) => makeEntry(13 - i, 70));
    const result = calc7DayTrend([...recent, ...prior]);
    expect(result.delta).toBe(20);
    expect(result.recentAvg).toBe(90);
    expect(result.priorAvg).toBe(70);
  });

  it('calculates negative trend', () => {
    const recent = Array.from({ length: 7 }, (_, i) => makeEntry(20 - i, 60));
    const prior = Array.from({ length: 7 }, (_, i) => makeEntry(13 - i, 80));
    const result = calc7DayTrend([...recent, ...prior]);
    expect(result.delta).toBe(-20);
  });

  it('ignores entries without sleep_score', () => {
    const scored = Array.from({ length: 14 }, (_, i) => makeEntry(20 - i, 75));
    const noScore = [{ ts: 100, sleep_score: null }];
    const result = calc7DayTrend([...noScore, ...scored]);
    expect(result.delta).toBe(0);
  });
});

// ── getBaselineEntryCount ───────────────────────────

describe('getBaselineEntryCount', () => {
  it('returns 0 for empty entries', () => {
    expect(getBaselineEntryCount([])).toBe(0);
  });

  it('counts unique dates up to 7', () => {
    const entries = [
      { date: 'Jun 10, 2026' },
      { date: 'Jun 11, 2026' },
      { date: 'Jun 11, 2026' }, // duplicate
      { date: 'Jun 12, 2026' },
    ];
    expect(getBaselineEntryCount(entries)).toBe(3);
  });

  it('caps at 7', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ date: `Day ${i}` }));
    expect(getBaselineEntryCount(entries)).toBe(7);
  });

  it('skips falsy dates', () => {
    const entries = [{ date: null }, { date: '' }, { date: 'Jun 10, 2026' }];
    expect(getBaselineEntryCount(entries)).toBe(1);
  });
});

// ── getRecentBaselineEntries ────────────────────────

describe('getRecentBaselineEntries', () => {
  it('returns empty for no entries', () => {
    expect(getRecentBaselineEntries([])).toEqual([]);
  });

  it('returns up to 7 entries sorted oldest-first', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ ts: i + 1 }));
    const result = getRecentBaselineEntries(entries);
    expect(result).toHaveLength(7);
    expect(result[0].ts).toBe(4); // oldest of the last 7
    expect(result[6].ts).toBe(10); // newest
  });

  it('filters entries without ts', () => {
    const entries = [{ ts: 2 }, { ts: null }, { ts: 1 }];
    const result = getRecentBaselineEntries(entries);
    expect(result).toHaveLength(2);
    expect(result[0].ts).toBe(1);
  });
});

// ── getEntryCountLast14Days ─────────────────────────

describe('getEntryCountLast14Days', () => {
  it('returns 0 for empty entries', () => {
    expect(getEntryCountLast14Days([])).toBe(0);
  });

  it('counts only entries within the last 14 days', () => {
    const now = Date.now();
    const entries = [
      { ts: now - 1000 },                // 1 second ago
      { ts: now - 13 * 86400000 },       // 13 days ago
      { ts: now - 15 * 86400000 },       // 15 days ago (excluded)
    ];
    expect(getEntryCountLast14Days(entries, now)).toBe(2);
  });
});

// ── getLatestByDay ──────────────────────────────────

describe('getLatestByDay', () => {
  it('returns null for empty/null arrays', () => {
    expect(getLatestByDay([])).toBeNull();
    expect(getLatestByDay(null)).toBeNull();
  });

  it('returns the item with the latest day string', () => {
    const items = [
      { day: '2026-06-13', score: 70 },
      { day: '2026-06-15', score: 90 },
      { day: '2026-06-14', score: 80 },
    ];
    expect(getLatestByDay(items)).toEqual({ day: '2026-06-15', score: 90 });
  });
});

// ── getByDay ────────────────────────────────────────

describe('getByDay', () => {
  const items = [
    { day: '2026-06-13', v: 1 },
    { day: '2026-06-14', v: 2 },
  ];

  it('returns matching item', () => {
    expect(getByDay(items, '2026-06-14')).toEqual({ day: '2026-06-14', v: 2 });
  });

  it('returns null when no match', () => {
    expect(getByDay(items, '2026-06-20')).toBeNull();
  });

  it('returns null for empty/null input', () => {
    expect(getByDay(null, '2026-06-14')).toBeNull();
    expect(getByDay([], '2026-06-14')).toBeNull();
  });
});

// ── getSleepDataForCoach ────────────────────────────

describe('getSleepDataForCoach', () => {
  it('returns at most 14 entries', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      date: `Day ${i}`, sleep_score: 80, hrv: 50, bedtime: '23:00',
      waketime: '07:00', night_wake: 'none', pos: [], neg: [], note: '',
    }));
    expect(getSleepDataForCoach(entries)).toHaveLength(14);
  });

  it('strips extra fields', () => {
    const entries = [{ date: 'Jun 15', sleep_score: 85, hrv: 60, extra: 'junk' }];
    const result = getSleepDataForCoach(entries);
    expect(result[0]).not.toHaveProperty('extra');
    expect(result[0]).toHaveProperty('date', 'Jun 15');
    expect(result[0]).toHaveProperty('sleep_score', 85);
  });

  it('handles empty array', () => {
    expect(getSleepDataForCoach([])).toEqual([]);
  });
});

// ── cache key helpers ───────────────────────────────

describe('getBriefingCacheKey', () => {
  it('produces "briefing_YYYY-MM-DD"', () => {
    const d = new Date('2026-06-17');
    expect(getBriefingCacheKey(d)).toBe('briefing_2026-06-17');
  });

  it('zero-pads months and days', () => {
    const d = new Date('2026-01-05');
    expect(getBriefingCacheKey(d)).toBe('briefing_2026-01-05');
  });
});

describe('getRecommendationCacheKey', () => {
  it('produces "recommendation_YYYY-MM-DD"', () => {
    const d = new Date('2026-06-17');
    expect(getRecommendationCacheKey(d)).toBe('recommendation_2026-06-17');
  });
});

// ── renderCoachEmpty ────────────────────────────────

describe('renderCoachEmpty', () => {
  it('clamps entry count to 0-7', () => {
    expect(renderCoachEmpty(-5)).toContain('0 of 7');
    expect(renderCoachEmpty(10)).toContain('7 of 7');
  });

  it('shows correct count in text', () => {
    expect(renderCoachEmpty(3)).toContain('3 of 7');
  });

  it('handles non-numeric input', () => {
    expect(renderCoachEmpty('abc')).toContain('0 of 7');
    expect(renderCoachEmpty(null)).toContain('0 of 7');
  });

  it('contains expected HTML structure', () => {
    const html = renderCoachEmpty(4);
    expect(html).toContain('coach-empty-title');
    expect(html).toContain('coach-progress-fill');
    expect(html).toContain('Still learning your patterns');
  });
});

// ── nightWakeLabel ──────────────────────────────────

describe('nightWakeLabel', () => {
  it('maps known values', () => {
    expect(nightWakeLabel('none')).toBe('Slept through');
    expect(nightWakeLabel('back_quick')).toBe('Brief wake');
    expect(nightWakeLabel('back_slow')).toBe('30min+ awake');
    expect(nightWakeLabel('couldnt_sleep')).toBe('3am — 2hr+');
  });

  it('returns dash for unknown values', () => {
    expect(nightWakeLabel('')).toBe('—');
    expect(nightWakeLabel(undefined)).toBe('—');
    expect(nightWakeLabel('something_else')).toBe('—');
  });
});
