# Product remediation acceptance review — 2026-11-07

## Verdict

**CHANGES REQUIRED.** Source tracing found two high-priority due-cycle defects and several narrower product gaps. The core schedule model, due-today acknowledgement semantics, debt/bill save ordering, recurring-bill cycle selection, debt detail popup structure, and strategy navigation are generally present. These findings mean the due-date feature and final product handoff do not yet meet acceptance.

This is an independent source review of the shared working tree. I read `AGENTS.md`, `APP_PLAN.md` and its owner-approved override, the prototype interaction/calculation references, and the relevant T-055C/V, T-057, and T-058 tracker handbacks. I made no application edits, network calls, live-data access, builds, emulator/device work, dependency changes, or commits. I wrote only this report and the T-059-D tracker update. No broad tests were run.

## Findings

### P1 — Adding a due day to an older debt with no prior due day creates historical cycles

**Source:** `src/finance/obligation-editor.ts:33-43, 51-64`; `src/OnboardingAndHome.tsx:676-700`; `src/screens/HomeScreen.tsx:418-449`; overdue consumption at `src/finance/payment-matching.ts:446-458`.

When an existing debt had `dueDay: null` and no schedule, either debt editor calls `prepareObligationEditorSchedule` with `isNew: false` and no `legacyDueDay`. The helper then uses the newly entered `dueDay` as `historicalDueDay` and anchors the schedule to the debt row's old `createdAt`. The overdue selector consequently scans cycles from that old creation date. The due-today prompt is guarded by `isDraftDebt`, so enabling a due day that falls today on an existing debt also bypasses the Yes/No/Cancel prompt.

**Minimal reproduction from source values:** use an existing debt created `2026-06-10`, which has never had a due day or schedule. On `2026-11-07`, edit it and set due day `1`. The helper starts the schedule at `2026-07-01` (July 1 was after the row creation date), so July through November become eligible historical cycles although obligation tracking began on November 7. Setting due day `7` on November 7 likewise skips the prompt because the row is not a draft.

**Narrow fix:** initialize a first schedule from the current household date when the existing debt had no prior due day; only use creation-date history when a previously recorded due day exists. Treat the transition from no due day/schedule to a due day as a newly tracked obligation for the due-today prompt. Preserve old history when a real prior due day or schedule exists. The focused runtime confirmation attempt could not import `obligation-editor.ts` under Node because its `react-native` import reaches Flow syntax (`SyntaxError: Unexpected token 'typeof'`); no runtime result is claimed.

### P1 — Budget matches next-month debt-minimum reminders against the current month

**Source:** `src/screens/BudgetScreen.tsx:1066-1085`, especially `:1081`; `src/finance/payment-matching.ts:126-147`. Home passes the loop month correctly at `src/screens/HomeScreen.tsx:286-292`.

Budget loops debt minimums for `[currentMonthStr, nextMonth]`, selects the correct cycle-specific schedule amount and due date, but constructs the payment obligation with `dueCycleMonth: currentMonthStr` for both rows. `paymentMatchesObligation` uses `dueCycleMonth` as the decisive cycle key. A current-month payment can therefore make the next-month minimum appear paid, while a payment correctly assigned to the next-month cycle can fail to match. This makes Upcoming settlement status and remaining amount disagree with the selected date.

**Minimal reproduction:** on November 7, view the December debt-minimum row for an account with a December schedule. Record a November payment without a future `appliesToDate`: the December row's matcher also targets November and can count it. Conversely, a payment with `appliesToDate: 2026-12-01` is checked against the row's November cycle key and is missed.

**Narrow fix:** pass the loop variable `month` as `dueCycleMonth`. Confirm both no-date and explicitly assigned payment matching for current and next cycles with a focused synthetic case.

### P2 — Concurrent settings saves can regress the in-memory onboarding snapshot

**Source:** `src/OnboardingAndHome.tsx:420-423`; `src/finance/obligation-editor.ts:81-105`; `App.tsx:354-357`.

The schedule helper correctly handles a settings revision conflict by loading fresh settings, merging the requested schedule into that snapshot, and returning the newer revision. The app's update callback then unconditionally calls `setOnboardingData(next)`. If two settings saves overlap, the later CAS can return revision N+2 and update state first; the slower callback from revision N+1 can then overwrite it. The server retains the latest settings, but current screens/selectors can temporarily lose a newly saved schedule until reload, and can offer stale status in that interval.

**Minimal reproduction:** start two saves from revision N; let save A commit and delay its response, let save B conflict/rebase/commit N+2 and return first, then deliver A's N+1 callback. The current setter stores N+1 without comparing revisions.

**Narrow fix:** apply onboarding updates through a revision-aware functional state update (or serialize settings mutations centrally), rejecting snapshots older than the currently held settings revision while preserving the existing user-identity guard. Ensure the debt fields returned from a successful settings update are also reconciled deliberately rather than blindly replacing newer local debt state.

### P2 — Checking/debit spending transactions are omitted from Budget's purchase summary

**Source:** `src/screens/TransactionsScreen.tsx:23-30`; `src/finance/budget.ts:117-126`; display at `src/screens/BudgetScreen.tsx:592-601`.

Transactions offers both `Single purchase` (`purchase`) and `Debit Spending (Checking)` (`debit_spending`). Budget's recorded-spending summary filters only `category === 'purchase'`. A standalone purchase entered from checking is therefore absent from the month total and item list. The helper does correctly exclude pending/deleted and recurring/bill-linked purchase rows, and recurring commitments/debt-plan commitments remain separately calculated.

**Minimal reproduction:** add a confirmed November transaction categorized `debit_spending`; the Budget `Single purchases` total and list do not change. Add a `purchase` transaction instead; it appears.

**Narrow fix:** include confirmed standalone `debit_spending` rows in the recorded spending view (with an accurate category label), retaining its duplicate/recurring exclusions and not adding it to commitment totals. If product intent is to summarize only credit-account `purchase` rows, label that narrow scope explicitly in the UI and acceptance criteria.

### P2 — Transactions → Scheduled does not render scheduled debt minimums

**Source:** `src/screens/TransactionsScreen.tsx:663-684`; compare debt-minimum schedule rendering in `src/screens/BudgetScreen.tsx:1066-1085`.

The Scheduled branch builds overdue and current/next rows only from `getActiveRecurringBills(recurringBills)`. It receives `debts` and `obligationSchedules`, but never creates debt-minimum rows. A newly scheduled next-month debt minimum appears in Budget Upcoming and Home's reminder logic, but not in Transactions Scheduled. This leaves an obligation view incomplete if Scheduled is intended to cover the shared obligation schedule, including credit-card minimums.

**Narrow fix:** either add cycle-aware debt minimum rows to Scheduled using the same schedule, matching and pending-state helpers, or explicitly constrain and label this tab as recurring bills only and confirm that debt minimums are intentionally excluded. Do not present it as the complete scheduled-obligation view if it remains bills-only.

### P2 — Light appearance leaves the payment-breakdown panel dark with dark secondary copy

**Source:** `src/screens/TransactionsScreen.tsx:595-597, 981-983`; `src/components/NativeAppearance.tsx:31-54, 56-58`.

The final Home/Budget/Transactions imports use the shared wrappers, and `FiveTabShell` places all tabs and the settings overlay under `NativeAppearanceProvider` (`src/FiveTabShell.tsx:64-98`). Text and text inputs consume the stored scaling preference, which is keyed by `userId` in SecureStore (`NativeAppearance.tsx:11-28, 57-58`). However, light-mode color mapping only translates exact known palette tokens. The transaction payment-breakdown panel uses `#212623`, which has no light mapping, while its secondary `#AAB3AD` copy is translated to `#53665B`. The resulting dark text on the unchanged near-black panel is an obvious low-contrast combination in code. The same panel exists in the transaction editor modal.

**Narrow fix:** map `#212623` to a light surface token (or use an appearance-aware token for both background and text). Audit the other newly integrated inline background tokens for the same unmapped dark-surface/light-text mismatch. No visual/device certification was performed.

## Due-date checks that are source-supported

- **New obligation day 1 on day 7:** `initializeObligationSchedule` advances to the next month when the requested day has passed (`src/finance/obligation-schedule.ts:43-53`). Existing focused schedule tests assert November 7 + day 1 gives December 1 (`tests/finance-obligation-schedule.test.mjs:8-12`).
- **Due today:** the prompt offers Yes/No/Cancel and describes Yes as acknowledgement-only (`obligation-editor.ts:115-131`); only draft debts and new bills call it. Yes is stored in `acknowledgedPaidCycles`, without creating a transaction (`obligation-schedule.ts:43-53`). Acknowledgement suppresses only that month; future cycles remain eligible (`:67-80`). Cancel returns before the debt write or bill schedule write in the creation paths. This is correct for genuinely new records, subject to P1's existing-debt transition defect.
- **Stable ID and in-session retry:** both debt flows retain their draft debt ID and leave the editor open if the second settings CAS fails (`OnboardingAndHome.tsx:651-705`; `HomeScreen.tsx:408-455`). New bill creation saves schedule first and reuses the draft bill ID if the bill write fails; bill edits save the row first and keep the form open if the term CAS fails (`BudgetScreen.tsx:349-425`). No restart recovery guarantee is established for the transient debt-row/settings gap.
- **Terms and due-day removal:** term updates append/replace only a future effective term and retain earlier schedule terms (`obligation-schedule.ts:56-65`; `obligation-editor.ts:69-78`). Clearing `dueDay` suppresses future Home/Budget rows, while the shared overdue selector retains existing schedule cycles as genuine history (`HomeScreen.tsx:262-263`; `BudgetScreen.tsx:1066-1069`; `payment-matching.ts:446-458`). Re-adding a due day uses the preserved schedule. This behavior is appropriate when the prior schedule represented an actual obligation, but does not cure P1's falsely backdated initial schedule.
- **Validation/calendar/currency:** strict date parsing, start-date-not-in-past validation, day range validation, month-end clamping, and same-currency schedule term validation are source-enforced (`obligation-schedule.ts:16-35, 43-53`; `recurring-bills.ts:43-55`). Editor dates are derived from the household timezone in Home, onboarding, and Budget. These source checks are not native runtime certification.
- **Upcoming/Scheduled cycle values:** bill rows use the schedule's cycle-specific date and amount in Home, Budget, and Transactions Scheduled. Budget's debt minimum rows use cycle-specific amounts/dates, with the payment-cycle-key defect above. Transactions Scheduled is bills-only as noted above.

## Other product review

- Home strategy background/body, heading, and See all navigate to Budget → Strategy; child Snowball/Avalanche controls remain separate (`HomeScreen.tsx:880-914`). Source wiring is present.
- Debt detail is a 3-tab modal (`Overview`, `Transactions`, `Detail`) with close, backdrop, and native back handling (`DebtScreen.tsx:13, 202-233, 407`). Debt card selection and cross-tab target clearing/reopening are wired through `FiveTabShell` and `HomeScreen` callbacks. Runtime dismissal behavior is not certified here.
- Budget has a month selector and a separate confirmed standalone-spending card; the monthly commitment and category calculations use recurring bills and strategy payments, so the separate purchase card does not double count them (`BudgetScreen.tsx:176-200, 592-601`; `finance/budget.ts:41-111`). Finding above is about omitted checking spending, not duplicate commitments.
- Full restore remains honestly unavailable. Settings labels restore unavailable and disables the action pending a verified authenticated atomic restore service (`SettingsScreen.tsx:1107-1108`; `finance/backup-recovery.ts:203-205`). No state-only successful restore is claimed.
- The prototype preview callback is gated by development mode, valid configuration, and `EXPO_PUBLIC_ENABLE_SANDBOX_PREVIEW === 'true'` before the sign-in screen exposes it (`App.tsx:335, 360`). This confirms the source release gate, not a built-artifact check.
- Theme/Text scaling integration has source coverage but no visual acceptance. The scaling write uses per-user SecureStore and catches write errors silently (`NativeAppearance.tsx:18-28`); a storage failure could leave the current toggle effective but not persistent. Include an observable failure path if persistence is product-critical.

## Deliberate deferrals and evidence limits

Atomic server backup restore and receipt verification remain unavailable; iOS runtime/signing/distribution and native visual/device acceptance remain pending. Bank aggregation, automatic recurring posting/notifications, biometric unlock, household collaboration, production deployment, and store readiness remain outside this review's accepted local scope. No live prototype/production data was accessed or changed. The single focused Node scenario attempt was blocked by React Native's Flow-syntax import; no tests, typecheck, build, device, or backend verification are claimed by this review.

---

## Independent product recheck & verification — 2026-11-07 (T-059-D2)

### Verdict: ACCEPT (Source Implementation)

**Reviewer:** Worker Gemini 3.8 Flash High (Task T-059-D2; Antigravity)  
**Baseline & Target:** Independent read-only source review of the six product remediation findings implemented by T-055-F (`src/finance/obligation-editor-domain.ts`, `src/finance/obligation-editor.ts`, `src/OnboardingAndHome.tsx`, `src/screens/HomeScreen.tsx`, `src/screens/BudgetScreen.tsx`, `src/screens/TransactionsScreen.tsx`, `src/finance/budget.ts`, `src/finance/payment-matching.ts`, `src/onboarding-snapshot.ts`, `App.tsx`, and `src/components/NativeAppearance.tsx`).

All six original findings from this review have been resolved in source. Focused regression suite (`tests/finance-product-remediation.test.mjs`, `tests/finance-obligation-schedule.test.mjs`, `tests/finance-budget.test.mjs`) reports **19/19 passing** with clean TypeScript compilation (`tsc --noEmit`).

### Remediation Status Matrix

| Original Finding | Severity | Remediating Files & Implementation Evidence | Recheck Result |
| :--- | :--- | :--- | :--- |
| **P1: Adding due day to older debt with no prior due day backdates cycles** | P1 | `src/finance/obligation-editor-domain.ts:9-35`; callsites in `OnboardingAndHome.tsx:678-715` and `HomeScreen.tsx:422-455`. Extracted pure `shouldAskPaidToday` and `prepareObligationEditorSchedule`. Initial schedule anchors to today/next eligible cycle when `isNew || legacyDueDay == null`; creation-date history retained only when real prior due day existed. Due-today prompt triggered if `firstDueDate === today`. | **RESOLVED (SOURCE)** |
| **P1: Budget next-month debt-minimum matching against current month** | P1 | `src/screens/BudgetScreen.tsx:1076-1087`. Loop constructs obligation with `dueCycleMonth: month` (using the loop variable instead of hardcoded `currentMonthStr`) and assigns unique React key `${d.id}:${dueDate}`. | **RESOLVED (SOURCE)** |
| **P2: Concurrent settings saves regress in-memory onboarding snapshot** | P2 | `App.tsx:355`; `src/onboarding-snapshot.ts:3-19`. Functional state setter `setOnboardingData(current => acceptOnboardingSnapshot(current, next))` enforces monotonic `settingsRevision`. Preserves newer local debt rows (`serverVersion`) without resurrecting omitted debts (maps strictly over `incoming.debts`). | **RESOLVED (SOURCE)** |
| **P2: Checking/debit spending omitted from Budget purchase summary** | P2 | `src/finance/budget.ts:117-126`; `src/screens/BudgetScreen.tsx:603`. Filters `tx.category === 'purchase' || tx.category === 'debit_spending'`, preserving duplicate/recurring exclusions. Displays category label `"Checking single purchase"` vs `"Single purchase"`. | **RESOLVED (SOURCE)** |
| **P2: Transactions Scheduled does not render scheduled debt minimums** | P2 | `src/finance/payment-matching.ts:510-595`; `src/screens/TransactionsScreen.tsx:655-740`. `getScheduledObligationRows` generates rows for active bills, debt minimums (current/next cycles), and shared overdue obligations. Action button records payment without guessed loan allocations (`principalAmount` undefined). | **RESOLVED (SOURCE)** |
| **P2: Light appearance leaves payment breakdown panel dark** | P2 | `src/components/NativeAppearance.tsx:36`. Mapped `#212623` to `#f3f4f6`, `#302b20` to `#fff3cd`, `#2d2825` to `#fff0eb`, and `#38221e` to `#ffece7`. Combined with mapped secondary text `#AAB3AD` -> `#53665B`, high contrast is restored. | **RESOLVED (SOURCE)** |

### Scope, Gates, and Certification Boundaries

1. **Source Acceptance vs. Runtime Certification:** Source analysis confirms the logic, data flow, invariants, and component wiring. However, physical Android/iOS device execution, layout verification, touch interactions, and hardware back button behavior remain subject to device smoke passes.
2. **Persistence Workstreams Intact:** Financial persistence and journal recovery remain governed by T-054-F/B and T-058-R. No claim is made regarding full persistence completion.
3. **External and Architecture Gates Preserved:**
   - **Atomic Server Backup & Restore:** `BLOCKED` (architectural protocol missing on backend; throwing guard disabled).
   - **Financial Data Reset:** Conditionally disabled pending safety gates and authorized SQL migration.
   - **iOS Runtime & Distribution:** Deferred awaiting physical Apple hardware and certificates.


