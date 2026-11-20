// @ts-ignore TS5097
import { getObligationCycle, obligationScheduleKey, type ObligationSchedule, type ObligationSchedules } from './obligation-schedule.ts';
// Node's direct TypeScript loader requires the extension; Expo resolves it as well.
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { makeMoney, type Money } from './money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { parseDateOnly, householdDate, type DateOnly } from './calendar.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type LedgerTransaction, type TransactionCategory, validateLedgerTransaction } from './ledger.ts';
// @ts-ignore TS5097
import { extractBillIdFromTxId, extractBillIdsFromMemo } from './bill-identity.ts';
// @ts-ignore TS5097
import { type DebtItem } from '../onboarding-domain.ts';

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
  /** Authoritative recurring_bills.updated_at revision, when loaded from the server. */
  updatedAt?: string;
}>;

export type RecurringBillDeletionPreview = Readonly<{
  transactionsToDelete: LedgerTransaction[];
  preservedPrepayments: LedgerTransaction[];
  preservedFutureDatedPastCycle: LedgerTransaction[];
  hasPendingLinkedTransaction: boolean;
  snapshotToken: string;
}>;

export function shouldDismissRecurringBillEditor(outcome: {
  status: 'confirmed' | 'pending' | 'partial';
  billDeleted?: boolean;
}): boolean {
  return outcome.status === 'confirmed' || (outcome.status === 'partial' && outcome.billDeleted === true);
}

function explicitlyLinkedToBill(tx: LedgerTransaction, billId: string): boolean {
  return extractBillIdFromTxId(tx.id) === billId || extractBillIdsFromMemo(tx.memo).has(billId);
}

/** Build the exact preview and review token used by recurring-bill deletion. */
export function createRecurringBillDeletionPreview(params: {
  transactions: readonly LedgerTransaction[];
  bill: RecurringBill;
  debts: readonly DebtItem[];
  ownerId: string;
  asOfDate: DateOnly;
}): RecurringBillDeletionPreview {
  const { transactions, bill, debts, ownerId, asOfDate } = params;
  const linkedTransactions = transactions
    .filter(tx => tx.deletedAt === null && explicitlyLinkedToBill(tx, bill.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const transactionsToDelete = linkedTransactions.filter(tx => {
    const cycleDate = tx.appliesToDate ?? tx.date;
    return tx.date > asOfDate && cycleDate > asOfDate;
  }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const preservedPrepayments = linkedTransactions.filter(tx =>
    tx.date <= asOfDate && (tx.appliesToDate ?? tx.date) > asOfDate,
  );
  const preservedFutureDatedPastCycle = linkedTransactions.filter(tx =>
    tx.date > asOfDate && (tx.appliesToDate ?? tx.date) <= asOfDate,
  );
  const linkedAccountIds = new Set(linkedTransactions.flatMap(tx => tx.accountId ? [tx.accountId] : []));
  const linkedDebts = debts.filter(debt => linkedAccountIds.has(debt.id)).sort((a, b) => a.id.localeCompare(b.id));
  const snapshotToken = JSON.stringify({
    ownerId,
    asOfDate,
    bill: {
      id: bill.id, name: bill.name, category: bill.category, amount: bill.amount,
      dueDay: bill.dueDay, paymentMethod: bill.paymentMethod, creditAccountId: bill.creditAccountId ?? null,
      active: bill.active, autoPost: bill.autoPost, updatedAt: bill.updatedAt ?? null,
    },
    transactions: linkedTransactions.map(tx => ({
      id: tx.id, accountId: tx.accountId, date: tx.date, appliesToDate: tx.appliesToDate ?? null,
      amount: tx.amount, category: tx.category, payee: tx.payee, memo: tx.memo ?? null,
      createdAt: tx.createdAt, updatedAt: tx.updatedAt ?? null, deletedAt: tx.deletedAt,
      isPending: tx.isPending === true,
    })),
    debts: linkedDebts.map(debt => ({
      id: debt.id, category: debt.category, balance: debt.balance,
      serverVersion: debt.serverVersion ?? null, updatedAt: debt.updatedAt,
    })),
  });
  return {
    transactionsToDelete,
    preservedPrepayments,
    preservedFutureDatedPastCycle,
    hasPendingLinkedTransaction: linkedTransactions.some(tx => tx.isPending === true),
    snapshotToken,
  };
}

/** Future-cycle ledger transactions explicitly linked to one recurring item. */
export function findFutureRecurringBillTransactions(
  transactions: readonly LedgerTransaction[], billId: string, asOfDate: DateOnly,
): LedgerTransaction[] {
  return transactions.filter(tx => tx.deletedAt === null && tx.date > asOfDate &&
    (tx.appliesToDate ?? tx.date) > asOfDate && explicitlyLinkedToBill(tx, billId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export type RecurringBillMutationResult<T> = Readonly<{ data: T; outcome: 'confirmed' | 'pending' | 'rejected'; error?: Error }>;
export type RecurringBillStoragePort = Readonly<{
  persist(params: { session: any; userId: string; bill: RecurringBill; currentBills: RecurringBill[] }): Promise<RecurringBillMutationResult<RecurringBill>>;
  remove(params: { session: any; userId: string; billId: string; currentBills: RecurringBill[] }): Promise<RecurringBillMutationResult<string>>;
}>;

/** Pure command contract shared by the app command and command-path regression tests. */
export async function executeRecurringBillSave(params: {
  session: any; userId: string; bill: RecurringBill; currentBills: RecurringBill[]; storage: RecurringBillStoragePort;
}) {
  const { session, userId, bill, currentBills, storage } = params;
  const syncResult = await storage.persist({ session, userId, bill, currentBills });
  if (syncResult.outcome === 'rejected') throw syncResult.error ?? new Error('Recurring bill save was rejected.');
  const saved = syncResult.outcome === 'confirmed' ? syncResult.data : bill;
  const bills = currentBills.some(item => item.id === bill.id)
    ? currentBills.map(item => item.id === bill.id ? saved : item)
    : [saved, ...currentBills];
  return { bills, syncResult };
}

export async function executeRecurringBillRemoval(params: {
  session: any; userId: string; billId: string; currentBills: RecurringBill[]; storage: RecurringBillStoragePort;
}) {
  const { session, userId, billId, currentBills, storage } = params;
  const syncResult = await storage.remove({ session, userId, billId, currentBills });
  if (syncResult.outcome === 'rejected') throw syncResult.error ?? new Error('Recurring bill deletion was rejected.');
  return { bills: syncResult.outcome === 'confirmed' ? currentBills.filter(item => item.id !== billId) : currentBills, syncResult };
}

/** Canonical filter for obligations visible in upcoming and scheduled views. */
export function getActiveRecurringBills(bills: readonly RecurringBill[]): RecurringBill[] {
  return bills.filter(bill => bill.active);
}

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
export const creditRecurringBillCategory = (billCategory: RecurringBillCategory): TransactionCategory =>
  billCategory === 'subscription'
    ? 'subscription'
    : billCategory === 'utilities'
      ? 'utilities'
      : 'purchase';

const recurringBillCategoryNote = (billCategory: RecurringBillCategory): string =>
  billCategory === 'housing'
    ? ' (Housing)'
    : billCategory === 'insurance'
      ? ' (Insurance)'
      : billCategory === 'other_bill'
        ? ' (Other bill)'
        : '';

export function createConfirmedRecurringBillTransaction(params: {
  bill: RecurringBill;
  dueCycle: DateOnly;
  actualDate: DateOnly;
  now?: Date;
  amount?: Money;
  transactionId?: string;
}): LedgerTransaction {
  const { bill, dueCycle, actualDate, now = new Date(), amount, transactionId } = params;
  if (!bill.active) throw new TypeError(`Recurring bill '${bill.id}' is inactive`);
  const effectiveAmount = amount ?? bill.amount;
  makeMoney(effectiveAmount.currency, effectiveAmount.minorUnits);
  if (effectiveAmount.minorUnits <= 0) throw new RangeError('Recurring bill amount must be positive');
  parseDateOnly(dueCycle);
  parseDateOnly(actualDate);

  const isDebit = bill.paymentMethod === 'debit';
  if (!isDebit && !bill.creditAccountId) {
    throw new TypeError(`Credit recurring bill '${bill.name}' missing required creditAccountId`);
  }
  const category: TransactionCategory = isDebit
    ? 'debit_bill'
    : creditRecurringBillCategory(bill.category);
  const tx: LedgerTransaction = {
    id: transactionId ?? `bill:${bill.id}:${dueCycle}`,
    accountId: isDebit ? null : bill.creditAccountId!,
    date: actualDate,
    appliesToDate: dueCycle,
    amount: effectiveAmount,
    category,
    payee: bill.name,
    memo: `Recurring bill payment confirmed for due cycle ${dueCycle}${isDebit ? '' : recurringBillCategoryNote(bill.category)}`,
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
 * Per Financial Integrity rules:
 * - Debit bills are NEVER automatically marked paid based only on due date.
 * - Eligible credit card charges are generated only when autoPost is explicitly enabled.
 * Returns null if the bill is inactive, is a debit bill, or if the due date has not yet arrived.
 */
export function generateRecurringBillTransaction(params: {
  bill: RecurringBill;
  targetMonth: string; // YYYY-MM
  schedule?: ObligationSchedule;
  today: DateOnly;
  now?: Date;
}): LedgerTransaction | null {
  const { bill, targetMonth, today, schedule, now = new Date() } = params;

  if (!bill.active || !bill.autoPost) return null;
  // Per Finding A5: Never automatically mark debit bills paid based only on due date.
  if (bill.paymentMethod === 'debit') {
    return null;
  }

  const cycle = schedule ? getObligationCycle(schedule, targetMonth) : null;
  if (schedule && (!cycle || cycle.acknowledgedPaid)) return null;
  const billDate = cycle?.dueDate ?? resolveRecurringBillDate(targetMonth, bill.dueDay);
  const cycleAmount = cycle?.amount ?? bill.amount;
  if (cycleAmount.minorUnits <= 0) return null;

  // If the due date has not arrived yet in the target month, do not post early
  if (billDate > today) {
    return null;
  }

  // Credit card payment: charged to a specific credit card, increases card debt
  if (!bill.creditAccountId) {
    throw new TypeError(`Credit recurring bill '${bill.name}' missing required creditAccountId`);
  }

  // Idempotent deterministic ID: guarantees a bill can NEVER be posted twice in the same month
  const txId = `bill:${bill.id}:${targetMonth}`;

  const category: TransactionCategory = creditRecurringBillCategory(bill.category);

  const tx: LedgerTransaction = {
    id: txId,
    accountId: bill.creditAccountId,
    date: billDate,
    appliesToDate: billDate,
    amount: cycleAmount,
    category,
    payee: bill.name,
    memo: `Auto-recorded recurring bill (Charged to credit card)${recurringBillCategoryNote(bill.category)}`,
    source: 'recurring_bill',
    reconciled: false,
    createdAt: now.toISOString(),
    deletedAt: null,
  };
  validateLedgerTransaction(tx);
  return tx;
}

/**
 * Scan all active recurring bills and process any that are due today or past due this month.
 * Automatically skips bills that have already been posted in the existing transaction list.
 * Dedupes strictly by stable bill ID + due cycle, ensuring two different bills on the same card on the same date both post.
 */
export function processRecurringBills(params: {
  bills: readonly RecurringBill[];
  existingTransactions: readonly LedgerTransaction[];
  currentInstant?: Date;
  householdTimeZone?: string;
  schedules?: ObligationSchedules;
}): {
  newTransactions: LedgerTransaction[];
  alreadyPostedCount: number;
} {
  const {
    bills,
    existingTransactions,
    schedules,
    currentInstant = new Date(),
    householdTimeZone = (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC',
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

    const schedule = schedules?.[obligationScheduleKey('bill', bill.id)];
    const cycle = schedule ? getObligationCycle(schedule, currentMonth) : null;
    if (schedule && (!cycle || cycle.acknowledgedPaid)) continue;
    const billDate = cycle?.dueDate ?? resolveRecurringBillDate(currentMonth, bill.dueDay);
    const expectedTxIdMonth = `bill:${bill.id}:${currentMonth}`;
    const expectedTxIdDate = `bill:${bill.id}:${billDate}`;

    // Dedup strictly by this specific bill ID and due cycle, NOT by card account ID
    const alreadyExists =
      existingTxIds.has(expectedTxIdMonth) ||
      existingTxIds.has(expectedTxIdDate) ||
      existingTransactions.some(
        tx =>
          tx.deletedAt === null &&
          (tx.appliesToDate === billDate || tx.date === billDate) &&
          tx.id.startsWith(`bill:${bill.id}:`)
      );

    if (alreadyExists) {
      alreadyPostedCount++;
      continue;
    }

    const tx = generateRecurringBillTransaction({
      bill,
      targetMonth: currentMonth,
      schedule,
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
