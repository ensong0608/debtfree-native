# DebtFree Native

Native Android and iOS app. The first section is sign-in. This repository is independent from the DebtFree web application.

## Status

**Draft. Google PKCE sign-in, chunked SecureStore persistence, server-verified session restoration, background/foreground re-validation, offline recovery, sign-out, Sign-Up (Steps 1–4), Onboarding (Setup Steps 1–5), sandbox Supabase `public.debts` + `user_metadata` persistence, and the Home Dashboard are verified on Android (`DebtFree_Pixel_API_36`) against the designated sandbox Supabase project (`bitepxsdujceoszbldhd`). Native Apple sign-in on iOS remains unverified.** Do not use the existing web production project or any real household data. No app store deployment is configured.

Live store billing (in-app purchases), bank-account aggregation (Plaid/Finicity), and remote push notification delivery are intentionally disabled in the sandbox build; the UI clearly labels sandbox preview behavior without fabricating purchases, bank syncs, or scheduled payments. Configuration, security, accessibility and provider flows require independent review before a pilot.

## Development

1. Use Node 24 and run `npm ci`. If PowerShell blocks `npm.ps1` ("running scripts is disabled"), run `npm.cmd …` instead, or use Command Prompt.
2. Copy `.env.example` to `.env.local` (ignored by git) and fill in the **separate test project's** public URL, reference and publishable key. The designated sandbox is `bitepxsdujceoszbldhd` (the same public values used by `.github/workflows/android-test-build.yml`). Do not use a secret or service-role key. The client rejects the known production project, mismatched URL/reference pairs, and secret/legacy keys; in development builds the sign-in screen names the variable or rule that failed, without showing values. `EXPO_PUBLIC_` values are compiled into the app, so never put secrets there.
3. Expo loads `.env.local` before `.env` (shell variables win over both). `EXPO_PUBLIC_` values are inlined when the bundle is built: after changing them, stop Metro and restart with `npx expo start --dev-client --clear`.
4. Build a development client (Expo Go is not sufficient for the custom redirect). See the Windows emulator section below.
5. Run `npm run lint`, `npm run typecheck`, and `npm test`. Tests cover the configuration guard, callback parsing, auth-error classification, the chunked secure-storage adapter, income frequency normalization, Sign-Up & Onboarding step validation, and the Debt Snowball / Debt Avalanche payoff engine. They do not exercise a real provider, device secure storage, or the device session lifecycle.

## Sign-Up, Onboarding, and Home Dashboard Flow

The app implements the 10-screen UI/UX reference flow (`Welcome → Sign-Up Steps 1–4 → Onboarding Setup Steps 1–5 → Home Dashboard`):

1. **Welcome (`welcome`)**: Entry screen with **Get started — it’s free** (starts Sign-Up Step 1 of 4) and **SIGN IN** / **Sign in** links for returning users.
2. **Sign-Up Step 1 of 4 (`signup_1`)**: Account authentication via **Continue with Google** (browser PKCE) on Android/iOS and native **Continue with Apple** on iOS when enabled, plus honest sandbox guidance for email/password sign-up.
3. **Sign-Up Step 2 of 4 (`signup_2`)**: Acquisition attribution survey (`How did you hear about DebtFree?`, single-select required).
4. **Sign-Up Step 3 of 4 (`signup_3`)**: Prior debt/budgeting tools survey (`What have you used before?`, multi-select required) with conditional **Which AI tool?** follow-up when `AI tools` is selected.
5. **Sign-Up Step 4 of 4 (`signup_4`)**: Country & currency selector, partner/household management (`Yes`/`No`), and financial professional (`Yes`/`No`).
6. **Onboarding Setup 1 of 5 (`onboard_1` — Income)**: Primary take-home pay amount, pay frequency (`Monthly`, `Bi-weekly`, `Twice a month`, `Weekly`) normalized to monthly income (`weekly * 52 / 12`, `biweekly * 26 / 12`, `twice_monthly * 2`), and optional `+ Add another income source` (partner or side income).
7. **Onboarding Setup 2 of 5 (`onboard_2` — Choose Premium)**: Choice between **DebtFree Premium** (manual tracking) and **Premium + Bank Sync** (with an explicit sandbox note that live billing and bank connections are not triggered).
8. **Onboarding Setup 3 of 5 (`onboard_3` — Add Your Debts)**: Home (`Own`, `Rent`, `Other`) and Vehicle (`Finance`, `Lease`, `Own`, `None`) status splits, plus inline add/edit/remove for **Mortgage**, **Auto loan**, and **Credit cards & other loans** (`Credit card`, `Personal loan`, `Student loan`, `Medical debt`, `Other debt`). Requires at least one debt account (`balance > 0`, `0 <= apr <= 100`, `minimumPayment > 0`) to build a payoff plan.
9. **Onboarding Setup 4 of 5 (`onboard_4` — Payoff Strategy)**: **Debt Snowball** (smallest balance first) vs. **Debt Avalanche** (highest APR first), extra monthly payment input, and live payoff preview card.
10. **Onboarding Setup 5 of 5 (`onboard_5` — Reminder preferences)**: Saves preferences for upcoming payments, past-due alerts, and milestones. Reminder scheduling and delivery are not available; this screen does not request OS notification permission.
11. **Home Dashboard (`home`)**: Displays total debt, payoff progress, monthly plan (`minimums + extra`), projected debt-free date, normalized monthly household income, estimated total interest, interactive Snowball/Avalanche strategy switcher, Next Priority Target card, ordered payoff list with inline add/edit/remove debt persistence, **Edit Setup**, and **Sign Out**.

### Five-tab screen foundation (2026-11-04)

Completed onboarding now opens **Home → Debt → Transactions → Budget → Progress**, with the selected Option B vector icon family. Debt shows the stored manual accounts, including zero balances, with category filters and the existing add/edit/remove controls. Budget shows entered income, monthly equivalents, and the same strategy payment budget used by Home. Progress exposes current month, previous month, and lifetime views for debt paid down, payments made, and accounts paid off.

The five-tab app now has per-user ledger transactions, recurring-bill records, reconciliation anchors, budget cashflow projections, and Progress summaries. Recurring bills remain unpaid until the user confirms them; confirmations preserve the actual transaction date and the due cycle they satisfy. Budget projections include credit-card recurring bills and current-month one-time debit spending. Home shows real recent ledger activity and configured bills. These changes have not been verified in the native runtime or against a database. The unapplied `20261106100000_transaction_due_cycle.sql` migration adds the optional due-cycle date needed by advance payments. Household invitations/shared-account access and local/push notification delivery remain unimplemented; bank linking and store billing remain disabled in the sandbox. Home's debt percentage remains a balance snapshot, not verified payment history.

T3 Code's integrated Device panel is working with `DebtFree_Pixel_API_36` (T-014). The updated development APK, including `react-native-svg`, was built, installed over the previous app, and launched on 2026-11-04. Setup 3 of 5 rendered with Option B icons; the five completed-app tabs still await runtime checks after the user finishes saved onboarding with sandbox data.

To preview again, start `npx.cmd expo start --dev-client --localhost --port 8081` from this repository and leave it running. Open `DebtFree_Pixel_API_36` in T3's Device panel and launch **DebtFree Native Test**. If its development-build launcher appears, enter `http://10.0.2.2:8081` and tap **Connect**. In an agent session, ask to reopen T-014; the agent should use `device_list`, `device_open`, and the returned session-bound command to launch `com.debtfree.nativetest` and open `exp+debtfree-native-test://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081`. Use a newly returned command after closing the device or restarting T3. Agent device access is under **Settings → Integrations → Devices**. The configured `SERVE_EMU_FFMPEG` and libx264 installation resolved the video prerequisite; no repeat installation is needed.

### Sandbox Data Persistence & Isolation

- **Database table (`public.debts`)**: Core debt rows (`id`, `user_id`, `name`, `balance`, `apr`, `minimum_payment`) are read from and upserted/deleted in the sandbox Supabase `public.debts` table scoped to `session.user.id` and enforced by Row-Level Security (`auth.uid() = user_id`).
- **User profile metadata & per-user local cache**: Survey answers, household settings, income sources, extended debt fields (`category`, `originalBalance`, `dueDay`, `creditLimit`), payoff strategy, notification preferences, and `currentStage` are persisted to `supabase.auth.updateUser({ data: { debtfree_native_v1: ... } })` and cached in per-user chunked `SecureStore` (`debtfree-onboarding-v1.<userId>`) so switching accounts never leaks another user's state.
- **SQL Migration**: `supabase/migrations/20261104000000_onboarding_and_households.sql` provides idempotent DDL and RLS policies for `public.households`, `public.household_members`, and extended `public.debts` columns (`household_id`, `category`, `original_balance`, `due_day`, `credit_limit`).

## Provider configuration (sandbox only)

Google uses the system browser with Supabase PKCE (`signInWithOAuth` + `WebBrowser.openAuthSessionAsync` + `exchangeCodeForSession`). There are two redirect stages:

| Stage | Required setting | Where | Status |
| --- | --- | --- | --- |
| Google → Supabase | Authorized redirect URI `https://bitepxsdujceoszbldhd.supabase.co/auth/v1/callback` on the sandbox's Google OAuth **Web application** client | Google Cloud Console → Google Auth Platform → Clients | Checked without signing in on 2026-11-03: the sandbox's authorize endpoint sent that redirect URI and Google accepted it (no `redirect_uri_mismatch`) |
| Supabase → app | `com.debtfree.native.test://auth/callback` in the redirect allow list | Supabase dashboard (sandbox) → Authentication → URL Configuration → Redirect URLs | Verified on `DebtFree_Pixel_API_36` on 2026-11-03: callback returned to the app and exchanged the PKCE code for a session |

Also required: the Google provider enabled in the sandbox (the public settings endpoint reports `google: true`). If the Google OAuth consent screen's publishing status is **Testing**, add each tester's Google account under *Audience → Test users*. A denied or unlisted account returns to the app with "Google sign-in was cancelled or this Google account is not authorized…". The app requests `prompt=select_account` so testers can switch Google accounts.

Never change web production provider settings, and never put the Google client secret anywhere except the sandbox Supabase Google provider settings.

### Sign in with Apple (iOS only, not verified)

The native flow (`expo-apple-authentication` → `signInWithIdToken` with a SHA-256 nonce) has not been run. It needs:

- Apple Developer account: the App ID `com.debtfree.nativetest` with the **Sign in with Apple** capability.
- Sandbox Supabase → Authentication → Providers → Apple: enabled, with `com.debtfree.nativetest` in **Client IDs**. A Services ID, signing key and secret are only needed for the web OAuth flow (which also requires rotating the secret every 6 months), not for native-only sign-in.
- `EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED=true` in `.env.local`. The button stays hidden otherwise.
- A Mac with Xcode to build the iOS development client (`npx expo run:ios`) and test on a signed-in iPhone or simulator: first sign-in (name captured with `updateUser`), cancel, second sign-in, sign-out, and revocation from Settings → Apple ID.

## Session behaviour

- Protected UI appears only after `getUser()` confirms the stored session with the auth server. This check runs at launch and on every return to the foreground while signed in.
- Definitive rejections (revoked/expired refresh token, deleted user, bad JWT) clear the local session and show "Your session has ended". Temporary failures (offline, 5xx, rate limiting) keep the stored session but hide protected UI and offer **Try Again** or **Sign out on this device**.
- Callbacks must be exactly `com.debtfree.native.test://auth/callback` with one `code` and no error or fragment. Codes are single-use per process. Provider errors are reported without echoing their descriptions.
- Sessions are stored in Expo SecureStore, split into chunks of 1800 bytes or fewer under a generation id. An interrupted write keeps the previous value, and a missing chunk is treated as signed out. Values stored by earlier builds are still readable. The SecureStore config plugin excludes these entries from Android Auto Backup.
- Sign-out writes a durable signed-out lock first, then attempts global revocation and local removal. If any step fails, the UI still shows signed-out, reports that sign-out was not fully confirmed, and the lock prevents an offline sign-out from silently restoring the old session. Remote revocation may remain unconfirmed in that case.
- Known gap: if Android kills the app process while the browser is open, the returning callback starts a fresh app that ignores it; the user must tap Google again.

## Run locally on a Windows Android emulator

Install Node 24, JDK 17, Android Studio, Android SDK Platform-Tools, Android Emulator, and the SDK/build tools requested by the generated Android project. Set `JAVA_HOME` to the JDK and `ANDROID_HOME` to the SDK, and add the SDK's `platform-tools` and `emulator` folders to PATH. Open a new terminal after changing environment variables.

1. In Android Studio's Device Manager, start an Android virtual phone (the locally configured device is `DebtFree_Pixel_API_36`), or run `emulator -avd DebtFree_Pixel_API_36`.
2. From this repository, run `npm ci` if dependencies are not installed. Keep the sandbox configuration in the ignored `.env.local` file.
3. Run `npm run android -- --device DebtFree_Pixel_API_36` to build and install the development app directly into this emulator. Use your own virtual device name on another computer. The first native build downloads Gradle and Android dependencies and takes longer. If a physical phone is also connected, keep the `--device` argument so it is not targeted.
4. On later sessions, run `npm run android:dev` to start Expo and reopen the installed development app. Leave the terminal running while working. JavaScript and UI edits use Fast Refresh. Add `-- --clear` after changing `.env.local`.

Run `npm run android` again after changing native dependencies, config plugins, or native app configuration. There is no manual APK transfer or physical phone required. Android can exercise the Google sign-in flow; native Apple sign-in requires iOS hardware or an iOS simulator on a Mac.

On a 16 GB machine, avoid running other heavy processes during the native build. Setting `GRADLE_OPTS=-Dorg.gradle.workers.max=2` limits Gradle parallelism.

On this workstation, the generated `android/app/build.gradle` places CMake intermediates in `~/.dfn-cxx/app` and passes `-DCMAKE_OBJECT_PATH_MAX=240` to avoid Windows path limits under OneDrive. These local settings are in the ignored native directory; regenerating it with `expo prebuild --clean` removes them.


### T-023 currency precision and migration handoff

Debt writes use currency-scale canonical decimal strings, and reload rejects nonzero precision beyond the selected currency scale while accepting PostgreSQL padding. Currency remains in onboarding metadata; changing it is blocked while monetary records exist. No exchange conversion is performed. The forward migration `supabase/migrations/20261105065959_debt_currency_precision.sql` was reviewed and applied only to the designated sandbox (`bitepxsdujceoszbldhd`); its local version matches remote migration history. It widens existing debt monetary columns and adds the two nullable optional columns when absent without changing existing ownership or RLS policies. Synthetic values against the actual table type verified currency precision; no user rows were accessed. Four focused test files pass 15 tests and TypeScript passes. Native runtime/layout and authenticated end-to-end save/reload remain unverified. Do not apply the older household migration as part of this precision fix. Any future rollback must preserve new fractional digits rather than narrowing back to two decimals.
