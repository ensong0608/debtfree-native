// Node's direct TypeScript loader requires the extension; Expo resolves it as well.
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { getCurrency } from './currencies.ts';

/** JSON-safe minor units; validate externally supplied values with makeMoney. */
export type Money = Readonly<{ currency: string; minorUnits: number }>;
export const MAX_MINOR_UNITS = 9_000_000_000_000;
const limit = BigInt(MAX_MINOR_UNITS);

function checked(value: bigint): number {
  if (value > limit || value < -limit) throw new RangeError('Money exceeds minor-unit bound');
  return Number(value);
}
export function makeMoney(currency: string, minorUnits: number): Money {
  getCurrency(currency);
  if (!Number.isSafeInteger(minorUnits) || Math.abs(minorUnits) > MAX_MINOR_UNITS) throw new RangeError('Invalid minor units');
  return { currency, minorUnits: minorUnits === 0 ? 0 : minorUnits };
}
export function moneyToMajor(money: Money): number {
  const { scale } = getCurrency(money.currency);
  return money.minorUnits / 10 ** scale;
}
/** Convert an existing major-unit numeric field using that currency's minor-unit scale. */
export function moneyFromMajor(amount: number, currency: string): Money {
  const { scale } = getCurrency(currency);
  if (!Number.isFinite(amount)) throw new TypeError('Invalid major-unit amount');
  const units = Math.round(amount * 10 ** scale);
  if (!Number.isSafeInteger(units)) throw new RangeError('Money exceeds safe minor-unit precision');
  return makeMoney(currency, units);
}
/** Canonical committed text only; signed fields opt in explicitly. */
export function parseMoney(text: string, currency: string, signed = false): Money {
  const { scale } = getCurrency(currency);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || match[0] !== text || (match[1] && !signed) || (match[3] && match[3].length > scale)) throw new TypeError('Invalid money text');
  const magnitude = BigInt(match[2]) * BigInt(10 ** scale) + BigInt((match[3] || '').padEnd(scale, '0') || '0');
  return makeMoney(currency, checked(match[1] ? -magnitude : magnitude));
}
/** Classification never transforms the original editable text. */
export function classifyMoneyEdit(text: string, currency: string, signed = false): 'complete' | 'incomplete' | 'invalid' {
  const { scale } = getCurrency(currency);
  if (text === '' || (signed && text === '-')) return 'incomplete';
  if (!/^-?\d+(?:\.\d*)?$/.test(text) || (!signed && text.startsWith('-'))) return 'invalid';
  if (text.includes('.') && (scale === 0 || text.split('.')[1].length > scale)) return 'invalid';
  if (text.endsWith('.')) return 'incomplete';
  try { parseMoney(text, currency, signed); return 'complete'; } catch { return 'invalid'; }
}
export function addMoney(a: Money, b: Money): Money {
  makeMoney(a.currency, a.minorUnits); makeMoney(b.currency, b.minorUnits);
  if (a.currency !== b.currency) throw new TypeError('Cannot add different currencies');
  return makeMoney(a.currency, checked(BigInt(a.minorUnits) + BigInt(b.minorUnits)));
}
/** Exact integer division, ties away from zero. Denominator must be positive. */
export function divideHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= BigInt(0)) throw new RangeError('Denominator must be positive');
  const negative = numerator < BigInt(0);
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const rounded = quotient + ((magnitude % denominator) * BigInt(2) >= denominator ? BigInt(1) : BigInt(0));
  return negative ? -rounded : rounded;
}
/** Apply an exact rational to money, rounding once to minor units. */
export function multiplyMoneyRatio(money: Money, numerator: bigint, denominator: bigint): Money {
  makeMoney(money.currency, money.minorUnits);
  return makeMoney(money.currency, checked(divideHalfAwayFromZero(BigInt(money.minorUnits) * numerator, denominator)));
}
/** Thousandths of a percentage point, from 0 through 100.000%. */
export function parseApr(text: string): number {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text);
  if (!match || match[0] !== text) throw new TypeError('Invalid APR text');
  const value = BigInt(match[1]) * BigInt(1000) + BigInt((match[2] || '').padEnd(3, '0') || '0');
  if (value > BigInt(100000)) throw new RangeError('APR outside 0–100 percent');
  return Number(value);
}


