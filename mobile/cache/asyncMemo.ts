// Share pending work and briefly reuse successful reads across screen visits.
type Entry<T> = { expiresAt: number; promise: Promise<T> };

export function createAsyncMemo<T>(ttlMs: number, now = () => Date.now()) {
  const entries = new Map<string, Entry<T>>();
  return {
    run(key: string, load: () => Promise<T>): Promise<T> {
      const existing = entries.get(key);
      if (existing && existing.expiresAt > now()) return existing.promise;
      const promise = load();
      // Never expire work that is still running. Start the freshness window
      // when it finishes, so a slow request cannot spawn duplicate work.
      const entry = { expiresAt: Infinity, promise };
      entries.set(key, entry);
      void promise.then(() => { entry.expiresAt = now() + ttlMs; }, () => undefined);
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
