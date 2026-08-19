export type PrimaryConcern =
  | 'falling_asleep'
  | 'staying_asleep'
  | 'waking_tired'
  | 'schedule'
  | 'stress';

export type SleepProfile = {
  displayName: string;
  primaryConcern: PrimaryConcern;
  typicalBedtime: string;
  typicalWakeTime: string;
  timezone: string;
  goal: string;
  safetyConcern: boolean;
  onboardingCompletedAt: string;
};

export type OnboardingDraft = Omit<SleepProfile, 'onboardingCompletedAt'>;

