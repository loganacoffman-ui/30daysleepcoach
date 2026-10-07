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

## Feature flags (ConfigCat)

The shared ConfigCat client is initialized at app startup. Set
`EXPO_PUBLIC_CONFIGCAT_SDK_KEY` in `mobile/.env` for local development and in the
corresponding EAS environment for builds. Use the read-only SDK key for the
intended ConfigCat environment, not a management API credential. Restart Metro
after changing it; installed builds need a new bundle/build to pick up the key.

Components can use the hook without adding a provider:

```tsx
import { useFeatureFlag } from './featureFlags/useFeatureFlag';

const { value: enabled, loading } = useFeatureFlag('newCoachExperience', false, userId);
```

Outside components:

```ts
import { getFeatureFlag } from './featureFlags/client';

const enabled = await getFeatureFlag('newCoachExperience', false, userId);
```

Create the flag in ConfigCat before using its key, and choose a safe boolean,
string, or number default of the same type. No existing feature is gated yet.
The optional `userId` is an opaque account ID for targeting and percentage
rollouts; pass the current account ID on each call and omit it when signed out.
No email, sleep data, or chat content is added to the targeting object.

Missing or invalid SDK keys fall back to the supplied defaults. ConfigCat uses
AsyncStorage to persist the downloaded config and lazy loading with a 60-second
TTL, so no requests are made until a flag is read and there is no background
polling. Fetch failures use the cached config when available, otherwise defaults.
The hook evaluates on mount, changes to its inputs, and return to the foreground;
it renders the default immediately and does not block app startup.

See the [ConfigCat SDK reference](https://configcat.com/docs/sdk-reference/js/browser/).

## App usage (Expo Insights)

`expo-insights` is installed and automatically linked to the existing EAS project
(`48f61526-b884-445b-aa4b-ffdcec6e4ade`). No JavaScript initialization or config
plugin is required. Create and install a new native development/production build
for the module to take effect; restarting Metro or sending only a JS update
cannot add it to an older binary.

After launching the rebuilt app, open the project in the Expo dashboard and
select **Insights → App usage**. The module reports cold launches and provides
usage breakdowns by platform, app version, and time. It does not provide screen
views, custom product events, or funnels. Both app variants currently share the
same EAS project, so development launches can appear in that project's usage.
Verify delivery by cold-launching a rebuilt app with network access and checking
the dashboard after processing.

See [Expo's App usage documentation](https://docs.expo.dev/eas-insights/app-usage/).

## Conversational check-in persistence

Continue check-in saves the reviewed sleep score and conversation position on
the device before advancing. Switching tabs or restarting the app resumes the
same day's check-in, including an unsent composer draft.

After check-in, follow-up messages and coach replies stay in the same daily
conversation beneath the report. Reopening Your Day reloads the full saved chat
history, and switching tabs keeps the active conversation mounted. Health syncs
refresh the daily data without resetting the conversation.

Local conversations, including completed check-ins, are cached only for their
check-in date. Older copies are pruned when the app returns to the foreground or
loads a check-in. Sign-out and account deletion clear that user's local drafts;
queued or late writes cannot recreate them after cleanup. Signed-out startup
also removes orphaned check-in caches. Saved check-ins remain in the account's
database until account deletion; the local cache is only for resuming the UI.

The journal `note` contains user replies only, with a 20,000-character aggregate
limit enforced by the mobile flow and database constraint. Coach questions and
clarifications stay in the separate local conversation cache.

## Sleep profile settings

Settings → Sleep profile → Edit lets users change their primary focus, usual
bedtime, usual wake time, and time zone. Changes are validated and saved to the
account; Cancel discards the draft. Saving refreshes the profile used by the coach.

Onboarding infers the device time zone and offers a searchable city/region picker
on the sleep-window step. The chosen zone is saved with onboarding progress and
restored on resume, including an explicit UTC choice. Older unfinished profiles
with only the database's UTC default use device detection. Reminder registration
uses the selected profile time zone and refreshes when that setting changes.

## Daily check-in notifications

The onboarding reminder registers the signed-in device with Expo Push Service
and stores its token, timezone, and preferred reminder time in Supabase. Before
delivery, the server checks for a completed check-in for that account and the
reminder's local date. Completed days are skipped, including check-ins saved on
another device. Drafts do not suppress reminders. A failed completion lookup
aborts dispatch rather than sending an unchecked reminder.

Existing local recurring reminders are canceled and migrated on launch. The
opt-in is retained if registration fails and retried on the next foreground;
there is no unconditional local fallback. Registered tokens and timezones are
refreshed on foreground, and sign-out or opt-out removes the device registration.
The permission prompt appears only
after the user chooses a reminder time and taps **Schedule reminder & start**.

After onboarding, Settings → Reminders shows the device's registered push state.
Users can turn the reminder off, turn it back on (requesting OS permission when
needed), or move it earlier or later in 15-minute increments.

Tapping a daily reminder opens Coach → Your Day, whether the app is running or
launching. A launch response is retained through authentication/onboarding and
consumed after navigation so it does not reopen on later mounts.

Deploy `send-push-notifications`, set a strong `PUSH_CRON_SECRET` Edge Function
secret, and invoke the function every 15 minutes (`*/15 * * * *`) with that value
in the `x-cron-secret` header. It sends to devices whose reminder is due in the
current minute or previous 14 minutes and records the reminder's local date to
prevent duplicate daily delivery, including across midnight. Reminders between
cron ticks arrive at the next tick. If Expo
reports `DeviceNotRegistered`, that device is automatically disabled.
`EXPO_ACCESS_TOKEN` is optional unless enhanced Expo push security is enabled.

Deploy the updated sender before applying
`20260911080915_reduce_push_cron_to_15_minutes.sql`. This migration updates the
existing `dispatch-daily-push-notifications` job's schedule while preserving its
command and enabled state. Environments without that job are skipped; use the
same 15-minute schedule when configuring notifications there. The function and
migration workflows run independently, so coordinate this deployment order.

`expo-notifications` and its config plugin are native dependencies, so create and
install a new development or production build after pulling this change:

```bash
pnpm dlx eas-cli@latest build --profile development --platform ios
pnpm dlx eas-cli@latest build --profile development --platform android
```

The plugin adds Apple's push-notification entitlement. On the first iOS build,
let EAS enable Push Notifications for the production and development App IDs and
generate or reuse an Apple Push Notifications key when prompted. Android remote
push requires the project's FCM v1 credentials.

Test on a physical device by enabling a reminder for an upcoming dispatch tick
and backgrounding the app. Verify that completing today's check-in first skips
the reminder, while an unfinished check-in receives it. Tap reminders with the
app both closed and open on Settings/Progress and verify that Your Day opens.
Also verify that reminders resume the next day and that sign-out/opt-out stops
delivery. If permission was previously denied, re-enable it in the device's
notification settings and turn the reminder on again.

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
   ```

The two iOS variants install independently:

- `development`: **Sleep Coach Dev** (`com.30daysleepcoach.app.dev`) connects to Metro.
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

The callback returns to the active app variant at `thirtydaysleepcoach://oura/callback` or `thirtydaysleepcoach-dev://oura/callback`. Oura access and refresh tokens are stored only in the protected `oura_connections` server table. The mobile app requests the `daily` and `heartrate` scopes and accesses data through `oura-proxy`.

Oura API applications are limited to ten users by default. Request Oura approval before inviting a larger production audience.

## Apple Health sleep sync

Apple Health sync is available only in the iOS app. In Settings, a user can grant
read-only access to HealthKit sleep analysis, refresh the current night, choose
Apple Health or Oura as their preferred source, and disable sync. Disabling sync
removes imported Apple Health rows from Supabase without changing data in the
Health app.

HealthKit does not expose Apple's proprietary Sleep Score. The app calculates and
labels its own 0–100 **Sleep Coach score** from sleep duration, efficiency, REM
share, and deep-sleep share. Normalized metrics are stored in `sleep_nights`; raw
HealthKit payloads are not uploaded.

The HealthKit bridge is a native dependency and does not work in Expo Go. After
installing this change, create a fresh development build:

```bash
pnpm dlx eas-cli@latest build --profile development --platform ios
```

HealthKit sleep data must be tested on a physical iPhone with sleep data in the
Health app. EAS must enable the HealthKit capability for each iOS App ID
(`com.30daysleepcoach.app` and `.dev`) when provisioning the build.
Android does not render or call the Apple Health integration.

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

## Android preview for Pixel / Health Connect

The `preview` EAS profile produces a standalone APK with bundled JavaScript,
using the production package and backend. No Metro server or Firebase setup is
needed. Build with `pnpm build:android:preview`, then open the EAS installation
link on the phone and allow the browser to install apps from that source.

Android push defaults to **off**. Onboarding skips reminders, Settings hides
reminder controls, startup does not register tokens or notification listeners,
and the native manifest removes `POST_NOTIFICATIONS`. iOS reminders continue
working. To enable Android push later:

1. Register `com.thirtydaysleepcoach.app` in Firebase (and the `.dev` package if
   using development builds), then download its `google-services.json`.
2. Configure EAS's FCM v1 service-account credentials.
3. Set `ANDROID_PUSH_ENABLED=true` and `GOOGLE_SERVICES_JSON` to the matching
   config file path in the build environment. EAS file environment variables
   work for `GOOGLE_SERVICES_JSON`. A missing file setting fails configuration
   early. Keep service-account private keys out of the app and repository.
4. Rebuild the native app. The existing reminder onboarding, Settings controls,
   notification channels, and registration flow become available automatically.

Health Connect requests read-only Sleep access. On the Pixel, first connect
Google Health / Fitbit to Health Connect and allow it to **write Sleep**, then
connect Sleep Coach and grant **read Sleep** access. Sync runs in the foreground:
initial connection imports up to 14 nights, and refresh rechecks the last three
nights to pick up delayed or corrected records. Health Connect itself limits
historical access; no background or extended-history permission is requested.
Unknown stages are ignored. A stage-less session cannot produce measured sleep
or a score; generic sleeping stages can produce duration but no staged score.
Manual check-in remains available when the watch has not synced or detail is
insufficient. The score is Sleep Coach's calculation, not Google's score.

The source migration `20261007042229_add_health_connect_sleep_source.sql` was
applied to the linked production database on October 6, 2026 (Pacific time).
Existing ownership policies remain in place. Other environments need the same
migration before syncing. Deploy the updated root `privacy.html` with the web
site; the APK also contains an offline Health Connect privacy explanation.

The pinned `react-native-health-connect@4.1.3` patch adapts its bundled Expo
module to the current `expo-module-gradle-plugin` build setup. Keep
`patches/` and `pnpm-workspace.yaml` with the lockfile when building.

Physical-device acceptance: fresh install; Google/email login and return links;
onboarding without notifications; allow/deny/revoke Sleep access; sync one real
night; confirm score appears in Your Day, coach and Progress; refresh after a
late watch sync; manual score override; disconnect and remove imported data;
restart; sign out/account deletion; keyboard and Android Back/gesture navigation.
A new native binary is required for Health Connect; Expo Go cannot test it.

### Local build without uploading source

With Android SDK 36, build-tools 36.0.0, NDK 27.1.12297006, and Java installed,
set `JAVA_HOME` and `ANDROID_HOME`, then run from `mobile`:

```sh
node node_modules/expo/bin/cli prebuild --platform android --no-install
cd android
NODE_ENV=production ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
cd ..
node scripts/sign-android-preview.mjs
```

The signing script produces `dist/sleep-coach-preview.apk`, using a private key
in the ignored `.android-signing/` directory. Back up that directory privately.
Keep the same key for subsequent APK updates; import it into EAS credentials if
switching this installed package to cloud builds later. The arm64 build supports
the Pixel 10. Other architectures require a different Gradle architecture flag.

Verification for this preview: TypeScript passes; 395 automated tests pass across
the full suite and the final added Health Connect daily-view test; an arm64
release APK compiles and verifies its signature. The signed APK installs and
opens the login screen without Metro on the Android API 36.1 emulator. The
Health Connect privacy activity opens before login.
Real account sign-in and Pixel Watch sleep sync still require testing on the
phone. The website privacy update remains local until the next web deployment.
