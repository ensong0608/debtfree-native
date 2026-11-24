# DebtFree Native — Active Task Tracker

- **Next Task ID:** `T-360`
- **Archive (`T-001..T-349`):** `C:\Development\AI-Infrastructure\memory\debtfree-native\TRACKER_ARCHIVE_T001_T349.md` (`4,212` lines / `1.33 MB` archived `2026-11-22`)
- **Rule:** Keep this file **under 100 lines**. Archive completed milestones to `C:\Development\AI-Infrastructure\memory\debtfree-native\` periodically.

---

## Completed
- **`T-350` (`DONE` — 2026-11-22):** Phase 1 UX & Safety Fixes:
  - Kept bottom-right FAB (`right: 18, bottom: 18`), added scroll-down auto-tuck / scroll-up & edge restore + `paddingBottom: 104` (`src/components/FinancialScreen.tsx`, `src/screens/DebtScreen.tsx`).
  - Removed redundant `↓ -$` / `↓ −$` / `↑ +$` double signs in Progress while preserving `$ ` spacing (`src/screens/ProgressScreen.tsx`).
  - Added `numberOfLines={1}` to Strategy `unitLabel` (`/ mo`) (`src/screens/DebtScreen.tsx`).
  - Streamlined Household Invite to 1-tap `Create & Share Invite` auto-opening OS Share sheet (`src/screens/SettingsScreen.tsx`).
  - Added dependency-free `RootErrorBoundary` with reload fallback (`App.tsx`).

- **`T-351` (`DONE` — 2026-11-22):** **Simple Email + Password Auth (Supabase Free `$0`):** Wired `signUpWithEmail` / `signInWithEmail`, validation, error mapping, and `signup_1` UI (`src/auth.ts`, `src/auth-guards.ts`, `App.tsx`, `src/OnboardingAndHome.tsx`, `tests/auth-guards.test.mjs` 8/8).
- **`T-352` (`DONE` — 2026-11-22):** **Ledger Copy Clarity, Empty States & Light Theme Pass:** Updated payment sheets to `"Record payment for {name}"` with non-bank ledger clarity, added empty-state guidance across 5 screens, and darkened Light muted text to `#52645a` (`tests/ui-interaction-contracts.test.mjs` 12/12).
- **`T-353` (`DONE` — 2026-11-22):** **Local Device Notifications (`expo-notifications`):** Installed `expo-notifications`, added `src/notifications.ts` (9 AM local due/overdue reminders, 40-item cap), wired `OnboardingAndHome.tsx`, `onboarding-storage.ts`, `SettingsScreen.tsx`, `app.config.ts`, `APP_CAPABILITIES.md` (`notifications.test.mjs` 5/5, `shared-settings-recovery.test.mjs` 14/14).
- **`T-356` (`DONE` — 2026-11-22):** **iOS Software Prep & EAS Cloud Build (`eas.json`):** Replaced iOS JS `PanResponder` fallback with native `<RefreshControl />` in `PullToRefreshScrollView.tsx`, updated `SheetModal.tsx`, added `eas.json` (`simulator` + `preview` profiles) (`typecheck`, `lint`, `ui-interaction-contracts.test.mjs` 12/12).
- **`T-354` (`DONE` — 2026-11-22):** **Zero-Friction Email-Optional Household Invites:** Added & pushed `20261123003000_email_optional_household_invitations.sql` to sandbox `bitepxsdujceoszbldhd` (`migration list` aligned), made `inviteeEmail` optional in `household-collaboration.ts` & `SettingsScreen.tsx` (`shared-settings-recovery.test.mjs` + `household-collaboration.test.mjs` 25/25).
- **`T-355` (`DONE` — 2026-11-22):** **Prod Config Guards, Crash Telemetry & Restore Gate:** Required `DFN_IOS_BUNDLE_ID`, rejected sandbox ref in prod, required Apple Sign-In when OAuth enabled in iOS prod, set `ITSAppUsesNonExemptEncryption=false` (`app.config.ts`), aligned `0.1.49` (`app.json`, `build.gradle`), added DSN-gated `@sentry/react-native` (`src/telemetry.ts`, `App.tsx`), kept restore UI hidden (`app-config-guards.test.mjs` 6/6, `auth-guards.test.mjs` 8/8).

- **`T-357` (`DONE — Staging` — 2026-11-23):** **GitHub Pages Staging URL (`support-site/`):** Configured `https://ensong0608.github.io/debtfree-native/invite/#token=...` (overridable via `EXPO_PUBLIC_OFFICIAL_DOMAIN` / `DFN_OFFICIAL_DOMAIN`), added `support-site/index.html` + `support-site/invite/index.html`, kept legal drafts/placeholders until custom domain (`household-collaboration.test.mjs` 11/11).
- **`T-358` (`HOLD — LAST`):** **Real iPhone Hardware Acceptance (`$99/yr` Apple Dev):** TestFlight/Ad-Hoc build on physical iPhone (Apple/Google Sign-In, SecureStore, keyboards, VoiceOver, Dynamic Type, in-app deletion).
- **`T-359` (`HOLD — LAST`):** **Production Supabase & Pro Upgrade (`$25/mo`):** Provision prod DB, push migrations, deploy Edge Functions, configure custom SMTP (Resend), enable leaked-password protection, audit 36 `SECURITY DEFINER` RPCs / 11 FKs / 5 no-policy tables.
