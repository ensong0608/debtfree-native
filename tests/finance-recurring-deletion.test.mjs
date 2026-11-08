import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBillIdFromTxId, extractBillIdsFromMemo } from '../src/finance/payment-matching.ts';
import { createRecurringBillDeletionPreview, executeRecurringBillRemoval, shouldDismissRecurringBillEditor } from '../src/finance/recurring-bills.ts';

const bill = {
  id: 'bill-a', name: 'Internet', category: 'utilities', amount: { currency: 'USD', minorUnits: 7000 },
  dueDay: 5, paymentMethod: 'debit', autoPost: false, active: true,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-11-06T10:00:00Z',
};
const tx = (id, date, options = {}) => ({
  id, accountId: null, date, amount: { currency: 'USD', minorUnits: 7000 },
  category: 'debit_bill', payee: 'Internet', source: 'manual', reconciled: false,
  createdAt: `${date}T12:00:00Z`, deletedAt: null, ...options,
});

test('canonical bill linkage accepts punctuation and cycle markers without matching similar IDs', () => {
  assert.equal(extractBillIdFromTxId('bill:bill-a:2026-12-05'), 'bill-a');
  assert.deepEqual([...extractBillIdsFromMemo('Paid ([bill:bill-a:2026-12-05]), confirmed')], ['bill-a']);
  assert.deepEqual([...extractBillIdsFromMemo('ref bill:bill-a:2026-12-05, paid')], ['bill-a']);
  assert.equal(extractBillIdsFromMemo('([bill:bill-ab:2026-12-05])').has('bill-a'), false);
  assert.equal(extractBillIdFromTxId('bill:bill-ab:2026-12-05'), 'bill-ab');
});

test('deletion preview removes only future-dated rows assigned to future cycles and discloses preserved payments', () => {
  const today = '2026-11-07';
  const transactions = [
    tx('bill:bill-a:2026-12-05', '2026-12-05', { accountId: 'card-1', category: 'payment', appliesToDate: '2026-12-05' }),
    tx('manual-punctuation', '2026-12-08', { memo: 'Paid ([bill:bill-a:2026-12-05]).' }),
    tx('recorded-today', today, { memo: 'Payment [bill:bill-a]', appliesToDate: '2026-12-05' }),
    tx('recorded-yesterday', '2026-11-06', { id: 'bill:bill-a:2027-01-05', appliesToDate: '2027-01-05' }),
    tx('future-for-past-cycle', '2026-11-10', { memo: '[bill:bill-a]', appliesToDate: '2026-11-01' }),
    tx('similar-bill', '2026-12-09', { id: 'bill:bill-ab:2026-12-09' }),
    tx('deleted-row', '2026-12-10', { id: 'bill:bill-a:2026-12-10', deletedAt: '2026-11-06T00:00:00Z' }),
  ];
  const debts = [{ id: 'card-1', category: 'Credit card', balance: 123.45, serverVersion: 9, updatedAt: '2026-11-07T00:00:00Z' }];
  const preview = createRecurringBillDeletionPreview({ transactions, bill, debts, ownerId: 'user-1', asOfDate: today });
  assert.deepEqual(preview.transactionsToDelete.map(row => row.id), ['bill:bill-a:2026-12-05', 'manual-punctuation']);
  assert.deepEqual(preview.preservedPrepayments.map(row => row.id).sort(), ['bill:bill-a:2027-01-05', 'recorded-today']);
  assert.deepEqual(preview.preservedFutureDatedPastCycle.map(row => row.id), ['future-for-past-cycle']);
  assert.equal(preview.hasPendingLinkedTransaction, false);
});

test('review token changes with owner, linked row revision, bill revision, or debt balance revision', () => {
  const baseParams = {
    transactions: [tx('bill:bill-a:2026-12-05', '2026-12-05', { accountId: 'card-1', category: 'payment', updatedAt: 'rev-1' })],
    bill, debts: [{ id: 'card-1', category: 'Credit card', balance: 100, serverVersion: 2, updatedAt: 'debt-rev-2' }],
    ownerId: 'user-1', asOfDate: '2026-11-07',
  };
  const token = createRecurringBillDeletionPreview(baseParams).snapshotToken;
  assert.notEqual(createRecurringBillDeletionPreview({ ...baseParams, ownerId: 'user-2' }).snapshotToken, token);
  assert.notEqual(createRecurringBillDeletionPreview({ ...baseParams, transactions: [{ ...baseParams.transactions[0], updatedAt: 'rev-2' }] }).snapshotToken, token);
  assert.notEqual(createRecurringBillDeletionPreview({ ...baseParams, transactions: [...baseParams.transactions, tx('bill:bill-a:2027-01-05', '2027-01-05')] }).snapshotToken, token);
  assert.notEqual(createRecurringBillDeletionPreview({ ...baseParams, bill: { ...bill, updatedAt: 'bill-rev-2' } }).snapshotToken, token);
  assert.notEqual(createRecurringBillDeletionPreview({ ...baseParams, debts: [{ ...baseParams.debts[0], balance: 99, serverVersion: 3 }] }).snapshotToken, token);
});

test('pending recurring-bill deletion keeps the bill visible until server confirmation', async () => {
  const result = await executeRecurringBillRemoval({
    session: {}, userId: 'user-1', billId: bill.id, currentBills: [bill],
    storage: { persist: async () => { throw new Error('unused'); }, remove: async () => ({ data: bill.id, outcome: 'pending' }) },
  });
  assert.deepEqual(result.bills, [bill]);
  assert.equal(result.syncResult.outcome, 'pending');
  assert.equal(shouldDismissRecurringBillEditor({ status: 'pending', billDeleted: false }), false);
  assert.equal(shouldDismissRecurringBillEditor({ status: 'partial', billDeleted: false }), false);
  assert.equal(shouldDismissRecurringBillEditor({ status: 'partial', billDeleted: true }), true);
  assert.equal(shouldDismissRecurringBillEditor({ status: 'confirmed', billDeleted: true }), true);
});
