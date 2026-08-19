# Native mobile data model

Status: proposed contract for 30D-31 and 30D-29 review.

## Decision

The native app defines the canonical product model. Supabase remains the shared backend and authentication system. Existing web data is small enough to migrate through an explicit adapter after the native contract is approved; the native schema will not reproduce the legacy `entries` shape merely for compatibility.

All product tables use UUID primary keys, `user_id uuid references auth.users(id) on delete cascade`, row-level security scoped to `auth.uid()`, and `timestamptz` audit fields. User-facing calendar dates are stored as `date`; event instants are stored as `timestamptz`; the user's IANA timezone is recorded where calendar-day interpretation matters.

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

### `sleep_nights`

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

## Delivery order

1. Review this contract with Isaiah alongside the onboarding UI.
2. Implement `sleep_profiles` first for 30D-29.
3. Add `daily_checkins` and `sleep_nights` immediately before the native daily-loop work.
4. Add `coach_recommendations` immediately before native coaching is connected.
5. Migrate the small legacy dataset after the canonical writes are proven.

This sequencing avoids speculative tables while preventing each screen from inventing its own storage contract.
