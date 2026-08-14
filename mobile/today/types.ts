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
  suspectedFactor?: SuspectedFactorKey;
  note?: string;
  completedAt: string;
};

export type TodaySnapshot = {
  date: string;
  greetingName?: string;
  commitment: BehaviorCommitment | null;
  checkin: DailyCheckin | null;
};

export type DailyCheckinDraft = {
  feeling: number;
  suspectedFactor?: SuspectedFactorKey;
  note?: string;
};

export interface TodayRepository {
  loadToday(): Promise<TodaySnapshot>;
  saveCheckin(draft: DailyCheckinDraft): Promise<DailyCheckin>;
}
