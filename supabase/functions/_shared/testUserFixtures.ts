import { DAILY_COACH_PROMPT_VERSION, resolveSleep, sleepResolutionKey } from './dailySleepContract.ts';

export const TEST_USER_TAG = 'sleepcoach-test-v1';
export const TEST_EMAIL_PREFIX = 'sleepcoach-test+';
export const concerns = ['falling_asleep', 'night_waking', 'early_waking', 'unrefreshed', 'irregular_schedule'] as const;
export const onboardingSteps = ['intro', 'concern', 'window', 'followup', 'results', 'wearable', 'reminder', 'complete'] as const;
export class TestUserError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export type FixtureOptions = {
  emailConfirmed: boolean;
  onboardingStep: typeof onboardingSteps[number];
  checkinCount: number;
  primaryConcern: typeof concerns[number];
  bedtime: string;
  wakeTime: string;
  timezone: string;
  reminderTime: string;
  scheduleVaries: boolean;
  followUpAnswer: string;
  trend: 'improving' | 'mixed' | 'struggling';
  feedback: boolean;
  includeToday: boolean;
};
export const defaultOptions: FixtureOptions = {
  emailConfirmed: true, onboardingStep: 'complete', checkinCount: 7,
  primaryConcern: 'night_waking', bedtime: '22:30', wakeTime: '06:30',
  timezone: 'America/Los_Angeles', reminderTime: '07:00', scheduleVaries: false,
  followUpAnswer: '30_to_60', trend: 'improving', feedback: true, includeToday: false,
};
export function testEmail(alias: unknown, domain = 'example.test') {
  if (typeof alias !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(alias)) {
    throw new TestUserError('Use a test name of 1–32 lowercase letters, numbers, or hyphens.');
  }
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new TestUserError('The test email domain is not configured correctly.', 503);
  }
  return `${TEST_EMAIL_PREFIX}${alias}@${domain}`;
}
export function parseOptions(input: unknown): FixtureOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TestUserError('Choose a test scenario.');
  const v = { ...defaultOptions, ...input } as FixtureOptions;
  for (const key of ['emailConfirmed', 'scheduleVaries', 'feedback', 'includeToday'] as const) {
    if (typeof v[key] !== 'boolean') throw new TestUserError(`Invalid ${key}.`);
  }
  if (!onboardingSteps.includes(v.onboardingStep) || !concerns.includes(v.primaryConcern)
    || !['improving', 'mixed', 'struggling'].includes(v.trend)) throw new TestUserError('Invalid scenario options.');
  if (!Number.isInteger(v.checkinCount) || v.checkinCount < 0 || v.checkinCount > 90) throw new TestUserError('Choose 0–90 check-ins.');
  if (v.onboardingStep !== 'complete' && v.checkinCount !== 0) throw new TestUserError('Incomplete onboarding requires zero check-ins.');
  for (const key of ['bedtime', 'wakeTime', 'reminderTime'] as const) {
    if (typeof v[key] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v[key])) throw new TestUserError('Use valid 24-hour times.');
  }
  if (v.bedtime === v.wakeTime) throw new TestUserError('Bedtime and wake time must differ.');
  try {
    if (typeof v.timezone !== 'string' || v.timezone.length > 100) throw new Error();
    new Intl.DateTimeFormat('en', { timeZone: v.timezone }).format();
  } catch { throw new TestUserError('Choose a valid IANA time zone.'); }
  const answers = ['unrefreshed', 'irregular_schedule'].includes(v.primaryConcern)
    ? ['scrolling_in_bed', 'trying_to_sleep', 'varies'] : ['under_30', '30_to_60', 'over_60'];
  if (!answers.includes(v.followUpAnswer)) throw new TestUserError('Choose a follow-up answer matching the sleep concern.');
  // Return only supported options, never arbitrary properties from the request.
  return Object.fromEntries(Object.keys(defaultOptions).map(key => [key, v[key as keyof FixtureOptions]])) as FixtureOptions;
}
export function assertTestTarget(user: { id: string; email?: string; app_metadata?: Record<string, unknown> }, registry: { user_id: string; email: string; marker: string }) {
  if (user.id !== registry.user_id || user.email !== registry.email
    || !/^sleepcoach-test\+[a-z0-9][a-z0-9-]{0,31}@/.test(user.email ?? '')
    || user.app_metadata?.test_user_tool !== TEST_USER_TAG
    || user.app_metadata?.test_user_marker !== registry.marker
    || user.app_metadata?.role === 'admin') throw new TestUserError('Safety check failed: this is not a managed test account.', 403);
}
const addDays = (day: string, offset: number) => new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
export function buildFixtures(options: FixtureOptions, now = new Date()) {
  const o = options;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: o.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const experiment = o.primaryConcern === 'falling_asleep'
    ? `Dim lights and put screens away before your ${o.bedtime} bedtime.`
    : `Keep a consistent ${o.wakeTime} wake time, including weekends.`;
  const step = onboardingSteps.indexOf(o.onboardingStep);
  const answers: Record<string, unknown> = { current_step: o.onboardingStep, timezone: o.timezone };
  if (step >= 2) answers.primary_concern = o.primaryConcern;
  if (step >= 3) Object.assign(answers, {
    typical_bedtime: o.bedtime, typical_wake_time: o.wakeTime, schedule_varies: o.scheduleVaries,
    time_in_bed_minutes: (minutes(o.wakeTime) - minutes(o.bedtime) + 1440) % 1440,
  });
  if (step >= 4) Object.assign(answers, {
    follow_up_key: o.primaryConcern === 'falling_asleep' ? 'sleep_latency'
      : ['night_waking', 'early_waking'].includes(o.primaryConcern) ? 'wake_duration' : 'bed_behavior',
    follow_up_answer: o.followUpAnswer, first_experiment: experiment,
  });
  if (step >= 7) answers.reminder_time = o.reminderTime;
  const checkins = Array.from({ length: o.checkinCount }, (_, i) => {
    const day = addDays(today, i - o.checkinCount + (o.includeToday ? 1 : 0));
    const variation = [0, -5, 3, -2, 5, -3, 1][i % 7];
    const score = Math.round(o.trend === 'improving' ? 52 + 30 * (i + 1) / o.checkinCount + variation
      : o.trend === 'struggling' ? 45 + variation : 64 + variation * 3);
    return {
      checkin_date: day, timezone: o.timezone, morning_feeling: score >= 80 ? 'great' : score >= 70 ? 'rested' : score >= 55 ? 'okay' : 'tired',
      feeling: score, suspected_factor: i % 3 === 0 ? 'stress' : 'screens',
      note: `[Synthetic test data] ${i % 3 === 0 ? 'A busy evening made it harder to settle.' : 'Tried the planned wind-down routine.'}`,
      manual_sleep_score: score, manual_sleep_submitted_at: `${day}T12:00:00Z`, completed_at: `${day}T12:00:00Z`,
    };
  });
  const recommendations = o.feedback ? checkins.map(row => ({
    recommendation_date: row.checkin_date,
    pattern: `[Synthetic feedback] ${o.trend === 'improving' ? 'Your recent sleep ratings are trending upward.' : o.trend === 'struggling' ? 'Your recent mornings have felt difficult.' : 'Your sleep ratings have varied from day to day.'}`,
    meaning: 'This is a generated testing example, not a clinical assessment.',
    action: experiment, why: 'Keep one small experiment consistent so its results are easier to compare.',
    prompt_version: DAILY_COACH_PROMPT_VERSION, model: TEST_USER_TAG,
    source_context: { synthetic: true, sleep_resolution_key: sleepResolutionKey(resolveSleep(row.checkin_date, [], row)) },
    generated_at: row.completed_at,
  })) : [];
  const commitments = checkins.map((row, i) => ({
    behavior_date: row.checkin_date, behavior: experiment,
    status: ['completed', 'partial', 'completed', 'skipped'][i % 4],
  }));
  if (o.onboardingStep === 'complete' && !commitments.some(row => row.behavior_date === today)) {
    commitments.push({ behavior_date: today, behavior: experiment, status: 'committed' });
  }
  return {
    options: o,
    profile: {
      primary_concern: step >= 2 ? o.primaryConcern : null,
      typical_bedtime: step >= 3 ? o.bedtime : null, typical_wake_time: step >= 3 ? o.wakeTime : null,
      timezone: o.timezone, intake_answers: answers, intake_version: 1,
      onboarding_completed_at: o.onboardingStep === 'complete' ? `${checkins[0]?.checkin_date ?? today}T00:00:00Z` : null,
    }, checkins, recommendations, commitments,
    entries: checkins.map(row => ({ date: new Date(`${row.checkin_date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }), ts: Date.parse(row.completed_at), hrv: 40 + row.manual_sleep_score % 25,
      sleep_score: row.manual_sleep_score, bedtime: o.bedtime, waketime: o.wakeTime, night_wake: row.manual_sleep_score >= 70 ? 'back_quick' : 'back_slow',
      note: row.note, pos: ['Consistent bedtime'], neg: row.suspected_factor === 'stress' ? ['Stress'] : [],
    })),
  };
}
