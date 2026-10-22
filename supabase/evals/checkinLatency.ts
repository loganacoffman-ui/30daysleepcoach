// Synthetic, opt-in live provider evaluation. No database writes or real user data.
// ANTHROPIC_API_KEY=... deno run --allow-env --allow-net supabase/evals/checkinLatency.ts
// Compare the production model and a candidate: --model=... --runs=3
import { interpretCheckinReply } from "../functions/_shared/checkinReply.ts";
import { DEFAULT_COACH_MODEL } from "../functions/_shared/coachModel.ts";
import type { CheckinReplyRequest, SleepFactor } from "../functions/_shared/checkinReplyContract.ts";

const model = Deno.args.find((arg) => arg.startsWith("--model="))?.slice(8) || DEFAULT_COACH_MODEL;
const runs = Number(Deno.args.find((arg) => arg.startsWith("--runs="))?.slice(7) || 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error("--runs must be 1–20");
const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required; this benchmark makes paid provider requests.");
type Fixture = {
  step: CheckinReplyRequest["step"];
  message: string;
  answer?: string | null;
  factors?: SleepFactor[];
  selectedFactors?: SleepFactor[];
  finish?: boolean;
  addressed?: boolean;
};
const fixtures: Fixture[] = [
  { step: "feeling", message: "rested", answer: "rested" },
  { step: "adherence", message: "skipped", answer: "skipped" },
  { step: "feeling", message: "Not as tired as yesterday, pretty refreshed actually", answer: "rested" },
  { step: "feeling", message: "My partner is exhausted. I feel great.", answer: "great" },
  { step: "adherence", message: "Only managed two minutes of the five-minute walk", answer: "partial" },
  { step: "adherence", message: "I never did the walk", answer: "skipped" },
  { step: "factor", message: "Coffee at 5 and noisy neighbors, no alcohol", factors: ["caffeine", "noise"] },
  {
    step: "factor",
    message: "Actually no coffee, just stress",
    selectedFactors: ["caffeine"],
    factors: ["stress"],
  },
  { step: "factor", message: "My baby woke me three times", factors: ["caregiving"] },
  { step: "factor", message: "A walk and reading before bed helped", factors: ["exercise", "wind_down"] },
  { step: "factor", message: "Skip this question", factors: [] },
  {
    step: "details",
    message: "I was done with work late and had coffee at 5",
    factors: ["caffeine"],
    finish: false,
  },
  {
    step: "details",
    message: "That about covers it for today",
    selectedFactors: ["noise"],
    factors: ["noise"],
    finish: true,
  },
];
const percentile = (xs: number[], p: number) => xs.toSorted((a, b) => a - b)[Math.ceil(xs.length * p) - 1];
const outcomes = new Map<string, { ms: number[]; failures: number; calls: number; cachedInput: number }>();
for (let run = 0; run < runs; run++) {
  // Alternate order to reduce cache-warming/order bias between configurations.
  for (const effort of (run % 2 ? ["low", "medium"] : ["medium", "low"]) as Array<"low" | "medium">) {
    const summary = outcomes.get(effort) ?? { ms: [], failures: 0, calls: 0, cachedInput: 0 };
    for (const [index, fixture] of fixtures.entries()) {
      const request: CheckinReplyRequest = {
        step: fixture.step,
        message: fixture.message,
        selectedFactors: fixture.selectedFactors,
        turns: [{
          role: "assistant",
          content: fixture.step === "adherence"
            ? "Did you do your five-minute walk?"
            : fixture.step === "feeling"
            ? "How do you feel this morning?"
            : fixture.step === "factor"
            ? "What affected your sleep?"
            : "Anything else to add?",
        }],
      };
      const started = performance.now();
      try {
        const result = await interpretCheckinReply(request, apiKey, model, async (input, init) => {
          summary.calls++;
          const response = await fetch(input, init);
          const copy = await response.clone().json();
          summary.cachedInput += Number(copy.usage?.cache_read_input_tokens ?? 0);
          return response;
        }, { effort });
        const correct = result.addressed === (fixture.addressed ?? true) &&
          result.finish === (fixture.finish ?? false) &&
          (fixture.answer === undefined || result.answer === fixture.answer) &&
          (!fixture.factors ||
            JSON.stringify([...(result.factors ?? [])].sort()) ===
              JSON.stringify([...fixture.factors].sort()));
        if (!correct) {
          summary.failures++;
          console.log(JSON.stringify({ effort, run, fixture: index, result: "quality_failure" }));
        }
      } catch {
        summary.failures++;
        console.log(JSON.stringify({ effort, run, fixture: index, result: "request_failure" }));
      }
      summary.ms.push(Math.round(performance.now() - started));
    }
    outcomes.set(effort, summary);
  }
}
for (const [effort, summary] of outcomes) {
  console.log(
    JSON.stringify({
      model,
      effort,
      samples: summary.ms.length,
      failures: summary.failures,
      provider_calls: summary.calls,
      cached_input_tokens: summary.cachedInput,
      p50_ms: percentile(summary.ms, .5),
      p95_ms: percentile(summary.ms, .95),
    }),
  );
}
if ([...outcomes.values()].some((result) => result.failures > 0)) Deno.exitCode = 1;
