# 30 Day Sleep Coach Mobile

A TypeScript mobile app built with Expo and React Native.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS version)
- [pnpm](https://pnpm.io/installation)
- An Expo account
- For local simulators: Xcode (iOS) or Android Studio (Android)
- For an EAS iPhone device build: an Apple Developer account

## Setup

From the repository root:

```bash
cd mobile
pnpm install
```

## Create the development app

This project uses Expo SDK 57. The App Store version of Expo Go does not currently support SDK 57, so install this project's development build instead.

Log in to Expo and create a build for your device:

```bash
pnpm dlx eas-cli@latest login

# Choose one:
pnpm dlx eas-cli@latest build --profile development --platform ios
pnpm dlx eas-cli@latest build --profile development --platform android
```

When EAS finishes, open its installation link on your device and install the app. You only need a new development build after changing native dependencies, app configuration, or the Expo SDK.

For a local simulator or emulator, you can build directly instead:

```bash
pnpm exec expo run:ios
# or
pnpm exec expo run:android
```

## Run during development

Start the Expo development server:

```bash
pnpm start
```

Open the installed **30daysleepcoach** development app. It will connect to the local server; you can also scan the terminal QR code from the development client's launcher.

If an old Expo Go server is still running, stop it and restart with `pnpm start:clear`.

If the phone cannot reach Metro or shows **No script URL provided**, use tunnel mode and scan its new QR code:

```bash
pnpm start:tunnel
```

Start editing `App.tsx`; Expo will reload the app as you save.

## Supabase authentication

The app is connected to the `qfnouotdhfltgvjhfbld` Supabase project and supports:

- Email and password sign-in
- Email and password account creation
- Google sign-in
- Persistent sessions and sign-out

The Supabase URL and public key can be overridden with Expo environment variables:

```bash
cp .env.example .env
```

```text
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

If either variable is missing, `supabase.ts` uses the configured project URL or public key as a static fallback.

Email/password authentication works after enabling the Email provider under **Authentication → Providers** in Supabase.

Google sign-in also needs this one-time dashboard setup:

1. In Google Cloud, create OAuth credentials and add this authorized redirect URI:

   ```text
   https://qfnouotdhfltgvjhfbld.supabase.co/auth/v1/callback
   ```

2. In Supabase under **Authentication → Providers → Google**, enable Google and enter the Google client ID and secret.
3. In Supabase under **Authentication → URL Configuration**, add this redirect URL:

   ```text
   thirtydaysleepcoach://**
   ```

Use a development build when testing native Google sign-in so the app's custom URL scheme is installed:

```bash
pnpm exec expo run:ios
# or
pnpm exec expo run:android
```

The fallback key is the project's public client key. Expo embeds all `EXPO_PUBLIC_` values in the app, so never use a service-role or secret key.

## Sign in with Apple

The iOS app uses native Sign in with Apple through `expo-apple-authentication` and exchanges Apple's identity token with Supabase Auth. The Apple Developer membership, explicit App ID, Apple capability, and Supabase Apple provider must be configured before testing a standalone build.

See [`APP_STORE_READINESS.md`](./APP_STORE_READINESS.md) for the exact setup, account-deletion deployment, privacy questionnaire notes, and release smoke test.

## Oura integration

The native Settings screen uses the server-side Oura OAuth flow. The production Supabase project must have `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, and `OURA_REDIRECT_URI` secrets. Register this exact callback in the Oura API application:

```text
https://qfnouotdhfltgvjhfbld.supabase.co/functions/v1/oura-oauth-callback
```

The callback returns to the installed app at `thirtydaysleepcoach://oura/callback`. Oura access and refresh tokens are stored only in the protected `oura_connections` server table. The mobile app requests the `daily` and `heartrate` scopes and accesses data through `oura-proxy`.

Oura API applications are limited to ten users by default. Request Oura approval before inviting a larger production audience.
