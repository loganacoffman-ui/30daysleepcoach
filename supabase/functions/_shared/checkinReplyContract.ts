export const checkinAnswerValues = {
  adherence: ['completed', 'partial', 'skipped'],
  feeling: ['exhausted', 'tired', 'okay', 'rested', 'great'],
  factor: ['stress', 'caffeine', 'late_meal', 'alcohol', 'screens', 'temperature', 'noise', 'light', 'exercise', 'naps', 'irregular_schedule', 'travel', 'illness', 'pain', 'medication', 'bathroom', 'caregiving', 'bed_partner', 'wind_down', 'other', 'none', 'unknown'],
  details: [],
} as const;

export type SleepFactor = typeof checkinAnswerValues.factor[number];
export function validSleepFactors(value: unknown): value is SleepFactor[] {
  return Array.isArray(value) && value.length <= checkinAnswerValues.factor.length &&
    value.every(factor => (checkinAnswerValues.factor as readonly unknown[]).includes(factor)) &&
    new Set(value).size === value.length &&
    !(value.length > 1 && (value.includes('none') || value.includes('unknown')));
}

export type CheckinQuestion = keyof typeof checkinAnswerValues;
export type CheckinInterpretation = {
  addressed: boolean;
  answer: string | null;
  factors?: SleepFactor[];
  finish: boolean;
  clarification: string | null;
};
export type CheckinReplyRequest = {
  step: CheckinQuestion;
  message: string;
  selectedFactors?: SleepFactor[];
  turns: { role: 'assistant' | 'user'; content: string }[];
};

export function parseCheckinReplyRequest(value: unknown): CheckinReplyRequest {
  if (!value || typeof value !== 'object') throw new Error('A check-in reply is required.');
  const request = value as Record<string, unknown>;
  if ((request.selectedFactors !== undefined && !validSleepFactors(request.selectedFactors)) ||
    typeof request.step !== 'string' || !Object.hasOwn(checkinAnswerValues, request.step) ||
    typeof request.message !== 'string' || !request.message.trim() || request.message.length > 4000 ||
    !Array.isArray(request.turns) || request.turns.length === 0 || request.turns.length > 20 ||
    request.turns.some(turn => !turn || !['assistant', 'user'].includes(turn.role) || typeof turn.content !== 'string' || turn.content.length > 4000)) {
    throw new Error('Invalid check-in reply.');
  }
  return { ...(request.selectedFactors !== undefined ? { selectedFactors: request.selectedFactors as SleepFactor[] } : {}), step: request.step as CheckinQuestion, message: request.message.trim(), turns: request.turns };
}

export function parseCheckinInterpretation(step: CheckinQuestion, value: unknown): CheckinInterpretation {
  if (!value || typeof value !== 'object') throw new Error('Invalid check-in interpretation.');
  const result = value as Record<string, unknown>;
  if ((result.factors !== undefined && (!validSleepFactors(result.factors) ||
    (!['factor', 'details'].includes(step) && result.factors.length > 0) ||
    (!result.addressed && result.factors.length > 0))) ||
    typeof result.addressed !== 'boolean' || typeof result.finish !== 'boolean' ||
    !(result.answer === null || (typeof result.answer === 'string' && (checkinAnswerValues[step] as readonly string[]).includes(result.answer))) ||
    !(result.clarification === null || (typeof result.clarification === 'string' && result.clarification.trim().length > 0 && result.clarification.length <= 400)) ||
    (!result.addressed && (!result.clarification || result.answer !== null || result.finish)) ||
    (result.addressed && result.clarification !== null) ||
    (result.addressed && (step === 'adherence' || step === 'feeling') && result.answer === null) ||
    (result.finish && (step !== 'details' || !result.addressed))) {
    throw new Error('Invalid check-in interpretation.');
  }
  return { ...(result.factors !== undefined ? { factors: result.factors as SleepFactor[] } : {}), addressed: result.addressed, answer: result.answer as string | null, finish: result.finish, clarification: result.clarification as string | null };
}
