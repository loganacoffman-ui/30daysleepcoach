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
  runDay?: number;
  runLength?: number;
};

export type DailyCheckin = {
  id: string;
  checkinDate: string;
  morningFeeling: MorningFeeling;
  manualSleepScore?: number;
  suspectedFactor?: SuspectedFactorKey;
  note?: string;
  completedAt: string;
};

export type DailyCoachingReport = {
  pattern: string;
  meaning: string;
  action: string;
  generatedAt: string;
  decision?: 'continue' | 'simplify' | 'replace' | 'clarify';
  why?: string;
};

export type TodaySnapshot = {
  date: string;
  dayNumber: number;
  greetingName?: string;
  coachingMessage?: string;
  commitment: BehaviorCommitment | null;
  previousCommitment: BehaviorCommitment | null;
  checkin: DailyCheckin | null;
  // Paint the stored report while the server checks whether its evidence changed.
  dailyCoaching: DailyCoachingReport | null;
  sleepData: {
    status: 'wearable' | 'manual' | 'missing';
    score: number | null;
    source: 'apple_health' | 'oura' | 'manual' | null;
  };
  // What the wearable reported for the night, kept alongside sleepData so a day
  // the user scored themselves can still show, and go back to, the synced number.
  syncedSleep: {
    score: number;
    source: 'apple_health' | 'oura';
  } | null;
};

export type DailyCheckinDraft = {
  morningFeeling: MorningFeeling;
  manualSleepScore?: number;
  suspectedFactor?: SuspectedFactorKey;
  note?: string;
};

export interface TodayRepository {
  loadToday(): Promise<TodaySnapshot>;
  saveCheckin(draft: DailyCheckinDraft): Promise<DailyCheckin>;
  saveManualSleepScore(score: number): Promise<void>;
  // Drops the user's own score for today, handing the night back to the wearable.
  clearManualSleepScore(): Promise<void>;
  updateCommitmentStatus(id: string, status: Exclude<CommitmentStatus, 'committed'>): Promise<void>;
}
import type { MorningFeeling } from './feeling';
