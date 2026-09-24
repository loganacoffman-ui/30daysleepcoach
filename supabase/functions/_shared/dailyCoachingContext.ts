// Keep arithmetic outside the model. Different providers and score versions are
// summarized separately; a device change is not automatically a sleep trend.
export function withDailySleepSummary(context: Record<string, unknown>) {
  const date = typeof context.date === 'string' ? context.date : '';
  const end = Date.parse(`${date}T12:00:00Z`);
  const start = Number.isFinite(end) ? new Date(end - 6 * 86400000).toISOString().slice(0, 10) : date;
  const groups = new Map<string, Array<{ day: string; score: number }>>();
  for (const raw of Array.isArray(context.wearable_sleep) ? context.wearable_sleep : []) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.day !== 'string' || row.day < start || row.day > date
      || typeof row.source !== 'string' || typeof row.score !== 'number'
      || !Number.isFinite(row.score) || row.score < 0 || row.score > 100) continue;
    const key = JSON.stringify([row.source, row.scoreVersion ?? null]);
    const group = groups.get(key) ?? [];
    if (!group.some(item => item.day === row.day)) group.push({ day: row.day, score: row.score });
    groups.set(key, group);
  }
  const bySource = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => {
    const [source, score_version] = JSON.parse(key);
    rows.sort((a, b) => a.day.localeCompare(b.day));
    return { source, score_version, nights: rows.length,
      first: rows[0], latest: rows[rows.length - 1],
      min_score: Math.min(...rows.map(row => row.score)), max_score: Math.max(...rows.map(row => row.score)),
      mean_score: Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length * 10) / 10,
    };
  });
  return { ...context, sleep_summary: { window_start: start, window_end: date, by_source: bySource,
    interpretation: 'Compare scores only within the same source and version. Associations do not prove causes; manual reports remain separate.' } };
}

export const DAILY_COACH_REQUEST_INSTRUCTIONS = "Choose today's coaching decision and recommendation from this combined context. Subjective check-ins and notes describe how the user felt and what they think affected sleep. Experiment adherence shows what they actually tried. Wearable sleep is the quantitative layer when Apple Health or Oura is connected; the source field identifies whether a score is app-derived or provider-owned. The sleep_resolution selects the preferred quantitative source for the requested night: wearable first, otherwise an explicitly submitted manual score. Preserve manual scores as self-reports and qualitative context, never as wearable measurements. Use relevant long-term memory to follow up on earlier goals, experiments, and outcomes. Be honest when data is sparse; do not invent measurements. Return the decision and fields specified by the system instructions.";

export function buildDailyCoachingMessage(context: Record<string, unknown>, current: { behavior: string; status: string } | null = null) {
  const input = { ...withDailySleepSummary(context), current_daily_experiment: current
    ? { behavior: current.behavior, status: current.status } : null };
  return DAILY_COACH_REQUEST_INSTRUCTIONS + "\n\n" + JSON.stringify(input, null, 2)
    + "\nUse current_daily_experiment as context for deciding whether to continue, simplify, replace, or clarify; preserve the truth of its recorded outcome.";
}

// The visible numeric pattern is factual UI copy, not model arithmetic.
export function groundedDailyPattern(context: Record<string, unknown>): string | null {
  const resolution = context.sleep_resolution as { source?: string; score?: number; manual?: { score: number } | null } | undefined;
  if (!resolution || typeof resolution.score !== 'number' || !Number.isFinite(resolution.score)) return null;
  if (resolution.source === 'manual') return `You rated your sleep ${resolution.score}/100; this is a self-reported score.`;
  const label = resolution.source === 'oura' ? 'Oura' : 'Sleep Coach';
  if (resolution.manual && resolution.manual.score !== resolution.score) {
    return `${label} scored ${resolution.score}; your own sleep rating was ${resolution.manual.score}.`;
  }
  const latest = withDailySleepSummary(context).sleep_summary.by_source
    .find(group => group.source === resolution.source && group.latest.day === context.date);
  return latest && latest.nights > 1
    ? `${label} scored ${resolution.score}; ${latest.nights} comparable nights ranged from ${latest.min_score} to ${latest.max_score}.`
    : `${label} scored ${resolution.score}; one comparable night cannot establish a trend.`;
}
