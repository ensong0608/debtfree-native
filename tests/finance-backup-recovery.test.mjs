import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultOnboardingData } from '../src/onboarding-domain.ts';
import { createNativeBackup, createBackupCheckpointRepository } from '../src/finance/backup.ts';
import { createNativeBackupRecovery, RestoreRejectedError } from '../src/finance/backup-recovery.ts';

const owner = { userId: 'user', householdId: 'house' };
const date = '2026-11-07T00:00:00.000Z';
const money = (minorUnits) => ({ currency: 'USD', minorUnits });
const clone = (value) => JSON.parse(JSON.stringify(value));

function fixture(changes = {}) {
  const onboardingData = {
    ...createDefaultOnboardingData(owner.userId), householdId: owner.householdId, currencyCode: 'USD', updatedAt: date,
    debts: [{ id: 'debt', name: 'Card', category: 'Credit card', balance: 100, originalBalance: null, apr: 12, minimumPayment: 10, dueDay: 7, creditLimit: null, createdAt: date, updatedAt: date }],
    obligationSchedules: { 'debt:debt': { firstDueDate: '2026-11-07', acknowledgedPaidCycles: ['2026-11'], terms: [{ effectiveMonth: '2026-11', dueDay: 7, amount: money(1000) }] } },
  };
  return createNativeBackup({
    userId: owner.userId, householdId: owner.householdId, currency: 'USD', exportedAt: date, onboardingData,
    transactions: [{ id: 'tx', accountId: 'debt', date: '2026-11-07', amount: money(1000), category: 'payment', payee: 'Card', source: 'manual', reconciled: true, createdAt: date, deletedAt: null, principalAmount: money(800), interestAmount: money(200) }],
    recurringBills: [{ id: 'bill', name: 'Bill', category: 'utilities', amount: money(500), dueDay: 3, paymentMethod: 'credit', creditAccountId: 'debt', autoPost: true, active: true, createdAt: date }],
    reconciliationAnchors: [{ id: 'anchor', accountId: 'debt', asOfDate: '2026-11-07', verifiedBalance: money(9000), createdAt: date, createdAdjustmentId: null, coveredTransactionIds: ['tx'] }],
    ...changes,
  }, owner);
}

function harness({ current = fixture(), rpc, receipt, authOwner = owner, baselineToken = 'baseline-1' } = {}) {
  const state = { reads: 0, writes: 0, rpcCalls: [], receiptCalls: [], data: new Map() };
  const repo = createBackupCheckpointRepository({ getItem: async (key) => state.data.get(key) ?? null, setItem: async (key, value) => state.data.set(key, value), removeItem: async (key) => state.data.delete(key) });
  const adapter = {
    getAuthenticatedOwner: async () => authOwner,
    readCurrentSnapshot: async () => { state.reads++; return { snapshot: current, token: baselineToken }; },
    restoreSnapshot: rpc ? async (request) => { state.rpcCalls.push(clone(request)); return rpc(request, state); } : undefined,
    findRestoreReceipt: receipt ? async (operationId) => { state.receiptCalls.push(operationId); return receipt(operationId, state); } : undefined,
    checkpoints: repo,
  };
  return { service: createNativeBackupRecovery(adapter), state, repo };
}

const successfulReceipt = (request) => ({ operationId: request.operationId, payloadFingerprint: request.payloadFingerprint, restoredSnapshot: request.snapshot });

test('validates the authenticated owner before reading or writing and refuses unconfirmed replacement', async () => {
  const wrongOwner = harness({ authOwner: { ...owner, userId: 'other' } });
  await assert.rejects(wrongOwner.service.restore(fixture(), { operationId: 'op-1', mode: 'merge' }), /different user/);
  assert.equal(wrongOwner.state.reads, 0);
  assert.equal((await wrongOwner.repo.load(owner)), null);

  const noReplaceConfirmation = harness();
  const result = await noReplaceConfirmation.service.restore(fixture(), { operationId: 'op-2', mode: 'replace' });
  assert.equal(result.status, 'rejected');
  assert.equal(noReplaceConfirmation.state.reads, 0);
  assert.equal(noReplaceConfirmation.state.rpcCalls.length, 0);
});

test('requires an explicit per-conflict choice before checkpointing or RPC', async () => {
  const current = fixture(); current.transactions[0].payee = 'Updated locally';
  const h = harness({ current, rpc: successfulReceipt });
  const blocked = await h.service.restore(fixture(), { operationId: 'op-conflict', mode: 'merge' });
  assert.equal(blocked.status, 'rejected');
  assert.match(blocked.message, /every conflict/);
  assert.equal(h.state.rpcCalls.length, 0);
  assert.equal(await h.repo.load(owner), null);

  const accepted = await h.service.restore(fixture(), { operationId: 'op-accepted', mode: 'merge', acceptedConflictIds: ['transactions:tx'] });
  assert.equal(accepted.status, 'confirmed');
  assert.equal(h.state.rpcCalls[0].snapshot.transactions[0].payee, 'Card');

  const keepCurrent = harness({ current, rpc: successfulReceipt });
  const kept = await keepCurrent.service.restore(fixture(), { operationId: 'op-kept', mode: 'merge', keptCurrentConflictIds: ['transactions:tx'] });
  assert.equal(kept.status, 'confirmed');
  assert.equal(keepCurrent.state.rpcCalls[0].snapshot.transactions[0].payee, 'Updated locally');
});

test('checkpoints before RPC and reports an absent RPC as unavailable', async () => {
  const h = harness();
  const result = await h.service.restore(fixture(), { operationId: 'op-disabled', mode: 'merge' });
  assert.equal(result.status, 'unavailable');
  assert.equal(h.state.rpcCalls.length, 0);
  assert.equal(result.checkpoint.status, 'failed');
  assert.equal(result.checkpoint.operationId, 'op-disabled');
  assert.match(result.message, /RPC is installed and verified/);
});

test('classifies a definitive server rejection and preserves failed checkpoint', async () => {
  const h = harness({ rpc: async () => { throw new RestoreRejectedError('CONCURRENCY_CONFLICT'); } });
  const result = await h.service.restore(fixture(), { operationId: 'op-reject', mode: 'merge' });
  assert.equal(result.status, 'rejected');
  assert.match(result.message, /CONCURRENCY_CONFLICT/);
  assert.equal(result.checkpoint.status, 'failed');
});

test('recovers a lost RPC response from the owner-scoped durable receipt', async () => {
  let requestSeen;
  const h = harness({
    rpc: async (request) => { requestSeen = request; throw new Error('connection dropped after commit'); },
    receipt: async (operationId) => operationId === requestSeen?.operationId ? successfulReceipt(requestSeen) : null,
  });
  const result = await h.service.restore(fixture(), { operationId: 'op-lost', mode: 'merge' });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.recoveredAfterLostResponse, true);
  assert.deepEqual(result.snapshot, requestSeen.snapshot);
  assert.deepEqual(h.state.receiptCalls, ['op-lost']);
  assert.equal((await h.repo.load(owner)).status, 'completed');
});

test('keeps uncertain outcome pending and retries with the same stable operation payload', async () => {
  const requests = [];
  const h = harness({ rpc: async (request) => { requests.push(clone(request)); throw new Error('network timeout'); }, receipt: async () => null });
  const first = await h.service.restore(fixture(), { operationId: 'op-retry', mode: 'merge' });
  assert.equal(first.status, 'uncertain');
  assert.equal(first.checkpoint.status, 'failed');
  assert.equal(first.checkpoint.operationId, 'op-retry');
  const readsBeforeRetry = h.state.reads;
  const second = await h.service.restore(fixture(), { operationId: 'op-retry', mode: 'merge' });
  assert.equal(second.status, 'uncertain');
  assert.equal(h.state.reads, readsBeforeRetry, 'retry reuses the checkpoint baseline');
  assert.equal(requests[0].operationId, requests[1].operationId);
  assert.equal(requests[0].payloadFingerprint, requests[1].payloadFingerprint);
  assert.deepEqual(requests[0].snapshot, requests[1].snapshot);
});

test('returns the server authoritative snapshot on confirmed restore', async () => {
  const authoritative = fixture(); authoritative.transactions[0].updatedAt = date;
  const h = harness({ rpc: async (request) => successfulReceipt({ ...request, snapshot: authoritative }) });
  const result = await h.service.restore(fixture(), { operationId: 'op-ok', mode: 'replace', confirmFullReplacement: true });
  assert.equal(result.status, 'confirmed');
  assert.deepEqual(result.snapshot, authoritative);
  assert.equal((await h.repo.load(owner)).status, 'completed');
});
