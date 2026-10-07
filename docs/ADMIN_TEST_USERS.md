# Admin test-account workspace

Visit `/admin/` (or `/admin`, which static hosting redirects to the directory). Administrators can use **Continue with Google** through Supabase or sign in with email/password. This is a separate login using a sessionStorage key that does not replace the regular web-app session. Nothing beyond the login shell is accessible until the server verifies an administrator.

## Deploy and enable

The existing main-branch workflows deploy the migration and `admin-test-users` Edge Function; Netlify publishes the static `admin/` directory. Both backend deployments must finish before the page can be used. No service-role key belongs in a browser or static file.

Google OAuth uses PKCE and returns to `/admin/` in the same browser tab. The callback exchanges the one-time code, removes it from browser history, and checks the current server-side admin role before opening the inventory. A successful Google login alone never grants admin access. Non-admin Google users are rejected and their separate admin session is signed out.

In the Supabase dashboard, keep the existing Google provider enabled and add these exact additional redirect URLs (also recorded in `supabase/config.toml`):

- `https://30daysleepcoach.com/admin/`
- `https://www.30daysleepcoach.com/admin/` if using the www origin
- `http://localhost:8000/admin/` and `http://127.0.0.1:8000/admin/` for local testing

The existing deployment workflows apply migrations/functions, **not Auth URL settings**, so the hosted redirect allowlist must be updated separately in Supabase. Google Cloud's authorized callback remains `https://qfnouotdhfltgvjhfbld.supabase.co/auth/v1/callback`; do not replace it with the admin page. No new Google client secret is needed in the frontend. See [Supabase Google login documentation](https://supabase.com/docs/guides/auth/social-login/auth-google).

One-time bootstrap: identify an existing, email-confirmed operator account in Supabase Auth. For Google users, use the exact Supabase identity associated with their Google login (they can first sign in through the regular app). In the Supabase SQL editor, grant that exact account the protected `app_metadata.role`:

```sql
-- Replace the placeholder with the verified operator's Auth UUID.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || '{"role":"admin"}'::jsonb
where id = 'OPERATOR_AUTH_UUID'::uuid
  and raw_app_meta_data->>'test_user_tool' is distinct from 'sleepcoach-test-v1';
```

Do not set `auth.users.role` (a database role), and do not use `user_metadata` (user editable). There is no self-enrollment or role editor in the test-account tool. Revoke access by removing `role` from the same account's `raw_app_meta_data`. The server reads the current role and verifies the session on every request, so a stale JWT cannot retain admin privileges.

Required Edge Function environment: automatically supplied `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus the app's existing `MEM0_API_KEY`. Reset/delete require the memory key and fail before touching app data if provider cleanup fails.

## Email addresses and future delivery

The default email is `sleepcoach-test+<name>@example.test`. Names contain 1–32 lowercase letters, numbers, and hyphens. The server constructs the email; it never accepts an arbitrary target email for creation. `example.test` cannot deliver mail.

To use a domain you own later, set the Edge Function secret `TEST_USER_EMAIL_DOMAIN` to that domain (for example `qa.yourdomain.com`) and configure the domain's inbound mailbox/catch-all to accept these addresses. The prefix remains mandatory. Existing registry entries retain their original email/domain and remain manageable after this setting changes. No code or database migration is needed to change the configured domain.

Admin creation sets the selected confirmation state and **does not send a confirmation email**. With a receiving domain and working Supabase SMTP, use the normal app's resend-confirmation or password-reset flow to test mail transactions. There is no mass-email action in this tool.

## Inventory and reuse

The portal lists existing managed test accounts, with email confirmation, exact onboarding step, current check-in and coaching-report counts, concern, sleep window, timezone, creation time, last sign-in, and latest check-in date. These come from current app records, so continuing to use a test account updates its inventory state.

Search by email, filter confirmation/onboarding status, or show only accounts matching the selected scenario. Matches compare current email status, onboarding step, concern, check-in count, and feedback count; they do not promise identical history contents or sleep settings. Matching accounts appear first, and the creation form shows a reuse notice. Copy an existing account's email and use its previously saved password. Passwords are never exposed in the inventory.

Accounts load in pages of 200; “Load more accounts” includes older users in the search and match results. Reset/delete works for every loaded page. Accounts whose protected identity changed remain visible for inspection but cannot be reset or deleted.

## Scenarios

Presets cover an unconfirmed signup, unfinished onboarding, completed onboarding without history, one improving week, and 30 mixed check-ins. Override confirmation status, any onboarding resume step, concern, follow-up answer, sleep window, timezone, schedule variation, reminder time, check-in count (0–90), trend, feedback, and whether today is included. Incomplete onboarding requires zero check-ins.

Fixtures populate native `sleep_profiles`, `daily_checkins`, `behavior_commitments`, `coach_recommendations`, and `app_open_days`, plus the web app's legacy `entries`. Scores use the explicit manual-sleep path. Wearable connections and device notification permissions are not fabricated. Reminder time is a stored preference, not a scheduled notification.

The generator is deterministic and makes **zero LLM calls**. Feedback is labeled synthetic and stored as the normal historical coaching artifact. Normal in-app coaching may still call models when opening today, regenerating advice, chatting, or refreshing the profile; fixtures do not disable those product features or impersonate a valid server generation fingerprint.

Passwords are only sent to Supabase Auth. They are not stored in the registry, audit log, or browser storage by the tool. Save the password when creating the account.

## Reset, cleanup, and safeguards

Reset retains the test user's UUID, email, and password; it replaces app data and can undo email confirmation. Sign out of the test app before resetting and sign back in afterward to discard local caches. Refresh sessions and pending email tokens are revoked. Already-issued access JWTs can remain usable until expiry under the existing product RLS policies; this tool does not change global session policy. Reset is not a way to revoke compromised access.

Every operation requires all of:

- An authenticated, live administrator session, verified against current `auth.users` and `auth.sessions`.
- A server-created registry entry for the exact target UUID.
- A reserved-format email matching the registry exactly.
- Protected `app_metadata.test_user_tool = sleepcoach-test-v1` and a random marker matching the registry.
- A target that is neither the calling admin nor any admin account.

A prefix or a user-editable tag alone is insufficient. A collision on creation returns an error; it never adopts, overwrites, or cleans up the pre-existing account. Changing a managed user's email, protected marker, or admin role makes subsequent destructive operations fail closed. There is no bulk delete or arbitrary-email adoption endpoint.

Reset and delete require typing the exact test email. Operations acquire a per-account lock; abandoned operations can be retried after 15 minutes. The reset's database deletion and reseeding are atomic. If a constraint/write fails, the previous local data survives. External Mem0 cleanup happens first and cannot participate in that database transaction; memory may already be removed when a later reset step fails.

Delete removes app history and memory before using the Auth admin deletion API. The registry cascades on Auth deletion; the audit trail remains. If Auth deletion fails, the account stays listed with error status and can be deleted again. Any future user-owned app tables must be added to the explicit cleanup allowlist and SQL regression test. Storage files are not currently part of this app's account model; if added, implement guarded Storage API cleanup before Auth deletion.

## Verification

- `npm test`: fixture and endpoint tests plus the existing web/shared suite.
- `supabase/tests/admin_test_users.sql`: run after migrations in a local/disposable Supabase database; rolls back all inserted users. Covers privileges, ordinary-user rejection, registry/tag checks, concurrency, atomic rollback, confirmation reset, session/role revocation, cleanup, and audit retention.
- The implementation was also exercised against the connected schema by running the migration plus SQL checks inside a single rollback transaction. No production roles/accounts or schema were retained by that verification.

The Supabase security advisor's existing project findings were unchanged: intentional server-only RLS tables without client policies, and [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). The two new registry/audit tables intentionally have RLS without client policies; all access goes through the guarded function.
