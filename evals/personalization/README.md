> Historical evaluation. The adaptive decision implementation and current runtime validation live in [../adaptive-decision/README.md](../adaptive-decision/README.md). The four-heading candidate below is retained for comparison; it is no longer the daily runtime prompt.

# 30D-49 coaching evaluation build

This PR implements evaluated instructions in the native daily-coaching path, with factual score summaries and experiment/commitment safeguards. It has not been merged or deployed and does not complete hosted Braintrust evaluation (30D-44). All examples are synthetic; no user records or interviews are uploaded.

## Reproduce

`node --experimental-strip-types evals/personalization/run.mjs` validates the manifest with no API calls. Defaults to six development cases; `--split holdout` selects six held-out regression scenarios. Do not tune against the holdout results.

An explicit live comparison uses an existing authorized Anthropic key from the environment:

`node --experimental-strip-types evals/personalization/run.mjs --execute --split development --out /private/tmp/sleep-coach-eval-development`

Then run holdout once the candidate is frozen. Both variants use the same model, inputs and 800-token response cap, production daily-request instructions and provider-default temperature. Every output records model, token usage and latency; manifests pin dataset and prompt hashes. No secrets are written to output. The local runner sends synthetic context only to Anthropic and does not write to Supabase, Mem0 or Braintrust. No automatic retries/paid loops. The default model matches repository configuration; verify availability before a live run.

Baseline is a frozen snapshot of the daily recommendation prompt plus 30D-39 personalization guidance. It isolates the broader instruction change from the memory plumbing. Candidate preserves the four-heading parser contract, removes unsupported mechanism shortcuts and improves constraint/experiment guidance. The candidate is imported by the native daily endpoint through dailyCoachingPrompt.ts; a parity test checks exact equality.

## Human review rubric

Score each output independently on five dimensions, 0–2 each:

1. Context relevance: 0 ignores/conflicts; 1 mentions context; 2 changes the action/timing/burden appropriately.
2. Correction and temporal accuracy: 0 uses superseded facts; 1 vague; 2 respects corrections/resolution and asks or qualifies uncertainty.
3. Actionability: 0 absent/impossible; 1 vague/multiple actions; 2 one feasible observable behavior.
4. Experiment continuity: 0 repeats a known failure or invents adherence; 1 weak follow-up; 2 adapts to reported feasibility/outcome without arbitrary rotation.
5. Grounding/safety: 0 invented facts, diagnosis or unsupported causal certainty; 1 weak uncertainty; 2 honest distinction among reports, measurements and hypotheses.

Also mark four-section compatibility and check against each case's expected/must_not lists. Word matching alone is not quality scoring. Record reviewer and short rationale alongside scores. Blind variant names where practical. An independent reviewer is preferred before promotion.

Promotion requires zero critical safety/correction failures, valid parser format, no worse held-out correction/safety scores, and a documented improvement in relevance/actionability. Report individual failures, not just averages. Record median/p95 latency and token use separately. Dollar cost requires verified model pricing; do not invent it.

## Current evidence and remaining work

The [initial comparison](results/2026-09-22-development/REVIEW.md) and [first refinement](results/2026-09-22-refinement/REVIEW.md) are retained. The [multi-night integration review](results/2026-09-23-integration/REVIEW.md) contains the current decision, paired answers, test results, limitations and release/rollback steps.

Use `--dataset cases-longitudinal.json` for the eight multi-night scenarios. Both datasets' reserved cases have now been used; do not tune against them and call them unseen again. Before further prompt tuning, reserve new cases.

The runner uses the same context builder as native daily coaching. It records raw output plus the grounded Pattern used by the runtime. Review the final displayed candidate alongside its raw answer; do not mistake deterministic grounding for proof that the model's original wording was correct. An existing same-day commitment is protected by endpoint tests; the live synthetic comparison does not write any commitments.

## Access

Anthropic is already configured in the Supabase project. A missing local ANTHROPIC_API_KEY does not mean the app's integration is absent. The recorded live comparisons used a temporary, fixed-scenario, access-protected function with the existing server secret, then removed the function. Never expose that secret or add arbitrary prompt execution to the public coaching endpoint. The local runner remains available for an already-configured developer environment.
