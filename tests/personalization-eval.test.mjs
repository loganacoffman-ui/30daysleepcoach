import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const base = new URL('../evals/personalization/', import.meta.url);
it('keeps distinct synthetic development/holdout cases with explicit assessment criteria', () => {
  const cases = JSON.parse(readFileSync(new URL('cases.json', base), 'utf8'));
  expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
  expect(cases.filter(c => c.split === 'development')).toHaveLength(6);
  expect(cases.filter(c => c.split === 'holdout')).toHaveLength(6);
  for (const c of cases) { expect(c.expected.length).toBeGreaterThan(0); expect(c.must_not.length).toBeGreaterThan(0); }
});
it('dry run produces reproducible hashes without credentials or generation', () => {
  const run = () => JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', new URL('run.mjs', base).pathname], { encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: '' } }));
  expect(run()).toEqual(run());
  expect(run().status).toContain('no model calls');
  expect(run().calls).toBe(12);
});
it('both versions retain the required output headings', () => {
  for (const file of ['baseline.txt', 'candidate.txt']) {
    const prompt = readFileSync(new URL(file, base), 'utf8');
    for (const heading of ['Pattern', 'What this likely means', "Tonight's action", 'Why this, now']) expect(prompt).toContain(`**${heading}**`);
  }
});

it('evaluates the exact prompt imported by the daily endpoint', async () => {
  const { DAILY_COACH_SYSTEM_PROMPT } = await import('../supabase/functions/_shared/dailyCoachingPrompt.ts');
  expect(DAILY_COACH_SYSTEM_PROMPT).toBe(readFileSync(new URL('candidate.txt', base), 'utf8'));
});

it('supports a separate multi-night dataset without replacing the original regression cases', () => {
  const manifest = JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', new URL('run.mjs', base).pathname, '--dataset', 'cases-longitudinal.json'], { encoding: 'utf8' }));
  expect(manifest.calls).toBe(8);
  const cases = JSON.parse(readFileSync(new URL('cases-longitudinal.json', base), 'utf8'));
  expect(cases.filter(c => c.split === 'holdout')).toHaveLength(4);
  for (const c of cases) expect(new Set(c.context.wearable_sleep.map(n => n.day)).size).toBeGreaterThanOrEqual(7);
});
