// Node's direct TypeScript loader requires the extension; Expo resolves it as well.
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type DateOnly } from './calendar.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type LedgerTransaction, classifyCategoryDirection } from './ledger.ts';

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
  totalInterestAndFees: number;
  totalAdjustments: number;
  netBalanceChange: number;
  debtPaidDown: number;
  accountsPaidOffCount: number;
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

/** Aggregate period activity from recorded transactions. */
export function calculateActivitySummary(params: {
  transactions: readonly LedgerTransaction[];
  debts: readonly ProgressDebtItem[];
  period: ProgressPeriod;
  today: DateOnly;
}): ActivitySummary {
  const { transactions, debts, period, today } = params;
  const filtered = filterTransactionsByPeriod(transactions, period, today);

  let totalPayments = 0;
  let totalInterestAndFees = 0;
  let totalAdjustments = 0;
  let totalCharges = 0;

  for (const tx of filtered) {
    const amount = tx.amount.minorUnits / 100;

    if (tx.source === 'reconciliation') {
      totalAdjustments += amount;
      if (classifyCategoryDirection(tx.category) === 'increase_debt') {
        totalCharges += amount;
      } else if (classifyCategoryDirection(tx.category) === 'decrease_debt') {
        totalPayments += amount;
      }
    } else if (tx.category === 'payment' || tx.category === 'refund') {
      totalPayments += amount;
    } else if (
      tx.category === 'interest' ||
      tx.category === 'fee' ||
      tx.category === 'annual_fee'
    ) {
      totalInterestAndFees += amount;
      totalCharges += amount;
    } else if (classifyCategoryDirection(tx.category) === 'increase_debt') {
      totalCharges += amount;
    }
  }

  const netBalanceChange = Math.round((totalCharges - totalPayments) * 100) / 100;
  const debtPaidDown = Math.max(0, Math.round((totalPayments - totalCharges) * 100) / 100);
  const accountsPaidOffCount = debts.filter(d => d.balance <= 0).length;

  return {
    period,
    totalPayments: Math.round(totalPayments * 100) / 100,
    totalInterestAndFees: Math.round(totalInterestAndFees * 100) / 100,
    totalAdjustments: Math.round(totalAdjustments * 100) / 100,
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
}): AccountActivity[] {
  const { transactions, debts, period, today } = params;
  const filtered = filterTransactionsByPeriod(transactions, period, today);

  return debts.map(debt => {
    const accountTxs = filtered.filter(tx => tx.accountId === debt.id);
    let payments = 0;
    let charges = 0;
    let interestAndFees = 0;
    let adjustments = 0;

    for (const tx of accountTxs) {
      const amt = tx.amount.minorUnits / 100;
      if (tx.source === 'reconciliation') {
        adjustments += amt;
        if (classifyCategoryDirection(tx.category) === 'increase_debt') charges += amt;
        else if (classifyCategoryDirection(tx.category) === 'decrease_debt') payments += amt;
      } else if (tx.category === 'payment' || tx.category === 'refund') {
        payments += amt;
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

    return {
      accountId: debt.id,
      accountName: debt.name,
      category: debt.category,
      balance: debt.balance,
      payments: Math.round(payments * 100) / 100,
      charges: Math.round(charges * 100) / 100,
      interestAndFees: Math.round(interestAndFees * 100) / 100,
      adjustments: Math.round(adjustments * 100) / 100,
      netChange: Math.round((charges - payments) * 100) / 100,
      transactionCount: accountTxs.length,
    };
  });
}

/** Compute overall revolving credit utilization. */
export function calculateCreditUtilization(debts: readonly ProgressDebtItem[]): CreditUtilizationSummary {
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
    totalLimit: Math.round(totalLimit * 100) / 100,
    totalUsed: Math.round(totalUsed * 100) / 100,
    availableCredit: Math.round(availableCredit * 100) / 100,
    utilizationPercent: Math.round(utilizationPercent * 10) / 10,
    trackedCardsCount: tracked.length,
    totalCardsCount: cards.length,
    statusBand,
  };
}

/** Compute real earned payoff milestones. */
export function calculateMilestones(params: {
  debts: readonly ProgressDebtItem[];
  transactions: readonly LedgerTransaction[];
}): Milestone[] {
  const { debts, transactions } = params;

  // Real recorded payments (excluding reconciliation drift adjustments)
  const paymentTxs = transactions.filter(
    tx => tx.deletedAt === null && tx.category === 'payment' && tx.source !== 'reconciliation'
  );
  const totalPaymentsAmount = paymentTxs.reduce(
    (sum, tx) => sum + tx.amount.minorUnits / 100,
    0
  );

  // Total debt starting vs current
  const totalCurrentDebt = debts.reduce((sum, d) => sum + Math.max(0, d.balance), 0);
  const totalStartingDebt = debts.reduce(
    (sum, d) => sum + Math.max(0, d.originalBalance ?? d.balance),
    0
  );

  const totalReduction = Math.max(0, totalStartingDebt - totalCurrentDebt);
  const overallProgressPercent =
    totalStartingDebt > 0
      ? Math.min(100, Math.round((totalReduction / totalStartingDebt) * 100))
      : totalCurrentDebt === 0 ? 100 : 0;

  const paidOffAccountsCount = debts.filter(d => d.balance <= 0).length;
  const utilization = calculateCreditUtilization(debts);

  const milestones: Milestone[] = [
    {
      id: 'first_payment',
      title: 'First payment recorded',
      description: 'Record your first debt payment in the ledger',
      targetValue: 1,
      currentValue: paymentTxs.length,
      percent: paymentTxs.length >= 1 ? 100 : 0,
      status: paymentTxs.length >= 1 ? 'completed' : 'in_progress',
      earnedDate: paymentTxs.length >= 1 ? paymentTxs[paymentTxs.length - 1].date : null,
    },
    {
      id: 'first_debt_cleared',
      title: 'First debt paid off',
      description: 'Bring any card or loan balance completely down to $0',
      targetValue: 1,
      currentValue: paidOffAccountsCount,
      percent: paidOffAccountsCount >= 1 ? 100 : 0,
      status: paidOffAccountsCount >= 1 ? 'completed' : 'in_progress',
    },
    {
      id: 'first_1000',
      title: 'First $1,000 paid down',
      description: 'Pay down $1,000 in recorded debt payments',
      targetValue: 1000,
      currentValue: Math.round(totalPaymentsAmount * 100) / 100,
      percent: Math.min(100, Math.round((totalPaymentsAmount / 1000) * 100)),
      status: totalPaymentsAmount >= 1000 ? 'completed' : 'in_progress',
    },
    {
      id: 'progress_25',
      title: '25% Debt Free',
      description: 'Eliminate one-quarter of your total debt obligations',
      targetValue: 25,
      currentValue: overallProgressPercent,
      percent: Math.min(100, Math.round((overallProgressPercent / 25) * 100)),
      status: overallProgressPercent >= 25 ? 'completed' : overallProgressPercent > 0 ? 'in_progress' : 'locked',
    },
    {
      id: 'progress_50',
      title: 'Halfway Mark (50%)',
      description: 'Pay off half of your total debt obligations',
      targetValue: 50,
      currentValue: overallProgressPercent,
      percent: Math.min(100, Math.round((overallProgressPercent / 50) * 100)),
      status: overallProgressPercent >= 50 ? 'completed' : overallProgressPercent >= 25 ? 'in_progress' : 'locked',
    },
    {
      id: 'credit_util_30',
      title: 'Under 30% Credit Utilization',
      description: 'Lower overall credit card utilization below the 30% healthy threshold',
      targetValue: 30,
      currentValue: utilization.utilizationPercent,
      percent:
        utilization.totalLimit > 0
          ? utilization.utilizationPercent <= 30
            ? 100
            : Math.max(0, Math.round(((100 - utilization.utilizationPercent) / 70) * 100))
          : 0,
      status:
        utilization.totalLimit > 0 && utilization.utilizationPercent <= 30
          ? 'completed'
          : utilization.totalLimit > 0
            ? 'in_progress'
            : 'locked',
    },
    {
      id: 'progress_75',
      title: '75% Debt Free',
      description: 'Three-quarters of your debt eliminated',
      targetValue: 75,
      currentValue: overallProgressPercent,
      percent: Math.min(100, Math.round((overallProgressPercent / 75) * 100)),
      status: overallProgressPercent >= 75 ? 'completed' : overallProgressPercent >= 50 ? 'in_progress' : 'locked',
    },
    {
      id: 'progress_100',
      title: '100% Debt Free!',
      description: 'All active credit cards and loans completely paid off',
      targetValue: 100,
      currentValue: overallProgressPercent,
      percent: overallProgressPercent,
      status: overallProgressPercent >= 100 ? 'completed' : 'in_progress',
    },
  ];

  return milestones;
}
