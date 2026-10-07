import { describe, it, expect } from 'vitest';
import { matchesState, filterInventory } from '../admin/inventory.mjs';
const scenario = { emailConfirmed: true, onboardingStep: 'complete', checkinCount: 7, primaryConcern: 'night_waking', feedback: true };
const user = { email: 'sleepcoach-test+week@example.test', manageable: true, status: 'ready', email_confirmed: true, onboarding_complete: true, onboarding_step: 'complete', checkin_count: 7, feedback_count: 7, primary_concern: 'night_waking' };
const filters = { search: '', confirmation: 'all', onboarding: 'all', matchesOnly: false };
describe('test account inventory', () => {
  it('matches current state and ignores stale generation options', () => {
    expect(matchesState({ ...user, options: { checkinCount: 0 } }, scenario)).toBe(true);
    expect(matchesState({ ...user, checkin_count: 8, options: scenario }, scenario)).toBe(false);
    expect(matchesState({ ...user, onboarding_step: 'reminder' }, scenario)).toBe(false);
  });
  it('requires enough feedback and a reusable, protected account', () => {
    for (const patch of [{ feedback_count: 6 }, { manageable: false }, { status: 'error' }, { email_confirmed: false }, { primary_concern: 'early_waking' }]) {
      expect(matchesState({ ...user, ...patch }, scenario)).toBe(false);
    }
    expect(matchesState({ ...user, feedback_count: 0 }, { ...scenario, feedback: false })).toBe(true);
  });
  it('ignores unanswered concern before that onboarding step', () => {
    expect(matchesState({ ...user, onboarding_step: 'intro', primary_concern: null, checkin_count: 0, feedback_count: 0 }, { ...scenario, onboardingStep: 'intro', checkinCount: 0 })).toBe(true);
  });
  it('searches emails case-insensitively, filters state, and puts matches first', () => {
    const other = { ...user, email: 'sleepcoach-test+new@example.test', email_confirmed: false, onboarding_complete: false, onboarding_step: 'intro' };
    expect(filterInventory([other, user], scenario, filters)).toEqual([user, other]);
    expect(filterInventory([other, user], scenario, { ...filters, search: ' WEEK@' })).toEqual([user]);
    expect(filterInventory([other, user], scenario, { ...filters, confirmation: 'unconfirmed', onboarding: 'incomplete' })).toEqual([other]);
    expect(filterInventory([other, user], scenario, { ...filters, matchesOnly: true })).toEqual([user]);
    expect(filterInventory([user], scenario, { ...filters, search: 'missing' })).toEqual([]);
  });
});
