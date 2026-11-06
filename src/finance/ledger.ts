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
  deletedAt: string | null; // ISO 8601 when soft-deleted, or null
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
  if (tx.amount.minorUnits < 0) throw new RangeError('Transaction amount magnitude must be non-negative');

  const direction = classifyCategoryDirection(tx.category);
  if (direction === 'cash_only' && tx.accountId !== null) {
    // Cash-only transactions do not attach directly to liability debt accounts
    throw new TypeError(`Cashflow category '${tx.category}' cannot target a debt account ID`);
  }
  if (direction !== 'cash_only' && !tx.accountId) {
    throw new TypeError(`Debt category '${tx.category}' requires a non-empty accountId`);
  }
}

/** Apply a single transaction to an account's running balance. */
export function applyTransactionToBalance(balance: Money, tx: LedgerTransaction): Money {
  validateLedgerTransaction(tx);
  if (tx.deletedAt !== null) return balance; // Soft-deleted transactions have no economic effect

  const direction = classifyCategoryDirection(tx.category);
  if (direction === 'cash_only') return balance;

  if (balance.currency !== tx.amount.currency) {
    throw new TypeError(`Currency mismatch: account has ${balance.currency}, transaction has ${tx.amount.currency}`);
  }

  if (direction === 'increase_debt') {
    return addMoney(balance, tx.amount);
  } else {
    // decrease_debt: subtract magnitude
    return addMoney(balance, makeMoney(tx.amount.currency, -tx.amount.minorUnits));
  }
}

/**
 * Reconcile an account's current balance from an opening baseline or its latest verified anchor.
 */
export function calculateReconciledBalance(params: {
  openingBalance: Money;
  anchor?: ReconciliationAnchor | null;
  transactions: readonly LedgerTransaction[];
  accountId: string;
}): AccountReconciliationResult {
  const { openingBalance, anchor, transactions, accountId } = params;
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

    if (direction === 'increase_debt') {
      runningBalance = addMoney(runningBalance, tx.amount);
      totalCharges = addMoney(totalCharges, tx.amount);
      activeCount++;
    } else if (direction === 'decrease_debt') {
      runningBalance = addMoney(runningBalance, makeMoney(currency, -tx.amount.minorUnits));
      totalPayments = addMoney(totalPayments, tx.amount);
      activeCount++;
    }
  }

  const netChange = addMoney(totalCharges, makeMoney(currency, -totalPayments.minorUnits));

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
