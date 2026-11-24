# DebtFree Native — Active Task Tracker

- **Next Task ID:** `T-369`
- **Branch:** `feature/quiet-complexity` (branched from `feature/improve-finance-history-2` @ `5b3d19d`)
- **Archive (`T-001..T-349`):** `C:\Development\AI-Infrastructure\memory\debtfree-native\TRACKER_ARCHIVE_T001_T349.md`
- **Rule:** Keep this file **under 100 lines**. Archive completed milestones periodically.

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
