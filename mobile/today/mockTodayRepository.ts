import type { DailyCheckin, DailyCheckinDraft, TodayRepository, TodaySnapshot } from './types';

const localISODate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

let savedCheckin: DailyCheckin | null = null;

export const mockTodayRepository: TodayRepository = {
  async loadToday() {
    await wait(350);

    const date = localISODate();
    const snapshot: TodaySnapshot = {
      date,
      greetingName: 'Logan',
      commitment: {
        id: 'mock-commitment',
        behaviorDate: date,
        behavior: 'Keep the same wake-up time—even after a rough night.',
        why: 'A steady morning anchor helps your sleep pressure and body clock line up tonight.',
        status: 'committed',
      },
      checkin: savedCheckin,
    };

    return snapshot;
  },

  async saveCheckin(draft: DailyCheckinDraft) {
    await wait(500);

    savedCheckin = {
      id: 'mock-checkin',
      checkinDate: localISODate(),
      feeling: draft.feeling,
      suspectedFactor: draft.suspectedFactor,
      note: draft.note?.trim() || undefined,
      completedAt: new Date().toISOString(),
    };

    return savedCheckin;
  },
};
