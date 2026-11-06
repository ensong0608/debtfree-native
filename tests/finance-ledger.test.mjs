import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyCategoryDirection,
  validateLedgerTransaction,
  applyTransactionToBalance,
  calculateReconciledBalance,
  createReconciliationAnchor,
} from '../src/finance/ledger.ts';
import { makeMoney, moneyFromMajor, moneyToMajor, parseMoney } from '../src/finance/money.ts';
import { parseDateOnly } from '../src/finance/calendar.ts';

test('T-024: Category classification assigns correct economic direction', () => {
  // Debt increases
  assert.equal(classifyCategoryDirection('purchase'), 'increase_debt');
  assert.equal(classifyCategoryDirection('subscription'), 'increase_debt');
  assert.equal(classifyCategoryDirection('utilities'), 'increase_debt');
  assert.equal(classifyCategoryDirection('interest'), 'increase_debt');
  assert.equal(classifyCategoryDirection('fee'), 'increase_debt');
  assert.equal(classifyCategoryDirection('annual_fee'), 'increase_debt');
  assert.equal(classifyCategoryDirection('interest_adjustment'), 'increase_debt');
  assert.equal(classifyCategoryDirection('balance_adjustment'), 'increase_debt');

  // Debt decreases
  assert.equal(classifyCategoryDirection('payment'), 'decrease_debt');
  assert.equal(classifyCategoryDirection('refund'), 'decrease_debt');
  assert.equal(classifyCategoryDirection('credit_adjustment'), 'decrease_debt');

  // Cashflow only ($0 debt impact)
  assert.equal(classifyCategoryDirection('debit_bill'), 'cash_only');
  assert.equal(classifyCategoryDirection('debit_spending'), 'cash_only');
});

test('major-unit transaction and reconciliation inputs use the currency minor-unit scale', () => {
  for (const [currency, major, expectedMinor] of [
    ['JPY', 123, 123],
    ['USD', 12.34, 1234],
    ['KWD', 1.234, 1234],
    ['CLF', 1.2345, 12345],
  ]) {
    const money = moneyFromMajor(major, currency);
    assert.equal(money.minorUnits, expectedMinor);
    assert.equal(moneyToMajor(money), major);
  }
});

test('T-024: Transaction validation enforces invariants', () => {
  const validTx = {
    id: 'tx-1',
    accountId: 'chase-card',
    date: parseDateOnly('2026-11-05'),
    amount: makeMoney('USD', 5000), // $50.00
    category: 'purchase',
    payee: 'Grocery Store',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-05T12:00:00Z',
    deletedAt: null,
  };

  assert.doesNotThrow(() => validateLedgerTransaction(validTx));

  // Cashflow cannot target a debt account ID
  const invalidCashflow = {
    ...validTx,
    category: 'debit_bill',
    accountId: 'chase-card',
  };
  assert.throws(() => validateLedgerTransaction(invalidCashflow), /Cashflow category/);

  // Debt category requires account ID
  const invalidDebt = {
    ...validTx,
    category: 'payment',
    accountId: null,
  };
  assert.throws(() => validateLedgerTransaction(invalidDebt), /requires a non-empty accountId/);

  // Negative transaction magnitude is rejected
  const negativeAmount = {
    ...validTx,
    amount: { currency: 'USD', minorUnits: -500 },
  };
  assert.throws(() => validateLedgerTransaction(negativeAmount), /non-negative/);
});

test('T-024: Applying single transactions to debt balance preserves accounting truth', () => {
  const initialBalance = parseMoney('1000.00', 'USD', true); // $1,000.00 debt

  // 1. Credit card purchase increases debt
  const purchaseTx = {
    id: 'tx-purchase',
    accountId: 'card-1',
    date: parseDateOnly('2026-11-05'),
    amount: parseMoney('150.50', 'USD'),
    category: 'purchase',
    payee: 'Electronics',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-05T12:00:00Z',
    deletedAt: null,
  };
  const afterPurchase = applyTransactionToBalance(initialBalance, purchaseTx);
  assert.equal(afterPurchase.minorUnits, 115050); // $1,150.50

  // 2. Card payment decreases debt
  const paymentTx = {
    id: 'tx-payment',
    accountId: 'card-1',
    date: parseDateOnly('2026-11-06'),
    amount: parseMoney('400.00', 'USD'),
    category: 'payment',
    payee: 'Monthly Snowball Payment',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-06T12:00:00Z',
    deletedAt: null,
  };
  const afterPayment = applyTransactionToBalance(afterPurchase, paymentTx);
  assert.equal(afterPayment.minorUnits, 75050); // $750.50

  // 3. Debit bill has $0 debt effect
  const debitBillTx = {
    id: 'tx-debit',
    accountId: null,
    date: parseDateOnly('2026-11-07'),
    amount: parseMoney('80.00', 'USD'),
    category: 'debit_bill',
    payee: 'Electric Co (Auto-Pay from Checking)',
    source: 'recurring_bill',
    reconciled: false,
    createdAt: '2026-11-07T12:00:00Z',
    deletedAt: null,
  };
  const afterDebitBill = applyTransactionToBalance(afterPayment, debitBillTx);
  assert.equal(afterDebitBill.minorUnits, 75050); // Completely unchanged!

  // 4. Soft-deleted transaction has no effect
  const deletedTx = {
    ...purchaseTx,
    id: 'tx-deleted',
    deletedAt: '2026-11-08T12:00:00Z',
  };
  const afterDeleted = applyTransactionToBalance(afterPayment, deletedTx);
  assert.equal(afterDeleted.minorUnits, 75050); // Unchanged!
});

test('T-024: Reconciled balance aggregates multiple transactions accurately', () => {
  const openingBalance = parseMoney('2000.00', 'USD', true);
  const accountId = 'card-chase';

  const transactions = [
    {
      id: 'tx-1',
      accountId,
      date: parseDateOnly('2026-11-01'),
      amount: parseMoney('120.00', 'USD'),
      category: 'utilities',
      payee: 'Cell Phone Bill',
      source: 'recurring_bill',
      reconciled: false,
      createdAt: '2026-11-01T10:00:00Z',
      deletedAt: null,
    },
    {
      id: 'tx-2',
      accountId,
      date: parseDateOnly('2026-11-02'),
      amount: parseMoney('15.99', 'USD'),
      category: 'subscription',
      payee: 'Streaming App',
      source: 'recurring_bill',
      reconciled: false,
      createdAt: '2026-11-02T10:00:00Z',
      deletedAt: null,
    },
    {
      id: 'tx-3',
      accountId,
      date: parseDateOnly('2026-11-03'),
      amount: parseMoney('300.00', 'USD'),
      category: 'payment',
      payee: 'Bank Payment',
      source: 'manual',
      reconciled: false,
      createdAt: '2026-11-03T10:00:00Z',
      deletedAt: null,
    },
    {
      id: 'tx-4-other-account',
      accountId: 'auto-loan',
      date: parseDateOnly('2026-11-04'),
      amount: parseMoney('450.00', 'USD'),
      category: 'payment',
      payee: 'Auto Loan Payment',
      source: 'manual',
      reconciled: false,
      createdAt: '2026-11-04T10:00:00Z',
      deletedAt: null,
    },
  ];

  const result = calculateReconciledBalance({
    openingBalance,
    transactions,
    accountId,
  });

  // Opening: 2000.00
  // Charges: 120.00 + 15.99 = 135.99
  // Payments: 300.00
  // Net change: 135.99 - 300.00 = -164.01
  // Final balance: 2000.00 - 164.01 = 1835.99
  assert.equal(result.totalCharges.minorUnits, 13599);
  assert.equal(result.totalPayments.minorUnits, 30000);
  assert.equal(result.netChange.minorUnits, -16401);
  assert.equal(result.currentBalance.minorUnits, 183599);
  assert.equal(result.activeTransactionCount, 3);
  assert.equal(result.lastAnchorDate, null);
});

test('T-024: Statement reconciliation anchor calculates positive interest drift adjustment', () => {
  const accountId = 'card-chase';
  const asOfDate = parseDateOnly('2026-11-05');
  const appCalculatedBalance = parseMoney('1835.99', 'USD', true);
  // User checks real bank statement app: actual is $1,850.50 (bank interest drift of +$14.51)
  const bankVerifiedBalance = parseMoney('1850.50', 'USD', true);

  const { newAnchor, adjustmentTransaction } = createReconciliationAnchor({
    accountId,
    asOfDate,
    currentCalculatedBalance: appCalculatedBalance,
    verifiedBalance: bankVerifiedBalance,
    reason: 'interest_adjustment',
  });

  assert.equal(newAnchor.verifiedBalance.minorUnits, 185050);
  assert.equal(newAnchor.asOfDate, asOfDate);
  assert.ok(adjustmentTransaction !== null);
  assert.equal(adjustmentTransaction.category, 'interest_adjustment');
  assert.equal(adjustmentTransaction.amount.minorUnits, 1451); // Exact $14.51 drift
  assert.equal(adjustmentTransaction.source, 'reconciliation');
  assert.equal(adjustmentTransaction.reconciled, true);

  // When calculating balance with the anchor applied, it starts at $1,850.50
  const postAnchorResult = calculateReconciledBalance({
    openingBalance: parseMoney('2000.00', 'USD', true),
    anchor: newAnchor,
    transactions: [],
    accountId,
  });

  assert.equal(postAnchorResult.startingBalance.minorUnits, 185050);
  assert.equal(postAnchorResult.currentBalance.minorUnits, 185050);
  assert.equal(postAnchorResult.lastAnchorDate, asOfDate);
});

test('T-024: Statement reconciliation anchor handles negative credit drift', () => {
  const accountId = 'card-chase';
  const asOfDate = parseDateOnly('2026-11-05');
  const appCalculatedBalance = parseMoney('1850.00', 'USD', true);
  // User checks real bank statement app: actual is $1,820.00 (merchant refund of $30.00)
  const bankVerifiedBalance = parseMoney('1820.00', 'USD', true);

  const { newAnchor, adjustmentTransaction } = createReconciliationAnchor({
    accountId,
    asOfDate,
    currentCalculatedBalance: appCalculatedBalance,
    verifiedBalance: bankVerifiedBalance,
    reason: 'credit_adjustment',
  });

  assert.equal(newAnchor.verifiedBalance.minorUnits, 182000);
  assert.ok(adjustmentTransaction !== null);
  assert.equal(adjustmentTransaction.category, 'credit_adjustment');
  assert.equal(adjustmentTransaction.amount.minorUnits, 3000); // $30.00
});

test('T-024: Perfect reconciliation yields anchor without redundant adjustment transaction', () => {
  const accountId = 'card-chase';
  const asOfDate = parseDateOnly('2026-11-05');
  const exactBalance = parseMoney('1850.00', 'USD', true);

  const { newAnchor, adjustmentTransaction } = createReconciliationAnchor({
    accountId,
    asOfDate,
    currentCalculatedBalance: exactBalance,
    verifiedBalance: exactBalance,
  });

  assert.equal(newAnchor.verifiedBalance.minorUnits, 185000);
  assert.equal(adjustmentTransaction, null); // 0 drift, clean lock!
});

test('T-024: Reconciled balance does not double-count same-day drift adjustment transaction', () => {
  const accountId = 'card-chase';
  const asOfDate = parseDateOnly('2026-11-05');
  const appCalculatedBalance = parseMoney('1835.99', 'USD', true);
  const bankVerifiedBalance = parseMoney('1850.50', 'USD', true); // Drift = +$14.51

  const { newAnchor, adjustmentTransaction } = createReconciliationAnchor({
    accountId,
    asOfDate,
    currentCalculatedBalance: appCalculatedBalance,
    verifiedBalance: bankVerifiedBalance,
    reason: 'interest_adjustment',
  });

  assert.ok(adjustmentTransaction !== null);

  // Older transaction prior to anchor
  const priorTx = {
    id: 'tx-prior',
    accountId,
    date: parseDateOnly('2026-11-01'),
    amount: parseMoney('100.00', 'USD'),
    category: 'purchase',
    payee: 'Old Purchase',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-01T12:00:00Z',
    deletedAt: null,
  };

  // When calculating balance with the full transaction list including the adjustment transaction:
  const resultWithAdj = calculateReconciledBalance({
    openingBalance: parseMoney('2000.00', 'USD', true),
    anchor: newAnchor,
    transactions: [priorTx, adjustmentTransaction],
    accountId,
  });

  // Must equal the verified statement balance ($1,850.50), NOT $1,850.50 + $14.51 ($1,865.01)
  assert.equal(resultWithAdj.currentBalance.minorUnits, 185050);
  assert.equal(resultWithAdj.totalCharges.minorUnits, 0);

  // If a subsequent transaction is made AFTER the anchor is established:
  const subsequentTx = {
    id: 'tx-subsequent',
    accountId,
    date: asOfDate,
    amount: parseMoney('25.00', 'USD'),
    category: 'purchase',
    payee: 'Coffee Shop Post-Statement',
    source: 'manual',
    reconciled: false,
    createdAt: new Date(new Date(newAnchor.createdAt).getTime() + 60000).toISOString(),
    deletedAt: null,
  };

  const resultWithSubsequent = calculateReconciledBalance({
    openingBalance: parseMoney('2000.00', 'USD', true),
    anchor: newAnchor,
    transactions: [priorTx, adjustmentTransaction, subsequentTx],
    accountId,
  });

  // Balance should be $1,850.50 + $25.00 = $1,875.50
  assert.equal(resultWithSubsequent.currentBalance.minorUnits, 187550);
  assert.equal(resultWithSubsequent.totalCharges.minorUnits, 2500);
});

