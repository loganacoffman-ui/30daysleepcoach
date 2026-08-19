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
  staying_asleep: {
    behavior: 'Keep the same wake-up time tomorrow, even after a disrupted night.',
    why: 'A steady morning anchor strengthens your body clock and helps sleep pressure build more predictably.',
    coachingNote: 'The goal is consistency, not forcing a perfect night.',
  },
  waking_tired: {
    behavior: 'Get 10 minutes of outdoor light within an hour of waking.',
    why: 'Morning light gives your body clock a strong daytime signal and can support alertness now and sleep timing later.',
    coachingNote: 'Outside is more effective than light through a window—even on a cloudy morning.',
  },
  schedule: {
    behavior: 'Choose one wake-up time and stay within a 30-minute window tomorrow.',
    why: 'Wake time is often the most practical anchor for stabilizing the rest of your sleep schedule.',
    coachingNote: 'Protect the morning anchor first; bedtime can settle naturally around it.',
  },
  stress: {
    behavior: 'Do a five-minute brain dump at least 30 minutes before bed.',
    why: 'Putting unfinished thoughts somewhere concrete can reduce the pressure to keep rehearsing them in bed.',
    coachingNote: 'Write fragments, not an essay. The aim is to unload, not solve everything tonight.',
  },
};

const followUps: Record<PrimaryConcern, StarterExperiment[]> = {
  falling_asleep: [
    { behavior:'Put your phone on charge outside arm’s reach 30 minutes before bed.', why:'Adding a little distance removes the easiest path back into stimulation.', coachingNote:'Pick the charging spot before the evening gets busy.' },
    { behavior:'Start a quiet wind-down at the same time tonight.', why:'A repeatable cue helps your brain anticipate the transition toward sleep.', coachingNote:'Keep it simple enough to repeat: dim lights, wash up, then one quiet activity.' },
  ],
  staying_asleep: [
    { behavior:'If you wake tonight, keep the clock out of view.', why:'Clock-checking can turn a normal awakening into a stressful calculation.', coachingNote:'Turn the display away before bed so you do not need willpower overnight.' },
    { behavior:'Keep your bedroom cool, dark, and quiet tonight.', why:'A stable sleep environment reduces avoidable signals that can interrupt sleep.', coachingNote:'Change only what is easy—temperature, an eye mask, or steady background sound.' },
  ],
  waking_tired: [
    { behavior:'Pair tomorrow’s morning light with a five-minute walk.', why:'Light plus gentle movement reinforces the daytime signal and supports alertness.', coachingNote:'This is not a workout. An easy walk is enough.' },
    { behavior:'Avoid using snooze tomorrow morning.', why:'Repeated short awakenings can leave the start of your day feeling more fragmented.', coachingNote:'Put the alarm where you need to stand up to turn it off.' },
  ],
  schedule: [
    { behavior:'Get outdoor light soon after your chosen wake-up time.', why:'Morning light helps reinforce the wake-time anchor you are building.', coachingNote:'Ten minutes outside is enough to make the cue concrete.' },
    { behavior:'Begin winding down within the same 30-minute window tonight.', why:'Once wake time is steadier, a consistent evening cue can support the other side of your rhythm.', coachingNote:'Aim for a window, not an exact minute.' },
  ],
  stress: [
    { behavior:'Choose one worry from your brain dump and write the next tiny step.', why:'A concrete next action can help your mind stop treating the issue as unfinished overnight.', coachingNote:'The step should take less than ten minutes tomorrow.' },
    { behavior:'Practice five slow breaths after getting into bed.', why:'A brief, repeatable pause can lower activation without turning relaxation into another task.', coachingNote:'Let the exhale be slightly longer than the inhale.' },
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
