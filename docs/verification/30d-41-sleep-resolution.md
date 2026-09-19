# 30D-41: server-enforced daily sleep resolution

Daily coaching now resolves the requested calendar date from authenticated database reads and the authenticated Oura proxy. Client-provided wearable rows, manual scores, and submission markers cannot unlock generation. A valid 0–100 wearable score qualifies; otherwise a stored manual score with an explicit submission timestamp qualifies. Qualitative check-ins alone do not qualify. General Coach chat remains available.

Wearable measurements and manual reports remain separate. Coaching and Coach Home prefer wearable data; the existing Your Day correction controls and Progress self-report behavior remain intact. Qualitative check-in saves omit absent manual fields instead of erasing an existing report. No migration, production data update, or RLS change is required.

Daily cache reuse checks the server-loaded source fingerprint. The existing source_context JSON also carries a resolution key so Your Day can discard a report after a manual edit or later wearable arrival. Legacy reports remain readable in history; today's old-version report is regenerated only after sleep is resolved. Evidence is rechecked after model generation; if it changed, the answer is not published and the request returns awaiting_sleep_data or sleep_data_changed for retry. No database transaction spans the external model request; a change after this final read is detected on the next validation.

Matching pure contracts live in mobile/sleep and supabase/functions/_shared so each runtime stays self-contained. An automated parity check prevents drift. Existing CI and deployment path filters cover their respective copies; no workflow or credential changes are needed. Nothing was deployed as part of this work.

## Automated verification

- Full app suite: 255 tests passed, including direct endpoint calls with mocked authenticated storage/provider/model boundaries.
- Full edge helper suite: 42 tests passed.
- Edge endpoint type check passed.
- Mobile TypeScript and whitespace checks passed.
- Local Metro iOS export passed (831 modules); this verifies bundling, not device interaction.
- New coverage includes missing/delayed wearable, forged client context, stale cache and refresh bypass attempts, wrong date, invalid scores, explicit manual zero-score unlock, later Oura arrival, Apple Health qualification, retained manual/qualitative provenance, unchanged cache reuse, source removal during generation, and general chat without resolved sleep.
- Repository tests mock external services; no production requests or data writes were used for validation.

## Device verification not performed

No iPhone/simulator, Development/Preview app, or TestFlight build was exercised. Before release, verify on a device:

1. With no wearable night, retry syncing and confirm no daily advice appears before manual submission.
2. Submit a manual score and complete the existing check-in; confirm advice and normal chat work.
3. Make wearable data available and refresh Your Day; confirm new advice, wearable preference in Coach Home, and the retained manual report.
4. Edit a manual score and refresh; confirm stale advice is replaced. Exercise the existing correction slider and Use wearable score control.
5. Reopen a historical check-in and confirm its saved report still appears.

Merged foundations inspected: PR #59 (slider/correction behavior), PR #61 (historical reports), recent merged PR list, and current origin/main. No slider or check-in UI was rebuilt.

## Integration with 30D-40

Updated against main after PR #73. Keep source-fingerprint reuse and exclusion of today's generated commitment, fresh-source revalidation on reopen/foreground, and the post-generation reload opt-out that prevents request loops. Respect 30D-41's resolution gate when replacing the screen snapshot, rather than restoring a report the repository deliberately invalidated. Manual reports and wearable readings remain separate inputs under 30D-41's wearable-first coaching contract. An endpoint regression confirms corrected Oura data regenerates once, retains the five-field response, and then produces a cache hit.
