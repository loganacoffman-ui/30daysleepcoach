import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { DAILY_DECISION_TOOL } from '../supabase/functions/_shared/dailyDecision';
import { resolveSleep } from '../mobile/sleep/dailySleepContract';

const state = vi.hoisted(() => ({ client: null as any, handler: null as any }));
vi.mock('jsr:@supabase/functions-js/edge-runtime.d.ts', () => ({}));
vi.mock('jsr:@supabase/supabase-js@2', () => ({ createClient: () => state.client }));
vi.mock('../supabase/functions/_shared/tracing.ts', () => ({
  tracedAnthropic: (_name: unknown, _body: unknown, fn: () => unknown) => fn(),
  startAnthropicSpan: vi.fn(), endAnthropicSpan: vi.fn(),
}));
let reports: any[];
let profile: any, adherence: any[], currentCommitment: any, cacheReadError: any;
let checkins: any[], nights: any[], oura: any[], stored: any, writes: string[], filters: any[];
const date = '2026-09-18';
const manual = { checkin_date: date, manual_sleep_score: 0, manual_sleep_submitted_at: `${date}T08:00:00Z`, note: 'Restless' };
const fetchMock = vi.fn();
function modelResponse(payload: any, init?: ResponseInit) {
  let input;try {input=JSON.parse(payload.content[0].text);}catch {input={};}
  return new Response(JSON.stringify({stop_reason:'tool_use',content:[{type:'tool_use',name:DAILY_DECISION_TOOL.name,input}]}),init);
}
beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: () => undefined }, serve: (handler: unknown) => { state.handler = handler; } });
  await import('../supabase/functions/sleep-coach/index');
});
beforeEach(() => {
  reports = []; checkins = []; nights = []; oura = []; stored = null; writes = []; filters = [];
  profile = {}; adherence = []; currentCommitment = null; cacheReadError = null;
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockImplementation(async () => modelResponse({ content: [{ type: 'text', text: JSON.stringify({decision:'replace',reason:'Current context supports this action',pattern:'A pattern',meaning:'Meaning',action:'Dim lights',why:'Rest'}) }] }, { status: 200 }));
  state.client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    rpc: vi.fn(async (_name, args) => {
      const record = args.p_record;
      writes.push('coach_recommendations');
      if (record.source_context.decision.kind !== 'clarify' && (!currentCommitment || currentCommitment.status === 'committed')) {
        if (!currentCommitment || currentCommitment.behavior !== record.action) {
          writes.push('behavior_commitments');
          currentCommitment = {id: currentCommitment?.id ?? 'experiment',behavior:record.action,status:'committed',updated_at:record.generated_at};
        }
      }
      stored = {...record, source_context:{...record.source_context,commitment_snapshot:currentCommitment}};
      return {data:{status:'ok',recommendation:stored},error:null};
    }),
    functions: { invoke: vi.fn(async () => ({ data: { data: oura }, error: null })) },
    from: (table: string) => {
      let single = false; let record: any;
      const query: any = {
        select: () => query, eq: (key: string, value: unknown) => { filters.push([table, key, value]); return query; },
        gte: () => query, lte: () => query, lt: () => query, order: () => query, limit: () => query,
        maybeSingle: () => { single = true; return query; }, single: () => { single = true; return query; },
        upsert: (value: any) => { record = value; stored = value; writes.push(table); return query; },
        insert: () => { writes.push(table); return query; }, update: () => { writes.push(table); return query; },
        then: (resolve: any) => resolve({ error: table === 'coach_recommendations' && !record ? cacheReadError : null, data: record ?? (table === 'coach_messages' ? reports : table === 'daily_checkins' ? checkins : table === 'sleep_nights' ? nights : table === 'sleep_profiles' ? profile : table === 'coach_recommendations' ? cacheReadError ? null : stored : table === 'behavior_commitments' ? single ? currentCommitment : adherence : single ? null : []) }),
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
  expect(Object.keys(correctedBody.recommendation)).toEqual(['decision', 'pattern', 'meaning', 'action', 'why', 'generated_at']);
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

it('reuses the exact saved report on repeated checks after its experiment is saved', async () => {
  checkins = [manual];
  const first = await (await request()).json();
  expect(currentCommitment.behavior).toBe(first.recommendation.action);
  for (let check = 0; check < 3; check++) {
    const response = await request({ coachContext: { date, profile: { ignored_client_field: check } } });
    expect(response.headers.get('X-Cache')).toBe('HIT');
    expect(await response.json()).toEqual(first);
  }
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(['profile', 'checkin', 'adherence'])('regenerates once for new %s context, then reuses it', async input => {
  checkins = [manual];
  await request();
  if (input === 'profile') profile = { primary_concern: 'falling_asleep' };
  if (input === 'checkin') checkins = [{ ...manual, note: 'I changed my work schedule.' }];
  if (input === 'adherence') adherence = [{ behavior_date: '2026-09-17', behavior: 'Dim lights', status: 'completed' }];
  expect((await request()).headers.get('X-Cache')).toBe('MISS');
  expect((await request()).headers.get('X-Cache')).toBe('HIT');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not spend another model call when the saved-report lookup fails', async () => {
  checkins = [manual];
  await request();
  cacheReadError = { message: 'Cache read unavailable' };
  expect((await request()).status).toBe(500);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  cacheReadError = null;
  expect((await request()).headers.get('X-Cache')).toBe('HIT');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('only an explicit refresh bypasses unchanged evidence', async () => {
  checkins = [manual];
  await request();
  expect((await request()).headers.get('X-Cache')).toBe('HIT');
  expect((await request({ refresh: true })).headers.get('X-Cache')).toBe('MISS');
  expect((await request()).headers.get('X-Cache')).toBe('HIT');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('uses the evaluated daily instructions and current prompt version', async () => {
  const { ADAPTIVE_DAILY_SYSTEM_PROMPT } = await import('../supabase/functions/_shared/dailyCoachingPrompt');
  const { DAILY_COACH_PROMPT_VERSION } = await import('../supabase/functions/_shared/dailySleepContract');
  checkins = [manual];
  await request();
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).system).toBe(ADAPTIVE_DAILY_SYSTEM_PROMPT);
  expect(stored.prompt_version).toBe(DAILY_COACH_PROMPT_VERSION);
});

it('publishes an adapted action instead of overwriting it with a short prior experiment', async () => {
  checkins = [manual];
  adherence = [{ behavior_date: '2026-09-17', behavior: 'Read twenty minutes', status: 'partial' }];
  reports = [{ id: 'new', role: 'user', content: 'I only have one minute now.', created_at: new Date().toISOString() }];
  const response = await (await request()).json();
  expect(response.recommendation.action).toBe('Dim lights');
  expect(response.recommendation.why).toBe('Rest');
  expect(stored.action).not.toBe(adherence[0].behavior);
});

it.each(['completed', 'partial', 'skipped'])('does not reset today’s %s experiment on refresh or cache hit', async status => {
  checkins = [manual];
  currentCommitment = { id: 'current', behavior: 'Read two pages', status };
  const first = await (await request()).json();
  expect(first.recommendation.action).toBe('Dim lights');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toContain('current_daily_experiment');
  expect(writes).not.toContain('behavior_commitments');
  expect((await request()).headers.get('X-Cache')).toBe('HIT');
  await request({ refresh: true });
  expect(writes).not.toContain('behavior_commitments');
  expect(currentCommitment.status).toBe(status);
});

it('invalidates cache when the current experiment changes and uses the new model decision', async () => {
  checkins = [manual];
  await request();
  currentCommitment = { id: 'confirmed-change', behavior: 'Read two pages', status: 'committed' };
  const response = await request();
  expect(response.headers.get('X-Cache')).toBe('MISS');
  expect((await response.json()).recommendation.action).toBe('Dim lights');
  expect((await request()).headers.get('X-Cache')).toBe('HIT');
});

it('regenerates a report cached under the old prompt version once', async () => {
  checkins = [manual];
  await request();
  stored.prompt_version = 'native-daily-v7-resolved-sleep';
  expect((await request()).headers.get('X-Cache')).toBe('MISS');
  expect((await request()).headers.get('X-Cache')).toBe('HIT');
});

it('retries an overlong daily response once and does not store it if still invalid', async () => {
  checkins = [manual];
  fetchMock.mockImplementation(async () => modelResponse({ content: [{ type: 'text', text: '**Pattern** ' + 'word '.repeat(90) + "\n**What this likely means** Meaning\n**Tonight's action** Action\n**Why this, now** Why" }] }));
  expect((await (await request()).json()).status).toBe('generation_failed');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(writes).toEqual([]);
});

it('does not publish an obsolete action if the experiment changes during generation', async () => {
  checkins = [manual];
  currentCommitment = { id: 'current', behavior: 'Read two pages', status: 'committed' };
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (...args) => {
    currentCommitment = { ...currentCommitment, behavior: 'Write three tasks' };
    return original(...args);
  });
  expect((await (await request()).json()).status).toBe('experiment_changed');
  expect(writes).toEqual([]);
});

it('publishes the grounded score summary even when the model invents a numeric pattern', async () => {
  checkins = [manual];
  oura = [{ day: date, score: 74 }];
  const body = await (await request()).json();
  expect(body.recommendation.pattern).toBe('Oura scored 74; your own sleep rating was 0.');
  expect(stored.pattern).toBe(body.recommendation.pattern);
});

it('replaces the saved night-shift action after a correction and persists the model decision',async()=>{
 checkins=[manual];currentCommitment={id:'current',behavior:'Wear glasses before daytime sleep.',status:'committed'};
 reports=[{id:'correction',role:'user',content:'I now work days and check email in bed.',created_at:new Date().toISOString()}];
 const result=await(await request()).json();
 expect(result.recommendation.action).toBe('Dim lights');
 expect(currentCommitment.behavior).toBe(result.recommendation.action);
 expect(stored.source_context.decision.kind).toBe('replace');
 expect(state.client.rpc).toHaveBeenCalledWith('publish_daily_coaching',expect.objectContaining({p_expected_experiment:expect.objectContaining({behavior:'Wear glasses before daytime sleep.'})}));
 expect((await request()).headers.get('X-Cache')).toBe('HIT');
});
it('caches a clarification without creating a question-shaped experiment',async()=>{
 checkins=[manual];
 fetchMock.mockImplementation(async()=>modelResponse({content:[{type:'text',text:JSON.stringify({decision:'clarify',reason:'Sleep opportunity is unknown.',pattern:'One sleep report.',meaning:'Your next schedule is unclear.',action:'When can you next sleep?',why:'That determines which step fits.'})}]}));
 const first=await(await request()).json();
 expect(first.recommendation.decision).toBe('clarify');
 expect(currentCommitment).toBeNull();expect(writes).not.toContain('behavior_commitments');
 expect((await request()).headers.get('X-Cache')).toBe('HIT');
});
it('continues a useful saved action even when other context changes',async()=>{
 checkins=[manual];currentCommitment={id:'current',behavior:'Read one page.',status:'committed'};
 reports=[{id:'new',role:'user',content:'Work is busy, but reading still helps and fits.',created_at:new Date().toISOString()}];
 fetchMock.mockImplementation(async()=>modelResponse({content:[{type:'text',text:JSON.stringify({decision:'continue',reason:'The user reports continued benefit and feasibility.',pattern:'One sleep report.',meaning:'Your routine remains useful.',action:'Read one page.',why:'Reading still helps you settle.'})}]}));
 expect((await(await request()).json()).recommendation.action).toBe('Read one page.');
 expect(writes).not.toContain('behavior_commitments');
});
it('fails closed when transactional publication reports a race or storage failure',async()=>{
 checkins=[manual];state.client.rpc.mockResolvedValueOnce({data:{status:'experiment_changed'},error:null});
 expect((await request()).status).toBe(409);
 state.client.rpc.mockResolvedValueOnce({data:null,error:{message:'offline'}});
 expect((await request()).status).toBe(500);expect(stored).toBeNull();
});
