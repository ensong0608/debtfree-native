# Current Acceptance Ledger & Remaining Gates — November 7, 2026

> **Document Status:** Historical acceptance snapshot. Current status is maintained in [STATUS_CONSOLIDATED_2026-11-07.md](./STATUS_CONSOLIDATED_2026-11-07.md). The persistence blockers below have since been corrected and locally accepted; atomic restore has an unapplied candidate requiring further review and isolated database acceptance.
> **Prepared By:** Worker Gemini 3.8 Flash High (Task T-061; explicit owner model selection; Antigravity)  
> **Manager:** GPT-6.1 Sol Medium  
> **Repository:** `C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native`  
> **Applicable Directives:** [AGENTS.md](../AGENTS.md), [APP_PLAN.md](../APP_PLAN.md) (Nov 7 Owner Override), [docs/APP_AUDIT_AND_COMPLETION_PLAN_2026-11-07.md](./APP_AUDIT_AND_COMPLETION_PLAN_2026-11-07.md), [docs/REVIEW_PERSISTENCE_REMEDIATION_2026-11-07.md](./REVIEW_PERSISTENCE_REMEDIATION_2026-11-07.md), [docs/REVIEW_PRODUCT_REMEDIATION_2026-11-07.md](./REVIEW_PRODUCT_REMEDIATION_2026-11-07.md).

---

## 1. Executive Summary & Working-Tree Inspection Baseline

This document reconciles the source implementation, remediation handbacks, independent audit objections, and empirical verification evidence across the `debtfree-native` repository as of **November 7, 2026**.

### Inspection State of Concurrent Tasks
1. **T-054-F (Durable Persistence Remediation):** Currently **IN PROGRESS** (`CHANGES REQUIRED` from persistence review [REVIEW_PERSISTENCE_REMEDIATION_2026-11-07.md](./REVIEW_PERSISTENCE_REMEDIATION_2026-11-07.md)). Remediating 6 critical defects: retry rejection overwrite (F1), unversioned bill edit retry (F2), unreachable Settings retry action (F3), Number-based decimal float collapse in readback comparison (F4), silent discard of corrupted legacy pending maps (F5), and post-crash reconciliation resolution gap (F6).
2. **T-058-R (Reachable Pending-Operation Recovery Controls):** Currently **BLOCKED / AWAITING STORAGE APIs**. Settings Backup & Recovery UI implementation is written in `src/screens/SettingsScreen.tsx` but cannot pass TypeScript compilation until T-054-F exports `canRetryPendingFinanceOperation(command)` and `action: 'accept_server_state'`.
3. **T-059-D / T-059-D2 (Independent Product Remediation & Recheck):** **SOURCE ACCEPTED** ([REVIEW_PRODUCT_REMEDIATION_2026-11-07.md](./REVIEW_PRODUCT_REMEDIATION_2026-11-07.md)). T-055-F implemented fixes for all 6 findings (P1 existing debt due-day historical cycle backdating, P1 Budget next-month debt minimum matching, P2 concurrent settings CAS onboarding regression, P2 checking debit spending omission, P2 Transactions Scheduled debt minimums, and P2 unmapped `#212623` light theme contrast). T-059-D2 independent recheck verified source resolution across all 6 items; focused suite passes 19/19 with clean TypeScript compilation. Physical device/runtime certification remains pending.
4. **T-058-T2 (Signed-In Appearance Integration):** **SOURCE INTEGRATED — FINAL REVIEW PENDING**. Shared `NativeAppearanceProvider` and native wrapper primitives (`View`, `Text`, `TextInput`, `Pressable`, `ScrollView`) are wired across `FiveTabShell.tsx`, all five tabs, and `SettingsScreen.tsx`. Per-user dynamic scaling preference is stored in `SecureStore`. Contrast and palette token audit remains open.
5. **Atomic Backup & Restore:** **BLOCKED**. No canonical, owner-scoped atomic multi-domain server snapshot protocol or receipt verification RPC exists on the backend. The throwing migration guard has been moved out of `supabase/migrations/` to [docs/native_backup_restore_BLOCKED.sql.disabled](./native_backup_restore_BLOCKED.sql.disabled). Full restore is explicitly disabled in the UI.
6. **Financial Data Reset:** **BLOCKED / DEFERRED**. The Danger Zone reset button in `SettingsScreen.tsx` is conditionally disabled pending safety gates with a `BLOCKED / DEFERRED` badge and explanatory alert. The atomic reset migration `20261106140000_reset_financial_data_atomic.sql` remains strictly **UNAPPLIED**.
7. **Prototype Demo Entry Guard:** Verified source-gated in `App.tsx` by `__DEV__`, valid mock configuration, and `EXPO_PUBLIC_ENABLE_SANDBOX_PREVIEW === 'true'`.

> [!CAUTION]
> **No Universal Completion or Working-Tree Certification:**  
> The working tree contains uncommitted modifications and untracked files across multiple domains. No claim is made that all features are complete or that the current source has passed native Android or iOS runtime verification. Historical device acceptance (T-046) and database sandbox tests (T-045) from November 6 certify only their bounded snapshots and do not certify today's working tree.

---

## 2. Master Status Ledger

| Domain & Feature | Status | Source & Implementation Evidence | Remaining Acceptance & Objections | Dependencies / Blockers |
| :--- | :--- | :--- | :--- | :--- |
| **Owner Due-Date: Day 1 on Day 7 Rule** | `IMPLEMENTED (SOURCE)` | `initializeObligationSchedule` in `src/finance/obligation-schedule.ts:43-53` advances to 1st of next month when due day < current day. | Verify on device runtime; verify integration across Home and Budget. | None. |
| **Owner Due-Date: Due Today (Yes/No/Cancel)** | `IMPLEMENTED (SOURCE)` | `shouldAskPaidToday` in `src/finance/obligation-editor-domain.ts:8-12` checks first-time tracking due today for new and existing debts; `HomeScreen.tsx:422-432` & `OnboardingAndHome.tsx:680-689` prompt Yes/No/Cancel. Yes acknowledges cycle without ledger transaction. | Verify on device runtime; verify modal lifecycle on physical device. | None. |
| **Owner Due-Date: Schedule History & Terms** | `IMPLEMENTED (SOURCE)` | `prepareObligationEditorSchedule` in `src/finance/obligation-editor-domain.ts:15-35` anchors first-time tracking to today/next cycle; historical terms preserved via `updateObligationSchedule`. | Verify on device runtime. | None. |
| **Budget Next-Month Minimum Matching** | `IMPLEMENTED (SOURCE)` | `BudgetScreen.tsx:1076-1087` builds obligation with `dueCycleMonth: month` (using loop month) and unique key `${d.id}:${dueDate}`. Payments match correct cycle key. | Verify on device runtime. | None. |
| **Single Purchases & Debit Spending** | `IMPLEMENTED (SOURCE)` | `summarizeSinglePurchases` in `src/finance/budget.ts:117-126` filters both `purchase` and `debit_spending` (excluding recurring/bill links); `BudgetScreen.tsx:603` labels checking spending distinctly. | Verify on device runtime. | None. |
| **Product: Home Strategy Navigation** | `IMPLEMENTED (SOURCE)` | `HomeScreen.tsx:880-914` routes card body, header, and "See all" press directly to `Budget → Strategy`. | Device navigation smoke check. | None. |
| **Product: Debt Account 3-Tab Modal** | `IMPLEMENTED (SOURCE)` | `DebtScreen.tsx:13, 202-233, 407` implements modal popup with `Overview`, `Transactions`, and `Detail` tabs. | Dismissal, hardware back button, and sparkline rendering on physical device. | None. |
| **Product: Scheduled Tab Scope** | `IMPLEMENTED (SOURCE)` | `getScheduledObligationRows` in `src/finance/payment-matching.ts:510-595` and `TransactionsScreen.tsx:655-740` renders bills, debt minimums (current/next), and overdues with actionable Record Paid; no guessed loan allocation. | Verify on device runtime. | None. |
| **Settings Concurrent CAS Updates** | `IMPLEMENTED (SOURCE)` | `App.tsx:355` uses functional setter with `acceptOnboardingSnapshot` (`src/onboarding-snapshot.ts`), rejecting older settings revisions, preserving newer local debts by `serverVersion`, and avoiding union resurrection. | Verify on device runtime. | None. |
| **Financial Persistence: Durable Journal** | `CHANGES REQUIRED` | `src/finance/pending-journal.ts` replaces volatile memory maps; logs intent before network call. | **F1 Defect:** Retry rejection overwritten as uncertain. **F4 Defect:** Float collapse in Number decimal readback. | T-054-F persistence remediation. |
| **Financial Persistence: Unversioned Bills** | `CHANGES REQUIRED` | `src/finance-storage.ts:778-780, 195-197` uses unversioned upsert for bills. | **F2 Defect:** Offline bill edit retry can overwrite newer server version without CAS guard. | T-054-F persistence remediation. |
| **Settings Recovery Controls** | `BLOCKED` | `SettingsScreen.tsx:260-264, 1038-1045` lists pending operations and offers confirmed retry and server-state adoption. | **F3 / Compilation Blocker:** TypeScript fails awaiting `canRetryPendingFinanceOperation` and `action: 'accept_server_state'` from storage. | T-054-F storage API export. |
| **Post-Crash Reconciliation Resolution** | `CHANGES REQUIRED` | Grouped command journaled in `pending-journal.ts:227-252` requiring `completeCommandIds`. | **F6 Defect:** Neither automatic load nor Settings readback populates `completeCommandIds`, stranding crash-recovered reconciliation. | T-054-F persistence remediation. |
| **Legacy Pending Map Migration** | `CHANGES REQUIRED` | `finance-storage.ts:98-115` migrates legacy `v1` pending keys to journal. | **F5 Defect:** Corrupt/malformed JSON is caught as empty `{}` and silently deleted instead of quarantined. | T-054-F persistence remediation. |
| **Progress & Milestone Invariants** | `IMPLEMENTED (SOURCE)` | `src/finance/progress.ts` derives activity from signed deltas; rejects unlike currencies; separates adjustments. | Milestones must not award on unconfirmed pending transactions or pure balance corrections. | Runtime verification. |
| **Backup: Full Atomic Restore** | `BLOCKED (ARCHITECTURAL)` | Guard in `docs/native_backup_restore_BLOCKED.sql.disabled`. Restore button disabled in `SettingsScreen.tsx`. | Server protocol missing. Application must refuse to simulate restore via state-only imports. | Backend atomic snapshot protocol. |
| **Backup: Sandbox Export / Import** | `IMPLEMENTED (SOURCE — TEXT ONLY)` | `SettingsScreen.tsx:693-767` provides copy/paste and share of sandbox JSON payload. | Native file picker and named `.json` file filesystem export/import are **NOT IMPLEMENTED**. | Native filesystem file-picker module. |
| **Appearance: Native Theme Wrappers** | `IMPLEMENTED (SOURCE)` | `src/components/NativeAppearance.tsx:36` maps `#212623` to `#f3f4f6` and other tinted dark panels to light equivalents. Wrappers applied to payment breakdown views in `TransactionsScreen.tsx`. | Physical device visual contrast audit. | None. |
| **Appearance: Dynamic Text Scaling** | `IMPLEMENTED (SOURCE)` | Per-user text scaling preference persisted in `SecureStore` via `NativeAppearance.tsx:11-28`. | Verify observable error handling if SecureStore write fails; verify font scaling on physical device. | None. |
| **Security: Financial Data Reset** | `BLOCKED / DEFERRED` | Reset button conditionally disabled pending safety gates with `BLOCKED / DEFERRED` badge in `SettingsScreen.tsx`. Migration unapplied. | Cannot enable until safe, atomic SQL reset protocol is authorized, applied, and verified. | Database authorization gate. |
| **Security: Prototype Preview Gate** | `IMPLEMENTED (SOURCE)` | `App.tsx:335, 360` gates preview entry behind `__DEV__` and `EXPO_PUBLIC_ENABLE_SANDBOX_PREVIEW === 'true'`. | Confirm release build bundles exclude sandbox mock fixtures. | Release build pipeline. |
| **Hardware Biometric Security** | `DEFERRED` | Toggle disabled (`SettingsScreen.tsx`) with explanatory notice; mock alert bypass removed. | Hardware module `expo-local-authentication` not installed in `package.json`. | Native package installation & rebuild. |
| **Background Notifications & AutoPay** | `DEFERRED` | Notification toggles in Settings save user preferences only; caption explains scheduling is deferred. | Background scheduling worker infrastructure not implemented. | Platform background services. |
| **Multi-Member Collaboration** | `DEFERRED` | Household settings displays only authenticated primary user; notice explains collaboration is deferred. | Multi-tenant RLS and household invitation backend not implemented. | Backend service architecture. |
| **Platform: Android Execution** | `SANDBOX HISTORICAL ONLY` | Android APK (`DebtFree-Test.apk`) and Pixel API 36 emulator passed on Nov 6 (T-046). | Working tree contains uncommitted changes not tested on device. | Android build / smoke pass. |
| **Platform: iOS Acceptance** | `DEFERRED` | Codebase is cross-platform React Native / Expo. | Apple Sign In, iOS runtime execution, and physical provisioning deferred awaiting iOS device. | Physical Apple hardware & certs. |
| **Release & Operational Gates** | `EXTERNAL GATES` | Production URLs, legal docs, store metadata, and release signing keys documented as pending. | Production configuration, keystore management, legal review, and app store submissions outstanding. | Product Owner / Release Manager. |

---

## 3. Detailed Architectural & Evidence Analysis

### 3.1 Owner Due-Date & Product Interaction Decisions
The owner-approved directives in [APP_PLAN.md](../APP_PLAN.md) (Nov 7) establish exact behavioral invariants:
1. **Forward-Only Due Tracking:** New obligations start today or later. If a due day has already passed in the current calendar month (e.g., entered due day 1 on calendar day 7), the first due cycle advances to the 1st of next month (`YYYY-(MM+1)-01`).
2. **Due-Today Acknowledgement Gate:** If a new obligation falls due today, the app presents an explicit three-way prompt:
   - **Yes (Already Paid):** Acknowledges that today's cycle was satisfied. Records cycle token into `acknowledgedPaidCycles` in the obligation schedule. It does **NOT** invent a transaction in the ledger, does **NOT** deduct cash, and does **NOT** modify debt balances. It suppresses upcoming reminders for the current cycle.
   - **No (Unpaid):** Treats today's obligation as active and unpaid. It appears immediately in Home Upcoming and Budget Upcoming.
   - **Cancel:** Aborts the creation modal without saving the debt or recurring bill.
3. **Historical Term Immutability:** Changing an obligation's amount or due day appends a new term effective on a future date. It never retroactively alters past billing cycles.
4. **Product Defect Remediation & Verification (T-055-F / T-059-D2):**
   - **Existing Debt Schedule Backdating (P1):** Resolved in `src/finance/obligation-editor-domain.ts`. Adding a due day to an existing debt that had none anchors schedule initialization to today/next cycle. When due today, `shouldAskPaidToday` prompts Yes/No/Cancel for both new and existing debts.
   - **Budget Cycle Key Misattribution (P1):** Resolved in `BudgetScreen.tsx:1076-1087`. Loop sets `dueCycleMonth: month` (cycle-specific loop variable) and unique key `${d.id}:${dueDate}`.
   - **Checking / Debit Spending Omission (P2):** Resolved in `src/finance/budget.ts:117-126` and `BudgetScreen.tsx:603`. Filters both `purchase` and `debit_spending` without recurring double-counting.
   - **Transactions Scheduled Debt Minimums (P2):** Resolved in `src/finance/payment-matching.ts:510-595` and `TransactionsScreen.tsx:655-740`. `getScheduledObligationRows` combines bills, debt minimums, and overdues. Records payment with `amount: match.remainingAmount`, `date: todayStr`, `appliesToDate: due`, and no guessed loan allocation.
   - **Concurrent Settings CAS State Regression (P2):** Resolved in `App.tsx:355` and `src/onboarding-snapshot.ts`. Monotonic `settingsRevision` guard rejects stale CAS callbacks; reconciles newer debt rows by `serverVersion` without union resurrection.

### 3.2 Financial Persistence, Journaling & Concurrency
The persistence subsystem has evolved from memory overlays to a durable transaction log ([src/finance/pending-journal.ts](../src/finance/pending-journal.ts)), but remains under active remediation (T-054-F):
1. **Crash & Dispatch Lifecycle:** Mutations are journaled to encrypted storage before network dispatch (`withFinanceLock`). Online commands mark `dispatched`; offline commands mark `not_dispatched`.
2. **Persistence Objections Under Remediation (from T-059-P):**
   - **F1 (Retry Rejection Overwrite):** If a retried command receives a definitive server error (e.g., check constraint violation `23514`), the catch block erroneously replaces the rejected state with `{ kind: 'uncertain' }`, keeping it in active counts.
   - **F2 (Unversioned Bill Retry):** Bill updates use `upsert` without optimistic concurrency (`expectedVersions: {}`), creating lost-update vulnerabilities if another device modified the bill while offline.
   - **F3 / T-058-R Blocker (Reachable Recovery Controls):** Recovery UI in `SettingsScreen.tsx` is written but blocked on T-054-F exporting `canRetryPendingFinanceOperation` and `action: 'accept_server_state'`.
   - **F4 (Decimal Float Collapse):** Comparing `Number(amount)` in readback causes valid 4-decimal currency values (CLF) near the safe-integer boundary to collapse into false equality.
   - **F5 (Legacy Map Discard):** Parse failures on legacy `v1` pending maps silently replace data with empty `{}` and delete the storage key.
   - **F6 (Grouped Reconciliation Resolution):** Grouped commands require `completeCommandIds` which normal readback never supplies, stranding post-crash reconciliation commands.

### 3.3 Backup, Restore & Data Isolation
1. **Full Atomic Restore Blocked:** Full server-side snapshot restoration is blocked because PostgreSQL lacks an atomic, cross-domain snapshot protocol that validates user ownership, checks CAS settings revisions, updates debt balances, revives/deletes rows, and stores an idempotency receipt within a single ACID transaction.
2. **Disabled Migration Guard:** The failing guard `20261107120000_native_backup_restore_BLOCKED.sql` was safely removed from active database migrations and preserved at [docs/native_backup_restore_BLOCKED.sql.disabled](./native_backup_restore_BLOCKED.sql.disabled).
3. **Export / Import Constraints:** Sandbox export/import in `SettingsScreen.tsx` operates solely via textual JSON clipboard copy/paste and system text share. **No native filesystem file picker or named `.json` file download/upload is implemented.**

### 3.4 Appearance & Dynamic Text
1. **Native Appearance Integration:** `NativeAppearanceProvider` in [src/components/NativeAppearance.tsx](../src/components/NativeAppearance.tsx) wraps `FiveTabShell.tsx`.
2. **Text Scaling:** Font scaling preference (`Default`, `Medium (+15%)`, `Large (+30%)`) is read from and written to `SecureStore` keyed per user.
3. **Contrast Defect (P2) Resolved:** In `src/components/NativeAppearance.tsx:36`, `#212623` is mapped to `#f3f4f6`, `#302b20` to `#fff3cd`, `#2d2825` to `#fff0eb`, and `#38221e` to `#ffece7`. Combined with mapped text `#AAB3AD` -> `#53665B`, light mode contrast is cleanly readable.

### 3.5 Security, Reset & Release Guards
1. **Financial Reset Gate:** Resetting financial data is conditionally disabled pending safety gates. The button in `SettingsScreen.tsx` displays `BLOCKED / DEFERRED` with an explanatory modal. Migration `20261106140000_reset_financial_data_atomic.sql` remains strictly unapplied.
2. **Prototype Demo Gate:** The prototype preview entry in `App.tsx:335, 360` is gated by `__DEV__ && EXPO_PUBLIC_ENABLE_SANDBOX_PREVIEW === 'true'`.
3. **Biometrics & Notifications:** Biometrics are disabled (`expo-local-authentication` not present). Notifications are preference-only without a background worker.

---

## 4. Verification & Evidence Register

| Verification Scope | Check / Command Executed | Reported Pass / Evidence | Environment / Constraints | Date |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 1 Financial Integrity** | `tests/finance-phase1.test.mjs` | **8/8 passed** | Node direct test runner | 2026-11-06 (T-043) |
| **Phase 1 Sandbox SQL** | Supabase SQL transaction script | **14 synthetic checks passed** | Sandbox DB `bitepxsdujceoszbldhd` | 2026-11-06 (T-045) |
| **Phase 1 Android Smoke** | `agent-device open` / launch | **5/5 tabs smoke-tested** | `DebtFree_Pixel_API_36` (`emulator-5554`) | 2026-11-06 (T-046) |
| **Phase 2 Calculations** | `tests/finance-phase2.test.mjs` | **16/16 passed** | Node direct test runner | 2026-11-06 (T-047) |
| **Audit Verification Suite** | `npm test` (full suite at Nov 6) | **126/126 passed** (12 suites) | Local Node test runner | 2026-11-06 (DFN-FINAL) |
| **TypeScript (T-058-T2)** | `npm run typecheck` (`tsc --noEmit`) | **0 errors** (post-T-058-T2) | Local TypeScript compiler | 2026-11-07 (T-058-T2) |
| **Persistence Review Repro** | In-memory `createPendingJournal` | **Reproduced F4 float collapse** | Isolated in-memory script | 2026-11-07 (T-059-P) |
| **Product Review Analysis** | Source tracing (`obligation-editor.ts`) | **Confirmed P1 due-date defects** | Flow syntax prevented direct Node run | 2026-11-07 (T-059-D) |
| **Product Remediation Recheck (T-059-D2)** | `tests/finance-product-remediation.test.mjs`, `finance-obligation-schedule.test.mjs`, `finance-budget.test.mjs` | **19/19 passed**, `tsc --noEmit` clean | Node direct test runner / TypeScript | 2026-11-07 (T-059-D2) |
| **T-061 Working-Tree State** | `git status` inspection | **29 modified, 16 untracked files** | Local shared workspace | 2026-11-07 (T-061) |

> [!NOTE]
> The test counts above represent distinct targeted suites run at specific checkpoints. They must **not** be aggregated into a single cumulative total, nor do they imply that the current uncommitted working tree passes all checks simultaneously.

---

## 5. Final Acceptance Checklist: Exact Owner Scenarios

Before any release candidate can be certified, the following concrete scenarios must be executed and verified against real runtime behavior:

### Group A: Owner Due-Date & Obligation Scenarios
- [ ] **Scenario D1 (Day 1 on Day 7):** On calendar day 7 (e.g., Nov 7), create a new debt with due day 1.  
  *Expected:* Schedule initializes with first due date on the 1st of next month (e.g., Dec 1). No overdue or upcoming reminder is generated for the current month.
- [ ] **Scenario D2 (Due Today — Prompt "Yes"):** On calendar day 7, create a new obligation with due day 7. Prompt appears: *"Due today: Is this cycle already paid?"* Select **Yes**.  
  *Expected:* Obligation is saved. Current cycle is recorded in `acknowledgedPaidCycles`. **No** ledger transaction is created, **no** cash balance changes, and **no** upcoming reminder appears for today. Future cycles remain active.
- [ ] **Scenario D3 (Due Today — Prompt "No"):** On calendar day 7, create a new obligation with due day 7. At prompt, select **No**.  
  *Expected:* Obligation is saved. Today's cycle appears immediately in Home Upcoming reminders and Budget Upcoming as due today.
- [ ] **Scenario D4 (Due Today — Prompt "Cancel"):** On calendar day 7, enter due day 7 and click save. At prompt, select **Cancel**.  
  *Expected:* Form returns to editor. No debt, recurring bill, or schedule record is created.
- [ ] **Scenario D5 (Existing Debt Due-Day Transition):** Edit an existing debt created months ago with no prior due day (`dueDay: null`). Assign due day 1.  
  *Expected:* First schedule term starts on the 1st of next month. **No historical overdue cycles** are created for months between debt creation and today.
- [ ] **Scenario D6 (Budget Next-Month Minimum Matching):** View Budget screen with active debt minimums in current month (Nov) and next month (Dec). Record a payment for November.  
  *Expected:* November minimum marks satisfied. December minimum remains unsatisfied. Recording an advance payment with `appliesToDate` for December satisfies December without corrupting November.
- [ ] **Scenario D7 (Repeated Term Edits):** Edit an existing debt to change minimum payment from \$100 to \$150 effective next month.  
  *Expected:* Prior schedule terms remain unchanged. Historical activity reports continue using historical terms.
- [ ] **Scenario D8 (Timezone & Month-End Clamping):** Create an obligation with due day 31 in a household set to America/New_York.  
  *Expected:* In February, due date resolves to Feb 28 (or Feb 29 in leap years). In April, resolves to Apr 30. No rollover into the following month.
- [ ] **Scenario D9 (App Relaunch & Reload):** Force-quit and relaunch the app after acknowledging a due-today cycle.  
  *Expected:* Schedule and acknowledgement persist from storage. No phantom upcoming reminders appear on boot.

### Group B: Financial Persistence & Recovery Scenarios
- [ ] **Scenario R1 (Lost Network Response):** Dispatch a transaction creation while connected, but sever connection before server response arrives.  
  *Expected:* Command transitions to `dispatched` / `uncertain`. App does **not** blindly replay write on restart. Transaction displays `Pending Confirmation` badge.
- [ ] **Scenario R2 (Never-Dispatched Offline Retry):** Create a transaction while fully offline (`dispatchState: 'not_dispatched'`). Reconnect to network, navigate to Settings → Backup & Recovery, and press **Retry**.  
  *Expected:* Command dispatches with its stable idempotency key, receives server confirmation, removes journal entry, and clears pending badge.
- [ ] **Scenario R3 (Safe Bill Edit Concurrency):** Edit a recurring bill offline. Meanwhile, update the same bill on the server from another session. Reconnect the first device.  
  *Expected:* Unversioned bill upsert does **not** silently overwrite the server version. Operation is flagged as `needs_review` / conflict.
- [ ] **Scenario R4 (High-Precision 4-Decimal Currency):** Record and sync an uncertain transaction in CLF (scale 4) with amount `900000000000.0003`. Readback observes `900000000000.0002`.  
  *Expected:* Exact decimal string comparison detects mismatch; command is **not** falsely confirmed.
- [ ] **Scenario R5 (Legacy Storage Quarantine):** Inject malformed JSON into `debtfree-pending-txs-v1.<user>`. Initialize app.  
  *Expected:* Malformed key is quarantined in storage. Error is reported in Settings; data is **not** silently discarded.
- [ ] **Scenario R6 (Grouped Reconciliation Recovery):** Execute an atomic reconciliation and simulate crash immediately after SQL commit. Reload app.  
  *Expected:* Recovery UI offers confirmed manual server-state adoption without stranding the reconciliation or splitting component rows.

### Group C: Appearance & Theme Scenarios
- [ ] **Scenario T1 (All-Tab Light/Dark Switching):** Toggle appearance between Dark, Light, and System in Settings.  
  *Expected:* All 5 tabs (Home, Debt, Transactions, Budget, Progress) and modal popups immediately adapt.
- [ ] **Scenario T2 (Palette Contrast Audit):** In Light mode, inspect Transactions payment-breakdown panel and transaction edit modal.  
  *Expected:* Background token maps to a clean light surface; text remains high-contrast and legible.
- [ ] **Scenario T3 (Dynamic Text Scaling Persistence):** Set Text Scaling to `Large (+30%)`. Restart the application.  
  *Expected:* Text scaling preference is read from SecureStore on launch and applied across all screens and inputs.

### Group D: Security, Reset & Release Guards
- [ ] **Scenario G1 (Full Restore Disabled):** Navigate to Settings → Backup & Recovery.  
  *Expected:* "Restore Snapshot" button is visually disabled with subtitle stating atomic backend restore service is unavailable.
- [ ] **Scenario G2 (Danger Zone Reset Locked):** In Settings, attempt to click "Reset All Financial Data".  
  *Expected:* Button is disabled with `BLOCKED / DEFERRED` badge. No SQL mutation or API request is sent.
- [ ] **Scenario G3 (Prototype Preview Release Gating):** Build app with `__DEV__ = false` and `EXPO_PUBLIC_ENABLE_SANDBOX_PREVIEW = 'false'`.  
  *Expected:* Welcome and Sign-In screens contain zero demo/sandbox entry buttons.
- [ ] **Scenario G4 (Deferred Services Honesty):** Verify Biometrics, Notifications, and Household Collaboration settings.  
  *Expected:* Biometrics toggle is disabled; Notifications indicate preference-only; Household displays single user.

---

## 6. Document Closeout & Management Handoff

- **Ownership Boundary:** Worker Gemini 3.8 Flash High owns only this document ([docs/CURRENT_ACCEPTANCE_LEDGER_2026-11-07.md](./CURRENT_ACCEPTANCE_LEDGER_2026-11-07.md)) and its narrow tracker entry in [TRACKER.md](../TRACKER.md).
- **No Direct Source Mutations:** No application source code, test suites, or SQL migrations were modified.
- **Handoff:** Submitted to Development Manager (`GPT-6.1 Sol Medium`) for review and scheduling of dependent remediation tasks (T-054-F, T-058-R, and T-059-D).
> **Superseded status snapshot:** For current task status and completion gates, use [STATUS_CONSOLIDATED_2026-11-07.md](./STATUS_CONSOLIDATED_2026-11-07.md). Persistence corrections and their final 34/34 checks are accepted locally; the storage API blocker below is resolved. Restore now has an unapplied SQL candidate requiring correction/review and isolated execution, rather than no design or SQL. The prior sections below preserve historical findings and acceptance scenarios; their present-tense task labels are not current.

