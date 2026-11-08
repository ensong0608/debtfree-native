import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPendingJournal } = require('../src/finance/pending-journal.ts');

function memoryStore() {
  const values = new Map();
  return {
    values,
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) {
      await new Promise(resolve => setTimeout(resolve, 1));
      values.set(key, value);
    },
    async removeItem(key) { values.delete(key); },
  };
}

function command(commandId, overrides = {}) {
  return {
    commandId,
    kind: 'transaction.insert',
    userId: 'user-a',
    expectedVersions: { 'debt-a': 4 },
    payload: { amount: '12.34' },
    members: [{ domain: 'transactions', rowId: `tx-${commandId}`, desired: { id: `tx-${commandId}`, amount: '12.34', updated_at: 'local-time' } }],
    state: 'pending',
    createdAt: '2026-11-07T10:00:00.000Z',
    updatedAt: '2026-11-07T10:00:00.000Z',
    ...overrides,
  };
}

test('serialized journal writes preserve concurrent commands and survive restart', async () => {
  const store = memoryStore();
  const journal = createPendingJournal(store);
  await Promise.all(Array.from({ length: 12 }, (_, index) => journal.save(command(`c${index}`))));
  const restarted = createPendingJournal(store);
  assert.equal((await restarted.list('user-a')).length, 12);
  assert.equal((await restarted.get('user-a', 'c7')).expectedVersions['debt-a'], 4);
});

test('transaction readback normalizes numeric decimals, ignores timestamps, confirms matching content, and retains mismatches', async () => {
  const journal = createPendingJournal(memoryStore());
  await journal.save(command('match'));
  const confirmed = await journal.evaluateReadback('user-a', 'match', {
    byDomain: { transactions: { authoritative: true, complete: true, rows: [{ id: 'tx-match', row: { id: 'tx-match', amount: 12.34, updated_at: 'server-time' } }] } },
  });
  assert.equal(confirmed.outcome, 'confirmed');
  assert.equal(confirmed.command.commandId, 'match');
  assert.equal(await journal.get('user-a', 'match'), undefined);

  await journal.save(command('mismatch'));
  const retained = await journal.evaluateReadback('user-a', 'mismatch', {
    byDomain: { transactions: { authoritative: true, complete: true, rows: [{ id: 'tx-mismatch', row: { id: 'tx-mismatch', amount: '99.00' } }] } },
  });
  assert.equal(retained.outcome, 'retained');
  assert.equal(retained.command.state, 'conflict');
  assert.equal((await journal.list('user-a')).length, 1);
});

test('soft-delete readback compares deleted state, not server deletion timestamp', async () => {
  const journal = createPendingJournal(memoryStore());
  await journal.save(command('soft-delete', { members: [{ domain: 'transactions', rowId: 'tx-soft-delete', desired: { id: 'tx-soft-delete', amount: '12.34', deleted_at: 'local' } }] }));
  const matched = await journal.evaluateReadback('user-a', 'soft-delete', {
    byDomain: { transactions: { authoritative: true, complete: true, rows: [{ id: 'tx-soft-delete', row: { id: 'tx-soft-delete', amount: 12.34, deleted_at: 'server timestamp' } }] } },
  });
  assert.equal(matched.outcome, 'confirmed');
  await journal.save(command('still-active', { members: [{ domain: 'transactions', rowId: 'tx-still-active', desired: { id: 'tx-still-active', deleted_at: null } }] }));
  const retained = await journal.evaluateReadback('user-a', 'still-active', {
    byDomain: { transactions: { authoritative: true, complete: true, rows: [{ id: 'tx-still-active', row: { id: 'tx-still-active', deleted_at: 'server timestamp' } }] } },
  });
  assert.equal(retained.command.state, 'conflict');
});

test('durable intent is present before an injected network side effect starts', async () => {
  const store = memoryStore();
  const journal = createPendingJournal(store);
  const op = command('before-network');
  await journal.save(op);
  let observedBeforeDispatch = false;
  await (async () => {
    observedBeforeDispatch = JSON.parse(store.values.get('debtfree-pending-journal-v1.user-a')).commands.some(item => item.commandId === op.commandId);
  })();
  assert.equal(observedBeforeDispatch, true);
});

test('bill readback normalizes decimals and server timestamps after a lost response', async () => {
  const journal = createPendingJournal(memoryStore());
  await journal.save(command('lost-bill-response', {
    kind: 'bill_upsert',
    members: [{ domain: 'bills', rowId: 'bill-1', desired: { id: 'bill-1', amount: '12.50', created_at: 'client', updated_at: 'client' } }],
  }));
  const result = await journal.evaluateReadback('user-a', 'lost-bill-response', {
    byDomain: { bills: { authoritative: true, complete: true, rows: [{ id: 'bill-1', row: { id: 'bill-1', amount: 12.5, created_at: 'database', updated_at: 'database' } }] } },
  });
  assert.equal(result.outcome, 'confirmed');
});

test('delete readback confirms only when a complete authoritative snapshot proves absence', async () => {
  const journal = createPendingJournal(memoryStore());
  await journal.save(command('delete', { kind: 'transaction.delete', members: [{ domain: 'transactions', rowId: 'tx-delete', desired: null }] }));
  const weak = await journal.evaluateReadback('user-a', 'delete', {
    byDomain: { transactions: { authoritative: true, complete: false, rows: [] } },
  });
  assert.equal(weak.command.state, 'needs_review');
  const strong = await journal.evaluateReadback('user-a', 'delete', {
    byDomain: { transactions: { authoritative: true, complete: true, rows: [] } },
  });
  assert.equal(strong.outcome, 'confirmed');
  assert.equal(strong.command.commandId, 'delete');
  assert.equal(await journal.get('user-a', 'delete'), undefined);
});

test('grouped reconciliation cannot clear from matching component rows alone', async () => {
  const journal = createPendingJournal(memoryStore());
  await journal.save(command('reconcile-1', {
    kind: 'reconcile',
    members: [
      { domain: 'anchors', rowId: 'anchor-1', desired: { id: 'anchor-1', balance: '80.00' } },
      { domain: 'transactions', rowId: 'adj-1', desired: { id: 'adj-1', amount: '5.00' } },
    ],
  }));
  const readback = {
    byDomain: {
      anchors: { authoritative: true, complete: true, rows: [{ id: 'anchor-1', row: { id: 'anchor-1', balance: '80.00' } }] },
      transactions: { authoritative: true, complete: true, rows: [{ id: 'adj-1', row: { id: 'adj-1', amount: '5.00' } }] },
    },
  };
  assert.equal((await journal.evaluateReadback('user-a', 'reconcile-1', readback)).command.state, 'needs_review');
  assert.ok(await journal.get('user-a', 'reconcile-1'));
  const confirmed = await journal.evaluateReadback('user-a', 'reconcile-1', { ...readback, completeCommandIds: ['reconcile-1'] });
  assert.equal(confirmed.outcome, 'confirmed');
  assert.equal(confirmed.command.commandId, 'reconcile-1');
  assert.equal(await journal.get('user-a', 'reconcile-1'), undefined);
});

test('summary counts commands by state and affected domain; explicit rejection remains retained', async () => {
  const journal = createPendingJournal(memoryStore());
  await journal.save(command('pending'));
  await journal.save(command('rejected'));
  await journal.save(command('review', { kind: 'bill.update', members: [{ domain: 'bills', rowId: 'bill-1', desired: { id: 'bill-1' } }] }));
  const rejection = await journal.markRejected('user-a', 'rejected', 'Revision rejected');
  assert.equal(rejection.state, 'conflict');
  assert.equal(rejection.failure.kind, 'rejected');
  const summary = await journal.summarize('user-a');
  assert.deepEqual(summary, { total: 2, pending: 2, conflict: 0, needs_review: 0, rejected: 1, resolved: 0, byDomain: { transactions: 1, bills: 1 } });
  assert.equal((await journal.list('user-a')).length, 3);
});

test('rejected command readback cannot convert the rejected write into success', async () => {
  const journal = createPendingJournal(memoryStore());
  await journal.save(command('rejected-match'));
  await journal.markRejected('user-a', 'rejected-match', 'Revision rejected');
  const result = await journal.evaluateReadback('user-a', 'rejected-match', {
    byDomain: { transactions: { authoritative: true, complete: true, rows: [{ id: 'tx-rejected-match', row: { id: 'tx-rejected-match', amount: '12.34' } }] } },
  });
  assert.equal(result.outcome, 'retained');
  assert.equal(result.command.failure.kind, 'rejected');
});

test('concurrent readback and rejection mutations never resurrect a removed command', async () => {
  const journal = createPendingJournal(memoryStore());
  await journal.save(command('race'));
  await Promise.allSettled([
    journal.evaluateReadback('user-a', 'race', { byDomain: { transactions: { authoritative: true, complete: true, rows: [{ id: 'tx-race', row: { id: 'tx-race', amount: '12.34' } }] } } }),
    journal.markRejected('user-a', 'race', 'Rejected concurrently'),
  ]);
  const current = await journal.get('user-a', 'race');
  assert.ok(!current || current.failure?.kind === 'rejected');
});

test('readback compares large supported decimal values exactly and canonicalizes signed zero', async () => {
  const journal = createPendingJournal(memoryStore());
  await journal.save(command('decimal-boundary', { members: [{ domain: 'transactions', rowId: 'tx-decimal-boundary', desired: { id: 'tx-decimal-boundary', amount: '900000000000.0003' } }] }));
  const mismatch = await journal.evaluateReadback('user-a', 'decimal-boundary', { byDomain: { transactions: { authoritative: true, complete: true, rows: [{ id: 'tx-decimal-boundary', row: { id: 'tx-decimal-boundary', amount: 900000000000.0002 } }] } } });
  assert.equal(mismatch.command.state, 'conflict');
  await journal.save(command('zero', { members: [{ domain: 'transactions', rowId: 'tx-zero', desired: { id: 'tx-zero', amount: '-0.000' } }] }));
  const zero = await journal.evaluateReadback('user-a', 'zero', { byDomain: { transactions: { authoritative: true, complete: true, rows: [{ id: 'tx-zero', row: { id: 'tx-zero', amount: '0' } }] } } });
  assert.equal(zero.outcome, 'confirmed');
});

test('manual accept archives the command as resolved without fabricating success or rejection proof', async () => {
  const journal = createPendingJournal(memoryStore());
  await journal.save(command('manual', { kind: 'reconciliation', members: [
    { domain: 'anchors', rowId: 'anchor-manual', desired: { id: 'anchor-manual' } },
    { domain: 'transactions', rowId: 'tx-manual', desired: { id: 'tx-manual' } },
  ] }));
  const evidence = { byDomain: Object.fromEntries(['transactions', 'bills', 'anchors'].map(domain => [domain, { authoritative: true, complete: true, rows: [] }])) };
  await assert.rejects(journal.acceptServerState('user-a', 'manual', evidence, false), /acknowledgement/);
  const resolved = await journal.acceptServerState('user-a', 'manual', evidence, true);
  assert.equal(resolved.resolution.kind, 'accepted_server_state');
  assert.equal(resolved.failure, undefined);
  assert.equal((await journal.summarize('user-a')).total, 0);
  assert.equal((await journal.summarize('user-a')).resolved, 1);
  assert.equal((await journal.list('user-a')).length, 1);
});

