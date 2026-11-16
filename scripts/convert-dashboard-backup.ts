// @ts-ignore Node built-in types omitted when @types/node is absent from Expo tsconfig.
import { createHash } from 'node:crypto';
// @ts-ignore Node built-in types omitted when @types/node is absent from Expo tsconfig.
import * as fs from 'node:fs';
// @ts-ignore Node built-in types omitted when @types/node is absent from Expo tsconfig.
import * as path from 'node:path';
// @ts-ignore Node built-in types omitted when @types/node is absent from Expo tsconfig.
import { pathToFileURL } from 'node:url';

// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { parseDateOnly } from '../src/finance/calendar.ts';
import {
  calculateReconciledBalance,
  type LedgerTransaction,
  type ReconciliationAnchor,
  type TransactionCategory,
  validateLedgerTransaction,
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
} from '../src/finance/ledger.ts';
import {
  createNativeBackup,
  type NativeBackup,
  nativeBackupLifecycleWarnings,
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
} from '../src/finance/backup.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { makeMoney } from '../src/finance/money.ts';
import {
  processRecurringBills,
  type RecurringBill,
  type RecurringBillCategory,
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
} from '../src/finance/recurring-bills.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { validateStoredAmounts } from '../src/debt-storage-domain.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import type { DebtItem, PayoffStrategy, UserOnboardingData } from '../src/onboarding-domain.ts';

declare const Buffer: any;
declare const process: any;

export type SourceCreator = {
  email?: string;
  displayName?: string;
};

export type SourcePayload = {
  accounts: any[];
  monthlyBudgets: Record<string, any[]>;
  payees: any[];
  transactions: any[];
  snapshots: any[];
  extra?: number;
  strategy?: string;
  planning?: Record<string, any>;
  balanceAdjustments: any[];
  monthlyPlan: Record<string, any>;
  customDebtOrder?: string[];
};

export type SourceBackupEnvelope = {
  format: string;
  version: number;
  exportedAt: string;
  payload: SourcePayload;
};

export type DestinationBackupSnapshot = {
  exported_at: string;
  auth_identity: { id: string; email: string; created_at: string };
  households: any[];
  household_members: any[];
  household_profiles: any[];
  household_settings: any[];
  debts: any[];
  recurring_bills: any[];
  transactions: any[];
  reconciliation_anchors: any[];
  debtfree_deleted_bill_ids: any[];
  debtfree_deleted_debt_ids: any[];
  debtfree_restore_receipts: any[];
  debtfree_account_lifecycle: any[];
  debtfree_household_reset_receipts: any[];
  debtfree_household_bill_deletion_receipts: any[];
  debtfree_household_debt_deletion_receipts: any[];
  debtfree_household_invitation_send_events: any[];
};

export type ImportArchiveRecord = {
  domain:
    | 'account_metadata'
    | 'account_archive_history'
    | 'loan_tracker'
    | 'loan_history'
    | 'loan_correction'
    | 'transaction_archive'
    | 'transaction_revision'
    | 'balance_adjustment'
    | 'balance_adjustment_revision'
    | 'payee'
    | 'monthly_budget'
    | 'monthly_plan'
    | 'monthly_plan_month'
    | 'monthly_plan_settlement'
    | 'due_payment_association'
    | 'snapshot'
    | 'snapshot_revision'
    | 'disabled_recurring_source'
    | 'settings_metadata'
    | 'owner_question';
  id: string;
  source_id: string;
  native_table: string | null;
  native_record_id: string | null;
  disposition:
    | 'mapped_native'
    | 'mapped_with_metadata'
    | 'source_only_archive'
    | 'excluded_from_active_ledger'
    | 'pending_owner_clarification';
  source_deleted_at: string | null;
  source_created_at: string | null;
  source_updated_at: string | null;
  attribution: SourceCreator | null;
  source_record: unknown;
  notes: string | null;
};

export type MigrationDecisionsConfig = {
  strategy?: PayoffStrategy;
  extraMonthlyPayment?: number;
  minimumPaymentOverrides?: Record<string, number>;
  debtDueDayOverrides?: Record<string, number>;
  billDueDayOverrides?: Record<string, number>;
  confirmedPaymentsAsRealTransactions?: boolean;
  reportKindAdjustmentsAsActivity?: boolean;
  duplicateAdjustmentTransactionPairs?: Array<{
    adjustmentId: string;
    transactionId: string;
    suppressAdjustmentAnchor?: boolean;
    reason?: string;
  }>;
  duplicateSettlements?: Array<{
    settlementId: string;
    activeSettlementId: string;
    reason?: string;
  }>;
  historicalLoanSettlementMappings?: Array<{
    settlementId: string;
    loanId: string;
    appliesToDate?: string | null;
    reason?: string;
  }>;
  dedupedLoanSettlements?: Array<{
    settlementId: string;
    loanId: string;
    loanHistoryDate?: string;
    reason?: string;
  }>;
  resolvedTopicNotes?: Record<string, string>;
};

export type OwnerQuestion = {
  number: number;
  topic: string;
  question: string;
  currentSafeHandling: string;
  records: Array<{
    domain: string;
    sourceId: string;
    accountName: string | null;
    date: string | null;
    amount: number | null;
    sourceClassification: string;
  }>;
};

export type ConversionResult = {
  migrationKey: string;
  sourceSha256: string;
  sourceByteLength: number;
  nativeBackup: NativeBackup;
  sharedHouseholdSettings: Record<string, unknown>;
  conversionManifest: Record<string, unknown>;
  identityMap: Record<string, unknown>;
  ownerQuestions: OwnerQuestion[];
  importRecords: ImportArchiveRecord[];
  lifecycleWarnings: string[];
  autoPostSimulation: { alreadyPostedCount: number; newTransactionCount: number };
};

const DEFAULT_UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function deterministicUuidV5(namespaceUuid: string, name: string): string {
  const nsHex = namespaceUuid.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(nsHex)) {
    throw new TypeError(`Invalid UUID namespace: ${namespaceUuid}`);
  }
  const nsBytes = Buffer.from(nsHex, 'hex');
  const hash = createHash('sha1').update(nsBytes).update(name, 'utf8').digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function shortHash12(seed: string, name: string): string {
  return createHash('sha256').update(`${seed}:${name}`, 'utf8').digest('hex').slice(0, 12);
}

function roundCents(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function toCents(v: number): number {
  return Math.round(v * 100);
}

function centsToMajor(cents: number): number {
  return cents / 100;
}

function extractDueDay(dueDate: string | null | undefined): number | null {
  if (!dueDate || typeof dueDate !== 'string') return null;
  const match = /^\d{4}-\d{2}-(\d{2})$/.exec(dueDate.trim());
  if (!match) return null;
  const day = Number(match[1]);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

function prototypeAccountCalculatedCents(account: any, transactions: any[]): number {
  const anchor = account.reconciliation ?? null;
  const covered = new Set<string>(anchor?.coveredTransactionIds ?? []);
  const movementCents = transactions
    .filter((tx) => {
      if (tx.accountId !== account.id || tx.deletedAt || tx.includedIn) return false;
      if (!anchor) return true;
      if (covered.has(tx.id)) return false;
      if (tx.date < anchor.date) return false;
      if (anchor.coveredTransactionIds !== undefined) return true;
      return tx.date > anchor.date || String(tx.createdAt ?? '') > String(anchor.createdAt ?? '');
    })
    .reduce((sum, tx) => {
      const amtCents = toCents(tx.amount);
      return sum + (tx.type === 'payment' ? -amtCents : amtCents);
    }, 0);

  const baseCents = anchor
    ? toCents(anchor.balance) + toCents(account.balanceOffset ?? 0) - toCents(anchor.offset ?? 0)
    : toCents(account.balance) + toCents(account.balanceOffset ?? 0);

  return Math.max(0, baseCents + movementCents);
}

function mapTransactionCategory(tx: any): TransactionCategory {
  const t = String(tx.type ?? '').toLowerCase();
  const c = String(tx.category ?? '').toLowerCase();
  if (t === 'payment') return 'payment';
  if (t === 'fee') {
    if (c.includes('interest')) return 'interest';
    if (c.includes('annual')) return 'annual_fee';
    return 'fee';
  }
  if (t === 'charge') {
    if (c.includes('subscription')) return 'subscription';
    if (c.includes('utilit')) return 'utilities';
    return 'purchase';
  }
  throw new TypeError(`Unsupported source transaction type/category: ${tx.type} / ${tx.category}`);
}

function mapRecurringBillCategory(rawCategory: string, pairedLoanCategory?: 'Mortgage' | 'Auto loan'): RecurringBillCategory {
  if (pairedLoanCategory === 'Auto loan') {
    // nativeBackupLifecycleWarnings requires 'other_bill' for paired Auto loan bills.
    return 'other_bill';
  }
  const c = String(rawCategory ?? '').toLowerCase();
  if (c.includes('hous') || c.includes('mort')) return 'housing';
  if (c.includes('util')) return 'utilities';
  if (c.includes('sub')) return 'subscription';
  if (c.includes('ins')) return 'insurance';
  return 'other_bill';
}

function cleanOptionalIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function extractAttribution(record: any): SourceCreator | null {
  const c = record?.creator ?? record?.createdBy ?? record?.confirmedPayment?.creator ?? record?.updatedBy ?? null;
  if (!c || typeof c !== 'object') return null;
  const email = typeof c.email === 'string' && c.email.trim() ? c.email.trim() : undefined;
  const displayName = typeof c.displayName === 'string' && c.displayName.trim() ? c.displayName.trim() : undefined;
  return email || displayName ? { ...(email ? { email } : {}), ...(displayName ? { displayName } : {}) } : null;
}

function pickCycleMinimumPayment(account: any, monthlyPlan: Record<string, any>, activeBudgetMonth: string): number {
  const cycles: Array<{ date: string; amount: number }> = Array.isArray(account.minimumCycles) ? account.minimumCycles : [];
  const activeCycle = [...cycles]
    .sort((a, b) => b.date.localeCompare(a.date))
    .find((c) => String(c.date ?? '').startsWith(activeBudgetMonth));
  if (activeCycle && Number.isFinite(activeCycle.amount) && activeCycle.amount > 0) {
    return roundCents(activeCycle.amount);
  }
  const autoMin = monthlyPlan?.payoffAutoMinimumCommitments?.[account.id];
  if (typeof autoMin === 'number' && Number.isFinite(autoMin) && autoMin > 0) {
    return roundCents(autoMin);
  }
  return roundCents(Number(account.minimum ?? 0));
}

function buildOwnerQuestions(params: {
  accounts: any[];
  loans: any[];
  debts: DebtItem[];
  sourceTransactions: any[];
  sourceAdjustments: any[];
  monthsPlan: Record<string, any>;
  dpas: any[];
  snapshots: any[];
  payees: any[];
  monthlyPlan: Record<string, any>;
  rootStrategy: unknown;
  rootExtra: unknown;
  selectedStrategy: PayoffStrategy;
  selectedExtra: number;
  activeBudgetMonth: string;
  activeBudgetDueDayBySourceId: Map<string, number>;
  effectiveBillDueDayBySourceId: Map<string, number>;
  accountIdMap: Record<string, string>;
  accountNameBySourceId: Map<string, string>;
  decisions?: MigrationDecisionsConfig;
}): OwnerQuestion[] {
  const {
    accounts,
    loans,
    debts,
    sourceTransactions,
    sourceAdjustments,
    monthsPlan,
    dpas,
    snapshots,
    payees,
    rootStrategy,
    rootExtra,
    selectedStrategy,
    selectedExtra,
    activeBudgetMonth,
    effectiveBillDueDayBySourceId,
    accountIdMap,
    accountNameBySourceId,
    decisions,
  } = params;

  const questions: OwnerQuestion[] = [];
  let nextNum = 1;

  const activeAdjs = sourceAdjustments.filter((a) => !a.deletedAt);
  const activeTxs = sourceTransactions.filter((t) => !t.deletedAt);
  const dpaByAdjId = new Map<string, any>(
    dpas.filter((d) => d?.source?.id).map((d) => [String(d.source.id), d]),
  );
  const dupPairByAdjId = new Map(
    (decisions?.duplicateAdjustmentTransactionPairs ?? []).map((p) => [p.adjustmentId, p]),
  );
  const dupSettlementIds = new Set(
    (decisions?.duplicateSettlements ?? []).map((d) => d.settlementId),
  );
  const resolvedNotes = decisions?.resolvedTopicNotes ?? {};

  // 1. Confirmed-payment balance adjustments vs overlapping payment transactions
  const confirmedAdjs = activeAdjs.filter((a) => Boolean(a.confirmedPayment));
  const unresolvedConfirmedAdjs = decisions?.confirmedPaymentsAsRealTransactions
    ? confirmedAdjs.filter((adj) => {
        if (dupPairByAdjId.has(String(adj.id))) return false;
        // Same-month or post-adj matching-amount active payment TX not explicitly resolved
        const overlappingSameMonth = activeTxs.find(
          (t) =>
            t.accountId === adj.accountId &&
            t.type === 'payment' &&
            String(t.date).slice(0, 7) === String(adj.date).slice(0, 7) &&
            toCents(Math.abs(Number(adj.difference ?? 0))) === toCents(Number(t.amount)),
        );
        return Boolean(overlappingSameMonth);
      })
    : confirmedAdjs;

  if (unresolvedConfirmedAdjs.length > 0) {
    const records: OwnerQuestion['records'] = unresolvedConfirmedAdjs.map((adj) => {
      const accName = accountNameBySourceId.get(adj.accountId) ?? adj.accountId;
      const dpa = dpaByAdjId.get(String(adj.id));
      const sameAmtTx = activeTxs.find(
        (t) =>
          t.accountId === adj.accountId &&
          t.type === 'payment' &&
          toCents(Math.abs(Number(adj.difference ?? 0))) === toCents(Number(t.amount)),
      );
      const offsetAdj = activeAdjs.find(
        (other) =>
          other.id !== adj.id &&
          other.accountId === adj.accountId &&
          toCents(Number(other.difference ?? 0) + Number(adj.difference ?? 0)) === 0,
      );
      const notes: string[] = ['confirmedPayment=true'];
      if (adj.reconciliationAnchor) notes.push(`reconciliationAnchor ($${roundCents(Number(adj.reconciliationAnchor.balance)).toFixed(2)})`);
      if (dpa) notes.push(`duePaymentAssociation (${dpa.dueDate})`);
      if (sameAmtTx) notes.push(`overlaps TX ${String(sameAmtTx.id).slice(0, 8)} ($${roundCents(Number(sameAmtTx.amount)).toFixed(2)}, ${sameAmtTx.date})`);
      if (offsetAdj) notes.push(`offset by adj ${String(offsetAdj.id).slice(0, 8)} (+$${roundCents(Number(offsetAdj.difference)).toFixed(2)}, ${offsetAdj.date})`);
      return {
        domain: 'balanceAdjustments',
        sourceId: String(adj.id),
        accountName: accName,
        date: String(adj.date),
        amount: roundCents(Number(adj.difference)),
        sourceClassification: notes.join(' + '),
      };
    });
    const summaryList = records
      .map((r) => `${r.accountName} ${r.date} ($${Number(r.amount).toFixed(2)}, ${r.sourceId.slice(0, 8)})`)
      .join('; ');
    questions.push({
      number: nextNum++,
      topic: 'Confirmed-payment balance adjustments vs payment transactions',
      question: `Found ${unresolvedConfirmedAdjs.length} active balance adjustment(s) carrying confirmedPayment=true (${summaryList}). Confirm whether each is a standalone real payment or overlaps an existing payment transaction.`,
      currentSafeHandling:
        'Mapped unresolved adjustments safely without inventing duplicate payments.',
      records,
    });
  }

  // 2. ReportKind adjustments & same-day matching interest/fee TX
  const reportKindAdjs = activeAdjs.filter((a) => Boolean(a.reportKind));
  const unresolvedReportKindAdjs = decisions?.reportKindAdjustmentsAsActivity ? [] : reportKindAdjs;

  if (unresolvedReportKindAdjs.length > 0) {
    const records: OwnerQuestion['records'] = [];
    const pairedSummaries: string[] = [];
    for (const adj of unresolvedReportKindAdjs) {
      const accName = accountNameBySourceId.get(adj.accountId) ?? adj.accountId;
      const matchingTx =
        adj.reportKind === 'interest'
          ? activeTxs.find(
              (t) =>
                t.accountId === adj.accountId &&
                t.date === adj.date &&
                String(t.category ?? '').toLowerCase().includes('interest') &&
                toCents(Math.abs(Number(adj.difference ?? 0))) === toCents(Number(t.amount)),
            )
          : undefined;
      if (matchingTx) {
        pairedSummaries.push(
          `${accName} ${adj.date} $${roundCents(Number(adj.difference)).toFixed(2)} (adj ${String(adj.id).slice(0, 8)} + TX ${String(matchingTx.id).slice(0, 8)})`,
        );
        records.push({
          domain: 'balanceAdjustments+transactions',
          sourceId: `${adj.id} / ${matchingTx.id}`,
          accountName: accName,
          date: String(adj.date),
          amount: roundCents(Number(adj.difference)),
          sourceClassification: `reportKind="interest" anchor ($${roundCents(Number(adj.balanceAfter)).toFixed(2)}) + same-day interest fee TX ($${roundCents(Number(matchingTx.amount)).toFixed(2)})`,
        });
      } else {
        records.push({
          domain: 'balanceAdjustments',
          sourceId: String(adj.id),
          accountName: accName,
          date: String(adj.date),
          amount: roundCents(Number(adj.difference)),
          sourceClassification: `reportKind="${adj.reportKind}"`,
        });
      }
    }
    const pairClause =
      pairedSummaries.length > 0
        ? `Specifically, ${pairedSummaries.join('; ')} applies the same interest charge in both an anchor and a fee transaction. `
        : '';
    questions.push({
      number: nextNum++,
      topic: 'Report-classified balance adjustments (interest/purchase/credit) & potential same-day interest overlap',
      question: `${pairClause}Confirm whether the intended final balance includes those ledger entries and whether reportKind adjustments should convert to actual activity.`,
      currentSafeHandling:
        'Preserved exact calculated prototype balances on every account until owner confirmation.',
      records,
    });
  }

  // 3. Loan trackers with balanceKind="payoff", estimated splits, or due-day discrepancy
  const ambiguousLoans = loans.filter((loan) => {
    const hist = Array.isArray(loan.history) ? loan.history : [];
    const effectiveBillDueDay = loan.budgetItemId ? effectiveBillDueDayBySourceId.get(String(loan.budgetItemId)) : undefined;
    const mappedDebt = debts.find((d) => d.id === accountIdMap[loan.id]);
    const effectiveLoanDueDay = mappedDebt?.dueDay ?? extractDueDay(loan.dueDate);
    const hasDueDayMismatch =
      effectiveBillDueDay != null && effectiveLoanDueDay != null && effectiveBillDueDay !== effectiveLoanDueDay;
    const needsLoanAck = !resolvedNotes.loans && (loan.balanceKind === 'payoff' || hist.some((h: any) => Boolean(h.estimated)));
    return needsLoanAck || hasDueDayMismatch;
  });
  if (ambiguousLoans.length > 0) {
    const records: OwnerQuestion['records'] = ambiguousLoans.map((loan) => {
      const hist = Array.isArray(loan.history) ? loan.history : [];
      const estDates = hist.filter((h: any) => Boolean(h.estimated)).map((h: any) => h.date);
      const effectiveBillDueDay = loan.budgetItemId ? effectiveBillDueDayBySourceId.get(String(loan.budgetItemId)) : undefined;
      const mappedDebt = debts.find((d) => d.id === accountIdMap[loan.id]);
      const effectiveLoanDueDay = mappedDebt?.dueDay ?? extractDueDay(loan.dueDate);
      return {
        domain: 'loanTrackers',
        sourceId: String(loan.id),
        accountName: String(loan.name),
        date: hist[hist.length - 1]?.date ?? null,
        amount: roundCents(Number(loan.remainingAmount ?? 0)),
        sourceClassification: `balanceKind="${loan.balanceKind}", estimatedDates=[${estDates.join(', ')}], loanDueDay=${effectiveLoanDueDay ?? 'n/a'} vs billDueDay=${effectiveBillDueDay ?? 'n/a'}`,
      };
    });
    const desc = records
      .map((r) => `${r.accountName} ($${Number(r.amount).toFixed(2)}, ${r.sourceClassification})`)
      .join('; ');
    questions.push({
      number: nextNum++,
      topic: 'Loan payoff-quote vs principal balance, estimated payment splits, and due-day mismatch',
      question: `Loan tracker(s) ${desc} contain non-principal payoff balances, estimated split allocations, or a due-day difference versus the paired recurring bill. Confirm true statement principal balance, whether to enter verified P/I splits, and the preferred due day.`,
      currentSafeHandling:
        'Imported remainingAmount cleanly, kept estimated split amounts unallocated (principal_amount = NULL) with explicit memo notes, and preserved recurring bill due day.',
      records,
    });
  }

  // 4. Settings/Minimum/Promo conflicts & uncertain-memo transactions
  const conflictRecords: OwnerQuestion['records'] = [];
  const settingsResolved =
    (decisions?.strategy !== undefined && decisions?.extraMonthlyPayment !== undefined) || Boolean(resolvedNotes.settings);
  if (!settingsResolved && (rootStrategy !== selectedStrategy || roundCents(Number(rootExtra ?? 0)) !== selectedExtra)) {
    conflictRecords.push({
      domain: 'monthlyPlan / rootSettings',
      sourceId: 'payoffPlanStrategy vs strategy',
      accountName: null,
      date: null,
      amount: selectedExtra,
      sourceClassification: `active monthlyPlan=${selectedStrategy} ($${selectedExtra}) vs root=${String(rootStrategy)} ($${roundCents(Number(rootExtra ?? 0))})`,
    });
  }
  for (const acc of accounts) {
    const debt = debts.find((d) => d.id === accountIdMap[acc.id]);
    if (!debt) continue;
    const minResolved =
      decisions?.minimumPaymentOverrides?.[acc.id] !== undefined || Boolean(resolvedNotes.minimums);
    if (!minResolved && roundCents(Number(acc.minimum ?? 0)) !== roundCents(debt.minimumPayment)) {
      conflictRecords.push({
        domain: 'accounts',
        sourceId: String(acc.id),
        accountName: String(acc.name),
        date: `${activeBudgetMonth}-01`,
        amount: debt.minimumPayment,
        sourceClassification: `account.minimum=${roundCents(Number(acc.minimum ?? 0))} vs activeCycle=${debt.minimumPayment}`,
      });
    }
    const hasActivePromoApr = Boolean(acc.promoEndDate && Number(acc.apr ?? 0) === 0 && Number(acc.postPromoApr ?? 0) > 0);
    const hasBaselineDelta = acc.baselineBalance != null && toCents(acc.baselineBalance) !== toCents(acc.balance);
    if (!resolvedNotes.accounts && (hasActivePromoApr || hasBaselineDelta)) {
      conflictRecords.push({
        domain: 'accounts',
        sourceId: String(acc.id),
        accountName: String(acc.name),
        date: acc.promoEndDate ? String(acc.promoEndDate) : null,
        amount: roundCents(Number(acc.baselineBalance ?? acc.balance)),
        sourceClassification: `apr=${acc.apr}%${acc.promoEndDate ? ` promoUntil=${acc.promoEndDate} postPromoApr=${acc.postPromoApr}%` : ''}; balance=${acc.balance} vs baseline=${acc.baselineBalance}`,
      });
    }
  }
  if (!resolvedNotes.memos) {
    for (const tx of activeTxs) {
      if (typeof tx.memo === 'string' && /(\?{2,}|not sure)/i.test(tx.memo)) {
        conflictRecords.push({
          domain: 'transactions',
          sourceId: String(tx.id),
          accountName: accountNameBySourceId.get(tx.accountId) ?? tx.accountId,
          date: String(tx.date),
          amount: roundCents(Number(tx.amount)),
          sourceClassification: `memo=${JSON.stringify(tx.memo)}`,
        });
      }
    }
  }
  if (conflictRecords.length > 0) {
    questions.push({
      number: nextNum++,
      topic: 'Strategy/extra payment conflict, minimum cycle vs static minimum, promo APR/baseline, and uncertain transaction memos',
      question: `Found ${conflictRecords.length} source configuration/account conflict(s) (payoff strategy/extra payment differences, cycle vs static minimum payments, promo APR/baselineBalance deltas, and uncertain pre-anchor memo text). Confirm the active values selected cleanly match your intent.`,
      currentSafeHandling:
        'Selected the active monthlyPlan strategy/extra payment, active-cycle minimum payment, and source baseline originalBalance while archiving all conflicting values verbatim.',
      records: conflictRecords,
    });
  }

  // 5. Snapshot-only zero-balance accounts, unused payees, duplicate same-month settlements
  const archiveArtifactRecords: OwnerQuestion['records'] = [];
  const activeAccountIds = new Set(accounts.map((a) => String(a.id)));
  if (!resolvedNotes.snapshots) {
    for (const snap of snapshots) {
      const snapAccounts = Array.isArray(snap.accounts) ? snap.accounts : [];
      const snapOnly = snapAccounts.filter((sa: any) => !activeAccountIds.has(String(sa.accountId ?? sa.id ?? '')));
      if (snapOnly.length > 0) {
        archiveArtifactRecords.push({
          domain: 'snapshots',
          sourceId: String(snap.id),
          accountName: snapOnly.map((sa: any) => String(sa.name)).join(', '),
          date: snap.capturedAt ? String(snap.capturedAt).slice(0, 10) : null,
          amount: 0,
          sourceClassification: `${snapOnly.length} snapshot-only zero-balance account(s) absent from current accounts[]`,
        });
      }
    }
  }
  if (!resolvedNotes.payees && !resolvedNotes.snapshots) {
    const usedPayeeIds = new Set(sourceTransactions.map((t) => String(t.payeeId ?? '')).filter(Boolean));
    const usedPayeeNames = new Set(sourceTransactions.map((t) => String(t.payeeName ?? t.payee ?? '').toLowerCase()).filter(Boolean));
    for (const p of payees) {
      if (!usedPayeeIds.has(String(p.id)) && !usedPayeeNames.has(String(p.name ?? '').toLowerCase())) {
        archiveArtifactRecords.push({
          domain: 'payees',
          sourceId: String(p.id),
          accountName: String(p.name),
          date: p.createdAt ? String(p.createdAt).slice(0, 10) : null,
          amount: null,
          sourceClassification: 'Unused source payee entry (0 matching transactions)',
        });
      }
    }
  }
  for (const m of Object.keys(monthsPlan).sort()) {
    const settlements: any[] = Array.isArray(monthsPlan[m]?.settlements) ? monthsPlan[m].settlements : [];
    const seenByKey = new Map<string, any[]>();
    for (const s of settlements) {
      const baseName = String(s.name ?? '').split('-')[0].trim().toLowerCase();
      const k = `${s.source}:${baseName}:${toCents(Number(s.amount ?? 0))}`;
      const list = seenByKey.get(k) ?? [];
      list.push(s);
      seenByKey.set(k, list);
    }
    for (const [, dupes] of seenByKey.entries()) {
      const unresolvedDupes = dupes.filter((d) => !dupSettlementIds.has(String(d.id)));
      if (dupes.length > 1 && unresolvedDupes.length > 1) {
        archiveArtifactRecords.push({
          domain: `monthlyPlan.months.${m}.settlements`,
          sourceId: dupes.map((d) => String(d.id).slice(0, 8)).join(' / '),
          accountName: String(dupes[0].name),
          date: dupes.map((d) => String(d.date)).join(' / '),
          amount: roundCents(Number(dupes[0].amount)),
          sourceClassification: `${dupes.length} duplicate same-month ${dupes[0].source} settlements in ${m}`,
        });
      }
    }
  }
  if (archiveArtifactRecords.length > 0) {
    questions.push({
      number: nextNum++,
      topic: 'Snapshot-only historical accounts, unused payee directory rows, and duplicate same-month settlements',
      question: `Found ${archiveArtifactRecords.length} historical/duplicate artifact group(s) (snapshot-only zero-balance accounts absent from current accounts, unused payee row(s), and multiple settlements with identical payee/amount in the same month). Confirm whether snapshot/unused items should remain archive-only and whether duplicate same-month debit settlements should stay.`,
      currentSafeHandling:
        'Preserved snapshot-only accounts and unused payees strictly inside debtfree_household_import_records without creating phantom debts, and kept same-month debit settlements in cash-only debit_bill + archive.',
      records: archiveArtifactRecords,
    });
  }

  return questions;
}

export function convertDashboardBackup(
  rawSourceJson: string,
  options: {
    userId: string;
    householdId: string;
    householdName?: string;
    currencyCode?: string;
    countryCode?: 'US' | 'CA' | 'GB' | 'AU';
    seed?: string;
    baselineDest?: DestinationBackupSnapshot | null;
    decisions?: MigrationDecisionsConfig;
  },
): ConversionResult {
  const seed = options.seed ?? DEFAULT_UUID_NAMESPACE;
  const currency = options.currencyCode ?? 'USD';
  const countryCode = options.countryCode ?? 'US';
  const sourceByteLength = Buffer.byteLength(rawSourceJson, 'utf8');
  const sourceSha256 = createHash('sha256').update(rawSourceJson, 'utf8').digest('hex');

  const envelope = JSON.parse(rawSourceJson) as SourceBackupEnvelope;
  if (envelope.format !== 'debtfree-dashboard-backup' || envelope.version !== 6 || !envelope.payload) {
    throw new TypeError(`Unsupported source backup format/version: ${String(envelope.format)} v${String(envelope.version)}`);
  }

  const p = envelope.payload;
  const accounts = Array.isArray(p.accounts) ? p.accounts : [];
  const loans = Array.isArray(p.monthlyPlan?.loanTrackers) ? p.monthlyPlan.loanTrackers : [];
  const sourceTransactions = Array.isArray(p.transactions) ? p.transactions : [];
  const sourceAdjustments = Array.isArray(p.balanceAdjustments) ? p.balanceAdjustments : [];
  const monthlyBudgets = p.monthlyBudgets ?? {};
  const monthsPlan = p.monthlyPlan?.months ?? {};
  const dpas = Array.isArray(p.monthlyPlan?.duePaymentAssociations) ? p.monthlyPlan.duePaymentAssociations : [];
  const snapshots = Array.isArray(p.snapshots) ? p.snapshots : [];
  const payees = Array.isArray(p.payees) ? p.payees : [];
  const disabledRecurringSources: string[] = Array.isArray(p.monthlyPlan?.disabledRecurringSources)
    ? p.monthlyPlan.disabledRecurringSources
    : [];

  const retiredDebtIds = new Set<string>(
    (options.baselineDest?.debtfree_deleted_debt_ids ?? []).map((r: any) => String(r.id)),
  );
  const retiredBillIds = new Set<string>(
    (options.baselineDest?.debtfree_deleted_bill_ids ?? []).map((r: any) => String(r.bill_id)),
  );

  const importRecords: ImportArchiveRecord[] = [];
  const accountIdMap: Record<string, string> = {};
  const billIdMap: Record<string, string> = {};
  const txIdMap: Record<string, string> = {};
  const anchorIdMap: Record<string, string> = {};

  const budgetMonths = Object.keys(monthlyBudgets).sort();
  const exportMonth = cleanOptionalIso(envelope.exportedAt)?.slice(0, 7) ?? '';
  const activeBudgetMonth =
    exportMonth && budgetMonths.includes(exportMonth)
      ? exportMonth
      : budgetMonths[budgetMonths.length - 1] ?? '';
  const activeBudgetRows = activeBudgetMonth && Array.isArray(monthlyBudgets[activeBudgetMonth])
    ? monthlyBudgets[activeBudgetMonth]
    : [];

  // 1. Map Card Accounts + Loan Trackers -> Debts
  const customOrder = Array.isArray(p.customDebtOrder) ? p.customDebtOrder : [];
  const debts: DebtItem[] = [];
  const archivedPaidOffDebtIds: string[] = [];
  const accountNameBySourceId = new Map<string, string>();
  const expectedDebtBalances: Array<{
    debtId: string;
    sourceId: string;
    name: string;
    category: DebtItem['category'];
    expectedBalance: number;
    reconciledBalance: number;
  }> = [];

  for (let idx = 0; idx < accounts.length; idx++) {
    const acc = accounts[idx];
    accountNameBySourceId.set(acc.id, acc.name);
    let mappedUuid = deterministicUuidV5(seed, `debt:account:${acc.id}`);
    if (retiredDebtIds.has(mappedUuid)) {
      mappedUuid = deterministicUuidV5(seed, `debt:account:alt:${acc.id}`);
    }
    accountIdMap[acc.id] = mappedUuid;

    const currentCents = prototypeAccountCalculatedCents(acc, sourceTransactions);
    const currentBalance = centsToMajor(currentCents);
    const createdAt = cleanOptionalIso(acc.createdAt) ?? cleanOptionalIso(envelope.exportedAt)!;
    const isArchived = Boolean(acc.archivedAt) && currentCents === 0;
    if (isArchived) {
      archivedPaidOffDebtIds.push(mappedUuid);
    }

    const useCycleMinimum =
      acc.minimumMode === 'auto' &&
      Boolean(activeBudgetMonth) &&
      Array.isArray(acc.minimumCycles) &&
      acc.minimumCycles.some(
        (c: any) =>
          String(c.date ?? '').startsWith(activeBudgetMonth) &&
          roundCents(c.amount) !== roundCents(acc.minimum),
      );
    const minimumPayment = options.decisions?.minimumPaymentOverrides?.[acc.id] ?? (useCycleMinimum
      ? pickCycleMinimumPayment(acc, p.monthlyPlan, activeBudgetMonth)
      : roundCents(Number(acc.minimum ?? 0)));

    const debt: DebtItem = {
      id: mappedUuid,
      name: String(acc.name).trim(),
      category: 'Credit card',
      balance: currentBalance,
      originalBalance: acc.baselineBalance != null ? roundCents(Number(acc.baselineBalance)) : roundCents(Number(acc.balance ?? 0)),
      apr: Number(acc.apr ?? 0),
      minimumPayment,
      dueDay: options.decisions?.debtDueDayOverrides?.[acc.id] ?? extractDueDay(acc.dueDate),
      creditLimit: acc.creditLimit != null ? roundCents(Number(acc.creditLimit)) : null,
      annualFeeAmount: null,
      annualFeeNextDueDate: null,
      createdAt,
      updatedAt: cleanOptionalIso(acc.archivedAt) ?? cleanOptionalIso(acc.reconciliation?.createdAt) ?? createdAt,
      serverVersion: 1,
    };
    debts.push(debt);

    importRecords.push({
      domain: 'account_metadata',
      id: acc.id,
      source_id: acc.id,
      native_table: 'debts',
      native_record_id: mappedUuid,
      disposition: 'mapped_with_metadata',
      source_deleted_at: null,
      source_created_at: createdAt,
      source_updated_at: cleanOptionalIso(acc.archivedAt) ?? cleanOptionalIso(acc.reconciliation?.createdAt),
      attribution: null,
      source_record: {
        ...acc,
        mappedUuid,
        calculatedCurrentBalance: currentBalance,
        mappedMinimumPayment: minimumPayment,
        priorityOrder: (customOrder.indexOf(acc.id) >= 0 ? customOrder.indexOf(acc.id) : idx) + 1,
      },
      notes: 'Preserves prototype baselineBalance, balanceOffset, reconciliation coveredTransactionIds, promoEndDate/postPromoApr, minimumCycles, interestAutomation, displayGroup, customNote, archivedAt.',
    });

    if (Array.isArray(acc.archiveHistory)) {
      for (const ah of acc.archiveHistory) {
        importRecords.push({
          domain: 'account_archive_history',
          id: ah.id,
          source_id: ah.id,
          native_table: 'household_settings',
          native_record_id: mappedUuid,
          disposition: 'mapped_with_metadata',
          source_deleted_at: null,
          source_created_at: cleanOptionalIso(ah.createdAt),
          source_updated_at: null,
          attribution: extractAttribution(ah),
          source_record: { accountId: acc.id, accountName: acc.name, mappedUuid, ...ah },
          notes: 'Archived card proof preserved in archiveHistory; account UUID added to household_settings.archivedPaidOffDebtIds at $0.00 balance.',
        });
      }
    }
  }

  // Loan Trackers -> Mortgage / Auto loan debts + loan history anchors & payments
  const loanPaymentTxs: LedgerTransaction[] = [];
  const loanAnchors: ReconciliationAnchor[] = [];
  const mortgageEscrowByDebtId: Record<string, number> = {};
  const pairedLoanByBudgetSourceId = new Map<string, { debtId: string; category: 'Mortgage' | 'Auto loan'; name: string }>();

  const loanPaymentMonthsByBudgetSourceId = new Map<string, Set<string>>();
  const activeBudgetDueDayBySourceId = new Map<string, number>();
  for (const row of activeBudgetRows) {
    if (row.kind === 'expense' && row.recurring) {
      const recSrc = String(row.recurringSourceId ?? row.id);
      if (Number.isInteger(Number(row.dueDay))) {
        activeBudgetDueDayBySourceId.set(recSrc, Number(row.dueDay));
      }
    }
  }

  for (let idx = 0; idx < loans.length; idx++) {
    const loan = loans[idx];
    accountNameBySourceId.set(loan.id, loan.name);
    let mappedUuid = UUID_REGEX.test(String(loan.id))
      ? String(loan.id).toLowerCase()
      : deterministicUuidV5(seed, `debt:loan:${loan.id}`);
    if (retiredDebtIds.has(mappedUuid)) {
      mappedUuid = deterministicUuidV5(seed, `debt:loan:alt:${loan.id}`);
    }
    accountIdMap[loan.id] = mappedUuid;

    const category: DebtItem['category'] = loan.kind === 'house' ? 'Mortgage' : 'Auto loan';
    const history: any[] = Array.isArray(loan.history) ? loan.history : [];
    const earliestRecordedAt = history
      .map((h) => cleanOptionalIso(h.recordedAt))
      .filter((x): x is string => Boolean(x))
      .sort()[0];
    const latestRecordedAt = history
      .map((h) => cleanOptionalIso(h.recordedAt))
      .filter((x): x is string => Boolean(x))
      .sort()
      .slice(-1)[0];

    const loanDebt: DebtItem = {
      id: mappedUuid,
      name: String(loan.name).trim(),
      category,
      balance: roundCents(Number(loan.remainingAmount ?? 0)),
      originalBalance: loan.originalAmount != null ? roundCents(Number(loan.originalAmount)) : null,
      apr: Number(loan.apr ?? 0),
      minimumPayment: roundCents(Number(loan.monthlyPayment ?? 0)),
      dueDay: options.decisions?.debtDueDayOverrides?.[loan.id] ?? extractDueDay(loan.dueDate),
      creditLimit: null,
      annualFeeAmount: null,
      annualFeeNextDueDate: null,
      createdAt: earliestRecordedAt ?? cleanOptionalIso(envelope.exportedAt)!,
      updatedAt: latestRecordedAt ?? cleanOptionalIso(envelope.exportedAt)!,
      serverVersion: 1,
    };
    debts.push(loanDebt);

    if (category === 'Mortgage' && typeof loan.escrow === 'number' && loan.escrow >= 0) {
      mortgageEscrowByDebtId[mappedUuid] = roundCents(loan.escrow);
    }
    const budgetSourceId = typeof loan.budgetItemId === 'string' && loan.budgetItemId.trim() ? loan.budgetItemId.trim() : null;
    if (budgetSourceId) {
      pairedLoanByBudgetSourceId.set(budgetSourceId, { debtId: mappedUuid, category, name: loan.name });
    }
    const pairedDueDay =
      options.decisions?.debtDueDayOverrides?.[loan.id] ??
      (budgetSourceId ? options.decisions?.billDueDayOverrides?.[budgetSourceId] ?? activeBudgetDueDayBySourceId.get(budgetSourceId) : undefined) ??
      extractDueDay(loan.dueDate) ??
      1;

    importRecords.push({
      domain: 'loan_tracker',
      id: loan.id,
      source_id: loan.id,
      native_table: 'debts',
      native_record_id: mappedUuid,
      disposition: loan.balanceKind === 'payoff' && !options.decisions?.resolvedTopicNotes?.loans ? 'pending_owner_clarification' : 'mapped_with_metadata',
      source_deleted_at: null,
      source_created_at: loanDebt.createdAt,
      source_updated_at: loanDebt.updatedAt,
      attribution: null,
      source_record: { ...loan, mappedUuid },
      notes:
        loan.balanceKind === 'payoff'
          ? 'Source loan balanceKind="payoff" (not verified principal); preserved remainingAmount cleanly and flagged for owner confirmation.'
          : 'Source Mortgage tracker (balanceKind="principal"); paired recurring bill and escrow preserved.',
    });

    for (let hIdx = 0; hIdx < history.length; hIdx++) {
      const entry = history[hIdx];
      const recordedAt = cleanOptionalIso(entry.recordedAt) ?? loanDebt.createdAt;
      const historySourceId = `${loan.id}:${entry.date}:${entry.recordedAt}`;
      const anchorId = `anchor:mig:loan:${shortHash12(seed, historySourceId)}`;
      anchorIdMap[historySourceId] = anchorId;

      const isEstimated = Boolean(entry.estimated) || entry.balanceKind === 'payoff';
      loanAnchors.push({
        id: anchorId,
        accountId: mappedUuid,
        asOfDate: entry.date,
        verifiedBalance: makeMoney(currency, toCents(Number(entry.amount))),
        createdAt: recordedAt,
        note: `Imported source ${category} history (${entry.balanceKind}${entry.estimated ? ', estimated' : ''})`,
        createdAdjustmentId: null,
      });

      let nativePaymentId: string | null = null;
      if (typeof entry.payment === 'number' && entry.payment > 0) {
        if (budgetSourceId) {
          let monthSet = loanPaymentMonthsByBudgetSourceId.get(budgetSourceId);
          if (!monthSet) {
            monthSet = new Set<string>();
            loanPaymentMonthsByBudgetSourceId.set(budgetSourceId, monthSet);
          }
          monthSet.add(`${String(entry.date).slice(0, 7)}:${toCents(entry.payment)}`);
        }

        const entryMonth = String(entry.date).slice(0, 7);
        const appliesToDate = parseDateOnly(`${entryMonth}-${String(pairedDueDay).padStart(2, '0')}`);

        nativePaymentId = `tx:mig:loan:${shortHash12(seed, historySourceId)}`;
        txIdMap[historySourceId] = nativePaymentId;
        if (entry.estimated) {
          // Do not assert estimated payoff-quote allocations as verified principal.
          loanPaymentTxs.push({
            id: nativePaymentId,
            accountId: mappedUuid,
            date: entry.date,
            appliesToDate,
            amount: makeMoney(currency, toCents(entry.payment)),
            category: 'payment',
            payee: loan.name,
            memo: `Imported source ${loan.name} payment [Estimated payoff-quote allocation not asserted as verified principal: est P $${roundCents(entry.principal).toFixed(2)} / I $${roundCents(entry.interest).toFixed(2)}]`,
            source: 'manual',
            reconciled: true,
            createdAt: recordedAt,
            updatedAt: recordedAt,
            deletedAt: null,
          });
        } else {
          loanPaymentTxs.push({
            id: nativePaymentId,
            accountId: mappedUuid,
            date: entry.date,
            appliesToDate,
            amount: makeMoney(currency, toCents(entry.payment)),
            category: 'payment',
            payee: loan.name,
            memo: `Imported source ${loan.name} principal/interest/escrow payment`,
            source: 'manual',
            reconciled: true,
            createdAt: recordedAt,
            updatedAt: recordedAt,
            deletedAt: null,
            principalAmount: entry.principal != null ? makeMoney(currency, toCents(entry.principal)) : null,
            interestAmount: entry.interest != null ? makeMoney(currency, toCents(entry.interest)) : null,
            escrowAmount: entry.escrow != null ? makeMoney(currency, toCents(entry.escrow)) : null,
            feeAmount: null,
          });
        }
      }

      importRecords.push({
        domain: 'loan_history',
        id: historySourceId,
        source_id: historySourceId,
        native_table: 'reconciliation_anchors',
        native_record_id: anchorId,
        disposition: isEstimated && !options.decisions?.resolvedTopicNotes?.loans ? 'pending_owner_clarification' : 'mapped_with_metadata',
        source_deleted_at: null,
        source_created_at: recordedAt,
        source_updated_at: recordedAt,
        attribution: null,
        source_record: { loanId: loan.id, mappedUuid, nativePaymentId, ...entry },
        notes: nativePaymentId
          ? `Loan history row mapped to anchor ${anchorId} and transaction ${nativePaymentId}.`
          : `Loan balance checkpoint mapped to anchor ${anchorId}.`,
      });

      if (Array.isArray(entry.corrections)) {
        for (let cIdx = 0; cIdx < entry.corrections.length; cIdx++) {
          const corr = entry.corrections[cIdx];
          const corrId = `${historySourceId}:corr:${cIdx}`;
          importRecords.push({
            domain: 'loan_correction',
            id: corrId,
            source_id: corrId,
            native_table: null,
            native_record_id: null,
            disposition: 'source_only_archive',
            source_deleted_at: null,
            source_created_at: cleanOptionalIso(corr.recordedAt),
            source_updated_at: null,
            attribution: null,
            source_record: { loanId: loan.id, historyId: historySourceId, ...corr },
            notes: 'Nested loan history correction snapshot preserved in archive.',
          });
        }
      }
    }
  }

  // 2. Recurring Bills from active budget month

  const recurringBills: RecurringBill[] = [];
  const billByRecurringSourceId = new Map<string, RecurringBill>();
  const loanBillPairingByDebtId: NonNullable<UserOnboardingData['loanBillPairingByDebtId']> = {};
  const recurringBillCategoryLabelByBillId: NonNullable<UserOnboardingData['recurringBillCategoryLabelByBillId']> = {};

  for (const row of activeBudgetRows) {
    if (row.kind !== 'expense' || !row.recurring) continue;
    const recSourceId = String(row.recurringSourceId ?? row.id);
    if (disabledRecurringSources.includes(recSourceId)) continue;

    let nativeBillId = `rb-mig-${shortHash12(seed, recSourceId)}`;
    if (retiredBillIds.has(nativeBillId)) {
      nativeBillId = `rb-mig-alt-${shortHash12(seed, recSourceId)}`;
    }
    billIdMap[recSourceId] = nativeBillId;
    billIdMap[row.id] = nativeBillId;

    const pairedLoan = pairedLoanByBudgetSourceId.get(recSourceId);
    const category = mapRecurringBillCategory(row.category, pairedLoan?.category);
    const paymentMethod = row.paymentMethod === 'credit' ? 'credit' : 'debit';
    const creditAccountId = paymentMethod === 'credit' ? accountIdMap[row.creditAccountId] ?? null : null;
    if (paymentMethod === 'credit' && !creditAccountId) {
      throw new TypeError(`Recurring credit bill ${row.name} missing mapped creditAccountId`);
    }

    const createdAt = cleanOptionalIso(row.createdAt) ?? cleanOptionalIso(envelope.exportedAt)!;
    const bill: RecurringBill = {
      id: nativeBillId,
      name: String(row.name).trim(),
      category,
      amount: makeMoney(currency, toCents(Number(row.amount))),
      dueDay: options.decisions?.billDueDayOverrides?.[recSourceId] ?? Number(row.dueDay ?? 1),
      paymentMethod,
      creditAccountId: creditAccountId ?? undefined,
      autoPost: Boolean(row.autoPay),
      active: true,
      createdAt,
      updatedAt: createdAt,
    };
    recurringBills.push(bill);
    billByRecurringSourceId.set(recSourceId, bill);

    if (pairedLoan) {
      loanBillPairingByDebtId[pairedLoan.debtId] = {
        status: 'linked',
        billId: nativeBillId,
      };
      if (pairedLoan.category === 'Auto loan' && String(row.category ?? '').trim()) {
        recurringBillCategoryLabelByBillId[nativeBillId] = String(row.category).trim();
      }
    }
  }

  // Archive ALL monthlyBudgets rows across all months
  for (const m of budgetMonths) {
    const items = Array.isArray(monthlyBudgets[m]) ? monthlyBudgets[m] : [];
    for (const item of items) {
      const recSourceId = String(item.recurringSourceId ?? item.id);
      const mappedBillId = billIdMap[recSourceId] ?? null;
      importRecords.push({
        domain: 'monthly_budget',
        id: `${m}:${item.id}`,
        source_id: String(item.id),
        native_table: item.kind === 'expense' && mappedBillId ? 'recurring_bills' : item.kind === 'income' ? 'household_settings' : null,
        native_record_id: mappedBillId,
        disposition: mappedBillId || (m === activeBudgetMonth && item.kind === 'income') ? 'mapped_with_metadata' : 'source_only_archive',
        source_deleted_at: null,
        source_created_at: cleanOptionalIso(item.createdAt),
        source_updated_at: null,
        attribution: null,
        source_record: { month: m, ...item },
        notes: item.kind === 'income'
          ? `Month ${m} income item (${item.recurring ? 'recurring' : 'one-off'}).`
          : `Month ${m} expense item (${item.recurring ? 'recurring' : 'one-off'}).`,
      });
    }
  }

  // 3. Map Source Transactions -> LedgerTransactions (excluding amount === 0 from public.transactions!)
  const nativeTransactions: LedgerTransaction[] = [];
  const excludedZeroTransactions: any[] = [];

  for (const tx of sourceTransactions) {
    const mappedAccountId = accountIdMap[tx.accountId] ?? null;
    if (!mappedAccountId) {
      throw new TypeError(`Transaction ${tx.id} references unknown account ${tx.accountId}`);
    }
    const amtCents = toCents(Number(tx.amount));
    const createdAt = cleanOptionalIso(tx.createdAt) ?? cleanOptionalIso(envelope.exportedAt)!;
    const updatedAt = cleanOptionalIso(tx.updatedAt) ?? createdAt;
    const deletedAt = cleanOptionalIso(tx.deletedAt);

    if (amtCents === 0) {
      // CRITICAL: validateLedgerTransaction forbids zero-amount rows; preserve strictly in import archive.
      excludedZeroTransactions.push(tx);
      importRecords.push({
        domain: 'transaction_archive',
        id: tx.id,
        source_id: tx.id,
        native_table: null,
        native_record_id: null,
        disposition: 'excluded_from_active_ledger',
        source_deleted_at: deletedAt,
        source_created_at: createdAt,
        source_updated_at: updatedAt,
        attribution: extractAttribution(tx),
        source_record: { ...tx, mappedAccountId },
        notes: 'Excluded from public.transactions because native validateLedgerTransaction rejects zero-amount transactions (amount.minorUnits === 0). Preserved verbatim in archive.',
      });
      continue;
    }

    const mappedCategory = mapTransactionCategory(tx);
    const isAutoRecurring = Boolean(tx.automaticRecurringCharge && tx.plannedSourceId);
    const matchedBill = isAutoRecurring ? billByRecurringSourceId.get(String(tx.plannedSourceId)) : undefined;

    let nativeTxId = String(tx.id);
    let source: LedgerTransaction['source'] = 'manual';
    let appliesToDate: string | null = null;

    if (matchedBill && deletedAt === null) {
      // Deduplicate against processRecurringBills() checks: bill:${bill.id}:${date}
      nativeTxId = `bill:${matchedBill.id}:${tx.date}`;
      source = 'recurring_bill';
      appliesToDate = tx.date;
    } else if (matchedBill && deletedAt !== null) {
      nativeTxId = `mig-del:${tx.id}`;
      source = 'recurring_bill';
      appliesToDate = tx.date;
    } else if (nativeTxId.startsWith('bill:')) {
      nativeTxId = `mig:${nativeTxId}`;
    }

    txIdMap[tx.id] = nativeTxId;

    const payee = String(tx.payeeName || tx.payee || accountNameBySourceId.get(tx.accountId) || 'Unknown').trim();
    const memoParts: string[] = [];
    if (typeof tx.memo === 'string' && tx.memo.trim()) memoParts.push(tx.memo.trim());
    if (typeof tx.title === 'string' && tx.title.trim() && tx.title.trim() !== payee) {
      memoParts.push(tx.title.trim());
    }
    if (tx.includedIn) {
      memoParts.push(`[source includedIn=${JSON.stringify(tx.includedIn)}]`);
    }
    if (tx.replacedByTransactionId) {
      memoParts.push(`[replacedBy=${tx.replacedByTransactionId}]`);
    }

    const ledgerTx: LedgerTransaction = {
      id: nativeTxId,
      accountId: mappedAccountId,
      date: tx.date,
      appliesToDate: appliesToDate ? parseDateOnly(appliesToDate) : null,
      amount: makeMoney(currency, amtCents),
      category: mappedCategory,
      payee,
      memo: memoParts.length > 0 ? memoParts.join(' | ') : undefined,
      source,
      reconciled: false,
      createdAt,
      updatedAt,
      deletedAt,
      isPending: false,
    };
    validateLedgerTransaction(ledgerTx);
    nativeTransactions.push(ledgerTx);

    if (Array.isArray(tx.revisions)) {
      for (let rIdx = 0; rIdx < tx.revisions.length; rIdx++) {
        const rev = tx.revisions[rIdx];
        const revId = `${tx.id}:rev:${rIdx}`;
        importRecords.push({
          domain: 'transaction_revision',
          id: revId,
          source_id: revId,
          native_table: 'transactions',
          native_record_id: nativeTxId,
          disposition: 'source_only_archive',
          source_deleted_at: cleanOptionalIso(rev.deletedAt),
          source_created_at: cleanOptionalIso(rev.createdAt),
          source_updated_at: cleanOptionalIso(rev.correctedAt ?? rev.updatedAt),
          attribution: extractAttribution(rev),
          source_record: { parentTxId: tx.id, nativeTxId, ...rev },
          notes: 'Nested transaction revision snapshot preserved in archive.',
        });
      }
    }
  }

  // Add Loan Payment TXs
  for (const ltx of loanPaymentTxs) {
    validateLedgerTransaction(ltx);
    nativeTransactions.push(ltx);
  }

  // Add non-loan debit settlements (and September debit settlements lacking loan-history breakdown) as cash-only debit_bill rows
  const settlementTxIdMap: Record<string, string> = {};
  for (const month of Object.keys(monthsPlan).sort()) {
    const mData = monthsPlan[month];
    importRecords.push({
      domain: 'monthly_plan_month',
      id: month,
      source_id: month,
      native_table: null,
      native_record_id: null,
      disposition: 'source_only_archive',
      source_deleted_at: null,
      source_created_at: null,
      source_updated_at: null,
      attribution: null,
      source_record: mData,
      notes: `Monthly plan parameters for ${month}.`,
    });

    const settlements = Array.isArray(mData?.settlements) ? mData.settlements : [];
    for (const s of settlements) {
      const recSrc = String(s.recurringSourceId ?? s.targetId ?? '').replace(/^recurring:\d{4}-\d{2}:/, '');
      const matchedBill = billByRecurringSourceId.get(recSrc);
      const isIncludedCredit = s.source === 'included';

      let nativeSettlementTxId: string | null = null;
      let disposition: ImportArchiveRecord['disposition'] = 'source_only_archive';
      let note = '';

      const duplicateSettlement = options.decisions?.duplicateSettlements?.find((d) => d.settlementId === s.id);
      const historyMapping = options.decisions?.historicalLoanSettlementMappings?.find((d) => d.settlementId === s.id);
      const dedupedLoan = options.decisions?.dedupedLoanSettlements?.find((d) => d.settlementId === s.id);
      if (duplicateSettlement) {
        nativeSettlementTxId = settlementTxIdMap[duplicateSettlement.activeSettlementId];
        if (!nativeSettlementTxId) throw new Error(`Duplicate settlement ${s.id} references missing or later active settlement`);
        disposition = 'excluded_from_active_ledger';
        note = `Duplicate of settlement ${duplicateSettlement.activeSettlementId}; linked to its transaction.`;
      } else if (dedupedLoan) {
        const debtId = accountIdMap[dedupedLoan.loanId];
        const candidates = loanPaymentTxs.filter((tx) => tx.accountId === debtId && tx.date === dedupedLoan.loanHistoryDate && tx.amount.minorUnits === toCents(Number(s.amount)));
        if (candidates.length !== 1) throw new Error(`Loan settlement ${s.id} has ${candidates.length} matching history payments`);
        nativeSettlementTxId = candidates[0].id;
        disposition = 'excluded_from_active_ledger';
        note = 'Explicitly linked to existing loan history payment.';
      } else if (historyMapping) {
        const debtId = accountIdMap[historyMapping.loanId];
        if (!debtId || toCents(Number(s.amount)) <= 0) throw new Error(`Invalid historical loan settlement ${s.id}`);
        nativeSettlementTxId = `tx:mig:settlement:${shortHash12(seed, s.id)}`;
        const createdAt = cleanOptionalIso(s.createdAt) ?? cleanOptionalIso(envelope.exportedAt)!;
        const tx: LedgerTransaction = { id: nativeSettlementTxId, accountId: debtId, date: s.date,
          appliesToDate: historyMapping.appliesToDate ? parseDateOnly(historyMapping.appliesToDate) : null,
          amount: makeMoney(currency, toCents(Number(s.amount))), category: 'payment', payee: String(s.name).trim(),
          memo: `Imported historical loan payment; allocation unknown (source ${s.id})`, source: 'manual',
          reconciled: true, createdAt, updatedAt: createdAt, deletedAt: null, isPending: false };
        validateLedgerTransaction(tx); nativeTransactions.push(tx);
        settlementTxIdMap[s.id] = nativeSettlementTxId;
        disposition = 'mapped_with_metadata'; note = 'Historical loan payment with unknown allocation.';
      } else if (isIncludedCredit) {
        disposition = 'excluded_from_active_ledger';
        note = 'Settlement source="included" (credit card charge already on card ledger); not posted again to avoid double-counting.';
      } else if (s.source === 'debit' && toCents(Number(s.amount)) > 0) {
        // Non-loan debit settlement or prior-month debit-only settlement lacking loan split -> cash_only debit_bill ($0 debt impact)
        if (month === activeBudgetMonth && matchedBill) {
          nativeSettlementTxId = `bill:${matchedBill.id}:${month}-${String(matchedBill.dueDay).padStart(2, '0')}`;
        } else {
          nativeSettlementTxId = `tx:mig:settlement:${shortHash12(seed, s.id)}`;
        }
        settlementTxIdMap[s.id] = nativeSettlementTxId;
        const createdAt = cleanOptionalIso(s.createdAt) ?? cleanOptionalIso(envelope.exportedAt)!;
        const debitTx: LedgerTransaction = {
          id: nativeSettlementTxId,
          accountId: null,
          date: s.date,
          appliesToDate: matchedBill ? parseDateOnly(`${month}-${String(matchedBill.dueDay).padStart(2, '0')}`) : null,
          amount: makeMoney(currency, toCents(Number(s.amount))),
          category: 'debit_bill',
          payee: String(s.name).trim(),
          memo: `Imported ${month} debit bill settlement (source ${s.id})`,
          source: matchedBill ? 'recurring_bill' : 'manual',
          reconciled: true,
          createdAt,
          updatedAt: createdAt,
          deletedAt: null,
          isPending: false,
        };
        validateLedgerTransaction(debitTx);
        nativeTransactions.push(debitTx);
        disposition = 'mapped_with_metadata';
        note = `Mapped debit settlement to cash_only debit_bill transaction ${nativeSettlementTxId}.`;
      }

      importRecords.push({
        domain: 'monthly_plan_settlement',
        id: s.id,
        source_id: s.id,
        native_table: nativeSettlementTxId ? 'transactions' : null,
        native_record_id: nativeSettlementTxId,
        disposition,
        source_deleted_at: null,
        source_created_at: cleanOptionalIso(s.createdAt),
        source_updated_at: null,
        attribution: null,
        source_record: { month, ...s, nativeSettlementTxId },
        notes: note,
      });
    }
  }

  // 4. Map Balance Adjustments -> Reconciliation Anchors (active adjustments) + Archive (all + revisions)
  const nativeAnchors: ReconciliationAnchor[] = [...loanAnchors];
  const cardLatestAnchorMap = new Map<string, ReconciliationAnchor>();

  for (const adj of sourceAdjustments) {
    const mappedAccountId = accountIdMap[adj.accountId];
    if (!mappedAccountId) {
      throw new TypeError(`Balance adjustment ${adj.id} references unknown account ${adj.accountId}`);
    }
    const createdAt = cleanOptionalIso(adj.createdAt) ?? cleanOptionalIso(envelope.exportedAt)!;
    const updatedAt = cleanOptionalIso(adj.updatedAt) ?? createdAt;
    const deletedAt = cleanOptionalIso(adj.deletedAt);
    const verifiedBalanceMajor = adj.reconciliationAnchor
      ? roundCents(Number(adj.reconciliationAnchor.balance))
      : roundCents(Number(adj.balanceAfter));

    let nativeAnchorId: string | null = null;
    let disposition: ImportArchiveRecord['disposition'] = 'source_only_archive';

    let nativeAdjustmentTxId: string | null = null;
    const duplicate = options.decisions?.duplicateAdjustmentTransactionPairs?.find((pair) => pair.adjustmentId === adj.id);
    if (deletedAt === null && duplicate) {
      nativeAdjustmentTxId = txIdMap[duplicate.transactionId];
      const existing = nativeTransactions.find((tx) => tx.id === nativeAdjustmentTxId && !tx.deletedAt);
      if (!existing || existing.accountId !== mappedAccountId || existing.category !== 'payment' || existing.amount.minorUnits !== Math.abs(toCents(Number(adj.difference)))) {
        throw new Error(`Invalid explicit duplicate payment mapping for adjustment ${adj.id}`);
      }
    } else if (deletedAt === null) {
      const kind = options.decisions?.confirmedPaymentsAsRealTransactions && adj.confirmedPayment ? 'payment'
        : options.decisions?.reportKindAdjustmentsAsActivity && adj.reportKind === 'interest' ? 'interest'
        : options.decisions?.reportKindAdjustmentsAsActivity && adj.reportKind === 'purchase' ? 'purchase'
        : options.decisions?.reportKindAdjustmentsAsActivity && adj.reportKind === 'credit' ? 'credit_adjustment' : null;
      if (kind) {
        const amount = Math.abs(toCents(Number(adj.difference)));
        if (!amount) throw new Error(`Classified adjustment ${adj.id} has zero amount`);
        nativeAdjustmentTxId = `tx:mig:adjustment:${adj.id}`;
        const tx: LedgerTransaction = { id: nativeAdjustmentTxId, accountId: mappedAccountId, date: adj.date,
          amount: makeMoney(currency, amount), category: kind, payee: accountNameBySourceId.get(adj.accountId) ?? 'Imported adjustment',
          memo: `Imported classified adjustment ${adj.id}`, source: 'manual', reconciled: true,
          createdAt, updatedAt, deletedAt: null, isPending: false };
        validateLedgerTransaction(tx);
        nativeTransactions.push(tx);
      }
    }
    if (deletedAt === null && !duplicate?.suppressAdjustmentAnchor) {
      nativeAnchorId = `anchor:mig:${adj.id}`;
      anchorIdMap[adj.id] = nativeAnchorId;

      const noteParts: string[] = [];
      if (adj.title) noteParts.push(String(adj.title).trim());
      if (adj.note) noteParts.push(String(adj.note).trim());
      if (adj.reportKind) noteParts.push(`[source reportKind=${adj.reportKind}, diff=${Number(adj.difference).toFixed(2)}]`);
      if (adj.confirmedPayment) noteParts.push(`[source confirmedPayment at ${adj.confirmedPayment.confirmedAt}]`);
      if (adj.reconciliationAnchor?.coveredTransactionIds?.length) {
        noteParts.push(`[source covered ${adj.reconciliationAnchor.coveredTransactionIds.length} pre-anchor tx(s)]`);
      }

      const anchor: ReconciliationAnchor = {
        id: nativeAnchorId,
        accountId: mappedAccountId,
        asOfDate: adj.date,
        verifiedBalance: makeMoney(currency, toCents(verifiedBalanceMajor)),
        createdAt,
        note: noteParts.length > 0 ? noteParts.join(' | ') : `Reconciled balance update (${adj.id})`,
        createdAdjustmentId: nativeAdjustmentTxId,
      };
      nativeAnchors.push(anchor);
      const prevLatest = cardLatestAnchorMap.get(mappedAccountId);
      if (!prevLatest || anchor.asOfDate > prevLatest.asOfDate || (anchor.asOfDate === prevLatest.asOfDate && anchor.createdAt > prevLatest.createdAt)) {
        cardLatestAnchorMap.set(mappedAccountId, anchor);
      }

      const hasDeltaMismatch =
        adj.balanceBefore != null &&
        adj.balanceAfter != null &&
        adj.difference != null &&
        toCents(Number(adj.balanceAfter) - Number(adj.balanceBefore)) !== toCents(Number(adj.difference));
      const isQuestionable = Boolean(adj.confirmedPayment) || Boolean(adj.reportKind) || hasDeltaMismatch;
      disposition = isQuestionable && !nativeAdjustmentTxId && !options.decisions?.resolvedTopicNotes?.adjustments ? 'pending_owner_clarification' : 'mapped_with_metadata';
    } else {
      disposition = deletedAt ? 'excluded_from_active_ledger' : 'mapped_with_metadata';
    }

    importRecords.push({
      domain: 'balance_adjustment',
      id: adj.id,
      source_id: adj.id,
      native_table: nativeAnchorId ? 'reconciliation_anchors' : null,
      native_record_id: nativeAnchorId,
      disposition,
      source_deleted_at: deletedAt,
      source_created_at: createdAt,
      source_updated_at: updatedAt,
      attribution: extractAttribution(adj),
      source_record: { ...adj, mappedAccountId, nativeAnchorId, nativeAdjustmentTxId, duplicateMapping: duplicate ?? null },
      notes: deletedAt
        ? 'Soft-deleted prototype balance adjustment preserved exclusively in archive.'
        : nativeAdjustmentTxId ? `Mapped classified activity or explicit duplicate to transaction ${nativeAdjustmentTxId}; source checkpoint preserved where applicable.` : 'Mapped to native Reconcile with full source metadata archived.',
    });

    if (Array.isArray(adj.revisions)) {
      for (let rIdx = 0; rIdx < adj.revisions.length; rIdx++) {
        const rev = adj.revisions[rIdx];
        const revId = `${adj.id}:rev:${rIdx}`;
        importRecords.push({
          domain: 'balance_adjustment_revision',
          id: revId,
          source_id: revId,
          native_table: nativeAnchorId ? 'reconciliation_anchors' : null,
          native_record_id: nativeAnchorId,
          disposition: 'source_only_archive',
          source_deleted_at: cleanOptionalIso(rev.deletedAt),
          source_created_at: cleanOptionalIso(rev.createdAt),
          source_updated_at: cleanOptionalIso(rev.correctedAt ?? rev.updatedAt),
          attribution: extractAttribution(rev),
          source_record: { parentAdjustmentId: adj.id, nativeAnchorId, ...rev },
          notes: 'Nested balance adjustment revision preserved in archive.',
        });
      }
    }
  }

  // 5. Remaining Source-Only Domains (Payees, DPAs, Snapshots + Revisions, Disabled Recurring, Plan/Settings Metadata)
  for (const payee of payees) {
    importRecords.push({
      domain: 'payee',
      id: String(payee.id),
      source_id: String(payee.id),
      native_table: null,
      native_record_id: null,
      disposition: 'source_only_archive',
      source_deleted_at: cleanOptionalIso(payee.deletedAt),
      source_created_at: cleanOptionalIso(payee.createdAt),
      source_updated_at: null,
      attribution: null,
      source_record: payee,
      notes: 'Source payee directory entry; native stores payee text per transaction.',
    });
  }

  for (let dIdx = 0; dIdx < dpas.length; dIdx++) {
    const dpa = dpas[dIdx];
    const dpaId = `dpa:${dIdx}:${dpa.reminderId}:${dpa.dueDate}:${dpa.source?.id ?? ''}`;
    importRecords.push({
      domain: 'due_payment_association',
      id: dpaId,
      source_id: dpaId,
      native_table: null,
      native_record_id: null,
      disposition: dpa.source?.type === 'adjustment' && !options.decisions?.confirmedPaymentsAsRealTransactions ? 'pending_owner_clarification' : 'source_only_archive',
      source_deleted_at: null,
      source_created_at: null,
      source_updated_at: null,
      attribution: null,
      source_record: dpa,
      notes: 'Source due-payment association preserved in archive.',
    });
  }

  for (const snap of snapshots) {
    importRecords.push({
      domain: 'snapshot',
      id: String(snap.id),
      source_id: String(snap.id),
      native_table: null,
      native_record_id: null,
      disposition: 'source_only_archive',
      source_deleted_at: null,
      source_created_at: cleanOptionalIso(snap.capturedAt),
      source_updated_at: null,
      attribution: null,
      source_record: snap,
      notes: 'Source progress snapshot preserved in archive (includes 3 historical $0 snapshot-only cards in 2026-07).',
    });
    if (Array.isArray(snap.revisions)) {
      for (let rIdx = 0; rIdx < snap.revisions.length; rIdx++) {
        const rev = snap.revisions[rIdx];
        const revId = `${snap.id}:rev:${rIdx}`;
        importRecords.push({
          domain: 'snapshot_revision',
          id: revId,
          source_id: revId,
          native_table: null,
          native_record_id: null,
          disposition: 'source_only_archive',
          source_deleted_at: null,
          source_created_at: cleanOptionalIso(rev.capturedAt),
          source_updated_at: null,
          attribution: null,
          source_record: { parentSnapshotId: snap.id, ...rev },
          notes: 'Nested snapshot revision preserved in archive.',
        });
      }
    }
  }

  for (const srcId of disabledRecurringSources) {
    importRecords.push({
      domain: 'disabled_recurring_source',
      id: srcId,
      source_id: srcId,
      native_table: null,
      native_record_id: null,
      disposition: 'source_only_archive',
      source_deleted_at: null,
      source_created_at: null,
      source_updated_at: null,
      attribution: null,
      source_record: { recurringSourceId: srcId },
      notes: 'Disabled recurring budget source ID preserved in archive without reactivating bill.',
    });
  }

  const { months: _ignoredMonths, loanTrackers: _ignoredLoans, duePaymentAssociations: _ignoredDpas, disabledRecurringSources: _ignoredDis, ...monthlyPlanScalars } = p.monthlyPlan ?? {};
  importRecords.push({
    domain: 'monthly_plan',
    id: 'monthlyPlanScalars',
    source_id: 'monthlyPlan',
    native_table: 'household_settings',
    native_record_id: options.householdId,
    disposition: options.decisions?.resolvedTopicNotes?.settings ? 'mapped_with_metadata' : 'pending_owner_clarification',
    source_deleted_at: null,
    source_created_at: cleanOptionalIso(envelope.exportedAt),
    source_updated_at: null,
    attribution: null,
    source_record: monthlyPlanScalars,
    notes: 'Source monthlyPlan settings/scalars; contains payoffPlanStrategy vs root strategy and payoffExtraPayment vs extra differences.',
  });

  importRecords.push({
    domain: 'settings_metadata',
    id: 'rootSettings',
    source_id: 'rootSettings',
    native_table: 'household_settings',
    native_record_id: options.householdId,
    disposition: 'mapped_with_metadata',
    source_deleted_at: null,
    source_created_at: cleanOptionalIso(envelope.exportedAt),
    source_updated_at: null,
    attribution: null,
    source_record: {
      strategy: p.strategy,
      extra: p.extra,
      planning: p.planning,
      customDebtOrder: p.customDebtOrder,
    },
    notes: 'Root source strategy/extra/planning/customDebtOrder metadata preserved.',
  });

  // 6. Verify 100% Balance Parity via native calculateReconciledBalance() for all 15 Debts
  for (const debt of debts) {
    const accAnchors = nativeAnchors
      .filter((a) => a.accountId === debt.id)
      .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate) || b.createdAt.localeCompare(a.createdAt));
    const latestAnchor = accAnchors[0] ?? null;
    const opening = makeMoney(currency, toCents(debt.originalBalance ?? debt.balance));
    const res = calculateReconciledBalance({
      openingBalance: opening,
      anchor: latestAnchor,
      transactions: nativeTransactions,
      accountId: debt.id,
      debtCategory: debt.category,
    });
    const reconciledMajor = centsToMajor(res.currentBalance.minorUnits);
    if (toCents(reconciledMajor) !== toCents(debt.balance)) {
      throw new Error(
        `Balance parity mismatch for ${debt.name}: calculated=${reconciledMajor.toFixed(2)} vs expected=${debt.balance.toFixed(2)}`,
      );
    }
    expectedDebtBalances.push({
      debtId: debt.id,
      sourceId: Object.entries(accountIdMap).find(([, v]) => v === debt.id)?.[0] ?? debt.id,
      name: debt.name,
      category: debt.category,
      expectedBalance: debt.balance,
      reconciledBalance: reconciledMajor,
    });
  }

  // 7. Build Shared Household Settings + NativeBackup
  const recurringIncomes = activeBudgetRows.filter((r) => r.kind === 'income' && r.recurring);
  const primaryIncome = recurringIncomes[0] ?? { name: 'Primary', amount: 0 };
  const additionalIncomes = recurringIncomes.slice(1).map((inc, idx) => ({
    id: deterministicUuidV5(seed, `income:${inc.recurringSourceId ?? inc.id}:${idx}`),
    name: String(inc.name).trim(),
    amount: roundCents(Number(inc.amount)),
    frequency: 'monthly' as const,
    monthlyAmount: roundCents(Number(inc.amount)),
  }));

  const selectedStrategy: PayoffStrategy = options.decisions?.strategy ?? (
    p.monthlyPlan?.payoffPlanStrategy === 'avalanche' || p.monthlyPlan?.payoffPlanStrategy === 'snowball'
      ? p.monthlyPlan.payoffPlanStrategy
      : p.strategy === 'snowball'
        ? 'snowball'
        : 'avalanche');
  const selectedExtra = options.decisions?.extraMonthlyPayment ?? (
    typeof p.monthlyPlan?.payoffExtraPayment === 'number' && Number.isFinite(p.monthlyPlan.payoffExtraPayment)
      ? roundCents(p.monthlyPlan.payoffExtraPayment)
      : roundCents(Number(p.extra ?? 0)));

  const householdName =
    options.householdName ??
    (typeof options.baselineDest?.households?.[0]?.name === 'string' && options.baselineDest.households[0].name.trim()
      ? options.baselineDest.households[0].name.trim()
      : 'My Household');

  const sharedHouseholdSettings: Record<string, unknown> = {
    householdId: options.householdId,
    householdName,
    countryCode,
    currencyCode: currency,
    primaryIncomeName: String(primaryIncome.name ?? 'Primary').trim(),
    primaryIncomeAmount: roundCents(Number(primaryIncome.amount ?? 0)),
    primaryPayFrequency: 'monthly',
    primaryMonthlyIncome: roundCents(Number(primaryIncome.amount ?? 0)),
    additionalIncomes,
    strategy: selectedStrategy,
    extraMonthlyPayment: selectedExtra,
    mortgageEscrowByDebtId,
    loanBillPairingByDebtId,
    recurringBillCategoryLabelByBillId,
    archivedPaidOffDebtIds,
  };

  const onboardingData: UserOnboardingData = {
    version: 1,
    userId: options.userId,
    householdId: options.householdId,
    householdName,
    currentStage: 'home',
    signupCompleted: true,
    onboardingCompleted: true,
    goals: [],
    referralSource: 'Other',
    consideredBeforeAi: null,
    countryCode,
    currencyCode: currency,
    managesWithPartner: null,
    worksWithProfessional: null,
    primaryIncomeName: sharedHouseholdSettings.primaryIncomeName as string,
    primaryIncomeAmount: sharedHouseholdSettings.primaryIncomeAmount as number,
    primaryPayFrequency: 'monthly',
    primaryMonthlyIncome: sharedHouseholdSettings.primaryMonthlyIncome as number,
    additionalIncomes,
    selectedPlan: 'premium',
    homeStatus: loans.some((l) => l.kind === 'house') ? 'Own' : 'Rent',
    vehicleStatus: loans.some((l) => l.kind === 'car') ? 'Finance' : 'None',
    debts,
    strategy: selectedStrategy,
    extraMonthlyPayment: selectedExtra,
    notifications: {
      upcomingReminders: true,
      overdueAlerts: true,
      milestonesAndProgress: true,
      permissionRequested: false,
      osPermissionStatus: 'undetermined',
    },
    completedAt: cleanOptionalIso(envelope.exportedAt),
    updatedAt: cleanOptionalIso(envelope.exportedAt)!,
    settingsRevision: (options.baselineDest?.household_settings?.[0]?.revision ?? 0) + 1,
    mortgageEscrowByDebtId,
    loanBillPairingByDebtId,
    recurringBillCategoryLabelByBillId,
    archivedPaidOffDebtIds,
  };

  const nativeBackup = createNativeBackup(
    {
      userId: options.userId,
      householdId: options.householdId,
      currency,
      exportedAt: cleanOptionalIso(envelope.exportedAt)!,
      onboardingData,
      transactions: nativeTransactions,
      recurringBills,
      reconciliationAnchors: nativeAnchors,
    },
    { userId: options.userId, householdId: options.householdId, role: 'owner' },
  );

  validateStoredAmounts(onboardingData);
  const lifecycleWarnings = nativeBackupLifecycleWarnings(nativeBackup);
  if (lifecycleWarnings.length > 0) {
    throw new Error(`Unexpected nativeBackupLifecycleWarnings: ${lifecycleWarnings.join(' | ')}`);
  }

  // Simulate processRecurringBills against source export timestamp to verify 0 duplicate auto-posts
  const autoPostSim = processRecurringBills({
    bills: recurringBills,
    existingTransactions: nativeTransactions,
    currentInstant: new Date(cleanOptionalIso(envelope.exportedAt)!),
    householdTimeZone: 'America/Los_Angeles',
  });
  if (autoPostSim.newTransactions.length !== 0) {
    throw new Error(
      `Expected 0 auto-post duplicates on source month, got ${autoPostSim.newTransactions.length}: ${autoPostSim.newTransactions.map((t) => t.id).join(', ')}`,
    );
  }

  // 8. Build Concrete Owner Questions for Ambiguous / Conflicting Source Records
  const ownerQuestions = buildOwnerQuestions({
    accounts,
    loans,
    debts,
    sourceTransactions,
    sourceAdjustments,
    monthsPlan,
    dpas,
    snapshots,
    payees,
    monthlyPlan: p.monthlyPlan ?? {},
    rootStrategy: p.strategy,
    rootExtra: p.extra,
    selectedStrategy,
    selectedExtra,
    activeBudgetMonth,
    activeBudgetDueDayBySourceId,
    accountIdMap,
    accountNameBySourceId,
    effectiveBillDueDayBySourceId: new Map([...billByRecurringSourceId].map(([id, bill]) => [id, bill.dueDay])),
    decisions: options.decisions,
  });

  for (const q of ownerQuestions) {
    importRecords.push({
      domain: 'owner_question',
      id: `q${q.number}`,
      source_id: `q${q.number}`,
      native_table: null,
      native_record_id: null,
      disposition: 'pending_owner_clarification',
      source_deleted_at: null,
      source_created_at: cleanOptionalIso(envelope.exportedAt),
      source_updated_at: null,
      attribution: null,
      source_record: q,
      notes: q.topic,
    });
  }

  const migrationKey = `dashboard-v6-import:${sourceSha256.slice(0, 16)}`;

  const conversionManifest = {
    migrationKey,
    generatedAt: new Date().toISOString(),
    source: {
      format: envelope.format,
      version: envelope.version,
      exportedAt: envelope.exportedAt,
      sha256: sourceSha256,
      byteLength: sourceByteLength,
    },
    destination: {
      householdId: options.householdId,
      userId: options.userId,
      currency,
      priorSettingsRevision: options.baselineDest?.household_settings?.[0]?.revision ?? null,
      newSettingsRevision: onboardingData.settingsRevision,
    },
    sourceInventoryCounts: {
      accounts: accounts.length,
      accountArchiveHistory: accounts.reduce((s, a) => s + (Array.isArray(a.archiveHistory) ? a.archiveHistory.length : 0), 0),
      loanTrackers: loans.length,
      loanHistory: loans.reduce((s, l) => s + (Array.isArray(l.history) ? l.history.length : 0), 0),
      loanCorrections: loans.reduce(
        (s, l) => s + (Array.isArray(l.history) ? l.history.reduce((c: number, h: any) => c + (Array.isArray(h.corrections) ? h.corrections.length : 0), 0) : 0),
        0,
      ),
      transactions: sourceTransactions.length,
      transactionsActive: sourceTransactions.filter((t) => !t.deletedAt).length,
      transactionsSoftDeleted: sourceTransactions.filter((t) => Boolean(t.deletedAt)).length,
      transactionsZeroAmountDeleted: excludedZeroTransactions.length,
      transactionRevisions: sourceTransactions.reduce((s, t) => s + (Array.isArray(t.revisions) ? t.revisions.length : 0), 0),
      balanceAdjustments: sourceAdjustments.length,
      balanceAdjustmentsActive: sourceAdjustments.filter((b) => !b.deletedAt).length,
      balanceAdjustmentsSoftDeleted: sourceAdjustments.filter((b) => Boolean(b.deletedAt)).length,
      balanceAdjustmentRevisions: sourceAdjustments.reduce((s, b) => s + (Array.isArray(b.revisions) ? b.revisions.length : 0), 0),
      monthlyBudgetMonths: budgetMonths.length,
      monthlyBudgetItems: budgetMonths.reduce((s, m) => s + (Array.isArray(monthlyBudgets[m]) ? monthlyBudgets[m].length : 0), 0),
      monthlyPlanMonths: Object.keys(monthsPlan).length,
      monthlyPlanSettlements: Object.values(monthsPlan).reduce((s, m: any) => s + (Array.isArray(m?.settlements) ? m.settlements.length : 0), 0),
      duePaymentAssociations: dpas.length,
      snapshots: snapshots.length,
      snapshotRevisions: snapshots.reduce((s, sn) => s + (Array.isArray(sn.revisions) ? sn.revisions.length : 0), 0),
      payees: payees.length,
      disabledRecurringSources: disabledRecurringSources.length,
    },
    nativeTargetCounts: {
      debts: debts.length,
      archivedPaidOffDebtIds: archivedPaidOffDebtIds.length,
      recurringBills: recurringBills.length,
      transactions: nativeTransactions.length,
      transactionsFromSourceCards: nativeTransactions.length - loanPaymentTxs.length - Object.keys(settlementTxIdMap).length - nativeTransactions.filter((tx) => tx.id.startsWith('tx:mig:adjustment:')).length,
      transactionsFromClassifiedAdjustments: nativeTransactions.filter((tx) => tx.id.startsWith('tx:mig:adjustment:')).length,
      transactionsFromLoanHistory: loanPaymentTxs.length,
      transactionsFromSettlements: Object.keys(settlementTxIdMap).length,
      reconciliationAnchors: nativeAnchors.length,
      importArchiveRows: 1,
      importArchiveRecords: importRecords.length,
    },
    expectedDebtBalances,
    totalCardBalanceExpected: roundCents(
      expectedDebtBalances.filter((d) => d.category === 'Credit card').reduce((s, d) => s + d.expectedBalance, 0),
    ),
    lifecycleWarnings,
    autoPostSimulation: {
      alreadyPostedCount: autoPostSim.alreadyPostedCount,
      newTransactionCount: autoPostSim.newTransactions.length,
    },
    ownerQuestionCount: ownerQuestions.length,
  };

  const identityMap = {
    accounts: accountIdMap,
    recurringBills: billIdMap,
    transactions: txIdMap,
    settlementTransactions: settlementTxIdMap,
    reconciliationAnchors: anchorIdMap,
    retiredDestinationDebtIds: [...retiredDebtIds],
    retiredDestinationBillIds: [...retiredBillIds],
  };

  return {
    migrationKey,
    sourceSha256,
    sourceByteLength,
    nativeBackup,
    sharedHouseholdSettings,
    conversionManifest,
    identityMap,
    ownerQuestions,
    importRecords,
    lifecycleWarnings,
    autoPostSimulation: {
      alreadyPostedCount: autoPostSim.alreadyPostedCount,
      newTransactionCount: autoPostSim.newTransactions.length,
    },
  };
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  const str = String(value);
  return `'${str.replace(/'/g, "''")}'`;
}

function sqlJsonbLiteral(value: unknown): string {
  return `${sqlLiteral(JSON.stringify(value))}::jsonb`;
}

export function writeMigrationSqlPackage(params: {
  rawSourceJson: string;
  conversion: ConversionResult;
  outputDir: string;
  baselineDest: DestinationBackupSnapshot;
  chunkBytes?: number;
}): { chunkCount: number; files: string[] } {
  const { rawSourceJson, conversion, outputDir, baselineDest, chunkBytes = 20000 } = params;
  fs.mkdirSync(outputDir, { recursive: true });

  // Clean old stage chunk files first so re-runs never leave stale trailing chunks
  for (const existing of fs.readdirSync(outputDir)) {
    if (/^02_stage_chunk_\d+\.sql$/.test(existing)) {
      fs.unlinkSync(path.join(outputDir, existing));
    }
  }

  const userId = conversion.nativeBackup.userId;
  const householdId = conversion.nativeBackup.householdId;
  const sourceEnvelope = JSON.parse(rawSourceJson) as SourceBackupEnvelope;

  const stagedPayload = {
    migrationKey: conversion.migrationKey,
    userId,
    householdId,
    currency: conversion.nativeBackup.currency,
    sourceMeta: {
      format: sourceEnvelope.format,
      version: sourceEnvelope.version,
      exportedAt: sourceEnvelope.exportedAt,
      sha256: conversion.sourceSha256,
      byteLength: conversion.sourceByteLength,
    },
    sourcePayload: sourceEnvelope,
    expectedBaseline: { debts: baselineDest.debts, recurring_bills: baselineDest.recurring_bills, transactions: baselineDest.transactions, reconciliation_anchors: baselineDest.reconciliation_anchors, household_settings: baselineDest.household_settings, household_members: baselineDest.household_members },
    sharedHouseholdSettings: conversion.sharedHouseholdSettings,
    householdName: conversion.nativeBackup.onboardingData.householdName ?? 'My Household',
    debts: conversion.nativeBackup.onboardingData.debts.map((d, i) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      balance: d.balance,
      original_balance: d.originalBalance,
      apr: d.apr,
      minimum_payment: d.minimumPayment,
      priority_order: i + 1,
      due_day: d.dueDay,
      credit_limit: d.creditLimit,
      annual_fee_amount: d.annualFeeAmount ?? null,
      annual_fee_next_due_date: d.annualFeeNextDueDate ?? null,
      created_at: d.createdAt,
      updated_at: d.updatedAt,
    })),
    recurringBills: conversion.nativeBackup.recurringBills.map((b) => ({
      id: b.id,
      name: b.name,
      category: b.category,
      amount: (b.amount.minorUnits / 100).toFixed(2),
      due_day: b.dueDay,
      payment_method: b.paymentMethod,
      credit_account_id: b.creditAccountId ?? null,
      auto_post: b.autoPost,
      active: b.active,
      created_at: b.createdAt,
      updated_at: b.updatedAt,
    })),
    transactions: conversion.nativeBackup.transactions.map((t) => ({
      id: t.id,
      account_id: t.accountId,
      date: t.date,
      applies_to_date: t.appliesToDate ?? null,
      amount: (t.amount.minorUnits / 100).toFixed(2),
      category: t.category,
      payee: t.payee,
      memo: t.memo ?? null,
      source: t.source,
      reconciled: t.reconciled,
      created_at: t.createdAt,
      updated_at: t.updatedAt ?? t.createdAt,
      deleted_at: t.deletedAt,
      principal_amount: t.principalAmount ? (t.principalAmount.minorUnits / 100).toFixed(2) : null,
      interest_amount: t.interestAmount ? (t.interestAmount.minorUnits / 100).toFixed(2) : null,
      escrow_amount: t.escrowAmount ? (t.escrowAmount.minorUnits / 100).toFixed(2) : null,
      fee_amount: t.feeAmount ? (t.feeAmount.minorUnits / 100).toFixed(2) : null,
    })),
    reconciliationAnchors: conversion.nativeBackup.reconciliationAnchors.map((a) => ({
      id: a.id,
      account_id: a.accountId,
      as_of_date: a.asOfDate,
      verified_balance: (a.verifiedBalance.minorUnits / 100).toFixed(2),
      note: a.note ?? null,
      created_at: a.createdAt,
      created_adjustment_id: a.createdAdjustmentId ?? null,
    })),
    conversionManifest: conversion.conversionManifest,
    identityMap: conversion.identityMap,
    ownerQuestions: conversion.ownerQuestions,
    importRecords: conversion.importRecords,
  };

  const bundleJson = JSON.stringify(stagedPayload);
  const bundleB64 = Buffer.from(bundleJson, 'utf8').toString('base64');
  const bundleSha256 = createHash('sha256').update(bundleJson, 'utf8').digest('hex');

  const files: string[] = [];
  const write = (name: string, content: string) => {
    const full = path.join(outputDir, name);
    fs.writeFileSync(full, content, 'utf8');
    files.push(full);
  };

  write('native-backup.json', JSON.stringify(conversion.nativeBackup, null, 2));
  write('conversion-manifest.json', JSON.stringify(conversion.conversionManifest, null, 2));
  write('id-map.json', JSON.stringify(conversion.identityMap, null, 2));
  write('owner-questions.json', JSON.stringify(conversion.ownerQuestions, null, 2));
  write('migration-bundle.json', bundleJson);

  // 00_schema_migration_check.sql
  write(
    '00_schema_migration_check.sql',
    `-- Read-only pre-check: confirm scoped archive DDL migration 20261114011500 is already deployed.
SELECT
  to_regclass('public.debtfree_household_import_archives') IS NOT NULL AS has_archives_table,
  to_regclass('public.debtfree_household_import_records') IS NOT NULL AS has_records_table,
  to_regprocedure('public.debtfree_list_household_import_archives(text)') IS NOT NULL AS has_list_rpc;
`,
  );

  // 01_stage_create.sql
  write(
    '01_stage_create.sql',
    `-- Step 1: Create restricted staging table for chunked migration payload.
BEGIN;
CREATE TABLE IF NOT EXISTS public.debtfree_migration_stage_private (
  migration_key text NOT NULL,
  chunk_seq integer NOT NULL CHECK (chunk_seq >= 1),
  chunk_b64 text NOT NULL,
  expected_bundle_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (migration_key, chunk_seq)
);
ALTER TABLE public.debtfree_migration_stage_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.debtfree_migration_stage_private FROM PUBLIC, anon, authenticated;
DELETE FROM public.debtfree_migration_stage_private WHERE migration_key = ${sqlLiteral(conversion.migrationKey)};
COMMIT;
`,
  );

  // 02_stage_chunk_XX.sql
  const totalChunks = Math.ceil(bundleB64.length / chunkBytes);
  const padWidth = Math.max(2, String(totalChunks).length);
  for (let i = 0; i < totalChunks; i++) {
    const seq = i + 1;
    const slice = bundleB64.slice(i * chunkBytes, (i + 1) * chunkBytes);
    const chunkName = `02_stage_chunk_${String(seq).padStart(padWidth, '0')}.sql`;
    write(
      chunkName,
      `-- Staging chunk ${seq} of ${totalChunks} for ${conversion.migrationKey}
INSERT INTO public.debtfree_migration_stage_private (migration_key, chunk_seq, chunk_b64, expected_bundle_sha256)
VALUES (${sqlLiteral(conversion.migrationKey)}, ${seq}, ${sqlLiteral(slice)}, ${sqlLiteral(bundleSha256)})
ON CONFLICT (migration_key, chunk_seq) DO UPDATE
SET chunk_b64 = EXCLUDED.chunk_b64,
    expected_bundle_sha256 = EXCLUDED.expected_bundle_sha256;
`,
    );
  }

  // 03_apply_atomic.sql
  const expectedDestDebtsCount = baselineDest.debts.length;
  const expectedDestBillsCount = baselineDest.recurring_bills.length;
  const expectedDestTxCount = baselineDest.transactions.length;
  const expectedDestAnchorCount = baselineDest.reconciliation_anchors.length;
  const expectedDestRev = baselineDest.household_settings[0].revision;
  const expectedPriorSettings = baselineDest.household_settings[0].settings;
  const expectedEmail = baselineDest.auth_identity.email;
  const expectedImportedDebtsCount = stagedPayload.debts.length;
  const expectedImportedBillsCount = stagedPayload.recurringBills.length;
  const expectedImportedTxCount = stagedPayload.transactions.length;
  const expectedImportedAnchorsCount = stagedPayload.reconciliationAnchors.length;
  const expectedImportRecordsCount = stagedPayload.importRecords.length;
  const expectedSumBalances = roundCents(stagedPayload.debts.reduce((s, d) => s + Number(d.balance), 0)).toFixed(2);

  write(
    '03_apply_atomic.sql',
    `-- Step 3: Atomic verified household replacement migration for ${householdId}.
-- Runs in a single transaction, reassembles & verifies staged SHA-256, checks live preconditions,
-- replaces destination test finances, inserts full native + archive records, verifies invariants,
-- and cleans up staging table.
BEGIN;

LOCK TABLE public.households, public.household_members, public.household_settings,
  public.debts, public.recurring_bills, public.transactions, public.reconciliation_anchors
  IN SHARE ROW EXCLUSIVE MODE;

DO $migrate$
DECLARE
  v_migration_key constant text := ${sqlLiteral(conversion.migrationKey)};
  v_expected_user_id constant uuid := ${sqlLiteral(userId)}::uuid;
  v_expected_email constant text := ${sqlLiteral(expectedEmail)};
  v_household_id constant text := ${sqlLiteral(householdId)};
  v_expected_bundle_sha constant text := ${sqlLiteral(bundleSha256)};
  v_expected_source_sha constant text := ${sqlLiteral(conversion.sourceSha256)};
  v_expected_prior_rev constant bigint := ${expectedDestRev};
  v_chunk_count integer;
  v_b64 text;
  v_raw_json text;
  v_bundle jsonb;
  v_cnt integer;
  v_owner_count integer;
  v_total_balance numeric(18, 4);
  v_archive_id uuid;
  v_hs_rev bigint;
  v_hs_settings jsonb;
BEGIN
  -- 1. Reassemble & verify staged bundle
  SELECT count(*), pg_catalog.string_agg(chunk_b64, '' ORDER BY chunk_seq)
    INTO v_chunk_count, v_b64
  FROM public.debtfree_migration_stage_private
  WHERE migration_key = v_migration_key;

  IF v_chunk_count IS DISTINCT FROM ${totalChunks} OR v_b64 IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_STAGE_INCOMPLETE: Expected ${totalChunks} chunks, found %', v_chunk_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.debtfree_migration_stage_private
    WHERE migration_key = v_migration_key AND expected_bundle_sha256 IS DISTINCT FROM v_expected_bundle_sha
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_STAGE_HASH_MISMATCH';
  END IF;

  v_raw_json := pg_catalog.convert_from(pg_catalog.decode(v_b64, 'base64'), 'UTF8');
  IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_raw_json, 'UTF8'), 'sha256'), 'hex') IS DISTINCT FROM v_expected_bundle_sha THEN
    -- Fallback if extensions schema digest is unavailable: check pgcrypto or core sha256()
    NULL;
  END IF;
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_raw_json, 'UTF8')), 'hex') IS DISTINCT FROM v_expected_bundle_sha THEN
    RAISE EXCEPTION 'PREFLIGHT_REASSEMBLED_SHA256_MISMATCH';
  END IF;

  v_bundle := v_raw_json::jsonb;
  IF (v_bundle -> 'sourceMeta' ->> 'sha256') IS DISTINCT FROM v_expected_source_sha THEN
    RAISE EXCEPTION 'PREFLIGHT_SOURCE_SHA256_MISMATCH';
  END IF;

  -- 2. Strict live destination preconditions (auth, membership, settings baseline, exact test counts)
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = v_expected_user_id AND lower(email) = lower(v_expected_email)
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_AUTH_USER_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.households
    WHERE id = v_household_id AND lifecycle_state = 'active' AND currency = 'USD'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_HOUSEHOLD_NOT_READY';
  END IF;

  SELECT count(*) INTO v_owner_count
  FROM public.household_members
  WHERE household_id = v_household_id AND status = 'active';
  IF v_owner_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = v_household_id AND user_id = v_expected_user_id AND role = 'owner' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_MEMBERSHIP_CHANGED';
  END IF;

  SELECT revision, settings INTO v_hs_rev, v_hs_settings
  FROM public.household_settings WHERE household_id = v_household_id;
  IF NOT FOUND OR v_hs_rev IS DISTINCT FROM v_expected_prior_rev THEN
    RAISE EXCEPTION 'PREFLIGHT_SETTINGS_REVISION_CHANGED: expected %, found %', v_expected_prior_rev, v_hs_rev;
  END IF;

  IF (SELECT count(*) FROM public.debts WHERE household_id = v_household_id) <> ${expectedDestDebtsCount}
     OR (SELECT count(*) FROM public.recurring_bills WHERE household_id = v_household_id) <> ${expectedDestBillsCount}
     OR (SELECT count(*) FROM public.transactions WHERE household_id = v_household_id) <> ${expectedDestTxCount}
     OR (SELECT count(*) FROM public.reconciliation_anchors WHERE household_id = v_household_id) <> ${expectedDestAnchorCount}
     OR (SELECT count(*) FROM public.debtfree_deleted_debt_ids WHERE household_id = v_household_id) <> 0
     OR (SELECT count(*) FROM public.debtfree_deleted_bill_ids WHERE household_id = v_household_id) <> 0 THEN
    RAISE EXCEPTION 'PREFLIGHT_DESTINATION_FINANCES_CHANGED';
  END IF;

  IF EXISTS (SELECT to_jsonb(t) FROM public.debts t WHERE t.household_id = v_household_id EXCEPT SELECT value FROM jsonb_array_elements(v_bundle -> 'expectedBaseline' -> 'debts'))
     OR EXISTS (SELECT value FROM jsonb_array_elements(v_bundle -> 'expectedBaseline' -> 'debts') EXCEPT SELECT to_jsonb(t) FROM public.debts t WHERE t.household_id = v_household_id) THEN
    RAISE EXCEPTION 'PREFLIGHT_BASELINE_DEBTS_CHANGED';
  END IF;
  IF EXISTS (SELECT to_jsonb(t) FROM public.recurring_bills t WHERE t.household_id = v_household_id EXCEPT SELECT value FROM jsonb_array_elements(v_bundle -> 'expectedBaseline' -> 'recurring_bills'))
     OR EXISTS (SELECT value FROM jsonb_array_elements(v_bundle -> 'expectedBaseline' -> 'recurring_bills') EXCEPT SELECT to_jsonb(t) FROM public.recurring_bills t WHERE t.household_id = v_household_id) THEN
    RAISE EXCEPTION 'PREFLIGHT_BASELINE_RECURRING_BILLS_CHANGED';
  END IF;
  IF EXISTS (SELECT to_jsonb(t) FROM public.transactions t WHERE t.household_id = v_household_id EXCEPT SELECT value FROM jsonb_array_elements(v_bundle -> 'expectedBaseline' -> 'transactions'))
     OR EXISTS (SELECT value FROM jsonb_array_elements(v_bundle -> 'expectedBaseline' -> 'transactions') EXCEPT SELECT to_jsonb(t) FROM public.transactions t WHERE t.household_id = v_household_id) THEN
    RAISE EXCEPTION 'PREFLIGHT_BASELINE_TRANSACTIONS_CHANGED';
  END IF;
  IF EXISTS (SELECT to_jsonb(t) FROM public.reconciliation_anchors t WHERE t.household_id = v_household_id EXCEPT SELECT value FROM jsonb_array_elements(v_bundle -> 'expectedBaseline' -> 'reconciliation_anchors'))
     OR EXISTS (SELECT value FROM jsonb_array_elements(v_bundle -> 'expectedBaseline' -> 'reconciliation_anchors') EXCEPT SELECT to_jsonb(t) FROM public.reconciliation_anchors t WHERE t.household_id = v_household_id) THEN
    RAISE EXCEPTION 'PREFLIGHT_BASELINE_RECONCILIATION_ANCHORS_CHANGED';
  END IF;
  IF EXISTS (SELECT to_jsonb(t) FROM public.household_settings t WHERE t.household_id = v_household_id EXCEPT SELECT value FROM jsonb_array_elements(v_bundle -> 'expectedBaseline' -> 'household_settings'))
     OR EXISTS (SELECT value FROM jsonb_array_elements(v_bundle -> 'expectedBaseline' -> 'household_settings') EXCEPT SELECT to_jsonb(t) FROM public.household_settings t WHERE t.household_id = v_household_id) THEN
    RAISE EXCEPTION 'PREFLIGHT_BASELINE_HOUSEHOLD_SETTINGS_CHANGED';
  END IF;
  IF EXISTS (SELECT to_jsonb(t) FROM public.household_members t WHERE t.household_id = v_household_id EXCEPT SELECT value FROM jsonb_array_elements(v_bundle -> 'expectedBaseline' -> 'household_members'))
     OR EXISTS (SELECT value FROM jsonb_array_elements(v_bundle -> 'expectedBaseline' -> 'household_members') EXCEPT SELECT to_jsonb(t) FROM public.household_members t WHERE t.household_id = v_household_id) THEN
    RAISE EXCEPTION 'PREFLIGHT_BASELINE_HOUSEHOLD_MEMBERS_CHANGED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.debtfree_household_import_archives
    WHERE household_id = v_household_id AND migration_key = v_migration_key
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_ALREADY_IMPORTED';
  END IF;

  -- 3. Enable restore importing flag & replace destination test records
  PERFORM pg_catalog.set_config('debtfree.restore_importing', 'on', true);

  DELETE FROM public.transactions WHERE household_id = v_household_id;
  DELETE FROM public.reconciliation_anchors WHERE household_id = v_household_id;
  DELETE FROM public.recurring_bills WHERE household_id = v_household_id;
  DELETE FROM public.debts WHERE household_id = v_household_id;

  -- 4. Insert migrated debts
  INSERT INTO public.debts (
    id, user_id, household_id, name, category, balance, original_balance, apr,
    minimum_payment, priority_order, due_day, credit_limit, annual_fee_amount,
    annual_fee_next_due_date, created_at, updated_at, version
  )
  SELECT
    (d ->> 'id')::uuid,
    v_expected_user_id,
    v_household_id,
    d ->> 'name',
    d ->> 'category',
    (d ->> 'balance')::numeric(18, 4),
    NULLIF(d ->> 'original_balance', '')::numeric(18, 4),
    (d ->> 'apr')::numeric,
    (d ->> 'minimum_payment')::numeric(18, 4),
    (d ->> 'priority_order')::integer,
    NULLIF(d ->> 'due_day', '')::integer,
    NULLIF(d ->> 'credit_limit', '')::numeric(18, 4),
    NULLIF(d ->> 'annual_fee_amount', '')::numeric(18, 4),
    NULLIF(d ->> 'annual_fee_next_due_date', '')::date,
    (d ->> 'created_at')::timestamptz,
    (d ->> 'updated_at')::timestamptz,
    1
  FROM pg_catalog.jsonb_array_elements(v_bundle -> 'debts') AS d;

  -- 5. Insert migrated recurring bills (before transactions so bill identity guard validates cleanly)
  INSERT INTO public.recurring_bills (
    id, user_id, household_id, name, category, amount, due_day, payment_method,
    credit_account_id, auto_post, active, created_at, updated_at
  )
  SELECT
    b ->> 'id',
    v_expected_user_id,
    v_household_id,
    b ->> 'name',
    b ->> 'category',
    (b ->> 'amount')::numeric(18, 4),
    (b ->> 'due_day')::integer,
    b ->> 'payment_method',
    NULLIF(b ->> 'credit_account_id', '')::uuid,
    (b ->> 'auto_post')::boolean,
    (b ->> 'active')::boolean,
    (b ->> 'created_at')::timestamptz,
    (b ->> 'updated_at')::timestamptz
  FROM pg_catalog.jsonb_array_elements(v_bundle -> 'recurringBills') AS b;

  -- 6. Insert migrated transactions
  INSERT INTO public.transactions (
    id, user_id, household_id, account_id, date, applies_to_date, amount,
    category, payee, memo, source, reconciled, created_at, updated_at,
    deleted_at, principal_amount, interest_amount, escrow_amount, fee_amount
  )
  SELECT
    t ->> 'id',
    v_expected_user_id,
    v_household_id,
    NULLIF(t ->> 'account_id', '')::uuid,
    (t ->> 'date')::date,
    NULLIF(t ->> 'applies_to_date', '')::date,
    (t ->> 'amount')::numeric(18, 4),
    t ->> 'category',
    t ->> 'payee',
    NULLIF(t ->> 'memo', ''),
    t ->> 'source',
    (t ->> 'reconciled')::boolean,
    (t ->> 'created_at')::timestamptz,
    (t ->> 'updated_at')::timestamptz,
    NULLIF(t ->> 'deleted_at', '')::timestamptz,
    NULLIF(t ->> 'principal_amount', '')::numeric(18, 4),
    NULLIF(t ->> 'interest_amount', '')::numeric(18, 4),
    NULLIF(t ->> 'escrow_amount', '')::numeric(18, 4),
    NULLIF(t ->> 'fee_amount', '')::numeric(18, 4)
  FROM pg_catalog.jsonb_array_elements(v_bundle -> 'transactions') AS t;

  -- 7. Insert migrated reconciliation anchors
  INSERT INTO public.reconciliation_anchors (
    id, user_id, household_id, account_id, as_of_date, verified_balance,
    note, created_at, created_adjustment_id
  )
  SELECT
    a ->> 'id',
    v_expected_user_id,
    v_household_id,
    (a ->> 'account_id')::uuid,
    (a ->> 'as_of_date')::date,
    (a ->> 'verified_balance')::numeric(18, 4),
    NULLIF(a ->> 'note', ''),
    (a ->> 'created_at')::timestamptz,
    NULLIF(a ->> 'created_adjustment_id', '')
  FROM pg_catalog.jsonb_array_elements(v_bundle -> 'reconciliationAnchors') AS a;

  -- 8. Update shared household_settings
  UPDATE public.household_settings
  SET settings = v_bundle -> 'sharedHouseholdSettings',
      revision = v_expected_prior_rev + 1,
      updated_at = pg_catalog.now()
  WHERE household_id = v_household_id;

  -- 9. Insert source archive envelope & per-record provenance
  INSERT INTO public.debtfree_household_import_archives (
    household_id, imported_by_user_id, source_format, source_version,
    source_exported_at, source_sha256, source_byte_length, migration_key,
    source_payload, conversion_manifest, identity_map, owner_questions
  ) VALUES (
    v_household_id,
    v_expected_user_id,
    v_bundle -> 'sourceMeta' ->> 'format',
    (v_bundle -> 'sourceMeta' ->> 'version')::integer,
    (v_bundle -> 'sourceMeta' ->> 'exportedAt')::timestamptz,
    v_bundle -> 'sourceMeta' ->> 'sha256',
    (v_bundle -> 'sourceMeta' ->> 'byteLength')::bigint,
    v_migration_key,
    v_bundle -> 'sourcePayload',
    v_bundle -> 'conversionManifest',
    v_bundle -> 'identityMap',
    v_bundle -> 'ownerQuestions'
  )
  RETURNING id INTO v_archive_id;

  INSERT INTO public.debtfree_household_import_records (
    archive_id, domain, id, household_id, imported_by_user_id, source_id,
    native_table, native_record_id, disposition, source_deleted_at,
    source_created_at, source_updated_at, attribution, source_record, notes
  )
  SELECT
    v_archive_id,
    r ->> 'domain',
    r ->> 'id',
    v_household_id,
    v_expected_user_id,
    r ->> 'source_id',
    NULLIF(r ->> 'native_table', ''),
    NULLIF(r ->> 'native_record_id', ''),
    r ->> 'disposition',
    NULLIF(r ->> 'source_deleted_at', '')::timestamptz,
    NULLIF(r ->> 'source_created_at', '')::timestamptz,
    NULLIF(r ->> 'source_updated_at', '')::timestamptz,
    CASE WHEN r -> 'attribution' IS NULL OR r -> 'attribution' = 'null'::jsonb THEN NULL ELSE r -> 'attribution' END,
    r -> 'source_record',
    NULLIF(r ->> 'notes', '')
  FROM pg_catalog.jsonb_array_elements(v_bundle -> 'importRecords') AS r;

  -- 10. Post-insert integrity assertions
  SELECT count(*), COALESCE(sum(balance), 0) INTO v_cnt, v_total_balance
  FROM public.debts WHERE household_id = v_household_id;
  IF v_cnt <> ${expectedImportedDebtsCount} OR v_total_balance <> ${expectedSumBalances}::numeric(18, 4) THEN
    RAISE EXCEPTION 'POST_INSERT_DEBT_MISMATCH: cnt=% sum=%', v_cnt, v_total_balance;
  END IF;

  IF (SELECT count(*) FROM public.recurring_bills WHERE household_id = v_household_id) <> ${expectedImportedBillsCount}
     OR (SELECT count(*) FROM public.transactions WHERE household_id = v_household_id) <> ${expectedImportedTxCount}
     OR (SELECT count(*) FROM public.reconciliation_anchors WHERE household_id = v_household_id) <> ${expectedImportedAnchorsCount}
     OR (SELECT count(*) FROM public.debtfree_household_import_records WHERE archive_id = v_archive_id) <> ${expectedImportRecordsCount} THEN
    RAISE EXCEPTION 'POST_INSERT_COUNT_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transactions t
    LEFT JOIN public.debts d ON d.id = t.account_id AND d.household_id = t.household_id
    WHERE t.household_id = v_household_id AND t.account_id IS NOT NULL AND d.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.recurring_bills b
    LEFT JOIN public.debts d ON d.id = b.credit_account_id AND d.household_id = b.household_id
    WHERE b.household_id = v_household_id AND b.credit_account_id IS NOT NULL AND d.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.reconciliation_anchors a
    LEFT JOIN public.debts d ON d.id = a.account_id AND d.household_id = a.household_id
    WHERE a.household_id = v_household_id AND d.id IS NULL
  ) THEN
    RAISE EXCEPTION 'POST_INSERT_ORPHAN_FK';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transactions WHERE household_id = v_household_id AND amount <= 0
  ) THEN
    RAISE EXCEPTION 'POST_INSERT_NON_POSITIVE_TRANSACTION_AMOUNT';
  END IF;

  PERFORM pg_catalog.set_config('debtfree.restore_importing', 'off', true);
END
$migrate$;

DROP TABLE IF EXISTS public.debtfree_migration_stage_private;

COMMIT;
`,
  );

  // Clean bugfix in generated SQL above: remove the extensions.digest call line that would fail if extensions schema isn't enabled! Let's replace that block in 03_apply_atomic.sql cleanly below.
  const applyPath = path.join(outputDir, '03_apply_atomic.sql');
  const applySqlFixed = fs
    .readFileSync(applyPath, 'utf8')
    .replace(
      /IF pg_catalog\.encode\(extensions\.digest[\s\S]*?END IF;\n\s*/,
      '',
    );
  fs.writeFileSync(applyPath, applySqlFixed, 'utf8');

  // 04_verify.sql
  write(
    '04_verify.sql',
    `-- Read-only post-migration verification queries for ${householdId}.
-- Check 1: Household, membership, settings revision & entity counts
SELECT
  h.id AS household_id,
  h.lifecycle_state,
  h.currency,
  (SELECT count(*) FROM public.household_members hm WHERE hm.household_id = h.id AND hm.status = 'active') AS active_members,
  hs.revision AS settings_revision,
  (SELECT count(*) FROM public.debts d WHERE d.household_id = h.id) AS debt_count,
  (SELECT count(*) FROM public.recurring_bills b WHERE b.household_id = h.id) AS bill_count,
  (SELECT count(*) FROM public.transactions t WHERE t.household_id = h.id) AS total_tx_count,
  (SELECT count(*) FROM public.transactions t WHERE t.household_id = h.id AND t.deleted_at IS NULL) AS active_tx_count,
  (SELECT count(*) FROM public.transactions t WHERE t.household_id = h.id AND t.deleted_at IS NOT NULL) AS deleted_tx_count,
  (SELECT count(*) FROM public.reconciliation_anchors a WHERE a.household_id = h.id) AS anchor_count,
  (SELECT a.source_sha256 FROM public.debtfree_household_import_archives a WHERE a.household_id = h.id AND a.migration_key = ${sqlLiteral(conversion.migrationKey)}) AS archive_sha256,
  (SELECT count(*) FROM public.debtfree_household_import_records r WHERE r.household_id = h.id) AS archive_record_count
FROM public.households h
JOIN public.household_settings hs ON hs.household_id = h.id
WHERE h.id = ${sqlLiteral(householdId)};

-- Check 2: Per-debt stored balance, anchor count, and tx count comparison
SELECT
  d.priority_order,
  d.name,
  d.category,
  d.balance,
  d.original_balance,
  d.apr,
  d.minimum_payment,
  d.due_day,
  (d.id::text = ANY(ARRAY(SELECT jsonb_array_elements_text(hs.settings -> 'archivedPaidOffDebtIds')))) AS is_archived_paid_off,
  (SELECT count(*) FROM public.reconciliation_anchors a WHERE a.account_id = d.id) AS anchor_count,
  (SELECT count(*) FROM public.transactions t WHERE t.account_id = d.id AND t.deleted_at IS NULL) AS active_tx_count,
  (SELECT count(*) FROM public.transactions t WHERE t.account_id = d.id AND t.deleted_at IS NOT NULL) AS deleted_tx_count
FROM public.debts d
JOIN public.household_settings hs ON hs.household_id = d.household_id
WHERE d.household_id = ${sqlLiteral(householdId)}
ORDER BY d.priority_order;

-- Check 3: Archive record distribution by domain & disposition
SELECT domain, disposition, count(*) AS record_count
FROM public.debtfree_household_import_records
WHERE household_id = ${sqlLiteral(householdId)}
GROUP BY domain, disposition
ORDER BY domain, disposition;
`,
  );

  // 05_rollback.sql
  const rollbackDebtValues = baselineDest.debts
    .map(
      (d) => `(
    ${sqlLiteral(d.id)}::uuid,
    ${sqlLiteral(d.user_id)}::uuid,
    ${sqlLiteral(d.household_id)},
    ${sqlLiteral(d.name)},
    ${d.category === null ? 'NULL' : sqlLiteral(d.category)},
    ${d.balance},
    ${d.original_balance === null ? 'NULL' : d.original_balance},
    ${d.apr},
    ${d.minimum_payment},
    ${d.priority_order},
    ${d.due_day === null ? 'NULL' : d.due_day},
    ${d.credit_limit === null ? 'NULL' : d.credit_limit},
    ${d.annual_fee_amount === null ? 'NULL' : d.annual_fee_amount},
    ${d.annual_fee_next_due_date === null ? 'NULL' : `${sqlLiteral(d.annual_fee_next_due_date)}::date`},
    ${sqlLiteral(d.created_at)}::timestamptz,
    ${sqlLiteral(d.updated_at)}::timestamptz,
    ${d.version}
  )`,
    )
    .join(',\n  ');

  const rollbackBillValues = baselineDest.recurring_bills
    .map(
      (b) => `(
    ${sqlLiteral(b.id)},
    ${sqlLiteral(b.user_id)}::uuid,
    ${sqlLiteral(b.household_id)},
    ${sqlLiteral(b.name)},
    ${sqlLiteral(b.category)},
    ${b.amount},
    ${b.due_day},
    ${sqlLiteral(b.payment_method)},
    ${b.credit_account_id === null ? 'NULL' : `${sqlLiteral(b.credit_account_id)}::uuid`},
    ${b.auto_post ? 'true' : 'false'},
    ${b.active ? 'true' : 'false'},
    ${sqlLiteral(b.created_at)}::timestamptz,
    ${sqlLiteral(b.updated_at)}::timestamptz
  )`,
    )
    .join(',\n  ');

  const rollbackTxValues = baselineDest.transactions
    .map(
      (t) => `(
    ${sqlLiteral(t.id)},
    ${sqlLiteral(t.user_id)}::uuid,
    ${sqlLiteral(t.household_id)},
    ${t.account_id === null ? 'NULL' : `${sqlLiteral(t.account_id)}::uuid`},
    ${sqlLiteral(t.date)}::date,
    ${t.applies_to_date === null ? 'NULL' : `${sqlLiteral(t.applies_to_date)}::date`},
    ${t.amount},
    ${sqlLiteral(t.category)},
    ${sqlLiteral(t.payee)},
    ${t.memo === null ? 'NULL' : sqlLiteral(t.memo)},
    ${sqlLiteral(t.source)},
    ${t.reconciled ? 'true' : 'false'},
    ${sqlLiteral(t.created_at)}::timestamptz,
    ${sqlLiteral(t.updated_at)}::timestamptz,
    ${t.deleted_at === null ? 'NULL' : `${sqlLiteral(t.deleted_at)}::timestamptz`},
    ${t.principal_amount === null ? 'NULL' : t.principal_amount},
    ${t.interest_amount === null ? 'NULL' : t.interest_amount},
    ${t.escrow_amount === null ? 'NULL' : t.escrow_amount},
    ${t.fee_amount === null ? 'NULL' : t.fee_amount}
  )`,
    )
    .join(',\n  ');

  const origDebtIdList = baselineDest.debts.map((d) => `${sqlLiteral(d.id)}::uuid`).join(', ');
  const origBillIdList = baselineDest.recurring_bills.map((b) => sqlLiteral(b.id)).join(', ');

  write(
    '05_rollback.sql',
    `-- Complete atomic rollback restoring destination-backup.json verbatim for ${householdId}.
-- Restores exact 3 debts (with original version numbers), 3 bills, 1 tx, 0 anchors,
-- household_settings revision ${expectedDestRev}, and clears the 6 test-row tombstones created by apply.
BEGIN;

LOCK TABLE public.households, public.household_members, public.household_settings,
  public.debts, public.recurring_bills, public.transactions, public.reconciliation_anchors
  IN SHARE ROW EXCLUSIVE MODE;

PERFORM pg_catalog.set_config('debtfree.restore_importing', 'on', true);

DELETE FROM public.transactions WHERE household_id = ${sqlLiteral(householdId)};
DELETE FROM public.reconciliation_anchors WHERE household_id = ${sqlLiteral(householdId)};
DELETE FROM public.recurring_bills WHERE household_id = ${sqlLiteral(householdId)};
DELETE FROM public.debts WHERE household_id = ${sqlLiteral(householdId)};
DELETE FROM public.debtfree_household_import_records WHERE household_id = ${sqlLiteral(householdId)};
DELETE FROM public.debtfree_household_import_archives WHERE household_id = ${sqlLiteral(householdId)};

-- Remove tombstones inserted when deleting original test rows & rollback-deleted migrated rows
DELETE FROM public.debtfree_deleted_debt_ids WHERE household_id = ${sqlLiteral(householdId)};
DELETE FROM public.debtfree_deleted_bill_ids WHERE household_id = ${sqlLiteral(householdId)};

INSERT INTO public.debts (
  id, user_id, household_id, name, category, balance, original_balance, apr,
  minimum_payment, priority_order, due_day, credit_limit, annual_fee_amount,
  annual_fee_next_due_date, created_at, updated_at, version
) VALUES
  ${rollbackDebtValues};

INSERT INTO public.recurring_bills (
  id, user_id, household_id, name, category, amount, due_day, payment_method,
  credit_account_id, auto_post, active, created_at, updated_at
) VALUES
  ${rollbackBillValues};

INSERT INTO public.transactions (
  id, user_id, household_id, account_id, date, applies_to_date, amount,
  category, payee, memo, source, reconciled, created_at, updated_at,
  deleted_at, principal_amount, interest_amount, escrow_amount, fee_amount
) VALUES
  ${rollbackTxValues};

UPDATE public.household_settings
SET settings = ${sqlJsonbLiteral(expectedPriorSettings)},
    revision = ${expectedDestRev},
    updated_at = ${sqlLiteral(baselineDest.household_settings[0].updated_at)}::timestamptz
WHERE household_id = ${sqlLiteral(householdId)};

DO $verify_rb$
BEGIN
  IF (SELECT count(*) FROM public.debts WHERE household_id = ${sqlLiteral(householdId)} AND id IN (${origDebtIdList})) <> ${expectedDestDebtsCount}
     OR (SELECT count(*) FROM public.recurring_bills WHERE household_id = ${sqlLiteral(householdId)} AND id IN (${origBillIdList})) <> ${expectedDestBillsCount}
     OR (SELECT count(*) FROM public.transactions WHERE household_id = ${sqlLiteral(householdId)}) <> ${expectedDestTxCount}
     OR (SELECT count(*) FROM public.reconciliation_anchors WHERE household_id = ${sqlLiteral(householdId)}) <> ${expectedDestAnchorCount}
     OR (SELECT revision FROM public.household_settings WHERE household_id = ${sqlLiteral(householdId)}) <> ${expectedDestRev} THEN
    RAISE EXCEPTION 'ROLLBACK_POST_CHECK_FAILED';
  END IF;
END
$verify_rb$;

DROP TABLE IF EXISTS public.debtfree_migration_stage_private;
PERFORM pg_catalog.set_config('debtfree.restore_importing', 'off', true);

COMMIT;
`,
  );

  // Notice `PERFORM` top-level is PL/pgSQL-only! Wrap `PERFORM` inside `DO $$ ... $$;` or use `SELECT pg_catalog.set_config(...)` in 05_rollback.sql!
  const rbPath = path.join(outputDir, '05_rollback.sql');
  const rbFixed = fs
    .readFileSync(rbPath, 'utf8')
    .replace(
      /PERFORM pg_catalog\.set_config\(([^)]+)\);/g,
      'SELECT pg_catalog.set_config($1);',
    );
  fs.writeFileSync(rbPath, rbFixed, 'utf8');

  write(
    'README_EXECUTION.md',
    `# Private Migration Package (${conversion.migrationKey})

Generated from source SHA-256 \`${conversion.sourceSha256}\` (${conversion.sourceByteLength} bytes).
Target household: \`${householdId}\` (owner \`${userId}\`).

## Execution Order (Manager Connector)
1. Apply repo DDL migration \`supabase/migrations/20261115054654_household_import_archives.sql\` (once).
2. Run \`00_schema_migration_check.sql\` (verify \`true, true, true\`).
3. Run \`01_stage_create.sql\`.
4. Run all ${totalChunks} staging chunk files in order: \`02_stage_chunk_01.sql\` .. \`02_stage_chunk_${String(totalChunks).padStart(padWidth, '0')}.sql\`.
5. Run \`03_apply_atomic.sql\` (single atomic transaction with preflight guards, apply, integrity assertions, and staging cleanup).
6. Run \`04_verify.sql\` (read-only readback verification).
7. Rollback (if ever needed): run \`05_rollback.sql\`.
`,
  );

  return { chunkCount: totalChunks, files };
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = val;
    i++;
  }
  return args;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args['input'];
  const outputDir = args['output-dir'];
  const userId = args['user-id'];
  const householdId = args['household-id'];
  const baselinePath = args['baseline-backup'];
  const seed = args['seed'];
  const decisions = args['decisions'] ? JSON.parse(fs.readFileSync(args['decisions'], 'utf8')) as MigrationDecisionsConfig : undefined;
  const chunkBytes = args['chunk-bytes'] ? Number(args['chunk-bytes']) : undefined;

  if (!inputPath || !outputDir || !userId || !householdId || !baselinePath) {
    throw new Error(
      'Usage: convert-dashboard-backup.ts --input <source.json> --output-dir <dir> --user-id <uuid> --household-id <hh-id> --baseline-backup <dest.json> [--seed <uuid>] [--chunk-bytes <n>]',
    );
  }

  const rawSourceJson = fs.readFileSync(inputPath, 'utf8');
  const baselineDest = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as DestinationBackupSnapshot;
  const conversion = convertDashboardBackup(rawSourceJson, {
    userId,
    householdId,
    seed,
    baselineDest,
    decisions,
  });
  const written = writeMigrationSqlPackage({
    rawSourceJson,
    conversion,
    outputDir,
    baselineDest,
    chunkBytes,
  });
  console.log(
    JSON.stringify(
      {
        status: 'ok',
        migrationKey: conversion.migrationKey,
        sourceSha256: conversion.sourceSha256,
        nativeTargetCounts: conversion.conversionManifest.nativeTargetCounts,
        totalCardBalanceExpected: conversion.conversionManifest.totalCardBalanceExpected,
        chunkCount: written.chunkCount,
        filesWritten: written.files.length,
        lifecycleWarnings: conversion.lifecycleWarnings,
        autoPostSimulation: conversion.autoPostSimulation,
        ownerQuestionCount: conversion.ownerQuestions.length,
      },
      null,
      2,
    ),
  );
}
