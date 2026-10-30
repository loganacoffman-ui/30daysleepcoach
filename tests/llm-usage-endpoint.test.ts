import { coachAdmin } from './helpers/coachAdmin';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ user: null as any, admin: null as any, handler: null as any,
  clients: [] as any[], model: 'claude-sonnet-4-6' }));
vi.mock('../supabase/functions/_shared/auth.ts', () => ({ verifiedUser: async () => (await state.user.auth.getUser()).data.user }));
vi.mock('jsr:@supabase/functions-js/edge-runtime.d.ts', () => ({}));
vi.mock('npm:@configcat/sdk@1/deno', () => ({}));
vi.mock('jsr:@supabase/supabase-js@2', () => ({ createClient: (_url: string, key: string, options: unknown) => {
  state.clients.push({ key, options });
  return key === 'service-key' ? state.admin : state.user;
} }));
vi.mock('../supabase/functions/_shared/tracing.ts', () => ({
  tracedAnthropic: (_name: unknown, _body: unknown, fn: () => unknown) => fn(),
  startAnthropicSpan: vi.fn(), endAnthropicSpan: vi.fn(),
}));

vi.mock('../supabase/functions/_shared/coachModel.ts', async (importOriginal) => ({
  ...await importOriginal<any>(), cachedCoachModel: async () => state.model,
}));

const provider = vi.fn();
let authenticated: boolean, profile: any, writes: any[], tasks: Promise<void>[], messages: any[];
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const providerMessage = (text: string) => ({ id: 'msg_test', model: 'claude-sonnet-4-6', usage,
  content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const request = (body: Record<string, unknown>) => state.handler(new Request('https://example.test', {
  method: 'POST', headers: { Authorization: 'Bearer caller-jwt' }, fetch: expect.any(Function),
  body: JSON.stringify({ user_id: 'forged-user', bucket: 'forged-bucket', ...body }),
}));

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: (key: string) => key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service-key' :
      key === 'SUPABASE_ANON_KEY' ? 'anon-key' : undefined },
    serve: (handler: unknown) => { state.handler = handler; },
  });
  await import('../supabase/functions/sleep-coach/index');
});

beforeEach(() => {
  state.model = 'claude-sonnet-4-6';
  authenticated = true; profile = null; writes = []; tasks = []; messages = []; state.clients = [];
  provider.mockReset().mockImplementation(() => Promise.resolve(Response.json(providerMessage('A helpful profile.'))));
  vi.stubGlobal('fetch', provider);
  vi.stubGlobal('EdgeRuntime', { waitUntil: (task: Promise<void>) => { tasks.push(task); } });
  const runtime = coachAdmin();
  state.admin = { ...runtime, from: (table: string) => {
    if (table !== 'llm_usage_events') return runtime.from(table);
    return { upsert: (row: unknown, options: unknown) => {
      expect(options).toEqual({ onConflict: 'id' });
      writes.push(structuredClone(row));
      return { abortSignal: () => Promise.resolve({ error: null }) };
    } };
  } };
  state.user = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'verified-user' } : null } }) },
    from: (table: string) => {
      expect(table).not.toBe('llm_usage_events');
      let single = false, record: any;
      const q: any = {
        select: () => q, eq: () => q, gte: () => q, order: () => q, limit: () => q,
        maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
        upsert: (value: unknown) => { profile = value; return q; },
        update: () => q,
        insert: (value: any) => { record = { id: `m${messages.length}`, ...value }; messages.push(record); return q; },
        then: (resolve: any) => resolve({ error: null, data: record ?? (table === 'coach_profile_summaries'
          ? profile : table === 'coach_conversations' ? { id: 'conversation' } : single ? null : [...messages]) }),
      };
      return q;
    },
  };
});

it('meters check-in interpretation to the authenticated user using a separate service client', async () => {
  provider.mockImplementation(() => Promise.resolve(Response.json({ ...providerMessage(''), content: [{
    type: 'tool_use', name: 'interpret_checkin_reply',
    input: { addressed: true, answer: 'rested', finish: false, clarification: null },
  }] })));
  const response = await request({ mode: 'checkin_reply', checkinReply: {
    step: 'feeling', message: 'Feeling rested', turns: [{ role: 'assistant', content: 'How are you feeling?' }],
  } });
  expect(response.status).toBe(200);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toMatchObject({ user_id: 'verified-user', bucket: 'daily_checkin',
    operation: 'checkin_reply', usage_status: 'complete', input_tokens: 100, output_tokens: 20 });
  expect(state.clients).toEqual([
    { key: 'anon-key', options: { global: { headers: { Authorization: 'Bearer caller-jwt' }, fetch: expect.any(Function) } } },
    { key: 'service-key', options: { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: expect.any(Function) } } },
  ]);
});

it('does not create usage for unauthenticated or invalid requests', async () => {
  authenticated = false;
  expect((await request({ mode: 'sleep_profile' })).status).toBe(401);
  authenticated = true;
  expect((await request({ mode: 'checkin_reply', checkinReply: {} })).status).toBe(400);
  expect(provider).not.toHaveBeenCalled();
  expect(writes).toEqual([]);
});

it('counts fresh and forced profile generation while cached reuse has no inference event', async () => {
  const body = { mode: 'sleep_profile', coachContext: { bedtime: '22:00' } };
  expect((await request(body)).headers.get('X-Cache')).toBe('MISS');
  expect(writes[1]).toMatchObject({ bucket: 'sleep_profile', usage_status: 'complete' });
  expect((await request(body)).headers.get('X-Cache')).toBe('HIT');
  expect(writes).toHaveLength(2);
  expect((await request({ ...body, refresh: true })).headers.get('X-Cache')).toBe('MISS');
  expect(writes).toHaveLength(4);
  expect(provider).toHaveBeenCalledTimes(2);
});

it.each(['coach_chat', 'chat'])('meters %s streaming without changing its response format', async (mode) => {
  const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
  const stream = event({ type: 'message_start', message: providerMessage('') }) +
    event({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Try winding down.' } }) +
    event({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } }) +
    event({ type: 'message_stop' });
  provider.mockImplementation(() => Promise.resolve(new Response(stream, { headers: { 'content-type': 'text/event-stream' } })));
  const response = await request({ mode, conversationId: 'conversation', message: 'Help me sleep',
    messages: [{ role: 'user', content: 'Help me sleep' }] });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('Try winding down.');
  await Promise.all(tasks);
  expect(writes.at(-1)).toMatchObject({ bucket: 'chat', operation: mode, status: 'completed',
    usage_status: 'complete', input_tokens: 100, output_tokens: 40 });
});


afterEach(() => vi.useRealTimers());

const chatRequest = () => request({ mode: 'coach_chat', conversationId: 'conversation', message: 'Help me sleep' });
const stalledHeaders = (_input: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
});

it('aborts stalled rollout headers and persists one reply from the default model', async () => {
  vi.useFakeTimers();
  state.model = 'claude-sonnet-5-5';
  provider.mockImplementationOnce(stalledHeaders).mockImplementationOnce(() => Promise.resolve(new Response(
    'data: ' + JSON.stringify({ type: 'message_start', message: providerMessage('') }) + '\n\n' +
    'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { text: 'Try winding down.' } }) + '\n\n' +
    'data: ' + JSON.stringify({ type: 'message_delta', usage: { output_tokens: 20 }, delta: { stop_reason: 'end_turn' } }) + '\n\n' +
    'data: {"type":"message_stop"}\n\n',
  )));
  const pending = chatRequest();
  await vi.advanceTimersByTimeAsync(20_000);
  const response = await pending;
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('"type":"done"');
  await Promise.all(tasks);
  expect(provider).toHaveBeenCalledTimes(2);
  expect(provider.mock.calls[0][1].signal.aborted).toBe(true);
  const bodies = provider.mock.calls.map(([, init]) => JSON.parse(init.body));
  expect(bodies[0]).toMatchObject({ model: 'claude-sonnet-5-5', thinking: { type: 'between_tools' } });
  expect(bodies[0].tools.every((tool: any) => tool.strict)).toBe(true);
  expect(bodies[1]).toMatchObject({ model: 'claude-sonnet-4-6', thinking: { type: 'disabled' } });
  expect(bodies[1].tools.some((tool: any) => tool.strict)).toBe(false);
  expect(messages.filter(message => message.role === 'user')).toHaveLength(1);
  expect(messages.filter(message => message.role === 'assistant')).toHaveLength(1);
  expect(messages.at(-1).metadata.model).toBe('claude-sonnet-4-6');
  expect(writes).toContainEqual(expect.objectContaining({ attempt_index: 1, status: 'network_error', error_type: 'TimeoutError' }));
  expect(writes).toContainEqual(expect.objectContaining({ attempt_index: 2, status: 'completed' }));
  expect(vi.getTimerCount()).toBe(0);
});

it.each([['claude-sonnet-5-5', 2], ['claude-sonnet-4-6', 1]] as const)(
  'returns a bounded 504 when %s and any fallback stall before headers', async (model, attempts) => {
  vi.useFakeTimers();
  state.model = model;
  provider.mockImplementation(stalledHeaders);
  const pending = chatRequest();
  await vi.advanceTimersByTimeAsync(40_000);
  const response = await pending;
  expect(response.status).toBe(504);
  expect(await response.json()).toEqual({ error: 'Your coach took too long to respond. Please try again.' });
  await Promise.all(tasks);
  expect(provider).toHaveBeenCalledTimes(attempts);
  expect(messages.filter(message => message.role === 'assistant')).toHaveLength(0);
  expect(writes.filter(row => row.status === 'network_error')).toHaveLength(attempts);
  expect(vi.getTimerCount()).toBe(0);
});

it('ends a stalled body with an error without retrying or saving partial text', async () => {
  vi.useFakeTimers();
  provider.mockImplementation((_input, init) => Promise.resolve(new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"content_block_delta","delta":{"text":"Partial"}}\n\n'));
      init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
    },
  }))));
  const response = await chatRequest();
  const body = response.text();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await body).toContain('"type":"error"');
  expect(await body).not.toContain('"type":"done"');
  await Promise.all(tasks);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(messages.filter(message => message.role === 'assistant')).toHaveLength(0);
  expect(writes.at(-1)).toMatchObject({ status: 'stream_error' });
  expect(vi.getTimerCount()).toBe(0);
});

it('aborts the upstream body and clears timers when the mobile reader cancels', async () => {
  vi.useFakeTimers();
  provider.mockImplementation((_input, init) => Promise.resolve(new Response(new ReadableStream({
    start(controller) {
      init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
    },
  }))));
  const response = await chatRequest();
  await response.body!.cancel();
  await Promise.all(tasks);
  expect(provider.mock.calls[0][1].signal.aborted).toBe(true);
  expect(messages.filter(message => message.role === 'assistant')).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});
