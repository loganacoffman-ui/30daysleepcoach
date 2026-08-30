export type CommitmentStatus = 'committed' | 'completed' | 'partial' | 'skipped';

export type SuspectedFactorKey =
  | 'stress'
  | 'late_meal'
  | 'alcohol'
  | 'screens'
  | 'temperature'
  | 'noise'
  | 'unknown';

export type BehaviorCommitment = {
  id: string;
  behaviorDate: string;
  behavior: string;
  why?: string;
  status: CommitmentStatus;
};

export type DailyCheckin = {
  id: string;
  checkinDate: string;
  feeling: number;
  manualSleepScore?: number;
  suspectedFactor?: SuspectedFactorKey;
  note?: string;
  completedAt: string;
};

export type TodaySnapshot = {
  date: string;
  dayNumber: number;
  greetingName?: string;
  coachingMessage?: string;
  commitment: BehaviorCommitment | null;
  previousCommitment: BehaviorCommitment | null;
  checkin: DailyCheckin | null;
  sleepData: {
    status: 'wearable' | 'manual' | 'missing';
    score: number | null;
    source: 'apple_health' | 'oura' | 'manual' | null;
  };
};

export type DailyCheckinDraft = {
  feeling: number;
  manualSleepScore?: number;
  suspectedFactor?: SuspectedFactorKey;
  note?: string;
};

export interface TodayRepository {
  loadToday(): Promise<TodaySnapshot>;
  saveCheckin(draft: DailyCheckinDraft): Promise<DailyCheckin>;
  saveManualSleepScore(score: number): Promise<void>;
  updateCommitmentStatus(id: string, status: Exclude<CommitmentStatus, 'committed'>): Promise<void>;
}
