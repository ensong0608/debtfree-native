// @ts-ignore TS5097: Node tests import TypeScript directly.
import { getCurrency } from './finance/currencies.ts';
// @ts-ignore TS5097: Node tests import TypeScript directly.
import { parseMoney } from './finance/money.ts';
// @ts-ignore TS5097
import { parseDateOnly } from './finance/calendar.ts';
// @ts-ignore TS5097: Node tests import TypeScript directly.
import { ACTIVE_DEBT_CATEGORIES, resolveCurrencyOption, type DebtCategory, type UserOnboardingData } from './onboarding-domain.ts';
// @ts-ignore TS5097
import { validateDebtPaymentSplitPlans, validateBillPaymentSplitPlans } from './finance/debt-payment-split.ts';

/** Validate a database decimal without rounding; PostgreSQL may pad insignificant zeros. */
export function canonicalDebtAmount(value: number | string, currency: string, signed = false): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError('Missing monetary amount');
  const text = String(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(text) || (!signed && text.startsWith('-'))) throw new TypeError('Invalid monetary amount');
  const scale = getCurrency(currency).scale;
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  if (fraction.slice(scale).replace(/0/g, '') !== '') throw new RangeError('Amount exceeds currency precision');
  const candidate = whole + (scale ? '.' + fraction.slice(0, scale).padEnd(scale, '0') : '');
  const money = parseMoney((negative ? '-' : '') + candidate, currency, signed);
  const divisor = 10 ** scale;
  const units = Math.abs(money.minorUnits);
  return (money.minorUnits < 0 ? '-' : '') + String(Math.floor(units / divisor)) + (scale ? '.' + String(units % divisor).padStart(scale, '0') : '');
}
export function decodeDebtAmount(value: number | string, currency: string, signed = false): number {
  return Number(canonicalDebtAmount(value, currency, signed));
}
export function canonicalOptionalDebtAmount(value: number | string | null | undefined, currency: string): string | null {
  return value == null ? null : canonicalDebtAmount(value, currency);
}
export function validateStoredAmounts(data: UserOnboardingData): void {
  if (data.householdName !== undefined && (typeof data.householdName !== 'string' || !data.householdName.trim() || data.householdName !== data.householdName.trim() || data.householdName.length > 120)) throw new TypeError('Invalid household name');
  const currency = resolveCurrencyOption(data).code;
  canonicalDebtAmount(data.primaryIncomeAmount, currency);
  if (data.primaryGrossIncomeAmount != null) canonicalDebtAmount(data.primaryGrossIncomeAmount, currency);
  canonicalDebtAmount(data.extraMonthlyPayment, currency);
  for (const income of data.additionalIncomes ?? []) {
    canonicalDebtAmount(income.amount, currency);
    if (income.grossAmount != null) canonicalDebtAmount(income.grossAmount, currency);
  }
  for (const debt of data.debts ?? []) {
    canonicalDebtAmount(debt.balance, currency, true);
    canonicalDebtAmount(debt.minimumPayment, currency);
    canonicalOptionalDebtAmount(debt.originalBalance, currency);
    canonicalOptionalDebtAmount(debt.creditLimit, currency);
    canonicalOptionalDebtAmount(debt.annualFeeAmount, currency);
    if ((debt.annualFeeAmount == null) !== (debt.annualFeeNextDueDate == null)) throw new TypeError('Annual fee amount and renewal date must be set together');
    if (debt.annualFeeAmount != null && (debt.category !== 'Credit card' || debt.annualFeeAmount <= 0)) throw new TypeError('Annual fee must be positive and attached to a credit card');
    if (debt.annualFeeNextDueDate != null) parseDateOnly(debt.annualFeeNextDueDate);
  }
  if (data.archivedPaidOffDebtIds !== undefined) {
    if (!Array.isArray(data.archivedPaidOffDebtIds) || data.archivedPaidOffDebtIds.length > 5000) throw new TypeError('Invalid archived debt IDs');
    const debtById = new Map((data.debts ?? []).map(debt => [debt.id, debt]));
    const seen = new Set<string>();
    for (const debtId of data.archivedPaidOffDebtIds) {
      if (typeof debtId !== 'string' || !debtId.trim() || seen.has(debtId)) throw new TypeError('Invalid archived debt ID');
      const debt = debtById.get(debtId);
      if (!debt || debt.balance !== 0) throw new TypeError('Archived debt must be a stored zero-balance account');
      seen.add(debtId);
    }
  }
  for (const escrow of Object.values(data.mortgageEscrowByDebtId ?? {})) canonicalDebtAmount(escrow, currency);
  for (const extra of Object.values(data.mortgageExtraPaymentByDebtId ?? {})) canonicalDebtAmount(extra, currency);
  for (const [billId, label] of Object.entries(data.recurringBillCategoryLabelByBillId ?? {})) {
    if (!billId.trim() || typeof label !== 'string' || !label.trim() || label.trim() !== label || label.length > 40) {
      throw new TypeError('Invalid recurring bill custom category label');
    }
  }
  if (data.debtPaymentSplitPlansByDebtId !== undefined) validateDebtPaymentSplitPlans(data.debtPaymentSplitPlansByDebtId);
  if (data.billPaymentSplitPlansByBillId !== undefined) validateBillPaymentSplitPlans(data.billPaymentSplitPlansByBillId);
}
export type MonetaryRecordsContext = {
  transactions: readonly { readonly id: string }[];
  recurringBills: readonly { readonly id: string }[];
  reconciliationAnchors: readonly { readonly id: string }[];
  complete: boolean;
};

export function hasMonetaryRecords(
  data: UserOnboardingData,
  context: MonetaryRecordsContext,
): boolean {
  const hasOnboardingMoney =
    (data.debts?.length ?? 0) > 0 ||
    data.primaryIncomeAmount !== 0 ||
    (data.additionalIncomes?.length ?? 0) > 0 ||
    data.extraMonthlyPayment !== 0 ||
    Object.keys(data.mortgageEscrowByDebtId ?? {}).length > 0 ||
    Object.keys(data.mortgageExtraPaymentByDebtId ?? {}).length > 0;

  const hasFinanceMoney =
    context.transactions.length > 0 ||
    context.recurringBills.length > 0 ||
    context.reconciliationAnchors.length > 0;

  return hasOnboardingMoney || hasFinanceMoney;
}

export function assertCurrencyChangeAllowed(
  data: UserOnboardingData,
  nextCurrency: string,
  context: MonetaryRecordsContext,
): void {
  getCurrency(nextCurrency);
  if (resolveCurrencyOption(data).code !== nextCurrency) {
    if (!context || context.complete !== true) throw new Error('Currency cannot be changed until all financial records are verified.');
    if (hasMonetaryRecords(data, context)) throw new Error('Currency cannot be changed while monetary records exist.');
  }
}


/** Database classifications win. Legacy metadata may fill only a truly missing value. */
export function resolveDatabaseDebtCategory(dbCategory: string | null, legacyCategory?: DebtCategory): DebtCategory {
  const isSupported = (value: string): value is DebtCategory =>
    value === 'Mortgage' || ACTIVE_DEBT_CATEGORIES.includes(value as DebtCategory);
  if (dbCategory != null && dbCategory.trim() !== '') {
    if (isSupported(dbCategory)) return dbCategory;
    throw new Error(`Unknown authoritative debt category: ${dbCategory}`);
  }
  if (legacyCategory && isSupported(legacyCategory)) return legacyCategory;
  throw new Error('Authoritative debt category is missing; no verified legacy category is available.');
}
