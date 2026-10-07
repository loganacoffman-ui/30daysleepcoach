import { assertTestTarget, buildFixtures, parseOptions, testEmail, TEST_USER_TAG, TestUserError } from '../_shared/testUserFixtures.ts';

type Identity = Parameters<typeof assertTestTarget>[0];
type Registry = Parameters<typeof assertTestTarget>[1];
type Failure = { code?: string; message?: string } | null;
type AuthResult = { data: { user: Identity | null }; error: Failure };
type AdminClient = { auth: {
  getUser(jwt: string): PromiseLike<AuthResult>;
  admin: {
    createUser(attributes: { email: string; password: string; email_confirm: boolean; app_metadata: Record<string, unknown> }): PromiseLike<AuthResult>;
    getUserById(id: string): PromiseLike<AuthResult>;
    deleteUser(id: string): PromiseLike<{ error: Failure }>;
  };
} };
type CallerClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: Failure }> };
export function makeHandler(deps: {
  admin: AdminClient;
  caller: (jwt: string) => CallerClient;
  deleteMemories: (userId: string) => Promise<void>;
  domain: string;
}) {
  const origins = ['https://30daysleepcoach.com', 'https://www.30daysleepcoach.com', 'http://localhost:8000', 'http://127.0.0.1:8000'];
  return async (req: Request) => {
    const origin = req.headers.get('origin');
    const headers = {
      'Access-Control-Allow-Origin': origin && origins.includes(origin) ? origin : origins[0],
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin',
      'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    };
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (origin && !origins.includes(origin)) return reply({ error: 'Origin not allowed.' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
    let claimed: { id: string; token: string } | undefined;
    let rpc: ((action: string, id?: string, payload?: unknown) => Promise<unknown>) | undefined;
    try {
      const jwt = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
      if (!jwt) throw new TestUserError('Sign in as an admin.', 401);
      const { data, error } = await deps.admin.auth.getUser(jwt);
      if (error || !data.user) throw new TestUserError('Your session expired. Sign in again.', 401);
      if (data.user.app_metadata?.role !== 'admin' || data.user.app_metadata?.test_user_tool === TEST_USER_TAG) {
        throw new TestUserError('This account does not have admin access.', 403);
      }
      const client = deps.caller(jwt);
      rpc = async (action, id, payload = {}) => {
        const { data: result, error: failure } = await client.rpc('admin_test_user_action', {
          p_action: action, p_user_id: id ?? null, p_payload: payload,
        });
        if (failure) {
          if (failure.code === '42501') throw new TestUserError('Admin or test-account safety check failed.', 403);
          if (failure.code === '55P03') throw new TestUserError('Another operation is in progress. Retry later.', 409);
          throw new TestUserError('The database operation failed. Refresh the list and retry; existing data is preserved when a reset fails.', 500);
        }
        return result;
      };
      // Validates a live session and current DB role before any privileged Auth call.
      const users = await rpc('list') as Registry[];
      const raw = await req.text();
      if (raw.length > 16000) throw new TestUserError('Request too large.', 413);
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { throw new TestUserError('Invalid request.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TestUserError('Invalid request.');
      if (body.action === 'list') {
        const page = body.page ?? 0;
        if (typeof page !== 'number' || !Number.isInteger(page) || page < 0 || page > 100000) throw new TestUserError('Invalid inventory page.');
        const pageUsers = page === 0 ? users : await rpc('list', undefined, { page }) as Registry[];
        return reply({ users: pageUsers, domain: deps.domain, hasMore: pageUsers.length === 200 });
      }
      if (typeof body.action !== 'string' || !['create', 'reset', 'delete'].includes(body.action)) throw new TestUserError('Unknown action.');
      const token = crypto.randomUUID();
      if (body.action === 'create') {
        const options = parseOptions(body.options);
        const email = testEmail(body.alias, deps.domain);
        if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) {
          throw new TestUserError('Use a password of 12–128 characters.');
        }
        const marker = crypto.randomUUID();
        // Never upsert or look up an email collision to adopt an existing user.
        const { data: created, error: createError } = await deps.admin.auth.admin.createUser({
          email, password: body.password, email_confirm: options.emailConfirmed,
          app_metadata: { test_user_tool: TEST_USER_TAG, test_user_marker: marker },
        });
        if (createError || !created.user) throw new TestUserError('Could not create the test account. The name may already be taken or the password rejected. Existing accounts were not changed.', 409);
        const user = created.user;
        assertTestTarget(user, { user_id: user.id, email, marker });
        try {
          await rpc('register', user.id, { email, marker, operation_id: token });
        } catch (registerError) {
          // Compensation is restricted to the exact identity returned by THIS
          // successful create, never an account discovered by email or listUsers.
          const { data: current } = await deps.admin.auth.admin.getUserById(user.id);
          if (!current.user) throw new TestUserError('The new test identity could not be verified for cleanup.', 500);
          assertTestTarget(current.user, { user_id: user.id, email, marker });
          const { error: cleanupError } = await deps.admin.auth.admin.deleteUser(user.id);
          if (cleanupError) throw new TestUserError(`Setup failed; test identity ${user.id} needs operator cleanup.`, 500);
          throw registerError;
        }
        claimed = { id: user.id, token };
        await rpc('seed', user.id, { operation_id: token, fixtures: buildFixtures(options) });
        claimed = undefined;
        return reply({ ok: true, email, userId: user.id });
      }
      if (typeof body.userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.userId)) throw new TestUserError('Choose a managed test account.');
      // Inspect the exact registered UUID so older inventory pages remain usable.
      const registry = await rpc('inspect', body.userId) as Registry;
      if (!registry || registry.user_id !== body.userId || body.confirmEmail !== registry.email) throw new TestUserError('Type the exact test email to confirm this operation.');
      const options = body.action === 'reset' ? parseOptions(body.options) : undefined;
      await rpc('claim', body.userId, { operation_id: token });
      claimed = { id: body.userId, token };
      const { data: target, error: targetError } = await deps.admin.auth.admin.getUserById(body.userId);
      if (targetError || !target.user) throw new TestUserError('Test identity could not be verified.', 409);
      assertTestTarget(target.user, registry);
      // External memory must be removed before replacing/deleting the identity.
      // Failure leaves local data intact and releases the operation for retry.
      await deps.deleteMemories(body.userId);
      if (body.action === 'reset') {
        await rpc('seed', body.userId, { operation_id: token, fixtures: buildFixtures(options!) });
      } else {
        await rpc('clear', body.userId, { operation_id: token });
        const { data: current, error: currentError } = await deps.admin.auth.admin.getUserById(body.userId);
        if (currentError || !current.user) throw new TestUserError('Test identity could not be verified.', 409);
        assertTestTarget(current.user, registry);
        const { error: deleteError } = await deps.admin.auth.admin.deleteUser(body.userId);
        if (deleteError) throw new TestUserError('App data was cleared, but Auth deletion failed. The test account remains listed; retry Delete.', 500);
      }
      claimed = undefined;
      return reply({ ok: true, email: registry.email, userId: body.userId });
    } catch (error) {
      if (claimed && rpc) {
        try { await rpc('fail', claimed.id, { operation_id: claimed.token }); } catch { /* abandoned lock expires after 15 minutes */ }
      }
      return reply({ error: error instanceof TestUserError ? error.message : 'The operation could not finish. Refresh the test account list and retry.' },
        error instanceof TestUserError ? error.status : 500);
    }
  };
}
