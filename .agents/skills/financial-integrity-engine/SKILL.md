# Financial Integrity Engine Skill

## Description
Core mathematical, ledger, and domain specifications for `debtfree-native`. Any agent modifying balances, amortization schedules, payment allocations, payoff strategies, or transaction accounting MUST adhere strictly to these invariants.

---

## 1. Zero Floating-Point Currency Math Rule (Minor Units / Cents)

Never use JavaScript floating-point arithmetic or direct division (`/ 100`, `* 0.01`) for currency balances or calculations.
- **Always** work with integer minor units (cents) or use [`src/finance/money.ts`](file:///C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/src/finance/money.ts) and [`src/finance/currencies.ts`](file:///C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/src/finance/currencies.ts).
- For string display, use `formatCurrencyMinor(amountCents, currencyCode)` or `moneyToDisplay(money)`.
- For user inputs, use `moneyFromMajor(amountInputString, currencyCode)` or `parseCurrencyInput(input)`.

---

## 2. Debt Classification & Payment Allocation

Debts are strictly divided into two accounting behaviors in [`src/finance/ledger.ts`](file:///C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/src/finance/ledger.ts):

### A. Revolving / Fixed Direct Debt (Credit Cards, Personal Loans, Student Loans)
- A payment reduces the balance by the full amount of the payment:
  $$\Delta \text{Balance} = -\text{Payment Amount}$$
- Overpayment is capped at zero balance (no negative balances created accidentally).

### B. Amortizing Split-Allocation Debt (Mortgages, Auto Loans)
- Mortgages and auto loans have four distinct components in `TransactionRow`:
  - `principal_amount` (cents)
  - `interest_amount` (cents)
  - `escrow_amount` (taxes/insurance, cents)
  - `fee_amount` (late fees/servicing, cents)
- **Principal Reduction Invariant**: ONLY `principal_amount` reduces the debt balance:
  $$\Delta \text{Balance} = -\text{principal\_amount}$$
- **Unknown Breakdown Rule (P0)**: If the user or import records a payment on an amortizing debt *without* specifying the allocation breakdown, the system **MUST NOT** fabricate or assume 100% principal reduction. The payment amount stays unallocated (`getUnallocatedPaymentAmount > 0`), and debt balance reduction is deferred until allocated or reconciled.

---

## 3. Payoff Strategies & Amortization Generation

Implemented in [`src/finance/payoff.ts`](file:///C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/src/finance/payoff.ts):

1. **Ordering Invariants**:
   - **Snowball**: Rank accounts by current balance ascending (`balance ASC, apr ASC`).
   - **Avalanche**: Rank accounts by APR descending (`apr DESC, balance ASC`).
2. **Monthly Schedule Row Structure**:
   - Each account in the active payoff plan produces schedule rows:
     `{ monthIndex, monthLabel, paymentCents, interestCents, principalCents, endingBalanceCents }`.
   - Once an account reaches `endingBalanceCents == 0`, it is marked paid off, and its freed payment cascades into the next target account according to the strategy.
3. **No Synthetic Drift**:
   - Projections do not mutate actual account balances; they are pure read-only simulation functions.

---

## 4. Atomic Balance Reconciliation & Adjustments

Implemented in [`src/finance/finance-commands.ts`](file:///C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/src/finance/finance-commands.ts) and migration RPCs:

- **Reconciliation Invariant**:
  $$\text{Adjustment Amount} = \text{Verified Statement Balance} - \text{Current Ledger Balance}$$
- **Never Double Count**: An adjustment transaction (`type: 'reconciliation'`) records the drift amount. The balance is updated atomically with a row lock in the database.
- Modifying or deleting a historical transaction must calculate the delta:
  $$\Delta \text{Correction} = \text{Old Balance Impact} - \text{New Balance Impact}$$
  and atomically adjust the debt's balance to prevent desynchronization.

---

## 5. Verification Commands

Before concluding any task touching financial math:
```bash
node --test tests/finance-primitives.test.mjs
node --test tests/finance-phase1.test.mjs
node --test tests/finance-payoff.test.mjs
npm run typecheck
```
