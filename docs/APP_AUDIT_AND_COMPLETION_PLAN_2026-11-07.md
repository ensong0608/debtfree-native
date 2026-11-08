# App audit and completion plan — November 7, 2026

## Verdict and evidence

The app is a substantial Android sandbox implementation, with all five main tabs and a shared financial foundation. It is not feature-complete or ready for public release. Completed implementation tasks and previous device acceptance do not close the current source findings, deliberate feature deferrals, or platform and release gates.

GPT-6.1 Terra Medium audited product/interaction completeness (T-050) and finance/persistence/security (T-051). GPT-6 Luna Max audited delivery readiness and tracker reconciliation (T-052). GPT-6.1 Sol Medium reviewed the reports against source and returned incomplete findings for follow-up. All three audit assignments are complete and manager reviewed. Their findings remain open; no remediation was implemented.

Scope: current local source, plans, migration files, historical acceptance records and repository state. No tests, builds, device sessions, live-service inspection, migrations, external tracker updates, or application changes occurred. This report gives no new runtime, deployment, numerical-validation or security certification. Existing uncommitted work was preserved.

Supporting reports:

- [Product and interactions](./AUDIT_PRODUCT_2026-11-07.md)
- [Finance, persistence and security](./AUDIT_FINANCE_2026-11-07.md)
- [Readiness and tracker reconciliation](./AUDIT_READINESS_2026-11-07.md)

## Current app status

| Area | Established implementation / prior evidence | Remaining work |
| --- | --- | --- |
| Auth and onboarding | Sign-in, onboarding and session handling; historical Android acceptance | iOS/Apple acceptance deferred; signed-out prototype preview lacks a release guard |
| Home | Estimate, category snapshot, strategy controls, activity and conditional reminders | Strategy card body has no navigation; snapshot exposes Home/mortgages against the later exclusion decision |
| Debt | Account list, filters, search, editing, transactions and reconciliation | Details replace the list rather than opening the required three-tab popup; third tab label differs |
| Transactions | Manual entry/edit/delete, History and Scheduled, shared bill settlement | Complete bank/checking/savings coverage is not established; offline resolution and concurrent persistence need work |
| Budget | Income, recurring bills, category expansion/editing, Upcoming and payoff schedules | One-time spending absent from monthly calculations; plan month picker and general spending editing incomplete |
| Progress | Recorded-activity periods, utilization and milestones | Snapshot-derived paid-down claims and milestones can confuse balance corrections with repayment achievements |
| Settings | Saved preferences, timezone/currency controls, strategy and sign-out | Light/System theme only partial; text-scaling toggle has no consuming implementation; backup/recovery incomplete; other capabilities explicitly deferred |
| Delivery | Historical Android sandbox and synthetic database acceptance | No accepted iOS release, production configuration, production signing or complete store/operational readiness |

The current entry path is OnboardingAndHome → HomeScreen → FiveTabShell. Strategy schedule expansion is present in source. Home reminders already include approved past-due carryover; that behavior must be retained while correcting the obligation engine.

## Highest-priority findings

1. **Financial recovery is incomplete.** Unresolved transaction changes remain local; reload reconciles matching transaction readback but does not safely submit unresolved commands. Pending bills and anchors are overlaid without equivalent resolution. Sign-out checks pending transactions only. Pending-map read/modify/write operations have no common serialization across mutation paths. See finance report F1/F5 and `src/finance-storage.ts:119`, `:219`, `:276`, `:622`, `:810`.
2. **Overdue obligations can predate the record.** The selector starts at creation month rather than an effective first due date. A bill entered on November 20 with due day 5 can produce a November 5 overdue item. Historical cycles use current amounts/minimums. See finance report F2 and `src/finance/payment-matching.ts:353`, `:392`, `:440`.
3. **Some progress claims overstate evidence.** Current/original balance comparisons can reflect corrections, yet the screen says “paid down”; milestone calculations also use zero balances without verified payoff events. See finance report F3 and `src/screens/ProgressScreen.tsx:80`, `:107`, `src/finance/progress.ts:331`.
4. **Reset protection needs database reconciliation.** A legacy authenticated debt-only reset remains in local migration source and client fallback. It can detach history if available in a deployed database. The newer atomic reset does not revoke that old function and is explicitly unapplied. This audit did not establish deployed privileges. See finance report F4 and `supabase/migrations/20261106130000_phase1_rpc_only_financial_writes.sql:155`, `src/onboarding-storage.ts:456`.
5. **Demo entry must be isolated before public release.** App.tsx passes the prototype-preview callback without a release guard and welcome/sign-in screens expose it. This enters a local demo without sign-in; it is not evidence of access to another user's authenticated records. Demo isolation, fixture provenance and release exclusion need explicit acceptance. See readiness report and `App.tsx:335`, `:360`.
6. **Full recovery is not delivered.** Developer export includes onboarding, transactions, bills and anchors, but ordinary import only updates onboarding state; prototype import seeds fixtures and updates converted state rather than restoring the imported persistent snapshot. User-facing recovery checkpoints are absent. See readiness report and `src/screens/SettingsScreen.tsx:693`, `:750`, `:767`.

Review qualifications: normal transaction deletion supplies a soft-deleted pending row (`src/finance/finance-commands.ts:438`), and readback compares deleted-state presence (`src/finance/storage-domain.ts:96`). The suspected unchanged-row false confirmation was rejected after tracing the caller. The unused period payoff-count calculation and unused reconciled-balance net-change selector are latent defects, not established visible-screen failures. Do not present them as observed data loss or active UI errors.

## Proposed implementation sequence — not dispatched

These are proposed work packages, not implementation authorization or completed tasks. The recommended first milestone is a reliable manual-entry Android candidate. Bank connection, billing and collaboration can remain explicit later scope; public release and iOS remain separate milestones.

| Proposed task | Scope / owner | Acceptance and dependencies |
| --- | --- | --- |
| T-053: Candidate and scope baseline | Manager; identify intended existing changes, exact candidate commit and supported manual-entry scope | Preserve all work; create one current acceptance ledger; explicitly classify every feature as included, deferred or verification pending. No percentage-complete estimate without a stable denominator. |
| T-054: Durable financial recovery | Terra Medium; pending command model, serialization, readback/conflict handling and user recovery | Offline restart, lost response, concurrent mutations, rejection and sign-out cover transactions, bills and reconciliation. Stable command IDs and revision checks prevent duplicate financial application. Never blindly replay uncertain writes. |
| T-055: Obligation and progress truth | Terra Medium; first effective due date/term history and evidence-based progress labels/events | No obligation before valid start; changed terms do not rewrite prior cycles. Manual corrections do not unlock repayment achievements. Recorded cash, principal, balance change and history coverage remain distinct. Retain approved past-due reminders. |
| T-056: Reset and SQL surface | Terra Medium with manager review; authorized isolated database inventory and migration proposal | Inventory actual grants/functions and dependencies; safely retire or replace debt-only reset. Verify atomicity, ownership, rollback and revision conflicts using synthetic data. No live or production mutations; reset stays disabled until its prerequisites pass. |
| T-057: Required interactions and budget | Terra Medium; Home navigation/categories, Debt popup, one-time spending, month selection and spending editor | Card and See all reach Budget Strategy; Overview/Transactions/Detail popup dismisses correctly; mortgage exclusion applies; recurring/one-time items reconcile by chosen month with debt plan and no duplicate counting. Preserve existing inline strategy controls and schedule expansion. |
| T-058: Settings and recovery | Terra Medium; full-domain export/restore/checkpoints, consistent theme/text behavior and release demo isolation | Export/import roundtrip restores intended persistent domains with user/household validation; checkpoint recovery is explicit; visible controls have the described effect. Demo fixtures cannot enter normal release accounts. Clearly defer unavailable capabilities. |
| T-059: Candidate acceptance and visual closeout | Luna Max evidence review plus supported-device acceptance; manager verifies results | Run only checks needed for changed behavior, then controlled end-to-end acceptance on the exact candidate/artifacts. Cover empty/partial/pending data, account switching, month/zone boundaries, accessibility, keyboard/back/dismiss and affected mandatory flows. Close T-036 only with visual evidence. iOS acceptance requires the relevant environment. |
| T-060: Public release preparation | Manager plus scoped implementation owners | Production identity/configuration, protected Android signing, iOS provisioning/build, legal/support content, deletion/export and operational procedures, store materials and supported-country scope have explicit owners and evidence. Apply no migration or publication merely because it is listed here. |

Recommended ordering: T-053 → T-054/T-055 → T-056 → T-057/T-058 → T-059 → T-060. Financial persistence and display truth take priority over cosmetic refinement. Independent work may run in parallel only with clear ownership; shared storage/schema changes require coordinated sequencing. Each agent handback gets manager review, and material omissions return to the responsible agent before closure.

## Explicit deferrals and unresolved gates

- Bank aggregation and complete imported household transaction coverage.
- Premium billing/entitlements and purchase restoration.
- Background notification delivery and automatic recurring posting infrastructure.
- Hardware-backed biometric unlock and safe reset enablement.
- Multi-member household access/roles and collaboration.
- iOS/Apple sign-in runtime, signing and distribution acceptance.
- Production legal/help destinations, backend operations, production identity/signing and store delivery.

These may be deliberately excluded from an agreed initial release. They must not be represented as shipped capabilities. The absence of a generated iOS directory or an EAS configuration alone does not prove iOS is impossible; the relevant gap is missing build/signing/runtime acceptance.

## Tracker reconciliation and completion definition

T-014's original Android navigation blocker and T-044's original Phase 1 sandbox authorization blocker are superseded by later T-045/T-046 records for their bounded scopes. The current reset migration remains intentionally unapplied. T-036 visual polish lacks explicit closeout. Historical all-interaction acceptance conflicts with present source mismatches; retain the old evidence as history and require acceptance of the corrected candidate. Do not infer when a mismatch was introduced.

Existing historical checks and owner acceptance remain useful but do not verify the exact current working tree, which contains many modified and untracked files. A local APK is not evidence of production signing or reproducibility.

“Done” should mean: all features in the selected release scope have source implementation and documented acceptance; financial recovery and display invariants pass targeted scenarios; affected interactions pass on supported devices; deferred capabilities are clear; and release-specific service, security and operational gates have evidence for the exact shipped candidate. The app does not yet meet that definition.
