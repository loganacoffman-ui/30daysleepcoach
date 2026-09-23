# 30D-49 coaching evaluation build

This is a reviewable candidate and local baseline, supporting the dependency on 30D-44. It does **not** activate a production prompt or complete hosted Braintrust evaluation. All examples are synthetic; no user records or interviews are uploaded.

## Reproduce

`node evals/personalization/run.mjs` validates the manifest with no API calls. Defaults to six development cases; `--split holdout` selects six held-out regression scenarios. Do not tune against the holdout results.

An explicit live comparison uses an existing authorized Anthropic key from the environment:

`node evals/personalization/run.mjs --execute --split development --out /private/tmp/sleep-coach-eval-development`

Then run holdout once the candidate is frozen. Both variants use the same model, inputs and 800-token response cap, production daily-request instructions and provider-default temperature. Every output records model, token usage and latency; manifests pin dataset and prompt hashes. No secrets are written to output. The local runner sends synthetic context only to Anthropic and does not write to Supabase, Mem0 or Braintrust. No automatic retries/paid loops. The default model matches repository configuration; verify availability before a live run.

Baseline is a frozen snapshot of the daily recommendation prompt plus 30D-39 personalization guidance. It isolates the broader instruction change from the memory plumbing. Candidate preserves the four-heading parser contract, removes unsupported mechanism shortcuts and improves constraint/experiment guidance. It is not imported by the app.

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

Dry-run manifest and dataset/runner tests verify reproducibility, not model quality. The [initial comparison](results/2026-09-22-development/REVIEW.md) failed a correction check. The [refinement review](results/2026-09-22-refinement/REVIEW.md) records three development revisions and one frozen holdout run: the final candidate produced 12/12 parsable answers under 85 words, with no critical correction/safety failures observed in unblinded Codex review. It still produces repetitive sparse-data advice and has not been independently reviewed or integrated. All cases have one measured night, so richer-history validation is still needed. Holdout has now been consumed; do not tune against it and claim it remains unseen. Hosted Braintrust work remains under 30D-44.

After evaluation passes, a separate reviewed change can import the candidate into the server, bump the daily prompt version in both runtime contracts and confirm parser/client compatibility. Rollback keeps the frozen baseline and restores the prior versioned prompt. Nothing here merges, deploys or creates a TestFlight build.

This compares generated daily advice only. It does not exercise memory retrieval, caching or the app's final experiment selection. Production can retain an existing experiment after generation; verify that integration before promoting any candidate.
