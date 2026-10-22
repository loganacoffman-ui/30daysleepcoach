# Backend performance changes

This change removes redundant work from `sleep-coach` and its supporting functions. It does not change the mobile response contracts or deploy anything by itself.

## Behavior

- `sleep-coach`, `oura-proxy`, Oura connection status, transcription, and TTS verify access tokens using `getClaims()`. The shared verifier retains the SDK's signing-key cache and has a five-second network deadline. Database reads/writes still use the caller's JWT and RLS. Account deletion, disconnect, and admin mutations retain their current-account checks. As with other JWT verification, a previously issued token remains usable until expiration; this is not a live session-revocation check. Symmetric signing keys fall back to Auth-server verification in the SDK.
- Daily coaching calls shared Oura code using the already verified user ID. Disconnected accounts skip external Oura requests. Successful `daily_sleep` responses are cached for 60 seconds in server-only storage, keyed by user, endpoint, and dates, and matched against the current OAuth connection version. Disconnect/reconnect invalidates reuse. Caller-supplied personal tokens preserve the existing web flow and bypass stored credentials and the cache; Oura authenticates those tokens. Token refreshes are serialized and cannot overwrite a newer connection.
- Model-flag decisions have a fixed one-hour TTL per user, shared across workers, with a bounded in-memory fast path. A cache read never extends expiration. Cache hits and non-model tool actions avoid flag resolution. ConfigCat failures retain the existing default-model behavior; a resulting default decision can remain cached for the hour.
- Daily/profile generation acquires a service-only lease only after a cache miss and checks the artifact again after acquisition. Waiters reuse the published artifact, including concurrent explicit refreshes for identical evidence. Wait time is bounded to 45 seconds, leases expire after 120 seconds, and an expired/replaced owner cannot publish or release another owner's lease. Relational requests have five-second deadlines; publication requires at least 15 seconds left on the lease.
- Daily coaching checks a stored-evidence revision after generation instead of fetching Oura and the full context again. Changes to check-ins, nights, prior adherence, profile, recent reports, the connection, or the relevant Oura cache entry invalidate publication. Today's generated commitment and TTL-only cache changes do not invalidate the revision. The revision RPC is service-only and uses `SECURITY INVOKER`.
- Final usage writes and Braintrust flushes run through `EdgeRuntime.waitUntil()`. Initial usage intent remains awaited. Final usage writes retain retry/idempotency behavior. Memory requests keep their deadline active through body consumption. Model-flag lookup and memory retrieval run concurrently; independent history/reports and recommendation/commitment reads run concurrently.
- Stable system instructions have explicit five-minute Anthropic prompt-cache breakpoints. Changing user evidence is a separate uncached block. Actual savings depend on minimum cacheable length and reuse; usage records already capture cache reads/writes.
- Exact categorical feeling/adherence replies (such as `rested` or `skipped`) return a validated interpretation without inference. Other replies retain the semantic interpreter. `CHECKIN_MODEL` optionally overrides its model, independently of coaching. `CHECKIN_EFFORT=low` opts into lower effort; the default remains `medium` until the live benchmark passes.

## Deployment order

1. Apply `20261022124430_coach_performance_cache.sql` before deploying functions. It creates two service-only tables and two service-only RPCs; there is no client write access and no `SECURITY DEFINER` function.
2. Deploy `sleep-coach`, `oura-proxy`, `oura-oauth-status`, `elevenlabs-transcribe`, and `elevenlabs-tts` with their shared dependencies.
3. Retain existing secrets. Leave `CHECKIN_MODEL` and `CHECKIN_EFFORT` unset for the initial rollout. No mobile release is required.
4. Test a disconnected account, Apple Health/manual sleep, and an Oura account; test both fresh and repeated coaching, corrections during generation, and concurrent requests.
5. Compare stage timings and end-to-end mobile transition times before enabling a different check-in model/effort.

Rollback: redeploy the previous function versions; leave the additive tables/RPCs in place. To change a cached rollout decision immediately, a trusted operator can delete the user's `model-flag:useSonnet5:v1` row and redeploy/restart workers to clear the in-memory copy. Otherwise changes take effect within one hour.

## Measurement

Structured `request_timing` logs carry `request_id`, `stage`, `duration_ms`, and `outcome`, without prompts or user reports. Stages include auth, model flag, memory, daily context, evidence recheck, database HTTP requests, Anthropic response headers, usage writes, check-in interpretation, and response readiness. `request_started` associates the ID with the request mode. The same ID is used by usage events and the `X-Coach-Request-Id` response header.

Database/Anthropic HTTP stages measure response-header arrival, not full stream completion. `response_ready` is not chat time-to-first-visible-token or time-to-last-token; usage completion and client measurements are needed for those. Parallel stage durations must not be summed. Cache hits do not emit model or memory stages.

Baseline examples from October 20–21, 2026: one daily-coaching request took 7.87 s, with 2.81 s in the metered model operation; its two nested Oura calls totaled 1.82 s. Separate Auth/REST calls reached 5–6 s. Inspect Supabase compute, I/O, and connection-pool metrics if those service-level spikes persist after reducing requests. The baseline does not establish CPU saturation or predict the savings of this change.

## Validation

Run `npm test`, the Deno tests under `supabase/functions/_shared`, and `deno check` for the five changed entrypoints. Run `supabase/tests/coach_performance_cache.sql` on a disposable database after the migration; it rolls back its fixtures. The SQL was also exercised against isolated PGlite Postgres with fixture schemas; that does not replace a staging migration against the complete Supabase schema.

Run the opt-in synthetic quality/latency comparison with an Anthropic key:

```sh
deno run --node-modules-dir=auto --allow-env --allow-net \
  supabase/evals/checkinLatency.ts --model=claude-sonnet-5-5 --runs=3
```

The script compares medium and low effort with alternating order, exact-answer fast paths, negation, other-person references, corrections, multiple factors, and finish intent. It reports quality failures, provider-call counts, cache-read tokens, and p50/p95 duration. It makes paid provider requests with synthetic data only and writes no application data. Repeat against a candidate `CHECKIN_MODEL`, requiring no quality regression before switching. An API key was unavailable during implementation, so no live-provider speed/quality claim has been made.

Mobile follow-up: consolidate duplicate Oura/context/device-sync requests and avoid loading client coaching context that the server reconstructs. Database RLS/index cleanup remains a separate lower-priority task; no existing policies or indexes are altered here.
