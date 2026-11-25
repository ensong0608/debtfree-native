// Node's direct TypeScript loader requires the extension; Expo resolves it as well.
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type DateOnly } from './calendar.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type LedgerTransaction, calculateTransactionBalanceDelta } from './ledger.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { moneyToMajor, moneyFromMajor } from './money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { getCurrency } from './currencies.ts';

export type ProgressPeriod = 'current_month' | 'previous_month' | 'lifetime' | `${number}` | `${number}-${number}`;

export type ProgressDebtItem = Readonly<{
  id: string;
  name: string;
  category: string;
  balance: number;
  originalBalance: number | null;
  creditLimit: number | null;
  apr?: number;
}>;

export type ActivitySummary = Readonly<{
  period: ProgressPeriod;
  totalPayments: number;
  nonMortgagePayments: number;
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
    if (period === 'lifetime') return true;
    if (/^\d{4}$/.test(period)) return tx.date.slice(0, 4) === period;
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return txMonth === period;
    return false;
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
  let nonMortgagePayments = 0;
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

    if (
      tx.source === 'reconciliation' ||
      tx.category === 'interest_adjustment' ||
      tx.category === 'balance_adjustment' ||
      tx.category === 'credit_adjustment'
    ) {
      totalAdjustments += amount;
    } else if (tx.category === 'payment' && debt) {
      totalPayments += amount;
      if (debt.category !== 'Mortgage') {
        nonMortgagePayments += amount;
      }
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
    } else if (
      tx.category === 'purchase' ||
      tx.category === 'subscription' ||
      tx.category === 'utilities'
    ) {
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
    nonMortgagePayments: roundToCurrency(nonMortgagePayments, currencyCode),
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

      if (
        tx.source === 'reconciliation' ||
        tx.category === 'interest_adjustment' ||
        tx.category === 'balance_adjustment' ||
        tx.category === 'credit_adjustment'
      ) {
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
      } else if (
        tx.category === 'purchase' ||
        tx.category === 'subscription' ||
        tx.category === 'utilities'
      ) {
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

/** Milestones supported by confirmed recorded debt payments and starting balance references. */
export function calculateMilestones(params: {
  debts: readonly ProgressDebtItem[];
  transactions: readonly LedgerTransaction[];
  currencyCode?: string;
  excludedUtilizationDebtIds?: readonly string[];
  archivedPaidOffDebtIds?: readonly string[];
}): Milestone[] {
  const {
    debts,
    transactions,
    currencyCode = 'USD',
    excludedUtilizationDebtIds = [],
    archivedPaidOffDebtIds = excludedUtilizationDebtIds,
  } = params;
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
  const archivedSet = new Set(archivedPaidOffDebtIds);
  const utilization = calculateCreditUtilization(debts.filter(debt => !excludedUtilizationIds.has(debt.id)), currencyCode);
  const hasPendingBalanceWrites = transactions.some(tx => tx.isPending && tx.deletedAt === null && tx.accountId !== null);

  const clearedDebts = debts.filter(
    debt =>
      debt.balance === 0 &&
      (archivedSet.has(debt.id) ||
        (debt.originalBalance != null && debt.originalBalance > 0) ||
        paymentTxs.some(tx => tx.accountId === debt.id)),
  );
  const firstDebtCleared: Milestone = hasPendingBalanceWrites
    ? {
        id: 'first_debt_cleared',
        title: 'First debt paid off',
        description: 'Unavailable while balance changes are pending.',
        targetValue: 1,
        currentValue: 0,
        percent: 0,
        status: 'locked',
      }
    : debts.length === 0
      ? {
          id: 'first_debt_cleared',
          title: 'First debt paid off',
          description: 'Add a debt account to start tracking your first payoff.',
          targetValue: 1,
          currentValue: 0,
          percent: 0,
          status: 'locked',
        }
      : {
          id: 'first_debt_cleared',
          title: 'First debt paid off',
          description: clearedDebts.length > 0
            ? `${clearedDebts.length} ${clearedDebts.length === 1 ? 'account' : 'accounts'} paid off to zero.`
            : 'Pay an account down to a zero balance or mark it paid off.',
          targetValue: 1,
          currentValue: clearedDebts.length,
          percent: clearedDebts.length > 0 ? 100 : 0,
          status: clearedDebts.length > 0 ? 'completed' : 'in_progress',
        };

  const totalRemaining = debts.reduce((sum, d) => sum + Math.max(0, d.balance), 0);
  const totalStarting = debts.reduce((sum, d) => sum + Math.max(0, d.balance, d.originalBalance ?? d.balance), 0);
  const hasStartingReference = debts.some(d => d.originalBalance != null && d.originalBalance > 0);
  const overallProgressPercent =
    debts.length > 0 && totalRemaining === 0
      ? 100
      : hasStartingReference && totalStarting > 0
        ? Math.max(0, Math.min(100, Math.round(((totalStarting - totalRemaining) / totalStarting) * 100)))
        : null;

  const progressMilestone = (id: string, title: string, targetPercent: number): Milestone =>
    hasPendingBalanceWrites || overallProgressPercent === null
      ? {
          id,
          title,
          targetValue: targetPercent,
          currentValue: 0,
          percent: 0,
          status: 'locked',
          description: hasPendingBalanceWrites
            ? 'Unavailable while balance changes are pending.'
            : 'Unavailable: enter starting balances on your accounts to track overall percentage progress.',
        }
      : {
          id,
          title,
          targetValue: targetPercent,
          currentValue: overallProgressPercent,
          percent: Math.min(100, Math.round((overallProgressPercent / targetPercent) * 100)),
          status: overallProgressPercent >= targetPercent ? 'completed' : 'in_progress',
          description: overallProgressPercent >= targetPercent
            ? `Reached ${targetPercent}% debt reduction across tracked starting balances.`
            : `${overallProgressPercent}% of ${targetPercent}% overall debt reduction reached.`,
        };

  return [
    {
      id: 'first_payment', title: 'First payment recorded',
      description: 'Record your first debt payment in the ledger', targetValue: 1,
      currentValue: paymentTxs.length, percent: paymentTxs.length ? 100 : 0,
      status: paymentTxs.length ? 'completed' : 'in_progress', earnedDate: firstDate,
    },
    firstDebtCleared,
    {
      id: 'first_1000', title: 'First 1,000 in payment balance reduction',
      description: 'Record 1,000 in payment balance reductions; unallocated auto and mortgage payments do not count.', targetValue: 1000,
      currentValue: total, percent: Math.min(100, Math.round(total / 10)),
      status: total >= 1000 ? 'completed' : 'in_progress',
    },
    progressMilestone('progress_25', '25% Debt Free', 25),
    progressMilestone('progress_50', 'Halfway Mark (50%)', 50),
    {
      id: 'credit_util_30', title: 'Current credit utilization at or below 30%',
      description: hasPendingBalanceWrites ? 'Unavailable while balance changes are pending.' : utilization.totalLimit > 0 ? 'Current-state goal based on tracked card balances and limits; not a historical achievement.' : 'Unavailable until a card with a credit limit is tracked.',
      targetValue: 30, currentValue: utilization.utilizationPercent,
      percent: !hasPendingBalanceWrites && utilization.totalLimit > 0 ? utilization.utilizationPercent <= 30 ? 100 : Math.max(0, Math.round((100 - utilization.utilizationPercent) / 70 * 100)) : 0,
      status: hasPendingBalanceWrites || utilization.totalLimit <= 0 ? 'locked' : utilization.utilizationPercent <= 30 ? 'completed' : 'in_progress',
    },
    progressMilestone('progress_75', '75% Debt Free', 75),
    progressMilestone('progress_100', '100% Debt Free', 100),
  ];
}

/** Suggest a tracked card with utilization above 30%, prioritizing highest APR when known. */
export function calculateUtilizationAdvisor(debts: readonly ProgressDebtItem[], currencyCode = 'USD'): { bestCardId: string; cardName: string; currentPercent: number; projectedCardPercent: number; paydownTo30: number; projectedOverallPercent: number } | null {
  const tracked = debts.filter(d => d.category === 'Credit card' && d.creditLimit !== null && d.creditLimit > 0 && Number.isFinite(d.balance));
  const candidates = tracked.filter(d => d.balance / d.creditLimit! > 0.3);
  candidates.sort((a, b) => (b.apr ?? -1) - (a.apr ?? -1) || b.balance / b.creditLimit! - a.balance / a.creditLimit! || b.balance - a.balance || a.id.localeCompare(b.id));
  const card = candidates[0];
  if (!card) return null;
  const balance = moneyFromMajor(card.balance, currencyCode).minorUnits;
  const limit = moneyFromMajor(card.creditLimit!, currencyCode).minorUnits;
  const paydown = Math.max(0, balance - Number(BigInt(limit) * 3n / 10n));
  const totalLimit = tracked.reduce((sum, d) => sum + moneyFromMajor(d.creditLimit!, currencyCode).minorUnits, 0);
  const totalUsed = tracked.reduce((sum, d) => sum + Math.max(0, moneyFromMajor(d.balance, currencyCode).minorUnits), 0);
  return { bestCardId: card.id, cardName: card.name, currentPercent: balance / limit * 100, projectedCardPercent: (balance - paydown) / limit * 100, paydownTo30: moneyToMajor({ currency: currencyCode, minorUnits: paydown }), projectedOverallPercent: (totalUsed - paydown) / totalLimit * 100 };
}
