# Financial decision register — T-020

2026-11-04. Product decision owner throughout is the user; the manager owns preparation, recording approval and sequencing. The foundation v1 approval record below supersedes the original T-020 proposals only where stated. Examples are synthetic. [Worked scenarios](./FINANCIAL_WORKED_SCENARIOS.md) remain conditional for policies outside that record.

## User approval record — foundation v1

The user approved the manager's six-part T-021 starting package, with broader currency support and an explicit decimal-entry requirement. This approves foundation semantics, not every recommendation in D1–D10.

- **Currency:** Support as many currencies as practicable, with common choices first; the four-currency ceiling is rejected. Keep currency identity explicit, with no conversion or mixed-currency sums. Define a supported catalog and each currency's minor-unit scale rather than assuming two decimals for every currency. Exact catalog, metadata source and pinned order remain implementation proposals to finalize; “most common” is a presentation preference, not an approved statistical ranking.
- **Money:** Exact decimal-text parsing to integer minor units, rejection of invalid/excess-precision inputs, half-away-from-zero rounding of derived fractions at named boundaries, checked arithmetic and explicit range errors. The summary did not specify an exact range or full input grammar; the original numeric bound remains proposed.
- **Decimal entry:** Preserve `4` → `42` → `425` → `425.` → `425.2` → `425.25`. A period is a decimal separator, never a signal to shift digits into cents. Keep editable text separate from parsed money/formatted display and preserve intermediate `425.`. On commit, USD `425.25` is 42,525 cents. Never produce `4.25.25`; a second separator must not save a reinterpreted amount. Deletion/replacement must not shift the decimal; incomplete/empty edits must not silently save zero. This is a native input-integration requirement; a pure parser alone cannot fix a text-input formatter. Other locale separators need an explicit normalization policy.
- **Rates:** APR to three decimal places, initially bounded to 0–100%, approved.
- **Calendar / first payment:** Date-only payment dates, explicit household IANA time zone, injected calculation time; monthly recurrence preserves the requested day, clamps to month end and returns to the requested day when available. Require an explicit first projected payment date in the contract; app default remains for later wiring. Local month boundaries use [start, next start). Zone selection/default and event-date basis remain for their later workflows.
- **Balances / contracts:** Positive recorded balance means owed, negative means credit. Preserve signed observations, source, as-of date, account/household identity and coverage. Unknown/failed data differs from known empty. The user approved this starting policy provisionally; it does not establish shared-household access or a persistence workflow.

## User approval record — payoff policies v1 (D3–D6)

The user approved the four-part T-022 starting policy package for the pure payoff engine (`src/finance/payoff.ts`):

- **Account inclusion (D3):** Use an explicit account list passed into the projection, with each account tagged as `accelerated` (receives extra payments), `minimum-only` (pays scheduled minimum only), or `excluded` (tracked in inventory/exclusions without scheduled payments). Only positive balances create payoff obligations (`max(balance, 0)`); credit balances (`< 0`) stay intact in records and have `0` payoff obligation without cancelling other debts. Unknown/unavailable inventory must remain distinct from a known-empty or zero-obligation debt set.
- **Minimums & installments (D4):** Treat the user-entered minimum/installment as a fixed scheduled amount for the initial engine, capped at the account's remaining balance + current-month interest in its final payoff month. Do not apply an unapproved auto-declining card minimum formula or `$25` floor unless explicitly enabled later.
- **Monthly commitment & allocation (D5):** Use a **fixed monthly commitment** equal to total initial minimums of open included accounts plus the user's extra monthly payment (or an explicit fixed monthly cap). Each period: **(1)** pay required minimums on all open included (`accelerated` and `minimum-only`) accounts first; **(2)** roll all remaining budget (extra payment + freed-up minimums from paid-off debts) into the highest-priority `accelerated` debt (**Snowball**: lowest current balance after interest/minimums or opening balance as specified → highest APR → ascending stable account ID; **Avalanche**: highest APR → lowest balance → ascending stable account ID), rolling over within the same period if a target debt finishes early; **(3)** report any unused budget in each period. If required minimums in any period exceed the available commitment, return an explicit `paymentShortfall` result rather than silently raising the user's commitment.
- **Interest & diagnostics (D6):** Monthly forecast step: accrue interest on each open positive obligation using `openingObligation × APR / 12` (with APR in integer thousandths of a percentage point, i.e., `numerator = aprThousandths`, `denominator = 12 * 100_000 = 1_200_000`, rounded once per account per month half-away-from-zero to minor units via `multiplyMoneyRatio`) before applying that month's payments. Return distinct diagnostic outcomes: `paidOff`, `paymentShortfall`, `notAmortizingUnderAssumptions`, `horizonReached`, `insufficientData`, and `invalidInput`.

## User approval record — T-023 adapter, mortgage exclusion, first payment & input wiring

The user approved the T-023 integration rules:

- **Mortgage set aside (`excluded` and hidden from active UI):** Do not include `Mortgage` in the payoff strategy (`excluded`), and do not show `Mortgage` in the active onboarding/debt/category views for now (it may get its own dedicated page later). Active accelerated debt categories are `Credit card`, `Personal loan`, `Auto loan`, `Student loan`, `Medical debt`, and `Other loan`. Any legacy stored `Mortgage` record remains harmlessly preserved in storage (`excluded` from projection and filtered out of active debt/category views).
- **First projected payment date (D7 app default):** Default the first projected payment date (`firstPaymentDate`) to the **1st of the next calendar month** (`requestedDay = 1`) in the household time zone relative to the injected calculation instant.
- **Literal decimal input (`425.` → `425.25`) and currency catalog wiring:** Include both in T-023 so native money inputs preserve literal decimal typing without shifting digits into cents or creating `4.25.25`, and expose the 165-currency catalog from `src/finance/currencies.ts` (common choices first, scale-aware formatting and validation).

Remaining preparation for T-021: finalize currency catalog/scales and proposed common-first order, exact money grammar/range, and focused verification examples. Later payoff/history policies can remain pending. Future currency-selector and money-input integration must explicitly include UI files and read the required UI references. No UI fix or T-021 implementation is claimed by this record.

## Evidence and authority

T-021 has now been authorized by the user's “next”. Its finalized implementation brief is in TRACKER.md and overrides the earlier unassigned handoff below. The manager chose a static SIX ISO 4217 catalog with numeric scales, curated common-first order, strict canonical committed grammar and the earlier proposed 9,000,000,000,000 minor-unit bound as implementation details within foundation v1. These are recorded manager choices, not separately stated user decisions. UI integration remains later scope.

User-confirmed direction in [APP_PLAN.md](./APP_PLAN.md): the prototype is a reference, not a specification; Debt includes cards/personal loans, home and auto; Transactions covers household checking/savings, purchases and debt activity, with sources unselected; Budget shows entered income and spending and strategy payments, preserves existing income-frequency normalization, and has no invented planned/actual split; Progress presents debt paid down, payments made and accounts paid off for current month, previous month and lifetime using recorded history. Manual balances, minimums, extra payment, snowball and avalanche exist in the current starting point; existence is observed behavior, not approval of each formula. Source currently offers USD, CAD, GBP and AUD country choices, not proof of a complete supported-currency policy. Product scope is distinct from the semantics below.

Evidence locations: `APP_PLAN.md` sections “Confirmed product direction” and “Decisions confirmed on 2026-11-04”; `src/onboarding-domain.ts` country choices, `normalizeMonthlyIncome`, `calculateTotalMonthlyIncome` and `calculatePayoffPlan`; `NATIVE_FINANCIAL_PLAN.md` qualified source observations and persistence requirements. These are document/source observations, not independently verified runtime behavior. The user's T-020 assignment confirms manual data as the initial financial foundation; the exact manual-history workflow remains open.

The [native plan](./NATIVE_FINANCIAL_PLAN.md) qualifies the earlier audit: fixed commitment despite declining minimums can be intentional; fixed-cap unaffordability can be valid; the quick calculator already has an error-result path; savings against a nonpaying baseline can be unknown; `Math.round(amount * 100)` alone does not establish exact parsing or fractional-interest precision. The prototype balance clamp does not establish loss of an underlying credit; a loan source restriction does not establish an uncaught UI crash; non-payment transaction categorization alone does not establish double counting. Source review was focused, not a runtime or lender audit. Prototype guide claims and recommendations are not native requirements.

## Original T-020 analysis — approval record above takes precedence

The original labels below preserve the analysis before user approval. Foundation v1 supersedes those labels for D1, D2, D7 and the identity/coverage portion of D10. Other proposals remain unapproved. No example is production data.

### D1 — Currency, parsing, precision and rounding

- **Confirmed:** Preserve entered Budget amounts and existing income normalization; no currency or arithmetic policy was confirmed.
- **Recommendation:** Initially support USD, CAD, GBP and AUD individually tagged, each scale 2; no cross-currency sums or conversion. Accept canonical decimal strings with an optional leading minus only in signed fields, digits and at most two fractional digits; reject grouping, symbols, exponent, embedded whitespace, excess precision, nonfinite and out-of-range inputs. UI localization may normalize separately and explicitly. Store integer minor units with proposed absolute per-value bound 9,000,000,000,000 minor units and checked sums; rates as integer thousandths of one percentage point (proposed 0–100.000%) and exact integer/rational intermediates. Round interest once per account per month to minor units, half away from zero; other derived fractions at named boundaries. Never coerce invalid to zero. Rationale: deterministic accounting with explicit bounds.
- **Unresolved:** currencies, locale/grammar, range, rate precision, rounding and aggregation; whether country determines currency. **Deferred:** conversion and other currency scales. **Example:** `12.34` → 1,234 minor units; `12.345` rejected. **Limitation:** localized input needs its own specification; bounded intermediate arithmetic must be proven, not assumed.

### D2 — Balance meanings

- **Confirmed:** Debt includes the identified categories; detailed balance semantics are not confirmed.
- **Recommendation:** Keep a signed recorded observation with source and as-of date; positive is owed, negative is credit. Derive per-account payoff obligation max(balance, 0), retaining the credit. Label principal, statement balance and dated lender payoff quote separately; do not substitute one for another. Rationale: preserve credits and avoid treating a quote as principal.
- **Unresolved:** entry meaning and projection source; provenance requirements. **Deferred:** detailed loan accounting and quote reconciliation. **Example:** −$20 recorded remains −$20; obligation $0. **Limitation:** a snapshot cannot explain its underlying transactions.

### D3 — Strategy account inclusion

- **Confirmed:** Debt displays cards/personal loans, home and auto; this does not decide acceleration.
- **Recommendation:** Use an explicit shared projection set; show exclusions and any minimum-only obligations separately if approved; use stable IDs. Rationale: visible scope and reconcilable totals.
- **Unresolved:** which categories/accounts are accelerated, minimum-only or excluded; treatment of archived, missing and credit accounts. **Deferred:** custom ordering and unapproved modes. **Example:** displaying a mortgage does not itself direct extra funds to it. **Limitation:** incomplete inventory cannot establish household debt freedom.

### D4 — Minimums and installment terms

- **Confirmed:** Existing manual minimum entry is observed; no estimated formula is approved.
- **Recommendation:** Separate manually entered statement minimum with as-of/coverage from fixed contractual installment; cap applied payment at amount owed in the example forecast. An optional estimated card minimum, if approved later, must identify its rule and use the approved simulated balance/interest basis. Rationale: changing issuer minimums and fixed installments have different meanings. No universal $25 floor or 1% formula.
- **Unresolved:** persistence/expiry of manual minimum, final-period treatment, whether estimates exist and exact rule/basis. **Deferred:** issuer-specific estimates and complex terms. **Example:** $30 entered minimum on $10 owed applies at most $10 under this proposal. **Limitation:** actual minimum may change; installment may contain non-debt components.

### D5 — Commitment and allocation

- **Confirmed:** Strategy debt-payment totals are requested; fixed versus variable commitment is undecided.
- **Recommendation:** User-entered fixed monthly cap, initially entered minimums plus chosen extra, stays fixed as minimums decline; return a shortfall if later minimums exceed it, never silently increase it. Pay all minimums first, then allocate remaining funds by approved strategy; show unused funds. Rationale: preserves affordability and accounts for every unit. Variable commitment is a viable alternative.
- **Unresolved:** fixed vs variable, cap formation/change dates, shortfall handling and allocation/tie/rollover order. **Deferred:** changing schedules unless separately scoped. **Example:** $100 cap, $110 required → $10 shortfall, not $110 auto-commitment. **Limitation:** a fixed cap can intentionally become unaffordable; shortfall does not prove no other plan works.

### D6 — Interest and model boundaries

- **Confirmed:** Prototype formulas are not approved native policy.
- **Recommendation:** Initial forecast uses opening obligation × APR/12, rounded once monthly, then payment; constant APR, no new borrowing, fees, promotions or automatic posting. Rationale: bounded and explainable. A statement interest charge or fee is not automatically an APR calibration.
- **Unresolved:** period/order, rate basis and rounding, disclosure and missing APR behavior. **Deferred:** daily accrual, promotional/deferred-interest terms, variable rates, fees, advanced loan mechanics and automated posting. **Example:** $1,000 at 12% APR yields $10 first-month interest. **Limitation:** not a lender settlement or statement calculation; grace periods and transaction timing matter.

### D7 — First payment, time zone and periods

- **Confirmed:** Progress needs current, previous and lifetime periods; exact boundaries are not confirmed.
- **Recommendation:** Inject calculation instant and explicit household IANA time zone; date-only due dates stay date-only. Supply first forecast payment date explicitly. Monthly recurrence preserves requested day and clamps to month end, returning to that day when available. Progress months use local calendar half-open [start, next start) boundaries; lifetime starts at verified coverage. Distinguish effective, posted and recorded timestamps. Rationale: reproducible boundaries without UTC/date-only shifts.
- **Unresolved:** household zone ownership/default, first-payment rule, recurrence and period event-date basis. **Deferred:** detailed cycle/day-count schedules. **Example:** Jan 31 → Feb 29 → Mar 31 in 2024. **Limitation:** zone changes and ambiguous historical event dates need policy.

### D8 — Budget and income normalization

- **Confirmed:** Show entered amounts; retain existing frequency normalization; no invented planned/actual split. Source uses weekly ×52/12, biweekly ×26/12, twice monthly ×2, monthly ×1, rounding each source to cents before summing; this is observed implementation, not approval of its numeric rounding.
- **Recommendation:** Preserve source amount/frequency, label the result monthly equivalent, and identify strategy commitment as estimated. Classify a card purchase and later debt payment as distinct economic/cash events without counting the same expense twice. Rationale: annualized equivalent is not calendar receipts.
- **Unresolved:** whether remaining means allocation capacity or cash available, expense/fee/transfer treatment, precision and coverage. **Deferred:** actual-activity workflow and new planned/actual UI. **Example:** $1,200 biweekly → $2,600 monthly equivalent, not receipts in every month. **Limitation:** missing spending is unavailable, not zero.

### D9 — Progress and history

- **Confirmed:** Show debt paid down, payments made and accounts paid off across three periods using recorded history; do not fabricate history from snapshots.
- **Recommendation:** Distinguish net balance change, recorded payment cash, recorded principal reduction and verified payoff event; publish coverage and as-of. Rationale: interest, charges, corrections and transfers break equivalence.
- **Unresolved:** exact definitions, date basis, payoff evidence, reversals, reopened accounts and partial-coverage display. **Deferred:** milestones until event and coverage rules are approved. **Example:** $100 payment with $10 interest and no other changes reduces balance $90, not $100. **Limitation:** two snapshots do not establish payment amount or cause.

### D10 — Manual source, ownership and persistence

- **Confirmed:** Existing starting data is manually entered; Transactions source and history workflow are unselected. Bank integration and a new entry workflow are not approved by the plans.
- **Recommendation:** Propose a minimal explicit manual observation/event workflow only after separate authorization, with account and household ownership, source, date and coverage; keep one authoritative store, distinguish known empty, unavailable, stale and partial, preserve corrections and support safe retry/migration. Rationale: avoid false history, lost records and cross-household leakage.
- **Unresolved:** first manual workflow, single-user vs shared access, authority/conflict, migration/recovery, deletion and coverage. **Deferred:** bank sync, imports and automatic posting. **Example:** failed load is unavailable, not proof of zero debts. **Limitation:** current generated household ID does not prove shared access; no persistence implementation is authorized here.

## Proposed T-021 handoff — do not execute

This is a proposed, unassigned task, not approval to implement. **Permitted writes if the manager finalizes it:** new `src/finance/money.ts`, `src/finance/calendar.ts`, `src/finance/contracts.ts`, and only the finalized T-021 entry in `TRACKER.md`. No package, UI, existing source, storage, schema or other documents; no engine, migration, source integration or new features. If focused executable checks require a test file, the manager must explicitly add its exact path and authorize it before dispatch; otherwise verification is limited to approved examples by an explicitly authorized narrow command or inspection. No broad suite, build, emulator or browser.

**Actually approved inputs:** prototype is reference only; user-confirmed tab purposes and Budget/Progress constraints above; retain existing income-frequency normalization; history must not be inferred; foundation v1 above, including broad currencies and literal decimal entry. D1–D10 are not approved wholesale. Source behavior and synthetic scenarios are evidence, not approval.

**Smallest gates before dependent work:** (1) D1 currency set, parser grammar, scale/range, rate representation, rounding/boundaries and overflow behavior; (2) D7 date-only representation, injected date/zone, first payment and month/period boundaries for calendar operations actually implemented; (3) D2 sign/observation meanings and D10 identity, source/coverage/availability fields for contracts. Any unresolved field remains explicitly unknown or is excluded; do not encode a guessed default. D3–D6 and D8–D9 can remain pending unless their semantics are introduced. Manager records the approved policy version and selects only approved scenario expectations before assignment.

**Proposed acceptance:** Pure primitives without UI/storage dependencies; explicit currency and checked exact arithmetic; invalid, unsupported and overflow inputs return errors, not zero; date-only and time-zone/period handling follow approved rules; contract types distinguish signed balance observations, source/as-of, account/household identity and unknown/empty/partial/error coverage without fabricating history; no currency mixing. No projection or persistence implementation.

**Narrow future verification, only when explicitly authorized:** Compare parser, signed half-cent/overflow, checked sum, date recurrence/leap year, zone/half-open boundary and contract availability examples from the approved subset of the companion scenarios; report command and actual results. No application/prototype engine-derived expected values. Stop at required policy gaps rather than inventing them. T-022 and later tasks require their own approval and scope.

## T-021 implementation notes (2026-11-04)

Implemented the approved foundation in isolated pure modules. The manager-selected canonical committed grammar and absolute 9,000,000,000,000 minor-unit bound are implementation choices, not additional user statements. The offline catalog contains 165 unique numeric-scale entries from SIX List One published 2026-09-17, retrieved 2026-11-04 ([standards](https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html), [XML](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml)); N.A. entries, including metals, test and no-currency, are excluded. The curated common-first prefix is not statistical ranking. Runtime native BigInt and IANA time-zone support, input integration, locale handling, and later financial policies remain unverified or out of scope.


## T-022 implementation notes (2026-11-04)

T-023 completion update: shared payoff adapter, active Mortgage exclusion, next-month-first payment labels, literal decimal inputs and broad currency choices are integrated. Currency-safe debt serialization/reload and exact currency-scale income normalization replace forced two-decimal handling for this path; frequency factors are unchanged. Existing monetary records prevent currency relabeling without conversion. Forward precision migration `20261105065959_debt_currency_precision.sql` applied only to the designated sandbox; schema/policy metadata and synthetic table-type values verified, no user-row access. Four focused Node files pass 15/15; TypeScript passes. Native runtime/layout and authenticated end-to-end save/reload are not verified; later financial/history scope remains deferred.

The pure payoff engine implements the approved D3–D6 monthly forecast, explicit account roles, fixed commitment override, signed balance preservation and distinct diagnostics. Interest and totals use the bounded money primitives; insufficient terms are not imputed. Forecasts assume constant terms and omit fees, new borrowing and lender-specific accrual. Partial results do not claim lifetime payoff totals; no app or storage integration is included.
