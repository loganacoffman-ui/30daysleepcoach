# Per-user Claude usage

`public.llm_usage_events` is the backend-only inference ledger. `public.llm_usage_report` aggregates it into UTC days, weeks (Monday start), or calendar months. The migration and Edge Function changes deploy through the existing GitHub Actions workflows. No mobile release, UI change, or usage limit is required.

## What is recorded

Each actual Anthropic Messages API attempt gets one server-generated event ID. A pending row is written before the provider call; the same row is finalized with provider-reported usage. Application retries create separate events under the same `request_id`, with increasing `attempt_index`. Retrying a database write uses the original event ID so it cannot double-count.

| Bucket | Operations |
| --- | --- |
| `chat` | Native `coach_chat`, legacy `chat` |
| `daily_checkin` | `checkin_reply`, `daily_coach`, legacy `recommendation` and cached-key `briefing` generation |
| `sleep_profile` | `sleep_profile` |
| `greeting` | `coach_greeting` |

The exact operation is retained separately. These shared backend routes also meter legacy web requests; the ledger does not claim to distinguish mobile from web. Authenticated user IDs come from `auth.getUser()`, never the request body. Tool proposals are covered by the chat inference; confirming a proposal without another Claude call does not create an event.

Events contain timestamps, requested/returned model, provider request/message IDs, status, raw provider usage, normalized input/output/cache counts, and a pricing snapshot. They contain no prompts, responses, journal entries, or API keys. Records are deleted when the associated account is deleted, consistent with the other per-user tables.

## Costs and completeness

Supported standard USD rates per million tokens, verified September 25, 2026 against [Anthropic's pricing](https://platform.claude.com/docs/en/about-claude/pricing):

| Returned model ID | Input | Output | Cache read | 5m cache write | 1h cache write |
| --- | --- | --- | --- | --- | --- |
| `claude-sonnet-4-6` | $3 | $15 | $0.30 | $3.75 | $6 |
| `claude-sonnet-5` | $2 | $10 | $0.20 | $2.50 | $4 |

The tracker chooses rates from the provider's returned model ID. Stored rates and `pricing_version` preserve historical estimates when prices change. Update `STANDARD_RATES` and the pricing version in `_shared/llmUsage.ts` when changing supported models or prices. Adding pricing support does not change which model the app requests.

Postgres calculates `estimated_cost_usd` using exact decimal arithmetic. Input, cache-read, and cache-write token counts are separate billing categories; do not subtract cache counts from `input_tokens` or add both the aggregate cache-write count and its TTL breakdown. `total_tokens` includes each category once. Tools implemented by this app are included in ordinary token usage.

Streaming usage is observed through an independent stream branch registered with `EdgeRuntime.waitUntil`. It continues even if the response consumer disconnects. Anthropic's streaming counters are cumulative: the meter merges snapshots rather than adding deltas. A complete observation requires a message start, final output usage, and message stop. See [Anthropic streaming events](https://platform.claude.com/docs/en/build-with-claude/streaming).

`usage_status` is `complete`, `partial`, or `unavailable`, independent of the application result. A fully metered response still incurs cost if later validation, tool handling, or saving the reply fails. Serving an existing app cache entry makes no Claude call and creates no event. Provider prompt-cache usage, in contrast, is billable and recorded.

**NULL cost means unknown, not free.** Interrupted requests retain observed counts but do not get a complete cost. Unknown models, unsupported pricing modes/server tools, and nonzero cache writes without a reliable TTL breakdown also remain unpriced. Raw usage is retained for later reconciliation. Reported USD is a list-price inference estimate, not an invoice: taxes, credits, negotiated adjustments, Mem0, ElevenLabs, and Supabase costs are outside its scope.

## Queries

Run these through the SQL editor or a trusted backend with the service role. The table and reporting function are unavailable to `anon` and `authenticated`; RLS is enabled with no client policies. The Edge Function uses the built-in `SUPABASE_SERVICE_ROLE_KEY` through a separate client, without the caller's Authorization header.

Per-user, per-feature daily totals:

```sql
select * from public.llm_usage_report(
  '2026-09-01T00:00:00Z',
  '2026-10-01T00:00:00Z',
  'day'
);
```

Replace `'day'` with `'week'` or `'month'`. Add a fourth UUID argument to restrict to one user. The range is `[start, end)`, and attribution uses the provider attempt's start timestamp. A request crossing midnight belongs to the day it started. Weeks/months at the edges of a partial range include only attempts inside that range.

Total monthly cost per user across all features and models:

```sql
select period_start, user_id,
       sum(provider_attempts) as provider_attempts,
       sum(known_estimated_cost_usd) as known_estimated_cost_usd,
       sum(unpriced_attempts) as unpriced_attempts
from public.llm_usage_report(
  '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', 'month'
)
group by period_start, user_id
order by period_start, user_id;
```

Always inspect `unpriced_attempts` alongside cost. `known_estimated_cost_usd` sums only priced events; an all-unknown group returns NULL. `incomplete_usage_attempts` counts missing/partial usage, while `unpriced_attempts` also includes complete usage without supported pricing. Token columns prefixed `observed_` include available counts from partial requests and are not guaranteed complete totals.

Find unresolved or unpriced attempts:

```sql
select id, user_id, bucket, operation, started_at, status, usage_status,
       provider_request_id, provider_message_id, raw_usage
from public.llm_usage_events
where started_at >= now() - interval '7 days'
  and estimated_cost_usd is null
order by started_at desc;
```

Investigate stale pending events (ten minutes is an operational threshold, not a user limit):

```sql
select * from public.llm_usage_events
where status = 'pending' and started_at < now() - interval '10 minutes'
order by started_at;
```

## Failure handling and deployment

Metering failures do not block inference. Database writes have a 1.5-second timeout and one retry per snapshot. A failed final write leaves a pending row if the initial write succeeded. Exhausted retries log `llm_usage_write_failed` with the metadata snapshot and original event ID; inspect these logs even when the ledger has no stale rows. Replay the final snapshot by upserting on `id` from a trusted backend, never adding the generated `total_tokens` or `estimated_cost_usd` columns. Do not replay an older pending snapshot over a finalized row.

There is no distributed transaction between Anthropic and Supabase: database outages, request timeouts, or a worker dying before usage arrives can prevent exact attribution. Pending rows and write-failure logs expose those gaps; they are not represented as zero-cost calls. Provider IDs support investigation, but historical billed tokens cannot be invented from reply text. This starts collecting after deployment; it does not backfill earlier usage.

The existing function and migration workflows run independently. Prefer migration completion before function deployment; calls made while the new table is unavailable use the write-failure logging path. Once both deployments complete, no new secret configuration is needed on hosted Supabase. For local streaming tests, use Supabase's documented [background-task configuration](https://supabase.com/docs/guides/functions/background-tasks).

## Verification

- `deno test --allow-env supabase/functions/_shared/*_test.ts` covers inference attempts, cumulative streams, cancellation, incomplete responses, cache tokens, retries, unsupported pricing, and write failure recovery.
- `npm test` includes endpoint tests for authenticated attribution, separate privileged writes, profile cache hits, and chat/check-in metering.
- `supabase/tests/llm_usage_events.sql` runs transactionally against a disposable database after the migration. It verifies decimal costs, UTC reporting, user filtering, unknown costs, service-role access, client restrictions, and account deletion. It rolls back its fixtures. The Edge Function test workflow runs it against PostgreSQL 17 with minimal Supabase role/auth fixtures. Example for a local database: `psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/llm_usage_events.sql`.
