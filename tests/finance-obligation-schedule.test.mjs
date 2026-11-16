import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeObligationSchedule as init, updateObligationSchedule as update, getObligationCycle as cycle, validateObligationSchedule, obligationScheduleKey } from '../src/finance/obligation-schedule.ts';
import { calculateOverdueObligations, getScheduledObligationRows } from '../src/finance/payment-matching.ts';
import { findFutureRecurringBillTransactions, generateRecurringBillTransaction, processRecurringBills } from '../src/finance/recurring-bills.ts';
const money = n => ({ currency: 'USD', minorUnits: n });
const bill = { id:'a', name:'Bill', category:'utilities', amount:money(2000), dueDay:5, paymentMethod:'credit', creditAccountId:'card', autoPost:true, active:true, createdAt:'2026-11-20T00:00:00Z' };
const overdue = (asOfDate, schedules, b = bill) => calculateOverdueObligations({ debts:[], recurringBills:[b], transactions:[], asOfDate, currencyCode:'USD', schedules });
test('first due respects household today, future start, and paid-today metadata', () => {
  assert.equal(init({today:'2026-11-07', dueDay:1, amount:money(1000)}).firstDueDate, '2026-12-01');
  assert.equal(init({today:'2026-11-07', startDate:'2027-01-08', dueDay:7, amount:money(1000)}).firstDueDate, '2027-02-07');
  assert.throws(() => init({today:'2026-11-07', startDate:'2026-11-06', dueDay:7, amount:money(1000)}));
  const yes = init({today:'2026-11-07', dueDay:7, amount:money(1000), paidToday:true});
  const no = init({today:'2026-11-07', dueDay:7, amount:money(1000)});
  assert.equal(cycle(yes,'2026-11').acknowledgedPaid,true);
  assert.equal(cycle(yes,'2026-12').acknowledgedPaid,false);
  assert.equal(cycle(no,'2026-11').acknowledgedPaid,false);
  assert.throws(() => init({today:'2026-11-07', dueDay:8, amount:money(1000), paidToday:true}));
});
test('month-end and leap-year clamp without losing requested day', () => {
  const s = init({today:'2024-01-31', dueDay:31, amount:money(1000)});
  assert.equal(cycle(s,'2024-02').dueDate,'2024-02-29');
  assert.equal(cycle(s,'2025-02').dueDate,'2025-02-28');
  assert.equal(cycle(s,'2024-03').dueDate,'2024-03-31');
});
test('legacy creation date bounds overdue and term history does not rewrite earlier cycles', () => {
  assert.equal(overdue('2026-11-21').length,0);
  const s = init({today:'2026-11-20', dueDay:25, amount:money(1000)});
  const changed = update(s,{effectiveMonth:'2026-12', dueDay:10, amount:money(2000)},'2026-11-20');
  assert.deepEqual(overdue('2027-01-11',{[obligationScheduleKey('bill','a')]:changed}).map(x=>[x.dueDate,x.requiredAmount.minorUnits]), [['2026-11-25',1000],['2026-12-10',2000],['2027-01-10',2000]]);
  assert.throws(() => update(changed,{effectiveMonth:'2026-11', dueDay:1, amount:money(100)},'2026-11-20'));
});
test('acknowledged cycle suppresses only itself and metadata survives JSON', () => {
  const s = init({today:'2026-11-20', dueDay:20, amount:money(2000), paidToday:true});
  const restored = JSON.parse(JSON.stringify({[obligationScheduleKey('bill','a')]:s}));
  validateObligationSchedule(restored['bill:a']);
  assert.deepEqual(overdue('2027-01-21',restored).map(x=>x.dueDate), ['2026-12-20','2027-01-20']);
  assert.throws(() => validateObligationSchedule({...s, acknowledgedPaidCycles:['bad']}));
  assert.throws(() => validateObligationSchedule({...s, terms:[]}));
});
test('recurring generator observes schedule eligibility and historical terms', () => {
  const s = init({today:'2026-11-20', dueDay:5, amount:money(1000)});
  assert.equal(generateRecurringBillTransaction({bill, targetMonth:'2026-11', today:'2026-11-30', schedule:s}),null);
  const tx = generateRecurringBillTransaction({bill, targetMonth:'2026-12', today:'2026-12-05', schedule:s});
  assert.equal(tx.amount.minorUnits,1000);
});
test('scheduled recurring processing uses the selected cycle amount and honors acknowledged cycles', () => {
  const upcoming = init({today:'2026-11-20', dueDay:5, amount:money(3100)});
  const schedules = { [obligationScheduleKey('bill','a')]: upcoming };
  const processed = processRecurringBills({
    bills:[bill], existingTransactions:[], currentInstant:new Date('2026-12-05T12:00:00Z'), householdTimeZone:'UTC', schedules,
  });
  assert.deepEqual(processed.newTransactions.map(tx => [tx.appliesToDate, tx.amount.minorUnits]), [['2026-12-05',3100]]);
  const acknowledged = init({today:'2026-11-20', dueDay:20, amount:money(3100), paidToday:true});
  const suppressed = processRecurringBills({
    bills:[bill], existingTransactions:[], currentInstant:new Date('2026-11-20T12:00:00Z'), householdTimeZone:'UTC',
    schedules:{ [obligationScheduleKey('bill','a')]: acknowledged },
  });
  assert.deepEqual(suppressed.newTransactions, []);
});
test('scheduled rows cover twelve future month groups for navigation', () => {
  const rows = getScheduledObligationRows({
    debts: [], recurringBills: [{ ...bill, createdAt: '2026-10-01T00:00:00Z', dueDay: 25 }],
    transactions: [], asOfDate: '2026-11-07', currencyCode: 'USD',
  });
  const scheduledHorizon = rows.filter(row => row.dueCycleMonth >= '2026-11');
  assert.deepEqual([...new Set(scheduledHorizon.map(row => row.dueCycleMonth))], [
    '2026-11','2026-12','2027-01','2027-02','2027-03','2027-04',
    '2027-05','2027-06','2027-07','2027-08','2027-09','2027-10',
  ]);
  assert.equal(rows.some(row => row.dueCycleMonth === '2027-11'), false);
});
test('future recurring deletion selector includes only explicitly linked future-dated active ledger rows', () => {
  const tx = (id, date, memo, deletedAt = null) => ({ id, date, memo, deletedAt, payee:'Bill', amount:money(1000), accountId:null, category:'debit_bill', source:'recurring_bill' });
  const rows = findFutureRecurringBillTransactions([
    tx('bill:a:2026-11-08','2026-11-08',null),
    tx('manual-1','2026-11-09','Payment [bill:a]'),
    tx('bill:a:2026-11-06','2026-11-06',null),
    tx('bill:b:2026-11-10','2026-11-10',null),
    tx('bill:a:2026-11-11','2026-11-11',null,'2026-11-07T20:00:00Z'),
    tx('manual-2','2026-11-12','[bill:a-extra]'),
  ], 'a', '2026-11-07');
  assert.deepEqual(rows.map(row => row.id), ['bill:a:2026-11-08','manual-1']);
});
test('future terms can be revised without rewriting an effective cycle', () => {
  const original = init({today:'2026-11-07', dueDay:7, amount:money(1000)});
  const pending = update(original, {effectiveMonth:'2026-12', dueDay:10, amount:money(2000)}, '2026-11-07');
  const revised = update(pending, {effectiveMonth:'2026-12', dueDay:12, amount:money(3000)}, '2026-11-08');
  assert.equal(cycle(revised, '2026-11').amount.minorUnits, 1000);
  assert.equal(cycle(revised, '2026-12').dueDate, '2026-12-12');
  assert.equal(cycle(revised, '2026-12').amount.minorUnits, 3000);
  assert.throws(() => update(revised, {effectiveMonth:'2026-12', dueDay:13, amount:money(4000)}, '2026-12-01'));
  const future = init({today:'2026-11-07', dueDay:1, amount:money(1000)});
  assert.equal(update(future, {effectiveMonth:'2026-12', dueDay:3, amount:money(2000)}, '2026-11-07').firstDueDate, '2026-12-03');
});
