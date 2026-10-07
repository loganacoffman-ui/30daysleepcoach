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
  historySpacing: 'daily' | 'gaps';
  chatCount: number;
  chatTurns: number;
  memoryScenario: 'none' | 'preferences' | 'progress' | 'corrections';
  customMemories: string;
  wearableCount: number;
  scoreMode: 'manual' | 'wearable' | 'mixed';
  todayCommitment: 'none' | 'committed' | 'completed' | 'partial' | 'skipped';
};
export const defaultOptions: FixtureOptions = {
  emailConfirmed: true, onboardingStep: 'complete', checkinCount: 7,
  primaryConcern: 'night_waking', bedtime: '22:30', wakeTime: '06:30',
  timezone: 'America/Los_Angeles', reminderTime: '07:00', scheduleVaries: false,
  followUpAnswer: '30_to_60', trend: 'improving', feedback: true, includeToday: false,
  historySpacing: 'daily', chatCount: 0, chatTurns: 3, memoryScenario: 'none', customMemories: '',
  wearableCount: 0, scoreMode: 'manual', todayCommitment: 'committed',
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
  for (const [key, max] of [['chatCount', 20], ['chatTurns', 30], ['wearableCount', 90]] as const) {
    if (!Number.isInteger(v[key]) || v[key] < (key === 'chatTurns' ? 1 : 0) || v[key] > max) throw new TestUserError(`Invalid ${key} (maximum ${max}).`);
  }
  if (!['daily', 'gaps'].includes(v.historySpacing) || !['manual', 'wearable', 'mixed'].includes(v.scoreMode)
    || !['none', 'preferences', 'progress', 'corrections'].includes(v.memoryScenario)
    || !['none', 'committed', 'completed', 'partial', 'skipped'].includes(v.todayCommitment)) throw new TestUserError('Invalid history options.');
  if (typeof v.customMemories !== 'string' || v.customMemories.length > 6000
    || v.customMemories.split('\n').filter(line => line.trim()).length > 20
    || v.customMemories.split('\n').some(line => line.length > 300)) throw new TestUserError('Use up to 20 memory facts, one per line, at most 300 characters each.');
  v.customMemories = v.customMemories.trim();
  if (v.onboardingStep !== 'complete' && (v.chatCount || v.wearableCount || v.memoryScenario !== 'none' || v.customMemories)) {
    throw new TestUserError('Complete onboarding before adding chat, memory, or wearable history.');
  }
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
  const historyDay = (i: number, count: number) => addDays(today, -(count - 1 - i) * (o.historySpacing === 'gaps' ? 2 : 1) - (o.includeToday ? 0 : 1));
  const sleepNights = Array.from({ length: o.wearableCount }, (_, i) => {
    const day = historyDay(i, o.wearableCount);
    const duration = 360 + (i % 5) * 15;
    return {
      provider: 'apple_health', sleep_date: day, sleep_score: 65 + (i % 6) * 4,
      score_version: 'synthetic-v1', total_sleep_minutes: duration, awake_minutes: 30,
      in_bed_minutes: duration + 30, rem_minutes: 80, deep_minutes: 60, core_minutes: duration - 140,
      sleep_efficiency: duration / (duration + 30), source_name: 'Synthetic Apple Health',
      timezone: o.timezone, synced_at: `${day}T12:00:00Z`,
    };
  });
  const checkins = Array.from({ length: o.checkinCount }, (_, i) => {
    const day = historyDay(i, o.checkinCount);
    const manual = o.scoreMode === 'manual' || (o.scoreMode === 'mixed' && i % 2 === 0);
    const variation = [0, -5, 3, -2, 5, -3, 1][i % 7];
    const score = Math.round(o.trend === 'improving' ? 52 + 30 * (i + 1) / o.checkinCount + variation
      : o.trend === 'struggling' ? 45 + variation : 64 + variation * 3);
    return {
      checkin_date: day, timezone: o.timezone, morning_feeling: score >= 80 ? 'great' : score >= 70 ? 'rested' : score >= 55 ? 'okay' : 'tired',
      feeling: score, suspected_factor: i % 3 === 0 ? 'stress' : 'screens',
      note: `[Synthetic test data] ${i % 3 === 0 ? 'A busy evening made it harder to settle.' : 'Tried the planned wind-down routine.'}`,
      manual_sleep_score: manual ? score : null, manual_sleep_submitted_at: manual ? `${day}T12:00:00Z` : null, completed_at: `${day}T12:00:00Z`,
    };
  });
  const recommendations = o.feedback ? checkins.filter(row => row.manual_sleep_score !== null || sleepNights.some(night => night.sleep_date === row.checkin_date)).map(row => ({
    recommendation_date: row.checkin_date,
    pattern: `[Synthetic feedback] ${o.trend === 'improving' ? 'Your recent sleep ratings are trending upward.' : o.trend === 'struggling' ? 'Your recent mornings have felt difficult.' : 'Your sleep ratings have varied from day to day.'}`,
    meaning: 'This is a generated testing example, not a clinical assessment.',
    action: experiment, why: 'Keep one small experiment consistent so its results are easier to compare.',
    prompt_version: DAILY_COACH_PROMPT_VERSION, model: TEST_USER_TAG,
    source_context: { synthetic: true, sleep_resolution_key: sleepResolutionKey(resolveSleep(row.checkin_date, sleepNights.map(night => ({ day: night.sleep_date, score: night.sleep_score, source: night.provider })), row)) },
    generated_at: row.completed_at,
  })) : [];
  const commitments = checkins.map((row, i) => ({
    behavior_date: row.checkin_date, behavior: experiment,
    status: ['completed', 'partial', 'completed', 'skipped'][i % 4],
  }));
  const todayIndex = commitments.findIndex(row => row.behavior_date === today);
  if (todayIndex >= 0) commitments.splice(todayIndex, 1);
  if (o.onboardingStep === 'complete' && o.todayCommitment !== 'none') {
    commitments.push({ behavior_date: today, behavior: experiment, status: o.todayCommitment });
  }
  const conversations = Array.from({ length: o.chatCount }, (_, i) => {
    const day = historyDay(i, o.chatCount);
    const scripts = [
      ['Evening routine', `I want to wind down before my ${o.bedtime} bedtime. I often scroll in bed.`, 'What feels realistic for your evening?', 'I can charge my phone outside the bedroom and read a paper book for ten minutes.', 'Let’s try that small change and notice how settling down feels.'],
      ['Experiment follow-up', 'I tried a ten-minute wind-down on three evenings. Two mornings felt easier, but one was still rough.', 'That gives us a useful starting point. What got in the way on the rough night?', 'Work ran late and I skipped the routine. I want to keep trying this week.', 'We can keep the experiment small enough to fit a busy evening.'],
      ['Correcting my context', 'My old routine included coffee at 4 pm and late work calls.', 'Is that still your current routine?', 'Correction: I now stop coffee at noon, and the late work project ended. Please use this as my current routine.', 'Understood. I’ll treat the afternoon coffee and late calls as past context.'],
    ];
    const script = scripts[i % scripts.length];
    const messages = Array.from({ length: o.chatTurns * 2 }, (_, m) => ({
      role: m % 2 === 0 ? 'user' : 'assistant',
      content: m < 4 ? script[m + 1] : m % 2 === 0
        ? `Follow-up ${Math.floor(m / 2)}: ${o.trend === 'struggling' ? 'This is still difficult to fit into my evenings.' : 'I am continuing the routine and noting how I feel.'}`
        : 'Keep noting what you actually tried and how the next morning felt. We can review the pattern together.',
      created_at: new Date(Date.parse(`${day}T12:00:00Z`) + m * 60000).toISOString(),
      metadata: { synthetic: true, model: TEST_USER_TAG },
    }));
    return { title: `[Synthetic] ${script[0]} ${i + 1}`, created_at: messages[0].created_at, updated_at: messages.at(-1)!.created_at, messages };
  });
  const memories: string[] = [];
  if (o.memoryScenario !== 'none') memories.push(
    `My sleep goal is a consistent ${o.bedtime} bedtime and ${o.wakeTime} wake time in ${o.timezone}.`,
    'I prefer short practical suggestions and a paper book instead of screens during wind-down.',
    'Busy work evenings make it harder for me to follow my wind-down routine.',
  );
  if (o.memoryScenario === 'progress') memories.push(
    `As of ${today}, I tried a ten-minute wind-down on three evenings; two mornings felt easier and one still felt rough.`,
    `As of ${today}, I want to continue the wind-down experiment for another week.`,
  );
  if (o.memoryScenario === 'corrections') memories.push(
    `Historical routine, ended before ${today}: I used to drink coffee at 4 pm and work late calls.`,
    `Correction as of ${today}: I now stop coffee at noon. My late work project has ended; afternoon coffee and late calls are no longer current.`,
    `Resolved event as of ${today}: I returned home after a work trip and am back in my usual time zone, ${o.timezone}.`,
  );
  memories.push(...o.customMemories.split('\n').map(line => line.trim()).filter(Boolean));
  return {
    options: o,
    profile: {
      primary_concern: step >= 2 ? o.primaryConcern : null,
      typical_bedtime: step >= 3 ? o.bedtime : null, typical_wake_time: step >= 3 ? o.wakeTime : null,
      timezone: o.timezone, preferred_sleep_source: o.wearableCount ? 'apple_health' : null, intake_answers: answers, intake_version: 1,
      onboarding_completed_at: o.onboardingStep === 'complete' ? `${checkins[0]?.checkin_date ?? today}T00:00:00Z` : null,
    }, checkins, recommendations, commitments, conversations, memories, sleepNights,
    entries: checkins.map(row => ({ date: new Date(`${row.checkin_date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }), ts: Date.parse(row.completed_at), hrv: 40 + row.feeling % 25,
      sleep_score: row.feeling, bedtime: o.bedtime, waketime: o.wakeTime, night_wake: row.feeling >= 70 ? 'back_quick' : 'back_slow',
      note: row.note, pos: ['Consistent bedtime'], neg: row.suspected_factor === 'stress' ? ['Stress'] : [],
    })),
  };
}
