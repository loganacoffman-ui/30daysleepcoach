# App Store Readiness

## Permanent app identity

- Display name: `30 Day Sleep Coach`
- Website: `https://30daysleepcoach.com`
- Privacy policy: `https://30daysleepcoach.com/privacy.html`
- Bundle identifier: `com.30daysleepcoach.app`
- Deep-link scheme: `thirtydaysleepcoach`
- EAS project ID: `48f61526-b884-445b-aa4b-ffdcec6e4ade`

## Apple and Supabase setup

Complete these steps after the Apple Developer Program membership becomes active:

1. Register an explicit App ID for `com.30daysleepcoach.app` in Certificates, Identifiers & Profiles.
2. Enable the **Sign in with Apple** capability for that App ID.
3. In Supabase Dashboard → Authentication → Providers → Apple, enable Apple and add `com.30daysleepcoach.app` as an accepted client ID for native sign-in.
4. Create the App Store Connect record using the same bundle identifier.
5. Run an EAS development build. EAS should synchronize the Apple sign-in entitlement from `ios.usesAppleSignIn`.
6. Test Apple sign-in on a physical iPhone. Confirm first sign-in stores the provided name and subsequent sign-ins succeed when Apple returns no name.

Native-only Apple sign-in uses Apple's identity token with `supabase.auth.signInWithIdToken`. It does not require the web OAuth Services ID or six-month client-secret rotation unless web Apple OAuth is added later.

## Account deletion deployment

Deploy the authenticated function:

```bash
supabase functions deploy delete-account
```

The function verifies the caller's Supabase session and uses `SUPABASE_SERVICE_ROLE_KEY` only on the server to delete the authenticated user. User-owned tables should reference `auth.users(id)` with `ON DELETE CASCADE`; verify this for `entries`, `ai_cache`, `oura_connections`, and `oura_oauth_states` before production deletion testing.

Production deployment was refreshed on August 23, 2026. All repository migrations are present in the linked project, the required Oura secrets are configured, and the Oura OAuth/proxy and account-deletion functions are active. A real Oura-account authorization and a destructive test-account deletion still require physical-device QA.

## App privacy questionnaire working notes

Confirm the final production build and vendor configuration before submitting these answers.

- Contact information: email and optional name for authentication/account management.
- Health & fitness: sleep, recovery, HRV, stress, energy, mood, and related check-in information supplied by the user or imported from Oura.
- User content: journal notes, coaching messages, voice transcripts, and optional voice recordings while transcription is in progress.
- Identifiers: Supabase user ID and provider authentication identifiers.
- Diagnostics: limited server/device diagnostic and security information needed to operate the service.
- Tracking: no cross-app or cross-company advertising tracking is intended.
- Advertising: health and wellness data is not used for advertising.

## Pre-activation checks

- [x] `pnpm exec tsc --noEmit` passes.
- [x] Expo config resolves `com.30daysleepcoach.app`, `usesAppleSignIn: true`, and iPhone-only support.
- [ ] Email sign-up confirmation path works.
- [ ] Email/password sign-in and sign-out work.
- [ ] Google sign-in cancellation and success paths work.
- [ ] Privacy Policy opens from both signed-out and signed-in screens.
- [ ] Health disclaimer is readable on a small phone screen.
- [ ] Delete Account shows Cancel and destructive confirmation actions.
- [ ] A failed deletion request leaves the user signed in and shows a recoverable message.
- [ ] Oura authorization returns to `thirtydaysleepcoach://oura/callback`.
- [ ] Oura status, latest sleep-score refresh, token refresh, and disconnect work on a physical iPhone.

## Physical-device and TestFlight checks

Record the device model, iOS version, app version, build number, tester, date, and result.

- [ ] Native Continue with Apple button appears on supported iOS devices.
- [ ] Canceling Apple sign-in returns quietly without an error.
- [ ] First Apple sign-in creates a Supabase session and stores an available name.
- [ ] Repeat Apple sign-in succeeds without name or email in Apple's response.
- [ ] Google and email sign-in still work in the same binary.
- [ ] Account deletion removes the Auth user and cascading app data.
- [ ] Deleted credentials cannot sign in unless a new account is created.
- [ ] App icon, display name, launch behavior, and deep links are correct.
- [ ] Core check-in/coaching flow succeeds on Wi-Fi and cellular.
- [ ] Offline and server-error states remain readable and recoverable.
- [ ] Internal TestFlight tester can install and launch the processed build.

## TestFlight commands

Run only after Apple membership activation, App ID registration, and provider setup:

```bash
pnpm dlx eas-cli@latest build --platform ios --profile production
pnpm dlx eas-cli@latest submit --platform ios --profile production
```
