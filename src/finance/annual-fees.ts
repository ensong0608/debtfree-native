import type { DebtItem } from '../onboarding-domain.ts';
// @ts-ignore TS5097: Node's direct TypeScript loader requires explicit extensions.
import { moneyFromMajor } from './money.ts';
// @ts-ignore TS5097
import { parseDateOnly, type DateOnly } from './calendar.ts';
// @ts-ignore TS5097
import { validateLedgerTransaction, type LedgerTransaction } from './ledger.ts';

export function annualFeeTransactionId(debtId: string, renewalDate: DateOnly): string {
  if (!debtId.trim()) throw new TypeError('A credit-card ID is required');
  parseDateOnly(renewalDate);
  return `annual-fee:${debtId}:${renewalDate}`;
}

/** Advance one calendar year, clamping February 29 to February 28 when needed. */
export function nextAnnualFeeRenewalDate(renewalDate: DateOnly): DateOnly {
  parseDateOnly(renewalDate);
  const year = Number(renewalDate.slice(0, 4)) + 1;
  const month = Number(renewalDate.slice(5, 7));
  const day = Number(renewalDate.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return parseDateOnly(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(day, daysInMonth)).padStart(2, '0')}`);
}

/** Build the stable actual charge record after the user confirms it posted. */
export function createAnnualFeeTransaction(params: {
  debt: DebtItem;
  renewalDate: DateOnly;
  actualDate: DateOnly;
  currencyCode: string;
  now?: Date;
}): LedgerTransaction {
  const { debt, renewalDate, actualDate, currencyCode, now = new Date() } = params;
  if (debt.category !== 'Credit card' || debt.annualFeeAmount == null || debt.annualFeeAmount <= 0) {
    throw new TypeError('A configured credit-card annual fee is required');
  }
  if (debt.annualFeeNextDueDate !== renewalDate) throw new Error('The annual-fee renewal date changed. Reload and retry.');
  parseDateOnly(actualDate);
  const amount = moneyFromMajor(debt.annualFeeAmount, currencyCode);
  if (amount.minorUnits <= 0) throw new RangeError('Annual fee must be positive');
  const transaction: LedgerTransaction = {
    id: annualFeeTransactionId(debt.id, renewalDate),
    accountId: debt.id,
    date: actualDate,
    appliesToDate: renewalDate,
    amount,
    category: 'annual_fee',
    payee: `${debt.name} annual fee`,
    memo: `Annual card fee confirmed for ${renewalDate}`,
    source: 'manual',
    reconciled: false,
    createdAt: now.toISOString(),
    deletedAt: null,
  };
  validateLedgerTransaction(transaction);
  return transaction;
}

export function isAnnualFeeTransaction(tx: LedgerTransaction, debtId: string, renewalDate: DateOnly): boolean {
  return tx.id === annualFeeTransactionId(debtId, renewalDate) && tx.category === 'annual_fee' && tx.accountId === debtId && tx.deletedAt === null;
}

