// @ts-ignore TS5097: direct Node tests load TypeScript modules by extension.
import { householdDate, getNextMonthString, parseDateOnly, type DateOnly } from './calendar.ts';
// @ts-ignore TS5097
import { type Money } from './money.ts';
// @ts-ignore TS5097
import { getObligationCycle, initializeObligationSchedule, obligationScheduleKey, updateObligationSchedule, validateObligationSchedule, type ObligationSchedule } from './obligation-schedule.ts';
// @ts-ignore TS5097
import { resolveRecurringBillDate } from './recurring-bills.ts';

/** True when this save first begins tracking an obligation due today. */
export function shouldAskPaidToday(params: { dueDay: number; today: DateOnly; isNew: boolean; legacyDueDay?: number | null; hasSchedule: boolean }): boolean {
  return (params.isNew || (!params.hasSchedule && params.legacyDueDay == null)) &&
    initializeObligationSchedule({ today: params.today, dueDay: params.dueDay, amount: { currency: 'USD', minorUnits: 0 } }).firstDueDate === params.today;
}

export type ObligationCycleMove = Readonly<{ fromMonth: string; toDate: DateOnly }>;
export type ObligationDueDateEdit = Readonly<{
  cycleMove?: ObligationCycleMove;
  protectedDueDays?: Readonly<Record<string, number>>;
  restoreSuppressedCycle?: Readonly<{ month: string; dueDay: number }>;
}>;

type ScheduleEdit = {
  kind: 'debt' | 'bill'; id: string; today: DateOnly; timeZone?: string; dueDay: number; amount: Money;
  legacyDueDay?: number; legacyAmount?: Money; createdAt: string; isNew: boolean; paidToday?: boolean; existing?: ObligationSchedule;
} & ObligationDueDateEdit;

function legacySchedule(params: ScheduleEdit, historicalDueDay: number): ObligationSchedule {
  const { today, timeZone, amount } = params;
  let createdDate: DateOnly;
  try {
    const createdAt = new Date(params.createdAt);
    createdDate = Number.isFinite(createdAt.getTime())
      ? householdDate(createdAt, timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
      : today;
  } catch {
    createdDate = today;
  }
  if (createdDate > today) createdDate = today;
  let month = createdDate.slice(0, 7);
  let firstDueDate = resolveRecurringBillDate(month, historicalDueDay);
  if (firstDueDate < createdDate) {
    month = getNextMonthString(month);
    firstDueDate = resolveRecurringBillDate(month, historicalDueDay);
  }
  return {
    firstDueDate, acknowledgedPaidCycles: [],
    terms: [{ effectiveMonth: month, dueDay: historicalDueDay, amount: params.legacyAmount ?? amount }],
  };
}

/** Prepare an editor schedule while anchoring first-time tracking on today. */
export function prepareObligationEditorSchedule(params: ScheduleEdit): ObligationSchedule {
  const { today, dueDay, amount, cycleMove, protectedDueDays, restoreSuppressedCycle } = params;
  obligationScheduleKey(params.kind, params.id);
  if (!params.existing && (params.isNew || params.legacyDueDay == null)) {
    return initializeObligationSchedule({ today, dueDay, amount, paidToday: params.paidToday });
  }
  const schedule = params.existing ?? legacySchedule(params, params.legacyDueDay!);
  validateObligationSchedule(schedule);
  const latest = schedule.terms[schedule.terms.length - 1];
  const todayMonth = today.slice(0, 7);
  const nextMonth = getNextMonthString(todayMonth);
  const termsUnchanged = latest.dueDay === dueDay && latest.amount.currency === amount.currency && latest.amount.minorUnits === amount.minorUnits;
  let updated = termsUnchanged ? schedule : updateObligationSchedule(schedule, {
    effectiveMonth: latest.effectiveMonth > nextMonth ? latest.effectiveMonth : nextMonth,
    dueDay, amount,
  }, today);
  if (protectedDueDays && Object.keys(protectedDueDays).length > 0) {
    updated = { ...updated, cycleDueDayOverrides: { ...updated.cycleDueDayOverrides, ...protectedDueDays } };
    validateObligationSchedule(updated);
  }
  if (restoreSuppressedCycle && updated.cycleDueDayOverrides?.[restoreSuppressedCycle.month] === null) {
    const { month: restoreMonth, dueDay: restoreDueDay } = restoreSuppressedCycle;
    const overrides: Record<string, number | null> = { ...updated.cycleDueDayOverrides };
    delete overrides[restoreMonth];
    const applyOverrides = (nextOverrides: Record<string, number | null>): ObligationSchedule => {
      if (Object.keys(nextOverrides).length > 0) {
        return { ...updated, cycleDueDayOverrides: nextOverrides };
      }
      const { cycleDueDayOverrides: _omitted, ...rest } = updated;
      return rest;
    };
    const candidate = applyOverrides(overrides);
    const resolvedCycle = getObligationCycle(candidate, restoreMonth);
    if (resolvedCycle?.dueDay !== restoreDueDay) {
      overrides[restoreMonth] = restoreDueDay;
    }
    updated = applyOverrides(overrides);
    validateObligationSchedule(updated);
  }
  if (!cycleMove) return updated;

  const { fromMonth, toDate } = cycleMove;
  const targetMonth = parseDateOnly(toDate).slice(0, 7);
  const sourceCycle = getObligationCycle(schedule, fromMonth);
  const bringsFirstCycleForward = fromMonth === nextMonth && targetMonth === todayMonth &&
    schedule.firstDueDate.slice(0, 7) === fromMonth && schedule.terms.length === 1 &&
    !schedule.cycleDueDayOverrides;
  const sourceMonthAllowed = fromMonth === todayMonth || getNextMonthString(fromMonth) === todayMonth || bringsFirstCycleForward;
  if (!sourceMonthAllowed || targetMonth < todayMonth || targetMonth > nextMonth ||
      toDate < today || resolveRecurringBillDate(targetMonth, dueDay) !== toDate) {
    throw new RangeError('Invalid obligation cycle move');
  }
  if (schedule.acknowledgedPaidCycles.includes(fromMonth) || schedule.acknowledgedPaidCycles.includes(targetMonth)) {
    throw new RangeError('Cannot move an acknowledged cycle');
  }
  if (protectedDueDays?.[targetMonth] !== undefined &&
      resolveRecurringBillDate(targetMonth, protectedDueDays[targetMonth]) !== toDate) {
    throw new RangeError('Cannot move to a cycle with recorded payment activity on another date');
  }
  if (bringsFirstCycleForward) {
    const first = initializeObligationSchedule({ today, dueDay, amount });
    return updated.cycleDueDayOverrides ? { ...first, cycleDueDayOverrides: updated.cycleDueDayOverrides } : first;
  }
  if (!sourceCycle && !(fromMonth !== targetMonth && schedule.cycleDueDayOverrides?.[fromMonth] === null)) {
    throw new RangeError('Source cycle does not exist');
  }

  const overrides = { ...updated.cycleDueDayOverrides };
  if (fromMonth !== targetMonth) overrides[fromMonth] = null;
  if (getObligationCycle(updated, targetMonth)?.dueDate !== toDate) overrides[targetMonth] = dueDay;
  const moved = { ...updated, cycleDueDayOverrides: overrides };
  validateObligationSchedule(moved);
  if (!getObligationCycle(moved, targetMonth)) throw new RangeError('Target cycle precedes the obligation start');
  return moved;
}
