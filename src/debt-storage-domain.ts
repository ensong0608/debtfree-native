// @ts-ignore TS5097: Node tests import TypeScript directly.
import { getCurrency } from './finance/currencies.ts';
// @ts-ignore TS5097: Node tests import TypeScript directly.
import { parseMoney } from './finance/money.ts';
// @ts-ignore TS5097: Node tests import TypeScript directly.
import { ACTIVE_DEBT_CATEGORIES, resolveCurrencyOption, type DebtCategory, type UserOnboardingData } from './onboarding-domain.ts';

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
  const currency = resolveCurrencyOption(data).code;
  canonicalDebtAmount(data.primaryIncomeAmount, currency);
  canonicalDebtAmount(data.extraMonthlyPayment, currency);
  for (const income of data.additionalIncomes ?? []) canonicalDebtAmount(income.amount, currency);
  for (const debt of data.debts ?? []) {
    canonicalDebtAmount(debt.balance, currency, true);
    canonicalDebtAmount(debt.minimumPayment, currency);
    canonicalOptionalDebtAmount(debt.originalBalance, currency);
    canonicalOptionalDebtAmount(debt.creditLimit, currency);
  }
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
    data.extraMonthlyPayment !== 0;

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
