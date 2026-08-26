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

## Daily check-in notifications

The onboarding reminder uses an Expo recurring local notification. The permission
prompt appears only after the user chooses a reminder time and taps **Schedule
reminder & start**. The notification repeats in the device's local time and does
not require an internet connection, Expo push token, Supabase function, or
server cron.

After onboarding, Settings → Reminders shows the device's actual scheduled state.
Users can turn the reminder off, turn it back on (requesting OS permission when
needed), or move it earlier or later in 15-minute increments.

`expo-notifications` and its config plugin are native dependencies, so create and
install a new development or production build after pulling this change:

```bash
pnpm dlx eas-cli@latest build --profile development --platform ios
pnpm dlx eas-cli@latest build --profile development --platform android
```

The plugin adds Apple's push-notification entitlement. On the first iOS build,
let EAS enable Push Notifications for the production and preview App IDs and
generate or reuse an Apple Push Notifications key when prompted. The local
reminder does not send through APNs, but matching the entitlement and provisioning
profile keeps the signed binary correctly configured. Android does not need
Firebase/FCM credentials for this local reminder.

Test on a physical device by choosing a reminder a few minutes ahead, accepting
the OS permission prompt, and backgrounding the app. If permission was previously
denied, re-enable it in the device's notification settings and tap the onboarding
button again.

Expo push-token registration, token storage, FCM credentials, and a delivery
backend are only needed if the product later sends remote, server-initiated
notifications.

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
   thirtydaysleepcoach-dev://**
   thirtydaysleepcoach-preview://**
   ```

The three iOS variants install independently:

- `development`: **Sleep Coach Dev** (`com.30daysleepcoach.app.dev`) connects to Metro.
- `preview`: **Sleep Coach Preview** (`com.30daysleepcoach.app.preview`) is a standalone internal build.
- `production`: **30 Day Sleep Coach** (`com.30daysleepcoach.app`) is used for TestFlight and App Store releases.

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

The callback returns to the active app variant at `thirtydaysleepcoach://oura/callback`, `thirtydaysleepcoach-dev://oura/callback`, or `thirtydaysleepcoach-preview://oura/callback`. Oura access and refresh tokens are stored only in the protected `oura_connections` server table. The mobile app requests the `daily` and `heartrate` scopes and accesses data through `oura-proxy`.

Oura API applications are limited to ten users by default. Request Oura approval before inviting a larger production audience.

## Create a production iOS build

The App Store build uses the `production` profile in `eas.json` and the
`com.30daysleepcoach.app` bundle identifier.

```bash
pnpm build:ios:production
```

The completed build is automatically submitted to App Store Connect for
TestFlight processing.

On the first build, sign in to Expo and Apple when prompted. EAS can create and
manage the iOS distribution certificate and provisioning profile.
