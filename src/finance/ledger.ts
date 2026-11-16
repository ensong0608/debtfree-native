// Node's direct TypeScript loader requires the extension; Expo resolves it as well.
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { addMoney, makeMoney, type Money } from './money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { parseDateOnly, type DateOnly } from './calendar.ts';

export type TransactionCategory =
  // Debt charges (increase debt on liability account)
  | 'purchase'
  | 'subscription'
  | 'utilities'
  | 'interest'
  | 'fee'
  | 'annual_fee'
  | 'interest_adjustment'
  | 'balance_adjustment'
  // Debt reductions (decrease debt on liability account)
  | 'payment'
  | 'refund'
  | 'credit_adjustment'
  // Non-debt cashflow (checking / debit only, $0 debt impact)
  | 'debit_bill'
  | 'debit_spending';

export type TransactionDirection = 'increase_debt' | 'decrease_debt' | 'cash_only';

export type TransactionSource = 'manual' | 'recurring_bill' | 'reconciliation' | 'system';

export type LedgerTransaction = Readonly<{
  id: string;
  accountId: string | null; // null for debit/cashflow only, or target debt account ID
  date: DateOnly;
  appliesToDate?: DateOnly | null; // Optional cycle due date this transaction fulfills
  amount: Money; // Non-negative transaction magnitude
  category: TransactionCategory;
  payee: string;
  memo?: string;
  source: TransactionSource;
  reconciled: boolean;
  createdAt: string; // ISO 8601
  updatedAt?: string; // ISO 8601 server-authoritative modification revision
  deletedAt: string | null; // ISO 8601 when soft-deleted, or null
  isPending?: boolean; // True when transaction is an unconfirmed local/offline write
  // Allocation breakdown for amortizing installment debts (mortgage, auto):
  principalAmount?: Money | null;
  interestAmount?: Money | null;
  escrowAmount?: Money | null;
  feeAmount?: Money | null;
}>;

export type ReconciliationAnchor = Readonly<{
  id: string;
  accountId: string;
  asOfDate: DateOnly;
  verifiedBalance: Money; // Verified statement balance: positive = debt owed, negative = credit
  createdAt: string; // ISO 8601
  note?: string;
  createdAdjustmentId?: string | null;
  coveredTransactionIds?: readonly string[];
}>;

export type AccountReconciliationResult = Readonly<{
  accountId: string;
  currency: string;
  startingBalance: Money;
  currentBalance: Money;
  totalCharges: Money;
  totalPayments: Money;
  netChange: Money;
  activeTransactionCount: number;
  lastAnchorDate: DateOnly | null;
}>;

/** Classify whether a category increases debt, decreases debt, or is cashflow-only. */
export function classifyCategoryDirection(category: TransactionCategory): TransactionDirection {
  switch (category) {
    case 'purchase':
    case 'subscription':
    case 'utilities':
    case 'interest':
    case 'fee':
    case 'annual_fee':
    case 'interest_adjustment':
    case 'balance_adjustment':
      return 'increase_debt';

    case 'payment':
    case 'refund':
    case 'credit_adjustment':
      return 'decrease_debt';

    case 'debit_bill':
    case 'debit_spending':
      return 'cash_only';

    default: {
      const _exhaustive: never = category;
      throw new TypeError(`Unknown transaction category: ${String(_exhaustive)}`);
    }
  }
}

/** Validate transaction invariant properties. */
export function validateLedgerTransaction(tx: LedgerTransaction): void {
  if (!tx.id || typeof tx.id !== 'string') throw new TypeError('Transaction ID must be a non-empty string');
  parseDateOnly(tx.date);
  makeMoney(tx.amount.currency, tx.amount.minorUnits);
  if (tx.amount.minorUnits < 0) {
    throw new RangeError('Transaction amount magnitude must be non-negative and strictly positive');
  }
  if (tx.amount.minorUnits === 0) {
    throw new RangeError('Transaction amount magnitude must be strictly positive');
  }

  const direction = classifyCategoryDirection(tx.category);
  if (direction === 'cash_only' && tx.accountId !== null) {
    // Cash-only transactions do not attach directly to liability debt accounts
    throw new TypeError(`Cashflow category '${tx.category}' cannot target a debt account ID`);
  }
  if (direction !== 'cash_only' && !tx.accountId) {
    throw new TypeError(`Debt category '${tx.category}' requires a non-empty accountId`);
  }

  if (tx.category !== 'payment') {
    if (tx.principalAmount != null || tx.interestAmount != null || tx.escrowAmount != null || tx.feeAmount != null) {
      throw new TypeError(`Payment allocations are only permitted on payment transactions (got category '${tx.category}')`);
    }
  }

  // Validate allocations if present
  let totalAllocatedMinor = 0;
  const allocations = [
    { name: 'principalAmount', value: tx.principalAmount },
    { name: 'interestAmount', value: tx.interestAmount },
    { name: 'escrowAmount', value: tx.escrowAmount },
    { name: 'feeAmount', value: tx.feeAmount },
  ];

  for (const { name, value } of allocations) {
    if (value != null) {
      if (value.currency !== tx.amount.currency) {
        throw new TypeError(`Allocation ${name} currency '${value.currency}' does not match transaction currency '${tx.amount.currency}'`);
      }
      if (value.minorUnits < 0) {
        throw new RangeError(`Allocation ${name} magnitude must be non-negative`);
      }
      totalAllocatedMinor += value.minorUnits;
    }
  }

  if (totalAllocatedMinor > tx.amount.minorUnits) {
    throw new RangeError(`Total payment allocation (${totalAllocatedMinor}) cannot exceed total payment amount (${tx.amount.minorUnits})`);
  }
}

/** Calculate the unallocated portion of a payment transaction. */
export function getUnallocatedPaymentAmount(tx: LedgerTransaction): Money {
  if (tx.category !== 'payment') return makeMoney(tx.amount.currency, 0);
  let allocatedMinor = 0;
  if (tx.principalAmount) allocatedMinor += tx.principalAmount.minorUnits;
  if (tx.interestAmount) allocatedMinor += tx.interestAmount.minorUnits;
  if (tx.escrowAmount) allocatedMinor += tx.escrowAmount.minorUnits;
  if (tx.feeAmount) allocatedMinor += tx.feeAmount.minorUnits;
  return makeMoney(tx.amount.currency, Math.max(0, tx.amount.minorUnits - allocatedMinor));
}

/**
 * Calculate the signed delta that a transaction applies to a debt balance:
 * positive increases balance owed, negative decreases balance owed.
 * For Mortgage and Auto loans, payments without an explicit principal allocation
 * do not reduce principal (the breakdown is unknown).
 */
export function calculateTransactionBalanceDelta(tx: LedgerTransaction, debtCategory?: string): Money {
  validateLedgerTransaction(tx);
  if (tx.deletedAt !== null) return makeMoney(tx.amount.currency, 0);

  const direction = classifyCategoryDirection(tx.category);
  if (direction === 'cash_only') return makeMoney(tx.amount.currency, 0);

  if (direction === 'increase_debt') {
    return tx.amount;
  }

  // direction === 'decrease_debt'
  if (tx.category === 'payment') {
    if (debtCategory === 'Mortgage' || debtCategory === 'Auto loan') {
      if (tx.principalAmount != null) {
        return makeMoney(tx.amount.currency, -tx.principalAmount.minorUnits);
      }
      // Payment breakdown is unknown. Preserve the payment record without inventing principal reductions.
      return makeMoney(tx.amount.currency, 0);
    }

    // Revolving debt or general loan
    if (tx.principalAmount != null) {
      return makeMoney(tx.amount.currency, -tx.principalAmount.minorUnits);
    }
    return makeMoney(tx.amount.currency, -tx.amount.minorUnits);
  }

  // refund or credit_adjustment
  return makeMoney(tx.amount.currency, -tx.amount.minorUnits);
}

/** Archive state is a durable server setting, written with the confirmed payoff mutation. */
export function isPaidOffAccountArchived(
  account: { id: string; category: string; balance: number },
  archivedPaidOffDebtIds: readonly string[] = [],
): boolean {
  return account.balance === 0 && archivedPaidOffDebtIds.includes(account.id);
}

/** Apply a single transaction to an account's running balance. */
export function applyTransactionToBalance(balance: Money, tx: LedgerTransaction, debtCategory?: string): Money {
  validateLedgerTransaction(tx);
  if (balance.currency !== tx.amount.currency) {
    throw new TypeError(`Currency mismatch: account has ${balance.currency}, transaction has ${tx.amount.currency}`);
  }
  const delta = calculateTransactionBalanceDelta(tx, debtCategory);
  return addMoney(balance, delta);
}

/**
 * Reconcile an account's current balance from an opening baseline or its latest verified anchor.
 */
export function calculateReconciledBalance(params: {
  openingBalance: Money;
  anchor?: ReconciliationAnchor | null;
  transactions: readonly LedgerTransaction[];
  accountId: string;
  debtCategory?: string;
}): AccountReconciliationResult {
  const { openingBalance, anchor, transactions, accountId, debtCategory } = params;
  makeMoney(openingBalance.currency, openingBalance.minorUnits);

  if (anchor) {
    if (anchor.accountId !== accountId) {
      throw new TypeError(`Anchor account ID '${anchor.accountId}' does not match requested account '${accountId}'`);
    }
    if (anchor.verifiedBalance.currency !== openingBalance.currency) {
      throw new TypeError(`Anchor currency mismatch: expected ${openingBalance.currency}, got ${anchor.verifiedBalance.currency}`);
    }
    parseDateOnly(anchor.asOfDate);
  }

  const currency = openingBalance.currency;
  const startingBalance = anchor ? anchor.verifiedBalance : openingBalance;
  let runningBalance = startingBalance;
  let netChange = makeMoney(currency, 0);
  let totalCharges = makeMoney(currency, 0);
  let totalPayments = makeMoney(currency, 0);
  let activeCount = 0;

  for (const tx of transactions) {
    if (tx.deletedAt !== null) continue;
    if (tx.accountId !== accountId) continue;

    // If an anchor exists, guard strictly against double-counting drift or pre-anchor activity:
    if (anchor) {
      // 1. Skip any drift adjustment transaction generated for or alongside this anchor
      if (anchor.createdAdjustmentId && tx.id === anchor.createdAdjustmentId) {
        continue;
      }
      // 2. Skip any reconciliation transaction dated on or before the anchor
      if (tx.source === 'reconciliation' && tx.date <= anchor.asOfDate) {
        continue;
      }
      // 3. Skip transactions dated strictly before the anchor date
      if (tx.date < anchor.asOfDate) {
        continue;
      }
      // 4. Skip transactions explicitly covered by the anchor
      if (anchor.coveredTransactionIds && anchor.coveredTransactionIds.includes(tx.id)) {
        continue;
      }
      // 5. For same-day transactions, if both have timestamps and tx occurred at or before the anchor
      if (tx.date === anchor.asOfDate && tx.createdAt && anchor.createdAt && tx.createdAt <= anchor.createdAt) {
        continue;
      }
    }

    validateLedgerTransaction(tx);
    const direction = classifyCategoryDirection(tx.category);
    const delta = calculateTransactionBalanceDelta(tx, debtCategory);
    runningBalance = addMoney(runningBalance, delta);
    netChange = addMoney(netChange, delta);

    if (direction === 'increase_debt') {
      totalCharges = addMoney(totalCharges, tx.amount);
      activeCount++;
    } else if (direction === 'decrease_debt') {
      totalPayments = addMoney(totalPayments, tx.amount);
      activeCount++;
    }
  }

  return {
    accountId,
    currency,
    startingBalance,
    currentBalance: runningBalance,
    totalCharges,
    totalPayments,
    netChange,
    activeTransactionCount: activeCount,
    lastAnchorDate: anchor ? anchor.asOfDate : null,
  };
}

/**
 * Create a new statement reconciliation anchor and calculate any necessary drift adjustment transaction.
 */
export function createReconciliationAnchor(params: {
  accountId: string;
  asOfDate: DateOnly;
  verifiedBalance: Money;
  currentCalculatedBalance: Money;
  reason?: 'interest_adjustment' | 'balance_adjustment' | 'credit_adjustment';
  note?: string;
  now?: Date;
}): {
  newAnchor: ReconciliationAnchor;
  adjustmentTransaction: LedgerTransaction | null;
} {
  const {
    accountId,
    asOfDate,
    verifiedBalance,
    currentCalculatedBalance,
    reason,
    note,
    now = new Date(),
  } = params;

  parseDateOnly(asOfDate);
  makeMoney(verifiedBalance.currency, verifiedBalance.minorUnits);
  makeMoney(currentCalculatedBalance.currency, currentCalculatedBalance.minorUnits);

  if (verifiedBalance.currency !== currentCalculatedBalance.currency) {
    throw new TypeError(`Cannot reconcile different currencies: ${verifiedBalance.currency} vs ${currentCalculatedBalance.currency}`);
  }

  const currency = verifiedBalance.currency;
  const drift = verifiedBalance.minorUnits - currentCalculatedBalance.minorUnits;
  const anchorId = `anchor:${accountId}:${asOfDate}:${now.getTime()}`;
  const adjId = drift !== 0 ? `adj:${accountId}:${asOfDate}:${now.getTime()}` : null;

  const newAnchor: ReconciliationAnchor = {
    id: anchorId,
    accountId,
    asOfDate,
    verifiedBalance,
    createdAt: now.toISOString(),
    note,
    createdAdjustmentId: adjId,
  };

  let adjustmentTransaction: LedgerTransaction | null = null;

  if (drift > 0) {
    // Bank balance is higher than calculated balance: debt increased (e.g. unprojected interest compounding or fee)
    const category: TransactionCategory = reason === 'balance_adjustment' ? 'balance_adjustment' : 'interest_adjustment';
    adjustmentTransaction = {
      id: `adj:${accountId}:${asOfDate}:${now.getTime()}`,
      accountId,
      date: asOfDate,
      amount: makeMoney(currency, drift),
      category,
      payee: 'Statement Reconciliation Adjustment',
      memo: note || (category === 'interest_adjustment' ? 'Bank interest / compounding drift adjustment' : 'Balance adjustment'),
      source: 'reconciliation',
      reconciled: true,
      createdAt: now.toISOString(),
      deletedAt: null,
    };
  } else if (drift < 0) {
    // Bank balance is lower than calculated balance: debt decreased (e.g. unrecorded refund, reward credit)
    const category: TransactionCategory = reason === 'credit_adjustment' ? 'credit_adjustment' : 'credit_adjustment';
    adjustmentTransaction = {
      id: `adj:${accountId}:${asOfDate}:${now.getTime()}`,
      accountId,
      date: asOfDate,
      amount: makeMoney(currency, -drift),
      category,
      payee: 'Statement Reconciliation Credit',
      memo: note || 'Credit / balance reconciliation adjustment',
      source: 'reconciliation',
      reconciled: true,
      createdAt: now.toISOString(),
      deletedAt: null,
    };
  }

  return {
    newAnchor,
    adjustmentTransaction,
  };
}
