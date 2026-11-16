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
  assert.deepEqual(h.state.rpcCalls[0].acceptedConflictIds, ['transactions:tx']);
  assert.deepEqual(h.state.rpcCalls[0].keptCurrentConflictIds, []);
  assert.equal(h.state.rpcCalls[0].confirmFullReplacement, false);

  const keepCurrent = harness({ current, rpc: successfulReceipt });
  const kept = await keepCurrent.service.restore(fixture(), { operationId: 'op-kept', mode: 'merge', keptCurrentConflictIds: ['transactions:tx'] });
  assert.equal(kept.status, 'confirmed');
  assert.equal(keepCurrent.state.rpcCalls[0].snapshot.transactions[0].payee, 'Card');
  assert.deepEqual(keepCurrent.state.rpcCalls[0].acceptedConflictIds, []);
  assert.deepEqual(keepCurrent.state.rpcCalls[0].keptCurrentConflictIds, ['transactions:tx']);
  assert.equal(keepCurrent.state.rpcCalls[0].confirmFullReplacement, false);
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

test('recovers and upgrades legacy checkpoints even when settingsRevision differs', async () => {
  const legacyFingerprint = 'a'.repeat(64);
  const incoming = fixture();
  incoming.onboardingData.settingsRevision = 2;
  const before = fixture();
  before.onboardingData.settingsRevision = 9;
  const acceptedKeys = [`onboardingData:${owner.userId}`];

  // Case 1: late receipt arrives under the legacy fingerprint
  const lateRecovery = harness({
    current: before,
    receipt: async (operationId) => operationId === 'op-legacy-late'
      ? { operationId, payloadFingerprint: legacyFingerprint, restoredSnapshot: clone(incoming) }
      : null,
  });
  await lateRecovery.repo.begin(owner, before, incoming, {
    operationId: 'op-legacy-late',
    baselineToken: 'baseline-legacy',
    payloadFingerprint: legacyFingerprint,
    resolutionMode: 'merge',
    acceptedConflictIds: acceptedKeys,
    keptCurrentConflictIds: [],
  });
  await lateRecovery.repo.update(owner, { status: 'failed', cursor: 0, error: 'network lost' });

  const recovered = await lateRecovery.service.restore(incoming, {
    operationId: 'op-legacy-late',
    mode: 'merge',
    acceptedConflictIds: acceptedKeys,
  });
  assert.equal(recovered.status, 'confirmed');
  assert.equal(recovered.recoveredAfterLostResponse, true);
  assert.equal(lateRecovery.state.rpcCalls.length, 0);

  // Case 2: no legacy receipt yet -> upgrades checkpoint to v2 and keeps legacyPayloadFingerprint
  const upgrade = harness({
    current: before,
    receipt: async () => null,
    rpc: successfulReceipt,
  });
  await upgrade.repo.begin(owner, before, incoming, {
    operationId: 'op-legacy-upgrade',
    baselineToken: 'baseline-legacy',
    payloadFingerprint: legacyFingerprint,
    resolutionMode: 'merge',
    acceptedConflictIds: acceptedKeys,
    keptCurrentConflictIds: [],
  });
  await upgrade.repo.update(owner, { status: 'failed', cursor: 0, error: 'network lost' });

  const upgraded = await upgrade.service.restore(incoming, {
    operationId: 'op-legacy-upgrade',
    mode: 'merge',
    acceptedConflictIds: acceptedKeys,
  });
  assert.equal(upgraded.status, 'confirmed');
  assert.equal(upgraded.recoveredAfterLostResponse, false);
  assert.equal(upgrade.state.rpcCalls.length, 1);
  assert.notEqual(upgrade.state.rpcCalls[0].payloadFingerprint, legacyFingerprint);
  assert.deepEqual(upgrade.state.rpcCalls[0].acceptedConflictIds, acceptedKeys);
  const savedCheckpoint = await upgrade.repo.load(owner);
  assert.equal(savedCheckpoint.requestVersion, 2);
  assert.equal(savedCheckpoint.legacyPayloadFingerprint, legacyFingerprint);
  assert.equal(savedCheckpoint.status, 'completed');
});

test('prunes archivedPaidOffDebtIds on merge when onboardingData and debts conflict on zero balance', async () => {
  const incoming = fixture();
  incoming.onboardingData.debts[0].balance = 0;
  incoming.onboardingData.archivedPaidOffDebtIds = ['debt'];
  const current = fixture();
  current.onboardingData.debts[0].balance = 100;
  const h = harness({ current, rpc: successfulReceipt });

  const result = await h.service.restore(incoming, {
    operationId: 'op-merge-archive-prune',
    mode: 'merge',
    acceptedConflictIds: [`onboardingData:${owner.userId}`],
    keptCurrentConflictIds: ['debts:debt'],
  });
  assert.equal(result.status, 'confirmed');
  assert.equal(h.state.rpcCalls.length, 1);
  assert.deepEqual(h.state.rpcCalls[0].acceptedConflictIds, [`onboardingData:${owner.userId}`]);
  assert.deepEqual(h.state.rpcCalls[0].keptCurrentConflictIds, ['debts:debt']);
});

test('recovers legacy v1 checkpoint without resolutionMode or sorted conflict IDs', async () => {
  const legacyFingerprint = 'b'.repeat(64);
  const incoming = fixture();
  incoming.transactions[0].payee = 'Backup Payee';
  incoming.onboardingData.extraMonthlyPayment = 25;
  const before = fixture();
  const keysInOrder = [`onboardingData:${owner.userId}`, 'transactions:tx'];
  const unsortedKeys = ['transactions:tx', `onboardingData:${owner.userId}`];

  const h = harness({
    current: before,
    receipt: async (operationId) => operationId === 'op-legacy-no-mode'
      ? { operationId, payloadFingerprint: legacyFingerprint, restoredSnapshot: clone(incoming) }
      : null,
  });
  await h.repo.begin(owner, before, incoming, {
    operationId: 'op-legacy-no-mode',
    baselineToken: 'baseline-legacy-2',
    payloadFingerprint: legacyFingerprint,
    acceptedConflictIds: unsortedKeys,
    keptCurrentConflictIds: [],
  });
  await h.repo.update(owner, { status: 'failed', cursor: 0, error: 'lost response' });

  const recovered = await h.service.restore(incoming, {
    operationId: 'op-legacy-no-mode',
    mode: 'merge',
    acceptedConflictIds: keysInOrder,
  });
  assert.equal(recovered.status, 'confirmed');
  assert.equal(recovered.recoveredAfterLostResponse, true);
  assert.equal(h.state.rpcCalls.length, 0);
});

test('binds v2 restore requests to householdId and membershipVersion and blocks non-owners', async () => {
  const memberHarness = harness({ authOwner: { ...owner, membershipVersion: '3', role: 'member' }, rpc: successfulReceipt });
  const denied = await memberHarness.service.restore(fixture(), { operationId: 'op-member', mode: 'merge' });
  assert.equal(denied.status, 'rejected');
  assert.match(denied.message, /owner/);
  assert.equal(memberHarness.state.reads, 0);
  assert.equal(memberHarness.state.rpcCalls.length, 0);

  const ownerHarness = harness({ authOwner: { ...owner, membershipVersion: '3', role: 'owner' }, rpc: successfulReceipt });
  const confirmed = await ownerHarness.service.restore(fixture(), { operationId: 'op-owner-v2', mode: 'merge' });
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(ownerHarness.state.rpcCalls[0].householdId, owner.householdId);
  assert.equal(ownerHarness.state.rpcCalls[0].expectedMembershipVersion, '3');
});

test('rejects silent replay across changed membershipVersion unless prior server receipt is proven', async () => {
  const staleHarness = harness({
    authOwner: { ...owner, membershipVersion: '1', role: 'owner' },
    rpc: async () => { throw new Error('network lost'); },
    receipt: async () => null,
  });
  const first = await staleHarness.service.restore(fixture(), { operationId: 'op-mv-change', mode: 'merge' });
  assert.equal(first.status, 'uncertain');

  let membershipTwoAuthOwner = { ...owner, membershipVersion: '2', role: 'owner' };
  const sameRepoAdapter = {
    getAuthenticatedOwner: async () => membershipTwoAuthOwner,
    readCurrentSnapshot: async () => ({ snapshot: fixture(), token: 'baseline-2' }),
    restoreSnapshot: async () => { throw new Error('must not replay on changed membershipVersion'); },
    findRestoreReceipt: async () => null,
    checkpoints: staleHarness.repo,
  };
  const serviceV2 = createNativeBackupRecovery(sameRepoAdapter);
  const blocked = await serviceV2.restore(fixture(), { operationId: 'op-mv-change', mode: 'merge' });
  assert.equal(blocked.status, 'rejected');
  assert.match(blocked.message, /membership changed/i);
});

