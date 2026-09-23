import { chooseDailyExperiment } from './experimentCycle.ts';

Deno.test('keeps a useful experiment after more than three nights without replacing its rationale', () => {
  const behavior = 'Write tomorrow’s tasks for three minutes.';
  const choice = chooseDailyExperiment({
    history: [1, 2, 3, 4].map(day => ({ behavior, behavior_date: `2026-09-0${day}`, status: 'completed' })),
    proposedBehavior: behavior, proposedWhy: 'You said writing helped and asked to keep it.',
  });
  if (choice.behavior !== behavior || choice.phase !== 'continue' || !choice.why.includes('asked')) throw Error('Lost useful experiment or context');
});

Deno.test('allows an adapted proposal before three nights when no experiment is saved today', () => {
  const choice = chooseDailyExperiment({
    history: [{ behavior: 'Read for twenty minutes.', behavior_date: '2026-09-21', status: 'partial' }],
    proposedBehavior: 'Read one page before bed.', proposedWhy: 'You now have only one minute.',
  });
  if (choice.behavior !== 'Read one page before bed.' || choice.phase !== 'new') throw Error('Old nightly override blocked adaptation');
});

Deno.test('never silently replaces today’s saved experiment even after a completed three-night run', () => {
  const behavior = 'Read ten pages.';
  const choice = chooseDailyExperiment({ currentBehavior: behavior,
    history: [1, 2, 3].map(day => ({ behavior, behavior_date: `2026-09-0${day}`, status: 'completed' })),
    proposedBehavior: 'Try breathing.', proposedWhy: 'Model picked a different action.',
  });
  if (choice.behavior !== behavior || choice.phase !== 'continue' || choice.why.includes('Model picked')) throw Error('Overwrote today’s saved choice');
});

Deno.test('retains personalized rationale when the model continues today’s same action', () => {
  const choice = chooseDailyExperiment({ currentBehavior: 'Read two pages.', history: [],
    proposedBehavior: 'Read two pages.', proposedWhy: 'Two pages fit your caregiving window.',
  });
  if (choice.why !== 'Two pages fit your caregiving window.') throw Error('Discarded grounded rationale');
});
