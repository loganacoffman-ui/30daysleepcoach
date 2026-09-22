import { loadRecentUserReports } from './personalization.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { resolveSleep, validSleepScore, type SleepEvidence } from './dailySleepContract.ts';

// All qualifying evidence is loaded with the authenticated user's client. Never
// accept a client-supplied wearable row or manual-submission marker as a gate.
export async function loadDailySleepContext(supabase: SupabaseClient, userId: string, date: string) {
  const start = new Date(`${date}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 13);
  const startDate = start.toISOString().slice(0, 10);
  const [checkins, nights, profile, adherence, oura, recentReports] = await Promise.all([
    supabase.from('daily_checkins').select('checkin_date, morning_feeling, feeling, manual_sleep_score, manual_sleep_submitted_at, suspected_factor, note, completed_at').eq('user_id', userId).gte('checkin_date', startDate).lte('checkin_date', date).order('checkin_date', { ascending: false }),
    supabase.from('sleep_nights').select('sleep_date, sleep_score, provider, score_version, total_sleep_minutes').eq('user_id', userId).gte('sleep_date', startDate).lte('sleep_date', date),
    supabase.from('sleep_profiles').select('primary_concern, typical_bedtime, typical_wake_time, timezone, preferred_sleep_source').eq('user_id', userId).maybeSingle(),
    supabase.from('behavior_commitments').select('behavior_date, behavior, status').eq('user_id', userId).gte('behavior_date', startDate).lt('behavior_date', date).order('behavior_date', { ascending: false }),
    supabase.functions.invoke('oura-proxy', { body: { endpoint: 'daily_sleep', start_date: startDate, end_date: date } }),
    loadRecentUserReports(supabase, userId),
  ]);
  for (const result of [checkins, nights, profile, adherence]) {
    if (result.error) throw result.error;
  }
  const rows: SleepEvidence[] = (nights.data ?? []).filter(row => validSleepScore(row.sleep_score)).map(row => ({
    day: row.sleep_date, score: row.sleep_score, source: row.provider,
    scoreVersion: row.score_version, totalSleepMinutes: row.total_sleep_minutes,
  }));
  if (!oura.error && Array.isArray(oura.data?.data)) {
    for (const row of oura.data.data) {
      if (typeof row.day === 'string' && row.day >= startDate && row.day <= date && validSleepScore(row.score)) {
        rows.unshift({ day: row.day, score: row.score, source: 'oura' });
      }
    }
  }
  const preferred = profile.data?.preferred_sleep_source ?? 'oura';
  const wearable = [...new Set(rows.map(row => row.day))].sort().reverse().map(day =>
    rows.find(row => row.day === day && row.source === preferred) ?? rows.find(row => row.day === day)!
  );
  const resolution = resolveSleep(date, wearable, checkins.data?.find(row => row.checkin_date === date));
  return {
    date, recent_user_reports: recentReports, profile: profile.data, subjective_checkins: checkins.data ?? [],
    experiment_adherence: adherence.data ?? [], wearable_sleep: wearable,
    sleep_resolution: resolution,
  };
}
