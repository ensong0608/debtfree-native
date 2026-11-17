# Prototype Reference & Calculation Mechanics (`debtfree-dashboard`)

> **Current UI navigation:** [UI_PREFERENCES.md](./UI_PREFERENCES.md) supersedes historical navigation descriptions: Upcoming lives only in Transactions; Scheduled lives only in Transactions; Strategy lives only in Debt. Budget has no Upcoming or Scheduled section.

> **Reference only; not a native financial specification.** The user clarified this on 2026-11-04. Descriptions and recommendations below have not all been independently validated. In particular, a $25/1% card minimum is not a universal rule, precision is not uniformly integer based, and snapshots cannot establish payment history. Read [the native financial implementation plan](../NATIVE_FINANCIAL_PLAN.md) for qualifications, decision gates and proposed acceptance criteria before reusing any formula.

This document is the architectural reference for how the web prototype at [github.com/ensong0608/debtfree-dashboard](https://github.com/ensong0608/debtfree-dashboard) operates, performs its calculations, manages data, and links transactions, debt accounts, budgets, and progress tracking.

Agents working on `debtfree-native` should consult this guide when porting features or aligning calculation logic.

The prototype source is checked out locally at `references/prototype-repo/` (git-ignored to keep the native repository clean).

---

## 1. High-Level Architecture Overview

The web prototype is built as a Next.js / Cloudflare Worker full-stack web application with Drizzle ORM and Supabase PostgreSQL.

| Area | Prototype Implementation File(s) | Native Implementation Target |
| :--- | :--- | :--- |
| **Payoff Engine & Amortization** | `app/payoff-engine.ts` | `src/onboarding-domain.ts` (`calculatePayoffPlan`) |
| **Quick Calculator & Projections** | `app/payoff-calculator.ts`, `app/quick-payoff-calculator.tsx` | `src/screens/BudgetScreen.tsx` & `src/screens/DebtScreen.tsx` |
| **Priority Ordering** | `app/debts-screen.ts` (`payoffPriority`) | `src/onboarding-domain.ts` (`sortDebtsByStrategy`) |
| **Ledger & Account Balances** | `app/progress-balances.ts` | Future Ledger / Sync |
| **Progress & Milestones** | `app/progress-report.ts`, `app/progress-view.ts` | `src/screens/ProgressScreen.tsx` |
| **Budget & Cashflow Engine** | `app/budget-view.ts`, `app/monthly-plan.ts` | `src/screens/BudgetScreen.tsx` |
| **Payment Overlap & Deduplication**| `app/payment-overlap.ts` | Future Bank Sync / Ledger |
| **Loan & Mortgage Trackers** | `app/loan-progress.ts` | Separate Home / Auto Loan tracking |

---

## 2. Core Mathematical Engines & Formulas

### A. The Payoff Simulation Engine (`app/payoff-engine.ts`)
The prototype’s simulation engine (`calculatePlan`) models multi-debt payoff up to `PAYOFF_PLAN_MONTH_LIMIT = 1200` months (100 years).

1. **Monthly Interest Calculation**:
   - Monthly interest rate = `APR / 1200` (or `interestFee / balance` if calibrated to actual fee statements).
   - Monthly interest charged = `round(balance * monthlyRate)`.
2. **Promotional APR Terms (`hasPromoTerms`, `promoIsActive`)**:
   - Credit cards can have `promoEndDate` (e.g., 0% introductory APR) and `postPromoApr`.
   - Before `promoEndDate`, interest uses the promo rate; once expired, the rate switches to `postPromoApr`.
   - Post-promo minimums are supported via `postPromoMinimum`.
3. **Estimated vs. Effective Minimums**:
   - **Auto-calculated minimum (`estimatedMinimum`)**:
     $$\text{Estimated Minimum} = \min\Big(\text{balance} + \text{interest},\, \max\big(25,\, \text{round}(\text{balance} \times 0.01 + \text{interest})\big)\Big)$$
     *(i.e. standard US credit card minimum rule: 1% of principal balance + monthly finance charge, with a \$25 floor).*
   - **Effective minimum (`effectiveMinimum`)**: Returns 0 if balance is 0; uses `estimatedMinimum` if `minimumMode === "auto"`, or the user-entered `minimum` if manual.
4. **Monthly Amortization Step Flow**:
   - **Step 1: Interest Accrual**: Each active debt has its monthly interest added to its balance.
   - **Step 2: Card Charges**: Any linked recurring monthly card expenses or one-time purchases are added to the balance.
   - **Step 3: Minimum Payments Pool**: The required minimums for all active debts are calculated and paid first from the monthly commitment pool.
   - **Step 4: Priority Allocation (Avalanche vs. Snowball)**:
     - Any remaining monthly funds ("available extra") are allocated 100% to the top-ranked account until its balance reaches 0.
     - Once the top-ranked account is paid off, the money "snowballs" directly into the next priority debt in the same or subsequent months.
   - **Step 5: Stalled & Non-Amortizing Detection**:
     - If the monthly payment is less than or equal to the interest + charges, the debt is flagged as non-amortizing (`nonAmortizingAccountIds`).
     - If no debt is paid off and remaining balance does not decrease, the plan is marked `stalled: true`.

---

### B. Payoff Strategy Ordering (`app/debts-screen.ts`)

Accounts marked `payoffMode !== "minimum-only"` with `balance > 0` and not archived are ordered as follows:

1. **Avalanche (`strategy === "avalanche"`)**:
   - **Primary**: Higher effective APR first (`effectiveAprs[b] - effectiveAprs[a]`).
   - **Secondary tiebreaker**: Lower balance first (`a.balance - b.balance`).
   - **Tertiary tiebreaker**: Alphabetical name (`a.name.localeCompare(b.name)`).
2. **Snowball (`strategy === "snowball"`)**:
   - **Primary**: Lower balance first (`a.balance - b.balance`).
   - **Secondary tiebreaker**: Higher effective APR first (`effectiveAprs[b] - effectiveAprs[a]`).
   - **Tertiary tiebreaker**: Alphabetical name (`a.name.localeCompare(b.name)`).
3. **Custom (`strategy === "custom"`)**:
   - Ordered by `customOrder` index.

---

### C. Ledger, Balances, & Snapshots (`app/progress-balances.ts`)

1. **Integer-Cent Precision**:
   - All balance arithmetic in the prototype converts currency to integer cents via `moneyCents(value)` to eliminate IEEE-754 floating-point drift.
2. **Balance Reconciliation & Anchors**:
   - Debts maintain an optional `reconciliation` anchor (`{ balance, date, offset, coveredTransactionIds }`).
   - The current balance is dynamically derived from:
     $$\text{Current Balance} = \text{Anchor Balance} + \text{Balance Offset} + \sum \text{Post-Anchor Uncovered Transactions}$$
3. **Progress Snapshots**:
   - Snapshots (`PayoffSnapshot`) preserve historical point-in-time state (`totalBalance`, `monthlyInterest`, `projectedDebtFreeMonth`, `capturedAt`).
   - Starting balance for progress comparisons uses the earliest recorded snapshot, or the sum of accounts' `baselineBalance ?? balance`.

---

### D. Progress Metrics & Milestones (`app/progress-report.ts`)

1. **Key Progress Figures**:
   - $\text{Principal Eliminated} = \max(0,\, \text{Starting Debt} - \text{Current Debt})$
   - $\text{Progress Percent} = \min\big(100,\, \text{round}\big(\frac{\text{Principal Eliminated}}{\text{Starting Debt}} \times 100\big)\big)$
   - $\text{Interest Avoided} = \text{Total Interest}_{\text{minimum-only}} - \text{Total Interest}_{\text{current-plan}}$
   - $\text{Time Gained Months} = \text{Debt-Free Month}_{\text{baseline}} - \text{Debt-Free Month}_{\text{current-plan}}$
2. **Standard Milestone Definitions**:
   - `first-payment`: Recorded when the first debt payment is logged.
   - `first-1000`: Recorded when principal eliminated reaches \$1,000.
   - `first-debt`: Recorded when any active account reaches a balance of \$0.
   - `quarter`: 25% of starting debt eliminated.
   - `half`: 50% of starting debt eliminated.
   - `three-quarter`: 75% of starting debt eliminated.
   - `debt-free`: All active debt balances reach \$0.

---

### E. Budget, Cashflow & Spending Allocation (`app/budget-view.ts`)

1. **Cashflow Categories**:
   - Incomes (`kind === "income"`) vs. Household Spending (`kind !== "income"`).
   - Planned budget:
     $$\text{Remaining} = \text{Planned Income} - \text{Planned Household Spending} - \text{Payoff Commitment}$$
2. **Separation of Concerns**:
   - Loan tracking (e.g. Mortgages, Auto loans) is tracked with principal/interest/escrow breakdowns separate from credit cards and revolving lines to prevent double-counting payments against checking cashflow.

---

## 3. Comparison with Current `debtfree-native` State

| Feature | Prototype Implementation | Current `debtfree-native` State | Next Action for Native |
| :--- | :--- | :--- | :--- |
| **Snowball / Avalanche Math** | `app/payoff-engine.ts` | `src/onboarding-domain.ts` (600-month limit, cent rounding) | Matches core math; native can adopt promo APRs & auto minimum formula (`estimatedMinimum`) |
| **Payoff Ordering** | APR tiebreaker on Snowball, Balance tiebreaker on Avalanche | Implemented in `sortDebtsByStrategy` | Identical logic |
| **Credit Card Minimum Formula** | 1% + monthly interest, min \$25 | Uses user-entered `minimumPayment` | Add auto-estimate toggle for credit cards |
| **Promotional APRs** | `promoEndDate` + `postPromoApr` | Not yet in `DebtItem` | Add optional promo fields to `DebtItem` |
| **Ledger / Transactions** | Plaid / Manual transaction store | Displaying explicit `Unavailable` notices | Build transaction schema and sync |
| **Historical Milestones** | Tracked via snapshot history | Displays snapshot percent & `Unavailable` for past events | Implement snapshot persistence for progress history |
