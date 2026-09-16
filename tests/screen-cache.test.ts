import { describe, expect, it, vi } from 'vitest';
import { createScreenCache, screenCacheKey } from '../mobile/cache/screenCache';
import { createAsyncMemo } from '../mobile/cache/asyncMemo';
import { checkinRevision, markCheckinSaved, subscribeToCheckins } from '../mobile/cache/checkinRevision';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

const memoryStorage = () => {
  const records = new Map<string, string>();
  const storage = {
    getItem: vi.fn(async (key: string) => records.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { records.set(key, value); }),
    getAllKeys: vi.fn(async () => [...records.keys()]),
    multiRemove: vi.fn(async (keys: readonly string[]) => { keys.forEach(key => records.delete(key)); }),
  };
  return { records, storage, cache: createScreenCache(storage) };
};

describe('cached screen content', () => {
  it('replays a screen’s last content to a new app instance', async () => {
    const { storage, cache } = memoryStorage();
    await cache.write('user-a', 'progress', 1, { checkins: [{ checkin_date: '2026-09-15' }] });
    const relaunched = createScreenCache(storage);
    expect((await relaunched.read('user-a', 'progress', 1))?.value)
      .toEqual({ checkins: [{ checkin_date: '2026-09-15' }] });
  });

  it('discards entries written by a build that used a different shape', async () => {
    const { cache } = memoryStorage();
    await cache.write('user-a', 'progress', 1, { score: 82 });
    expect(await cache.read('user-a', 'progress', 2)).toBeNull();
    expect(await cache.read('user-a', 'progress', 1)).not.toBeNull();
  });

  it('treats unreadable entries as absent instead of failing the screen', async () => {
    const { records, cache } = memoryStorage();
    records.set(screenCacheKey('user-a', 'progress'), 'not json');
    expect(await cache.read('user-a', 'progress', 1)).toBeNull();
  });

  it('separates users and never returns one user’s cache to another', async () => {
    const { cache } = memoryStorage();
    await cache.write('user-a', 'progress', 1, { score: 82 });
    await cache.write('user-b', 'progress', 1, { score: 41 });
    expect((await cache.read('user-b', 'progress', 1))?.value).toEqual({ score: 41 });
  });

  it('removes only the signing-out user’s cache and blocks late writes from recreating it', async () => {
    const { records, storage, cache } = memoryStorage();
    await cache.write('user-b', 'progress', 1, { score: 41 });
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
    const saving = cache.write('user-a', 'progress', 1, { score: 82 });
    await started;
    const cleanup = cache.clearUser('user-a');
    const lateSave = cache.write('user-a', 'sleep-profile-summary', 1, 'You sleep better after a wind-down.');
    finishWrite();
    await Promise.all([saving, cleanup, lateSave]);

    expect(records.has(screenCacheKey('user-a', 'progress'))).toBe(false);
    expect(records.has(screenCacheKey('user-a', 'sleep-profile-summary'))).toBe(false);
    expect(await cache.read('user-a', 'progress', 1)).toBeNull();
    expect(records.has(screenCacheKey('user-b', 'progress'))).toBe(true);
    expect(records.get('unrelated-preference')).toBe('keep');

    cache.allowUser('user-a');
    await cache.write('user-a', 'progress', 1, { score: 82 });
    expect(records.has(screenCacheKey('user-a', 'progress'))).toBe(true);
  });

  it('clears every orphaned screen cache on signed-out startup', async () => {
    const { records, cache } = memoryStorage();
    await cache.write('deleted-user', 'progress', 1, { score: 82 });
    records.set('supabase-session', 'keep');
    await cache.clearSignedOutCaches();
    expect([...records.keys()]).toEqual(['supabase-session']);
  });
});

describe('shared coaching context window', () => {
  it('serves concurrent and repeat callers from one request', async () => {
    const load = vi.fn(async () => 'context');
    const memo = createAsyncMemo<string>(60_000);
    const [first, second] = await Promise.all([memo.run('user-a', load), memo.run('user-a', load)]);
    expect(await memo.run('user-a', load)).toBe('context');
    expect([first, second]).toEqual(['context', 'context']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the context once the window expires', async () => {
    const load = vi.fn(async () => 'context');
    let clock = 0;
    const memo = createAsyncMemo<string>(1_000, () => clock);
    await memo.run('user-a', load);
    clock = 999;
    await memo.run('user-a', load);
    expect(load).toHaveBeenCalledTimes(1);
    clock = 1_001;
    await memo.run('user-a', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('rebuilds after a saved check-in invalidates the user’s window', async () => {
    const load = vi.fn(async () => 'context');
    const memo = createAsyncMemo<string>(60_000);
    await memo.run('user-a:7', load);
    await memo.run('user-b:7', load);
    memo.invalidate('user-a:');
    await Promise.all([memo.run('user-a:7', load), memo.run('user-b:7', load)]);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not replay a failed request to the next caller', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce('context');
    const memo = createAsyncMemo<string>(60_000);
    await expect(memo.run('user-a', load)).rejects.toThrow('Offline');
    expect(await memo.run('user-a', load)).toBe('context');
  });
});

describe('check-in staleness signal', () => {
  it('tells a screen on another tab that its data is now stale', () => {
    const seen: number[] = [];
    const unsubscribe = subscribeToCheckins(() => seen.push(checkinRevision()));
    const before = checkinRevision();
    markCheckinSaved();
    markCheckinSaved();
    expect(seen).toEqual([before + 1, before + 2]);
    unsubscribe();
    markCheckinSaved();
    expect(seen).toHaveLength(2);
  });
});
