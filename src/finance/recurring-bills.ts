// Node's direct TypeScript loader requires the extension; Expo resolves it as well.
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { makeMoney, type Money } from './money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { parseDateOnly, householdDate, type DateOnly } from './calendar.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type LedgerTransaction, type TransactionCategory, validateLedgerTransaction } from './ledger.ts';

export type RecurringBillPaymentMethod = 'debit' | 'credit';

export type RecurringBillCategory =
  | 'utilities'
  | 'subscription'
  | 'housing'
  | 'insurance'
  | 'other_bill';

export type RecurringBill = Readonly<{
  id: string;
  name: string;
  category: RecurringBillCategory;
  amount: Money;
  dueDay: number; // 1 to 31
  paymentMethod: RecurringBillPaymentMethod;
  creditAccountId?: string; // Required when paymentMethod is 'credit'
  autoPost: boolean;
  active: boolean;
  createdAt: string; // ISO 8601
}>;

function daysInMonth(year: number, month: number): number {
  return [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Calculate the calendar date for a recurring bill in a given YYYY-MM month, clamping to the month's last day. */
export function resolveRecurringBillDate(monthStr: string, dueDay: number): DateOnly {
  const match = /^(\d{4})-(\d{2})$/.exec(monthStr);
  if (!match) throw new RangeError(`Invalid month format '${monthStr}', expected YYYY-MM`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new RangeError(`Invalid month '${month}'`);
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    throw new RangeError(`Invalid due day '${dueDay}', must be between 1 and 31`);
  }

  const maxDay = daysInMonth(year, month);
  const actualDay = Math.min(dueDay, maxDay);
  return parseDateOnly(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`);
}

/** Build a stable transaction for a bill payment the user has confirmed. */
export function createConfirmedRecurringBillTransaction(params: {
  bill: RecurringBill;
  dueCycle: DateOnly;
  actualDate: DateOnly;
  now?: Date;
}): LedgerTransaction {
  const { bill, dueCycle, actualDate, now = new Date() } = params;
  if (!bill.active) throw new TypeError(`Recurring bill '${bill.id}' is inactive`);
  makeMoney(bill.amount.currency, bill.amount.minorUnits);
  if (bill.amount.minorUnits <= 0) throw new RangeError('Recurring bill amount must be positive');
  parseDateOnly(dueCycle);
  parseDateOnly(actualDate);

  const isDebit = bill.paymentMethod === 'debit';
  if (!isDebit && !bill.creditAccountId) {
    throw new TypeError(`Credit recurring bill '${bill.name}' missing required creditAccountId`);
  }
  const category: TransactionCategory = isDebit
    ? 'debit_bill'
    : (bill.category === 'subscription' ? 'subscription' : 'utilities');
  const tx: LedgerTransaction = {
    id: `bill:${bill.id}:${dueCycle}`,
    accountId: isDebit ? null : bill.creditAccountId!,
    date: actualDate,
    appliesToDate: dueCycle,
    amount: bill.amount,
    category,
    payee: bill.name,
    memo: `Recurring bill payment confirmed for due cycle ${dueCycle}`,
    source: 'recurring_bill',
    reconciled: false,
    createdAt: now.toISOString(),
    deletedAt: null,
  };
  validateLedgerTransaction(tx);
  return tx;
}

/**
 * Generate a deterministic LedgerTransaction for a recurring bill in a given month.
 * Returns null if the bill is inactive, or if the due date has not yet arrived as of today.
 */
export function generateRecurringBillTransaction(params: {
  bill: RecurringBill;
  targetMonth: string; // YYYY-MM
  today: DateOnly;
  now?: Date;
}): LedgerTransaction | null {
  const { bill, targetMonth, today, now = new Date() } = params;

  if (!bill.active || !bill.autoPost) return null;
  makeMoney(bill.amount.currency, bill.amount.minorUnits);
  if (bill.amount.minorUnits <= 0) return null;

  const billDate = resolveRecurringBillDate(targetMonth, bill.dueDay);

  // If the due date has not arrived yet in the target month, do not post early
  if (billDate > today) {
    return null;
  }

  // Idempotent deterministic ID: guarantees a bill can NEVER be posted twice in the same month
  const txId = `bill:${bill.id}:${targetMonth}`;

  if (bill.paymentMethod === 'debit') {
    // Debit payment: cash leaves checking, $0 debt change
    const tx: LedgerTransaction = {
      id: txId,
      accountId: null,
      date: billDate,
      appliesToDate: billDate,
      amount: bill.amount,
      category: 'debit_bill',
      payee: bill.name,
      memo: `Auto-recorded recurring bill (Paid from Debit/Checking)`,
      source: 'recurring_bill',
      reconciled: false,
      createdAt: now.toISOString(),
      deletedAt: null,
    };
    validateLedgerTransaction(tx);
    return tx;
  } else {
    // Credit card payment: charged to a specific credit card, increases card debt
    if (!bill.creditAccountId) {
      throw new TypeError(`Credit recurring bill '${bill.name}' missing required creditAccountId`);
    }

    const category: TransactionCategory =
      bill.category === 'subscription' ? 'subscription' : 'utilities';

    const tx: LedgerTransaction = {
      id: txId,
      accountId: bill.creditAccountId,
      date: billDate,
      appliesToDate: billDate,
      amount: bill.amount,
      category,
      payee: bill.name,
      memo: `Auto-recorded recurring bill (Charged to credit card)`,
      source: 'recurring_bill',
      reconciled: false,
      createdAt: now.toISOString(),
      deletedAt: null,
    };
    validateLedgerTransaction(tx);
    return tx;
  }
}

/**
 * Scan all active recurring bills and process any that are due today or past due this month.
 * Automatically skips bills that have already been posted in the existing transaction list.
 */
export function processRecurringBills(params: {
  bills: readonly RecurringBill[];
  existingTransactions: readonly LedgerTransaction[];
  currentInstant?: Date;
  householdTimeZone?: string;
}): {
  newTransactions: LedgerTransaction[];
  alreadyPostedCount: number;
} {
  const {
    bills,
    existingTransactions,
    currentInstant = new Date(),
    householdTimeZone = 'UTC',
  } = params;

  const today = householdDate(currentInstant, householdTimeZone);
  const currentMonth = today.slice(0, 7); // YYYY-MM

  // Build a set of transaction IDs that already exist
  const existingTxIds = new Set(
    existingTransactions
      .filter(tx => tx.deletedAt === null)
      .map(tx => tx.id)
  );

  const newTransactions: LedgerTransaction[] = [];
  let alreadyPostedCount = 0;

  for (const bill of bills) {
    if (!bill.active || !bill.autoPost) continue;

    const expectedTxId = `bill:${bill.id}:${currentMonth}`;
    if (existingTxIds.has(expectedTxId)) {
      alreadyPostedCount++;
      continue;
    }

    const tx = generateRecurringBillTransaction({
      bill,
      targetMonth: currentMonth,
      today,
      now: currentInstant,
    });

    if (tx) {
      newTransactions.push(tx);
    }
  }

  return {
    newTransactions,
    alreadyPostedCount,
  };
}
