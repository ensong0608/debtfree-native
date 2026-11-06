import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentMatchesObligation } from '../src/finance/payment-matching.ts';
import { calculateActivitySummary, calculateAccountActivities, calculateMilestones } from '../src/finance/progress.ts';
import { reconcilePendingTransactionRows } from '../src/finance/storage-domain.ts';
import { makeMoney } from '../src/finance/money.ts';
import { parseDateOnly } from '../src/finance/calendar.ts';

const pending = {
  id: 'payment-1', accountId: 'account-a', date: parseDateOnly('2026-11-06'),
  appliesToDate: parseDateOnly('2026-11-20'), amount: makeMoney('USD', 50000),
  category: 'payment', payee: 'Bank', source: 'manual', reconciled: false,
  createdAt: '2026-11-06T12:00:00Z', deletedAt: null, isPending: true,
};

test('P1: payments require exact account/bill and due-cycle identity', () => {
  const debtTarget = { kind: 'debt', accountId: 'account-a', dueDate: '2026-11-20' };
  assert.equal(paymentMatchesObligation(pending, debtTarget), false);
  assert.equal(paymentMatchesObligation(pending, debtTarget, true), true);
  assert.equal(paymentMatchesObligation({ ...pending, isPending: false }, { ...debtTarget, accountId: 'account-b' }), false);
  assert.equal(paymentMatchesObligation({ ...pending, isPending: false }, { ...debtTarget, dueDate: '2026-12-20' }), false);
  assert.equal(paymentMatchesObligation({ ...pending, isPending: false }, debtTarget), true);
  const billTarget = { kind: 'bill', dueDate: '2026-11-20', billId: 'electricity' };
  assert.equal(paymentMatchesObligation({ ...pending, isPending: false }, billTarget), false);
  const billPayment = { ...pending, id: 'bill:electricity:2026-11-20', category: 'debit_bill', accountId: null };
  assert.equal(paymentMatchesObligation({ ...billPayment, isPending: false }, billTarget), true);
  assert.equal(paymentMatchesObligation({ ...billPayment, isPending: false }, { ...billTarget, billId: 'water' }), false);
});

test('P1: pending payments do not count towards confirmed Progress metrics or awards', () => {
  const debts = [{ id: 'account-a', name: 'Card', category: 'Credit card', balance: 0, originalBalance: 500, creditLimit: 2000 }];
  const activity = calculateActivitySummary({ transactions: [pending], debts, period: 'current_month', today: '2026-11-06' });
  assert.equal(activity.totalPayments, 0);
  assert.equal(activity.transactionsCount, 0);
  assert.equal(activity.accountsPaidOffCount, 0);
  const perAccount = calculateAccountActivities({ transactions: [pending], debts, period: 'current_month', today: '2026-11-06' });
  assert.equal(perAccount[0].payments, 0);
  assert.equal(perAccount[0].transactionCount, 0);
  const milestones = calculateMilestones({ debts, transactions: [pending] });
  assert.equal(milestones.find(m => m.id === 'first_payment').status, 'in_progress');
  assert.equal(milestones.find(m => m.id === 'first_debt_cleared').status, 'locked');
  assert.equal(milestones.find(m => m.id === 'progress_100').status, 'locked');
});

test('P1: lost RPC response is confirmed by authoritative readback, not by replay', () => {
  const intent = {
    id: 'payment-1', user_id: 'u1', account_id: 'acc-1', date: '2026-11-06',
    applies_to_date: '2026-11-20', amount: '500.00', category: 'payment',
    payee: 'Bank', memo: null, source: 'manual', reconciled: false,
    created_at: '2026-11-06T12:00:00Z', updated_at: '2026-11-06T12:00:00Z', deleted_at: null,
  };
  const remote = { ...intent, amount: '500.0000', created_at: '2026-11-06T12:00:01Z', updated_at: '2026-11-06T12:00:01Z' };
  const merged = reconcilePendingTransactionRows([remote], { [intent.id]: intent });
  assert.deepEqual(merged.confirmedIds, [intent.id]);
  assert.deepEqual(merged.unresolved, {});
  assert.deepEqual(merged.rows, [remote]);
  const conflict = reconcilePendingTransactionRows([{ ...remote, amount: '250.00' }], { [intent.id]: intent });
  assert.deepEqual(conflict.confirmedIds, []);
  assert.ok(conflict.unresolved[intent.id]);
  assert.equal(conflict.rows[0].amount, '500.00');
});
