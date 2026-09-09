import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkinAnswerValues } from './checkinReplyContract';
import { assertCheckinNoteLength, checkinNote, type CheckinConversation } from './checkinConversation';
import type { TodaySnapshot } from './types';

type SleepData = TodaySnapshot['sleepData'];
export type StoredCheckinDraft = {
  conversation: CheckinConversation;
  input: string;
  manualSleepScore: number | null;
  manualSleepFallback: boolean;
  sleepReviewed: boolean;
  reviewedSleepData: SleepData | null;
};

const prefix = 'sleep-coach:checkin-draft:';
const userPrefix = (userId: string) => `${prefix}${userId}:`;
export const checkinStorageKey = (userId: string, date: string) => `${userPrefix(userId)}${date}`;
export const localCheckinDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const validScore = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
function validSleepData(value: unknown): value is SleepData {
  if (!value || typeof value !== 'object') return false;
  const data = value as SleepData;
  return validScore(data.score) && ((data.status === 'manual' && data.source === 'manual') ||
    (data.status === 'wearable' && (data.source === 'apple_health' || data.source === 'oura')));
}

export function restoreCheckinDraft(raw: string, currentSleepData: SleepData): StoredCheckinDraft | null {
  try {
    const draft = JSON.parse(raw);
    const conversation = draft.conversation;
    if (!conversation || !['sleep', 'adherence', 'feeling', 'factor', 'details'].includes(conversation.step) ||
      !Array.isArray(conversation.turns) || conversation.turns.some((turn: { role?: unknown; content?: unknown } | null) =>
        !turn || !['assistant', 'user'].includes(String(turn.role)) || typeof turn.content !== 'string') ||
      (conversation.morningFeeling !== undefined && !checkinAnswerValues.feeling.includes(conversation.morningFeeling)) ||
      (conversation.suspectedFactor !== undefined && !checkinAnswerValues.factor.includes(conversation.suspectedFactor)) ||
      (conversation.adherence !== undefined && !checkinAnswerValues.adherence.includes(conversation.adherence)) ||
      (conversation.commitmentId !== undefined && typeof conversation.commitmentId !== 'string') ||
      (['factor', 'details'].includes(conversation.step) && !conversation.morningFeeling)) return null;
    assertCheckinNoteLength(checkinNote(conversation));
    const manualSleepScore = validScore(draft.manualSleepScore) ? draft.manualSleepScore : null;
    // Pre-existing drafts already advanced the conversation when Continue was
    // tapped. Recover that milestone even though the old boolean was not saved.
    const sleepReviewed = conversation.step !== 'sleep' && draft.sleepReviewed !== false;
    const reviewedSleepData = validSleepData(draft.reviewedSleepData) ? draft.reviewedSleepData
      : sleepReviewed && validSleepData(currentSleepData) ? currentSleepData
      : sleepReviewed && manualSleepScore !== null ? { status: 'manual' as const, source: 'manual' as const, score: manualSleepScore }
      : null;
    return {
      conversation,
      input: typeof draft.input === 'string' ? draft.input : '',
      manualSleepScore,
      manualSleepFallback: draft.manualSleepFallback === true,
      sleepReviewed: sleepReviewed && reviewedSleepData !== null,
      reviewedSleepData,
    };
  } catch { return null; }
}

type Storage = Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'getAllKeys' | 'multiRemove'>;

export function createCheckinDraftStorage(storage: Storage, today = localCheckinDate) {
  // Serializing writes and cleanup ensures a late in-flight save cannot recreate
  // health notes after logout/deletion. Only a new auth session unblocks writes.
  let pending: Promise<unknown> = Promise.resolve();
  const blockedUsers = new Set<string>();
  const enqueue = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation, operation);
    pending = result.catch(() => undefined);
    return result;
  };
  const remove = async (matches: (key: string) => boolean) => {
    const keys = (await storage.getAllKeys()).filter(matches);
    if (keys.length) await storage.multiRemove(keys);
  };
  return {
    allowUser(userId: string) { blockedUsers.delete(userId); },
    clearSignedOutDrafts() {
      return enqueue(() => remove(key => key.startsWith(prefix)));
    },
    clearUser(userId: string) {
      blockedUsers.add(userId);
      return enqueue(() => remove(key => key.startsWith(userPrefix(userId))));
    },
    // Completed and unfinished local conversations are retained for their date
    // only. Older copies are deleted at the next load or app foreground event.
    pruneUser(userId: string, date: string) {
      return enqueue(() => remove(key => key.startsWith(userPrefix(userId)) && key !== checkinStorageKey(userId, date)));
    },
    load(userId: string, date: string, currentSleepData: SleepData) {
      return enqueue(async () => {
        if (blockedUsers.has(userId)) return null;
        await remove(key => key.startsWith(userPrefix(userId)) && key !== checkinStorageKey(userId, date));
        const raw = await storage.getItem(checkinStorageKey(userId, date));
        return raw ? restoreCheckinDraft(raw, currentSleepData) : null;
      });
    },
    save(userId: string, date: string, draft: StoredCheckinDraft) {
      const allowed = !blockedUsers.has(userId);
      const serialized = JSON.stringify(draft);
      return enqueue(async () => {
        if (!allowed || blockedUsers.has(userId)) return;
        if (date !== today()) throw new Error('This check-in belongs to a previous day. Please reopen Your Day.');
        assertCheckinNoteLength(checkinNote(draft.conversation));
        await storage.setItem(checkinStorageKey(userId, date), serialized);
      });
    },
  };
}

export const checkinDraftStorage = createCheckinDraftStorage(AsyncStorage);
