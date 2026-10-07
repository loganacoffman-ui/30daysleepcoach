# Production authentication configuration

## Canonical production setup

- Production web origin: `https://30daysleepcoach.com`
- Supabase project ref: `qfnouotdhfltgvjhfbld`
- Supabase Site URL should be `https://30daysleepcoach.com`.
- Google OAuth's authorized callback is Supabase's callback URL: `https://qfnouotdhfltgvjhfbld.supabase.co/auth/v1/callback`.
- The web client requests both Google OAuth and email-confirmation redirects with `window.location.origin`. On production this resolves to `https://30daysleepcoach.com`.

## Netlify production and previews

Production is the canonical authentication environment. Netlify previews can render the application, but authentication on a preview URL is supported only when that exact preview origin (or an intentionally scoped wildcard) is present in Supabase's additional redirect URLs. Preview URLs should not replace the production Site URL.

## Verification checklist

1. Open the production site in a private window.
2. Sign in with Google and confirm the browser returns to `https://30daysleepcoach.com` with an authenticated session.
3. Request an email sign-up or confirmation and confirm the link returns to the production origin.
4. In Supabase Authentication URL Configuration, confirm the Site URL and allowed redirect URLs match the policy above.
5. In Google Cloud, confirm the Supabase callback URL remains authorized.

No provider secret, client secret, service-role key, or access token belongs in this file or in Git.

## Web password reset

1. Deploy the website with the new `/reset-password/` directory. The login form links to it via **Forgot password?**
2. In Supabase **Authentication → URL Configuration**, keep Site URL set to `https://30daysleepcoach.com` and add `https://30daysleepcoach.com/reset-password/` to Redirect URLs. Add the www/local equivalents in `supabase/config.toml` only when needed. The repository's deployment workflows do not apply these settings.
3. In **Authentication → Email Templates → Reset password**, use subject **Reset your 30 Day Sleep Coach password** and paste the complete contents of [templates/reset-password.html](supabase/templates/reset-password.html) into the body, then save.
4. Disable link tracking in your SMTP provider if enabled; it can rewrite recovery links.
5. Test with an existing email/password account: request a reset from the web login, open the email (also try a different browser), choose a matching password of at least 8 characters, then log in with it. Reusing the link should show an error and offer a new email. Also test mismatched passwords and a signed-out direct visit to `/reset-password/`.

The email uses `https://30daysleepcoach.com/reset-password/#token_hash={{ .TokenHash }}&type=recovery`. Keep this custom link in both the button and fallback; the page expects a token hash, not the default `{{ .ConfirmationURL }}`. The page strips the fragment from history, keeps credentials in memory, and verifies the recovery token only when the user submits a new password. Email previews therefore do not consume the token just by opening the page. Refreshing the page loses the in-memory flow; reopen the email link, or request a new one if it was already redeemed.

The recovery session is separate from normal web/admin sessions and uses the public publishable key. Supabase enforces its configured password rules in addition to the page's minimum length. Production SMTP and rate limits still apply. No mobile code is changed; this project-wide email template directs recovery emails to the website. For local testing of the email flow, temporarily use the local page origin in both template links, then restore the production links.

Reference: [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates) and [password reset API](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail).

## Admin portal Google sign-in

The separate `/admin/` portal uses Supabase Google OAuth with PKCE and a distinct, tab-scoped session. It requests `${window.location.origin}/admin/` as its return URL. Add the exact production admin URL to Supabase's additional redirect allowlist, plus the www/local URLs listed in `supabase/config.toml` when used. The deployment workflows do not automatically apply Auth URL settings.

Google authenticates the identity; protected `app_metadata.role = "admin"` authorizes the portal. The backend checks the current role and live session after OAuth and on every inventory or account operation. Ordinary Google users cannot access the admin tools. Follow the bootstrap instructions in [ADMIN_TEST_USERS.md](docs/ADMIN_TEST_USERS.md).
