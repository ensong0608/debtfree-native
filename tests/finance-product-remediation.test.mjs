import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareObligationEditorSchedule, shouldAskPaidToday } from '../src/finance/obligation-editor-domain.ts';
import { initializeObligationSchedule, getObligationCycle, obligationScheduleKey } from '../src/finance/obligation-schedule.ts';
import { calculateOverdueObligations, createDebtMinimumPaymentTransaction, getScheduledObligationRows, paymentMatchesObligation } from '../src/finance/payment-matching.ts';
import { summarizeSinglePurchases } from '../src/finance/budget.ts';
import { makeMoney } from '../src/finance/money.ts';
import { createDefaultOnboardingData } from '../src/onboarding-domain.ts';
import { acceptOnboardingSnapshot } from '../src/onboarding-snapshot.ts';

const money = minorUnits => makeMoney('USD', minorUnits);

test('first tracking an older debt starts today-forward; due today supports acknowledgement', () => {
  const base = { kind: 'debt', id: 'older', today: '2026-11-07', createdAt: '2026-06-10T12:00:00Z', isNew: false, amount: money(5000) };
  const dayOne = prepareObligationEditorSchedule({ ...base, dueDay: 1 });
  assert.equal(dayOne.firstDueDate, '2026-12-01');
  const debt = { id: 'older', name: 'Older debt', category: 'Credit card', balance: 1000, minimumPayment: 50, dueDay: 1, createdAt: base.createdAt };
  assert.deepEqual(calculateOverdueObligations({ debts: [debt], recurringBills: [], transactions: [], asOfDate: '2026-11-07', currencyCode: 'USD', schedules: { 'debt:older': dayOne } }), []);

  assert.equal(shouldAskPaidToday({ dueDay: 7, today: '2026-11-07', isNew: false, legacyDueDay: null, hasSchedule: false }), true);
  const acknowledged = prepareObligationEditorSchedule({ ...base, dueDay: 7, paidToday: true });
  assert.equal(acknowledged.firstDueDate, '2026-11-07');
  assert.equal(getObligationCycle(acknowledged, '2026-11').acknowledgedPaid, true);
  const notAcknowledged = prepareObligationEditorSchedule({ ...base, dueDay: 7, paidToday: false });
  assert.equal(getObligationCycle(notAcknowledged, '2026-11').acknowledgedPaid, false);
  assert.equal(shouldAskPaidToday({ dueDay: 7, today: '2026-11-07', isNew: false, legacyDueDay: 7, hasSchedule: false }), false);
});

test('editing or re-enabling a real prior schedule retains its history', () => {
  const original = initializeObligationSchedule({ today: '2026-06-10', dueDay: 1, amount: money(3000) });
  const edited = prepareObligationEditorSchedule({ kind: 'debt', id: 'known', today: '2026-11-07', dueDay: 5, amount: money(4000), createdAt: '2026-06-10T12:00:00Z', isNew: false, legacyDueDay: 1, existing: original });
  assert.equal(getObligationCycle(edited, '2026-07').dueDate, '2026-07-01');
  assert.equal(getObligationCycle(edited, '2026-12').dueDate, '2026-12-05');
});

test('payment matching distinguishes current and next debt minimum cycles', () => {
  const debt = { id: 'card-1', name: 'Card', category: 'Credit card', balance: 500, minimumPayment: 50, dueDay: 7, createdAt: '2026-01-01T00:00:00Z' };
  const obligation = month => ({ id: 'minimum:card-1', kind: 'debt', dueDate: `${month}-07`, dueCycleMonth: month, requiredAmount: money(5000), accountId: debt.id, debt });
  const payment = { id: 'tx:nov', accountId: debt.id, date: '2026-11-07', amount: money(5000), category: 'payment', payee: 'Card', source: 'manual', reconciled: false, createdAt: '2026-11-07T12:00:00Z', deletedAt: null };
  assert.equal(paymentMatchesObligation(payment, obligation('2026-11')), true);
  assert.equal(paymentMatchesObligation(payment, obligation('2026-12')), false);
  assert.equal(paymentMatchesObligation({ ...payment, id: 'tx:dec', date: '2026-11-07', appliesToDate: '2026-12-07' }, obligation('2026-12')), true);
  assert.equal(paymentMatchesObligation({ ...payment, id: 'tx:assigned-dec', date: '2026-11-07', appliesToDate: '2026-12-07' }, obligation('2026-11')), false);
});

test('Scheduled rows include cycle-aware debt minimums, retain settlement states, and deduplicate overdue current cycles', () => {
  const debt = { id: 'card-1', name: 'Card', category: 'Credit card', balance: 500, minimumPayment: 50, dueDay: 7, createdAt: '2026-01-01T00:00:00Z' };
  const schedule = initializeObligationSchedule({ today: '2026-11-01', dueDay: 7, amount: money(5000) });
  const tx = { id: 'tx:partial', accountId: debt.id, date: '2026-11-08', appliesToDate: '2026-11-07', amount: money(2000), category: 'payment', payee: 'Card', source: 'manual', reconciled: false, createdAt: '2026-11-08T12:00:00Z', deletedAt: null };
  const rows = getScheduledObligationRows({ debts: [debt], recurringBills: [], transactions: [tx], asOfDate: '2026-11-08', currencyCode: 'USD', schedules: { [obligationScheduleKey('debt', debt.id)]: schedule } });
  const current = rows.filter(row => row.kind === 'debt' && row.dueCycleMonth === '2026-11');
  assert.equal(current.length, 1);
  assert.equal(current[0].id, 'debt:minimum:card-1:2026-11-07');
  assert.equal(current[0].state.status, 'partially_paid');
  assert.equal(current[0].state.confirmedMatch.remainingAmount.minorUnits, 3000);
  assert.equal(rows.find(row => row.kind === 'debt' && row.dueCycleMonth === '2026-12').state.status, 'unpaid');
  const pending = getScheduledObligationRows({ debts: [debt], recurringBills: [], transactions: [{ ...tx, id: 'tx:pending', isPending: true, amount: money(1000) }], asOfDate: '2026-11-08', currencyCode: 'USD', schedules: { [obligationScheduleKey('debt', debt.id)]: schedule } });
  assert.equal(pending.find(row => row.dueCycleMonth === '2026-11').state.status, 'pending_confirmation');
});

test('Scheduled debt minimum recording uses remaining amount, today, and due cycle without guessed loan allocation', () => {
  const debt = { id: 'auto-1', name: 'Auto loan', category: 'Auto loan', balance: 5000, minimumPayment: 300, dueDay: 12, createdAt: '2026-01-01T00:00:00Z' };
  const tx = createDebtMinimumPaymentTransaction({ id: 'tx:scheduled', debt, today: '2026-11-07', dueDate: '2026-11-12', amount: money(12000), createdAt: '2026-11-07T12:00:00Z' });
  assert.equal(tx.category, 'payment');
  assert.equal(tx.accountId, 'auto-1');
  assert.equal(tx.date, '2026-11-07');
  assert.equal(tx.appliesToDate, '2026-11-12');
  assert.equal(tx.amount.minorUnits, 12000);
  assert.equal(tx.principalAmount, undefined);
  assert.equal(tx.interestAmount, undefined);
});

test('Budget single purchase summary includes standalone checking spending only', () => {
  const base = { id: 'purchase', accountId: null, date: '2026-11-03', amount: money(1250), category: 'debit_spending', payee: 'Market', source: 'manual', reconciled: false, createdAt: '2026-11-03T00:00:00Z', deletedAt: null };
  const rows = [base, { ...base, id: 'bill:abc:2026-11-03' }, { ...base, id: 'memo', memo: '[bill:abc]' }, { ...base, id: 'pending', isPending: true }, { ...base, id: 'deleted', deletedAt: '2026-11-04T00:00:00Z' }, { ...base, id: 'recurring', source: 'recurring_bill' }, { ...base, id: 'other', date: '2026-10-31' }];
  const result = summarizeSinglePurchases(rows, '2026-11', 'USD');
  assert.deepEqual(result.items.map(tx => tx.id), ['purchase']);
  assert.equal(result.total, 12.5);
});

test('settings snapshots advance monotonically without resurrecting deleted debts or regressing known newer rows', () => {
  const older = { ...createDefaultOnboardingData('user-1'), settingsRevision: 4, debts: [
    { id: 'keep', name: 'Current', serverVersion: 8 }, { id: 'deleted', name: 'Deleted', serverVersion: 2 },
  ] };
  const newer = { ...older, settingsRevision: 6, debts: [{ id: 'keep', name: 'Stale row', serverVersion: 7 }] };
  const accepted = acceptOnboardingSnapshot(older, newer);
  assert.equal(accepted.debts[0].name, 'Current');
  assert.deepEqual(accepted.debts.map(debt => debt.id), ['keep']);
  assert.equal(acceptOnboardingSnapshot(accepted, { ...older, settingsRevision: 5 }).settingsRevision, 6);
  assert.equal(acceptOnboardingSnapshot(accepted, { ...older, settingsRevision: 5 }).debts[0].name, 'Current');
});
