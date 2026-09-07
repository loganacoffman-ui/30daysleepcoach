import type { SupabaseClient } from '@supabase/supabase-js';

export const REQUEST_TIMEOUT_MS = 12_000;
export const LOAD_TIMEOUT_MS = 20_000;

// Also bounds storage/SDK waits, which cannot be cancelled with AbortController.
// Callers must ignore late results after their effect has been cleaned up.
export async function withDeadline<T>(operation: PromiseLike<T>, milliseconds = LOAD_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The connection is taking too long. Please try again.')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function restoreStoredSession(auth: Pick<SupabaseClient['auth'], 'getSession' | 'getUser'>) {
  const { data, error } = await auth.getSession();
  if (error) throw error;
  if (!data.session) return null;

  // Keep server validation of cached sessions. A network failure is not proof
  // that a session expired, so never sign out as a side effect of this check.
  const { data: userData, error: userError } = await auth.getUser(data.session.access_token);
  if (userError) throw userError;
  if (!userData.user || userData.user.id !== data.session.user.id) {
    throw new Error('Your session could not be verified. Please sign in again.');
  }
  return { ...data.session, user: userData.user };
}

export function createBoundedFetch(fetcher: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    // Coaching functions and uploads can legitimately take longer than login.
    if (!/\/(auth|rest)\/v1\//.test(new URL(url).pathname)) return fetcher(input, init);

    const controller = new AbortController();
    const callerSignal = init?.signal ?? (typeof input === 'object' && 'signal' in input ? input.signal : undefined);
    const abort = () => controller.abort();
    if (callerSignal?.aborted) abort();
    else callerSignal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
    try {
      return await fetcher(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abort);
    }
  };
}
