# Native mobile data model

Status: implementation contract for 30D-31. Reviewed with Isaiah on August 13, 2026; final integration validation is tracked in the merge pull request.

## Decision

The native app defines the canonical product model. Supabase remains the shared backend and authentication system. Existing web data is small enough to migrate through an explicit adapter after the native contract is approved; the native schema will not reproduce the legacy `entries` shape merely for compatibility.

All product tables use UUID primary keys, `user_id uuid references auth.users(id) on delete cascade`, row-level security scoped to `auth.uid()`, and `timestamptz` audit fields. User-facing calendar dates are stored as `date`; event instants are stored as `timestamptz`; the user's IANA timezone is recorded where calendar-day interpretation matters.

The current onboarding payload is intentionally small and versioned. A representative stored value is:

```json
{
  "goal": "Wake up feeling more rested"
}
```

The stable `primary_concern` value and safety flag are stored in their dedicated columns rather than duplicated inside `intake_answers`. Future quiz answers may be added as stable keys inside this object, accompanied by an `intake_version` increment and backward-compatible readers.

## Current shared client contract

| Data | Mobile | Web | Server / Edge Functions |
|---|---|---|---|
| `auth.users` | Supabase Auth session | Supabase Auth session | Verifies the caller JWT |
| `sleep_profiles` | Read/write the signed-in user's profile | No current product dependency | No direct write requirement |
| `daily_checkins` | Read/write the signed-in user's check-ins | No current product dependency | May read only with the caller's JWT |
| `behavior_commitments` | Read/write the signed-in user's experiment | Existing web behavior remains supported | May read only with the caller's JWT |
| `coach_recommendations` | Requests and reads the daily artifact | No current product dependency | `sleep-coach` creates or returns the caller's artifact |
| `entries` | No dependency | Legacy web read/write | Legacy input only; not canonical |
| `oura_connections` | Accesses Oura through Edge Functions | Accesses Oura through Edge Functions | Owns provider credentials and API access |
| `ai_cache` | No direct access | No product-record dependency | Internal generation optimization only |

All client writes are made with the signed-in user's JWT. Row-level security must reject anonymous access and cross-user reads or writes. Provider tokens and service-role credentials never belong in either client.

## Canonical product tables

### `sleep_profiles`

One current onboarding/profile record per user.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid PK | Auth user |
| `primary_concern` | text | Validated application value, not a database enum |
| `typical_bedtime` | time | Optional |
| `typical_wake_time` | time | Optional |
| `timezone` | text | IANA timezone |
| `safety_flags` | jsonb | Flexible, non-diagnostic flags |
| `intake_answers` | jsonb | Versioned raw onboarding answers |
| `intake_version` | integer | Starts at 1 |
| `onboarding_completed_at` | timestamptz | Null while resumable onboarding is incomplete |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `daily_checkins`

One subjective morning ritual per user and local calendar day.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `checkin_date` | date | Unique with `user_id` |
| `timezone` | text | Timezone used to assign the date |
| `feeling` | smallint | 0–100, optional |
| `suspected_factor` | text | Optional stable application key |
| `note` | text | Optional user note |
| `voice_transcript` | text | Optional; voice is never required |
| `completed_at` | timestamptz | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Previous-behavior adherence remains on `behavior_commitments`; the check-in updates that existing record rather than copying status into two tables.

### Planned: `sleep_nights`

This table defines the intended normalized wearable-history shape, but it is **not part of the currently deployed contract**. The current app reads Oura data through `oura-proxy`. Create `sleep_nights` in a new additive migration only when product work requires persistent objective history; do not make onboarding or a subjective check-in depend on it.

One normalized objective sleep record per user, provider, and sleep date.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `sleep_date` | date | Night assigned by provider/local convention |
| `provider` | text | Initially `oura` |
| `sleep_score` | smallint | Optional |
| `readiness_score` | smallint | Optional |
| `average_hrv_ms` | numeric | Optional |
| `bedtime_start` | timestamptz | Optional |
| `bedtime_end` | timestamptz | Optional |
| `total_sleep_minutes` | integer | Optional |
| `awake_minutes` | integer | Optional |
| `provider_record_id` | text | Optional provider identity |
| `raw_payload` | jsonb | Optional diagnostic/source payload |
| `synced_at` | timestamptz | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Unique key: `user_id`, `provider`, `sleep_date`. Missing provider data never blocks a check-in.

### `behavior_commitments`

Keep the deployed table as the canonical daily experiment/adherence record. Its current fields already support the first native loop: `behavior_date`, `behavior`, and `status` (`committed`, `completed`, `partial`, `skipped`). Add structured fields only when the UI requires them, such as `behavior_key`, `why`, or `instructions`; do not create a parallel `action_steps` table.

### `coach_recommendations`

Persist the user-visible coaching artifact separately from transport cache.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `recommendation_date` | date | Unique with `user_id` for v1 |
| `pattern` | text | Optional explanation |
| `meaning` | text | Optional explanation |
| `action` | text | Required primary behavior |
| `why` | text | Optional |
| `source_context` | jsonb | IDs/version metadata, not copied health history |
| `prompt_version` | text | |
| `model` | text | Optional |
| `generated_at` | timestamptz | |
| `created_at` | timestamptz | |

`ai_cache` remains an internal optimization. It is not the product record and should not be the only place a recommendation exists.

## Shared infrastructure retained

- `auth.users`: shared identity for web and mobile.
- `oura_connections`: shared server-owned OAuth connection. Provider tokens are never exposed directly to either client.
- `oura_oauth_states`: temporary server-owned OAuth state.
- `ai_cache`: server-side generation cache.
- `behavior_commitments`: shared product data, retained and evolved additively.

## Legacy web treatment

`entries` remains readable by the current web app during the mobile build, but it is not the target mobile contract. After the canonical tables are deployed:

1. Map each legacy entry into `daily_checkins` and, when objective fields exist, `sleep_nights`.
2. Make the import idempotent using a migration ledger or deterministic source reference.
3. Verify row counts and representative records for Logan and Isaiah.
4. Update the web client later to read/write canonical tables or leave it in maintenance mode.
5. Do not delete `entries` until both clients and backups no longer depend on it.

The initial mobile launch does not require migrating the small legacy dataset. Compatibility means the existing web app keeps working while new mobile tables are added; it does not mean new mobile screens must reproduce the `entries` schema.

## Migration, security, and rollback procedure

1. Never edit a migration that has already been applied to production. Every correction is a new, forward-only migration.
2. Run the full migration history against a fresh local Supabase database with `supabase db reset`.
3. Compare local and linked histories with `supabase migration list` and review the pending production plan before merge.
4. Verify RLS with two authenticated test users: each can create and read their own record; neither can read, update, or delete the other's; an anonymous request cannot access product rows.
5. Merge migration changes through `main`. The production migration workflow applies pending files sequentially and stops on error.
6. If a deployed migration is wrong, preserve the database backup and ship a compensating migration. Do not delete or rewrite the applied file. Destructive column/table removal requires a separate review after both clients have stopped depending on it.

## Delivery order

1. `sleep_profiles`: implemented for onboarding.
2. `daily_checkins`: implemented for the native daily loop.
3. `behavior_commitments`: retained as the shared experiment/adherence record.
4. `coach_recommendations`: implemented for persistent daily coaching.
5. `sleep_nights`: defer until persistent wearable history is required.
6. Legacy `entries` import: defer until canonical mobile writes are proven and preserving the small web dataset is worth the migration effort.

This sequencing avoids speculative tables while preventing each screen from inventing its own storage contract.
