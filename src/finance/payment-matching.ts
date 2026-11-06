// Strict obligation identity prevents one payment from settling unrelated debts/bills.
// @ts-ignore TS5097: Node's test runner and Expo both accept .ts imports.
import { type DateOnly } from './calendar.ts';
// @ts-ignore TS5097: Node's test runner and Expo both accept .ts imports.
import { type LedgerTransaction } from './ledger.ts';

export type PaymentObligation = Readonly<{
  kind: 'bill' | 'debt';
  dueDate: DateOnly;
  accountId?: string;
  billId?: string;
}>;

export function paymentMatchesObligation(
  tx: LedgerTransaction,
  target: PaymentObligation,
  includePending = false,
): boolean {
  if (tx.deletedAt !== null || (!includePending && tx.isPending)) return false;
  if (tx.appliesToDate !== target.dueDate) return false;
  if (target.kind === 'bill') {
    return !!target.billId && tx.id === `bill:${target.billId}:${target.dueDate}`;
  }
  return tx.category === 'payment' && !!target.accountId && tx.accountId === target.accountId;
}
