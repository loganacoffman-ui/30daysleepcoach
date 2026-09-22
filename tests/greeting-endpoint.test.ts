import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ client: null as any, handler: null as any }));
vi.mock('jsr:@supabase/functions-js/edge-runtime.d.ts', () => ({}));
vi.mock('jsr:@supabase/supabase-js@2', () => ({ createClient: () => state.client }));
vi.mock('../supabase/functions/_shared/tracing.ts', () => ({
  tracedAnthropic: (_name: unknown, _body: unknown, fn: () => unknown) => fn(),
  startAnthropicSpan: vi.fn(), endAnthropicSpan: vi.fn(),
}));
let reports: any[], cached: any, authenticated: boolean, dbError: boolean;
let writes: any[], filters: any[];
const model = vi.fn();
const report = (content: string, id = 'r1') => ({ id, role: 'user', content, created_at: new Date(Date.now() - 1000).toISOString() });
beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: () => undefined }, serve: (handler: unknown) => { state.handler = handler; } });
  await import('../supabase/functions/sleep-coach/index');
});
beforeEach(() => {
  reports = []; cached = null; authenticated = true; dbError = false; writes = []; filters = [];
  model.mockReset().mockImplementation(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: '{"text":"How has winding down felt since the race?","source_id":"r1"}' }] })));
  vi.stubGlobal('fetch', model);
  state.client = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'alice' } : null }, error: null }) },
    from: (table: string) => {
      const query: any = { select: () => query, eq: (...args: any[]) => { filters.push([table, ...args]); return query; },
        gte: () => query, order: () => query, limit: () => query, maybeSingle: () => query,
        upsert: (value: any) => { cached = value; writes.push({ table, value }); return query; },
        then: (resolve: any) => resolve({ data: table === 'coach_messages' ? reports : cached, error: dbError ? new Error('offline') : null }) };
      return query;
    },
  };
});
const request = () => state.handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ mode: 'coach_greeting', user_id: 'mallory' }) }));
it('authenticates and provides a no-context fallback without a model call', async () => {
  authenticated = false;
  expect((await request()).status).toBe(401);
  authenticated = true;
  expect(await (await request()).json()).toEqual({ status: 'ok', user_id: 'alice', greeting: null });
  expect(model).not.toHaveBeenCalled();
});
it('scopes cache to the caller and reuses only unchanged context', async () => {
  reports = [report('My triathlon is over.')];
  const first = await (await request()).json();
  expect(first.greeting.text).toContain('race');
  expect(first.user_id).toBe('alice');
  expect(await (await request()).json()).toEqual(first);
  expect(model).toHaveBeenCalledTimes(1);
  expect(filters).toContainEqual(['ai_cache', 'user_id', 'alice']);
  expect(filters).toContainEqual(['coach_messages', 'user_id', 'alice']);
  reports = [report('I have another race next month.')];
  expect((await (await request()).json()).greeting.fingerprint).not.toBe(first.greeting.fingerprint);
  expect(model).toHaveBeenCalledTimes(2);
  expect(writes.every(write => write.table === 'ai_cache')).toBe(true);
});
it('suppresses an answer if the user corrects context during generation', async () => {
  reports = [report('Training for a race.')];
  const original = model.getMockImplementation()!;
  model.mockImplementation(async () => { reports = [report('My race is over.', 'r2')]; return original(); });
  expect((await (await request()).json()).greeting).toBeNull();
  expect(writes).toEqual([]);
});
it('falls back on DB/provider failure and rejects invented source IDs', async () => {
  reports = [report('My race is over.')];
  dbError = true;
  expect((await (await request()).json()).greeting).toBeNull();
  expect(model).not.toHaveBeenCalled();
  dbError = false;
  model.mockRejectedValue(new Error('timeout'));
  expect((await (await request()).json()).greeting).toBeNull();
  model.mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: '{"text":"Welcome back!","source_id":"invented"}' }] })));
  expect((await (await request()).json()).greeting).toBeNull();
});
