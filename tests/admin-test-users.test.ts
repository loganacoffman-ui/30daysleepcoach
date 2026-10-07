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
  const seedMemories = vi.fn(async (_userId: string, _facts: string[], _operationId: string) => ({ eventId: 'memory-event' }));
  const handler = makeHandler({ admin, caller: () => ({ rpc }), deleteMemories, seedMemories, memoryEnabled: true, domain: 'example.test', ...overrides });
  const request = (body: unknown, token = 'session') => handler(new Request('https://example.test', {
    method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
  }));
  return { admin, rpc, deleteMemories, seedMemories, request };
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
    expect(h.rpc.mock.calls.map(([, args]) => args.p_action)).toEqual(['list', 'inspect', 'claim', 'seed', 'finish']);
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
    expect(h.rpc.mock.calls.map(([, args]) => args.p_action)).toEqual(['list', 'register', 'seed', 'finish']);
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


describe('expanded mobile scenarios', () => {
  it('seeds bounded, chronological chats with both roles and readable history', () => {
    const f = buildFixtures(parseOptions({ chatCount: 20, chatTurns: 30 }), new Date('2026-10-07T01:00:00Z'));
    expect(f.conversations).toHaveLength(20);
    for (const chat of f.conversations) {
      expect(chat.messages).toHaveLength(60);
      expect(chat.messages.map(m => m.role)).toEqual(Array.from({ length: 30 }, () => ['user', 'assistant']).flat());
      expect(chat.messages.every(m => m.metadata.synthetic && m.content.length > 0)).toBe(true);
      expect(chat.updated_at).toBe(chat.messages.at(-1)?.created_at);
      expect(Date.parse(chat.updated_at)).toBeGreaterThan(Date.parse(chat.created_at));
    }
  });
  it('can seed memories independently of chat history with dated corrections and custom facts', () => {
    const f = buildFixtures(parseOptions({ memoryScenario: 'corrections', customMemories: ' I like reading.\n\nI stopped late coffee. ' }), new Date('2026-10-07T01:00:00Z'));
    expect(f.conversations).toEqual([]);
    expect(f.memories).toHaveLength(8);
    expect(f.memories.join(' ')).toContain('Correction as of 2026-10-06');
    expect(f.memories.slice(-2)).toEqual(['I like reading.', 'I stopped late coffee.']);
  });
  it('rejects excessive counts, malformed memories, and history before onboarding', () => {
    for (const invalid of [{ chatCount: 21 }, { chatTurns: 0 }, { chatTurns: 31 }, { wearableCount: 91 }, { chatCount: '2' },
      { customMemories: 'a'.repeat(301) }, { customMemories: Array(21).fill('fact').join('\n') }, { customMemories: null },
      { memoryScenario: 'unknown' }, { onboardingStep: 'intro', checkinCount: 0, chatCount: 1 }]) {
      expect(() => parseOptions(invalid)).toThrow();
    }
  });
  it('supports wearable scores, manual overrides, missed days, and missing-score feedback gates', () => {
    const o = parseOptions({ wearableCount: 3, checkinCount: 7, scoreMode: 'mixed', historySpacing: 'gaps', todayCommitment: 'none' });
    const f = buildFixtures(o, new Date('2026-10-07T01:00:00Z'));
    expect(f.sleepNights).toHaveLength(3);
    expect(f.checkins.map(c => c.checkin_date)).toEqual(['2026-09-23', '2026-09-25', '2026-09-27', '2026-09-29', '2026-10-01', '2026-10-03', '2026-10-05']);
    expect(f.recommendations).toHaveLength(5);
    expect(f.recommendations.at(-2)?.source_context.sleep_resolution_key).toContain('apple_health');
    expect(f.recommendations.at(-1)?.source_context.sleep_resolution_key).toContain('manual');
    expect(f.commitments.some(c => c.behavior_date === '2026-10-06')).toBe(false);
    const missing = buildFixtures(parseOptions({ scoreMode: 'wearable', wearableCount: 0 }));
    expect(missing.recommendations).toEqual([]);
    expect(missing.checkins.every(c => c.manual_sleep_score === null && c.manual_sleep_submitted_at === null)).toBe(true);
  });
  it('sets today’s selected commitment even when a check-in already exists', () => {
    for (const todayCommitment of ['none', 'committed', 'partial', 'skipped', 'completed'] as const) {
      const f = buildFixtures(parseOptions({ includeToday: true, todayCommitment }), new Date('2026-10-07T01:00:00Z'));
      expect(f.commitments.find(c => c.behavior_date === '2026-10-06')?.status).toBe(todayCommitment === 'none' ? undefined : todayCommitment);
    }
  });
  it('holds the lock until Mem0 accepts facts and records an honest submission receipt', async () => {
    const h = harness();
    const response = await h.request({ action: 'reset', userId: id, confirmEmail: email, options: { memoryScenario: 'progress', chatCount: 2 } });
    expect(response.status).toBe(200);
    expect(h.seedMemories).toHaveBeenCalledWith(id, expect.any(Array), expect.any(String));
    expect(h.seedMemories.mock.calls[0][1]).toHaveLength(5);
    const calls = h.rpc.mock.calls.map(([, args]) => args);
    const seed = calls.find(args => args.p_action === 'seed')!;
    expect(seed.p_payload.defer_finish).toBe(true);
    expect(seed.p_payload.fixtures).not.toHaveProperty('memories');
    expect(calls.at(-1)?.p_payload).toMatchObject({ memory_count: 5, memory_event_id: 'memory-event' });
    expect((await response.json()).summary).toMatchObject({ chats: 2, messages: 12, memoryFactsSubmitted: 5 });
  });
  it('fails before account creation or reset cleanup when requested memory is unconfigured', async () => {
    const h = harness({ memoryEnabled: false });
    expect((await h.request({ action: 'create', alias: 'demo', password: 'long-test-password', options: { memoryScenario: 'preferences' } })).status).toBe(503);
    expect((await h.request({ action: 'reset', userId: id, confirmEmail: email, options: { customMemories: 'Fact' } })).status).toBe(503);
    expect(h.admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(h.deleteMemories).not.toHaveBeenCalled();
  });
  it('keeps partial memory failures visible and retryable without claiming completion', async () => {
    const h = harness(); h.seedMemories.mockRejectedValue(new Error('provider failure'));
    const response = await h.request({ action: 'reset', userId: id, confirmEmail: email, options: { memoryScenario: 'preferences' } });
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain('App fixtures were saved');
    expect(h.rpc.mock.calls.map(([, args]) => args.p_action)).toEqual(['list', 'inspect', 'claim', 'seed', 'fail']);
    expect(h.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
  it('never submits memories when local seeding fails or target tags changed', async () => {
    const h = harness();
    h.rpc.mockImplementation(async (_name, args) => args.p_action === 'seed' ? { data: null, error: { code: '23514' } } as any : { data: registry, error: null });
    expect((await h.request({ action: 'reset', userId: id, confirmEmail: email, options: { memoryScenario: 'progress' } })).status).toBe(500);
    expect(h.seedMemories).not.toHaveBeenCalled();
    h.admin.auth.admin.getUserById.mockResolvedValue({ data: { user: { ...target, app_metadata: {} } } } as any);
    expect((await h.request({ action: 'reset', userId: id, confirmEmail: email, options: { memoryScenario: 'progress' } })).status).toBe(403);
    expect(h.seedMemories).not.toHaveBeenCalled();
  });
});
