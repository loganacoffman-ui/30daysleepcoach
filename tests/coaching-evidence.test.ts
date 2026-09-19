import { describe, expect, it } from 'vitest';
import { dailyCoachingEvidence } from '../mobile/today/coachingEvidence';
import type { TodaySnapshot } from '../mobile/today/types';

const snapshot: TodaySnapshot = {
  date: '2026-08-27', dayNumber: 3,
  checkin: { id: 'checkin', checkinDate: '2026-08-27', morningFeeling: 'okay', completedAt: '2026-08-27T08:00:00Z' },
  sleepData: { status: 'wearable', score: 79, source: 'oura' },
  syncedSleep: { score: 79, source: 'oura' },
  dailyCoaching: null, commitment: null, previousCommitment: null,
};

describe('daily coaching revalidation trigger', () => {
  it('checks once on load and again for a changed sleep score or check-in', () => {
    const original = dailyCoachingEvidence(snapshot);
    expect(original).not.toBeNull();
    expect(dailyCoachingEvidence(structuredClone(snapshot))).toBe(original);
    expect(dailyCoachingEvidence({ ...snapshot, sleepData: { ...snapshot.sleepData, score: 88 } })).not.toBe(original);
    expect(dailyCoachingEvidence({ ...snapshot, checkin: { ...snapshot.checkin!, note: 'Late dinner' } })).not.toBe(original);
    expect(dailyCoachingEvidence({ ...snapshot, sleepData: { status: 'manual', score: 65, source: 'manual' } })).not.toBe(original);
  });

  it('does not request again when generation saves a report and commitment', () => {
    expect(dailyCoachingEvidence({
      ...snapshot,
      dailyCoaching: { pattern: 'Pattern', meaning: 'Meaning', action: 'Dim lights', generatedAt: '2026-08-27T08:01:00Z' },
      commitment: { id: 'new', behaviorDate: snapshot.date, behavior: 'Dim lights', status: 'committed' },
    })).toBe(dailyCoachingEvidence(snapshot));
  });

  it('waits for the check-in and scored sleep data', () => {
    expect(dailyCoachingEvidence({ ...snapshot, checkin: null })).toBeNull();
    expect(dailyCoachingEvidence({ ...snapshot, sleepData: { status: 'missing', score: null, source: null } })).toBeNull();
  });
});
