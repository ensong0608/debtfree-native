import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  encodeTransactionRow,
  decodeTransactionRow,
  encodeRecurringBillRow,
  decodeRecurringBillRow,
  encodeReconciliationAnchorRow,
  decodeReconciliationAnchorRow,
  mergeFinanceRowsWithPendingWrites,
} = require('../src/finance/storage-domain.ts');
const { makeMoney } = require('../src/finance/money.ts');
const { parseDateOnly } = require('../src/finance/calendar.ts');

test('encode and decode transactions roundtrip across multiple currencies', () => {
  const currencies = [
    { code: 'USD', units: 12550, wire: '125.50' },
    { code: 'JPY', units: 1500, wire: '1500' },
    { code: 'KWD', units: 1234, wire: '1.234' },
    { code: 'CLF', units: 12345, wire: '1.2345' },
  ];

  for (const c of currencies) {
    const original = {
      id: `tx-${c.code.toLowerCase()}-1`,
      accountId: 'debt-card-1',
      date: parseDateOnly('2026-11-05'),
      appliesToDate: parseDateOnly('2026-12-05'),
      amount: makeMoney(c.code, c.units),
      category: 'purchase',
      payee: 'Local Grocery',
      memo: 'Groceries for the week',
      source: 'manual',
      reconciled: false,
      createdAt: '2026-11-05T12:00:00.000Z',
      deletedAt: null,
    };

    const encoded = encodeTransactionRow(original, 'usr-test-123', 'hh-456');
    assert.equal(encoded.amount, c.wire);
    assert.equal(encoded.user_id, 'usr-test-123');
    assert.equal(encoded.household_id, 'hh-456');
    assert.equal(encoded.account_id, 'debt-card-1');
    assert.equal(encoded.category, 'purchase');
    assert.equal(encoded.applies_to_date, '2026-12-05');
    assert.equal(encoded.payee, 'Local Grocery');

    // Simulate SQL numeric padding (e.g. numeric(18, 4) might return '125.5000' or '1500.0000')
    const padded = {
      ...encoded,
      amount: c.code === 'JPY' ? '1500.0000' : c.wire + '00',
    };

    const decoded = decodeTransactionRow(padded, c.code);
    assert.equal(decoded.id, original.id);
    assert.equal(decoded.accountId, original.accountId);
    assert.equal(decoded.date, original.date);
    assert.equal(decoded.appliesToDate, original.appliesToDate);
    assert.equal(decoded.amount.currency, c.code);
    assert.equal(decoded.amount.minorUnits, c.units);
    assert.equal(decoded.category, original.category);
    assert.equal(decoded.payee, original.payee);
    assert.equal(decoded.memo, original.memo);
    assert.equal(decoded.source, original.source);
    assert.equal(decoded.reconciled, original.reconciled);
    assert.equal(decoded.deletedAt, null);
  }
});

test('cashflow debit transactions support null accountId', () => {
  const debitTx = {
    id: 'tx-debit-1',
    accountId: null,
    date: parseDateOnly('2026-11-03'),
    amount: makeMoney('USD', 6500),
    category: 'debit_bill',
    payee: 'Internet Service Provider',
    memo: 'Home fiber',
    source: 'recurring_bill',
    reconciled: false,
    createdAt: '2026-11-03T10:00:00.000Z',
    deletedAt: null,
  };

  const encoded = encodeTransactionRow(debitTx, 'usr-1');
  assert.equal(encoded.account_id, null);
  assert.equal(encoded.category, 'debit_bill');

  const decoded = decodeTransactionRow(encoded, 'USD');
  assert.equal(decoded.accountId, null);
  assert.equal(decoded.category, 'debit_bill');
  assert.equal(decoded.amount.minorUnits, 6500);
});

test('online row refresh preserves pending local updates and deletions', () => {
  const remote = [{ id: 'tx-a', amount: '10.00' }, { id: 'tx-b', amount: '20.00' }];
  const pending = {
    'tx-a': { id: 'tx-a', amount: '11.00' },
    'tx-b': null,
    'tx-local': { id: 'tx-local', amount: '30.00' },
  };
  assert.deepEqual(mergeFinanceRowsWithPendingWrites(remote, pending), [
    { id: 'tx-a', amount: '11.00' },
    { id: 'tx-local', amount: '30.00' },
  ]);
});

test('soft-deleted transactions preserve deletedAt timestamp', () => {
  const deletedTx = {
    id: 'tx-deleted-1',
    accountId: 'debt-1',
    date: parseDateOnly('2026-10-15'),
    amount: makeMoney('USD', 5000),
    category: 'payment',
    payee: 'Card Payment',
    source: 'manual',
    reconciled: true,
    createdAt: '2026-10-15T10:00:00.000Z',
    deletedAt: '2026-10-16T14:30:00.000Z',
  };

  const encoded = encodeTransactionRow(deletedTx, 'usr-1');
  assert.equal(encoded.deleted_at, '2026-10-16T14:30:00.000Z');

  const decoded = decodeTransactionRow(encoded, 'USD');
  assert.equal(decoded.deletedAt, '2026-10-16T14:30:00.000Z');
});

test('transaction decoding rejects invalid categories or sources', () => {
  const base = {
    id: 'tx-bad',
    user_id: 'usr-1',
    account_id: 'd-1',
    date: '2026-11-01',
    amount: '50.00',
    category: 'unauthorized_crypto_spend',
    payee: 'Unknown',
    memo: null,
    source: 'manual',
    reconciled: false,
    created_at: '2026-11-01T00:00:00Z',
    deleted_at: null,
  };

  assert.throws(() => decodeTransactionRow(base, 'USD'), /Invalid transaction category/);

  const badSource = { ...base, category: 'payment', source: 'hacked_source' };
  assert.throws(() => decodeTransactionRow(badSource, 'USD'), /Invalid transaction source/);
});

test('recurring bills encoding and decoding roundtrips with payment method routing', () => {
  const debitBill = {
    id: 'bill-debit-1',
    name: 'Electric & Gas',
    category: 'utilities',
    amount: makeMoney('USD', 14500),
    dueDay: 15,
    paymentMethod: 'debit',
    autoPost: true,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const creditBill = {
    id: 'bill-credit-1',
    name: 'Streaming Service',
    category: 'subscription',
    amount: makeMoney('USD', 1999),
    dueDay: 28,
    paymentMethod: 'credit',
    creditAccountId: 'card-chase-sapphire',
    autoPost: true,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const encodedDebit = encodeRecurringBillRow(debitBill, 'usr-1');
  assert.equal(encodedDebit.payment_method, 'debit');
  assert.equal(encodedDebit.credit_account_id, null);
  assert.equal(encodedDebit.amount, '145.00');

  const decodedDebit = decodeRecurringBillRow(encodedDebit, 'USD');
  assert.equal(decodedDebit.paymentMethod, 'debit');
  assert.equal(decodedDebit.creditAccountId, undefined);
  assert.equal(decodedDebit.amount.minorUnits, 14500);

  const encodedCredit = encodeRecurringBillRow(creditBill, 'usr-1');
  assert.equal(encodedCredit.payment_method, 'credit');
  assert.equal(encodedCredit.credit_account_id, 'card-chase-sapphire');
  assert.equal(encodedCredit.amount, '19.99');

  const decodedCredit = decodeRecurringBillRow(encodedCredit, 'USD');
  assert.equal(decodedCredit.paymentMethod, 'credit');
  assert.equal(decodedCredit.creditAccountId, 'card-chase-sapphire');
  assert.equal(decodedCredit.amount.minorUnits, 1999);
});

test('reconciliation anchors preserve positive liability and negative credit balances', () => {
  const liabilityAnchor = {
    id: 'anchor-1',
    accountId: 'debt-card-1',
    asOfDate: parseDateOnly('2026-11-01'),
    verifiedBalance: makeMoney('USD', 450000), // $4,500.00 debt owed
    note: 'October statement balance',
    createdAt: '2026-11-01T15:00:00.000Z',
  };

  const creditBalanceAnchor = {
    id: 'anchor-2',
    accountId: 'debt-card-2',
    asOfDate: parseDateOnly('2026-11-01'),
    verifiedBalance: makeMoney('USD', -2500), // -$25.00 credit balance (overpayment)
    note: 'Account in credit surplus',
    createdAt: '2026-11-01T15:00:00.000Z',
  };

  const enc1 = encodeReconciliationAnchorRow(liabilityAnchor, 'usr-1');
  assert.equal(enc1.verified_balance, '4500.00');
  const dec1 = decodeReconciliationAnchorRow(enc1, 'USD');
  assert.equal(dec1.verifiedBalance.minorUnits, 450000);

  const enc2 = encodeReconciliationAnchorRow(creditBalanceAnchor, 'usr-1');
  assert.equal(enc2.verified_balance, '-25.00');
  const dec2 = decodeReconciliationAnchorRow(enc2, 'USD');
  assert.equal(dec2.verifiedBalance.minorUnits, -2500);
});

test('transaction encoding and decoding maintains billing cycle independently of posting date', () => {
  // Advance payment made on 2026-11-20 for 2026-12-05 cycle
  const advancePayment = {
    id: 'tx-advance-1',
    accountId: 'debt-card-1',
    date: parseDateOnly('2026-11-20'),
    appliesToDate: parseDateOnly('2026-12-05'),
    amount: makeMoney('USD', 20000),
    category: 'payment',
    payee: 'Card Payment Early',
    memo: 'Paid ahead of time',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-20T10:00:00.000Z',
    deletedAt: null,
  };

  const encoded = encodeTransactionRow(advancePayment, 'usr-1');
  assert.equal(encoded.date, '2026-11-20');
  assert.equal(encoded.applies_to_date, '2026-12-05');

  const decoded = decodeTransactionRow(encoded, 'USD');
  assert.equal(decoded.date, '2026-11-20');
  assert.equal(decoded.appliesToDate, '2026-12-05');
  assert.notEqual(decoded.date, decoded.appliesToDate);

  // Late payment made on 2026-12-10 for 2026-12-05 cycle
  const latePayment = {
    ...advancePayment,
    id: 'tx-late-1',
    date: parseDateOnly('2026-12-10'),
    appliesToDate: parseDateOnly('2026-12-05'),
  };
  const encodedLate = encodeTransactionRow(latePayment, 'usr-1');
  assert.equal(encodedLate.date, '2026-12-10');
  assert.equal(encodedLate.applies_to_date, '2026-12-05');
  const decodedLate = decodeTransactionRow(encodedLate, 'USD');
  assert.equal(decodedLate.date, '2026-12-10');
  assert.equal(decodedLate.appliesToDate, '2026-12-05');
});

test('offline write merge preserves local updates, creations, and deletions against remote snapshot', () => {
  const remoteSnapshot = [
    { id: 'tx-1', amount: '50.00', category: 'purchase' },
    { id: 'tx-2', amount: '100.00', category: 'purchase' },
    { id: 'tx-3', amount: '150.00', category: 'purchase' },
  ];

  const pendingWrites = {
    'tx-1': { id: 'tx-1', amount: '55.00', category: 'purchase' }, // Local update
    'tx-2': null, // Local deletion (tombstone)
    'tx-new-offline': { id: 'tx-new-offline', amount: '25.00', category: 'payment' }, // Local new item
  };

  const merged = mergeFinanceRowsWithPendingWrites(remoteSnapshot, pendingWrites);
  const byId = new Map(merged.map(r => [r.id, r]));

  assert.equal(merged.length, 3);
  assert.equal(byId.get('tx-1').amount, '55.00'); // updated
  assert.equal(byId.has('tx-2'), false); // deleted
  assert.equal(byId.get('tx-3').amount, '150.00'); // untouched remote
  assert.equal(byId.get('tx-new-offline').amount, '25.00'); // offline created
});
