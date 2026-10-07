import { describe, it, expect, vi } from 'vitest';
import { assertTestTarget, buildFixtures, defaultOptions, parseOptions, testEmail, TEST_USER_TAG } from '../supabase/functions/_shared/testUserFixtures';
import { makeHandler } from '../supabase/functions/admin-test-users/handler';
const id = '99999999-0000-4000-8000-000000000001';
const marker = '99999999-0000-4000-8000-000000000002';
const email = 'sleepcoach-test+demo@example.test';
const registry = { user_id: id, email, marker };
const target = { id, email, app_metadata: { test_user_tool: TEST_USER_TAG, test_user_marker: marker } };
function harness(overrides: Record<string, any> = {}) {
  const rpc = vi.fn(async (_name, args) => ({ data: args.p_action === 'list' ? [registry] : registry, error: null }));
  const admin = { auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: 'admin', app_metadata: { role: 'admin' } } }, error: null })),
    admin: {
      createUser: vi.fn(async () => ({ data: { user: target }, error: null })),
      getUserById: vi.fn(async () => ({ data: { user: target }, error: null })),
      deleteUser: vi.fn(async () => ({ error: null })),
    },
  } };
  const deleteMemories = vi.fn(async () => {});
  const handler = makeHandler({ admin, caller: () => ({ rpc }), deleteMemories, domain: 'example.test', ...overrides });
  const request = (body: unknown, token = 'session') => handler(new Request('https://example.test', {
    method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
  }));
  return { admin, rpc, deleteMemories, request };
}
describe('deterministic test fixtures', () => {
  it('supports owned domains without accepting a caller-supplied email', () => {
    expect(testEmail('demo')).toBe(email);
    expect(testEmail('demo', 'qa.our-domain.com')).toBe('sleepcoach-test+demo@qa.our-domain.com');
    for (const alias of ['real@gmail.com', '../x', 'MixedCase', '', 'x\n']) expect(() => testEmail(alias)).toThrow();
    expect(() => testEmail('demo', 'bad/domain')).toThrow();
  });
  it('bounds history and rejects malformed or contradictory options', () => {
    for (const checkinCount of [-1, 91, 2.5, '7', NaN]) expect(() => parseOptions({ checkinCount })).toThrow();
    expect(() => parseOptions({ onboardingStep: 'intro' })).toThrow();
    expect(() => parseOptions({ timezone: 'not/a/timezone' })).toThrow();
    expect(() => parseOptions({ emailConfirmed: 'false' })).toThrow();
    expect(() => parseOptions({ bedtime: '25:99' })).toThrow();
    expect(() => parseOptions({ primaryConcern: 'unrefreshed' })).toThrow();
    expect(parseOptions({ extra: 'ignored' })).not.toHaveProperty('extra');
  });
  it('uses the scenario timezone across month/year boundaries and leaves today empty', () => {
    const f = buildFixtures(defaultOptions, new Date('2027-01-01T04:00:00Z'));
    expect(f.checkins).toHaveLength(7);
    expect(f.checkins.at(-1)?.checkin_date).toBe('2026-12-30');
    expect(f.commitments.at(-1)?.behavior_date).toBe('2026-12-31');
    expect(f.recommendations).toHaveLength(7);
    expect(f.entries).toHaveLength(7);
    expect(f.recommendations.every(row => row.model === TEST_USER_TAG && row.source_context.synthetic)).toBe(true);
    expect(f).toEqual(buildFixtures(defaultOptions, new Date('2027-01-01T04:00:00Z')));
  });
  it('supports an unconfirmed empty account and resumable partial onboarding', () => {
    const f = buildFixtures(parseOptions({ emailConfirmed: false, onboardingStep: 'intro', checkinCount: 0 }));
    expect(f.profile.onboarding_completed_at).toBeNull();
    expect(f.profile.primary_concern).toBeNull();
    expect(f.checkins).toEqual([]); expect(f.commitments).toEqual([]);
    expect(f.profile.intake_answers).not.toHaveProperty('first_experiment');
    const partial = buildFixtures(parseOptions({ onboardingStep: 'followup', checkinCount: 0 }));
    expect(partial.profile.intake_answers.typical_bedtime).toBe('22:30');
    expect(partial.profile.intake_answers).not.toHaveProperty('follow_up_answer');
  });
  it('includes today only when selected and can omit feedback', () => {
    const f = buildFixtures(parseOptions({ includeToday: true, feedback: false }), new Date('2026-10-07T01:00:00Z'));
    expect(f.checkins.at(-1)?.checkin_date).toBe('2026-10-06');
    expect(f.recommendations).toEqual([]);
  });
  it('requires all independent identity guards, not just an email prefix', () => {
    expect(() => assertTestTarget(target, registry)).not.toThrow();
    for (const bad of [
      { ...target, id: 'another-id' }, { ...target, email: 'real@example.com' },
      { ...target, app_metadata: {} }, { ...target, app_metadata: { ...target.app_metadata, role: 'admin' } },
      { ...target, app_metadata: { ...target.app_metadata, test_user_marker: 'other' } },
    ]) expect(() => assertTestTarget(bad, registry)).toThrow();
  });
});
describe('admin endpoint authorization and destructive safety', () => {
  it('rejects missing auth before touching any accounts', async () => {
    const h = harness(); expect((await h.request({ action: 'delete' }, '')).status).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
  it('rejects user_metadata admin claims and ordinary users', async () => {
    const h = harness(); h.admin.auth.getUser.mockResolvedValue({ data: { user: { id: 'normal', app_metadata: {}, user_metadata: { role: 'admin' } } } } as any);
    expect((await h.request({ action: 'list' })).status).toBe(403); expect(h.rpc).not.toHaveBeenCalled();
  });
  it('rejects a revoked session/current role before Auth create', async () => {
    const h = harness(); h.rpc.mockResolvedValue({ data: null, error: { code: '42501' } } as any);
    expect((await h.request({ action: 'create', alias: 'demo', password: 'long-password', options: defaultOptions })).status).toBe(403);
    expect(h.admin.auth.admin.createUser).not.toHaveBeenCalled();
  });
  it('never adopts, resets, or deletes an existing email after a create collision', async () => {
    const h = harness(); h.admin.auth.admin.createUser.mockResolvedValue({ data: { user: null }, error: { message: 'exists' } } as any);
    expect((await h.request({ action: 'create', alias: 'demo', password: 'long-password', options: defaultOptions })).status).toBe(409);
    expect(h.admin.auth.admin.getUserById).not.toHaveBeenCalled(); expect(h.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
  it('rejects unknown targets and missing email confirmation before mutation', async () => {
    const h = harness();
    expect((await h.request({ action: 'delete', userId: id, confirmEmail: 'wrong' })).status).toBe(400);
    expect((await h.request({ action: 'delete', userId: '99999999-0000-4000-8000-000000000099', confirmEmail: email })).status).toBe(400);
    expect(h.deleteMemories).not.toHaveBeenCalled(); expect(h.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
  it('rejects changed tags before touching memory, app data, or Auth', async () => {
    const h = harness(); h.admin.auth.admin.getUserById.mockResolvedValue({ data: { user: { ...target, app_metadata: {} } } } as any);
    expect((await h.request({ action: 'delete', userId: id, confirmEmail: email })).status).toBe(403);
    expect(h.deleteMemories).not.toHaveBeenCalled(); expect(h.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(h.rpc.mock.calls.some(([, args]) => args.p_action === 'clear')).toBe(false);
  });
  it('preserves local data if external memory cleanup fails', async () => {
    const h = harness(); h.deleteMemories.mockRejectedValue(new Error('unavailable'));
    expect((await h.request({ action: 'reset', userId: id, confirmEmail: email, options: defaultOptions })).status).toBe(500);
    expect(h.rpc.mock.calls.map(([, args]) => args.p_action)).toEqual(['list', 'inspect', 'claim', 'fail']);
    expect(h.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
  it('resets a guarded account without replacing its identity or password', async () => {
    const h = harness();
    expect((await h.request({ action: 'reset', userId: id, confirmEmail: email, options: defaultOptions })).status).toBe(200);
    expect(h.rpc.mock.calls.map(([, args]) => args.p_action)).toEqual(['list', 'inspect', 'claim', 'seed']);
    expect(h.admin.auth.admin.createUser).not.toHaveBeenCalled(); expect(h.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
  it('cleans up only the exact guarded identity and rechecks before Auth deletion', async () => {
    const h = harness();
    expect((await h.request({ action: 'delete', userId: id, confirmEmail: email })).status).toBe(200);
    expect(h.admin.auth.admin.getUserById).toHaveBeenCalledTimes(2);
    expect(h.admin.auth.admin.deleteUser).toHaveBeenCalledExactlyOnceWith(id);
    expect(h.deleteMemories).toHaveBeenCalledExactlyOnceWith(id);
  });
  it('leaves a failed Auth deletion discoverable and retryable', async () => {
    const h = harness(); h.admin.auth.admin.deleteUser.mockResolvedValue({ error: { message: 'down' } } as any);
    const response = await h.request({ action: 'delete', userId: id, confirmEmail: email });
    expect(response.status).toBe(500); expect((await response.json()).error).toContain('retry Delete');
    expect(h.rpc.mock.calls.map(([, args]) => args.p_action)).toEqual(['list', 'inspect', 'claim', 'clear', 'fail']);
  });
});

describe('create lifecycle', () => {
  it('registers only a newly created, tagged identity then seeds it', async () => {
    const h = harness();
    h.admin.auth.admin.createUser.mockImplementation(async (attributes: any) => ({ data: { user: { ...target, email: attributes.email, app_metadata: attributes.app_metadata } }, error: null }));
    const response = await h.request({ action: 'create', alias: 'demo', password: 'long-test-password', options: defaultOptions });
    expect(response.status).toBe(200);
    expect(h.rpc.mock.calls.map(([, args]) => args.p_action)).toEqual(['list', 'register', 'seed']);
    expect(h.deleteMemories).not.toHaveBeenCalled();
    expect(h.admin.auth.admin.createUser.mock.calls[0][0]).not.toHaveProperty('user_metadata');
  });
  it('keeps a registered identity discoverable when initial seeding fails', async () => {
    const h = harness();
    h.admin.auth.admin.createUser.mockImplementation(async (attributes: any) => ({ data: { user: { ...target, app_metadata: attributes.app_metadata } }, error: null }));
    h.rpc.mockImplementation(async (_name, args) => args.p_action === 'seed'
      ? { data: null, error: { code: '23514' } } as any
      : { data: args.p_action === 'list' ? [registry] : registry, error: null });
    expect((await h.request({ action: 'create', alias: 'demo', password: 'long-test-password', options: defaultOptions })).status).toBe(500);
    expect(h.rpc.mock.calls.map(([, args]) => args.p_action)).toEqual(['list', 'register', 'seed', 'fail']);
    expect(h.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
});

describe('inventory pagination', () => {
  it('loads later pages and rejects invalid page input', async () => {
    const h = harness();
    expect((await h.request({ action: 'list', page: 2 })).status).toBe(200);
    expect(h.rpc.mock.calls.at(-1)?.[1].p_payload).toEqual({ page: 2 });
    expect((await h.request({ action: 'list', page: -1 })).status).toBe(400);
  });
  it('can reset a registered account absent from the first inventory page', async () => {
    const h = harness();
    h.rpc.mockImplementation(async (_name, args) => ({ data: args.p_action === 'list' ? [] : registry, error: null }));
    expect((await h.request({ action: 'reset', userId: id, confirmEmail: email, options: defaultOptions })).status).toBe(200);
    expect(h.rpc.mock.calls.map(([, args]) => args.p_action)).toContain('inspect');
  });
});
