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
