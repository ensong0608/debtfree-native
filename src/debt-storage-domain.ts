// @ts-ignore TS5097: Node tests import TypeScript directly.
import { getCurrency } from './finance/currencies.ts';
// @ts-ignore TS5097: Node tests import TypeScript directly.
import { parseMoney } from './finance/money.ts';
// @ts-ignore TS5097: Node tests import TypeScript directly.
import { resolveCurrencyOption, type UserOnboardingData } from './onboarding-domain.ts';

/** Validate a database decimal without rounding; PostgreSQL may pad insignificant zeros. */
export function canonicalDebtAmount(value: number | string, currency: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError('Missing monetary amount');
  const text = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new TypeError('Invalid monetary amount');
  const scale = getCurrency(currency).scale;
  const [whole, fraction = ''] = text.split('.');
  if (fraction.slice(scale).replace(/0/g, '') !== '') throw new RangeError('Amount exceeds currency precision');
  const candidate = whole + (scale ? '.' + fraction.slice(0, scale).padEnd(scale, '0') : '');
  const money = parseMoney(candidate, currency);
  const divisor = 10 ** scale;
  const units = money.minorUnits;
  return String(Math.floor(units / divisor)) + (scale ? '.' + String(units % divisor).padStart(scale, '0') : '');
}
export function decodeDebtAmount(value: number | string, currency: string): number {
  return Number(canonicalDebtAmount(value, currency));
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
    canonicalDebtAmount(debt.balance, currency);
    canonicalDebtAmount(debt.minimumPayment, currency);
    canonicalOptionalDebtAmount(debt.originalBalance, currency);
    canonicalOptionalDebtAmount(debt.creditLimit, currency);
  }
}
export function hasMonetaryRecords(data: UserOnboardingData): boolean {
  return (data.debts?.length ?? 0) > 0 || data.primaryIncomeAmount !== 0 || (data.additionalIncomes?.length ?? 0) > 0 || data.extraMonthlyPayment !== 0;
}
export function assertCurrencyChangeAllowed(data: UserOnboardingData, nextCurrency: string): void {
  getCurrency(nextCurrency);
  if (resolveCurrencyOption(data).code !== nextCurrency && hasMonetaryRecords(data)) {
    throw new Error('Currency cannot be changed while monetary records exist.');
  }
}
