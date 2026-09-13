import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../mobile/supabase';
import {
  checkinTranscriptRows,
  loadCoachConversation,
  saveCheckinTranscript,
} from '../mobile/coach/coachRepository';
import { answerCheckin, startCheckin } from '../mobile/today/checkinConversation';

vi.mock('../mobile/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../mobile/node_modules/expo/fetch.js', () => ({ fetch: vi.fn() }));
vi.mock('../mobile/healthkit/appleHealth', () => ({ syncAppleHealthForDate: vi.fn() }));
vi.mock('../mobile/sleep/sourcePreference', () => ({ isUnavailableSleepSchemaError: vi.fn(), loadPreferredSleepSource: vi.fn() }));

const user = { id: 'user-1' } as User;
const from = vi.mocked(supabase.from);
const completedAt = new Date('2026-09-12T14:30:00.000Z');
let storedMessages: Record<string, unknown>[];
let inserts: Record<string, unknown>[][];
let updates: { table: string; values: Record<string, unknown> }[];
let queries: { table: string; filters: [string, string][] }[];

const completedCheckin = () => {
  const adherence = startCheckin('Take a five-minute walk', 'commitment-1');
  const feeling = answerCheckin(adherence, 'Did it', 'completed');
  const factor = answerCheckin(feeling, 'Okay', 'okay');
  return answerCheckin(factor, 'Stress', 'stress');
};

beforeEach(() => {
  from.mockReset();
  storedMessages = [];
  inserts = [];
  updates = [];
  queries = [];
  from.mockImplementation((table: string) => {
    const query: typeof queries[number] = { table, filters: [] };
    queries.push(query);
    const builder = {
      select: () => builder,
      eq: (key: string, value: string) => { query.filters.push([key, value]); return builder; },
      limit: () => builder,
      order: () => builder,
      update: (values: Record<string, unknown>) => { updates.push({ table, values }); return builder; },
      insert: async (rows: Record<string, unknown>[]) => { inserts.push(rows); return { data: null, error: null }; },
      maybeSingle: async () => ({
        data: table === 'coach_conversations'
          ? { id: 'daily-thread' }
          : storedMessages.find(message => (message.metadata as { source?: string } | undefined)?.source === 'daily_checkin') ?? null,
        error: null,
      }),
      range: async (start: number, end: number) => ({
        data: table === 'coach_messages' ? storedMessages.slice(start, end + 1) : [],
        error: null,
      }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null }),
    };
    return builder as never;
  });
});

describe('persisted daily check-in transcript', () => {
  it('saves every question and answer of the completed flow to the day’s thread', async () => {
    expect(await saveCheckinTranscript(user, 'daily-thread', completedCheckin().turns, completedAt)).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].map(row => [row.role, row.content])).toEqual([
      ['assistant', 'How did it go with “Take a five-minute walk”?'],
      ['user', 'Did it'],
      ['assistant', 'How are you feeling this morning?'],
      ['user', 'Okay'],
      ['assistant', 'What do you think affected your sleep last night? You can pick one or tell me in your own words.'],
      ['user', 'Stress'],
      ['assistant', 'Anything else you’d like me to know? There’s room for the whole story, or you can finish here.'],
    ]);
    for (const row of inserts[0]) {
      expect(row.conversation_id).toBe('daily-thread');
      expect(row.user_id).toBe('user-1');
      expect(row.metadata).toMatchObject({ source: 'daily_checkin' });
    }
    expect(updates).toEqual([{ table: 'coach_conversations', values: { updated_at: expect.any(String) } }]);
  });

  // History is ordered by created_at, and rows written in one statement would
  // otherwise share a single timestamp.
  it('timestamps each turn in flow order, ahead of later follow-ups', () => {
    const rows = checkinTranscriptRows(completedCheckin().turns, completedAt);
    const times = rows.map(row => new Date(row.created_at).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
    expect(times.at(-1)).toBeLessThan(completedAt.getTime());
  });

  it('keeps a long reply within the stored message limit', () => {
    const rows = checkinTranscriptRows(
      [...completedCheckin().turns, { role: 'user' as const, content: 'a'.repeat(20_000) }],
      completedAt,
    );
    expect(rows.filter(row => /^a+$/.test(row.content)).map(row => row.content.length)).toEqual([12_000, 8_000]);
    for (const row of rows) expect(row.content.length).toBeLessThanOrEqual(12_000);
  });

  it('does not duplicate the transcript when the day’s check-in is saved again', async () => {
    storedMessages = [{ id: 'checkin-1', role: 'assistant', content: 'How are you feeling this morning?', created_at: completedAt.toISOString(), metadata: { source: 'daily_checkin', turn: 0 } }];
    expect(await saveCheckinTranscript(user, 'daily-thread', completedCheckin().turns, completedAt)).toBe(false);
    expect(inserts).toEqual([]);
    expect(queries[0].filters).toContainEqual(['metadata->>source', 'daily_checkin']);
  });

  it('skips a check-in that produced no turns', async () => {
    expect(await saveCheckinTranscript(user, 'daily-thread', [], completedAt)).toBe(false);
    expect(inserts).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('revisiting a past daily thread', () => {
  it('returns the check-in flow with its follow-ups, marking which turns came from the check-in', async () => {
    storedMessages = [
      { id: 'checkin-1', role: 'assistant', content: 'How are you feeling this morning?', created_at: '2026-09-12T14:29:58Z', metadata: { source: 'daily_checkin', turn: 0 } },
      { id: 'checkin-2', role: 'user', content: 'Okay', created_at: '2026-09-12T14:29:59Z', metadata: { source: 'daily_checkin', turn: 1 } },
      { id: 'followup-1', role: 'user', content: 'Why did I wake at 3am?', created_at: '2026-09-12T15:00:00Z' },
      { id: 'followup-2', role: 'assistant', content: 'Your late meal lines up with it.', created_at: '2026-09-12T15:00:04Z' },
    ];
    const messages = await loadCoachConversation(user, 'daily-thread');
    expect(messages.map(message => [message.id, message.origin])).toEqual([
      ['checkin-1', 'checkin'],
      ['checkin-2', 'checkin'],
      ['followup-1', undefined],
      ['followup-2', undefined],
    ]);
  });
});
