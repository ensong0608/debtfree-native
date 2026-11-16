# UI simplicity and interaction audit — 2026-11-08

## Owner correction after this review (T-090 / T-091)

**Correction closeout:** The card-only Budget selector now supplies category, commitment bar and Budget/Remaining; rows use entered card minimums and extra once. Debt Scheduled implementation/props were removed. Final typecheck and 15 unique focused checks passed (8 Budget, 7 existing loan-pairing). No stored values were edited. No completed native acceptance or corrected-household total is claimed in this pass; the runtime attempt observed Settings only. Prior screenshots below predate this correction.

The original review did not reconcile expanded Budget amounts. Rows showed first simulated payoff allocations as /mo, included Auto despite its separate category, and listed extra beneath allocations that could already include it. The current Budget rule is entered credit-card minimums plus extra only. The owner corrected the entered amounts; no agent changed them. Home also used first projected payments with /mo; its label is now First payment, preserving projection calculations. Broader payoff inclusion has not been changed.

Scheduled belongs only in Transactions. Earlier notes below about Scheduled in Debt are historical and superseded. T-091 removes the Debt view and obsolete props; legacy Debt Scheduled navigation redirects to Transactions Scheduled.

Scope: source inspection of the five-tab shell; Home, Debt, Transactions, Budget, Progress and Settings; all welcome, sign-in, profile/referral, household, income, plan, debt, strategy and notification onboarding paths in `src/OnboardingAndHome.tsx`; and shared financial, appearance, icon, picker and sheet components. Current user directions take precedence over older prototype navigation. This is a source snapshot during concurrent T-087 edits, not proof of a newly introduced change or current runtime behavior. No backend was accessed. Historical screenshots in `docs/acceptance/2026-11-08/` and prototype references describe earlier runs, not this audit's current runtime.

## Confirmed source conflicts at inspection

**Resolved at manager integration:** Upcoming was consolidated in Transactions; the shell now recognizes Upcoming/Scheduled as sections. The initial findings below remain as audit history.

- `src/screens/HomeScreen.tsx:1138` sends Upcoming See all to Budget; `src/FiveTabShell.tsx:61` routes that section to Budget, and `src/screens/BudgetScreen.tsx:644,1105` still exposes Upcoming there. Latest direction places Upcoming only under Transactions. `TransactionsScreen.tsx:525,726` already has Upcoming. T-087 owns this routing and removal; recheck its integrated result.
- `src/FiveTabShell.tsx:53-54` recognizes only Strategy as a Debt section and treats `Scheduled` as a debt ID, despite `HomeScreen.tsx:933` sending the Budget Scheduled shortcut to Debt Scheduled and `DebtScreen.tsx:171,199` supporting it. Thus that shortcut cannot select Scheduled through this shell as inspected. T-087 owns routes; verify both the shortcut and Debt/Transactions Scheduled after integration.
- These are conflicts with explicit current directions, not a claim about when they appeared. No other actual routing or interaction regression was established by source inspection; absence of runtime testing limits that conclusion.

## Copy changes (preference, not confirmed functional regression)

- `src/screens/DebtScreen.tsx:309,460,466`: shortened Scheduled, payoff priority and mortgage descriptions; retained the 12-month scope, estimated nature, independent mortgage extras and escrow treatment.
- `src/screens/ProgressScreen.tsx:149`: shortened history qualification while preserving incomplete history and principal-allocation caveats.
- `src/screens/SettingsScreen.tsx:793,848,857`: shortened biometric, accessibility and haptic descriptions; retained unavailable status. Reset, backup, recovery, financial and error confirmations remain intact.

## Bounded suggestions for manager (preferences only)

Manager applied the bounded greeting/empty-state and onboarding wording changes below, retaining the Home estimate hierarchy and loan-link explanation. Also corrected the Settings text-size label to avoid a malformed apostrophe. These are copy-only changes, not runtime-verified screens.

- `src/screens/HomeScreen.tsx:1004`: consider removing “Your debt-free journey” under the greeting; it repeats the app's purpose. `:1100` could say “No recorded activity yet.” if retaining the Transactions affordance elsewhere is sufficient. Keep the loan-link safety explanation and estimate qualifier.
- `src/OnboardingAndHome.tsx:1521-1523`: remove “Your answer helps us understand what brought you here,” which repeats the referral question. `:1864-1866` could be “Enter your take-home income after taxes”; keep frequency conversion, validation and recovery guidance. `:2693-2695` could be “You can change this later.” No onboarding edits made.
- `src/components/SheetModal.tsx`, `SelectDropdown.tsx`, `FinancialScreen.tsx`, `NativeAppearance.tsx`, `AppIcon.tsx`: shared frames, close/picker labels and financial display inspected; no clear redundant shared modal copy requiring an edit identified. Preserve accessible labels and status details.
- `BudgetScreen.tsx` and `TransactionsScreen.tsx`: inspect their in-flight copy and payment sheets after T-087 completes; retain payment matching, pending status, schedule and error explanations. No copy edits proposed in these concurrently owned files.
- `ProgressScreen.tsx` utilization and milestones and `SettingsScreen.tsx` household, notifications, help, backup and recovery were reviewed; qualifiers and safety information are useful and should remain. Debt detail's three tabs and Strategy's expandable projection are present in source (`DebtScreen.tsx:505-506,526,633,704-714`). Home Strategy targets Debt Strategy (`HomeScreen.tsx:1071-1079`). These are source observations, not runtime verification.

## Integration closeout and verification

The manager completed T-087 after partial worker handbacks. Budget has Monthly Income / Edit, collapsed Income sources, a category-colored commitment bar and concise Budget / Remaining figures. Bar and category rows share a color resolver, preserving Transportation amber. Recorded purchases remain distinct actual spending outside the commitment bar. Unreachable Budget Strategy/Upcoming branches and redundant prose were removed.

`src/components/UpcomingObligations.tsx` hosts the migrated Budget matching, recording and prior-month settlement flows. The shared selector supplies unpaid current/next-month and genuine overdue obligations, grouped by sorted month/year then date. Settled/acknowledged cycles are suppressed. Pending details remain inspectable; duplicate recording is blocked. Linked loans pass their debt ID into matching. Prior settlement retains the existing ledger/callback semantics and adds a concise confirmation. No financial domain/storage rules were modified.

- Final `npm.cmd run typecheck` passed. The first attempt included temporary scratch `.tsx` snapshots; renaming those snapshots `.txt` resolved that inspection-artifact failure.
- Four existing focused files passed **29/29** checks: finance-budget, finance-obligation-schedule, finance-loan-bill-pairing, finance-product-remediation. No new tests, full suites or builds.
- Current source was observed through Metro 8081 on the already-running Android emulator: Monthly Income/Edit, collapsed/expanded sources, matching mint/blue/violet/amber colors, no Budget subtabs, Budget shortcut selecting Transactions Upcoming, December date groups, opening/closing payment details with an unassigned payment candidate, and Scheduled in Debt and Transactions.
- Native interactions were read-only. No Match, Record payment, Mark paid or income Save was submitted. Payment mutations, synthetic pending/overdue cases, light mode and iOS were not exercised in this pass. Safeguards were source-reviewed and covered only to the extent of existing focused tests. Home's conditional Upcoming destination was source-verified; its card was absent from the settled household view.
- Current full device viewport captures: `docs/acceptance/2026-11-08/ui-simplicity/`; these are not stitched full-scroll captures. Viewing artifact: `design/ui-simplicity-2026-11-08.html`.
- Additional finding: the existing floating Add button can overlap a trailing Budget amount at some scroll positions. This is not established as a regression. A future adjustment should preserve the requested control placement while keeping amounts clear; this pass did not redesign the shared floating-control layout.
