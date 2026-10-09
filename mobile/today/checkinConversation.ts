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
  suspectedFactors?: SuspectedFactorKey[];
  adherence?: Exclude<CommitmentStatus, 'committed'>;
  commitmentId?: string;
};
export type CheckinChoice = { value: string; label: string };

export const initialCheckin: CheckinConversation = { step: 'sleep', turns: [] };
export const MAX_CHECKIN_NOTE_LENGTH = 20_000;

// Journal consumers attribute this field to the user. The role-labelled
// conversation is kept separately in the local, same-day draft.
export const checkinNote = (state: CheckinConversation) => state.turns
  .filter(turn => turn.role === 'user')
  .map(turn => turn.content.trim())
  .filter(Boolean)
  .join('\n\n');

export const remainingCheckinCharacters = (state: CheckinConversation) => {
  const note = checkinNote(state);
  return Math.max(0, MAX_CHECKIN_NOTE_LENGTH - [...note].length - (note ? 2 : 0));
};

export function assertCheckinNoteLength(note: string) {
  if ([...note].length > MAX_CHECKIN_NOTE_LENGTH) {
    throw new Error('This check-in can hold 20,000 characters. Shorten this message, or finish here and keep chatting with your coach.');
  }
}
export const factorOptions: (CheckinChoice & { value: SuspectedFactorKey })[] = [
  { value: 'stress', label: 'Stress' },
  { value: 'caffeine', label: 'Caffeine' },
  { value: 'late_meal', label: 'Late meal' },
  { value: 'alcohol', label: 'Alcohol' },
  { value: 'screens', label: 'Screens' },
  { value: 'temperature', label: 'Temperature' },
  { value: 'noise', label: 'Noise' },
  { value: 'light', label: 'Light' },
  { value: 'exercise', label: 'Exercise' },
  { value: 'naps', label: 'Naps' },
  { value: 'irregular_schedule', label: 'Changed sleep schedule' },
  { value: 'travel', label: 'Travel / jet lag' },
  { value: 'illness', label: 'Illness' },
  { value: 'pain', label: 'Pain / discomfort' },
  { value: 'medication', label: 'Medication / supplements' },
  { value: 'bathroom', label: 'Bathroom trips' },
  { value: 'caregiving', label: 'Kids / caregiving' },
  { value: 'bed_partner', label: 'Partner / pets' },
  { value: 'wind_down', label: 'Wind-down routine' },
  { value: 'other', label: 'Something else' },
  { value: 'none', label: 'Nothing in particular' },
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
  if (!text.trim()) return state;
  const next: CheckinConversation = { ...state, turns: [...state.turns, { role: 'user', content: text.trim() }] };
  assertCheckinNoteLength(checkinNote(next));
  return next;
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
    return ask('What do you think affected your sleep last night? Choose all that apply, or tell me in your own words. Tap Next when you’re ready.', 'factor');
  }
  if (state.step === 'factor') {
    next.suspectedFactors = result.factors ?? (result.answer ? [result.answer as SuspectedFactorKey] : []);
    next.suspectedFactor = next.suspectedFactors[0];
    return ask('You can adjust your selections or add more detail. Tap Next when you’re ready.', 'factor');
  }
  if (result.factors !== undefined) {
    next.suspectedFactors = result.factors;
    next.suspectedFactor = result.factors[0];
  }
  return result.finish ? next : ask('I’ve added that. You can keep sharing, or finish whenever you’re ready.', 'details');
}

export function checkinDraft(state: CheckinConversation, manualSleepScore?: number): DailyCheckinDraft | null {
  if (!state.morningFeeling || state.step !== 'details') return null;
  const note = checkinNote(state);
  assertCheckinNoteLength(note);
  return {
    morningFeeling: state.morningFeeling,
    manualSleepScore,
    suspectedFactor: state.suspectedFactor,
    suspectedFactors: selectedCheckinFactors(state),
    note,
  };
}

export const selectedCheckinFactors = (state: CheckinConversation): SuspectedFactorKey[] =>
  state.suspectedFactors ?? (state.suspectedFactor ? [state.suspectedFactor] : []);

export function toggleCheckinFactor(state: CheckinConversation, factor: string): CheckinConversation {
  if (state.step !== 'factor' || !factorOptions.some(option => option.value === factor)) return state;
  const value = factor as SuspectedFactorKey;
  const current = selectedCheckinFactors(state);
  const factors = current.includes(value) ? current.filter(item => item !== value)
    : value === 'none' || value === 'unknown' ? [value]
    : [...current.filter(item => item !== 'none' && item !== 'unknown'), value];
  return { ...state, suspectedFactors: factors, suspectedFactor: factors[0] };
}

export function completeFactorSelection(state: CheckinConversation): CheckinConversation {
  if (state.step !== 'factor') return state;
  const factors = selectedCheckinFactors(state);
  const labels = factors.map(value => factorOptions.find(option => option.value === value)!.label);
  const next = appendCheckinReply(state, labels.length ? `Sleep factors: ${labels.join(', ')}.` : 'No sleep factors selected.');
  return { ...next, step: 'details', turns: [...next.turns, { role: 'assistant',
    content: 'Anything else you’d like me to know? There’s room for the whole story, or you can finish here.' }] };
}
