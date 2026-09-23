import { readFile, mkdir, appendFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const split = value('--split', 'development');
if (!['development', 'holdout', 'all'].includes(split)) throw new Error('Use development, holdout, or all.');
const all = JSON.parse(await readFile(resolve(root, 'cases.json'), 'utf8'));
if (new Set(all.map(c => c.id)).size !== all.length) throw new Error('Duplicate case IDs.');
const cases = all.filter(c => split === 'all' || c.split === split);
const prompts = Object.fromEntries(await Promise.all(['baseline', 'candidate'].map(async name => [name, await readFile(resolve(root, `${name}.txt`), 'utf8')])));
const dailyRequestInstructions = "Generate today's four-section coaching recommendation from this combined context. Subjective check-ins and notes describe how the user felt and what they think affected sleep. Experiment adherence shows what they actually tried. Wearable sleep is the quantitative layer when Apple Health or Oura is connected; the source field identifies whether a score is app-derived or provider-owned. The sleep_resolution selects the preferred quantitative source for the requested night: wearable first, otherwise an explicitly submitted manual score. Preserve manual scores as self-reports and qualitative context, never as wearable measurements. Use relevant long-term memory to follow up on earlier goals, experiments, and outcomes. Be honest when data is sparse; do not invent measurements. Always return all four required sections.";
const hash = text => createHash('sha256').update(text).digest('hex');
const manifest = { split, cases: cases.map(c => c.id), dataset_sha256: hash(JSON.stringify(all)),
  prompt_sha256: Object.fromEntries(Object.entries(prompts).map(([name, text]) => [name, hash(text)])),
  model: value('--model', 'claude-sonnet-4-6'), max_output_tokens: 800, temperature: 'provider default (matches production)', calls: cases.length * 2 };
if (!args.includes('--execute')) {
  console.log(JSON.stringify({ ...manifest, status: 'dry-run; no model calls or quality scores' }, null, 2));
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY must be set for an explicit live run.');
const out = resolve(value('--out', `/private/tmp/sleep-coach-eval-${Date.now()}`));
await mkdir(out, { recursive: true });
// Exclusive manifest prevents accidental mixing of different runs/results.
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
for (const example of cases) {
  for (const [variant, system] of Object.entries(prompts)) {
    const started = Date.now();
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: manifest.model, max_tokens: manifest.max_output_tokens, system,
        messages: [{ role: 'user', content: `${dailyRequestInstructions}\n\n${JSON.stringify(example.context, null, 2)}` }] }),
    });
    if (!response.ok) throw new Error(`Model request failed: HTTP ${response.status}; earlier results retained.`);
    const data = await response.json();
    await appendFile(resolve(out, 'results.jsonl'), JSON.stringify({ case_id: example.id, variant,
      output: data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') ?? '',
      latency_ms: Date.now() - started, usage: data.usage, model: data.model, stop_reason: data.stop_reason,
      scores: null, reviewer: null }) + '\n');
    console.log(`${example.id}: ${variant} recorded`);
  }
}
console.log(`Outputs ready for human scoring in ${out}. No automatic quality verdict was assigned.`);
