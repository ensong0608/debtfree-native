# DebtFree Native — Active Task Tracker

- **Next Task ID:** `T-373`
- **Branch:** `BitLess/zero-debt-phase-a`
- **Archive (`T-001..T-349`):** `C:\Development\AI-Infrastructure\memory\debtfree-native\TRACKER_ARCHIVE_T001_T349.md`
- **Rule:** Keep this file **under 100 lines**. Archive completed milestones periodically.

---

## Completed — Phase A: Zero-Debt Readiness, Auth/Copy Polish & <5s Daily Ergonomics (`T-369..T-372` on `BitLess/zero-debt-phase-a`)
- **`T-369` (`DONE`):** Unblocked & rebranded zero-debt onboarding (`src/onboarding-domain.ts`, `src/OnboardingAndHome.tsx`, `tests/onboarding-domain.test.mjs`): replaced remaining `DebtFree` copy with `BitLess`, cleared debt-only `goals` default, added zero-debt goals, made `signup_2`..`signup_4` optional/skippable (`Skip for now` / `Prefer not to say`), added `onboard_1` income skip, and added `"I have no debts right now"` in `onboard_3` to land directly on Home.
- **`T-370` (`DONE`):** Added `Forgot password?` PKCE reset + callback recovery screen (`App.tsx`, `src/auth.ts`, `src/auth-guards.ts`, `src/OnboardingAndHome.tsx`), `Check your email / Resend confirmation` state on `signup_1`, plain-language `CLOUD SYNC & BACKUPS` copy (technical checkpoint hidden unless active/conflicted), and expanded zero-debt `Help & Guides` (`src/screens/SettingsScreen.tsx`).
- **`T-371` (`DONE`):** Streamlined sub-5s expense logging (`Cash / Debit` first + quick mode pills, inline `Payee`, `Recent Payee` chips, per-user `Payee → Category` memory) and saved CSV import presets + sign-safe payee rules (`src/finance/payee-memory.ts`, `src/payee-memory-storage.ts`, `src/finance/csv.ts`, `src/screens/TransactionsScreen.tsx`, `tests/payee-memory.test.mjs`).
- **`T-372` (`DONE`):** Added adaptive zero-debt Home Hero (`Debt-Free ($0 owed)` / `Safe to Spend` + `Monthly Savings Rate %` gated on verified inventory) and Progress multi-month `Income vs. Spending` + `Savings Rate` trends and non-debt milestones (`src/finance/progress.ts`, `src/screens/HomeScreen.tsx`, `src/screens/ProgressScreen.tsx`, `tests/finance-progress.test.mjs`). Verified with `tsc --noEmit`, `eslint`, `49/49` targeted tests, and `GPT-6.1 Terra` review.

---

## Completed — Quiet Complexity Polish & Sandbox RPC Migration (`T-368` on `feature/quiet-complexity`)
- **`T-368` (`DONE`):**
  - Deployed forward migration `supabase/migrations/20261124100000_quiet_complexity_household_settings.sql` to sandbox `bitepxsdujceoszbldhd` (allowlisted `promoTermsByDebtId`, `customPayoffOrder`, `minimumModeByDebtId`, `variableCategoryCaps`, `irregularBillScheduleByBillId` + `strategy = 'custom'` + server JSON shape checks + snapshot restore rekeying).
  - Polished UI per live-device feedback: collapsed optional account terms (`Original balance`, `Monthly escrow`, `Credit limit`, `Annual fee`, `Next renewal`, `Promotional APR`) under `Detail → Advanced`, added explicit `Custom payoff order active` + `Tap ↑ ↓ to reorder` guidance & pill controls + `'Custom'` hero/Settings labels, moved `Import CSV` cleanly below `Payments` & `Interest & Fees`, renamed Budget `'Debt payments'` / `'Card minimums + extra'` to `'Payoff Budget'` / `'Minimum + extra'` with non-wrapping `%` pill alignment.
  - Resolved independent reviewer findings (`GPT-6.1 Terra` + `GPT-6 Luna`): normalized-payee matching in CSV duplicate detection (`csv.ts`), scenario extra & expired promo/custom sorting parity (`onboarding-domain.ts`).

## Completed — Quiet Complexity Plan (`T-360..T-367` on `feature/quiet-complexity`)
- **`T-360` (`DONE`):** Wired local milestone notifications (`notifications.ts`, `OnboardingAndHome.tsx`, `SettingsScreen.tsx`); kept Backup Restore gated (`T-355`).
- **`T-361` (`DONE`):** Credit Card-only Promo APR in Account `Detail` tab, `Custom` payoff ordering, durable `minimumModeByDebtId`, and live strategy delta badges (`payoff.ts`, `onboarding-domain.ts`, `DebtScreen.tsx`, `HomeScreen.tsx`).
- **`T-362` (`DONE`):** 30% Utilization Target Advisor + 1-tap `Simulate` shortcut (`progress.ts`, `ProgressScreen.tsx`, `HomeScreen.tsx`).
- **`T-363` (`DONE`):** 1-tap Transactions CSV export in `SettingsScreen.tsx` + zero-prose UI copy cleanup across screens (`csv.ts`, `SettingsScreen.tsx`, `HomeScreen.tsx`).
- **`T-364` (`DONE`):** Home Hero `Safe Extra` surplus pill + 1-tap `Boost #1` (`budget.ts`, `HomeScreen.tsx`).
- **`T-365` (`DONE`):** Optional variable category caps + Quarterly/6-mo/Annual irregular bill monthly reserves (`budget.ts`, `BudgetScreen.tsx`, `OnboardingAndHome.tsx`).
- **`T-366` (`DONE`):** Guided CSV Import with sign toggle & duplicate check, inline `+ Split` transactions, and smart recurring bill nudges (`csv.ts`, `TransactionsScreen.tsx`, `FiveTabShell.tsx`).
- **`T-367` (`DONE`):** Collapsible 0% Transfer / Consolidation break-even check in `Accounts → Strategy` (`payoff.ts`, `DebtScreen.tsx`).

## Completed & Holds
- **`T-350..T-357` (`DONE` — committed `5b3d19d` on `feature/improve-finance-history-2`):** Phase 1 UX/FAB/ErrorBoundary, Email+Password Auth, Copy/Empty States, Local Notifications, Email-Optional Invites, Prod Config/Sentry Guards, iOS Refresh/EAS, GitHub Pages Staging.
- **`T-358` (`HOLD — LAST`):** Real iPhone Hardware Acceptance (`$99/yr` Apple Dev).
- **`T-359` (`HOLD — LAST`):** Production Supabase & Pro Upgrade (`$25/mo`).
