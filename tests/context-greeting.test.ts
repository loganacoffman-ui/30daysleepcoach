import { beforeEach, expect, it, vi } from 'vitest';
import { greetingReports, validateGreeting } from '../supabase/functions/_shared/greeting';
import { loadContextGreeting, invalidateGreeting, claimContextGreeting } from '../mobile/coach/greetingRepository';
import { supabase } from '../mobile/supabase';
import { screenCache } from '../mobile/cache/screenCache';
vi.mock('../mobile/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('../mobile/cache/screenCache', () => ({ screenCache: { read: vi.fn(), write: vi.fn() } }));
const now = Date.parse('2026-09-21T12:00:00Z');
const reports = [{ id: 'new', content: 'My race is over.', observed_at: '2026-09-20T12:00:00Z' },
  { id: 'old', content: 'Training for a race.', observed_at: '2026-08-22T12:00:00Z' }];
beforeEach(() => {
  vi.clearAllMocks();
  invalidateGreeting('alice'); invalidateGreeting('bob');
  vi.mocked(screenCache.read).mockResolvedValue(null);
  vi.mocked(screenCache.write).mockResolvedValue();
});
it('only offers recent context and rejects fabricated source IDs and oversized output', () => {
  const eligible = greetingReports(reports, now);
  expect(eligible.map(r => r.id)).toEqual(['new']);
  expect(validateGreeting('{"text":"How did the race go?","source_id":"old"}', eligible)).toBeNull();
  expect(validateGreeting(JSON.stringify({ text: 'word '.repeat(31), source_id: 'new' }), eligible)).toBeNull();
  expect(validateGreeting('not JSON', eligible)).toBeNull();
  expect(validateGreeting('{"text":"How has winding down felt since the race?","source_id":"new"}', eligible)?.source_id).toBe('new');
});
it('deduplicates requests, invalidates on new context and scopes replies to the authenticated account', async () => {
  const greeting = { text: 'How has winding down felt since the race?', fingerprint: 'a', expires_at: new Date(Date.now() + 60000).toISOString() };
  vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { user_id: 'alice', greeting }, error: null });
  expect(await loadContextGreeting('alice')).toEqual(greeting);
  expect(await loadContextGreeting('alice')).toEqual(greeting);
  expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
  expect(await loadContextGreeting('bob')).toBeNull();
  invalidateGreeting('alice');
  await loadContextGreeting('alice');
  expect(supabase.functions.invoke).toHaveBeenCalledTimes(3);
});
it('returns ordinary-copy fallback for failures and expired results', async () => {
  vi.mocked(supabase.functions.invoke).mockRejectedValue(new Error('offline'));
  expect(await loadContextGreeting('alice')).toBeNull();
  invalidateGreeting('alice');
  vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { user_id: 'alice', greeting: { text: 'hi', fingerprint: 'a', expires_at: '2000-01-01' } }, error: null });
  expect(await loadContextGreeting('alice')).toBeNull();
});
it('suppresses repeated context on the same day but allows corrected context', async () => {
  vi.mocked(screenCache.read).mockResolvedValue({ value: { date: '2026-09-21', fingerprint: 'a' }, savedAt: '' });
  expect(await claimContextGreeting('alice', 'a', '2026-09-21')).toBe(false);
  expect(await claimContextGreeting('alice', 'b', '2026-09-21')).toBe(true);
  expect(screenCache.write).toHaveBeenCalledWith('alice', 'greeting-seen', 1, { date: '2026-09-21', fingerprint: 'b' });
});
