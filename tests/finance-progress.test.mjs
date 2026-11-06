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
  assert.equal(summary.debtPaidDown, 142.5);
  assert.equal(summary.accountsPaidOffCount, 0);
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

  const firstDebtCleared = milestones.find(m => m.id === 'first_debt_cleared');
  assert.equal(firstDebtCleared.status, 'completed');
  assert.equal(firstDebtCleared.currentValue, 1); // card-1 is at 0 balance

  const first1000 = milestones.find(m => m.id === 'first_1000');
  // Only the $500 payment counts, the $250 reconciliation drift is strictly excluded!
  assert.equal(first1000.currentValue, 500);
  assert.equal(first1000.status, 'in_progress');
  assert.equal(first1000.percent, 50);

  const progress25 = milestones.find(m => m.id === 'progress_25');
  // Starting debt = 1000 + 4000 = 5000. Current = 0 + 2500 = 2500. Reduction = 50%
  assert.equal(progress25.status, 'completed');
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
