// @ts-ignore TS5097: direct Node tests load TypeScript modules by extension.
import { householdDate, getNextMonthString, type DateOnly } from './calendar.ts';
// @ts-ignore TS5097
import { type Money } from './money.ts';
// @ts-ignore TS5097
import { initializeObligationSchedule, obligationScheduleKey, updateObligationSchedule, validateObligationSchedule, type ObligationSchedule, type ObligationTerms } from './obligation-schedule.ts';
// @ts-ignore TS5097
import { resolveRecurringBillDate } from './recurring-bills.ts';

/** True when this save first begins tracking an obligation due today. */
export function shouldAskPaidToday(params: { dueDay: number; today: DateOnly; isNew: boolean; legacyDueDay?: number | null; hasSchedule: boolean }): boolean {
  return (params.isNew || (!params.hasSchedule && params.legacyDueDay == null)) &&
    initializeObligationSchedule({ today: params.today, dueDay: params.dueDay, amount: { currency: 'USD', minorUnits: 0 } }).firstDueDate === params.today;
}

/** Prepare an editor schedule while anchoring first-time tracking on today. */
export function prepareObligationEditorSchedule(params: {
  kind: 'debt' | 'bill'; id: string; today: DateOnly; timeZone?: string; dueDay: number; amount: Money;
  legacyDueDay?: number; legacyAmount?: Money; createdAt: string; isNew: boolean; paidToday?: boolean; existing?: ObligationSchedule;
}): ObligationSchedule {
  const { today, timeZone, dueDay, amount } = params;
  obligationScheduleKey(params.kind, params.id);
  if (params.existing) {
    const schedule = params.existing;
    validateObligationSchedule(schedule);
    const latest = schedule.terms[schedule.terms.length - 1];
    if (latest.dueDay === dueDay && latest.amount.currency === amount.currency && latest.amount.minorUnits === amount.minorUnits) return schedule;
    const nextMonth = getNextMonthString(today.slice(0, 7));
    return updateObligationSchedule(schedule, {
      effectiveMonth: latest.effectiveMonth > nextMonth ? latest.effectiveMonth : nextMonth,
      dueDay, amount,
    }, today);
  }

  // A debt with no previous due day has only just become a tracked obligation.
  // Creation-date history is valid only for legacy obligations that had a due day.
  if (params.isNew || params.legacyDueDay == null) {
    return initializeObligationSchedule({ today, dueDay, amount, paidToday: params.paidToday });
  }

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
  const historicalDueDay = params.legacyDueDay;
  let firstDueDate = resolveRecurringBillDate(month, historicalDueDay);
  if (firstDueDate < createdDate) {
    month = getNextMonthString(month);
    firstDueDate = resolveRecurringBillDate(month, historicalDueDay);
  }
  const schedule: ObligationSchedule = {
    firstDueDate, acknowledgedPaidCycles: [],
    terms: [{ effectiveMonth: month, dueDay: historicalDueDay, amount: params.legacyAmount ?? amount }],
  };
  validateObligationSchedule(schedule);
  const latest = schedule.terms[schedule.terms.length - 1];
  if (latest.dueDay === dueDay && latest.amount.currency === amount.currency && latest.amount.minorUnits === amount.minorUnits) return schedule;
  const nextMonth = getNextMonthString(today.slice(0, 7));
  const effectiveMonth = latest.effectiveMonth > nextMonth ? latest.effectiveMonth : nextMonth;
  const term: ObligationTerms = { effectiveMonth, dueDay, amount };
  return updateObligationSchedule(schedule, term, today);
}
