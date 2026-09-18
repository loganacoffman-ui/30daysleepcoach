import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../mobile/supabase';
import { invalidateCoachContext, loadCoachHomeState, localDate } from '../mobile/coach/coachRepository';
import { coachHomeExperience } from '../mobile/coach/homeExperience';

vi.mock('../mobile/supabase', () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('../mobile/node_modules/expo/fetch.js', () => ({ fetch: vi.fn() }));
vi.mock('../mobile/healthkit/appleHealth', () => ({ syncAppleHealthForDate: vi.fn().mockResolvedValue({ status: 'unavailable' }) }));
vi.mock('../mobile/sleep/sourcePreference', () => ({
  isUnavailableSleepSchemaError: vi.fn().mockReturnValue(false),
  loadPreferredSleepSource: vi.fn().mockResolvedValue(null),
}));

const user = { id: 'home-user' } as User;
let checkins: { checkin_date: string }[];
let checkinError: Error | null;

beforeEach(() => {
  checkins = [];
  checkinError = null;
  invalidateCoachContext(user.id);
  vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { data: [] }, error: null });
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      gte: () => query,
      order: () => query,
      limit: () => query,
      then: (resolve: (value: unknown) => unknown) => resolve({
        data: table === 'daily_checkins' ? checkins : [],
        error: table === 'daily_checkins' ? checkinError : null,
      }),
    };
    return query as never;
  });
});

describe('coach home progression', () => {
  it('welcomes a new user without needing wearable data', async () => {
    const state = await loadCoachHomeState(user);
    const home = coachHomeExperience(state, '  Alex Chen  ');
    expect(state.checkinCount).toBe(0);
    expect(home.title).toBe('Welcome, Alex.');
    expect(home.checkinEyebrow).toBe('START HERE');
    expect(home.prompts).not.toContain('How is my sleep trending?');
    expect(home.prompts).toContain('I’d like to talk about my bedtime habits');
  });

  it('acknowledges the first completed check-in while keeping starter prompts', async () => {
    checkins = [{ checkin_date: localDate() }];
    const state = await loadCoachHomeState(user);
    const home = coachHomeExperience(state, 'Alex');
    expect(state.hasCheckedInToday).toBe(true);
    expect(home.checkinEyebrow).toContain('COMPLETE');
    expect(home.prompts).toEqual(coachHomeExperience(null, 'Alex').prompts);
    expect(home.introduction).toBeNull();
  });

  it('keeps early guidance through two check-ins and switches after three', async () => {
    checkins = [{ checkin_date: '2026-01-02' }, { checkin_date: '2026-01-01' }];
    const early = coachHomeExperience(await loadCoachHomeState(user), 'Alex');
    expect(early.prompts).not.toContain('How is my sleep trending?');
    checkins.push({ checkin_date: '2025-12-31' });
    const returning = coachHomeExperience(await loadCoachHomeState(user), 'Alex');
    expect(returning.prompts).toContain('How is my sleep trending?');
    expect(returning.prompts).toContain('What have we learned about my sleep?');
    expect(returning.prompts).toContain('My routine has changed lately');
    expect(returning.checkinEyebrow).toBe('YOUR NEXT STEP');
    expect(returning.introduction).toBeNull();
  });

  it('does not turn a failed history read into a first-time welcome', async () => {
    checkinError = new Error('Offline');
    await expect(loadCoachHomeState(user)).rejects.toThrow('Offline');
    const fallback = coachHomeExperience(null, '');
    expect(fallback.checkinEyebrow).toBe('YOUR NEXT STEP');
    expect(fallback.title).not.toContain('Welcome');
    expect(fallback.prompts).not.toContain('How is my sleep trending?');
  });
});
