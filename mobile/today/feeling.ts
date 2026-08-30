export type MorningFeeling = 'exhausted' | 'tired' | 'okay' | 'rested' | 'great';

export const feelingOptions: ReadonlyArray<{ value: MorningFeeling; label: string }> = [
  { value: 'exhausted', label: 'Exhausted' },
  { value: 'tired', label: 'Tired' },
  { value: 'okay', label: 'Okay' },
  { value: 'rested', label: 'Rested' },
  { value: 'great', label: 'Great' },
] as const;

export const feelingLabel = (feeling: MorningFeeling) =>
  feelingOptions.find(option => option.value === feeling)?.label ?? 'Okay';

export const legacyFeelingToCategory = (score: number | null | undefined): MorningFeeling | null => {
  if (typeof score !== 'number') return null;
  if (score <= 20) return 'exhausted';
  if (score <= 40) return 'tired';
  if (score <= 60) return 'okay';
  if (score <= 80) return 'rested';
  return 'great';
};

export const normalizeMorningFeeling = (
  feeling: string | null | undefined,
  legacyScore?: number | null,
): MorningFeeling | null => {
  if (feelingOptions.some(option => option.value === feeling)) return feeling as MorningFeeling;
  return legacyFeelingToCategory(legacyScore);
};
