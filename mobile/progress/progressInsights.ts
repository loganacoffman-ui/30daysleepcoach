import type { MorningFeeling } from '../today/feeling';

export type ProgressCheckin = {
  checkin_date: string;
  manual_sleep_score: number | null;
  morningFeeling: MorningFeeling | null;
  note: string | null;
  suspected_factor: string | null;
};

export type ProgressCommitment = {
  behavior_date: string;
  behavior: string;
  status: string;
};

export type SleepPoint = { date: string; score: number; source: 'manual' | 'apple_health' | 'oura' };

export const addDays = (date: string, count: number) => {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + count);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};

export function mergeSleepPoints(checkins: ProgressCheckin[], wearable: SleepPoint[]) {
  const byDate = new Map(wearable.map(point => [point.date, point]));
  for (const row of checkins) {
    if (!byDate.has(row.checkin_date) && typeof row.manual_sleep_score === 'number') {
      byDate.set(row.checkin_date, { date: row.checkin_date, score: row.manual_sleep_score, source: 'manual' });
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function rollingDeltas(points: SleepPoint[]) {
  return points.map((point, index) => {
    if (index === 0) return { ...point, baseline: null, comparison: null, delta: null };
    const prior = points.slice(Math.max(0, index - 7), index);
    const hasSevenNightBaseline = prior.length === 7;
    const comparisonPoints = hasSevenNightBaseline ? prior : [points[index - 1]];
    const baseline = comparisonPoints.reduce((sum, item) => sum + item.score, 0) / comparisonPoints.length;
    return { ...point, baseline, comparison: hasSevenNightBaseline ? '7-night baseline' as const : 'previous night' as const, delta: Math.round(point.score - baseline) };
  });
}

export function feelingTrend(checkins: ProgressCheckin[]) {
  const rank: Record<MorningFeeling, number> = { exhausted: 0, tired: 1, okay: 2, rested: 3, great: 4 };
  const values = checkins.filter(row => row.morningFeeling).sort((a, b) => a.checkin_date.localeCompare(b.checkin_date)).slice(-7);
  const current = values.at(-1)?.morningFeeling ?? null;
  if (!current || values.length < 3) return { current, direction: 'steady' as const };
  const midpoint = Math.max(1, Math.floor(values.length / 2));
  const average = (rows: typeof values) => rows.reduce((sum, row) => sum + rank[row.morningFeeling!], 0) / rows.length;
  const change = average(values.slice(midpoint)) - average(values.slice(0, midpoint));
  return { current, direction: change > 0.35 ? 'up' as const : change < -0.35 ? 'down' as const : 'steady' as const };
}

export function weeklyFeeling(checkins: ProgressCheckin[]) {
  const categories: MorningFeeling[] = ['exhausted', 'tired', 'okay', 'rested', 'great'];
  const recent = checkins
    .filter(row => row.morningFeeling)
    .sort((a, b) => a.checkin_date.localeCompare(b.checkin_date))
    .slice(-7);
  if (!recent.length) return { feeling: null, count: 0 };
  const average = recent.reduce((sum, row) => sum + categories.indexOf(row.morningFeeling!), 0) / recent.length;
  return { feeling: categories[Math.round(average)], count: recent.length };
}

export type ExperimentInsight = {
  behavior: string;
  attempts: number;
  completed: number;
  averageDelta: number | null;
  verdict: 'Likely helpful' | 'Likely unhelpful' | 'Still learning';
};

export type RankedSleepSignal = {
  key: string;
  label: string;
  kind: 'factor' | 'experiment';
  count: number;
  averageDelta: number;
  confidence: 'Early signal' | 'Moderate confidence' | 'Stronger signal';
};

export function rankSleepSignals(
  checkins: ProgressCheckin[],
  commitments: ProgressCommitment[],
  points: SleepPoint[],
): RankedSleepSignal[] {
  const deltaByDate = new Map(rollingDeltas(points).map(point => [point.date, point.delta]));
  const evidence = new Map<string, { label: string; kind: RankedSleepSignal['kind']; deltas: number[] }>();
  const addEvidence = (key: string, label: string, kind: RankedSleepSignal['kind'], delta: number | null | undefined) => {
    if (typeof delta !== 'number') return;
    const existing = evidence.get(key) ?? { label, kind, deltas: [] };
    existing.deltas.push(delta);
    evidence.set(key, existing);
  };
  checkins.forEach(row => {
    if (row.suspected_factor && row.suspected_factor !== 'unknown') addEvidence(`factor:${row.suspected_factor}`, row.suspected_factor, 'factor', deltaByDate.get(row.checkin_date));
  });
  commitments.forEach(item => {
    if (item.status !== 'completed') return;
    const normalized = item.behavior.trim().toLowerCase();
    addEvidence(`experiment:${normalized}`, item.behavior.trim(), 'experiment', deltaByDate.get(addDays(item.behavior_date, 1)));
  });
  return [...evidence.entries()].flatMap(([key, item]) => {
    const averageDelta = Math.round(item.deltas.reduce((sum, delta) => sum + delta, 0) / item.deltas.length);
    if (item.deltas.length < 2 || Math.abs(averageDelta) < 4) return [];
    return [{
      key,
      label: item.label,
      kind: item.kind,
      count: item.deltas.length,
      averageDelta,
      confidence: item.deltas.length >= 5 ? 'Stronger signal' as const : item.deltas.length >= 3 ? 'Moderate confidence' as const : 'Early signal' as const,
    }];
  }).sort((a, b) => (b.count * Math.abs(b.averageDelta)) - (a.count * Math.abs(a.averageDelta))).slice(0, 3);
}

export function experimentInsights(commitments: ProgressCommitment[], points: SleepPoint[]): ExperimentInsight[] {
  const scoreByDate = new Map(rollingDeltas(points).map(point => [point.date, point]));
  const groups = new Map<string, ProgressCommitment[]>();
  for (const item of commitments) {
    const key = item.behavior.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].map(items => {
    const outcomes = items
      .filter(item => item.status === 'completed' || item.status === 'partial')
      .map(item => scoreByDate.get(addDays(item.behavior_date, 1))?.delta)
      .filter((value): value is number => typeof value === 'number');
    const averageDelta = outcomes.length ? Math.round(outcomes.reduce((sum, value) => sum + value, 0) / outcomes.length) : null;
    const verdict: ExperimentInsight['verdict'] = outcomes.length >= 2 && averageDelta !== null && averageDelta >= 3 ? 'Likely helpful'
      : outcomes.length >= 2 && averageDelta !== null && averageDelta <= -3 ? 'Likely unhelpful' : 'Still learning';
    return {
      behavior: items[0].behavior,
      attempts: items.length,
      completed: items.filter(item => item.status === 'completed').length,
      averageDelta,
      verdict,
    };
  }).sort((a, b) => b.attempts - a.attempts);
}

export function sleepProfileSummary(checkins: ProgressCheckin[], experiments: ExperimentInsight[], points: SleepPoint[]) {
  if (checkins.length < 2 && points.length < 2) return 'Your profile will become more personal as you check in and test small changes.';
  const feelings = feelingTrend(checkins);
  const helpful = experiments.find(item => item.verdict === 'Likely helpful');
  const factorCounts = new Map<string, number>();
  checkins.forEach(row => { if (row.suspected_factor) factorCounts.set(row.suspected_factor, (factorCounts.get(row.suspected_factor) ?? 0) + 1); });
  const factor = [...factorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const parts = [feelings.current ? `Your recent mornings most often feel ${feelings.current}` : null,
    helpful ? `${helpful.behavior} is emerging as a helpful pattern` : null,
    factor ? `${factor.toLowerCase()} is the factor you mention most often` : null].filter(Boolean);
  return `${parts.slice(0, 2).join('. ')}${parts.length ? '.' : 'We are still gathering enough signal to identify your strongest patterns.'}`;
}
