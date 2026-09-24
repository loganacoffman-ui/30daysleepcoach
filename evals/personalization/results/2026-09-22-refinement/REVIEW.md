# Refined coaching instructions — live comparison

The final candidate is a better starting point for production integration than the initial candidate, but this PR still does not activate it. The improvement observed here is clearer, shorter, less speculative daily advice and better respect for a useful ongoing experiment. This does not establish broad personalization quality across real users.

## Changes

- Resolve corrections per fact, separating work hours, sleep hours and dates.
- Never infer a physiological explanation from one score or invent availability after an event ends.
- Preserve bedtime, wake time and alarms unless explicit user context supports changing them.
- Choose one observable behavior; keep useful experiments and simplify impractical ones.
- Return four short sentences with the required headings; explain the choice using a supplied fact.

## Evaluation

Three refinement rounds were run on the six development cases (36 calls). Revision 2 improved length but still invented facts and bundled actions. Revision 3 reduced causal speculation but inferred freedom to change alarms after a race and a free evening after a deadline. Both rejected rounds, including their exact candidate prompts and outputs, are retained here.

Revision 4 was frozen before the six held-out cases ran (12 further calls). Development and holdout prompt hashes match. There were 48 successful calls this refinement session; the initial comparison remains separately recorded. No repeated sampling or automatic retries were used.

| Check | Current instructions, final paired runs | Refined instructions, final paired runs |
|---|---:|---:|
| Actual daily-response parser accepts answer | 10/12 | 12/12 |
| Under 85 words, including headings | 0/12 | 12/12 |
| Every section at most 16 words | 0/12 | 11/12 |
| Raw response word range | 109–209 | 49–71 |

The actual production parseRecommendation and plainCoachText functions were extracted unchanged from the local runtime for the format checks. Parsing success does not test final experiment selection or the mobile UI. Word counts use whitespace-delimited tokens; punctuation stays attached.

Unblinded Codex rubric review found no critical correction or safety failures in the final candidate's 12 answers. Held-out correction and grounding scores did not regress in any paired case. Held-out mean relevance scores rose from 1.17 to 1.50, actionability from 1.83 to 2.00, and experiment continuity from 1.67 to 2.00 (each out of 2). These are provisional subjective scores from six examples, not independently validated measurements.

Provider median latency was 2.38 seconds for candidate versus 5.80 seconds for baseline in development, and 2.55 versus 5.39 seconds on holdout. Treat these as observations from small sequential samples, not a performance guarantee. Token totals and nearest-rank p95 figures are in metrics.json; no dollar cost is estimated.

## Useful examples

**An experiment is helping and the person wants to keep it.**
The current instructions switched to breathing and inferred a poor-sleep stretch from one night. The candidate kept the three-minute task-writing habit and attributed the benefit to the user's report.

**Caregiving makes the prior routine impossible.**
The candidate reduced the action to a two-minute seated breathing pause, matching the user's stated available time.

**Evening training ended; email in bed is current.**
The candidate targeted the phone/email habit and did not revive evening exercise as the problem.

**A deadline has ended.**
The candidate acknowledged that deadline stress was gone, without inventing lingering physiological stress or a newly free schedule.

## Remaining limitations

- All twelve fixtures contain only one wearable score and the same tired morning report. This is a deliberately narrow correction/constraint regression set, not representative longitudinal coaching data.
- The candidate recommended sitting/quiet wind-down variants in nine of twelve answers. Some personalization remains a reference in the explanation rather than a substantial change to the advice. Do not call this proof of rich personalized coaching.
- One held-out answer exceeded the 16-word sentence limit, though its full response stayed under 85 words and parsed correctly. Two fallback answers used unnecessary “first trial” wording despite unknown prior history. The effective-experiment answer's “fully working” wording is vague.
- The reviewer knew which variant was which. No independent human review, repeated sampling, medical evaluation, device test or production end-to-end run occurred.
- Holdout has now been used once. Do not tune against it and then call it unseen again; add fresh reserved cases for a future revision.

## Recommendation

Keep the frozen candidate for product review. Before production adoption, evaluate richer multi-night histories and check the final experiment-selection integration: chooseDailyExperiment can retain an existing behavior after generation and could override a justified adaptation. Any live integration must update the prompt version/cache contract and include appropriate integration tests. It is not implemented or merged in this PR.

The temporary fixed-case Supabase test function was deleted after all calls. The existing Anthropic secret stayed server-side; no user data, database writes or memory writes were used. No production coaching instructions were changed.
