// @ts-ignore TS5097
import { getObligationCycle, obligationScheduleKey, type ObligationSchedule, type ObligationSchedules } from './obligation-schedule.ts';
// Node's direct TypeScript loader requires the extension; Expo resolves it as well.
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type DateOnly, getNextMonthString } from './calendar.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type LedgerTransaction } from './ledger.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { makeMoney, type Money } from './money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { getActiveRecurringBills, resolveRecurringBillDate, type RecurringBill } from './recurring-bills.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { getCurrency } from './currencies.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type DebtItem } from '../onboarding-domain.ts';
// @ts-ignore TS5097
import { extractBillIdFromTxId, extractBillIdsFromMemo } from './bill-identity.ts';
// @ts-ignore TS5097
export { extractBillIdFromTxId, extractBillIdsFromMemo } from './bill-identity.ts';

export type PaymentObligationKind = 'bill' | 'debt';

export type PaymentObligation = Readonly<{
  id?: string;
  kind: PaymentObligationKind;
  name?: string;
  dueDate: DateOnly;
  dueCycleMonth?: string; // YYYY-MM
  requiredAmount?: Money;
  accountId?: string | null;
  billId?: string | null;
  bill?: RecurringBill;
  debt?: DebtItem;
  /** A manually linked loan whose payment can settle this bill's same-month cycle. */
  linkedDebtId?: string;
  /** Immutable historical bill IDs whose bill-tagged payments settle this unified loan obligation. */
  historicalBillIds?: readonly string[];
}>;

/** Resolve the effective schedule for a unified debt, merging any preserved legacy bill
 *  schedule history (earlier terms, firstDueDate, acknowledgedPaidCycles) if present. */
export function resolveEffectiveDebtSchedule(
  schedules: ObligationSchedules | undefined,
  debtId: string,
  historicalBillIds: readonly string[] = [],
): ObligationSchedule | undefined {
  // An atomically saved debt schedule already contains the preserved bill history.
  // Never overlay the independently stored legacy schedule onto it again.
  return schedules?.[obligationScheduleKey('debt', debtId)]
    ?? historicalBillIds.map(id => schedules?.[obligationScheduleKey('bill', id)]).find(Boolean);
}

export type ObligationMatchResult = Readonly<{
  obligation: PaymentObligation;
  matchedTransactions: readonly LedgerTransaction[];
  totalPaid: Money;
  remainingAmount: Money;
  isSatisfied: boolean;
  isPartiallyPaid: boolean;
  hasAdvancePayment: boolean;
  hasLatePayment: boolean;
  extraAmount: Money;
}>;

export type ObligationSettlementStatus = 'unpaid' | 'partially_paid' | 'paid' | 'pending_confirmation';

export type ObligationPaymentState = Readonly<{
  status: ObligationSettlementStatus;
  confirmedMatch: ObligationMatchResult;
  withPendingMatch: ObligationMatchResult;
  pendingAmount: Money;
}>;

/**
 * Shared overdue obligation item returned by the central past-due calculation engine.
 */
export type OverdueObligationItem = Readonly<{
  id: string; // Unique key e.g. `${bill.id}:${cycleDueDate}` or `minimum:${debt.id}:${cycleDueDate}`
  kind: PaymentObligationKind;
  name: string;
  dueDate: DateOnly;
  dueCycleMonth: string;
  requiredAmount: Money;
  remainingAmount: Money;
  totalPaid: Money;
  isPartiallyPaid: boolean;
  isSatisfied: boolean;
  settlementStatus: ObligationSettlementStatus;
  pendingAmount: Money;
  bill?: RecurringBill;
  debt?: DebtItem;
  match: ObligationMatchResult;
  matchResult: ObligationMatchResult;
}>;

/**
 * Strict obligation identity matching.
 * Checks both account ID / bill ID and due cycle, preventing one payment from settling unrelated debts/bills.
 * Correctly distinguishes actual payment date (`tx.date`) from intended due cycle (`tx.appliesToDate`).
 */
export function paymentMatchesObligation(
  tx: LedgerTransaction,
  target: PaymentObligation,
  includePending = false,
): boolean {
  if (tx.deletedAt !== null) return false;
  if (!includePending && tx.isPending) return false;

  // Strict currency matching: unlike currencies cannot settle an obligation
  if (target.requiredAmount && tx.amount.currency !== target.requiredAmount.currency) {
    return false;
  }

  const targetCycleMonth = target.dueCycleMonth || target.dueDate.slice(0, 7);
  const txBillIdFromId = extractBillIdFromTxId(tx.id);
  const memoBillIds = extractBillIdsFromMemo(tx.memo);
  const historicalBillIds = target.historicalBillIds ?? [];
  const matchedHistoricalBillAlias = target.kind === 'debt' && historicalBillIds.length > 0 && (
    (txBillIdFromId !== null && historicalBillIds.includes(txBillIdFromId)) ||
    [...memoBillIds].some(id => historicalBillIds.includes(id))
  );

  // Cycle date matching:
  // If `appliesToDate` is specified, it strictly dictates which due cycle this transaction applies to.
  // If `appliesToDate` is a full date (YYYY-MM-DD), it must equal target.dueDate (except across linked loan/bill aliases in the same month).
  const pairedLoanPayment = target.kind === 'bill' && Boolean(target.linkedDebtId && tx.accountId === target.linkedDebtId && tx.category === 'payment');
  if (tx.appliesToDate) {
    if (tx.appliesToDate.length === 10 && tx.appliesToDate !== target.dueDate && !pairedLoanPayment && !matchedHistoricalBillAlias) {
      return false;
    }
    const txCycleMonth = tx.appliesToDate.slice(0, 7);
    if (txCycleMonth !== targetCycleMonth) {
      return false;
    }
  } else {
    const txMonth = tx.date.slice(0, 7);
    if (txMonth !== targetCycleMonth) return false;
  }

  // Identity matching:
  if (target.kind === 'bill') {
    if (!target.billId) return false;
    if (pairedLoanPayment) return true;

    // Check durable explicit bill link:
    // A transaction explicitly links to a bill if:
    // 1) tx.id starts with `bill:${target.billId}:` or equals `bill:${target.billId}`
    // 2) OR tx.memo explicitly references `[bill:${target.billId}]` or `bill:${target.billId}`
    const isExplicitBillId = txBillIdFromId === target.billId;
    const isExplicitMemo = memoBillIds.has(target.billId);

    // Per Finding 1 & P0-A: Require durable explicit bill/obligation identity.
    // No substring-based bill identity acceptance (e.g. bill 'a' cannot match 'bill:ab').
    if (!isExplicitBillId && !isExplicitMemo) {
      return false;
    }

    // Per Finding 2 & P0-A: Enforce correct account or debit association and expected merchant/debit category
    if (target.accountId) {
      // Credit card bill: MUST be on the target credit account
      if (tx.accountId !== target.accountId) return false;
      // Credit card bill: MUST be a merchant charge on the card, NEVER a debt repayment (category: 'payment')
      if (tx.category === 'payment') return false;
    } else {
      // Debit/checking bill: must have accountId === null
      if (tx.accountId !== null) return false;
      // Debit bill must be a debit cashflow (debit_bill or payment)
      if (tx.category !== 'debit_bill' && tx.category !== 'payment') return false;
    }

    // Per Finding 3: Exact cycle matching in tx.id
    if (isExplicitBillId) {
      const idParts = tx.id.split(':');
      if (idParts.length >= 3) {
        const idCycle = idParts[2];
        if (idCycle.length === 10) {
          // YYYY-MM-DD format
          if (idCycle !== target.dueDate) return false;
        } else if (idCycle.length === 7) {
          // YYYY-MM format
          if (idCycle !== targetCycleMonth) return false;
        }
      }
    }

    return true;
  }

  // Debt payment obligation:
  const hasBillReference = txBillIdFromId !== null || memoBillIds.size > 0;
  if (hasBillReference) {
    if (!matchedHistoricalBillAlias) return false;
    if (txBillIdFromId !== null && !historicalBillIds.includes(txBillIdFromId)) return false;
    for (const memoBillId of memoBillIds) {
      if (!historicalBillIds.includes(memoBillId)) return false;
    }
    if (tx.category !== 'payment' && tx.category !== 'debit_bill') return false;
    if (tx.accountId !== null && tx.accountId !== target.accountId) return false;
    if (tx.category === 'debit_bill' && tx.accountId !== null) return false;
    if (txBillIdFromId !== null) {
      const idParts = tx.id.split(':');
      if (idParts.length >= 3) {
        const idCycle = idParts[2];
        if (idCycle.length === 10 && idCycle.slice(0, 7) !== targetCycleMonth) return false;
        if (idCycle.length === 7 && idCycle !== targetCycleMonth) return false;
      }
    }
    return true;
  }

  // Must be category 'payment' on the matching debt account.
  // Merchant refunds (category: 'refund') do NOT settle or reverse payment obligations.
  if (!target.accountId || tx.accountId !== target.accountId) return false;
  if (tx.category !== 'payment') return false;

  return true;
}

/**
 * Calculate multi-payment matching and satisfaction status for an obligation.
 * Correctly accounts for partial payments, multiple payments, advance payments, late payments, and extra payments.
 */
export function matchPaymentsToObligation(
  obligation: PaymentObligation,
  transactions: readonly LedgerTransaction[],
  options?: { includePending?: boolean; currencyCode?: string },
): ObligationMatchResult {
  const currency = options?.currencyCode ?? obligation.requiredAmount?.currency ?? 'USD';
  const includePending = options?.includePending ?? false;

  const matchedTransactions = transactions.filter(tx =>
    paymentMatchesObligation(tx, obligation, includePending)
  );

  let totalPaidMinor = 0;
  let hasAdvancePayment = false;
  let hasLatePayment = false;

  for (const tx of matchedTransactions) {
    totalPaidMinor += tx.amount.minorUnits;

    if (tx.date < obligation.dueDate && tx.appliesToDate === obligation.dueDate) {
      hasAdvancePayment = true;
    }
    if (tx.date > obligation.dueDate) {
      hasLatePayment = true;
    }
  }

  const safeTotalPaidMinor = Math.max(0, totalPaidMinor);
  const requiredMinor = obligation.requiredAmount?.minorUnits ?? 0;
  const remainingMinor = Math.max(0, requiredMinor - safeTotalPaidMinor);
  const extraMinor = Math.max(0, safeTotalPaidMinor - requiredMinor);

  const isSatisfied = safeTotalPaidMinor >= requiredMinor;
  const isPartiallyPaid = safeTotalPaidMinor > 0 && safeTotalPaidMinor < requiredMinor;

  return {
    obligation,
    matchedTransactions,
    totalPaid: makeMoney(currency, safeTotalPaidMinor),
    remainingAmount: makeMoney(currency, remainingMinor),
    isSatisfied,
    isPartiallyPaid,
    hasAdvancePayment,
    hasLatePayment,
    extraAmount: makeMoney(currency, extraMinor),
  };
}

/**
 * Shared settlement view for Home, Budget and Transactions. Pending transactions
 * remain excluded from confirmed paid totals, but prevent another payment from
 * being recorded while their confirmation is unresolved.
 */
export function getObligationPaymentState(
  obligation: PaymentObligation,
  transactions: readonly LedgerTransaction[],
  currencyCode?: string,
): ObligationPaymentState {
  const confirmedMatch = matchPaymentsToObligation(obligation, transactions, {
    currencyCode,
    includePending: false,
  });
  const withPendingMatch = matchPaymentsToObligation(obligation, transactions, {
    currencyCode,
    includePending: true,
  });
  const pendingMinor = Math.max(0, withPendingMatch.totalPaid.minorUnits - confirmedMatch.totalPaid.minorUnits);
  const pendingAmount = makeMoney(currencyCode ?? obligation.requiredAmount?.currency ?? 'USD', pendingMinor);
  const status: ObligationSettlementStatus = confirmedMatch.isSatisfied
    ? 'paid'
    : pendingMinor > 0
      ? 'pending_confirmation'
      : confirmedMatch.isPartiallyPaid
        ? 'partially_paid'
        : 'unpaid';

  return { status, confirmedMatch, withPendingMatch, pendingAmount };
}

/**
 * Find candidate unassigned or unmatched payments in the ledger that can be linked to an obligation.
 */
export function findUnassignedPaymentsForObligation(
  obligation: PaymentObligation,
  transactions: readonly LedgerTransaction[],
): LedgerTransaction[] {
  const targetName = obligation.name?.toLowerCase().trim() ?? '';
  const obligationCurrency = obligation.requiredAmount?.currency;

  return transactions.filter(tx => {
    if (tx.deletedAt !== null) return false;
    // Strict currency matching: cannot assign a transaction of different currency
    if (obligationCurrency && tx.amount.currency !== obligationCurrency) return false;

    // Don't show transactions already specifically assigned to this exact due date
    if (tx.appliesToDate === obligation.dueDate) return false;

    if (obligation.kind === 'bill' && obligation.linkedDebtId && tx.accountId === obligation.linkedDebtId && tx.category === 'payment') {
      return true;
    }

    const historicalBillIds = obligation.historicalBillIds ?? [];

    // Don't show transactions that specifically belong to another bill
    if (tx.id.startsWith('bill:')) {
      const idBillId = extractBillIdFromTxId(tx.id);
      const matchesOwnBill = Boolean(obligation.billId && idBillId === obligation.billId);
      const matchesHistBill = Boolean(idBillId && historicalBillIds.includes(idBillId));
      if (!matchesOwnBill && !matchesHistBill) {
        return false;
      }
    }

    if (obligation.kind === 'debt') {
      if (historicalBillIds.length > 0) {
        const idBillId = extractBillIdFromTxId(tx.id);
        const memoIds = extractBillIdsFromMemo(tx.memo);
        const isHistBillTx = historicalBillIds.some(histId => idBillId === histId || memoIds.has(histId));
        if (isHistBillTx && (tx.accountId === null || tx.accountId === obligation.accountId) && (tx.category === 'payment' || tx.category === 'debit_bill')) {
          return !tx.appliesToDate;
        }
      }
      // Must be a payment
      if (tx.category !== 'payment') return false;
      // Either already on this debt account without appliesToDate, or unassigned payee match
      if (obligation.accountId && tx.accountId === obligation.accountId) {
        return !tx.appliesToDate;
      }
      return !tx.accountId && Boolean(targetName && tx.payee.toLowerCase().includes(targetName));
    } else {
      // Recurring bill
      if (obligation.accountId) {
        // Credit card bill: MUST be a merchant charge on the card, NEVER a debt repayment ('payment')
        if (tx.category === 'payment') return false;
        return (
          tx.accountId === obligation.accountId &&
          !tx.appliesToDate &&
          Boolean(targetName && tx.payee.toLowerCase().includes(targetName))
        );
      } else {
        // Debit bill: unassigned debit transaction matching bill payee
        return (
          tx.accountId === null &&
          !tx.appliesToDate &&
          Boolean(
            targetName &&
              (tx.payee.toLowerCase().includes(targetName) ||
                Boolean(tx.memo && tx.memo.toLowerCase().includes(targetName)))
          )
        );
      }
    }
  });
}

function effectiveDebtStartDate(
  debt: DebtItem,
  historicalBillIds: readonly string[],
  recurringBills: readonly RecurringBill[],
  asOfDate: DateOnly,
): string {
  const candidates = [debt.createdAt, debt.updatedAt]
    .concat(
      recurringBills
        .filter(bill => historicalBillIds.includes(bill.id))
        .map(bill => bill.createdAt),
    )
    .map(value => (value ? value.slice(0, 10) : ''))
    .filter(dateOnly => /^\d{4}-\d{2}-\d{2}$/.test(dateOnly));
  if (candidates.length === 0) return asOfDate;
  return candidates.sort()[0];
}

/**
 * Return all valid calendar months (YYYY-MM) from creation month up to current month.
 * Avoids phantom cycles before creation date or arbitrary 24-month limits.
 */
export function getValidPastDueCycleMonths(
  creationDateStr: string | null | undefined,
  currentMonthStr: string,
): string[] {
  const rawCreationMonth = creationDateStr ? creationDateStr.slice(0, 7) : currentMonthStr;
  const startMonth = rawCreationMonth <= currentMonthStr ? rawCreationMonth : currentMonthStr;
  const months: string[] = [];
  let cur = startMonth;
  // Safety guard against corrupted years (up to 1200 months / 100 years, no arbitrary 24-month cutoff)
  let maxCycles = 1200;
  while (cur <= currentMonthStr && maxCycles > 0) {
    months.push(cur);
    if (cur === currentMonthStr) break;
    cur = getNextMonthString(cur);
    maxCycles--;
  }
  return months;
}

/**
 * Centralized, shared past-due obligation engine for all screens (Home, Budget, etc.).
 * Scans all historical due cycles since creation date and current-month overdue cycles (< asOfDate).
 * Guarantees Home and Budget always agree on overdue items, counts, and amounts.
 */
export function calculateOverdueObligations(params: {
  debts: readonly DebtItem[];
  recurringBills: readonly RecurringBill[];
  transactions: readonly LedgerTransaction[];
  asOfDate: DateOnly; // today in household timezone
  currencyCode: string;
  schedules?: ObligationSchedules;
  loanBillPairs?: Readonly<Record<string, string>>;
  excludedBillIds?: readonly string[];
  historicalBillIdsByDebtId?: Readonly<Record<string, readonly string[]>>;
}): readonly OverdueObligationItem[] {
  const {
    debts,
    recurringBills,
    transactions,
    asOfDate,
    currencyCode,
    schedules,
    loanBillPairs = {},
    excludedBillIds = [],
    historicalBillIdsByDebtId = {},
  } = params;
  const excludedBills = new Set(excludedBillIds);
  const linkedBillToDebt = new Map(Object.entries(loanBillPairs).map(([debtId, billId]) => [billId, debtId]));
  const currentMonthStr = asOfDate.slice(0, 7);
  const currencyScale = getCurrency(currencyCode).scale;
  const overdueItems: OverdueObligationItem[] = [];

  // 1. Recurring Bills
  for (const bill of getActiveRecurringBills(recurringBills)) {
    if (excludedBills.has(bill.id)) continue;
    // Don't create cycles before bill creation or if creation is future-dated
    const billCreationDate = bill.createdAt || asOfDate;
    if (billCreationDate.slice(0, 10) > asOfDate) continue;

    const schedule = schedules?.[obligationScheduleKey('bill', bill.id)];
    const validMonths = getValidPastDueCycleMonths(schedule?.firstDueDate ?? billCreationDate, currentMonthStr);
    for (const mStr of validMonths) {
      const cycle = schedule ? getObligationCycle(schedule, mStr) : null;
      if (schedule && (!cycle || cycle.acknowledgedPaid)) continue;
      const cycleDueDate = cycle?.dueDate ?? resolveRecurringBillDate(mStr, bill.dueDay);
      const requiredAmount = cycle?.amount ?? bill.amount;
      if (cycleDueDate < billCreationDate.slice(0, 10)) continue;
      // Overdue means cycle due date is strictly in the past relative to asOfDate
      if (cycleDueDate < asOfDate) {
        const obligation: PaymentObligation = {
          id: bill.id,
          kind: 'bill',
          name: bill.name,
          dueDate: cycleDueDate,
          dueCycleMonth: mStr,
          requiredAmount,
          accountId: bill.creditAccountId,
          billId: bill.id,
          linkedDebtId: linkedBillToDebt.get(bill.id),
          bill,
        };
        const state = getObligationPaymentState(obligation, transactions, currencyCode);
        const match = state.confirmedMatch;
        if (!match.isSatisfied) {
          overdueItems.push({
            id: `${bill.id}:${cycleDueDate}`,
            kind: 'bill',
            name: bill.name,
            dueDate: cycleDueDate,
            dueCycleMonth: mStr,
            requiredAmount,
            remainingAmount: match.remainingAmount,
            totalPaid: match.totalPaid,
            isPartiallyPaid: match.isPartiallyPaid,
            isSatisfied: false,
            settlementStatus: state.status,
            pendingAmount: state.pendingAmount,
            bill,
            match,
            matchResult: match,
          });
        }
      }
    }
  }

  // 2. Active Debts (Credit cards, loans with positive balance, minimum payment, and due day)
  for (const debt of debts) {
    if (loanBillPairs[debt.id]) continue;
    const historicalBillIds = historicalBillIdsByDebtId[debt.id] ?? [];
    const schedule = resolveEffectiveDebtSchedule(schedules, debt.id, historicalBillIds);
    if (debt.balance <= 0 || debt.dueDay == null || (!schedule && debt.minimumPayment <= 0)) continue;
    // Use earliest verified debt or linked bill creation date; fall back to asOfDate
    const debtCreationDate = effectiveDebtStartDate(debt, historicalBillIds, recurringBills, asOfDate);
    if (debtCreationDate > asOfDate) continue;

    const requiredMoney = makeMoney(currencyCode, Math.round(debt.minimumPayment * 10 ** currencyScale));
    const validMonths = getValidPastDueCycleMonths(schedule?.firstDueDate ?? debtCreationDate, currentMonthStr);

    for (const mStr of validMonths) {
      const cycle = schedule ? getObligationCycle(schedule, mStr) : null;
      if (schedule && (!cycle || cycle.acknowledgedPaid)) continue;
      const cycleDueDate = cycle?.dueDate ?? resolveRecurringBillDate(mStr, debt.dueDay!);
      const cycleAmount = cycle?.amount ?? requiredMoney;
      if (cycleDueDate < debtCreationDate || cycleAmount.minorUnits <= 0) continue;
      if (cycleDueDate < asOfDate) {
        const obligation: PaymentObligation = {
          id: `minimum:${debt.id}`,
          kind: 'debt',
          name: `${debt.name} minimum`,
          dueDate: cycleDueDate,
          dueCycleMonth: mStr,
          requiredAmount: cycleAmount,
          accountId: debt.id,
          debt,
          historicalBillIds,
        };
        const state = getObligationPaymentState(obligation, transactions, currencyCode);
        const match = state.confirmedMatch;
        if (!match.isSatisfied) {
          overdueItems.push({
            id: `minimum:${debt.id}:${cycleDueDate}`,
            kind: 'debt',
            name: `${debt.name} minimum`,
            dueDate: cycleDueDate,
            dueCycleMonth: mStr,
            requiredAmount: cycleAmount,
            remainingAmount: match.remainingAmount,
            totalPaid: match.totalPaid,
            isPartiallyPaid: match.isPartiallyPaid,
            isSatisfied: false,
            settlementStatus: state.status,
            pendingAmount: state.pendingAmount,
            debt,
            match,
            matchResult: match,
          });
        }
      }
    }
  }

  // Sort by due date ascending (oldest past due first)
  return overdueItems.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export type ScheduledObligationRow = Readonly<{
  id: string; kind: PaymentObligationKind; name: string; dueDate: DateOnly; dueCycleMonth: string;
  requiredAmount: Money; bill?: RecurringBill; debt?: DebtItem; state: ObligationPaymentState;
}>;

/** Create only the ledger fields known for a minimum payment; loan allocations stay unknown. */
export function createDebtMinimumPaymentTransaction(params: {
  id: string; debt: DebtItem; today: DateOnly; dueDate: DateOnly; amount: Money; createdAt: string;
}): LedgerTransaction {
  return {
    id: params.id, accountId: params.debt.id, date: params.today, appliesToDate: params.dueDate,
    amount: params.amount, category: 'payment', payee: 'Payment',
    memo: `Minimum payment for ${params.dueDate}`, source: 'manual', reconciled: false,
    createdAt: params.createdAt, deletedAt: null,
  };
}

/** Shared current/next and overdue obligation rows for Transactions → Scheduled. */
export function getScheduledObligationRows(params: {
  debts: readonly DebtItem[];
  recurringBills: readonly RecurringBill[];
  transactions: readonly LedgerTransaction[];
  asOfDate: DateOnly;
  currencyCode: string;
  schedules?: ObligationSchedules;
  loanBillPairs?: Readonly<Record<string, string>>;
  excludedBillIds?: readonly string[];
  historicalBillIdsByDebtId?: Readonly<Record<string, readonly string[]>>;
}): ScheduledObligationRow[] {
  const {
    debts,
    recurringBills,
    transactions,
    asOfDate,
    currencyCode,
    schedules,
    loanBillPairs = {},
    excludedBillIds = [],
    historicalBillIdsByDebtId = {},
  } = params;
  const linkedBillToDebt = new Map(Object.entries(loanBillPairs).map(([debtId, billId]) => [billId, debtId]));
  const excludedBills = new Set(excludedBillIds);
  const currentMonth = asOfDate.slice(0, 7);
  const months = Array.from({ length: 12 }, (_, offset) => {
    let month = currentMonth;
    for (let step = 0; step < offset; step += 1) month = getNextMonthString(month);
    return month;
  });
  const rows = new Map<string, ScheduledObligationRow>();
  const add = (obligation: PaymentObligation, bill?: RecurringBill, debt?: DebtItem) => {
    const state = getObligationPaymentState(obligation, transactions, currencyCode);
    rows.set(`${obligation.kind}:${obligation.id}:${obligation.dueDate}`, {
      id: `${obligation.kind}:${obligation.id}:${obligation.dueDate}`,
      kind: obligation.kind, name: obligation.name ?? '', dueDate: obligation.dueDate,
      dueCycleMonth: obligation.dueCycleMonth ?? obligation.dueDate.slice(0, 7),
      requiredAmount: obligation.requiredAmount ?? makeMoney(currencyCode, 0), bill, debt, state,
    });
  };

  // Keep historical arrears from the shared selector; the current cycle below
  // supplies the same due date when it is overdue, so the map prevents duplicates.
  for (const item of calculateOverdueObligations(params)) {
    const entityId = item.kind === 'debt' ? item.debt?.id ?? item.id.replace(/^minimum:/, '') : item.bill?.id ?? item.id.split(':')[0];
    const obligation: PaymentObligation = {
      id: item.kind === 'debt' ? `minimum:${entityId}` : entityId,
      kind: item.kind, name: item.name, dueDate: item.dueDate, dueCycleMonth: item.dueCycleMonth,
      requiredAmount: item.requiredAmount, accountId: item.debt?.id ?? item.bill?.creditAccountId,
      billId: item.bill?.id, bill: item.bill, debt: item.debt,
      linkedDebtId: item.kind === 'bill' ? linkedBillToDebt.get(entityId) : undefined,
      historicalBillIds: item.kind === 'debt' ? (historicalBillIdsByDebtId[entityId] ?? []) : undefined,
    };
    add(obligation, item.bill, item.debt);
  }

  for (const bill of getActiveRecurringBills(recurringBills)) {
    if (excludedBills.has(bill.id)) continue;
    if ((bill.createdAt || asOfDate).slice(0, 10) > asOfDate) continue;
    const schedule = schedules?.[obligationScheduleKey('bill', bill.id)];
    for (const month of months) {
      const cycle = schedule ? getObligationCycle(schedule, month) : null;
      if (schedule && (!cycle || cycle.acknowledgedPaid)) continue;
      const dueDate = cycle?.dueDate ?? resolveRecurringBillDate(month, bill.dueDay);
      if (dueDate < (bill.createdAt || asOfDate).slice(0, 10)) continue;
      const cycleBill = cycle ? { ...bill, amount: cycle.amount } : bill;
      add({ id: bill.id, kind: 'bill', name: bill.name, dueDate, dueCycleMonth: month,
        requiredAmount: cycleBill.amount, accountId: bill.creditAccountId, billId: bill.id,
        linkedDebtId: Object.entries(loanBillPairs).find(([, billId]) => billId === bill.id)?.[0], bill: cycleBill }, cycleBill);
    }
  }
  const scale = getCurrency(currencyCode).scale;
  for (const debt of debts) {
    if (loanBillPairs[debt.id]) continue;
    const historicalBillIds = historicalBillIdsByDebtId[debt.id] ?? [];
    const schedule = resolveEffectiveDebtSchedule(schedules, debt.id, historicalBillIds);
    if (debt.balance <= 0 || debt.dueDay == null || (!schedule && debt.minimumPayment <= 0)) continue;
    const debtStartDate = effectiveDebtStartDate(debt, historicalBillIds, recurringBills, asOfDate);
    if (debtStartDate > asOfDate) continue;
    for (const month of months) {
      const cycle = schedule ? getObligationCycle(schedule, month) : null;
      if (schedule && (!cycle || cycle.acknowledgedPaid)) continue;
      const dueDate = cycle?.dueDate ?? resolveRecurringBillDate(month, debt.dueDay);
      if (dueDate < debtStartDate) continue;
      const requiredAmount = cycle?.amount ?? makeMoney(currencyCode, Math.round(debt.minimumPayment * 10 ** scale));
      if (requiredAmount.minorUnits <= 0) continue;
      add({ id: `minimum:${debt.id}`, kind: 'debt', name: `${debt.name} minimum`, dueDate,
        dueCycleMonth: month, requiredAmount, accountId: debt.id, debt, historicalBillIds }, undefined, debt);
    }
  }
  return [...rows.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
}

