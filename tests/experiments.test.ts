import { describe, expect, it } from 'vitest';

import { getAdaptiveExperiment, getStarterExperiment, localISODate } from '../mobile/coaching/experiments';

describe('adaptive coaching experiments', () => {
  it('supports every canonical PR #22 concern key', () => {
    const concerns = [
      'falling_asleep',
      'night_waking',
      'early_waking',
      'unrefreshed',
      'irregular_schedule',
    ] as const;

    for (const concern of concerns) {
      expect(getStarterExperiment(concern).behavior).toBeTruthy();
    }
  });

  it('starts with the experiment mapped to the primary concern', () => {
    const result = getAdaptiveExperiment('early_waking', []);
    expect(result.decision).toBe('start');
    expect(result.behavior).toBe(getStarterExperiment('early_waking').behavior);
  });

  it('repeats the latest experiment after partial adherence', () => {
    const starter = getStarterExperiment('irregular_schedule');
    const result = getAdaptiveExperiment('irregular_schedule', [{ behavior: starter.behavior, status: 'partial' }]);
    expect(result.decision).toBe('repeat');
    expect(result.behavior).toBe(starter.behavior);
  });

  it('simplifies an experiment that was skipped', () => {
    const starter = getStarterExperiment('falling_asleep');
    const result = getAdaptiveExperiment('falling_asleep', [{ behavior: starter.behavior, status: 'skipped' }]);
    expect(result.decision).toBe('simplify');
    expect(result.behavior).toContain(starter.behavior);
  });

  it('advances after completion without running beyond the program', () => {
    const starter = getStarterExperiment('unrefreshed');
    const next = getAdaptiveExperiment('unrefreshed', [{ behavior: starter.behavior, status: 'completed' }]);
    expect(next.decision).toBe('advance');
    expect(next.behavior).not.toBe(starter.behavior);

    const final = getAdaptiveExperiment('unrefreshed', [{ behavior: 'Avoid using snooze tomorrow morning.', status: 'completed' }]);
    expect(final.behavior).toBe('Avoid using snooze tomorrow morning.');
  });
});

describe('localISODate', () => {
  it('formats a local calendar date without UTC drift', () => {
    expect(localISODate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
