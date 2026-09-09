import { parseCheckinInterpretation, type CheckinInterpretation } from './checkinReplyContract';
import { feelingOptions, type MorningFeeling } from './feeling';
import type { CommitmentStatus, DailyCheckinDraft, SuspectedFactorKey } from './types';

export type CheckinStep = 'sleep' | 'adherence' | 'feeling' | 'factor' | 'details';
export type CheckinTurn = { role: 'assistant' | 'user'; content: string };
export type CheckinConversation = {
  step: CheckinStep;
  turns: CheckinTurn[];
  morningFeeling?: MorningFeeling;
  suspectedFactor?: SuspectedFactorKey;
  adherence?: Exclude<CommitmentStatus, 'committed'>;
  commitmentId?: string;
};
export type CheckinChoice = { value: string; label: string };

export const initialCheckin: CheckinConversation = { step: 'sleep', turns: [] };
export const factorOptions: CheckinChoice[] = [
  { value: 'stress', label: 'Stress' },
  { value: 'late_meal', label: 'Late meal' },
  { value: 'alcohol', label: 'Alcohol' },
  { value: 'screens', label: 'Screens' },
  { value: 'temperature', label: 'Temperature' },
  { value: 'noise', label: 'Noise' },
  { value: 'unknown', label: 'Not sure' },
];
export const adherenceOptions: CheckinChoice[] = [
  { value: 'completed', label: 'Did it' },
  { value: 'partial', label: 'Partly' },
  { value: 'skipped', label: 'Not this time' },
];

export function checkinChoices(step: CheckinStep): CheckinChoice[] {
  if (step === 'adherence') return adherenceOptions;
  if (step === 'feeling') return [...feelingOptions];
  if (step === 'factor') return factorOptions;
  return [];
}

export function startCheckin(behavior?: string, commitmentId?: string): CheckinConversation {
  return {
    ...initialCheckin,
    commitmentId,
    step: behavior ? 'adherence' : 'feeling',
    turns: [{ role: 'assistant', content: behavior
      ? `How did it go with “${behavior}”?`
      : 'How are you feeling this morning?' }],
  };
}

export function appendCheckinReply(state: CheckinConversation, text: string): CheckinConversation {
  return text.trim() ? { ...state, turns: [...state.turns, { role: 'user', content: text.trim() }] } : state;
}

// Inline choices are explicit answers. Every typed reply is interpreted by the
// LLM before this transition; there is deliberately no keyword fallback.
export function answerCheckin(state: CheckinConversation, text: string, choice?: string, interpretation?: CheckinInterpretation): CheckinConversation {
  if (state.step === 'sleep' || !text.trim()) return state;
  const selected = checkinChoices(state.step).find(option => option.value === choice);
  const result = parseCheckinInterpretation(state.step, selected
    ? { addressed: true, answer: selected.value, finish: false, clarification: null }
    : interpretation);
  const next = appendCheckinReply(state, text);
  const ask = (content: string, step: CheckinStep) => ({ ...next, step, turns: [...next.turns, { role: 'assistant' as const, content }] });
  if (!result.addressed) return ask(result.clarification!, state.step);
  if (state.step === 'adherence') {
    next.adherence = result.answer as CheckinConversation['adherence'];
    return ask('How are you feeling this morning?', 'feeling');
  }
  if (state.step === 'feeling') {
    next.morningFeeling = result.answer as MorningFeeling;
    return ask('What do you think affected your sleep last night? You can pick one or tell me in your own words.', 'factor');
  }
  if (state.step === 'factor') {
    next.suspectedFactor = result.answer as SuspectedFactorKey | null ?? undefined;
    return ask('Anything else you’d like me to know? There’s room for the whole story, or you can finish here.', 'details');
  }
  return result.finish ? next : ask('I’ve added that. You can keep sharing, or finish whenever you’re ready.', 'details');
}

export function checkinDraft(state: CheckinConversation, manualSleepScore?: number): DailyCheckinDraft | null {
  if (!state.morningFeeling || state.step !== 'details') return null;
  return {
    morningFeeling: state.morningFeeling,
    manualSleepScore,
    suspectedFactor: state.suspectedFactor,
    // Keep question context alongside every unabridged reply for the coach.
    note: state.turns.map(turn => `${turn.role === 'assistant' ? 'Coach' : 'You'}: ${turn.content}`).join('\n\n'),
  };
}
