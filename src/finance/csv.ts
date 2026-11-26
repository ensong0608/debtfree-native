// @ts-ignore TS5097
import { parseDateOnly, calendarDaysBetween } from './calendar.ts';
// @ts-ignore TS5097
import { makeMoney, moneyFromMajor, moneyToMajor, type Money } from './money.ts';
// @ts-ignore TS5097
import { type LedgerTransaction, type TransactionCategory } from './ledger.ts';
// @ts-ignore TS5097
import { type RecurringBill } from './recurring-bills.ts';
// @ts-ignore TS5097
import { matchCsvPayeeRule, type CsvColumnMapping, type CsvPayeeRule } from './payee-memory.ts';

const escapeCell = (value: unknown) => { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
export function buildTransactionsCsv(transactions: readonly LedgerTransaction[], debts: readonly { id: string; name: string }[], bills: readonly RecurringBill[], currencyCode: string): string {
  const names = new Map([...debts, ...bills].map(item => [item.id, item.name]));
  const rows = transactions.filter(tx => tx.deletedAt === null).map(tx => [tx.date, tx.source, names.get(tx.accountId ?? '') ?? '', tx.category, tx.payee, tx.amount.currency === currencyCode ? moneyToMajor(tx.amount) : '', tx.memo ?? '']);
  return [['Date', 'Type', 'AccountOrBill', 'Category', 'Payee', 'Amount', 'Memo'], ...rows].map(row => row.map(escapeCell).join(',')).join('\r\n');
}

function readRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted && c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (!quoted && c === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (c === '\r' || c === '\n')) { row.push(cell); rows.push(row); row = []; cell = ''; if (c === '\r' && text[i + 1] === '\n') i++; }
    else cell += c;
  }
  if (quoted) throw new TypeError('Unterminated quoted CSV field');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
export type ParsedBankCsvRow = {
  date: string;
  payee: string;
  amount: Money;
  likelyDuplicate: boolean;
  suggestedCategory?: TransactionCategory;
  suggestedAccountId?: string | null;
};

export type ParseBankCsvOptions = {
  mapping?: CsvColumnMapping;
  rules?: readonly CsvPayeeRule[];
};

const CHARGE_CATEGORIES = new Set<TransactionCategory>(['purchase', 'subscription', 'utilities', 'fee', 'interest']);
const CREDIT_CATEGORIES = new Set<TransactionCategory>(['payment', 'refund']);

/**
 * Resolve the transaction category for a CSV row without reversing its sign-based financial meaning:
 * charge rules only apply to charge-direction rows, and credit/payment rules only apply to credit-direction rows.
 */
export function resolveCsvRowCategory(params: {
  amount: Money;
  hasDebtAccount: boolean;
  chargesPositive: boolean;
  suggestedCategory?: TransactionCategory;
}): TransactionCategory {
  const { amount, hasDebtAccount, chargesPositive, suggestedCategory } = params;
  if (!hasDebtAccount) {
    return 'debit_spending';
  }
  const isCharge = (amount.minorUnits > 0) === chargesPositive;
  if (suggestedCategory) {
    if (isCharge && CHARGE_CATEGORIES.has(suggestedCategory)) return suggestedCategory;
    if (!isCharge && CREDIT_CATEGORIES.has(suggestedCategory)) return suggestedCategory;
  }
  return isCharge ? 'purchase' : 'payment';
}

export function parseBankCsv(
  csvText: string,
  existingTransactions: readonly LedgerTransaction[],
  defaultCurrency: string,
  options?: ParseBankCsvOptions,
): ParsedBankCsvRow[] {
  const [header, ...rows] = readRows(csvText); if (!header) return [];
  const columns = header.map(x => x.trim().toLowerCase().replace(/^\ufeff/, ''));
  const findMapped = (customName: string | undefined, fallbacks: readonly string[]) => {
    const cleanCustom = customName?.trim().toLowerCase();
    if (cleanCustom) {
      const idx = columns.indexOf(cleanCustom);
      if (idx >= 0) return idx;
    }
    return columns.findIndex(col => fallbacks.includes(col));
  };
  const mapping = options?.mapping;
  const date = findMapped(mapping?.dateColumn, ['date', 'posted date', 'transaction date']);
  const payee = findMapped(mapping?.payeeColumn, ['description', 'payee', 'merchant']);
  const amount = findMapped(mapping?.amountColumn, ['amount']);
  const debit = findMapped(mapping?.debitColumn, ['debit']);
  const credit = findMapped(mapping?.creditColumn, ['credit']);
  if (date < 0 || payee < 0 || (amount < 0 && debit < 0 && credit < 0)) throw new TypeError('Required bank CSV columns missing');
  const normalizePayee = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const rules = options?.rules ?? [];
  return rows.filter(row => row.some(x => x.trim())).map(row => {
    const raw = (row[date] ?? '').trim(), match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
    const day = match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : raw; parseDateOnly(day);
    const number = (s: string | undefined) => { const v = (s ?? '').trim().replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'); if (!v) return 0; const n = Number(v); if (!Number.isFinite(n)) throw new TypeError('Invalid amount'); return n; };
    const value = amount >= 0 ? number(row[amount]) : number(row[credit]) - number(row[debit]);
    const money = moneyFromMajor(value, defaultCurrency);
    const rawPayee = (row[payee] ?? '').trim();
    const rowPayee = normalizePayee(rawPayee);
    const likelyDuplicate = existingTransactions.some(tx => {
      if (tx.deletedAt !== null || tx.date !== day || tx.amount.currency !== defaultCurrency || tx.amount.minorUnits !== Math.abs(money.minorUnits)) return false;
      const existingPayee = normalizePayee(tx.payee ?? '');
      return !rowPayee || !existingPayee || existingPayee === rowPayee || existingPayee.includes(rowPayee) || rowPayee.includes(existingPayee);
    });
    const matchedRule = matchCsvPayeeRule(rules, rawPayee);
    return {
      date: day,
      payee: rawPayee,
      amount: money,
      likelyDuplicate,
      ...(matchedRule ? { suggestedCategory: matchedRule.category, suggestedAccountId: matchedRule.accountId ?? null } : {}),
    };
  });
}
export function buildSplitTransactionPayloads<T extends { amount: Money }>(total: Money, parts: readonly T[]): T[] {
  makeMoney(total.currency, total.minorUnits);
  if (parts.length < 2 || parts.some(p => p.amount.currency !== total.currency || !Number.isSafeInteger(p.amount.minorUnits) || p.amount.minorUnits <= 0) || parts.reduce((sum, p) => sum + BigInt(p.amount.minorUnits), 0n) !== BigInt(total.minorUnits)) throw new RangeError('Split amounts must add up to the total');
  return parts.map(part => ({ ...part }));
}
const GENERIC_PAYEES = new Set(['purchase', 'single purchase', 'payment', 'debit', 'cash / debit', 'other', 'fee', 'interest', 'refund']);
export function detectRecurringCandidates(transactions: readonly LedgerTransaction[], existingBills: readonly RecurringBill[]): { payee: string; amount: Money; transactionIds: string[] }[] {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const active = new Set(existingBills.filter(b => b.active).map(b => normalize(b.name)));
  const groups = new Map<string, LedgerTransaction[]>();
  for (const tx of transactions) { const key = normalize(tx.payee); if (!key || GENERIC_PAYEES.has(key) || active.has(key) || tx.deletedAt !== null || tx.source !== 'manual' || !['purchase', 'debit_spending'].includes(tx.category)) continue; groups.set(key, [...(groups.get(key) ?? []), tx]); }
  const result: { payee: string; amount: Money; transactionIds: string[] }[] = [];
  for (const group of groups.values()) { group.sort((a, b) => a.date.localeCompare(b.date)); for (let i = 1; i < group.length; i++) { const a = group[i - 1], b = group[i]; const days = calendarDaysBetween(a.date, b.date); if (days >= 25 && days <= 35 && a.amount.currency === b.amount.currency && Math.abs(a.amount.minorUnits - b.amount.minorUnits) <= Math.max(a.amount.minorUnits, b.amount.minorUnits) * 0.1) { result.push({ payee: b.payee, amount: b.amount, transactionIds: [a.id, b.id] }); break; } } }
  return result;
}
