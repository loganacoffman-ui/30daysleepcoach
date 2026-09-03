import type { PrimaryConcern } from '../onboarding/types';

export type StarterExperiment = {
  behavior: string;
  why: string;
  coachingNote: string;
};

export type ExperimentHistory = {
  behavior: string;
  status: 'committed' | 'completed' | 'partial' | 'skipped';
};

const experiments: Record<PrimaryConcern, StarterExperiment> = {
  falling_asleep: {
    behavior: 'Give yourself a 30-minute screen-free landing before bed.',
    why: 'A consistent low-stimulation transition can make it easier for your brain to shift out of problem-solving mode.',
    coachingNote: 'Dim the lights and choose something genuinely quiet—stretching, reading, or preparing for tomorrow.',
  },
  night_waking: {
    behavior: 'Keep the same wake-up time tomorrow, even after a disrupted night.',
    why: 'A steady morning anchor strengthens your body clock and helps sleep pressure build more predictably.',
    coachingNote: 'The goal is consistency, not forcing a perfect night.',
  },
  unrefreshed: {
    behavior: 'Get 10 minutes of outdoor light within an hour of waking.',
    why: 'Morning light gives your body clock a strong daytime signal and can support alertness now and sleep timing later.',
    coachingNote: 'Outside is more effective than light through a window—even on a cloudy morning.',
  },
  irregular_schedule: {
    behavior: 'Choose one wake-up time and stay within a 30-minute window tomorrow.',
    why: 'Wake time is often the most practical anchor for stabilizing the rest of your sleep schedule.',
    coachingNote: 'Protect the morning anchor first; bedtime can settle naturally around it.',
  },
  early_waking: {
    behavior: 'Keep the same wake-up time tomorrow, even after an early waking.',
    why: 'A steady morning anchor helps stabilize your sleep window without asking you to force more sleep.',
    coachingNote: 'Protect the wake-time anchor first and let later check-ins refine the experiment.',
  },
};

const followUps: Record<PrimaryConcern, StarterExperiment[]> = {
  falling_asleep: [
    { behavior:'Put your phone on charge outside arm’s reach 30 minutes before bed.', why:'Adding a little distance removes the easiest path back into stimulation.', coachingNote:'Pick the charging spot before the evening gets busy.' },
    { behavior:'Start a quiet wind-down at the same time tonight.', why:'A repeatable cue helps your brain anticipate the transition toward sleep.', coachingNote:'Keep it simple enough to repeat: dim lights, wash up, then one quiet activity.' },
  ],
  night_waking: [
    { behavior:'If you wake tonight, keep the clock out of view.', why:'Clock-checking can turn a normal awakening into a stressful calculation.', coachingNote:'Turn the display away before bed so you do not need willpower overnight.' },
    { behavior:'If an overnight waking becomes frustrating, move to a dim room and read until you feel sleepy again.', why:'Changing context can interrupt the cycle of lying awake and trying to force sleep.', coachingNote:'Set out a paper book and dim light before bed so the option is easy if you need it.' },
  ],
  unrefreshed: [
    { behavior:'Pair tomorrow’s morning light with a five-minute walk.', why:'Light plus gentle movement reinforces the daytime signal and supports alertness.', coachingNote:'This is not a workout. An easy walk is enough.' },
    { behavior:'Avoid using snooze tomorrow morning.', why:'Repeated short awakenings can leave the start of your day feeling more fragmented.', coachingNote:'Put the alarm where you need to stand up to turn it off.' },
  ],
  irregular_schedule: [
    { behavior:'Get outdoor light soon after your chosen wake-up time.', why:'Morning light helps reinforce the wake-time anchor you are building.', coachingNote:'Ten minutes outside is enough to make the cue concrete.' },
    { behavior:'Begin winding down within the same 30-minute window tonight.', why:'Once wake time is steadier, a consistent evening cue can support the other side of your rhythm.', coachingNote:'Aim for a window, not an exact minute.' },
  ],
  early_waking: [
    { behavior:'If you wake early, keep the clock out of view.', why:'Clock-checking can turn an early awakening into a stressful calculation.', coachingNote:'Turn the display away before bed so you do not need willpower overnight.' },
    { behavior:'Get outdoor light soon after your chosen wake-up time.', why:'Morning light helps reinforce the wake-time anchor you are building.', coachingNote:'Ten minutes outside is enough to make the cue concrete.' },
  ],
};

export const getStarterExperiment = (concern: PrimaryConcern) => experiments[concern];

export const getAdaptiveExperiment = (
  concern: PrimaryConcern,
  history: ExperimentHistory[],
): StarterExperiment & { decision: 'start' | 'repeat' | 'simplify' | 'advance' } => {
  const starter = experiments[concern];
  if (!history.length) return { ...starter, decision: 'start' };
  const latest = history[0];
  const program = [starter, ...followUps[concern]];
  const currentIndex = Math.max(0, program.findIndex(item => item.behavior === latest.behavior));

  if (latest.status === 'skipped') {
    return {
      behavior: `Try a smaller version: ${latest.behavior}`,
      why: 'Making the experiment easier helps you learn without turning sleep into homework.',
      coachingNote: 'Aim for roughly half the time or effort tonight. Showing up counts.',
      decision: 'simplify',
    };
  }
  if (latest.status === 'partial' || latest.status === 'committed') {
    const matched = program[currentIndex] ?? starter;
    return { ...matched, decision: 'repeat' };
  }
  return { ...program[Math.min(currentIndex + 1, program.length - 1)], decision: 'advance' };
};

export const localISODate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
