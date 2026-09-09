// Mobile API boundary: validate the JSON returned by sleep-coach without
// importing source from the separately deployed Supabase functions.
export const checkinAnswerValues = {
  adherence: ['completed', 'partial', 'skipped'],
  feeling: ['exhausted', 'tired', 'okay', 'rested', 'great'],
  factor: ['stress', 'late_meal', 'alcohol', 'screens', 'temperature', 'noise', 'unknown'],
  details: [],
} as const;

export type CheckinQuestion = keyof typeof checkinAnswerValues;
export type CheckinInterpretation = {
  addressed: boolean;
  answer: string | null;
  finish: boolean;
  clarification: string | null;
};
export function parseCheckinInterpretation(step: CheckinQuestion, value: unknown): CheckinInterpretation {
  if (!value || typeof value !== 'object') throw new Error('Invalid check-in interpretation.');
  const result = value as Record<string, unknown>;
  if (typeof result.addressed !== 'boolean' || typeof result.finish !== 'boolean' ||
    !(result.answer === null || (typeof result.answer === 'string' && (checkinAnswerValues[step] as readonly string[]).includes(result.answer))) ||
    !(result.clarification === null || (typeof result.clarification === 'string' && result.clarification.trim().length > 0 && result.clarification.length <= 400)) ||
    (!result.addressed && (!result.clarification || result.answer !== null || result.finish)) ||
    (result.addressed && result.clarification !== null) ||
    (result.addressed && (step === 'adherence' || step === 'feeling') && result.answer === null) ||
    (result.finish && (step !== 'details' || !result.addressed))) {
    throw new Error('Invalid check-in interpretation.');
  }
  return { addressed: result.addressed, answer: result.answer as string | null, finish: result.finish, clarification: result.clarification as string | null };
}
