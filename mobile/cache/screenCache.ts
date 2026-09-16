import AsyncStorage from '@react-native-async-storage/async-storage';

// Screens render their last known content before the network answers, so a tab
// switch or a cold launch shows real data instead of a spinner. Entries hold the
// same health data as the live screen, so they are scoped per user and removed
// on sign-out and account deletion exactly like the check-in drafts.
const prefix = 'sleep-coach:screen-cache:';
const userPrefix = (userId: string) => `${prefix}${userId}:`;
export const screenCacheKey = (userId: string, name: string) => `${userPrefix(userId)}${name}`;

type Envelope = { version: number; savedAt: string; value: unknown };

type Storage = Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'getAllKeys' | 'multiRemove'>;

export type CachedEntry<T> = { value: T; savedAt: string };

export function createScreenCache(storage: Storage) {
  // Writes and cleanup share one queue so a slow write that started before
  // sign-out cannot land after the user's cache was cleared.
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
    clearUser(userId: string) {
      blockedUsers.add(userId);
      return enqueue(() => remove(key => key.startsWith(userPrefix(userId))));
    },
    clearSignedOutCaches() {
      return enqueue(() => remove(key => key.startsWith(prefix)));
    },
    // A version bump discards entries whose shape this build no longer reads,
    // so a released format change can never render as corrupt content.
    read<T>(userId: string, name: string, version: number): Promise<CachedEntry<T> | null> {
      return enqueue(async () => {
        if (blockedUsers.has(userId)) return null;
        const raw = await storage.getItem(screenCacheKey(userId, name));
        if (!raw) return null;
        try {
          const envelope = JSON.parse(raw) as Envelope;
          if (envelope.version !== version || typeof envelope.savedAt !== 'string') return null;
          return { value: envelope.value as T, savedAt: envelope.savedAt };
        } catch { return null; }
      });
    },
    write(userId: string, name: string, version: number, value: unknown): Promise<void> {
      const allowed = !blockedUsers.has(userId);
      const serialized = JSON.stringify({ version, savedAt: new Date().toISOString(), value } satisfies Envelope);
      return enqueue(async () => {
        if (!allowed || blockedUsers.has(userId)) return;
        await storage.setItem(screenCacheKey(userId, name), serialized);
      });
    },
  };
}

export const screenCache = createScreenCache(AsyncStorage);
