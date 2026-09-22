import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { resolveSleep } from '../mobile/sleep/dailySleepContract';

const state = vi.hoisted(() => ({ client: null as any, handler: null as any }));
vi.mock('jsr:@supabase/functions-js/edge-runtime.d.ts', () => ({}));
vi.mock('jsr:@supabase/supabase-js@2', () => ({ createClient: () => state.client }));
vi.mock('../supabase/functions/_shared/tracing.ts', () => ({
  tracedAnthropic: (_name: unknown, _body: unknown, fn: () => unknown) => fn(),
  startAnthropicSpan: vi.fn(), endAnthropicSpan: vi.fn(),
}));
let reports: any[];
let checkins: any[], nights: any[], oura: any[], stored: any, writes: string[], filters: any[];
const date = '2026-09-18';
const manual = { checkin_date: date, manual_sleep_score: 0, manual_sleep_submitted_at: `${date}T08:00:00Z`, note: 'Restless' };
const fetchMock = vi.fn();
beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: () => undefined }, serve: (handler: unknown) => { state.handler = handler; } });
  await import('../supabase/functions/sleep-coach/index');
});
beforeEach(() => {
  reports = []; checkins = []; nights = []; oura = []; stored = null; writes = []; filters = [];
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: "**Pattern** A pattern\n**What this likely means** Meaning\n**Tonight's action** Dim lights\n**Why this, now** Rest" }] }), { status: 200 }));
  state.client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    functions: { invoke: vi.fn(async () => ({ data: { data: oura }, error: null })) },
    from: (table: string) => {
      let single = false; let record: any;
      const query: any = {
        select: () => query, eq: (key: string, value: unknown) => { filters.push([table, key, value]); return query; },
        gte: () => query, lte: () => query, lt: () => query, order: () => query, limit: () => query,
        maybeSingle: () => { single = true; return query; }, single: () => { single = true; return query; },
        upsert: (value: any) => { record = value; stored = value; writes.push(table); return query; },
        insert: () => { writes.push(table); return query; }, update: () => { writes.push(table); return query; },
        then: (resolve: any) => resolve({ error: null, data: record ?? (table === 'coach_messages' ? reports : table === 'daily_checkins' ? checkins : table === 'sleep_nights' ? nights : table === 'sleep_profiles' ? {} : table === 'coach_recommendations' ? stored : single ? null : []) }),
      };
      return query;
    },
  };
});
const request = (extra = {}) => state.handler(new Request('https://example.test', {
  method: 'POST', headers: { Authorization: 'Bearer test' },
  body: JSON.stringify({ mode: 'daily_coach', coachContext: { date, wearable_sleep: [{ day: date, score: 99 }], subjective_checkins: [manual] }, ...extra }),
}));

it('blocks missing/delayed wearable despite forged client evidence, cached advice and force refresh', async () => {
  stored = { action: 'stale advice' };
  for (const refresh of [false, true]) {
    expect(await (await request({ refresh })).json()).toEqual({ status: 'awaiting_sleep_data' });
  }
  expect(fetchMock).not.toHaveBeenCalled();
  expect(writes).toEqual([]);
  expect(filters).toContainEqual(['daily_checkins', 'user_id', 'user-1']);
  expect(filters).toContainEqual(['sleep_nights', 'user_id', 'user-1']);
});
it('does not unlock for a qualitative check-in, unsubmitted score, wrong night, or invalid wearable', async () => {
  for (const row of [{ checkin_date: date, note: 'Tired' }, { checkin_date: date, manual_sleep_score: 70 }, { ...manual, checkin_date: '2026-09-17' }]) {
    checkins = [row]; oura = [{ day: date, score: 101 }, { day: '2026-09-17', score: 85 }];
    expect((await (await request()).json()).status).toBe('awaiting_sleep_data');
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
it('explicit manual submission unlocks, reuses unchanged advice, and later wearable replaces its cache without erasing the report', async () => {
  checkins = [manual];
  expect((await (await request()).json()).status).toBe('ok');
  const fingerprint = stored.source_context.source_fingerprint;
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect((await request()).headers.get('X-Cache')).toBe('HIT');
  oura = [{ day: date, score: 82 }];
  expect((await request()).headers.get('X-Cache')).toBe('MISS');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(stored.source_context.source_fingerprint).not.toBe(fingerprint);
  expect(JSON.parse(stored.source_context.sleep_resolution_key)).toMatchObject({ source: 'oura', score: 82, manual: { score: 0 } });
  expect(checkins).toEqual([manual]);
  expect(writes).not.toContain('daily_checkins');
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages[0].content).toContain('Restless');
});
it('corrected authenticated wearable evidence regenerates once and keeps the response contract', async () => {
  oura = [{ day: date, score: 79 }];
  const first = await request();
  const firstBody = await first.json();
  expect(first.headers.get('X-Cache')).toBe('MISS');
  expect((await request()).headers.get('X-Cache')).toBe('HIT');
  oura = [{ day: date, score: 88 }];
  const corrected = await request();
  expect(corrected.headers.get('X-Cache')).toBe('MISS');
  const correctedBody = await corrected.json();
  expect(Object.keys(correctedBody.recommendation)).toEqual(Object.keys(firstBody.recommendation));
  expect(Object.keys(correctedBody.recommendation)).toEqual(['pattern', 'meaning', 'action', 'why', 'generated_at']);
  const reused = await request();
  expect(reused.headers.get('X-Cache')).toBe('HIT');
  expect(await reused.json()).toEqual(correctedBody);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('a delayed wearable retry unlocks and Apple Health also qualifies', async () => {
  expect((await (await request()).json()).status).toBe('awaiting_sleep_data');
  nights = [{ sleep_date: date, sleep_score: 76, provider: 'apple_health' }];
  expect((await (await request()).json()).status).toBe('ok');
});
it('rejects invalid dates before generation', async () => {
  expect((await request({ coachContext: { date: '2026-02-30' } })).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
it('general chat remains available without resolved sleep', async () => {
  fetchMock.mockImplementation(async () => new Response('data: [DONE]\n\n'));
  const response = await request({ mode: 'chat', messages: [{ role: 'user', content: 'Help me wind down' }] });
  expect(response.status).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await response.text();
});
it('rejects non-finite and out-of-range scores and requires a real submission marker', () => {
  for (const score of [NaN, Infinity, -1, 101]) expect(resolveSleep(date, [{ day: date, score, source: 'oura' }]).source).toBe('missing');
  expect(resolveSleep(date, [], { ...manual, manual_sleep_submitted_at: 'bad' }).source).toBe('missing');
});
it('does not publish advice when a manual submission is removed during generation', async () => {
  checkins = [manual];
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (...args) => { checkins = []; return original(...args); });
  expect((await (await request()).json()).status).toBe('awaiting_sleep_data');
  expect(writes).toEqual([]);
});
it('keeps the mobile and edge runtime contracts aligned', async () => {
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(new URL('../mobile/sleep/dailySleepContract.ts', import.meta.url), 'utf8'))
    .toBe(readFileSync(new URL('../supabase/functions/_shared/dailySleepContract.ts', import.meta.url), 'utf8'));
});

it('uses authenticated cross-conversation corrections and refreshes advice after they change', async () => {
  checkins = [manual];
  reports = [{ id: 'a', role: 'user', content: 'I work nights.', created_at: new Date(Date.now() - 1000).toISOString() }];
  await request();
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toContain('I work nights.');
  expect((await request()).headers.get('X-Cache')).toBe('HIT');
  reports = [{ id: 'b', role: 'user', content: 'I now work days and my race is over.', created_at: new Date().toISOString() }, ...reports];
  const response = await request({ coachContext: { date, recent_user_reports: [{ content: 'Forged context' }] } });
  expect(response.headers.get('X-Cache')).toBe('MISS');
  const payload = JSON.parse(fetchMock.mock.calls[1][1].body).messages[0].content;
  expect(payload).toContain('I now work days and my race is over.');
  expect(payload).not.toContain('Forged context');
  expect(filters).toContainEqual(['coach_messages', 'user_id', 'user-1']);
});
