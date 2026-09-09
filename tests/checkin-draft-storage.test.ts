import { describe, expect, it, vi } from 'vitest';
import { checkinStorageKey, createCheckinDraftStorage, restoreCheckinDraft, type StoredCheckinDraft } from '../mobile/today/checkinDraftStorage';
import { startCheckin } from '../mobile/today/checkinConversation';
import type { TodaySnapshot } from '../mobile/today/types';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
const date = '2026-09-08';
const missing: TodaySnapshot['sleepData'] = { status: 'missing', score: null, source: null };
const wearable: TodaySnapshot['sleepData'] = { status: 'wearable', score: 82, source: 'apple_health' };
const draft = (): StoredCheckinDraft => ({
  conversation: startCheckin('Take a walk', 'experiment-1'), input: 'I went outside',
  manualSleepScore: null, manualSleepFallback: false,
  sleepReviewed: true, reviewedSleepData: wearable,
});
const memoryStorage = () => {
  const records = new Map<string, string>();
  const storage = {
    getItem: vi.fn(async (key: string) => records.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { records.set(key, value); }),
    getAllKeys: vi.fn(async () => [...records.keys()]),
    multiRemove: vi.fn(async (keys: readonly string[]) => { keys.forEach(key => records.delete(key)); }),
  };
  return { records, storage, store: createCheckinDraftStorage(storage, () => date) };
};

describe('same-day check-in persistence', () => {
  it('resumes Continue, accepted score, question, and composer across a new app instance', async () => {
    const { storage, store } = memoryStorage();
    const original = draft();
    await store.save('user-a', date, original);
    const reloadedApp = createCheckinDraftStorage(storage, () => date);
    expect(await reloadedApp.load('user-a', date, missing)).toEqual(original);
  });

  it('preserves a manual score of zero and resumes legacy drafts that omitted sleepReviewed', () => {
    const original = { conversation: startCheckin(), manualSleepScore: 0, manualSleepFallback: true, input: 'A rough night' };
    const restored = restoreCheckinDraft(JSON.stringify(original), missing)!;
    expect(restored.sleepReviewed).toBe(true);
    expect(restored.reviewedSleepData).toEqual({ status: 'manual', source: 'manual', score: 0 });
    expect(restored.manualSleepScore).toBe(0);
    expect(restored.conversation.step).toBe('feeling');
    expect(restoreCheckinDraft(JSON.stringify({ conversation: startCheckin() }), wearable)?.sleepReviewed).toBe(true);
  });

  it('does not mark the sleep step reviewed when Continue was never clicked', () => {
    const original = { ...draft(), conversation: { step: 'sleep', turns: [] }, sleepReviewed: false };
    expect(restoreCheckinDraft(JSON.stringify(original), wearable)?.sleepReviewed).toBe(false);
  });

  it('waits for the Continue write before a tab reopen reads the saved milestone', async () => {
    const { storage, store } = memoryStorage();
    const write = storage.setItem.getMockImplementation()!;
    let finishWrite!: () => void;
    let writeStarted!: () => void;
    const started = new Promise<void>(resolve => { writeStarted = resolve; });
    storage.setItem.mockImplementationOnce(async (key, value) => {
      writeStarted();
      await new Promise<void>(resolve => { finishWrite = resolve; });
      await write(key, value);
    });
    const saving = store.save('user-a', date, draft());
    await started;
    const reopening = store.load('user-a', date, missing);
    finishWrite();
    await saving;
    expect((await reopening)?.sleepReviewed).toBe(true);
  });

  it('removes only the signing-out user’s drafts and prevents pending or late writes from recreating them', async () => {
    const { records, storage, store } = memoryStorage();
    records.set(checkinStorageKey('user-b', date), 'other user');
    records.set('unrelated-preference', 'keep');
    const write = storage.setItem.getMockImplementation()!;
    let finishWrite!: () => void;
    let writeStarted!: () => void;
    const started = new Promise<void>(resolve => { writeStarted = resolve; });
    storage.setItem.mockImplementationOnce(async (key, value) => {
      writeStarted();
      await new Promise<void>(resolve => { finishWrite = resolve; });
      await write(key, value);
    });
    const saving = store.save('user-a', date, draft());
    await started;
    const cleanup = store.clearUser('user-a');
    const lateSave = store.save('user-a', date, draft());
    finishWrite();
    await Promise.all([saving, cleanup, lateSave]);
    expect(records.has(checkinStorageKey('user-a', date))).toBe(false);
    expect(records.get(checkinStorageKey('user-b', date))).toBe('other user');
    expect(records.get('unrelated-preference')).toBe('keep');
    expect(await store.load('user-a', date, missing)).toBeNull();
    store.allowUser('user-a');
    await store.save('user-a', date, draft());
    expect(records.has(checkinStorageKey('user-a', date))).toBe(true);
  });

  it('prunes old completed and unfinished drafts, keeps today, and rejects stale writes', async () => {
    const { records, store } = memoryStorage();
    records.set(checkinStorageKey('user-a', '2026-09-06'), JSON.stringify(draft()));
    records.set(checkinStorageKey('user-a', '2026-09-07'), JSON.stringify({ ...draft(), completed: true }));
    await store.save('user-a', date, draft());
    await store.pruneUser('user-a', date);
    expect([...records.keys()]).toEqual([checkinStorageKey('user-a', date)]);
    await expect(store.save('user-a', '2026-09-07', draft())).rejects.toThrow('previous day');
  });

  it('cleans orphaned check-in data on signed-out startup without touching auth or preferences', async () => {
    const { records, store } = memoryStorage();
    records.set(checkinStorageKey('deleted-user', date), JSON.stringify(draft()));
    records.set('supabase-session', 'keep');
    await store.clearSignedOutDrafts();
    expect([...records.keys()]).toEqual(['supabase-session']);
  });

  it('does not overwrite existing progress when storage reads fail', async () => {
    const { store, storage } = memoryStorage();
    await store.save('user-a', date, draft());
    storage.getItem.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(store.load('user-a', date, wearable)).rejects.toThrow('Storage unavailable');
    expect(await store.load('user-a', date, wearable)).toEqual(draft());
  });
});
