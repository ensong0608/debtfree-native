// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import type { LedgerTransaction, TransactionCategory } from './ledger.ts';

export type PayeeMemoryEntry = Readonly<{
  payee: string;
  category: TransactionCategory;
  accountId?: string | null;
  updatedAt: string;
}>;

export type CsvColumnMapping = Readonly<{
  dateColumn?: string;
  payeeColumn?: string;
  amountColumn?: string;
  debitColumn?: string;
  creditColumn?: string;
  chargesPositive?: boolean;
}>;

export type CsvImportPreset = Readonly<{
  id: string;
  name: string;
  targetAccountId: string;
  mapping: CsvColumnMapping;
  updatedAt: string;
}>;

export type CsvPayeeRule = Readonly<{
  id: string;
  pattern: string;
  category: TransactionCategory;
  accountId?: string | null;
  updatedAt: string;
}>;

export type PayeeMemoryStoreState = Readonly<{
  payees: Readonly<Record<string, PayeeMemoryEntry>>;
  presets: readonly CsvImportPreset[];
  rules: readonly CsvPayeeRule[];
}>;

export const EMPTY_PAYEE_MEMORY_STATE: PayeeMemoryStoreState = {
  payees: {},
  presets: [],
  rules: [],
};

const MAX_REMEMBERED_PAYEES = 100;
const MAX_CSV_PRESETS = 20;
const MAX_CSV_RULES = 60;

const GENERIC_PAYEES = new Set([
  'purchase',
  'single purchase',
  'payment',
  'debit',
  'cash / debit',
  'other',
  'fee',
  'interest',
  'refund',
  'imported transaction',
  'subscription',
  'utilities',
]);

export function normalizePayeeKey(payee: string): string {
  return payee.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isGenericPayeeLabel(payee: string): boolean {
  const key = normalizePayeeKey(payee);
  return !key || GENERIC_PAYEES.has(key);
}

/** Remember a non-generic payee's preferred category and optional account, bounded to recent entries. */
export function recordPayeeMemory(
  entries: Readonly<Record<string, PayeeMemoryEntry>>,
  input: {
    payee: string;
    category: TransactionCategory;
    accountId?: string | null;
    updatedAt?: string;
  },
): Record<string, PayeeMemoryEntry> {
  const cleanPayee = input.payee.trim().replace(/\s+/g, ' ');
  const key = normalizePayeeKey(cleanPayee);
  if (!key || GENERIC_PAYEES.has(key)) {
    return { ...entries };
  }
  const next: Record<string, PayeeMemoryEntry> = {
    ...entries,
    [key]: {
      payee: cleanPayee,
      category: input.category,
      accountId: input.accountId ?? null,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    },
  };
  const sortedKeys = Object.keys(next).sort((a, b) => next[b].updatedAt.localeCompare(next[a].updatedAt));
  if (sortedKeys.length <= MAX_REMEMBERED_PAYEES) return next;
  const trimmed: Record<string, PayeeMemoryEntry> = {};
  for (const kept of sortedKeys.slice(0, MAX_REMEMBERED_PAYEES)) {
    trimmed[kept] = next[kept];
  }
  return trimmed;
}

export function lookupPayeeMemory(
  entries: Readonly<Record<string, PayeeMemoryEntry>>,
  payee: string,
): PayeeMemoryEntry | null {
  const key = normalizePayeeKey(payee);
  if (!key) return null;
  return entries[key] ?? null;
}

/** Combine remembered payees and recent ledger transactions into quick-tap payee suggestions. */
export function listRecentPayees(
  entries: Readonly<Record<string, PayeeMemoryEntry>>,
  transactions: readonly LedgerTransaction[],
  limit = 8,
): PayeeMemoryEntry[] {
  const byKey = new Map<string, PayeeMemoryEntry>();
  const sortedEntries = Object.values(entries).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const entry of sortedEntries) {
    const key = normalizePayeeKey(entry.payee);
    if (!key || GENERIC_PAYEES.has(key) || byKey.has(key)) continue;
    byKey.set(key, entry);
  }
  const sortedTxs = [...transactions]
    .filter(tx => tx.deletedAt === null && tx.source !== 'reconciliation')
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  for (const tx of sortedTxs) {
    const cleanPayee = (tx.payee ?? '').trim().replace(/\s+/g, ' ');
    const key = normalizePayeeKey(cleanPayee);
    if (!key || GENERIC_PAYEES.has(key) || byKey.has(key)) continue;
    byKey.set(key, {
      payee: cleanPayee,
      category: tx.category,
      accountId: tx.accountId,
      updatedAt: tx.createdAt || `${tx.date}T00:00:00.000Z`,
    });
  }
  return [...byKey.values()].slice(0, Math.max(0, limit));
}

let nextLocalIdSeq = 0;
function createLocalId(prefix: string): string {
  nextLocalIdSeq += 1;
  return `${prefix}:${Date.now().toString(36)}:${nextLocalIdSeq.toString(36)}`;
}

export function upsertCsvPreset(
  presets: readonly CsvImportPreset[],
  input: Omit<CsvImportPreset, 'id' | 'updatedAt'> & { id?: string; updatedAt?: string },
): CsvImportPreset[] {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Enter a preset name.');
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const normalizedName = name.toLowerCase();
  const existing = presets.find(p => (input.id && p.id === input.id) || p.name.toLowerCase() === normalizedName);
  const nextItem: CsvImportPreset = {
    id: existing?.id ?? input.id ?? createLocalId('preset'),
    name,
    targetAccountId: input.targetAccountId,
    mapping: {
      ...(input.mapping.dateColumn?.trim() ? { dateColumn: input.mapping.dateColumn.trim() } : {}),
      ...(input.mapping.payeeColumn?.trim() ? { payeeColumn: input.mapping.payeeColumn.trim() } : {}),
      ...(input.mapping.amountColumn?.trim() ? { amountColumn: input.mapping.amountColumn.trim() } : {}),
      ...(input.mapping.debitColumn?.trim() ? { debitColumn: input.mapping.debitColumn.trim() } : {}),
      ...(input.mapping.creditColumn?.trim() ? { creditColumn: input.mapping.creditColumn.trim() } : {}),
      ...(typeof input.mapping.chargesPositive === 'boolean' ? { chargesPositive: input.mapping.chargesPositive } : {}),
    },
    updatedAt,
  };
  return [nextItem, ...presets.filter(p => p.id !== nextItem.id)].slice(0, MAX_CSV_PRESETS);
}

export function deleteCsvPreset(presets: readonly CsvImportPreset[], presetId: string): CsvImportPreset[] {
  return presets.filter(preset => preset.id !== presetId);
}

export function upsertCsvPayeeRule(
  rules: readonly CsvPayeeRule[],
  input: Omit<CsvPayeeRule, 'id' | 'updatedAt'> & { id?: string; updatedAt?: string },
): CsvPayeeRule[] {
  const pattern = input.pattern.trim().replace(/\s+/g, ' ');
  const key = normalizePayeeKey(pattern);
  if (!key) throw new Error('Enter a payee keyword for this rule.');
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const existing = rules.find(r => (input.id && r.id === input.id) || normalizePayeeKey(r.pattern) === key);
  const nextRule: CsvPayeeRule = {
    id: existing?.id ?? input.id ?? createLocalId('rule'),
    pattern,
    category: input.category,
    accountId: input.accountId ?? null,
    updatedAt,
  };
  return [nextRule, ...rules.filter(r => r.id !== nextRule.id)].slice(0, MAX_CSV_RULES);
}

export function deleteCsvPayeeRule(rules: readonly CsvPayeeRule[], ruleId: string): CsvPayeeRule[] {
  return rules.filter(rule => rule.id !== ruleId);
}

/** Match the most specific payee rule (longest normalized substring, then most recently updated). */
export function matchCsvPayeeRule(rules: readonly CsvPayeeRule[], payee: string): CsvPayeeRule | null {
  const target = normalizePayeeKey(payee);
  if (!target || rules.length === 0) return null;
  const matches = rules.filter(rule => {
    const key = normalizePayeeKey(rule.pattern);
    return Boolean(key) && target.includes(key);
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) =>
    normalizePayeeKey(b.pattern).length - normalizePayeeKey(a.pattern).length
    || b.updatedAt.localeCompare(a.updatedAt),
  );
  return matches[0];
}
