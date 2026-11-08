# DebtFree: five-tab scope and worker plan

## Owner-approved Budget and pairing corrections (2026-11-07)

- Restore the Home debt-free estimate hierarchy (title, subtitle, estimate badge, date, months remaining, divider, and progress) and remove only the unwanted entered-debts wording.
- Remove the standalone spending card. Keep month navigation with the Monthly Budget Breakdown; place recorded single purchases in that breakdown as a separate actual-spending row. Hide categories with no source records, even if their computed amount is zero.
- Edit primary and additional income from a dedicated Budget popup; do not route to onboarding. Add/edit debt from a real modal. Use one shared, theme-aware bottom-sheet frame for Budget income, recurring-bill, and debt forms.
- Mortgage/auto loan to debit recurring-bill links are explicit, persistent, user-confirmed settings. Suggestions never auto-link. Support manual link/unlink, mark-separate, and dismiss choices; surface unresolved reviews on Home. A link changes only commitment/reminder grouping: it does not create ledger rows, alter a payment, or change a balance. One bill reminder represents the shared monthly cycle; an existing linked account payment can satisfy that cycle by month. For auto loans, the recurring bill replaces the minimum inside the shared payoff-plan commitment total; mortgage projections remain standalone and the linked recurring bill is their budget commitment. Account terms stay unchanged, and escrow/principal components are never inferred.
- Persist link and income edits through the existing revision-checked settings save path. This local change does not authorize live prototype or production mutation, app builds, or device work.

## Owner-approved remediation update (2026-11-07)

The owner authorized local implementation of the reviewed audit plan in `docs/APP_AUDIT_AND_COMPLETION_PLAN_2026-11-07.md`, with these overriding decisions:

- New debt and bill tracking starts today or later. A due day already passed in the household's current month starts next month. A new obligation due today asks whether this cycle was already paid; Yes records a cycle acknowledgement without inventing a ledger transaction or changing the debt balance. The acknowledged cycle does not generate an upcoming reminder.
- Persist first-due dates and effective monthly terms; edits must not rewrite prior obligations. Home, Budget Upcoming, Transactions Scheduled and payment matching must consume the same schedule.
- Separate one-time budget entries are no longer required. Single purchases belong in Transactions and can be summarized by category/month in Budget as recorded spending, separately from recurring and debt-plan commitments, without double counting.
- GPT-6.1 Terra Medium and GPT-6 Luna Max are approved workers for this work. Every handback needs manager review and corrective follow-up before acceptance.

Current assignments and evidence are in `TRACKER.md`. Historical completion labels below remain historical. Full atomic backup restore is blocked on a safe server protocol and isolated verification; the application must not simulate successful restoration through state-only imports. Live prototype/production mutations and public publication are outside this local implementation work. Existing iOS, signing, production-service and store gates remain explicit.

## Financial foundation planning update (2026-11-04)

Read [NATIVE_FINANCIAL_PLAN.md](./NATIVE_FINANCIAL_PLAN.md) before assigning financial implementation. The user clarified that the prototype is a reference, not a rule; its calculations and the existing calculation guide require independent evaluation. The new plan records observed risks, decisions, shared contracts, proposed task dependencies and targeted acceptance scenarios. It supersedes earlier recommendations to copy prototype formulas automatically. This update authorizes no implementation, worker dispatch, bank integration or schema change.

Recorded: 2026-11-03. Execution: next working session (tomorrow, as requested).
Resumed: 2026-11-04 at the user's request. Icon choice: **Option B — Confident Solid / Sculpted Silhouette**, as shown in design/icon-directions.html. Apply this family to the native app; the palette is still undecided.
Manager: GPT-6.1 Sol High. Status and assignments: [TRACKER.md](./TRACKER.md).

## Confirmed product direction

Local visual reference: [prototype screenshot index](./references/prototype/README.md), containing 16 signed-in Brave screenshots captured on 2026-11-04.
Mathematical & architectural reference: [prototype calculations guide](./references/PROTOTYPE_CALCULATIONS.md), detailing the amortization engine, priority ordering, minimum payment formulas, and ledger/milestone logic from [github.com/ensong0608/debtfree-dashboard](https://github.com/ensong0608/debtfree-dashboard). Cloned locally at `references/prototype-repo/` (git-ignored). Use these alongside the requirements below; the prototype colors and icons do not override the user's native design decisions.


Bottom navigation, in this exact order: **Home -> Debt -> Transactions -> Budget -> Progress**.

The prototype at https://debtfree-dashboard.ensong0608.workers.dev/ is a functional reference. Its color scheme is not an approved native-app design. The user will specify visual preferences and dislikes later. This scope is a foundation, not an exhaustive specification. Other prototype features are not automatically requirements.

| Tab | User-confirmed purpose and content |
| --- | --- |
| Home | Payoff strategy summary, recent activity, upcoming bills, and estimated debt-free date based on the strategy. Also intended to accommodate promotions, brand partnerships, offerings, and other future content. |
| Debt | All debt accounts: cards and personal loans, home, and auto. |
| Transactions | All household account activity, including checking/savings, everyday purchases, and debt accounts, with appropriate labels/categories. Sources remain to be established. |
| Budget | Income, recurring spending, one-time spending, and strategy-based debt-payment totals. Display amounts entered by the user; do not invent an additional planned/actual split. |
| Progress | Debt paid down, payments made, and accounts paid off for the current month, previous month, and lifetime. Historical sources remain to be established. |

## Existing starting point

README.md describes existing sign-in, sign-up, onboarding, and Home functionality. Relevant files include App.tsx, src/OnboardingAndHome.tsx, src/onboarding-domain.ts, and src/onboarding-storage.ts. Existing working-tree edits must be preserved. This is a documentation/file-inventory baseline, not a fresh verification of app behavior.

## Worker sequence

Proposed implementation worker: GPT-6.1 Terra High. Assignments and exact file boundaries must be finalized before dispatch; no workers are started by this plan.

### T-003: Map existing behavior and shared data needs

- Read existing implementation and map reuse/gaps for debts, household transactions, income, spending, bills, payoff strategy, and historical statistics.
- Propose shared data contracts and identify missing capabilities and product decisions before dependent implementation. Do not invent financial rules.
- Targets: APP_PLAN.md and TRACKER.md; read App.tsx and relevant src files.
- Acceptance: each tab maps to existing or missing data; dependencies, proposed target files, and decisions are documented.

### T-004: Five-tab app shell

- Depends on T-003. Add the five tabs in the confirmed order after the existing authenticated/onboarded entry flow.
- Use current styling provisionally, with visual choices easy to revise later.
- Proposed targets: App.tsx, src/OnboardingAndHome.tsx, and a dedicated navigation/screen module if needed; confirm after T-003.
- Acceptance: all five tabs are reachable and the existing entry flows remain connected.

### T-005: Debt

- Depends on T-003 and T-004. Present debt accounts covering cards/personal loans, home, and auto; reuse existing account and payoff logic where applicable.
- Targets: Debt screen and shared account modules identified in T-003.
- Acceptance: the agreed categories and account information render from the agreed source, with honest empty/unavailable states.

### T-006: Transactions

- Depends on T-003 and T-004, plus agreement on household account coverage and sources.
- Present household transactions using the agreed data contract and scope.
- Targets: Transactions screen and shared transaction modules identified in T-003.
- Acceptance: supported household transactions appear consistently; unavailable sources/history are explicit. Bank integration and transaction-entry workflows require separate scope.

### T-007: Budget

- Depends on T-003 and T-004, plus agreed spending and strategy data.
- Show income, recurring spending, one-time spending, and strategy-based debt-payment totals.
- Targets: Budget screen and shared calculation modules identified in T-003.
- Acceptance: all four components are distinct, totals reconcile to source records, and debt payments agree with the selected strategy. Settle planned versus actual treatment before dependent calculations.

### T-008: Progress

- Depends on T-003 and T-004, plus agreed metrics and historical data.
- Create an encouraging household statistics view for current month, previous month, and lifetime.
- Targets: Progress screen and shared historical summary modules identified in T-003.
- Acceptance: all three periods are available, approved statistics use consistent period definitions, and missing history is not replaced with invented progress.

### T-009: Home

- Depends on the shared data from T-003 and relevant Debt, Transactions, and Budget work.
- Compose strategy summary, recent activity, upcoming bills, and the strategy-derived debt-free date from the same sources used by the detailed screens.
- Accommodate future promotions/partnerships/offerings in the layout plan. Commercial content must be supplied and scoped before implementation; do not invent brands or offers.
- Targets: Home screen and shared summary modules identified in T-003.
- Acceptance: the four core summaries agree with the underlying screens and strategy; unavailable data/estimates have honest states.

### T-010: Manager review and closeout

- Owner: GPT-6.1 Sol High. Depends on T-004 through T-009.
- Review the agreed scope, cross-screen consistency, and financial definitions.
- Acceptance: TRACKER.md records completed work, modified files, checks actually performed, and outstanding decisions without claiming unverified behavior.


## T-003 implementation map (2026-11-04)

Source inspection only; no runtime or backend verification. `App.tsx:35` owns session, onboarding data and stage, passing them to `src/OnboardingAndHome.tsx:179` at `App.tsx:336`. Completed onboarding resolves to `home` (`src/onboarding-domain.ts:258`), the final flow branch (`src/OnboardingAndHome.tsx:2261`); no tab navigator exists. Preserve entry, revalidation, sign-out and Edit Setup when adding navigation.

| Tab | Available and reusable | Missing or limited |
| --- | --- | --- |
| Home | Dashboard presents active debt, income, strategy, target, payoff order and estimated date; strategy can be changed (`src/OnboardingAndHome.tsx:2261`). Reuse `calculatePayoffPlan` and `calculateTotalMonthlyIncome` (`src/onboarding-domain.ts:496`, `:207`). | No recent transaction activity or upcoming bill collection. A debt due day is not a dated bill or proof of payment. No promotion content. |
| Debt | `DebtItem` covers card, personal, mortgage, auto and other categories, balance, APR, minimum, optional original balance, due day and credit limit (`src/onboarding-domain.ts:74`, `:93`); editor and storage support add/edit/delete (`src/OnboardingAndHome.tsx:282`, `:326`, `:371`; `src/onboarding-storage.ts:181`, `:242`). | Home uses positive-balance payoff order, not all debt records. Need an all-accounts view and honest empty states. Manual data is not a verified complete household inventory. |
| Transactions | No transaction records or source in inspected `src` modules. | Coverage, source, ownership, history, sign convention, dates, categorization and transfer/debt-payment treatment need decisions and a contract. Bank sync and transaction entry are not authorized by this plan. |
| Budget | Onboarding stores primary and additional incomes and frequencies; normalization is a monthly equivalent (`src/onboarding-domain.ts:61`, `:117`, `:192`). The payoff plan exposes minimums, extra and monthly plan (`:465`, `:496`). | No recurring or one-time spending records or actual income/payment ledger. Planned payment is not actual payment. Planned/actual treatment and period reconciliation remain undecided. |
| Progress | A snapshot `progressPercent` uses active balances and optional original balances (`src/onboarding-domain.ts:502`); Home displays it (`src/OnboardingAndHome.tsx:2343`). | No month/lifetime history, payment events or approved metrics. The percentage excludes zero-balance debts and may use current balance as starting balance; it cannot establish historical household progress. |

Storage caveats: `src/onboarding-storage.ts:84` chooses newer local or user metadata and attempts to merge debt rows; an empty response retains cached debts, and failure falls back silently. Database fields are limited; missing category can be inferred from name and missing original balance defaults to current balance (`:42`, `:52`, `:122`). The loader does not expose freshness, completeness or reliable empty/error status. `householdId` is generated from the user ID (`src/onboarding-domain.ts:221`), not evidence of shared household access. No backend changes are approved by this mapping.

### Shared contract recommendations

- Keep `UserOnboardingData`, `DebtItem`, validation and persistence as existing sources. Share one derived `PayoffPlanResult` from `calculatePayoffPlan` across Home, Debt and Budget. Its monthly budget is minimums plus extra; it applies monthly APR/12 interest, minimums and strategy-priority allocation, stopping on stalled payoff or 600 months. `monthlyTotalPayment` is a planned budget; summed `firstMonthPayment` can be lower when balances are exhausted. Empty debt returns “Debt-free now” and an extra-only monthly total, so distinguish truly known empty from unavailable.
- Propose `src/financial-data.ts` for screen-facing availability: loading, available (including genuinely empty), unavailable/error and partial/stale, with source, as-of and coverage when known. The current loader cannot supply every distinction without separately scoped changes; do not assert them. Pass shared data and update callbacks through the shell rather than create competing stores.
- After source and coverage decisions, define account and transaction records with stable IDs, household/account association, currency, amount/sign, transaction and posting dates, status, category and source/coverage. Model transfers and debt payments explicitly to prevent double counting; distinguish recorded activity from projections.
- Budget needs period, planned versus actual, income, recurring and one-time expenses, strategy payments, source links and an overlap policy. A bill needs due date, amount, source/account and payment status; `dueDay` is only an optional hint. Progress requires approved metrics, period boundaries/time zone, historical source and completeness; never infer history from snapshots. Use the existing country currency and `formatCurrency` (`src/onboarding-domain.ts:43`, `:180`) consistently; decide cross-currency policy before aggregation.

### Proposed sequence and ownership

Paths are proposals for manager-finalized briefs, not existing files. Work sequentially where ownership overlaps.

1. **T-004 shell:** `src/OnboardingAndHome.tsx` retains entry flow and supplies state/actions; new `src/FiveTabShell.tsx` owns the ordered tabs and safe-area navigation; new `src/screens/` modules provide honest placeholders. Touch `App.tsx` only if wiring requires it. Establish `src/financial-data.ts` only for agreed contracts; avoid persistence changes.
2. **T-005 Debt:** `src/screens/DebtScreen.tsx`; reuse domain and existing editor/save/delete handlers. Extract `src/components/DebtEditor.tsx` only if needed; coordinate `src/OnboardingAndHome.tsx` and shell callback wiring. Depends on T-004 and manual-source limitations.
3. **T-006 Transactions:** `src/screens/TransactionsScreen.tsx` and, after agreement, `src/transactions-domain.ts` for contracts/selectors. Depends on T-004 and coverage/source decisions. Without an authorized source show unavailable; integration and entry need separate scope.
4. **T-007 Budget:** `src/screens/BudgetScreen.tsx` and, after definitions, `src/budget-domain.ts` for aggregation. Depends on T-004, shared income/payoff and spending and planned/actual decisions; coordinate transaction contract for actuals.
5. **T-008 Progress:** `src/screens/ProgressScreen.tsx` and, after agreement, `src/progress-domain.ts` for period selectors. Depends on T-004, metrics, historical source and period definitions; no substitute snapshot history.
6. **T-009 Home:** `src/screens/HomeScreen.tsx` and optional `src/home-summary.ts` compose shared plan, activity and dated bills; wire through `src/FiveTabShell.tsx` and migrate Home UI from `src/OnboardingAndHome.tsx` without losing strategy/edit actions. Depends on T-005–T-007 and availability of activity/bill contracts; commercial content is unprovided.

### Option B icon integration

Option B is implemented in `src/components/AppIcon.tsx` with selected solid silhouettes and inactive outlines, reusable color/size props and decorative accessibility treatment. `react-native-svg` 15.16.0 is installed. T-004 uses these shapes for the ordered five-tab shell. TypeScript checks passed for both tasks; native rendering awaits T-014. Palette remains undecided, so the existing colors are provisional.

### Initial screen implementation boundaries (2026-11-04)

T-005–T-009 now proceed sequentially under the finalized TRACKER.md brief. Render the stored debts, entered income and shared strategy projection; implement dedicated unavailable states for transaction records, recurring/one-time spending, history, recent activity and dated bills. Do not infer zero spending, empty verified history, a real bill schedule or complete household coverage from absent sources. New entry/import workflows and backend changes remain outside this initial screen pass. Record these limitations at closeout rather than presenting the initial screens as complete data integrations.

### Initial screen pass completed (2026-11-04)

T-005–T-009 implement dedicated screens using the existing onboarding snapshot and shared payoff plan. Debt includes zero-balance records and existing editing; Budget normalizes entered income and displays the strategy payment; Progress exposes the approved periods and metrics with unavailable history; Home retains its controls and shows unavailable activity and bills. Transactions covers the intended household categories in its unavailable state. These screens do not supply transaction, spending, dated-bill or historical-event sources, and manual records are not a verified complete household inventory. The Home percentage is a balance snapshot, not verified historical progress. Future commercial content remains an accommodation only. Typecheck passed; native runtime and layout remain unverified until T-014 (T3 device access setting blocked).

### Prototype layout & style merge completed (T-016 & T-017, 2026-11-04)

Inspected the 16 prototype screenshots in `references/prototype/2026-11-04/` (`T-016`) and merged the prototype's structural layouts, fixed headers, sub-navigation segmented pills (`History`/`Scheduled`, `Budget`/`Upcoming`/`Strategy`, `Overview`/`Utilization`/`Milestones`, `Cards & Loans`/`Home & Auto`/`All Debts`), SVG donut rings and semicircular gauges, horizontal progress bars, search/sort controls, floating `+` action buttons, and card hierarchies into the five native tabs (`T-017`). Preserved the native dark charcoal/teal/terracotta palette, extended the Option B vector icon set (`chevronRight`, `chevronLeft`, `search`, `sort`, `user`, `calendar`, `flag`, `info`, `filter`), exposed optional `originalBalance` and `creditLimit` inputs in the shared debt editor, and maintained honest `Unavailable` states where transaction, spending, dated bill, and historical event sources are not connected yet. `npm.cmd run typecheck` passed (`0` errors).

## Decisions confirmed on 2026-11-04

1. Transactions include checking/savings, everyday purchases, and debt-account activity; label and categorize them appropriately. Coverage is approved, but bank sync and transaction-entry workflows still require separate scope under this plan.
2. Budget shows whatever amounts the user entered. Preserve entered amounts and existing income-frequency normalization; distinguish strategy-based debt payment estimates from recorded payments. No inferred planned/actual duplication or automatic purchase imports.
3. Progress leads with debt paid down, payments made, and accounts paid off across all three agreed periods. Use recorded history; do not infer monthly/lifetime performance from debt snapshots.
4. Option B native renderer: use react-native-svg at the installed Expo SDK's bundled version (15.16.0 in node_modules/expo/bundledNativeModules.json). T-011 may add this dependency and port the approved paths. This is an implementation choice within the approved icon work.
5. Mortgage set aside (updated 2026-11-04): Do not include or display Mortgage in the active payoff strategy, onboarding debt entry, or Debt/Home/Budget/Progress category views for now (it may receive its own dedicated page later). Consumer debts and Auto loans remain active and accelerated; category segments use `Cards & Loans`, `Auto`, and `All Debts`.

Color palette, typography, detailed layouts, commercial content, and additional features await user direction. These choices do not block this plan or the initial implementation mapping.

## Boundaries for every worker

- Read AGENTS.md, this plan, and the assigned TRACKER.md task. Manager finalizes exact target files, acceptance criteria, and assignment before dispatch.
- Work only within the task. Preserve existing edits. No unrelated refactoring, production-data access, or prototype-data imports.
- Do not infer approval for backend migrations, live bank sync, billing, promotion services, or extra workflows from this plan.
- No new tests, full test suites, emulator launches, or builds unless explicitly included in the finalized task or strictly necessary as a targeted check. This planning-only update needs no tests.
- Work sequentially until shared file ownership is clear. Parallel tasks require disjoint files and agreed data contracts.
- On a blocker, record BLOCKED with the exact reason in TRACKER.md, stop, and notify the manager. On completion, record DONE, modified files, and a concise handback, then stop.
- This document neither launches workers nor schedules automatic execution. Resume and dispatch in the next requested working session.

### T-079 owner correction and implementation (2026-11-07)

The owner's latest instructions supersede the 2026-11-04 Mortgage exclusion decision for onboarding. First-time or reset onboarding now includes a Home / Mortgage account entry; completed-account Setup edits do not acquire new onboarding routes or auto-create linked bills. An Auto loan or Mortgage entered during initial onboarding creates one debit recurring spending item with a stable ID shared with the debt, a preserved due-date schedule, and an explicit linked relationship. Retries reuse IDs and skip unchanged debt writes. An existing bill row is reused only after authoritative confirmation; unresolved rows block another bill write until Finance Recovery confirms the server state. The recurring record does not create a payment transaction or mutate the debt balance. Linked Auto minimums are offset once from the payoff-plan commitment, and a linked bill provides the single reminder.

Loan payment review now lives on Home. Confirmed links do not appear as a Needs attention notice. Debt Detail and the recurring spending editor show the relationship and provide unlink controls. Custom names entered for the Other recurring spending category remain metadata keyed by recurring bill ID through the existing settings CAS, reload, backup, and restore paths; Budget groups same-label bills while the stored recurring bill category remains `other_bill`.

Focused source tests passed (23 checks across loan pairing and retry recovery, budget grouping, backup recovery, and onboarding domain) and `npm.cmd run typecheck` passed. No live services, device, build, or dependency changes were used. Runtime visual behavior was not exercised. The owner prohibited subagents, so no independent delegated review was run; implementation was self-reviewed against this plan and the required prototype references.
