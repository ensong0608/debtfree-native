// Pure, JSON-safe monthly obligation schedules. Dates are household calendar dates.
// @ts-ignore TS5097
import { parseDateOnly, daysInMonth, getNextMonthString, type DateOnly } from './calendar.ts';
// @ts-ignore TS5097
import { makeMoney, type Money } from './money.ts';

export type ObligationScheduleKey = `debt:${string}` | `bill:${string}`;
export type ObligationTerms = Readonly<{ effectiveMonth: string; dueDay: number; amount: Money }>;
export type ObligationSchedule = Readonly<{ firstDueDate: DateOnly; acknowledgedPaidCycles: readonly string[]; terms: readonly ObligationTerms[] }>;
export type ObligationSchedules = Readonly<Record<string, ObligationSchedule>>;

export function obligationScheduleKey(kind: 'debt' | 'bill', id: string): ObligationScheduleKey {
  if (!id || id.trim() !== id) throw new RangeError('Invalid obligation id');
  return `${kind}:${id}`;
}
function dueDate(month: string, day: number): DateOnly {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000') || !Number.isInteger(day) || day < 1 || day > 31) throw new RangeError('Invalid month or due day');
  return parseDateOnly(`${month}-${String(Math.min(day, daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5))))).padStart(2, '0')}`);
}
function validateTerms(term: ObligationTerms): void {
  dueDate(term.effectiveMonth, term.dueDay);
  makeMoney(term.amount.currency, term.amount.minorUnits);
  if (term.amount.minorUnits < 0) throw new RangeError('Negative obligation amount');
}
/** Throws on malformed or unbounded persisted metadata. */
export function validateObligationSchedule(schedule: ObligationSchedule): void {
  parseDateOnly(schedule.firstDueDate);
  if (!Array.isArray(schedule.terms) || !schedule.terms.length || schedule.terms.length > 1200 || !Array.isArray(schedule.acknowledgedPaidCycles) || schedule.acknowledgedPaidCycles.length > 1200) throw new RangeError('Invalid schedule size');
  let previous = '';
  for (const term of schedule.terms) {
    validateTerms(term);
    if (term.effectiveMonth <= previous || term.amount.currency !== schedule.terms[0].amount.currency) throw new RangeError('Invalid term history');
    previous = term.effectiveMonth;
  }
  if (schedule.terms[0].effectiveMonth !== schedule.firstDueDate.slice(0, 7) || dueDate(schedule.terms[0].effectiveMonth, schedule.terms[0].dueDay) !== schedule.firstDueDate) throw new RangeError('First due date does not match terms');
  const seen = new Set<string>();
  for (const cycle of schedule.acknowledgedPaidCycles) {
    dueDate(cycle, 1);
    if (cycle < schedule.firstDueDate.slice(0, 7) || seen.has(cycle)) throw new RangeError('Invalid acknowledged cycle');
    seen.add(cycle);
  }
}
/** Start on or after both today and the requested start date. Paid acknowledgement applies only when due today. */
export function initializeObligationSchedule(params: { today: DateOnly; startDate?: DateOnly; dueDay: number; amount: Money; paidToday?: boolean }): ObligationSchedule {
  const today = parseDateOnly(params.today), start = parseDateOnly(params.startDate ?? today);
  if (start < today) throw new RangeError('Start date cannot be in the past');
  let month = start.slice(0, 7);
  let first = dueDate(month, params.dueDay);
  if (first < start) { month = getNextMonthString(month); first = dueDate(month, params.dueDay); }
  if (params.paidToday && first !== today) throw new RangeError('Only a cycle due today can be acknowledged');
  const schedule: ObligationSchedule = { firstDueDate: first, acknowledgedPaidCycles: params.paidToday ? [month] : [], terms: [{ effectiveMonth: month, dueDay: params.dueDay, amount: params.amount }] };
  validateObligationSchedule(schedule);
  return schedule;
}
/** Append future-cycle terms; existing terms and acknowledgements are preserved. */
export function updateObligationSchedule(schedule: ObligationSchedule, term: ObligationTerms, today: DateOnly): ObligationSchedule {
  validateObligationSchedule(schedule); parseDateOnly(today); validateTerms(term);
  const last = schedule.terms[schedule.terms.length - 1];
  if (term.effectiveMonth <= today.slice(0, 7) || term.effectiveMonth < last.effectiveMonth) throw new RangeError('Terms must start in a later future cycle');
  const replace = term.effectiveMonth === last.effectiveMonth;
  const terms = replace ? [...schedule.terms.slice(0, -1), term] : [...schedule.terms, term];
  const updated = { ...schedule, firstDueDate: replace && terms.length === 1 ? dueDate(term.effectiveMonth, term.dueDay) : schedule.firstDueDate, terms };
  validateObligationSchedule(updated);
  return updated;
}
/** Returns null before the first eligible cycle; an acknowledgement is metadata, not a payment. */
export function getObligationCycle(schedule: ObligationSchedule, month: string): { dueDate: DateOnly; amount: Money; dueDay: number; acknowledgedPaid: boolean } | null {
  validateObligationSchedule(schedule); dueDate(month, 1);
  if (month < schedule.firstDueDate.slice(0, 7)) return null;
  let term = schedule.terms[0];
  for (const candidate of schedule.terms) { if (candidate.effectiveMonth > month) break; term = candidate; }
  const date = dueDate(month, term.dueDay);
  if (date < schedule.firstDueDate) return null;
  return { dueDate: date, amount: term.amount, dueDay: term.dueDay, acknowledgedPaid: schedule.acknowledgedPaidCycles.includes(month) };
}
export function isObligationCycleEligible(schedule: ObligationSchedule, month: string): boolean {
  const cycle = getObligationCycle(schedule, month);
  return cycle !== null && !cycle.acknowledgedPaid;
}
