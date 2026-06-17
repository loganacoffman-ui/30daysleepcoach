# Oura OAuth Setup

Use OAuth for production Oura connections. Personal access tokens are only a local testing fallback.

## 1. Create an Oura OAuth app

In the Oura developer dashboard, create an OAuth application for 30 Day Sleep Coach.

Use this redirect URI:

```text
https://qfnouotdhfltgvjhfbld.supabase.co/functions/v1/oura-oauth-callback
```

Oura's developer page generates authorize URLs without a `scope` query parameter for this app. Keep the app configured for server-side authentication and let Oura apply the app's allowed API access.

## 2. Save credentials as Supabase secrets

Run these from the project root:

```bash
supabase secrets set OURA_CLIENT_ID="your_oura_client_id"
supabase secrets set OURA_CLIENT_SECRET="your_oura_client_secret"
supabase secrets set OURA_REDIRECT_URI="https://qfnouotdhfltgvjhfbld.supabase.co/functions/v1/oura-oauth-callback"
```

Do not commit the client secret.

## 3. Deployed pieces

Database migration:

```text
supabase/migrations/20260612024500_add_oura_oauth.sql
```

Edge Functions:

```text
oura-oauth-start
oura-oauth-callback
oura-oauth-status
oura-oauth-disconnect
oura-proxy
```

`oura-oauth-callback` must run with JWT verification disabled because Oura redirects to it directly.
