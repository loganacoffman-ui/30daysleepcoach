// Pure business-logic functions extracted from index.html for testability.
// These mirror the inline <script> implementations — keep them in sync.

/** Average an array of values, ignoring non-finite entries. */
export function avg(values) {
  const nums = values.map(Number).filter(v => Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round(nums.reduce((sum, v) => sum + v, 0) / nums.length);
}

/** Simple integer average (used by insight cards). */
export function ga(arr) {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
}

/** Sleep-score color. */
export function sc(v) {
  return v >= 75 ? '#16a34a' : v >= 60 ? '#52525b' : '#dc2626';
}

/** HRV color. */
export function hc(v) {
  return v >= 55 ? '#16a34a' : v >= 40 ? '#52525b' : '#dc2626';
}

/** Tiny markdown-to-HTML: bold, arrows, paragraph splitting. */
export function parseMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/→/g, '<span style="color:var(--accent)">→</span>')
    .split('\n\n')
    .filter(p => p.trim())
    .map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>')
    .join('');
}

/** Coerce to finite number or null. */
export function normalizeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** Format an ISO/timestamp into locale time string (e.g. "11:30 PM"). */
export function formatOuraTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Convert timestamp to HH:MM for <input type="time">. */
export function toTimeInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Human-readable "Generated today at ..." or "Generated <date>". */
export function formatGeneratedAt(iso, now = new Date()) {
  const date = new Date(iso);
  const sameDay = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `Generated today at ${timeStr}` : `Generated ${date.toLocaleDateString()}`;
}

/** Parse "Energy 8/10" style check-in scores from an entry's note field. */
export function extractCheckinScore(entry, label) {
  const note = entry?.note || '';
  const match = note.match(new RegExp(`${label}\\s+(\\d{1,2})\\/10`, 'i'));
  if (!match) return null;
  const value = Number(match[1]);
  return value >= 1 && value <= 10 ? value : null;
}

/** Short date from an entry object (e.g. "6/15"). */
export function formatShortDate(entry) {
  const source = entry?.ts ? new Date(entry.ts) : new Date(entry?.date || '');
  if (Number.isNaN(source.getTime())) return (entry?.date || '').replace(/,.*/, '');
  return source.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}

/**
 * 7-day trend: compare avg of the last 7 scored days vs the prior 7.
 * @param {Array} entries — full entries array (newest-first expected).
 */
export function calc7DayTrend(entries) {
  const scored = [...entries].filter(e => e.sleep_score).sort((a, b) => b.ts - a.ts);
  if (scored.length < 4) return { delta: null, count: 0 };
  const recent = scored.slice(0, 7);
  const prior = scored.slice(7, 14);
  if (prior.length < 3) return { delta: null, count: recent.length };
  const recentAvg = ga(recent.map(e => e.sleep_score));
  const priorAvg = ga(prior.map(e => e.sleep_score));
  return { delta: recentAvg - priorAvg, count: recent.length, recentAvg, priorAvg };
}

/** Count unique baseline days (max 7). */
export function getBaselineEntryCount(entries) {
  const days = new Set(entries.map(e => e.date).filter(Boolean));
  return Math.min(days.size, 7);
}

/** Last 7 entries sorted oldest-first. */
export function getRecentBaselineEntries(entries) {
  return [...entries]
    .filter(e => e && e.ts)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 7)
    .reverse();
}

/** Entries logged in the last 14 days. */
export function getEntryCountLast14Days(entries, now = Date.now()) {
  const cutoff = now - 14 * 86400000;
  return entries.filter(e => (e.ts || 0) >= cutoff).length;
}

/** Latest item by `.day` string (descending sort). */
export function getLatestByDay(items) {
  return (items || []).slice().sort((a, b) => String(b.day || '').localeCompare(String(a.day || '')))[0] || null;
}

/** Find item with a specific `.day` value. */
export function getByDay(items, day) {
  return (items || []).find(item => item.day === day) || null;
}

/** Prepare entry data for the AI coach. */
export function getSleepDataForCoach(entries) {
  return entries.slice(0, 14).map(e => ({
    date: e.date,
    sleep_score: e.sleep_score,
    hrv: e.hrv,
    bedtime: e.bedtime,
    waketime: e.waketime,
    night_wake: e.night_wake,
    pos: e.pos,
    neg: e.neg,
    note: e.note,
  }));
}

/** Build a cache key like "briefing_2026-06-17". */
export function getBriefingCacheKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `briefing_${y}-${m}-${d}`;
}

/** Build a cache key like "recommendation_2026-06-17". */
export function getRecommendationCacheKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `recommendation_${y}-${m}-${d}`;
}

/** Render the "Still learning your patterns" card HTML. */
export function renderCoachEmpty(entryCount) {
  const safeCount = Math.max(0, Math.min(7, Number(entryCount) || 0));
  return `
    <div class="coach-card" style="padding:32px 24px;text-align:center">
      <div class="coach-empty-title">Still learning your patterns</div>
      <div class="coach-empty-body">The Coach uses your last 14 days of logs and starts surfacing recommendations after about 7 recent entries.</div>

      <div class="coach-progress-pill">
        <div class="coach-progress-bar"><div class="coach-progress-fill" id="coach-progress-fill"></div></div>
        <div class="coach-progress-text">${safeCount} of 7 recent entries</div>
      </div>
    </div>
  `;
}

/** Night-wake label mapping. */
export function nightWakeLabel(value) {
  return ({
    none: 'Slept through',
    back_quick: 'Brief wake',
    back_slow: '30min+ awake',
    couldnt_sleep: '3am — 2hr+',
  })[value] || '—';
}
