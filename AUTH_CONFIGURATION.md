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

## Admin portal Google sign-in

The separate `/admin/` portal uses Supabase Google OAuth with PKCE and a distinct, tab-scoped session. It requests `${window.location.origin}/admin/` as its return URL. Add the exact production admin URL to Supabase's additional redirect allowlist, plus the www/local URLs listed in `supabase/config.toml` when used. The deployment workflows do not automatically apply Auth URL settings.

Google authenticates the identity; protected `app_metadata.role = "admin"` authorizes the portal. The backend checks the current role and live session after OAuth and on every inventory or account operation. Ordinary Google users cannot access the admin tools. Follow the bootstrap instructions in [ADMIN_TEST_USERS.md](docs/ADMIN_TEST_USERS.md).
