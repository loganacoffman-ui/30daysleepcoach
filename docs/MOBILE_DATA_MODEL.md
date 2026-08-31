# Native mobile data model

Status: implementation contract for 30D-31. Reviewed with Isaiah on August 13, 2026; final integration validation is tracked in the merge pull request.

## Decision

The native app defines the canonical product model. Supabase remains the shared backend and authentication system. Existing web data is small enough to migrate through an explicit adapter after the native contract is approved; the native schema will not reproduce the legacy `entries` shape merely for compatibility.

All product tables use UUID primary keys, `user_id uuid references auth.users(id) on delete cascade`, row-level security scoped to `auth.uid()`, and `timestamptz` audit fields. User-facing calendar dates are stored as `date`; event instants are stored as `timestamptz`; the user's IANA timezone is recorded where calendar-day interpretation matters.

The version 1 onboarding payload follows Isaiah's PR #22 contract. It stores the
current step after every transition so an interrupted flow can resume safely. A
representative completed value is:

```json
{
  "current_step": "complete",
  "primary_concern": "night_waking",
  "typical_bedtime": "22:30",
  "typical_wake_time": "06:30",
  "schedule_varies": false,
  "time_in_bed_minutes": 480,
  "follow_up_key": "wake_duration",
  "follow_up_answer": "30_to_60",
  "first_experiment": "Same wake-up, every day: keep your 6:30 AM wake time even after a rough night.",
  "reminder_time": "07:00"
}
```

The canonical `primary_concern` values are `falling_asleep`, `night_waking`,
`early_waking`, `unrefreshed`, and `irregular_schedule`. The concern and sleep
window are duplicated in dedicated columns for efficient product reads while the
versioned JSON payload preserves the complete resumable onboarding state. Future
quiz changes require an `intake_version` increment and backward-compatible readers.

## Current shared client contract

| Data | Mobile | Web | Server / Edge Functions |
|---|---|---|---|
| `auth.users` | Supabase Auth session | Supabase Auth session | Verifies the caller JWT |
| `sleep_profiles` | Read/write the signed-in user's profile | No current product dependency | No direct write requirement |
| `daily_checkins` | Read/write the signed-in user's check-ins | No current product dependency | May read only with the caller's JWT |
| `sleep_nights` | Read/write normalized Apple Health sleep metrics | No current product dependency | May read only with the caller's JWT |
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
| `display_name` | text | Reserved profile field; PR #22 onboarding does not write it |
| `primary_concern` | text | One of the five canonical PR #22 concern keys |
| `typical_bedtime` | time | Optional |
| `typical_wake_time` | time | Optional |
| `timezone` | text | IANA timezone |
| `preferred_sleep_source` | text | Optional `apple_health` or `oura`; the other source remains a fallback |
| `safety_flags` | jsonb | Reserved flexible, non-diagnostic flags; not part of PR #22 intake |
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

The native iOS app reads sleep stages from HealthKit, derives a versioned Sleep Coach score on-device, and stores normalized metrics here. Apple does not expose its proprietary Sleep Score through HealthKit. Oura remains an on-demand provider through `oura-proxy`; the app resolves one preferred wearable score per day and falls back to the other connected source.

One normalized objective sleep record per user, provider, and sleep date.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `sleep_date` | date | Night assigned by provider/local convention |
| `provider` | text | `apple_health` or `oura` |
| `sleep_score` | smallint | Optional |
| `score_version` | text | App scoring version; populated for Apple Health-derived scores |
| `score_components` | jsonb | Normalized component values, not raw HealthKit data |
| `bedtime_start` | timestamptz | Optional |
| `bedtime_end` | timestamptz | Optional |
| `total_sleep_minutes` | integer | Optional |
| `awake_minutes` | integer | Optional |
| `in_bed_minutes` | integer | Optional |
| `rem_minutes` | integer | Optional |
| `deep_minutes` | integer | Optional |
| `core_minutes` | integer | Optional |
| `sleep_efficiency` | numeric | Optional value from 0–1 |
| `source_name` | text | HealthKit source display name |
| `source_bundle_id` | text | HealthKit source bundle identifier |
| `provider_record_id` | text | Stable source sample identity |
| `timezone` | text | IANA timezone used for the waking-date assignment |
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
5. `sleep_nights`: implemented for normalized Apple Health sync.
6. Legacy `entries` import: defer until canonical mobile writes are proven and preserving the small web dataset is worth the migration effort.

This sequencing avoids speculative tables while preventing each screen from inventing its own storage contract.
