import type { TodaySnapshot } from './types';

// Report/commitment writes are outputs, so they must not schedule another
// request. Only evidence read from the repository can trigger revalidation.
export const dailyCoachingEvidence = (snapshot: TodaySnapshot): string | null =>
  snapshot.checkin && snapshot.sleepData.status !== 'missing'
    ? JSON.stringify([snapshot.date, snapshot.checkin, snapshot.sleepData, snapshot.previousCommitment])
    : null;
