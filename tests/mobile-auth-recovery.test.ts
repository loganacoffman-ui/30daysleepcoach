import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Session, type User } from '../mobile/node_modules/@supabase/supabase-js';
import { createBoundedFetch, REQUEST_TIMEOUT_MS, restoreStoredSession, withDeadline } from '../mobile/auth/recovery';

const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' } as User;
const session = (): Session => ({ access_token: 'test-token', refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });
let clientNumber = 0;
function makeClient(fetcher: typeof fetch, stored: Session | null = session()) {
  const key = `test-session-${clientNumber++}`;
  const values = new Map(stored ? [[key, JSON.stringify(stored)]] : []);
  return createClient('https://test.invalid', 'test-public-key', {
    auth: {
      storageKey: key, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
      storage: { getItem: async k => values.get(k) ?? null, setItem: async (k, v) => { values.set(k, v); }, removeItem: async k => { values.delete(k); } },
    },
    global: { fetch: fetcher },
  });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.useRealTimers());

describe('session restoration with the installed Supabase SDK', () => {
  it('validates a stored session against the server', async () => {
    const fetcher = vi.fn(async () => json({ ...user, user_metadata: { name: 'updated' } }));
    const client = makeClient(fetcher);
    expect((await restoreStoredSession(client.auth))?.user.user_metadata.name).toBe('updated');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([503, 429])('preserves the session on HTTP %s and allows a retry', async status => {
    const fetcher = vi.fn(async () => json({ message: 'Temporary failure' }, status));
    const client = makeClient(fetcher);
    await expect(restoreStoredSession(client.auth)).rejects.toMatchObject({ status });
    expect((await client.auth.getSession()).data.session).not.toBeNull();
    expect(fetcher.mock.calls).toHaveLength(1); // No logout request.
    fetcher.mockImplementation(async () => json(user));
    await expect(restoreStoredSession(client.auth)).resolves.toMatchObject({ user: { id: user.id } });
  });

  it('preserves the session on a transport failure', async () => {
    const client = makeClient(async () => { throw new TypeError('Network request failed'); });
    await expect(restoreStoredSession(client.auth)).rejects.toThrow();
    expect((await client.auth.getSession()).data.session).not.toBeNull();
  });

  it('does not admit an invalid cached session', async () => {
    const client = makeClient(async () => json({ code: 'bad_jwt', message: 'Invalid JWT' }, 401));
    await expect(restoreStoredSession(client.auth)).rejects.toMatchObject({ status: 401 });
  });

  it('returns signed out without a network request when there is no session', async () => {
    const fetcher = vi.fn();
    await expect(restoreStoredSession(makeClient(fetcher, null).auth)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not block cached session reads behind a stalled user check', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const client = makeClient(async () => { entered(); await gate; return json(user); });
    await client.auth.getSession();
    const pendingUser = client.auth.getUser();
    await started;
    try {
      await expect(withDeadline(client.auth.getSession(), 100)).resolves.toMatchObject({ data: { session: { user: { id: user.id } } } });
    } finally {
      release();
      await pendingUser;
    }
  });
});

describe('bounded requests and loading', () => {
  it('ends a stalled SDK/storage wait and handles late rejection', async () => {
    vi.useFakeTimers();
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_, r) => { reject = r; });
    const result = expect(withDeadline(pending)).rejects.toThrow('taking too long');
    await vi.advanceTimersByTimeAsync(20_000);
    await result;
    reject(new Error('Late storage failure'));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline after a successful operation', async () => {
    vi.useFakeTimers();
    await expect(withDeadline(Promise.resolve('ready'))).resolves.toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['auth', 'rest'])('aborts stalled %s HTTP requests', async service => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input, init) => new Promise<Response>((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const result = expect(createBoundedFetch(fetcher)(`https://test.invalid/${service}/v1/user`)).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await result;
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards caller cancellation', async () => {
    const caller = new AbortController();
    const fetcher = vi.fn(async (_input, init) => { caller.abort(); expect(init.signal.aborted).toBe(true); return json({}); });
    await createBoundedFetch(fetcher)('https://test.invalid/rest/v1/sleep_profiles', { signal: caller.signal });
  });

  it('forwards an already cancelled Request signal', async () => {
    const caller = new AbortController();
    caller.abort();
    const fetcher = vi.fn(async (_input, init) => { expect(init.signal.aborted).toBe(true); return json({}); });
    await createBoundedFetch(fetcher)(new Request('https://test.invalid/rest/v1/sleep_profiles', { signal: caller.signal }));
  });

  it('does not shorten coaching function requests', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => json({}));
    await createBoundedFetch(fetcher)('https://test.invalid/functions/v1/coach');
    expect(fetcher).toHaveBeenCalledWith('https://test.invalid/functions/v1/coach', undefined);
    expect(vi.getTimerCount()).toBe(0);
  });
});
