# Multi-night coaching evaluation and runtime integration

The PR now contains the daily-coaching implementation, not just a prompt comparison. It is ready for product/code review; it has not been merged or deployed to the live coach.

## What changed in the app path

- Native daily coaching imports the evaluated instructions directly. A parity test prevents the evaluation prompt and runtime prompt drifting apart. Free-form chat, greetings and legacy recommendation mode are outside this prompt change.
- The shared context builder supplies seven-day score summaries, grouped by provider and scoring version. It does not interpret a device change as deteriorating sleep.
- The displayed Pattern sentence comes from deterministic server facts: the current score and comparable range, or a wearable/manual discrepancy. This prevents invented ranges in model prose from reaching that sentence. Other sections remain generated and require evaluation.
- New daily answers must start with the expected heading, parse into four sections and stay under 85 words before publication. A failed generation gets the existing single retry, then fails without storing advice.
- Prior-night experiments are evidence for the model, rather than an unconditional “fewer than three nights” override. Useful experiments can continue, and infeasible ones can be adapted.
- Today's saved experiment stays protected. A daily refresh cannot silently replace a confirmed choice or reset completed/partial/skipped status. Explicit same-day changes still use the existing Coach confirmation flow. A concurrent change during generation aborts the stale response.
- A cached report cannot overwrite a newer confirmed experiment. Memory receives the published sections rather than a discarded model proposal.
- Both mobile and backend cache contracts use `native-daily-v8-contextual-experiments`.

## Live evidence

Eight new synthetic seven-night cases were created: four development and four reserved validation cases. The final candidate and context builder were frozen before reserved cases ran; their hashes match the committed runtime. There were 40 model calls across four development rounds and the final reserved comparison, using the existing server-side Anthropic integration. Earlier failed rounds are retained.

The first richer-history run exposed changed relative dates and invented score sub-ranges. A later run confused an experiment's duration with its number of attempted nights. These findings led to more precise instructions and deterministic displayed score facts; they must not be hidden by reporting only the final successes.

The final paired runs used the same enriched request context for both prompts, so the baseline is **current instructions with the new context builder**, not an exact replay of today's production pipeline. Baseline raw text is preserved. Candidate published text applies the same grounded Pattern used by the proposed endpoint; both are in format-checks.json. Candidate raw Pattern errors remain visible in results.jsonl.

| Final comparison | Baseline instructions | Proposed daily pipeline |
|---|---:|---:|
| Four sections parse successfully | 8/8 | 8/8 |
| Under 85 words | 0/8 | 8/8 |
| Published word range | 89–123 | 57–70 |

The candidate kept a helpful writing habit; replaced unsuccessful breathing with a bedtime-email intervention; simplified an impractical caregiving routine; and distinguished a manual rating from wearable data. In the four reserved cases, it targeted current email habits, kept a helpful reading habit, respected two minutes after a night shift, and avoided treating a provider switch as confirmed deterioration. The baseline added or replaced useful experiments in two cases and exceeded explicit time budgets in two reserved cases.

No critical safety/correction failures were observed in the final **published candidate** answers in this unblinded Codex review. This is not a claim that raw model text is always factual: the caregiving raw Pattern still invented a sub-period range; the runtime replaced it with the exact measured seven-night range. Provisional per-case scores and rationale are recorded, not independently validated.

Provider median latency was 4.23 seconds candidate / 5.42 seconds baseline on development, and 4.03 / 5.70 seconds on reserved cases. Eight outputs per variant are too few for a performance guarantee. Token totals are recorded; no dollar-cost estimate is claimed.

## Validation and practical limits

- 306 app/unit tests passed, including prompt parity, source-separated summaries, cached-report invalidation, adapted prior-night experiments, same-day commitment protection, completed-status preservation, stale generation rejection and format rejection.
- 42 backend helper tests passed.
- Mobile TypeScript and backend Deno type checks passed.
- No real user data, memory writes or database writes were used for the live comparison. Temporary test function `pr77-eval-20260923` was deleted and confirmed absent; production sleep-coach remained version 56 throughout.
- No device test, production model rollout, repeated-sampling estimate or independent human scoring occurred. All eight fixtures are synthetic, with narrow intended outcomes; these results support a reviewed beta change, not a clinical effectiveness claim.
- The reserved cases are consumed. Further tuning against them requires fresh reserved cases before claiming independent validation again.
- Numeric Pattern grounding does not validate every statement in Meaning/Why. Long-term memory retrieval and actual user adherence still need ordinary in-app observation.

## Release and rollback

Review the paired outputs and implementation, then merge only after the owner decides to release. Merging main automatically deploys Supabase functions through the existing workflow. Ship the matching mobile cache-contract update with the next TestFlight build; no schema migration is required. Verify new-day advice, a helpful ongoing experiment, an explicitly impractical prior experiment, and a same-day confirmed change in the app.

Rollback: revert this integration commit, assign a fresh daily prompt version in both contracts to invalidate generated artifacts, redeploy through the normal workflow and rebuild the mobile app as needed. Preserve user experiment records and outcomes; rollback should not rewrite their history. The frozen baseline instructions remain in baseline.txt.
