export type PrimaryConcern =
  | 'falling_asleep'
  | 'night_waking'
  | 'early_waking'
  | 'unrefreshed'
  | 'irregular_schedule';

export type SleepSource = 'apple_health' | 'oura';

export type SleepProfile = {
  displayName: string;
  primaryConcern: PrimaryConcern;
  typicalBedtime: string;
  typicalWakeTime: string;
  timezone: string;
  preferredSleepSource: SleepSource | null;
  reminderTime: string;
  firstExperiment: string;
  onboardingCompletedAt: string;
};
