# Initial coaching comparison — September 22, 2026

Decision: do not promote this candidate to production yet. The direction is promising, but the candidate fails the zero-critical-correction-failures gate. No production coaching instructions were changed.

## What ran

Six development scenarios, one baseline and one candidate answer per scenario (12 successful model calls). Both used claude-sonnet-4-6, the production daily-request instructions, an 800-token cap and default temperature. Prompt and dataset hashes are in manifest.json. The candidate was not edited during the run. All responses ended normally rather than hitting the token limit.

The existing Anthropic secret stayed in Supabase. A temporary fixed-scenario function used a private random access token, a two-hour expiry and no database/memory operations. Missing-token and invalid-case requests were verified to fail. The temporary function was deleted after the run. No secret values are included in these artifacts.

## Findings

| Scenario | Current instructions | Proposed instructions |
|---|---|---|
| Changed work schedule | Recognizes daytime work; bundles two actions and adds physiological claims. | Recognizes 9-to-5 work in the action, but later says “your schedule shift to daytime sleep.” This contradicts the explicit report that the person sleeps at night. |
| Completed triathlon | Recognizes race completion but assumes cortisol and nervous-system mechanisms. | More careful about causation; still combines an earlier bedtime with bedroom changes and makes assumptions about recovery-week demands. |
| Active deadline | Fits five minutes, but changes a deadline due tomorrow to tonight and asserts a mechanism. | Respects the five-minute window and uncertainty; offers multiple activity options instead of one defined experiment. |
| Ended deadline | Acknowledges completion, then centers an unsupported residual-stress explanation. | Better acknowledgement that stress ended; still assumes a schedule disruption not explicitly reported. |
| Already changed caffeine habit | Avoids repeating caffeine advice but defaults to breathing with an unsupported explanation. | Explicitly acknowledges the habit change, avoids repeating it and proposes an observable experiment. |
| Impractical caregiving routine | Fits two minutes, but adds unsupported certainty about mechanism and benefit. | Fits two minutes and asks about feasibility; leaves a choice between two actions. |

All 12 answers contain the four required headings. Both variants missed the under-85-word instruction in all six scenarios (headings excluded; baseline preambles included). Candidate answers were 103–131 words; baseline answers were 104–186 words. Heading presence does not establish complete client compatibility.

Candidate median provider latency was 6.23 seconds versus 7.33 seconds for baseline. Candidate token totals were 7,280 input / 1,135 output versus 19,670 / 1,346. These are descriptive figures from six outputs per variant, not reliable performance or cost estimates. No dollar cost has been estimated.

## Limits and next step

This is an unblinded Codex review, not independent human scoring. Per-answer provisional rubric scores and rationale are in results.jsonl. One answer per scenario is insufficient to establish a reliable win rate. The six held-out scenarios were deliberately not run because development results already fail promotion criteria; preserve them for a revised, frozen candidate.

Next: revise the candidate to verify its interpretation against the newest explicit report, choose one concrete action and satisfy the short format. Repeat development checks, then freeze and run holdout only if the gates pass. Ask the product owner to review side-by-side examples before deciding on production adoption.

This comparison tests generated daily advice. It does not test memory retrieval, greetings, free-form chat, caching or final experiment selection. The existing chooseDailyExperiment logic can retain a prior experiment after generation; production integration must check whether that would override a justified change before claiming the prompt update delivers better experiments in the app.
