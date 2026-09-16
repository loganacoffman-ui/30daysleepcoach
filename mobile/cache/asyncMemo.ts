// Several screens need the same coaching context within a few seconds of each
// other, and building it costs a HealthKit sync plus an Oura request. Sharing one
// in-flight promise keeps a tab switch from repeating that work.
type Entry<T> = { expiresAt: number; promise: Promise<T> };

export function createAsyncMemo<T>(ttlMs: number, now = Date.now) {
  const entries = new Map<string, Entry<T>>();
  return {
    run(key: string, load: () => Promise<T>): Promise<T> {
      const existing = entries.get(key);
      if (existing && existing.expiresAt > now()) return existing.promise;
      const promise = load();
      entries.set(key, { expiresAt: now() + ttlMs, promise });
      // A failure must not be replayed; the next caller retries the request.
      void promise.catch(() => {
        if (entries.get(key)?.promise === promise) entries.delete(key);
      });
      return promise;
    },
    invalidate(keyPrefix: string) {
      for (const key of [...entries.keys()]) {
        if (key.startsWith(keyPrefix)) entries.delete(key);
      }
    },
  };
}
