import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../mobile/supabase';
import { loadCoachConversation } from '../mobile/coach/coachRepository';
import type { User } from '@supabase/supabase-js';

vi.mock('../mobile/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../mobile/node_modules/expo/fetch.js', () => ({ fetch: vi.fn() }));
vi.mock('../mobile/healthkit/appleHealth', () => ({ syncAppleHealthForDate: vi.fn() }));
vi.mock('../mobile/sleep/sourcePreference', () => ({ isUnavailableSleepSchemaError: vi.fn(), loadPreferredSleepSource: vi.fn() }));

const user = { id: 'user-1' } as User;
const from = vi.mocked(supabase.from);
let messages: Record<string, unknown>[];
let toolCalls: Record<string, unknown>[];
let missingConversation: boolean;
let failedPage: number | null;
let conversationTitle: string;
let recommendation: Record<string, unknown> | null;
let recommendationError: Error | null;
const queries: { table: string; filters: [string, string][]; orders: string[]; range?: [number, number] }[] = [];

beforeEach(() => {
  from.mockReset();
  messages = [];
  toolCalls = [];
  missingConversation = false;
  failedPage = null;
  conversationTitle = 'Sleep coaching';
  recommendation = null;
  recommendationError = null;
  queries.length = 0;
  from.mockImplementation((table: string) => {
    const query: typeof queries[number] = { table, filters: [], orders: [] };
    queries.push(query);
    const builder = {
      select: () => builder,
      eq: (key: string, value: string) => { query.filters.push([key, value]); return builder; },
      order: (column: string) => { query.orders.push(column); return builder; },
      maybeSingle: async () => table === 'coach_recommendations'
        ? { data: recommendation, error: recommendationError }
        : { data: missingConversation ? null : { id: 'daily-thread', title: conversationTitle }, error: null },
      range: async (start: number, end: number) => {
        query.range = [start, end];
        if (table === 'coach_messages' && start === failedPage) return { data: null, error: new Error('History load failed') };
        return { data: (table === 'coach_messages' ? messages : toolCalls).slice(start, end + 1), error: null };
      },
    };
    return builder as never;
  });
});

describe('persisted coach conversation history', () => {
  it('restores saved advice between a past check-in and its follow-ups on every reopen', async () => {
    conversationTitle = 'Your Day · 2026-09-08';
    recommendation = {
      pattern: 'Your sleep has been steadier.', meaning: 'Your routine may be helping.',
      action: 'Keep your wake time consistent.', why: 'Give the routine time.',
      generated_at: '2026-09-08T19:00:00Z',
    };
    messages = [
      { id: 'checkin', role: 'user', content: 'Feeling rested', created_at: '2026-09-08T12:00:00Z', metadata: { source: 'daily_checkin' } },
      { id: 'followup', role: 'user', content: 'What about weekends?', created_at: '2026-09-08T13:00:00Z' },
    ];
    const history = await loadCoachConversation(user, 'daily-thread');
    expect(history.map(message => message.id)).toEqual(['checkin', 'daily-coaching:daily-thread', 'followup']);
    expect(history[1]).toMatchObject({
      role: 'assistant', origin: 'daily_coaching', createdAt: recommendation.generated_at,
      content: 'Your sleep has been steadier.\n\nYour routine may be helping.\n\nTonight: Keep your wake time consistent.\n\nGive the routine time.',
    });
    expect(await loadCoachConversation(user, 'daily-thread')).toEqual(history);
    for (const query of queries.filter(query => query.table === 'coach_recommendations')) {
      expect(query.filters).toEqual([['user_id', 'user-1'], ['recommendation_date', '2026-09-08']]);
    }
  });

  it('restores advice even when no chat transcript was saved, including legacy action-only reports', async () => {
    conversationTitle = 'Your Day · 2026-09-08';
    recommendation = { action: 'Try a short walk.', generated_at: '2026-09-08T12:00:00Z' };
    expect(await loadCoachConversation(user, 'daily-thread')).toMatchObject([
      { origin: 'daily_coaching', content: 'Tonight: Try a short walk.' },
    ]);
  });

  it('does not fabricate advice for a day without a saved recommendation', async () => {
    conversationTitle = 'Your Day · 2026-09-08';
    expect(await loadCoachConversation(user, 'daily-thread')).toEqual([]);
  });

  it('reports a recommendation read failure instead of silently dropping saved advice', async () => {
    conversationTitle = 'Your Day · 2026-09-08';
    recommendationError = new Error('Coaching history unavailable');
    await expect(loadCoachConversation(user, 'daily-thread')).rejects.toThrow('Coaching history unavailable');
  });

  it('does not attach daily advice to an ordinary chat', async () => {
    await loadCoachConversation(user, 'daily-thread');
    expect(queries.some(query => query.table === 'coach_recommendations')).toBe(false);
  });

  it('restores every follow-up after reopening, including messages past the old 60-message cutoff', async () => {
    messages = Array.from({ length: 245 }, (_, i) => ({
      id: `message-${i}`, role: i % 2 === 0 ? 'user' : 'assistant', content: `Follow-up ${i}`,
      created_at: new Date(Date.UTC(2026, 8, 8, 12, i)).toISOString(),
    }));
    const firstOpen = await loadCoachConversation(user, 'daily-thread');
    const reopened = await loadCoachConversation(user, 'daily-thread');
    expect(reopened).toEqual(firstOpen);
    expect(reopened).toHaveLength(245);
    expect(reopened.at(-1)?.content).toBe('Follow-up 244');
    expect(queries.filter(query => query.table === 'coach_messages').map(query => query.range)).toEqual([[0, 199], [200, 399], [0, 199], [200, 399]]);
    for (const query of queries.filter(query => query.table !== 'coach_conversations')) {
      expect(query.filters).toContainEqual(['conversation_id', 'daily-thread']);
      expect(query.filters).toContainEqual(['user_id', 'user-1']);
      expect(query.orders[0]).toBe('created_at');
      expect(query.orders.at(-1)).toBe('id');
    }
  });

  it('retains experiment proposals and their current status after reopening', async () => {
    messages = [{ id: 'proposal-message', role: 'assistant', content: 'Try this instead.', created_at: '2026-09-08T12:00:00Z', metadata: { tool_call_id: 'tool-1' } }];
    toolCalls = [{ id: 'tool-1', tool_name: 'change_experiment', status: 'pending', requires_confirmation: true, expires_at: '2026-09-09T12:00:00Z', input: { previous_experiment: 'Walk', replacement_experiment: 'Read', user_reason: 'Rain', coach_rationale: 'A quiet wind-down' } }];
    expect((await loadCoachConversation(user, 'daily-thread'))[0].toolCall?.status).toBe('pending');
    toolCalls[0].status = 'completed';
    expect((await loadCoachConversation(user, 'daily-thread'))[0].toolCall?.status).toBe('completed');
  });

  it('reports a failed later page instead of silently returning incomplete history', async () => {
    messages = Array.from({ length: 201 }, (_, i) => ({ id: `message-${i}` }));
    failedPage = 200;
    await expect(loadCoachConversation(user, 'daily-thread')).rejects.toThrow('History load failed');
  });

  it('does not query messages when the user cannot access the conversation', async () => {
    missingConversation = true;
    await expect(loadCoachConversation(user, 'daily-thread')).rejects.toThrow('no longer available');
    expect(queries).toHaveLength(1);
    expect(queries[0].filters).toContainEqual(['user_id', 'user-1']);
  });
});
