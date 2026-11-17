// Optional obligation split-payment planning. This module never creates ledger rows or alters obligations.
// @ts-ignore TS5097
import { daysInMonth, parseDateOnly, getPreviousMonthString, type DateOnly } from './calendar.ts';
// @ts-ignore TS5097
import { type ScheduledObligationRow, type PaymentObligation, paymentMatchesObligation } from './payment-matching.ts';
// @ts-ignore TS5097
import type { LedgerTransaction } from './ledger.ts';

export type SplitPlanTerm = Readonly<{
  effectiveMonth: string;
  day1: number;
  day2: number;
  count?: 2 | 3 | 4;
  day3?: number;
  day4?: number;
  monthOffset3?: 0 | -1;
  monthOffset4?: 0 | -1;
  monthOffset1?: 0 | -1;
  monthOffset2?: 0 | -1;
}>;
export type DebtSplitPlanTerm = SplitPlanTerm;
export type PaymentSplitPlan = Readonly<{ terms: readonly SplitPlanTerm[] }>;
export type DebtPaymentSplitPlan = PaymentSplitPlan;
export type DebtPaymentSplitPlansByDebtId = Readonly<Record<string, PaymentSplitPlan>>;
export type BillPaymentSplitPlansByBillId = Readonly<Record<string, PaymentSplitPlan>>;

export type PlannedDebtInstallment = Readonly<{
  debtId?: string;
  billId?: string;
  kind?: 'debt' | 'bill';
  obligationId: string;
  cycleMonth: string;
  date: DateOnly;
  installment: 1 | 2 | 3 | 4;
  amountMinor: number;
  cumulativeTargetMinor: number;
  confirmedByDateMinor: number;
  pendingByDateMinor: number;
  status: 'planned' | 'covered' | 'behind_plan' | 'pending';
}>;
export type PlannedInstallment = PlannedDebtInstallment;

export type SplitPlanState = Readonly<{
  term: SplitPlanTerm;
  dates: readonly DateOnly[] | null;
  amountsMinor: readonly number[];
  status: 'active' | 'needs_review';
}>;
export type DebtSplitPlanState = SplitPlanState;

export function validatePaymentSplitPlans(plans: Record<string, PaymentSplitPlan>): void {
  if (!plans || typeof plans !== 'object' || Array.isArray(plans) || Object.keys(plans).length > 100000) throw new TypeError('Invalid split plans');
  for (const [id, plan] of Object.entries(plans)) {
    if (!id.trim() || id !== id.trim() || !plan || !Array.isArray(plan.terms) || !plan.terms.length || plan.terms.length > 1200) throw new TypeError('Invalid split plan');
    let previous = '';
    for (const term of plan.terms) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(term.effectiveMonth) || term.effectiveMonth <= previous) throw new TypeError('Invalid split plan term');
      const count = term.count ?? 2;
      if (![2, 3, 4].includes(count)) throw new TypeError('Invalid split plan term');
      const days = [term.day1, term.day2, term.day3, term.day4].slice(0, count);
      const offsets = [term.monthOffset1 ?? 0, term.monthOffset2 ?? 0, term.monthOffset3 ?? 0, term.monthOffset4 ?? 0].slice(0, count);
      for (let i = 0; i < count; i++) {
        const day = days[i];
        if (day === undefined || !Number.isInteger(day) || day < 1 || day > 31 || ![0, -1].includes(offsets[i]) || (i > 0 && (offsets[i] < offsets[i - 1] || (offsets[i] === offsets[i - 1] && day <= days[i - 1]!)))) throw new TypeError('Invalid split plan term');
      }
      parseDateOnly(`${term.effectiveMonth}-01`);
      previous = term.effectiveMonth;
    }
  }
}
export const validateDebtPaymentSplitPlans = validatePaymentSplitPlans;
export const validateBillPaymentSplitPlans = validatePaymentSplitPlans;

function termForMonth(plan: PaymentSplitPlan, month: string): SplitPlanTerm | null {
  let found: SplitPlanTerm | null = null;
  for (const term of plan.terms) { if (term.effectiveMonth > month) break; found = term; }
  return found;
}

export function clampDate(month: string, selectedDay: number): DateOnly {
  const year = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  return parseDateOnly(`${month}-${String(Math.min(selectedDay, daysInMonth(year, m))).padStart(2, '0')}`);
}

export function resolveDebtSplitPlanState(plan: PaymentSplitPlan, row: ScheduledObligationRow): SplitPlanState | null {
  const term = termForMonth(plan, row.dueCycleMonth);
  if (!term) return null;
  const count = term.count ?? 2;
  const base = Math.floor(row.requiredAmount.minorUnits / count);
  const amountsMinor = Array.from({ length: count }, (_, i) => i === count - 1 ? row.requiredAmount.minorUnits - base * (count - 1) : base);
  const days = [term.day1, term.day2, term.day3!, term.day4!];
  const offsets = [term.monthOffset1, term.monthOffset2, term.monthOffset3, term.monthOffset4];
  const dates = days.slice(0, count).map((day, i) => clampDate(offsets[i] === -1 ? getPreviousMonthString(row.dueCycleMonth) : row.dueCycleMonth, day));
  if (dates.some((date, i) => date > row.dueDate || (i > 0 && date <= dates[i - 1]))) return { term, dates: null, amountsMinor, status: 'needs_review' };
  return { term, dates, amountsMinor, status: 'active' };
}
export const resolveSplitPlanState = resolveDebtSplitPlanState;

/** Honor the selected obligation cycle when its dates fit; otherwise find the first future cycle when no cycle was selected. */
export function firstEligibleSplitTerm(params: {
  debtId?: string;
  billId?: string;
  obligationId?: string;
  day1: number;
  day2: number;
  monthOffset1?: 0 | -1;
  monthOffset2?: 0 | -1;
  current: ScheduledObligationRow | undefined;
  candidates?: readonly ScheduledObligationRow[];
  today: DateOnly;
}): SplitPlanTerm {
  parseDateOnly(params.today);
  const offset1 = params.monthOffset1 ?? 0;
  const offset2 = params.monthOffset2 ?? 0;
  if (!Number.isInteger(params.day1) || !Number.isInteger(params.day2) || params.day1 < 1 || params.day1 > 31 || params.day2 < 1 || params.day2 > 31) throw new RangeError('Choose two calendar days');
  if (offset1 !== 0 && offset1 !== -1 || offset2 !== 0 && offset2 !== -1 || offset1 > offset2 || (offset1 === offset2 && params.day1 >= params.day2)) {
    throw new RangeError('Choose two increasing calendar days');
  }
  const month = params.today.slice(0, 7);
  const entityId = params.debtId ?? params.billId ?? (params.current?.kind === 'debt' ? params.current.debt?.id : params.current?.bill?.id);
  const kind = params.debtId ? 'debt' : params.billId ? 'bill' : params.current?.kind;

  const candidates = [params.current, ...(params.candidates ?? [])].filter((row): row is ScheduledObligationRow => Boolean(row))
    .filter(row => {
      if (kind && row.kind !== kind) return false;
      if (row.kind === 'debt') return !entityId || row.debt?.id === entityId;
      if (row.kind === 'bill') return !entityId || row.bill?.id === entityId;
      return true;
    })
    .filter(row => row.dueCycleMonth >= month)
    .sort((a, b) => a.dueCycleMonth.localeCompare(b.dueCycleMonth));

  const selected = params.current;
  if (selected) {
    const selectedMonth1 = offset1 === -1 ? getPreviousMonthString(selected.dueCycleMonth) : selected.dueCycleMonth;
    const selectedMonth2 = offset2 === -1 ? getPreviousMonthString(selected.dueCycleMonth) : selected.dueCycleMonth;
    const first = clampDate(selectedMonth1, params.day1), second = clampDate(selectedMonth2, params.day2);
    if (first < second && second <= selected.dueDate) {
      return {
        effectiveMonth: selected.dueCycleMonth,
        day1: params.day1,
        day2: params.day2,
        ...(offset1 ? { monthOffset1: offset1 } : {}),
        ...(offset2 ? { monthOffset2: offset2 } : {}),
      };
    }
    throw new RangeError('These dates do not fit before the selected due date. Choose an earlier day or adjust the installment months.');
  }

  const seenMonths = new Set<string>();
  for (const row of candidates) {
    if (seenMonths.has(row.dueCycleMonth)) continue;
    seenMonths.add(row.dueCycleMonth);
    const month1 = offset1 === -1 ? getPreviousMonthString(row.dueCycleMonth) : row.dueCycleMonth;
    const month2 = offset2 === -1 ? getPreviousMonthString(row.dueCycleMonth) : row.dueCycleMonth;
    const first = clampDate(month1, params.day1), second = clampDate(month2, params.day2);
    if (first >= params.today && first < second && second <= row.dueDate) {
      return {
        effectiveMonth: row.dueCycleMonth,
        day1: params.day1,
        day2: params.day2,
        ...(offset1 ? { monthOffset1: offset1 } : {}),
        ...(offset2 ? { monthOffset2: offset2 } : {}),
      };
    }
  }
  throw new RangeError(kind === 'debt' && offset1 === 0 && offset2 === 0
    ? 'These days do not fit before an upcoming monthly minimum due date. Choose earlier days.'
    : 'These days do not fit before an upcoming due date. Choose earlier days or adjust installment months.');
}

/** Preserve earlier legacy plan terms while canonical loan edits own later cycles. */
export function resolveUnifiedDebtSplitPlans(
  plans: DebtPaymentSplitPlansByDebtId = {},
  billPlans: BillPaymentSplitPlansByBillId = {},
  aliases: Readonly<Record<string, readonly string[]>> = {},
): Record<string, PaymentSplitPlan> {
  const result = { ...plans };
  for (const [debtId, billIds] of Object.entries(aliases)) {
    const terms = new Map<string, SplitPlanTerm>();
    for (const billId of billIds) for (const term of billPlans[billId]?.terms ?? []) terms.set(term.effectiveMonth, term);
    for (const term of plans[debtId]?.terms ?? []) terms.set(term.effectiveMonth, term);
    if (terms.size) result[debtId] = { terms: [...terms.values()].sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth)) };
  }
  return result;
}

/** Calendar events are intentionally selected only for Scheduled; never feed these into obligation totals. */
export function getPlannedDebtInstallments(params: {
  rows: readonly ScheduledObligationRow[];
  plans?: DebtPaymentSplitPlansByDebtId;
  billPlans?: BillPaymentSplitPlansByBillId;
  historicalBillIdsByDebtId?: Readonly<Record<string, readonly string[]>>;
  transactions: readonly LedgerTransaction[];
  asOfDate: DateOnly;
}): PlannedDebtInstallment[] {
  const events: PlannedDebtInstallment[] = [];
  const effectivePlans = resolveUnifiedDebtSplitPlans(params.plans, params.billPlans, params.historicalBillIdsByDebtId);
  for (const row of params.rows) {
    const historicalBillIds = row.kind === 'debt' && row.debt
      ? (params.historicalBillIdsByDebtId?.[row.debt.id] ?? [])
      : [];
    const plan = row.kind === 'debt'
      ? (row.debt
          ? effectivePlans[row.debt.id]
          : undefined)
      : (row.bill ? params.billPlans?.[row.bill.id] : undefined);
    if (!plan) continue;
    const state = resolveDebtSplitPlanState(plan, row);
    if (!state?.dates) continue;
    const obligation: PaymentObligation = row.kind === 'debt'
      ? {
          kind: 'debt' as const,
          id: `minimum:${row.debt!.id}`,
          accountId: row.debt!.id,
          historicalBillIds,
          dueDate: row.dueDate,
          dueCycleMonth: row.dueCycleMonth,
          requiredAmount: row.requiredAmount,
        }
      : { kind: 'bill' as const, id: row.bill!.id, accountId: row.bill!.creditAccountId, billId: row.bill!.id, dueDate: row.dueDate, dueCycleMonth: row.dueCycleMonth, requiredAmount: row.requiredAmount, bill: row.bill };

    const confirmedTxs = row.state?.confirmedMatch?.matchedTransactions ?? params.transactions.filter(tx => paymentMatchesObligation(tx, obligation));
    const pendingTxs = row.state?.withPendingMatch?.matchedTransactions?.filter(tx => tx.isPending) ?? params.transactions.filter(tx => paymentMatchesObligation(tx, obligation, true) && tx.isPending);
    const confirmedTotal = confirmedTxs.reduce((sum, tx) => sum + tx.amount.minorUnits, 0);
    const pendingTotal = pendingTxs.reduce((sum, tx) => sum + tx.amount.minorUnits, 0);

    for (const [index, date] of state.dates.entries()) {
      const confirmedByDate = confirmedTxs.filter(tx => tx.date <= date).reduce((sum, tx) => sum + tx.amount.minorUnits, 0);
      const pendingByDate = pendingTxs.filter(tx => tx.date <= date).reduce((sum, tx) => sum + tx.amount.minorUnits, 0);
      const target = state.amountsMinor.slice(0, index + 1).reduce((sum, amount) => sum + amount, 0);
      events.push({
        debtId: row.debt?.id,
        billId: row.bill?.id,
        kind: row.kind,
        obligationId: row.id,
        cycleMonth: row.dueCycleMonth,
        date,
        installment: (index + 1) as 1 | 2 | 3 | 4,
        amountMinor: state.amountsMinor[index],
        cumulativeTargetMinor: target,
        confirmedByDateMinor: confirmedByDate,
        pendingByDateMinor: pendingByDate,
        status: confirmedTotal >= target ? 'covered' : confirmedTotal + pendingTotal >= target || pendingByDate > 0 ? 'pending' : date < params.asOfDate ? 'behind_plan' : 'planned',
      });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.obligationId.localeCompare(b.obligationId));
}
export const getPlannedInstallments = getPlannedDebtInstallments;


