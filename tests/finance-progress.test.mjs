import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterTransactionsByPeriod,
  calculateActivitySummary,
  calculateAccountActivities,
  calculateCreditUtilization,
  calculateMilestones,
} from '../src/finance/progress.ts';
import { makeMoney } from '../src/finance/money.ts';
import { parseDateOnly } from '../src/finance/calendar.ts';

test('T-027: filterTransactionsByPeriod filters current, previous, and lifetime correctly', () => {
  const today = parseDateOnly('2026-11-15');
  const txCurrent = {
    id: 'tx-1',
    accountId: 'acc-1',
    date: parseDateOnly('2026-11-04'),
    amount: makeMoney('USD', 5000),
    category: 'payment',
    payee: 'Bank',
    source: 'manual',
    reconciled: true,
    createdAt: '2026-11-04T12:00:00Z',
    deletedAt: null,
  };
  const txPrev = {
    id: 'tx-2',
    accountId: 'acc-1',
    date: parseDateOnly('2026-10-25'),
    amount: makeMoney('USD', 3000),
    category: 'payment',
    payee: 'Bank',
    source: 'manual',
    reconciled: true,
    createdAt: '2026-10-25T12:00:00Z',
    deletedAt: null,
  };
  const txDeleted = {
    ...txCurrent,
    id: 'tx-3',
    deletedAt: '2026-11-05T00:00:00Z',
  };

  const all = [txCurrent, txPrev, txDeleted];

  const current = filterTransactionsByPeriod(all, 'current_month', today);
  assert.equal(current.length, 1);
  assert.equal(current[0].id, 'tx-1');

  const prev = filterTransactionsByPeriod(all, 'previous_month', today);
  assert.equal(prev.length, 1);
  assert.equal(prev[0].id, 'tx-2');

  const lifetime = filterTransactionsByPeriod(all, 'lifetime', today);
  assert.equal(lifetime.length, 2);
});

test('T-027: calculateActivitySummary aggregates payments, interest, fees, and net balance change', () => {
  const today = parseDateOnly('2026-11-15');
  const debts = [
    { id: 'card-1', name: 'Chase', category: 'Credit card', balance: 2000, originalBalance: 3000, creditLimit: 5000 },
  ];
  const txs = [
    {
      id: 'tx-1',
      accountId: 'card-1',
      date: parseDateOnly('2026-11-02'),
      amount: makeMoney('USD', 20000), // $200 payment
      category: 'payment',
      payee: 'Chase',
      source: 'manual',
      reconciled: true,
      createdAt: '2026-11-02T00:00:00Z',
      deletedAt: null,
    },
    {
      id: 'tx-2',
      accountId: 'card-1',
      date: parseDateOnly('2026-11-05'),
      amount: makeMoney('USD', 4500), // $45 interest
      category: 'interest',
      payee: 'Chase Interest',
      source: 'manual',
      reconciled: true,
      createdAt: '2026-11-05T00:00:00Z',
      deletedAt: null,
    },
    {
      id: 'tx-3',
      accountId: 'card-1',
      date: parseDateOnly('2026-11-10'),
      amount: makeMoney('USD', 1250), // $12.50 drift adjustment
      category: 'interest_adjustment',
      payee: 'Statement Reconciliation',
      source: 'reconciliation',
      reconciled: true,
      createdAt: '2026-11-10T00:00:00Z',
      deletedAt: null,
    },
  ];

  const summary = calculateActivitySummary({
    transactions: txs,
    debts,
    period: 'current_month',
    today,
  });

  assert.equal(summary.totalPayments, 200);
  assert.equal(summary.totalInterestAndFees, 45);
  assert.equal(summary.totalAdjustments, 12.5);
  // Charges: 45 interest + 12.50 adjustment = 57.50. Payments: 200. Net change = 57.50 - 200 = -142.50
  assert.equal(summary.netBalanceChange, -142.5);
  assert.equal(summary.debtPaidDown, 200);
  assert.equal(summary.accountsPaidOffCount, null);
  assert.equal(summary.transactionsCount, 3);
});

test('T-027: calculateCreditUtilization evaluates ratio and healthy thresholds', () => {
  const debts = [
    { id: 'card-1', name: 'Card A', category: 'Credit card', balance: 1000, originalBalance: 2000, creditLimit: 5000 },
    { id: 'card-2', name: 'Card B', category: 'Credit card', balance: 500, originalBalance: 1000, creditLimit: 5000 },
    { id: 'loan-1', name: 'Auto Loan', category: 'Auto loan', balance: 8000, originalBalance: 10000, creditLimit: null },
  ];

  const util = calculateCreditUtilization(debts);
  // Total limits: 5000 + 5000 = 10,000. Total used: 1000 + 500 = 1,500.
  // Utilization = 1500 / 10000 = 15.0%
  assert.equal(util.totalLimit, 10000);
  assert.equal(util.totalUsed, 1500);
  assert.equal(util.availableCredit, 8500);
  assert.equal(util.utilizationPercent, 15);
  assert.equal(util.statusBand, 'good');
  assert.equal(util.trackedCardsCount, 2);
  assert.equal(util.totalCardsCount, 2);
});

test('T-027: calculateMilestones rewards real debt reduction and excludes reconciliation drift', () => {
  const debts = [
    { id: 'card-1', name: 'Card A', category: 'Credit card', balance: 0, originalBalance: 1000, creditLimit: 2000 },
    { id: 'card-2', name: 'Card B', category: 'Credit card', balance: 2500, originalBalance: 4000, creditLimit: 5000 },
  ];

  // 1 real payment of $500, and 1 reconciliation drift of $250
  const txs = [
    {
      id: 'tx-pay-1',
      accountId: 'card-2',
      date: parseDateOnly('2026-11-01'),
      amount: makeMoney('USD', 50000), // $500 payment
      category: 'payment',
      payee: 'Card B Payment',
      source: 'manual',
      reconciled: true,
      createdAt: '2026-11-01T00:00:00Z',
      deletedAt: null,
    },
    {
      id: 'tx-recon-1',
      accountId: 'card-2',
      date: parseDateOnly('2026-11-02'),
      amount: makeMoney('USD', 25000), // $250 drift
      category: 'interest_adjustment',
      payee: 'Reconciliation',
      source: 'reconciliation',
      reconciled: true,
      createdAt: '2026-11-02T00:00:00Z',
      deletedAt: null,
    },
  ];

  const milestones = calculateMilestones({ debts, transactions: txs });

  const firstPayment = milestones.find(m => m.id === 'first_payment');
  assert.equal(firstPayment.status, 'completed');
  assert.equal(firstPayment.currentValue, 1);

  assert.equal(milestones.find(m => m.id === 'first_debt_cleared').status, 'locked');
  const first1000 = milestones.find(m => m.id === 'first_1000');
  assert.equal(first1000.currentValue, 500);
  assert.equal(first1000.status, 'in_progress');
  assert.equal(milestones.find(m => m.id === 'progress_25').status, 'locked');
});

test('T-027: calculateAccountActivities breaks down activity per account', () => {
  const debts = [
    { id: 'card-1', name: 'Card A', category: 'Credit card', balance: 1000, originalBalance: 2000, creditLimit: 5000 },
  ];
  const txs = [
    {
      id: 'tx-1',
      accountId: 'card-1',
      date: parseDateOnly('2026-11-05'),
      amount: makeMoney('USD', 10000),
      category: 'payment',
      payee: 'Bank Payment',
      source: 'manual',
      reconciled: false,
      createdAt: '2026-11-05T00:00:00Z',
      deletedAt: null,
    },
  ];

  const breakdown = calculateAccountActivities({
    transactions: txs,
    debts,
    period: 'current_month',
    today: parseDateOnly('2026-11-05'),
  });

  assert.equal(breakdown.length, 1);
  assert.equal(breakdown[0].accountId, 'card-1');
  assert.equal(breakdown[0].payments, 100);
  assert.equal(breakdown[0].charges, 0);
  assert.equal(breakdown[0].transactionCount, 1);
});


test('T-055-P: recorded evidence stays distinct from snapshots, refunds and pending activity', () => {
  const debt = { id: 'a', name: 'Loan', category: 'Auto loan', balance: 0, originalBalance: 1000, creditLimit: null };
  const tx = (id, date, category, amount, extra = {}) => ({ id, accountId: 'a', date: parseDateOnly(date), amount: makeMoney('USD', amount), category, payee: 'Bank', source: 'manual', reconciled: false, createdAt: date + 'T00:00:00Z', deletedAt: null, ...extra });
  const entries = [tx('p', '2026-10-31', 'payment', 10000, { principalAmount: makeMoney('USD', 6000) }), tx('u', '2026-11-01', 'payment', 20000), tx('r', '2026-11-02', 'refund', 3000), tx('c', '2026-11-03', 'credit_adjustment', 7000, { source: 'reconciliation' }), tx('pending', '2026-11-04', 'payment', 90000, { isPending: true })];
  const summary = period => calculateActivitySummary({ debts: [debt], transactions: entries, period, today: parseDateOnly('2026-11-15') });
  assert.equal(summary('previous_month').principalReduction, 60);
  assert.equal(summary('previous_month').accountsPaidOffCount, null);
  assert.equal(summary('current_month').totalPayments, 200);
  assert.equal(summary('current_month').principalReduction, 0);
  assert.equal(summary('current_month').netBalanceChange, -100);
  assert.equal(summary('current_month').accountsPaidOffCount, null);
  assert.equal(summary('lifetime').principalReduction, 60);
  const milestones = calculateMilestones({ debts: [debt], transactions: entries });
  assert.equal(milestones.find(m => m.id === 'first_1000').currentValue, 60);
  assert.equal(milestones.find(m => m.id === 'first_payment').status, 'completed');
  assert.equal(calculateMilestones({ debts: [debt], transactions: entries.slice(2) }).find(m => m.id === 'first_payment').status, 'in_progress');
});


test('T-055-P: payment reduction follows account policy and current utilization is not a payoff event', () => {
  const debts = [
    { id: 'card', name: 'Card', category: 'Credit card', balance: 0, originalBalance: 2000, creditLimit: 1000 },
    { id: 'loan', name: 'Loan', category: 'Personal loan', balance: 0, originalBalance: 2000, creditLimit: null },
    { id: 'auto', name: 'Auto', category: 'Auto loan', balance: 0, originalBalance: 2000, creditLimit: null },
  ];
  const tx = (id, accountId, category, amount, extra = {}) => ({ id, accountId, category, amount: makeMoney('USD', amount), date: parseDateOnly('2026-11-01'), payee: 'Bank', source: 'manual', reconciled: false, createdAt: '2026-11-01T00:00:00Z', deletedAt: null, ...extra });
  const transactions = [tx('card-payment', 'card', 'payment', 40000), tx('loan-payment', 'loan', 'payment', 70000, { principalAmount: makeMoney('USD', 30000) }), tx('auto-payment', 'auto', 'payment', 90000), tx('refund', 'card', 'refund', 50000), tx('correction', 'card', 'credit_adjustment', 90000, { source: 'reconciliation' })];
  const summary = calculateActivitySummary({ debts, transactions, period: 'lifetime', today: parseDateOnly('2026-11-15') });
  assert.equal(summary.totalPayments, 2000);
  assert.equal(summary.debtPaidDown, 700);
  assert.equal(summary.netBalanceChange, -2100);
  const milestones = calculateMilestones({ debts, transactions });
  assert.equal(milestones.length, 8);
  assert.equal(milestones.find(m => m.id === 'first_1000').currentValue, 700);
  assert.equal(milestones.find(m => m.id === 'first_debt_cleared').status, 'locked');
  assert.match(milestones.find(m => m.id === 'progress_100').description, /coverage/);
  assert.equal(milestones.find(m => m.id === 'credit_util_30').status, 'completed');
  assert.match(milestones.find(m => m.id === 'credit_util_30').description, /Current-state/);
});
