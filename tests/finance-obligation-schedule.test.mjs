import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeObligationSchedule as init, updateObligationSchedule as update, getObligationCycle as cycle, validateObligationSchedule, obligationScheduleKey } from '../src/finance/obligation-schedule.ts';
import { prepareObligationEditorSchedule } from '../src/finance/obligation-editor-domain.ts';
import { calculateOverdueObligations, getScheduledObligationRows } from '../src/finance/payment-matching.ts';
import { findFutureRecurringBillTransactions, generateRecurringBillTransaction, processRecurringBills } from '../src/finance/recurring-bills.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/src/finance/obligation-editor.ts')) {
      if (specifier === 'react-native') {
        const mock = `export const Alert = { alert: (...args) => globalThis.__obligationAlertMock?.(...args) };`;
        return { url: `data:text/javascript,${encodeURIComponent(mock)}`, shortCircuit: true };
      }
      if (specifier === '../onboarding-storage') {
        const mock = `export class FinancialSettingsConflictError extends Error {} export const loadUserOnboardingData = async () => { throw new Error('unused'); }; export const saveUserOnboardingData = async () => { throw new Error('unused'); };`;
        return { url: `data:text/javascript,${encodeURIComponent(mock)}`, shortCircuit: true };
      }
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !/\.[a-z]+$/i.test(specifier)) {
      const resolved = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(resolved))) return nextResolve(resolved.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const require = createRequire(import.meta.url);
const { chooseObligationDueDateEdit } = require('../src/finance/obligation-editor.ts');
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
const editSchedule = (existing, params = {}) => prepareObligationEditorSchedule({
  kind:'bill', id:'a', today:'2026-11-20', dueDay:6, amount:money(2000), createdAt:'2026-11-01T00:00:00Z', isNew:false, existing, ...params,
});
test('confirmed same-cycle date change overrides only that cycle and updates future terms', () => {
  const original = init({today:'2026-11-20', dueDay:25, amount:money(2000)});
  const changed = editSchedule(original, { dueDay:22, cycleMove:{fromMonth:'2026-11', toDate:'2026-11-22'} });
  assert.equal(changed.firstDueDate, original.firstDueDate);
  assert.equal(cycle(changed,'2026-11').dueDate,'2026-11-22');
  assert.equal(cycle(changed,'2026-12').dueDate,'2026-12-22');
  assert.equal(cycle(changed,'2026-10'),null);
});
test('cross-cycle move replaces November with one December reminder and allows another edit', () => {
  const original = init({today:'2026-11-20', dueDay:20, amount:money(2000)});
  const changed = editSchedule(original, { dueDay:6, cycleMove:{fromMonth:'2026-11', toDate:'2026-12-06'} });
  assert.equal(cycle(changed,'2026-11'),null);
  assert.equal(cycle(changed,'2026-12').dueDate,'2026-12-06');
  assert.equal(cycle(changed,'2027-01').dueDate,'2027-01-06');
  const savedAgain = editSchedule(changed, { dueDay:6, cycleMove:{fromMonth:'2026-11', toDate:'2026-12-06'} });
  assert.deepEqual(savedAgain, changed);
  const revised = editSchedule(changed, { dueDay:8 });
  assert.equal(cycle(revised,'2026-11'),null);
  assert.equal(cycle(revised,'2026-12').dueDate,'2026-12-08');
});
test('legacy bill without schedule metadata can move its current reminder', () => {
  const changed = editSchedule(undefined, {
    legacyDueDay:20, cycleMove:{fromMonth:'2026-11', toDate:'2026-12-06'},
  });
  assert.equal(cycle(changed,'2026-11'),null);
  assert.equal(cycle(changed,'2026-12').dueDate,'2026-12-06');
});
test('a first unpaid future cycle can move earlier if the new day is still upcoming', () => {
  const original = init({today:'2026-11-20', dueDay:6, amount:money(2000)});
  const changed = editSchedule(original, {
    dueDay:25, cycleMove:{fromMonth:'2026-12', toDate:'2026-11-25'},
  });
  assert.equal(cycle(changed,'2026-11').dueDate,'2026-11-25');
  assert.equal(cycle(changed,'2026-12').dueDate,'2026-12-25');
});
test('moving to a short month preserves the requested due day without duplicating the reminder', () => {
  const original = init({today:'2026-02-20', dueDay:25, amount:money(2000)});
  const changed = editSchedule(original, {
    today:'2026-02-20', dueDay:31, cycleMove:{fromMonth:'2026-02', toDate:'2026-02-28'},
  });
  assert.equal(cycle(changed,'2026-02').dueDate,'2026-02-28');
  assert.equal(cycle(changed,'2026-03').dueDate,'2026-03-31');
});
test('an explicitly moved immediately overdue cycle can be placed in the current month', () => {
  const original = init({today:'2026-11-20', dueDay:20, amount:money(2000)});
  const changed = editSchedule(original, { today:'2026-12-01', dueDay:6, cycleMove:{fromMonth:'2026-11', toDate:'2026-12-06'} });
  assert.equal(cycle(changed,'2026-11'),null);
  assert.equal(cycle(changed,'2026-12').dueDate,'2026-12-06');
  assert.equal(changed.acknowledgedPaidCycles.length,0);
});
test('an advance payment keeps its linked due date when the recurring day changes', () => {
  const original = init({today:'2026-11-20', dueDay:20, amount:money(2000)});
  const changed = editSchedule(original, { protectedDueDays:{'2026-12':20} });
  assert.equal(cycle(changed,'2026-11').dueDate,'2026-11-20');
  assert.equal(cycle(changed,'2026-12').dueDate,'2026-12-20');
  assert.equal(cycle(changed,'2027-01').dueDate,'2027-01-06');
  assert.throws(() => editSchedule(original, {
    protectedDueDays:{'2026-12':20}, cycleMove:{fromMonth:'2026-11', toDate:'2026-12-06'},
  }), /recorded payment activity/);
});
test('acknowledged cycles are preserved and cannot be moved', () => {
  const acknowledged = init({today:'2026-11-20', dueDay:20, amount:money(2000), paidToday:true});
  assert.throws(() => editSchedule(acknowledged, { dueDay:6, cycleMove:{fromMonth:'2026-11', toDate:'2026-12-06'} }), /acknowledged/);
  assert.deepEqual(acknowledged.acknowledgedPaidCycles, ['2026-11']);
  assert.throws(() => validateObligationSchedule({ ...acknowledged, cycleDueDayOverrides:{'2026-11':null} }));
});
test('cycle moves reject invalid dates, backward months, and dates before today', () => {
  const original = init({today:'2026-11-20', dueDay:20, amount:money(2000)});
  assert.throws(() => editSchedule(original, { cycleMove:{fromMonth:'2026-11', toDate:'2026-10-06'} }));
  assert.throws(() => editSchedule(original, { cycleMove:{fromMonth:'2026-11', toDate:'2026-11-19'} }));
  assert.throws(() => editSchedule(original, { cycleMove:{fromMonth:'2026-11', toDate:'2026-02-30'} }));
  assert.throws(() => editSchedule(original, { cycleMove:{fromMonth:'2026-09', toDate:'2026-11-20'} }));
  assert.throws(() => editSchedule(original, { cycleMove:{fromMonth:'2026-11', toDate:'2027-01-06'} }));
  assert.throws(() => validateObligationSchedule({ ...original, cycleDueDayOverrides:{'2026-10':6} }));
  assert.throws(() => validateObligationSchedule({ ...original, cycleDueDayOverrides:{'2026-11':32} }));
});

test('prepareObligationEditorSchedule restores suppressed current-month cycle for bills and debts', () => {
  for (const kind of ['bill', 'debt']) {
    const original = init({ today: '2026-11-20', dueDay: 25, amount: money(2000) });
    const suppressed = prepareObligationEditorSchedule({
      kind, id: 'ob-1', today: '2026-11-20', dueDay: 6, amount: money(2000),
      createdAt: '2026-11-01T00:00:00Z', isNew: false, existing: original,
      cycleMove: { fromMonth: '2026-11', toDate: '2026-12-06' },
    });
    assert.equal(cycle(suppressed, '2026-11'), null);

    // Reverting to original due day omits empty cycleDueDayOverrides cleanly
    const reverted = prepareObligationEditorSchedule({
      kind, id: 'ob-1', today: '2026-11-21', dueDay: 25, amount: money(2000),
      createdAt: '2026-11-01T00:00:00Z', isNew: false, existing: suppressed,
      restoreSuppressedCycle: { month: '2026-11', dueDay: 25 },
    });
    assert.equal(reverted.cycleDueDayOverrides, undefined);
    assert.equal(cycle(reverted, '2026-11')?.dueDate, '2026-11-25');
    assert.equal(cycle(reverted, '2026-12')?.dueDate, '2026-12-25');

    // Restoring to a different due day than the 2026-11 term stores a per-cycle override
    const changedRestore = prepareObligationEditorSchedule({
      kind, id: 'ob-1', today: '2026-11-21', dueDay: 22, amount: money(2000),
      createdAt: '2026-11-01T00:00:00Z', isNew: false, existing: suppressed,
      restoreSuppressedCycle: { month: '2026-11', dueDay: 22 },
    });
    assert.equal(cycle(changedRestore, '2026-11')?.dueDate, '2026-11-22');
    assert.equal(cycle(changedRestore, '2026-12')?.dueDate, '2026-12-22');
  }
});

test('chooseObligationDueDateEdit prompts before skipping current month and restores reverted due dates for bills and debts', async () => {
  const baseBill = { ...bill, id: 'bill-1', dueDay: 25, createdAt: '2026-10-01T00:00:00Z' };
  const baseDebt = {
    id: 'debt-1', name: 'Card', category: 'Credit card', balance: 1000, originalBalance: 1000,
    minimumPayment: 50, apr: 18, dueDay: 25, creditLimit: 2000,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  };

  try {
    for (const targetKind of ['bill', 'debt']) {
      const key = targetKind === 'bill' ? 'bill:bill-1' : 'debt:debt-1';
      const activeSchedule = init({ today: '2026-10-01', dueDay: 25, amount: money(2000) });
      const baseData = {
        debts: targetKind === 'debt' ? [baseDebt] : [],
        loanBillPairingByDebtId: {},
        obligationSchedules: { [key]: activeSchedule },
      };
      const targetArg = targetKind === 'bill' ? { bill: baseBill } : { debt: baseDebt };

      // Same-month move stays automatic (no Alert)
      let alertCalls = [];
      globalThis.__obligationAlertMock = (title, message, buttons) => {
        alertCalls.push({ title, message, buttons });
      };
      const sameMonth = await chooseObligationDueDateEdit({
        current: baseData, today: '2026-11-20', dueDay: 22, currencyCode: 'USD',
        transactions: [], recurringBills: targetKind === 'bill' ? [baseBill] : [], ...targetArg,
      });
      assert.equal(alertCalls.length, 0);
      assert.deepEqual(sameMonth.cycleMove, { fromMonth: '2026-11', toDate: '2026-11-22' });

      // Moving to an earlier day in the current month prompts via Alert: Keep vs Move
      globalThis.__obligationAlertMock = (title, message, buttons) => {
        alertCalls.push({ title, message, buttons });
        buttons.find(b => b.text.startsWith('Keep')).onPress();
      };
      const keptCurrent = await chooseObligationDueDateEdit({
        current: baseData, today: '2026-11-20', dueDay: 6, currencyCode: 'USD',
        transactions: [], recurringBills: targetKind === 'bill' ? [baseBill] : [], ...targetArg,
      });
      assert.equal(alertCalls.length, 1);
      assert.equal(alertCalls[0].title, 'Skip this month’s due date?');
      assert.equal(keptCurrent.cycleMove, undefined);

      alertCalls = [];
      globalThis.__obligationAlertMock = (title, message, buttons) => {
        alertCalls.push({ title, message, buttons });
        buttons.find(b => b.text.startsWith('Move to')).onPress();
      };
      const movedNext = await chooseObligationDueDateEdit({
        current: baseData, today: '2026-11-20', dueDay: 6, currencyCode: 'USD',
        transactions: [], recurringBills: targetKind === 'bill' ? [baseBill] : [], ...targetArg,
      });
      assert.equal(alertCalls.length, 1);
      assert.deepEqual(movedNext.cycleMove, { fromMonth: '2026-11', toDate: '2026-12-06' });

      // Suppressed current month + reverting to dueDay >= today restores automatically
      const suppressedSchedule = prepareObligationEditorSchedule({
        kind: targetKind, id: targetKind === 'bill' ? 'bill-1' : 'debt-1',
        today: '2026-11-20', dueDay: 6, amount: money(2000),
        createdAt: '2026-11-01T00:00:00Z', isNew: false, existing: activeSchedule,
        cycleMove: movedNext.cycleMove,
      });
      const suppressedData = { ...baseData, obligationSchedules: { [key]: suppressedSchedule } };

      alertCalls = [];
      globalThis.__obligationAlertMock = (title, message, buttons) => {
        alertCalls.push({ title, message, buttons });
      };
      const autoRestored = await chooseObligationDueDateEdit({
        current: suppressedData, today: '2026-11-21', dueDay: 25, currencyCode: 'USD',
        transactions: [], recurringBills: targetKind === 'bill' ? [baseBill] : [], ...targetArg,
      });
      assert.equal(alertCalls.length, 0);
      assert.deepEqual(autoRestored.restoreSuppressedCycle, { month: '2026-11', dueDay: 25 });

      // Suppressed current month + reverting to dueDay < today prompts Keep skipped vs Restore
      globalThis.__obligationAlertMock = (title, message, buttons) => {
        alertCalls.push({ title, message, buttons });
        buttons.find(b => b.text === 'Keep skipped').onPress();
      };
      const keptSkipped = await chooseObligationDueDateEdit({
        current: suppressedData, today: '2026-11-21', dueDay: 18, currencyCode: 'USD',
        transactions: [], recurringBills: targetKind === 'bill' ? [baseBill] : [], ...targetArg,
      });
      assert.equal(alertCalls.length, 1);
      assert.equal(alertCalls[0].title, 'Restore this month’s due date?');
      assert.equal(keptSkipped.restoreSuppressedCycle, undefined);

      alertCalls = [];
      globalThis.__obligationAlertMock = (title, message, buttons) => {
        alertCalls.push({ title, message, buttons });
        buttons.find(b => b.text.startsWith('Restore ')).onPress();
      };
      const confirmedRestore = await chooseObligationDueDateEdit({
        current: suppressedData, today: '2026-11-21', dueDay: 18, currencyCode: 'USD',
        transactions: [], recurringBills: targetKind === 'bill' ? [baseBill] : [], ...targetArg,
      });
      assert.equal(alertCalls.length, 1);
      assert.deepEqual(confirmedRestore.restoreSuppressedCycle, { month: '2026-11', dueDay: 18 });
    }
  } finally {
    delete globalThis.__obligationAlertMock;
  }
});
