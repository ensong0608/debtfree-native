/** A validated Gregorian date in the inclusive range 0001-01-01..9999-12-31. */
export type DateOnly = string & { readonly __dateOnly: unique symbol };
export type DatePeriod = Readonly<{ start: DateOnly; endExclusive: DateOnly }>;
function daysInMonth(year: number, month: number): number {
  return [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
export function parseDateOnly(value: string): DateOnly {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m || m[0] !== value) throw new RangeError('Invalid date-only format');
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) throw new RangeError('Invalid calendar date');
  return value as DateOnly;
}
function dateFromParts(year: number, month: number, day: number): DateOnly {
  return parseDateOnly(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
}
/** Offset from the first payment's month, preserving the original requested day. */
export function monthlyPaymentDate(firstPayment: DateOnly, requestedDay: number, monthOffset: number): DateOnly {
  const first = parseDateOnly(firstPayment);
  if (!Number.isInteger(requestedDay) || requestedDay < 1 || requestedDay > 31 || !Number.isSafeInteger(monthOffset) || monthOffset < 0) throw new RangeError('Invalid recurrence');
  const year = Number(first.slice(0, 4)), month = Number(first.slice(5, 7));
  if (Number(first.slice(8, 10)) !== Math.min(requestedDay, daysInMonth(year, month))) throw new RangeError('First payment does not match requested day');
  const index = (year - 1) * 12 + month - 1 + monthOffset;
  if (!Number.isSafeInteger(index) || index > 9999 * 12 - 1) throw new RangeError('Recurrence outside supported years');
  const targetYear = Math.floor(index / 12) + 1, targetMonth = index % 12 + 1;
  return dateFromParts(targetYear, targetMonth, Math.min(requestedDay, daysInMonth(targetYear, targetMonth)));
}
export function monthPeriod(date: DateOnly): DatePeriod {
  const valid = parseDateOnly(date), year = Number(valid.slice(0, 4)), month = Number(valid.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year, nextMonth = month === 12 ? 1 : month + 1;
  if (nextYear > 9999) throw new RangeError('Period outside supported years');
  return { start: dateFromParts(year, month, 1), endExclusive: dateFromParts(nextYear, nextMonth, 1) };
}
/** Date interpretation always uses the caller's explicit IANA zone and instant. */
export function householdDate(instant: Date, timeZone: string): DateOnly {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) throw new RangeError('Invalid instant');
  if (!timeZone || !/^(?:[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)+|UTC)$/.test(timeZone)) throw new RangeError('Invalid IANA time zone');
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', era: 'short' });
  const parts = formatter.formatToParts(instant);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  if (part('era') !== 'AD') throw new RangeError('Instant outside supported years');
  return dateFromParts(Number(part('year')), Number(part('month')), Number(part('day')));
}
export function dateInPeriod(date: DateOnly, period: DatePeriod): boolean {
  const value = parseDateOnly(date), start = parseDateOnly(period.start), end = parseDateOnly(period.endExclusive);
  if (start >= end) throw new RangeError('Invalid half-open period');
  return value >= start && value < end;
}
export function instantInPeriod(instant: Date, timeZone: string, period: DatePeriod): boolean {
  return dateInPeriod(householdDate(instant, timeZone), period);
}
