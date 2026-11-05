# Native financial implementation plan

Date: 2026-11-04. Owner: GPT-6.1 Sol Medium. Status: planning only; no implementation or worker dispatch authorized by this document.

## Authority and scope

The user's direction is explicit: the prototype is a reference, not a rule. Neither its source nor `references/PROTOTYPE_CALCULATIONS.md` establishes correct native behavior. Preserve useful ideas only after reviewing their assumptions and independently checking their outputs. This plan supplements `APP_PLAN.md`; existing product decisions remain in force.

The goal is a consistent, explainable financial foundation across Home, Debt, Transactions, Budget and Progress. Start with manual data and a bounded payoff estimate, then add recorded history and more detailed models deliberately. Bank integration, additional strategies, automated interest posting and new workflows require separate scope. Planning them here does not approve their implementation.

T-020 documentation: [financial decision register](./FINANCIAL_DECISION_REGISTER.md) and [independent worked scenarios](./FINANCIAL_WORKED_SCENARIOS.md). The register records foundation v1 user approvals (broad currencies/common choices first, exact money/literal decimal entry, rates, calendar/explicit first payment and signed balance/coverage contracts), payoff policies v1 user approvals (D3–D6: explicit accelerated/minimum-only/excluded inclusion, fixed entered minimums capped at owed, fixed monthly commitment with minimums-first and same-period priority rollover, monthly `APR/12` half-away-from-zero interest, and distinct diagnostic outcomes), and T-023 integration approvals (Mortgage set aside from active UI and payoff strategy, 1st of next month default `firstPaymentDate`, literal decimal entry wiring, and 165-currency catalog integration). T-021 and T-022 are complete; T-023 is authorized and in progress.

## What this review establishes

Execution update: T-021 (`currencies.ts`, `money.ts`, `calendar.ts`, `contracts.ts`) and T-022 (`payoff.ts`) are complete and verified. User approved T-023 to wire the compatibility adapter, shared payoff projection, 1st-of-next-month default start date, literal decimal input handling (`425.` → `425.25`), 165-currency selector/formatting, and setting Mortgage aside from active screens and payoff calculations. T-024 onward remain unstarted.

Both local prototype copies (`../ptototype-df-web-app` and `references/prototype-repo`) report commit `4aaf22d73a2fcd221732d35fc6c6f5613a64ca15`. Source observations below refer to the nested copy. Matching HEADs do not establish identical uncommitted files. This is a focused source review, not an exhaustive audit, runtime reproduction, or lender reconciliation.

| Source observation | Native implication |
| --- | --- |
| `app/payoff-engine.ts`: `forecastMinimum` calls `effectiveMinimum(account)` using the original account balance/APR, even when passed a later simulated balance. | Distinguish a fixed entered payment from an estimated changing minimum. Define which balance and interest each estimate uses. |
| Same file: `interestFee / balance` can become the forecast monthly rate. | Separate contractual APR, observed statement interest and one-time fees. Any calibration must be explicit, bounded and labeled. |
| Same file: legacy custom strategy becomes avalanche. | Unsupported settings must produce a visible compatibility result. Do not advertise custom order unless the engine honors it. Custom strategy is not currently native scope. |
| `app/loan-progress.ts`: excess principal is rejected, and a second regular payment in the same month is rejected. | Define partial, extra and final-payment accounting and payment timing before building loan recording. These are source restrictions; an uncaught UI crash has not been established. |
| `app/interest-accrual.ts`: estimated cycle interest uses the closing-date balance for all days and can create ledger entries. | A coarse forecast must remain distinguishable from recorded interest. More detailed accrual needs transaction dates and verified terms; no automatic estimate posting in the first release. |
| `app/progress-balances.ts`: the ledger function can return signed balances, but `transactionAdjustedAccounts` clamps them to zero. | Preserve credit balances in records. Derive nonnegative payoff obligations separately. This code alone does not prove that a later purchase loses the underlying credit. |
| `app/monthly-plan.ts`: spending includes all non-payment transaction types. | Define household spending, fees, cash outflow and transfers explicitly, then trace all consumers before declaring double counting. |
| Native `src/onboarding-domain.ts`: amounts are rounded decimal numbers, despite comments claiming integer-cent arithmetic. It also converts nonfinite values to zero in `roundCents`. | Replace the representation and validation deliberately. Repeated rounding and `Number.EPSILON` are not proof of exact money arithmetic. Invalid data must not become a believable zero. |
| Native simulation stops on one month of aggregate nondecrease; horizon exhaustion also becomes `stalled`. | Separate an observed nondecreasing month, payment shortfall and projection-limit result. A future schedule change can alter feasibility. |
| Native baseline progress uses positive-balance accounts only and substitutes current balance for missing original balance. | Snapshot reduction cannot establish payments, historical principal paid or completed-account milestones. |

Qualifications to the earlier audit: a fixed monthly commitment can be intentional even when minimums decline; a fixed-cap forecast becoming unaffordable is a valid outcome; the quick calculator already has an error-result display path. Unknown savings against a nonpaying baseline are mathematically appropriate. `Math.round(amount * 100)` alone does not solve parsing or fractional-interest precision. Do not turn these earlier recommendations into requirements without review.

## 1. Agree on financial meanings before assigning implementation

Create a short decision register. Each rule must have an owner, chosen behavior, effective version, example and known limitation. The recommendations below are proposals, not newly approved features.

| Decision | Recommended starting rule | Needed before |
| --- | --- | --- |
| Money and currency | Exact parsing into minor units for supported currencies, explicit scale/range and rounding mode; reject invalid values. Keep rates/fractional accrual at defined precision and round at specified boundaries. Never aggregate currencies without an approved conversion policy. | Core contracts |
| Balance types | Distinguish recorded signed balance, principal, statement balance and lender payoff quote; each has source and as-of date. A payoff quote is not automatically principal. | Ledger/loans |
| Projection scope | One explicit account set feeds all summaries; clarify whether mortgage/auto are accelerated or tracked separately. Minimum-only and excluded accounts must be visible if introduced. | Payoff engine |
| Minimums and commitment | Manual statement minimum and fixed installment are separate from an optional estimated card rule. Define commitment as fixed or variable; no silent increase to satisfy future minimums. No universal issuer formula or unapproved $25 floor. | Payoff engine |
| Interest fidelity | Initial forecast uses disclosed monthly APR/12 assumptions with no new borrowing unless explicitly modeled. Higher fidelity is a later capability driven by actual account terms and data coverage. | Payoff engine |
| Promotions | Later scope unless approved: exact effective/end dates and post-promo terms. Distinguish ordinary promotional rates from deferred-interest arrangements; unsupported terms produce a limitation. | Promo extension |
| Dates and periods | Household time zone, date-only due dates, event effective/posting/recording timestamps, month-end/leap-year rules, first projected payment date and period inclusion rules. Inject calculation time. | All calculations |
| Budget meaning | Preserve user-entered amounts and existing frequency normalization. Monthly equivalent income is not actual receipts in a selected month. Define whether remaining is allocation capacity or cash available. | Budget |
| Progress meaning | Separate net balance reduction, recorded payments, recorded principal reduction and payoff events. Opening coverage determines when each can be known. | Progress |
| Data source | Select the first supported manual entry/history workflow and household ownership model. Bank sync remains separately scoped. Missing, stale, partial and known-empty data need distinct results. | Persistence/history |

Unresolved decisions block only dependent tasks. Agents may document alternatives; they may not pick financial semantics inside a UI task.

## 2. Establish shared contracts and boundaries

Proposed module boundaries (finalize exact paths before dispatch):

- `src/finance/money.ts` and `calendar.ts`: parsing, precision, dates and periods, with no UI or storage dependencies.
- `src/finance/contracts.ts`: account identity/household/currency, balance observations, terms with effective dates, entered income/spending and availability/coverage metadata.
- `src/finance/ledger.ts`: recorded events, reversal/correction links, transfer/payment links and balance reconstruction. Keep source IDs and idempotency keys for future imports.
- `src/finance/payoff.ts`: pure projection from an explicit snapshot, assumptions, policy and calculation date; per-period allocations and diagnostics. No persistence side effects.
- `src/finance/budget.ts` and `progress.ts`: named, shared selectors over entered data and recorded history. Screens format results rather than duplicate formulas.
- A storage adapter owns loading/saving, compatibility and migration. The existing onboarding contract remains readable during transition. Do not create a second independent authoritative store.

Recorded events and projections must be separate types. A scheduled obligation is neither a posted payment nor proof of settlement. A snapshot is a balance observation, not reconstructed payment history. Household/account ownership and currency must survive every boundary.

Projection results should distinguish `paidOff`, `paymentShortfall`, `notAmortizingUnderAssumptions`, `horizonReached`, `insufficientData` and `invalidInput`. Include the affected period/accounts, required versus available payment, remaining debt, assumptions, warnings, actual amount allocated and unused budget. Keep partial accrued interest distinct from lifetime interest. These names are proposals; the distinctions are required.

## 3. Build a small, independently checked calculation core

First deliver the currently supported manual balances, entered minimums, extra payment, snowball and avalanche through the shared engine. Preserve intentional behavior where correct; do not port the prototype wholesale. Specify the order of interest, charges, minimum determination, payments and priority recalculation. Define deterministic ties using stable IDs and ensure displayed priorities match the actual first-period allocation.

Core invariants:

- For each account/period: closing balance = opening balance + charges + interest + fees + signed adjustments - payments - credits, using the approved sign rules. Transfers have linked effects; they do not create household income or spending by themselves.
- Applied payments plus unused funds reconcile to the approved available budget; no silent budget expansion, lost pennies or unaccounted overpayment.
- Pay minimums according to the approved policy before allocating extra. If funds cannot cover them, return the shortfall rather than an arbitrary successful schedule.
- Preserve raw credit balances. Only the derived payoff obligation is floored at zero; one account's credit does not silently cancel another's debt.
- A zero obligation can have zero payment even if an extra budget was entered. Unknown inventory must never become “Debt-free now.”
- Horizon exhaustion does not prove impossibility. A temporary increase does not alone establish that a future time-dependent plan can never pay off.
- Same versioned inputs, policy and date produce the same schedule. Every headline number is traceable to that schedule.

Model ordinary forecasting separately from lender settlement accuracy. Daily interest requires verified day-count, transaction timing, grace-period and rate-bucket behavior where applicable. Do not promise exact statements from incomplete data or assume all mortgages/loans share one accrual method.

## 4. Add recorded history before historical claims

Build a minimal manual ledger/reconciliation slice before Progress or an actual-activity budget. Decide how opening balances establish coverage and how backdated edits affect derived views. Preserve revisions/corrections so a change does not masquerade as a payment.

Handle repeated saves/retries, transfer pairs, refunds, pending-to-posted replacement, deleted/reversed events and manual/import overlap. Future imported records need a source identity; amount/date similarity alone is not permission to delete a possible duplicate. Define same-day anchor coverage so transactions are neither omitted nor applied twice.

For loan payments, keep actual amount paid separate from estimated principal/interest/escrow allocation. A final payment must account for excess as an explicit credit/refund/unapplied amount or require a corrected entered amount; do not silently discard it. Multiple legitimate payments in a month require timing-aware allocation or an explicit inability to estimate that split. Missing lender terms remain missing.

Persistence acceptance includes known-empty versus failed load, deletion not resurrected by cache merging, account/household isolation, local/remote conflict policy, safe retries, migration of existing manually entered records and recovery from an interrupted migration. No prototype household data is imported by default. Do not fabricate historical events from existing original/current balances.

## 5. Derive Budget, Progress and screens from the same sources

Budget keeps entered income, recurring/one-time spending and strategy payment distinct. It must not count both a card purchase and its later repayment as the same spending event. Cash outflow and expense categorization are separate views of linked records. Do not introduce an additional planned/actual interface without product approval. A credit-card charge affects debt and spending but does not itself represent checking cash leaving that day. Fees require an explicit classification policy.

Progress uses approved period boundaries and coverage. Payments made cannot automatically mean principal paid. Refunds, write-offs, adjustments, new borrowing and added/removed accounts must not become earned debt-reduction milestones. A zero-balance snapshot alone does not prove a recorded payoff. Missing history stays unavailable; partial history is labeled. Define how reversals and reopening affect milestones before implementing them.

For utilization, use only eligible revolving accounts; show missing/zero limits and coverage. Keep raw over-limit values even if a visual bar is capped. Any target is a configurable product choice, not a universal financial rule.

Wire Home, Debt, Budget and calculators to one current projection result and account scope. Transactions and Progress use the same ledger selectors. Display estimate labels, as-of/coverage and outcome-specific messages consistently. A failed baseline comparison can say the new plan reaches payoff while numeric savings remain unavailable. Do not clamp a negative comparison into positive “savings.”

## 6. Verification designed around failure scenarios

No tests, builds or emulators are run for this planning task. Future finalized implementation briefs must explicitly authorize narrowly scoped verification, consistent with AGENTS.md. Financial calculations warrant a small shared scenario set; avoid per-screen duplicate tests and broad test runs.

Before implementing the engine, write expected results independently, with derivations, approved policy and exact inputs. Do not obtain expected values by running either the new engine or the prototype. Then implement focused automated checks against those approved examples. Review conservation properties as well as individual totals.

| Scenario | Acceptance evidence |
| --- | --- |
| Single debt, zero APR, $100 balance, $30 fixed monthly payment, no charges | Four payment periods: $30, $30, $30, $10; zero interest; $20 unused in the last period. Calendar label follows the separately approved first-payment rule. |
| $1,000, 12% APR, $100 payment, monthly model, no charges | First-period interest $10, principal reduction $90, closing balance $910. This verifies the selected approximation only. |
| Two debts; one clears before its allocation is exhausted | Remaining funds roll to the next eligible debt in the approved period; allocation and priority display agree. |
| Payment below interest; zero payment; zero/negative balances; invalid numeric data | Distinct, truthful outcomes; no NaN, fabricated zero or misleading payoff date. |
| Entered minimum versus auto minimum as balance changes | Fixed/manual semantics preserved; estimated rule uses the approved balance/rate basis. |
| Temporary charge or scheduled term change; future minimum exceeds cap; long horizon | No false impossibility from one month; explicit shortfall period; horizon reported separately. |
| Decimal half-cent boundaries, signed rounding, many small entries, range limits | Exact parsing/approved rounding, no unsafe integer overflow, accounting identities hold. |
| Month end, February/leap year, year/time-zone boundary, biweekly versus twice-monthly | Approved dates and period counts; monthly equivalent income is not mislabeled as calendar receipts. |
| Duplicate save, backdated edit, pending-to-posted record, transfer, refund, credit and reconciliation anchor | One economic effect per event; preserved credits; reproducible history and corrections. |
| Loan final/extra/partial/multiple payments; missing APR/escrow | No discarded funds or invented terms; actual versus estimated splits remain distinct. |
| Current/previous month and lifetime; added/archived account; reversal; missing history | Consistent coverage and metrics; no manufactured payments or milestones. |
| Saved record migration; failed/stale load; delete/reload; user/household switch | No data loss/resurrection, false empty inventory or cross-user exposure. |
| Cross-screen comparison and stalled-baseline what-if | Same source produces matching totals/dates; unknown comparison does not erase a valid new payoff result. |

## 7. Proposed delegation sequence

These are backlog candidates, not active assignments or approval to execute. T-019 is this completed planning task. Manager finalizes one task at a time in TRACKER.md with exact permitted files, dependencies, worker model/settings and acceptance checks before dispatch.

| Candidate | Deliverable and proposed boundary | Depends on | Completion gate |
| --- | --- | --- | --- |
| T-020 | Evidence/decision register and independent worked scenarios; documentation only | User resumes work | Findings classified as confirmed behavior, hypothesis or product decision; initial scope and unresolved decisions explicit. |
| T-021 | Money/calendar primitives and contracts; `src/finance/money.ts`, `calendar.ts`, `contracts.ts` | Required T-020 decisions | Parsing, rounding, currency, dates, coverage and signed balance examples pass focused checks. |
| T-022 | Pure initial payoff engine and result diagnostics; `src/finance/payoff.ts` | T-021 and approved scenarios | Basic allocation/interest invariants, infeasibility/horizon cases and deterministic priorities verified independently. No UI/storage edits. |
| T-023 | Compatibility adapter and shared projection wiring; `src/onboarding-domain.ts`, parent/shell wiring as finalized | T-022 | Existing entered records remain readable; all existing projection consumers use the same result; no silent semantic change. |
| T-024 | Manual event, reconciliation and persistence slice; `ledger.ts`, storage adapter and narrowly scoped schema only if separately authorized | T-021, source/ownership/migration decisions | Record/retry/correct/reload reconciles; no false empty/cache resurrection; coverage/isolation verified. |
| T-025 | Shared Budget selectors and minimal data wiring; `budget.ts`, Budget screen | T-023/T-024 and approved spending workflow | Entered amounts preserved; allocation reconciles; transfer/card/loan examples counted correctly. |
| T-026 | Progress selectors and minimal data wiring; `progress.ts`, Progress screen | T-024 and metric definitions | Payments, reduction and payoff events distinguished; period/coverage/reversal cases verified. |
| T-027 | Home/Debt/Transactions consistency and financial UI states | T-023 through T-026 | Identical totals/scopes where comparable; honest estimate, missing-data and failure states. |
| T-028 | Optional advanced terms and loan schedules, split into small tasks after scope approval | Stable core/ledger and required account terms | Promo dates, detailed accrual or loan timing validated with independent cases; no automatic estimate posting by implication. |
| T-029 | Manager integration review and bounded release check | Approved release subset complete | Decision register, scenario evidence, migration/rollback and cross-screen acceptance reviewed; limitations recorded. |

T-022 and T-024 can later run in parallel only after contracts stabilize and file ownership is disjoint. T-025 and T-026 can later run in parallel with separate screen files and agreed selectors. Shared contracts, onboarding adapter, parent wiring and schema changes each have one owner at a time. Do not start multiple agents to invent the same financial definitions.

Every worker brief must state: purpose; Task ID; read-first references; approved policy version and examples; permitted files; what not to change; dependencies; targeted authorized checks; handback with files/results/limitations; stop-and-record-BLOCKED conditions. No extra features, unrelated refactors, broad suites, builds or device launches. A worker returns a calculation trace for affected scenarios, not merely “typecheck passed.”

## Delivery checkpoints

1. **Decisions ready:** initial supported account/interest/payment scope and worked examples agreed; unresolved advanced behavior is explicitly deferred.
2. **Projection ready:** exact money boundaries, pure engine and shared adapter validated before replacing financial summaries.
3. **History ready:** manual records, coverage, corrections and persistence proven before releasing historical metrics.
4. **Integrated release ready:** Budget/Progress/Home reconcile, migration has a recovery path, and UI states communicate limitations. Perform only the specific runtime/device checks authorized in that release task.

The first useful release can stop at the validated projection checkpoint while historical activity remains unavailable. Add history and advanced account models in subsequent approved increments. Acceptance is correct behavior within a declared model and honest handling outside it; a payoff forecast is not a guaranteed lender settlement amount.

## T-021 foundation status (2026-11-04)

Pure money, currency, calendar and shared contract primitives are implemented with focused checks; no app integration or projection engine is included. See the T-021 tracker entry and decision register for catalog provenance, checks, implementation choices and runtime limitations. Later policy gates remain open.


## T-022 status note (2026-11-04)

T-023 is complete after manager review: shared projection adapter and approved UI integration, currency-safe persistence, and the forward monetary precision migration applied to the designated sandbox only. Focused checks pass 15/15 and TypeScript passes; synthetic SQL verifies precision and existing RLS policies remain. No native runtime or authenticated end-to-end I/O claim. The user requested stopping here; T-024 is unstarted.

T-022 is complete: the isolated payoff engine and focused S1–S8 checks are implemented. UI, storage, and adapter integration remain outside this task.
