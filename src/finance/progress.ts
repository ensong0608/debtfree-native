// Node's direct TypeScript loader requires the extension; Expo resolves it as well.
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type DateOnly } from './calendar.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type LedgerTransaction, classifyCategoryDirection, calculateTransactionBalanceDelta } from './ledger.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { moneyToMajor } from './money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { getCurrency } from './currencies.ts';

export type ProgressPeriod = 'current_month' | 'previous_month' | 'lifetime';

export type ProgressDebtItem = Readonly<{
  id: string;
  name: string;
  category: string;
  balance: number;
  originalBalance: number | null;
  creditLimit: number | null;
}>;

export type ActivitySummary = Readonly<{
  period: ProgressPeriod;
  totalPayments: number;
  principalReduction: number;
  newSpending: number;
  totalInterestAndFees: number;
  totalAdjustments: number;
  netBalanceChange: number;
  debtPaidDown: number;
  accountsPaidOffCount: number | null;
  transactionsCount: number;
}>;

export type AccountActivity = Readonly<{
  accountId: string;
  accountName: string;
  category: string;
  balance: number;
  payments: number;
  charges: number;
  interestAndFees: number;
  adjustments: number;
  netChange: number;
  transactionCount: number;
}>;

export type MilestoneStatus = 'completed' | 'in_progress' | 'locked';

export type Milestone = Readonly<{
  id: string;
  title: string;
  description: string;
  targetValue: number;
  currentValue: number;
  percent: number;
  status: MilestoneStatus;
  earnedDate?: string | null;
}>;

export type CreditUtilizationSummary = Readonly<{
  totalLimit: number;
  totalUsed: number;
  availableCredit: number;
  utilizationPercent: number;
  trackedCardsCount: number;
  totalCardsCount: number;
  statusBand: 'optimal' | 'good' | 'moderate' | 'high' | 'unavailable';
}>;

function roundToCurrency(amount: number, currencyCode: string): number {
  const scale = getCurrency(currencyCode).scale;
  return Math.round(amount * 10 ** scale) / 10 ** scale;
}

function getPreviousMonth(monthStr: string): string {
  const [yearStr, mStr] = monthStr.split('-');
  let y = Number(yearStr);
  let m = Number(mStr) - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** Filter transactions belonging to a given progress period relative to today. */
export function filterTransactionsByPeriod(
  transactions: readonly LedgerTransaction[],
  period: ProgressPeriod,
  today: DateOnly,
): LedgerTransaction[] {
  const currentMonth = today.slice(0, 7);
  const previousMonth = getPreviousMonth(currentMonth);

  return transactions.filter(tx => {
    if (tx.deletedAt !== null) return false;
    const txMonth = tx.date.slice(0, 7);
    if (period === 'current_month') return txMonth === currentMonth;
    if (period === 'previous_month') return txMonth === previousMonth;
    return true; // lifetime
  });
}

/** Aggregate period activity from recorded transactions using centralized money primitives. */
export function calculateActivitySummary(params: {
  transactions: readonly LedgerTransaction[];
  debts: readonly ProgressDebtItem[];
  period: ProgressPeriod;
  today: DateOnly;
  currencyCode?: string;
}): ActivitySummary {
  const { transactions, debts, period, today, currencyCode = 'USD' } = params;
  const filtered = filterTransactionsByPeriod(transactions, period, today).filter(tx => !tx.isPending);

  let totalPayments = 0;
  let principalReduction = 0;
  let newSpending = 0;
  let totalInterestAndFees = 0;
  let totalAdjustments = 0;
  let netDebtDeltaMinor = 0;

  for (const tx of filtered) {
    if (tx.amount.currency !== currencyCode) {
      throw new TypeError(`Currency mismatch: summary expected ${currencyCode}, transaction has ${tx.amount.currency}`);
    }
    if (tx.principalAmount && tx.principalAmount.currency !== currencyCode) {
      throw new TypeError(`Currency mismatch: summary expected ${currencyCode}, transaction principal has ${tx.principalAmount.currency}`);
    }
    const amount = moneyToMajor(tx.amount);
    const debt = debts.find(d => d.id === tx.accountId);

    if (debt) {
      const delta = calculateTransactionBalanceDelta(tx, debt.category);
      netDebtDeltaMinor += delta.minorUnits;
    }

    if (tx.source === 'reconciliation') {
      totalAdjustments += amount;
    } else if (tx.category === 'payment' && debt) {
      totalPayments += amount;
      // Follow the ledger's payment reduction policy; refunds and adjustments are excluded.
      principalReduction -= moneyToMajor(calculateTransactionBalanceDelta(tx, debt.category));
    } else if (tx.category === 'refund') {
      // Per Finding 5: Merchant refund is a merchant credit reducing balance owed, NOT a repayment or negative payment!
      // Its balance reduction is accurately reflected in netDebtDeltaMinor via calculateTransactionBalanceDelta.
    } else if (
      tx.category === 'interest' ||
      tx.category === 'fee' ||
      tx.category === 'annual_fee'
    ) {
      totalInterestAndFees += amount;
    } else if (classifyCategoryDirection(tx.category) === 'increase_debt') {
      newSpending += amount;
    }
  }

  const scale = getCurrency(currencyCode).scale;
  const netBalanceChange = roundToCurrency(netDebtDeltaMinor / 10 ** scale, currencyCode);
  // Without coverage or explicit payoff events, snapshots cannot establish a payoff period.
  const accountsPaidOffCount = null;
  const debtPaidDown = roundToCurrency(principalReduction, currencyCode);

  return {
    period,
    totalPayments: roundToCurrency(totalPayments, currencyCode),
    principalReduction: roundToCurrency(principalReduction, currencyCode),
    newSpending: roundToCurrency(newSpending, currencyCode),
    totalInterestAndFees: roundToCurrency(totalInterestAndFees, currencyCode),
    totalAdjustments: roundToCurrency(totalAdjustments, currencyCode),
    netBalanceChange,
    debtPaidDown,
    accountsPaidOffCount,
    transactionsCount: filtered.length,
  };
}

/** Break down transactions by specific debt account. */
export function calculateAccountActivities(params: {
  transactions: readonly LedgerTransaction[];
  debts: readonly ProgressDebtItem[];
  period: ProgressPeriod;
  today: DateOnly;
  currencyCode?: string;
}): AccountActivity[] {
  const { transactions, debts, period, today, currencyCode = 'USD' } = params;
  const filtered = filterTransactionsByPeriod(transactions, period, today).filter(tx => !tx.isPending);

  return debts.map(debt => {
    const accountTxs = filtered.filter(tx => tx.accountId === debt.id);
    let payments = 0;
    let charges = 0;
    let interestAndFees = 0;
    let adjustments = 0;
    let netDeltaMinor = 0;

    for (const tx of accountTxs) {
      if (tx.amount.currency !== currencyCode) {
        throw new TypeError(`Currency mismatch: account activities expected ${currencyCode}, transaction has ${tx.amount.currency}`);
      }
      const amt = moneyToMajor(tx.amount);
      const delta = calculateTransactionBalanceDelta(tx, debt.category);
      netDeltaMinor += delta.minorUnits;

      if (tx.source === 'reconciliation') {
        adjustments += amt;
      } else if (tx.category === 'payment') {
        payments += amt;
      } else if (tx.category === 'refund') {
        // Merchant refund is a merchant credit reducing balance owed, not a repayment
      } else if (
        tx.category === 'interest' ||
        tx.category === 'fee' ||
        tx.category === 'annual_fee'
      ) {
        interestAndFees += amt;
        charges += amt;
      } else if (classifyCategoryDirection(tx.category) === 'increase_debt') {
        charges += amt;
      }
    }

    const scale = getCurrency(currencyCode).scale;
    return {
      accountId: debt.id,
      accountName: debt.name,
      category: debt.category,
      balance: debt.balance,
      payments: roundToCurrency(payments, currencyCode),
      charges: roundToCurrency(charges, currencyCode),
      interestAndFees: roundToCurrency(interestAndFees, currencyCode),
      adjustments: roundToCurrency(adjustments, currencyCode),
      netChange: roundToCurrency(netDeltaMinor / 10 ** scale, currencyCode),
      transactionCount: accountTxs.length,
    };
  });
}

/** Compute overall revolving credit utilization. */
export function calculateCreditUtilization(
  debts: readonly ProgressDebtItem[],
  currencyCode = 'USD',
): CreditUtilizationSummary {
  const cards = debts.filter(d => d.category === 'Credit card');
  const tracked = cards.filter(d => d.creditLimit !== null && d.creditLimit > 0);

  const totalLimit = tracked.reduce((sum, d) => sum + (d.creditLimit ?? 0), 0);
  const totalUsed = tracked.reduce((sum, d) => sum + Math.max(0, d.balance), 0);
  const availableCredit = Math.max(0, totalLimit - totalUsed);
  const utilizationPercent = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;

  let statusBand: CreditUtilizationSummary['statusBand'] = 'unavailable';
  if (tracked.length > 0) {
    if (utilizationPercent < 10) statusBand = 'optimal';
    else if (utilizationPercent <= 30) statusBand = 'good';
    else if (utilizationPercent <= 50) statusBand = 'moderate';
    else statusBand = 'high';
  }

  return {
    totalLimit: roundToCurrency(totalLimit, currencyCode),
    totalUsed: roundToCurrency(totalUsed, currencyCode),
    availableCredit: roundToCurrency(availableCredit, currencyCode),
    utilizationPercent: Math.round(utilizationPercent * 10) / 10,
    trackedCardsCount: tracked.length,
    totalCardsCount: cards.length,
    statusBand,
  };
}

/** Milestones supported by confirmed recorded debt payments. History may be partial. */
export function calculateMilestones(params: {
  debts: readonly ProgressDebtItem[];
  transactions: readonly LedgerTransaction[];
  currencyCode?: string;
  excludedUtilizationDebtIds?: readonly string[];
}): Milestone[] {
  const { debts, transactions, currencyCode = 'USD', excludedUtilizationDebtIds = [] } = params;
  const debtIds = new Set(debts.map(debt => debt.id));
  const paymentTxs = transactions.filter(tx =>
    tx.deletedAt === null && !tx.isPending && tx.category === 'payment' &&
    tx.source !== 'reconciliation' && tx.accountId !== null && debtIds.has(tx.accountId) && tx.amount.minorUnits > 0
  );
  for (const tx of paymentTxs) {
    if (tx.amount.currency !== currencyCode) {
      throw new TypeError(`Currency mismatch: milestones expected ${currencyCode}, transaction has ${tx.amount.currency}`);
    }
  }
  const debtById = new Map(debts.map(debt => [debt.id, debt]));
  const total = roundToCurrency(paymentTxs.reduce((sum, tx) => sum - moneyToMajor(calculateTransactionBalanceDelta(tx, debtById.get(tx.accountId!)!.category)), 0), currencyCode);
  const firstDate = paymentTxs.reduce<string | null>((first, tx) => !first || tx.date < first ? tx.date : first, null);
  const excludedUtilizationIds = new Set(excludedUtilizationDebtIds);
  const utilization = calculateCreditUtilization(debts.filter(debt => !excludedUtilizationIds.has(debt.id)), currencyCode);
  const hasPendingBalanceWrites = transactions.some(tx => tx.isPending && tx.deletedAt === null && tx.accountId !== null);
  const unavailable = (id: string, title: string, targetValue: number): Milestone => ({
    id, title, targetValue, currentValue: 0, percent: 0, status: 'locked',
    description: 'Unavailable: recorded payoff events and complete history coverage are needed.',
  });
  return [
    {
      id: 'first_payment', title: 'First payment recorded',
      description: 'Record your first debt payment in the ledger', targetValue: 1,
      currentValue: paymentTxs.length, percent: paymentTxs.length ? 100 : 0,
      status: paymentTxs.length ? 'completed' : 'in_progress', earnedDate: firstDate,
    },
    unavailable('first_debt_cleared', 'First debt paid off', 1),
    {
      id: 'first_1000', title: 'First 1,000 in payment balance reduction',
      description: 'Record 1,000 in payment balance reductions; unallocated auto and mortgage payments do not count.', targetValue: 1000,
      currentValue: total, percent: Math.min(100, Math.round(total / 10)),
      status: total >= 1000 ? 'completed' : 'in_progress',
    },
    unavailable('progress_25', '25% Debt Free', 25),
    unavailable('progress_50', 'Halfway Mark (50%)', 50),
    {
      id: 'credit_util_30', title: 'Current credit utilization at or below 30%',
      description: hasPendingBalanceWrites ? 'Unavailable while balance changes are pending.' : utilization.totalLimit > 0 ? 'Current-state goal based on tracked card balances and limits; not a historical achievement.' : 'Unavailable until a card with a credit limit is tracked.',
      targetValue: 30, currentValue: utilization.utilizationPercent,
      percent: !hasPendingBalanceWrites && utilization.totalLimit > 0 ? utilization.utilizationPercent <= 30 ? 100 : Math.max(0, Math.round((100 - utilization.utilizationPercent) / 70 * 100)) : 0,
      status: hasPendingBalanceWrites || utilization.totalLimit <= 0 ? 'locked' : utilization.utilizationPercent <= 30 ? 'completed' : 'in_progress',
    },
    unavailable('progress_75', '75% Debt Free', 75),
    unavailable('progress_100', '100% Debt Free', 100),
  ];
}
