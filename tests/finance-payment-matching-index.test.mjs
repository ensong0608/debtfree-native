import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTransactionObligationIndex,
  calculateOverdueObligations,
  findUnassignedPaymentsForObligation,
  getObligationPaymentState,
  getScheduledObligationRows,
  matchPaymentsToObligation,
  paymentMatchesObligation,
} from '../src/finance/payment-matching.ts';
import { makeMoney } from '../src/finance/money.ts';

function makeTx(patch) {
  return {
    id: 'tx:default',
    accountId: null,
    date: '2026-11-10',
    appliesToDate: null,
    amount: makeMoney('USD', 10000),
    category: 'payment',
    payee: 'Payment',
    memo: '',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-10T00:00:00Z',
    deletedAt: null,
    isPending: false,
    ...patch,
  };
}

test('indexed obligation matching preserves exact parity with full-scan matching across aliases, links, pending, and duplicate bill tags', () => {
  const debts = [
    {
      id: 'card-1',
      name: 'Sapphire',
      category: 'Credit card',
      balance: 2400,
      originalBalance: 3000,
      minimumPayment: 120,
      apr: 19.99,
      dueDay: 15,
      creditLimit: 5000,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
    {
      id: 'loan-1',
      name: 'Auto Loan',
      category: 'Auto loan',
      balance: 9500,
      originalBalance: 15000,
      minimumPayment: 400,
      apr: 4.5,
      dueDay: 20,
      creditLimit: null,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
  ];

  const bills = [
    {
      id: 'bill-util',
      name: 'Electric',
      category: 'utilities',
      amount: makeMoney('USD', 15000),
      dueDay: 12,
      paymentMethod: 'debit',
      active: true,
      autoPost: false,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
    {
      id: 'bill-cc',
      name: 'Streaming',
      category: 'subscription',
      amount: makeMoney('USD', 2000),
      dueDay: 18,
      paymentMethod: 'credit',
      creditAccountId: 'card-1',
      active: true,
      autoPost: false,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
  ];

  const transactions = [
    // Card minimum paid early with appliesToDate in Nov while date is Oct
    makeTx({
      id: 'tx:card-early',
      accountId: 'card-1',
      date: '2026-10-30',
      appliesToDate: '2026-11-15',
      amount: makeMoney('USD', 8000),
      category: 'payment',
    }),
    // Pending card payment for remaining $40
    makeTx({
      id: 'tx:card-pending',
      accountId: 'card-1',
      date: '2026-11-12',
      appliesToDate: '2026-11-15',
      amount: makeMoney('USD', 4000),
      category: 'payment',
      isPending: true,
    }),
    // Debit bill paid with BOTH tx.id bill prefix AND memo tag (must not double count)
    makeTx({
      id: 'bill:bill-util:2026-11-12',
      accountId: null,
      date: '2026-11-11',
      appliesToDate: '2026-11-12',
      amount: makeMoney('USD', 15000),
      category: 'debit_bill',
      memo: '[bill:bill-util]',
    }),
    // Credit bill charged to card-1
    makeTx({
      id: 'bill:bill-cc:2026-11-18',
      accountId: 'card-1',
      date: '2026-11-18',
      appliesToDate: '2026-11-18',
      amount: makeMoney('USD', 2000),
      category: 'subscription',
      memo: 'Auto-post [bill:bill-cc]',
    }),
    // Unified loan paid via historical bill alias
    makeTx({
      id: 'bill:legacy-auto:2026-11-20',
      accountId: null,
      date: '2026-11-19',
      appliesToDate: '2026-11-20',
      amount: makeMoney('USD', 40000),
      category: 'debit_bill',
      memo: '[bill:legacy-auto]',
    }),
    // Deleted tx that must be ignored
    makeTx({
      id: 'tx:deleted',
      accountId: 'card-1',
      date: '2026-11-05',
      appliesToDate: '2026-11-15',
      amount: makeMoney('USD', 50000),
      deletedAt: '2026-11-06T00:00:00Z',
    }),
  ];

  const obligations = [
    {
      id: 'minimum:card-1',
      kind: 'debt',
      name: 'Sapphire minimum',
      dueDate: '2026-11-15',
      dueCycleMonth: '2026-11',
      requiredAmount: makeMoney('USD', 12000),
      accountId: 'card-1',
      debt: debts[0],
    },
    {
      id: 'bill-util',
      kind: 'bill',
      name: 'Electric',
      dueDate: '2026-11-12',
      dueCycleMonth: '2026-11',
      requiredAmount: makeMoney('USD', 15000),
      billId: 'bill-util',
      bill: bills[0],
    },
    {
      id: 'bill-cc',
      kind: 'bill',
      name: 'Streaming',
      dueDate: '2026-11-18',
      dueCycleMonth: '2026-11',
      requiredAmount: makeMoney('USD', 2000),
      accountId: 'card-1',
      billId: 'bill-cc',
      bill: bills[1],
    },
    {
      id: 'minimum:loan-1',
      kind: 'debt',
      name: 'Auto Loan minimum',
      dueDate: '2026-11-20',
      dueCycleMonth: '2026-11',
      requiredAmount: makeMoney('USD', 40000),
      accountId: 'loan-1',
      debt: debts[1],
      historicalBillIds: ['legacy-auto'],
    },
  ];

  for (const obligation of obligations) {
    const indexedState = getObligationPaymentState(obligation, transactions, 'USD');
    const fullScanConfirmed = matchPaymentsToObligation(obligation, transactions, {
      currencyCode: 'USD',
      includePending: false,
    });
    const fullScanWithPending = matchPaymentsToObligation(obligation, transactions, {
      currencyCode: 'USD',
      includePending: true,
    });

    assert.equal(indexedState.confirmedMatch.totalPaid.minorUnits, fullScanConfirmed.totalPaid.minorUnits);
    assert.equal(indexedState.confirmedMatch.remainingAmount.minorUnits, fullScanConfirmed.remainingAmount.minorUnits);
    assert.equal(indexedState.confirmedMatch.isSatisfied, fullScanConfirmed.isSatisfied);
    assert.equal(indexedState.withPendingMatch.totalPaid.minorUnits, fullScanWithPending.totalPaid.minorUnits);
  }

  const cardState = getObligationPaymentState(obligations[0], transactions, 'USD');
  assert.equal(cardState.status, 'pending_confirmation');
  assert.equal(cardState.pendingAmount.minorUnits, 4000);

  const utilState = getObligationPaymentState(obligations[1], transactions, 'USD');
  assert.equal(utilState.status, 'paid');
  assert.equal(utilState.confirmedMatch.matchedTransactions.length, 1);

  const loanState = getObligationPaymentState(obligations[3], transactions, 'USD');
  assert.equal(loanState.status, 'paid');

  // WeakMap reuses the cached index for the same transactions array
  const idxA = buildTransactionObligationIndex(transactions);
  const idxB = buildTransactionObligationIndex(transactions);
  assert.equal(idxA, idxB);
});

test('multi-year transaction ledgers resolve scheduled and overdue obligations cleanly via cached index', () => {
  const debts = Array.from({ length: 6 }, (_, idx) => ({
    id: `card-${idx}`,
    name: `Card ${idx}`,
    category: 'Credit card',
    balance: 1500,
    originalBalance: 2000,
    minimumPayment: 50,
    apr: 18,
    dueDay: 10 + idx,
    creditLimit: 5000,
    createdAt: '2022-01-01T00:00:00Z',
    updatedAt: '2022-01-01T00:00:00Z',
  }));
  const bills = Array.from({ length: 8 }, (_, idx) => ({
    id: `bill-${idx}`,
    name: `Bill ${idx}`,
    category: 'utilities',
    amount: makeMoney('USD', 6000),
    dueDay: 5 + idx,
    paymentMethod: 'debit',
    active: true,
    autoPost: false,
    createdAt: '2022-01-01T00:00:00Z',
    updatedAt: '2022-01-01T00:00:00Z',
  }));

  // Generate 5 years (~60 months) of payments & purchases = ~4,800 transactions
  const transactions = [];
  for (let year = 2022; year <= 2026; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const ym = `${year}-${String(month).padStart(2, '0')}`;
      for (let d = 0; d < debts.length; d += 1) {
        transactions.push(
          makeTx({
            id: `tx:p:${d}:${ym}`,
            accountId: `card-${d}`,
            date: `${ym}-${String(10 + d).padStart(2, '0')}`,
            amount: makeMoney('USD', 5000),
            category: 'payment',
          }),
          makeTx({
            id: `tx:s:${d}:${ym}`,
            accountId: `card-${d}`,
            date: `${ym}-03`,
            amount: makeMoney('USD', 2500),
            category: 'purchase',
          }),
        );
      }
      for (let b = 0; b < bills.length; b += 1) {
        transactions.push(
          makeTx({
            id: `bill:bill-${b}:${ym}-${String(5 + b).padStart(2, '0')}`,
            accountId: null,
            date: `${ym}-${String(5 + b).padStart(2, '0')}`,
            amount: makeMoney('USD', 6000),
            category: 'debit_bill',
          }),
        );
      }
    }
  }

  const overdue = calculateOverdueObligations({
    debts,
    recurringBills: bills,
    transactions,
    asOfDate: '2026-11-18',
    currencyCode: 'USD',
  });
  assert.equal(overdue.length, 0);

  const scheduled = getScheduledObligationRows({
    debts,
    recurringBills: bills,
    transactions,
    asOfDate: '2026-11-18',
    currencyCode: 'USD',
  });
  assert.equal(scheduled.length, (debts.length + bills.length) * 12);
});

test('findUnassignedPaymentsForObligation surfaces manual bill charges and same-month moved debt payments while excluding foreign bill tags', () => {
  const cardBillObligation = {
    id: 'bill-cc',
    kind: 'bill',
    name: 'Netflix',
    dueDate: '2026-11-20',
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 1599),
    accountId: 'card-1',
    billId: 'bill-cc',
  };
  const debitBillObligation = {
    id: 'bill-debit',
    kind: 'bill',
    name: 'Water Utility',
    dueDate: '2026-11-22',
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 4200),
    accountId: null,
    billId: 'bill-debit',
  };
  const debtObligation = {
    id: 'minimum:card-1',
    kind: 'debt',
    name: 'Sapphire',
    dueDate: '2026-11-25',
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 12000),
    accountId: 'card-1',
  };

  const ccAmountMatch = makeTx({
    id: 'tx:cc-amt',
    accountId: 'card-1',
    date: '2026-11-12',
    amount: makeMoney('USD', 1599),
    category: 'subscription',
    payee: 'Streaming Co',
    memo: 'Monthly charge',
  });
  const ccForeignMemo = makeTx({
    id: 'tx:cc-foreign',
    accountId: 'card-1',
    date: '2026-11-12',
    amount: makeMoney('USD', 1599),
    category: 'subscription',
    payee: 'Netflix',
    memo: 'Payment [bill:other-bill]',
  });
  const ccRepaymentIgnored = makeTx({
    id: 'tx:cc-repay',
    accountId: 'card-1',
    date: '2026-11-12',
    amount: makeMoney('USD', 1599),
    category: 'payment',
    payee: 'Netflix',
  });
  const debitAmountMatch = makeTx({
    id: 'tx:debit-amt',
    accountId: null,
    date: '2026-11-14',
    amount: makeMoney('USD', 4200),
    category: 'debit_bill',
    payee: 'City Services',
    memo: 'Nov cycle',
  });
  const debitForeignMemo = makeTx({
    id: 'tx:debit-foreign',
    accountId: null,
    date: '2026-11-14',
    amount: makeMoney('USD', 4200),
    category: 'debit_bill',
    payee: 'Water Utility',
    memo: '[bill:different-bill]',
  });
  const movedDebtPayment = makeTx({
    id: 'tx:debt-moved',
    accountId: 'card-1',
    date: '2026-11-10',
    appliesToDate: '2026-11-10',
    amount: makeMoney('USD', 12000),
    category: 'payment',
    payee: 'Payment',
  });
  const otherMonthDebtPayment = makeTx({
    id: 'tx:debt-oct',
    accountId: 'card-1',
    date: '2026-10-10',
    appliesToDate: '2026-10-10',
    amount: makeMoney('USD', 12000),
    category: 'payment',
    payee: 'Payment',
  });

  const allTxs = [
    ccAmountMatch,
    ccForeignMemo,
    ccRepaymentIgnored,
    debitAmountMatch,
    debitForeignMemo,
    movedDebtPayment,
    otherMonthDebtPayment,
  ];

  assert.deepEqual(
    findUnassignedPaymentsForObligation(cardBillObligation, allTxs).map(tx => tx.id),
    ['tx:cc-amt'],
  );
  assert.deepEqual(
    findUnassignedPaymentsForObligation(debitBillObligation, allTxs).map(tx => tx.id),
    ['tx:debit-amt'],
  );
  assert.deepEqual(
    findUnassignedPaymentsForObligation(debtObligation, allTxs).map(tx => tx.id),
    ['tx:cc-repay', 'tx:debt-moved'],
  );

  // Confirm matching marks each obligation paid
  const matchedCc = { ...ccAmountMatch, appliesToDate: cardBillObligation.dueDate, memo: `${ccAmountMatch.memo} [bill:${cardBillObligation.billId}]` };
  const matchedDebit = { ...debitAmountMatch, appliesToDate: debitBillObligation.dueDate, memo: `${debitAmountMatch.memo} [bill:${debitBillObligation.billId}]` };
  const matchedDebt = { ...movedDebtPayment, appliesToDate: debtObligation.dueDate };
  assert.equal(paymentMatchesObligation(matchedCc, cardBillObligation), true);
  assert.equal(getObligationPaymentState(cardBillObligation, [matchedCc], 'USD').status, 'paid');
  assert.equal(paymentMatchesObligation(matchedDebit, debitBillObligation), true);
  assert.equal(getObligationPaymentState(debitBillObligation, [matchedDebit], 'USD').status, 'paid');
  assert.equal(paymentMatchesObligation(matchedDebt, debtObligation), true);
  assert.equal(getObligationPaymentState(debtObligation, [matchedDebt], 'USD').status, 'paid');
});
