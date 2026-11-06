// Node's direct TypeScript loader requires the extension; Expo resolves it as well.
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { getCurrency } from './currencies.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { parseMoney, type Money } from './money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { parseDateOnly } from './calendar.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type LedgerTransaction, type TransactionCategory, type TransactionSource, type ReconciliationAnchor, validateLedgerTransaction } from './ledger.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type RecurringBill, type RecurringBillCategory, type RecurringBillPaymentMethod } from './recurring-bills.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { canonicalDebtAmount } from '../debt-storage-domain.ts';

export function moneyToCanonicalDecimal(money: Money): string {
  const { scale } = getCurrency(money.currency);
  const divisor = 10 ** scale;
  const units = Math.abs(money.minorUnits);
  return (money.minorUnits < 0 ? '-' : '') + String(Math.floor(units / divisor)) + (scale ? '.' + String(units % divisor).padStart(scale, '0') : '');
}

/** Apply stored local write intents over a remote snapshot without losing them. */
export function mergeFinanceRowsWithPendingWrites<T extends { id: string }>(
  remote: readonly T[],
  pending: Readonly<Record<string, unknown | null>>,
): T[] {
  const merged = new Map(remote.map(row => [row.id, row]));
  for (const [id, row] of Object.entries(pending)) {
    if (row === null) merged.delete(id);
    else merged.set(id, row as T);
  }
  return [...merged.values()];
}

export type SupabaseTransactionRow = {
  id: string;
  user_id: string;
  household_id?: string | null;
  account_id: string | null;
  date: string;
  applies_to_date?: string | null;
  amount: string | number;
  category: string;
  payee: string;
  memo: string | null;
  source: string;
  reconciled: boolean;
  created_at: string;
  deleted_at: string | null;
};

export type SupabaseRecurringBillRow = {
  id: string;
  user_id: string;
  household_id?: string | null;
  name: string;
  category: string;
  amount: string | number;
  due_day: number;
  payment_method: string;
  credit_account_id: string | null;
  auto_post: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type SupabaseReconciliationAnchorRow = {
  id: string;
  user_id: string;
  account_id: string;
  as_of_date: string;
  verified_balance: string | number;
  note: string | null;
  created_at: string;
};

const VALID_TRANSACTION_CATEGORIES: ReadonlySet<string> = new Set([
  'purchase',
  'subscription',
  'utilities',
  'interest',
  'fee',
  'annual_fee',
  'interest_adjustment',
  'balance_adjustment',
  'payment',
  'refund',
  'credit_adjustment',
  'debit_bill',
  'debit_spending',
]);

const VALID_TRANSACTION_SOURCES: ReadonlySet<string> = new Set([
  'manual',
  'recurring_bill',
  'reconciliation',
  'system',
]);

const VALID_BILL_CATEGORIES: ReadonlySet<string> = new Set([
  'utilities',
  'subscription',
  'housing',
  'insurance',
  'other_bill',
]);

/** Encode a LedgerTransaction into a Supabase table row representation. */
export function encodeTransactionRow(
  tx: LedgerTransaction,
  userId: string,
  householdId: string | null = null,
): SupabaseTransactionRow {
  validateLedgerTransaction(tx);
  if (!userId || typeof userId !== 'string') throw new TypeError('userId is required');

  const formattedAmount = canonicalDebtAmount(
    moneyToCanonicalDecimal(tx.amount),
    tx.amount.currency,
    false,
  );

  return {
    id: tx.id,
    user_id: userId,
    household_id: householdId,
    account_id: tx.accountId ?? null,
    date: tx.date,
    applies_to_date: tx.appliesToDate ?? null,
    amount: formattedAmount,
    category: tx.category,
    payee: tx.payee.trim(),
    memo: tx.memo?.trim() ? tx.memo.trim() : null,
    source: tx.source,
    reconciled: Boolean(tx.reconciled),
    created_at: tx.createdAt,
    deleted_at: tx.deletedAt ?? null,
  };
}

/** Decode a Supabase table row into a strongly-typed LedgerTransaction. */
export function decodeTransactionRow(
  row: SupabaseTransactionRow,
  currency: string,
): LedgerTransaction {
  getCurrency(currency);
  if (!row.id || typeof row.id !== 'string') throw new TypeError('Missing transaction ID');
  const date = parseDateOnly(row.date);

  if (!VALID_TRANSACTION_CATEGORIES.has(row.category)) {
    throw new TypeError(`Invalid transaction category: '${row.category}'`);
  }
  const category = row.category as TransactionCategory;

  const canonicalAmount = canonicalDebtAmount(row.amount, currency, false);
  const amount = parseMoney(canonicalAmount, currency, false);

  if (!VALID_TRANSACTION_SOURCES.has(row.source)) {
    throw new TypeError(`Invalid transaction source: '${row.source}'`);
  }
  const source = row.source as TransactionSource;

  const tx: LedgerTransaction = {
    id: row.id,
    accountId: row.account_id ?? null,
    date,
    appliesToDate: row.applies_to_date ? parseDateOnly(row.applies_to_date) : null,
    amount,
    category,
    payee: String(row.payee ?? '').trim(),
    memo: row.memo ?? undefined,
    source,
    reconciled: Boolean(row.reconciled),
    createdAt: String(row.created_at ?? ''),
    deletedAt: row.deleted_at ?? null,
  };

  validateLedgerTransaction(tx);
  return tx;
}

/** Encode a RecurringBill into a Supabase table row. */
export function encodeRecurringBillRow(
  bill: RecurringBill,
  userId: string,
  householdId: string | null = null,
  updatedAt: string = new Date().toISOString(),
): SupabaseRecurringBillRow {
  if (!userId || typeof userId !== 'string') throw new TypeError('userId is required');
  if (!bill.id || typeof bill.id !== 'string') throw new TypeError('bill.id is required');
  if (bill.dueDay < 1 || bill.dueDay > 31) throw new RangeError('dueDay must be between 1 and 31');
  if (bill.paymentMethod === 'credit' && !bill.creditAccountId) {
    throw new TypeError('creditAccountId is required when paymentMethod is credit');
  }

  const formattedAmount = canonicalDebtAmount(
    moneyToCanonicalDecimal(bill.amount),
    bill.amount.currency,
    false,
  );

  return {
    id: bill.id,
    user_id: userId,
    household_id: householdId,
    name: bill.name.trim(),
    category: bill.category,
    amount: formattedAmount,
    due_day: bill.dueDay,
    payment_method: bill.paymentMethod,
    credit_account_id: bill.paymentMethod === 'credit' ? (bill.creditAccountId ?? null) : null,
    auto_post: Boolean(bill.autoPost),
    active: Boolean(bill.active),
    created_at: bill.createdAt,
    updated_at: updatedAt,
  };
}

/** Decode a Supabase table row into a RecurringBill. */
export function decodeRecurringBillRow(
  row: SupabaseRecurringBillRow,
  currency: string,
): RecurringBill {
  getCurrency(currency);
  if (!row.id || typeof row.id !== 'string') throw new TypeError('Missing recurring bill ID');
  if (!VALID_BILL_CATEGORIES.has(row.category)) {
    throw new TypeError(`Invalid recurring bill category: '${row.category}'`);
  }
  if (row.payment_method !== 'debit' && row.payment_method !== 'credit') {
    throw new TypeError(`Invalid payment method: '${row.payment_method}'`);
  }
  if (row.due_day < 1 || row.due_day > 31) {
    throw new RangeError(`Invalid due day: ${row.due_day}`);
  }

  const canonicalAmount = canonicalDebtAmount(row.amount, currency, false);
  const amount = parseMoney(canonicalAmount, currency, false);

  return {
    id: row.id,
    name: String(row.name ?? '').trim(),
    category: row.category as RecurringBillCategory,
    amount,
    dueDay: row.due_day,
    paymentMethod: row.payment_method as RecurringBillPaymentMethod,
    creditAccountId: row.credit_account_id ?? undefined,
    autoPost: Boolean(row.auto_post),
    active: Boolean(row.active),
    createdAt: String(row.created_at ?? ''),
  };
}

/** Encode a ReconciliationAnchor into a Supabase table row. */
export function encodeReconciliationAnchorRow(
  anchor: ReconciliationAnchor,
  userId: string,
): SupabaseReconciliationAnchorRow {
  if (!userId || typeof userId !== 'string') throw new TypeError('userId is required');
  if (!anchor.id || typeof anchor.id !== 'string') throw new TypeError('anchor.id is required');
  if (!anchor.accountId || typeof anchor.accountId !== 'string') throw new TypeError('accountId is required');

  parseDateOnly(anchor.asOfDate);

  const formattedBalance = canonicalDebtAmount(
    moneyToCanonicalDecimal(anchor.verifiedBalance),
    anchor.verifiedBalance.currency,
    true, // Signed: verified balance can be credit (negative) or liability (positive)
  );

  return {
    id: anchor.id,
    user_id: userId,
    account_id: anchor.accountId,
    as_of_date: anchor.asOfDate,
    verified_balance: formattedBalance,
    note: anchor.note?.trim() ? anchor.note.trim() : null,
    created_at: anchor.createdAt,
  };
}

/** Decode a Supabase table row into a ReconciliationAnchor. */
export function decodeReconciliationAnchorRow(
  row: SupabaseReconciliationAnchorRow,
  currency: string,
): ReconciliationAnchor {
  getCurrency(currency);
  if (!row.id || typeof row.id !== 'string') throw new TypeError('Missing anchor ID');
  if (!row.account_id || typeof row.account_id !== 'string') throw new TypeError('Missing anchor account_id');

  const asOfDate = parseDateOnly(row.as_of_date);
  const canonicalBalance = canonicalDebtAmount(row.verified_balance, currency, true);
  const verifiedBalance = parseMoney(canonicalBalance, currency, true);

  return {
    id: row.id,
    accountId: row.account_id,
    asOfDate,
    verifiedBalance,
    note: row.note ?? undefined,
    createdAt: String(row.created_at ?? ''),
  };
}
