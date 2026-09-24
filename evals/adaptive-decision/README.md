# Adaptive daily coaching — 30D-39

**Implementation is ready for review; quality acceptance still fails. Do not move 30D-39 to Done or deploy this draft yet.**

The daily coach now chooses to continue, simplify, replace, or ask an essential question using current reports, constraints, preferences, history and experiment outcomes. The code validates and persists that decision; it no longer silently substitutes the previous behavior or mandates a three-night run. There are no race-, job-, or cohort-specific action branches.

This change is stacked on PR #77, commit `834fb5a7442b407f621a71ce8987abf98c633e25`, which already incorporates main `18b450a9cb4b0871b4f3862aa3ff6f6ebe88fa40`. That groundwork supplies factual sleep summaries and refreshed daily context. Existing workspace edits and the PR #77 checkout were not changed.

## What changed

- A single structured model response provides an explicit decision, a short evidence-based reason, and the visible recommendation. Malformed, truncated, contradictory “continue” decisions, or unexpected tool responses fail closed; one retry is permitted for an invalid draft. Old advice is never silently substituted for invalid new output.
- A new authenticated, invoker-rights PostgreSQL function publishes the card and any unfinished experiment change in one transaction. It records the previous experiment and rationale, scopes all writes to `auth.uid()`, and rejects concurrent experiment/report changes.
- Completed, partial and skipped records remain unchanged. New advice is a next-step recommendation, not a rewrite of what the user did. The one-record-per-day history model does not track an additional completed experiment on the same day.
- Clarification is saved as advice, never as a committed experiment. An existing experiment remains in history while the daily card displays the question.
- Today renders the actual current recommendation or clarification, with “Your next step” / “A question for you” labels. It no longer promises “night N of 3.”
- Prompt version v9 and a saved commitment snapshot invalidate obsolete cards while allowing unchanged advice to be reused. The wire decision field is additive; this change includes the matching mobile version check.

## Verification

- **349 app/endpoint/database/UI assertions passed** across 33 test files. This includes 16 real-output replays through the shipped parser and actual PostgreSQL publication function using PGlite. Those replays verify propagation and persistence, not advice quality.
- **38 backend helper tests passed.** Mobile TypeScript and backend Deno checks passed.
- **iOS JavaScript export passed**, 832 modules. This is not a native device build or a physical-device test.
- Database checks cover account isolation, atomic rollback, conflicting updates, preservation of completed/partial/skipped outcomes, and keeping questions out of experiment records.
- Screen tests verify updated advice is rendered instead of an old saved behavior, and that clarification is presented as a question.

Logs are in [validation](validation/). The key endpoint test reproduces the stale night-shift action and confirms the model's replacement reaches both the saved recommendation and the unfinished experiment. The scenario is a regression example, not product logic.

## Live model evaluation

The initial PR candidate used the single-call structured protocol evaluated in [2026-09-23T22-35-39.716Z](results/2026-09-23T22-35-39.716Z/results.json). Exact prompts, requests, dataset snapshots, hashes, outputs, usage and cleanup records are retained. No real user records, production coaching code or production database schema were changed. Temporary fixed-case functions used existing server-side Anthropic access, rejected requests without their access token, expired automatically, and were deleted afterward.

All **16/16** final-candidate responses parsed, selected an appropriate broad decision category, and propagated unchanged through the database replay. Median observed provider latency was **5.13 seconds**. This single small sample does not establish general performance or high-quality personalization.

**Two clear quality failures remain:**

1. `family-calls`: Do Not Disturb with allowed callers preserves reachability and reduces notifications, but does not itself address voluntary scrolling. The explanation overstates that benefit.
2. `sensitive-context`: the action recommends one whole song despite a one-minute limit; it does not demonstrate that it fits the available time.

Other wording remains imperfect, including unnecessary clock-time specificity and interpretations of numeric manual ratings. No claim of broad medical or coaching-quality validation is made. The review was performed by Codex, unblinded, with one sample per case. All reserved cases have now been used; future holdout evaluation needs fresh cases.

The [review JSON](results/2026-09-23T22-35-39.716Z/review.json) marks quality acceptance **FAIL**, even though mechanical/category checks pass.

### Retained evaluation history

- 22:30:04: eight plain-JSON cases; two failed parsing/length validation. Replaced the transport with a structured tool response.
- 22:32:51: twelve structured cases; all parsed, but qualitative review identified the two feasibility problems above.
- 22:35:39: sixteen cases after general feasibility guidance; all parsed; the same two substantive problems remained. This was the initial PR candidate.
- 22:38:42: a separate model review of each proposed action added another model call. It still missed the same two problems, so that extra call was removed from the implementation. Its outputs are retained as a rejected experiment, not promoted evidence.

Initially, 68 model calls were made across these bounded runs (8 + 12 + 16 + 32). The runtime normally makes one call for fresh advice, no call for a cache hit, and at most one retry for invalid output. No new paid service was added.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm test
node --experimental-strip-types evals/adaptive-decision/run.mjs
```

The last command is a dry run. Explicit `--execute` uses the authenticated Supabase CLI to deploy a short-lived, token-protected function accepting only checked-in case IDs, makes live model calls, records outputs, and deletes that function in `finally`. It never deploys `sleep-coach`, alters its secret, or writes user records. Only use it deliberately. Check `cleanup.json` if a network interruption occurs. A nonzero exit code identifies a transport/parser/category failure; a zero exit code does **not** replace qualitative review.

The protocol follows [Anthropic's tool definition and tool-choice interface](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools). Its schema constrains output structure, not which coaching action the model selects.

## Release gate and next work

1. Resolve the two advice-quality failures through a generalizable improvement, with fresh evaluation cases. Do not add branches for these exact scenarios or mark the issue Done based only on category counts.
2. Review this stacked PR alongside #77. Apply the additive migration before deploying the changed function; coordinate the v9 mobile release because older version checks hide newer cached cards. No merge, production migration, production deployment, or TestFlight build has been performed here.
3. Run the original authenticated live acceptance flow against the deployed candidate: report → recommendation → correction → new conversation → updated daily action. Current live evaluation checks real model generation, while persistence and UI are tested locally; this is not a claim that the modified flow has run end-to-end in production.
4. Run physical-iPhone send/reply, force-close restoration, correction, clarification and daily-card checks. Xcode/simulator/device access is unavailable in this environment.
5. Record acceptance evidence and privacy/release dependencies in 30D-39, 30D-26 and 30D-27 before Done.

Rollback: restore the previous function and coordinated mobile prompt version. The additive audit table/function can remain; reverting code does not require deleting audit history. Do not destructively revert completed user records.

## Release preparation — September 23, 2026 (Pacific)

**Still blocked: do not merge the combined release to main or deploy production.**

The combined release will be held in PR #77 after merging stacked PR #79 into that feature branch. This consolidates the implementation without triggering production deployment. The original two quality failures are not silently reclassified as passes.

Improvements now included:

- The structured response identifies the obstacle, required ability and explicit time budget. Code rejects a missing or excessive duration and appends an explicit stop time for new timed activities. This keeps model-chosen activities bounded; it does not select a cohort-specific action.
- Only visible advice is persisted to coaching memory; structured feasibility metadata stays in the recommendation context.
- Ordered deployment workflow changes are prepared locally on `codex/prepared-ordered-release` (commit `99973ff`), but GitHub rejected their push because the current OAuth login lacks `workflow` scope. They are NOT included in the remote candidate: the existing deployment workflows still run independently. Before main merge, an authorized workflow update must make migrations finish before functions deploy.
- The evaluator supports bounded repeats/model comparisons, preserves rejected drafts, and uses the same maximum one retry as production. Category success is still separate from qualitative review.

Additional live synthetic evidence:

| Run (UTC) | Result |
| --- | --- |
| 01:32:39 | Stronger-model pilot did not resolve feasibility; not adopted. |
| 01:35:08 | Explicit time budgeting made the rendered activity bounded; notification-only advice remained. |
| 01:36:41 | Adaptive reasoning added latency without reliably fixing advice; not adopted. |
| 01:41:25 | General mechanism guidance produced mixed phone advice in repeat samples. |
| 01:42:30 | Broad run stopped after 13 responses when another response failed validation. New reserved scenarios were not reached. |
| 01:44:02 | Targeted run stopped at a validation failure; cleanup succeeded. |
| 01:44:44 | Current candidate, four scenarios repeated twice: see results and review for remaining failures. |

The current candidate still sometimes confuses silencing notifications with reducing voluntary scrolling and overstates the benefit. The fresh limited-mobility case also produced two overlong drafts in one sample, which correctly failed closed. These are release blockers, not a successful acceptance run. Current tests remain green because they verify mechanics and rejection behavior, not arbitrary model quality.

The added `bedside-mobility` case has now been used; the other three new cases have not yet been evaluated. None of these small, unblinded synthetic runs establishes general coaching effectiveness.

Before production: resolve remaining quality/reliability failures, freeze a candidate, evaluate fresh cases and repeated regressions, pass combined PR CI, then merge main. Verify the ordered deployment, run authenticated synthetic end-to-end flows with cleanup, and build/submit the matching iOS app to TestFlight. Physical-device checks and acceptance remain required before Done. No production code/schema deployment or new TestFlight build has occurred during this preparation.
