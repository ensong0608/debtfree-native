import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const storageModule = require('../src/finance-storage.ts');
const { householdStorageKey } = require('../src/household-context.ts');
const { pendingJournalV2Key } = require('../src/finance/pending-journal.ts');
const { makeMoney } = require('../src/finance/money.ts');
const { parseDateOnly } = require('../src/finance/calendar.ts');
const { executeRecurringBillSave, executeRecurringBillRemoval } = require('../src/finance/recurring-bills.ts');
const { encodeRecurringBillRow, decodeRecurringBillRow } = require('../src/finance/storage-domain.ts');

function memoryStore() {
  const values = new Map();
  return {
    values,
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
}

function tx(id, amount = 1000) {
  return {
    id, accountId: null, date: parseDateOnly('2026-11-07'), amount: makeMoney('USD', amount),
    category: 'debit_spending', payee: 'Test', memo: null, source: 'manual', reconciled: false,
    createdAt: '2026-11-07T12:00:00.000Z', deletedAt: null,
  };
}

function bill(id = 'bill-1') {
  return { id, name: 'Utilities', category: 'utilities', amount: makeMoney('USD', 1250), dueDay: 20,
    paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2026-01-01T00:00:00.000Z' };
}

function fakeSupabase({ onRpc, rows = {} } = {}) {
  const billRows = rows.recurring_bills ?? (rows.recurring_bills = []);
  const txRows = rows.transactions ?? (rows.transactions = []);
  const defaultOnRpc = async (name, args) => {
    if (name === 'debtfree_record_household_transaction_atomic') {
      const saved = { ...args.p_tx, updated_at: args.p_tx.updated_at ?? '2026-11-07T12:00:00.000Z' };
      txRows.push(saved);
      return { data: { success: true, householdId: args.p_household_id, membershipVersion: args.p_expected_membership_version, row: saved, updated_at: saved.updated_at }, error: null };
    }
    if (name === 'debtfree_upsert_household_bill_atomic') {
      const incoming = args.p_bill;
      const existingIndex = billRows.findIndex(row => row.id === incoming.id);
      if (args.p_expected_updated_at === null && existingIndex >= 0) {
        return { data: null, error: { code: '23505', message: 'duplicate bill id' } };
      }
      if (args.p_expected_updated_at !== null) {
        if (existingIndex < 0 || billRows[existingIndex].updated_at !== args.p_expected_updated_at) {
          return { data: null, error: { code: 'P0001', message: 'CONCURRENCY_CONFLICT: bill changed on the server' } };
        }
        const updated = { ...billRows[existingIndex], ...incoming, household_id: args.p_household_id };
        billRows[existingIndex] = updated;
        return { data: { success: true, householdId: args.p_household_id, membershipVersion: args.p_expected_membership_version, row: updated }, error: null };
      }
      const created = { ...incoming, household_id: args.p_household_id, updated_at: incoming.updated_at ?? '2026-11-07T12:00:00.000Z' };
      billRows.push(created);
      return { data: { success: true, householdId: args.p_household_id, membershipVersion: args.p_expected_membership_version, row: created }, error: null };
    }
    if (name === 'debtfree_delete_household_bill_atomic') {
      const idx = billRows.findIndex(row => row.id === args.p_bill_id && row.updated_at === args.p_expected_updated_at);
      if (idx < 0) {
        return { data: null, error: { code: 'P0001', message: 'CONCURRENCY_CONFLICT: bill delete revision mismatch' } };
      }
      billRows.splice(idx, 1);
      return { data: { success: true, householdId: args.p_household_id, membershipVersion: args.p_expected_membership_version, billId: args.p_bill_id, deleted: true }, error: null };
    }
    return { data: { success: true }, error: null };
  };
  const rpcHandler = onRpc ?? defaultOnRpc;
  const client = {
    async rpc(name, args) { return rpcHandler(name, args); },
    from(table) {
      let filters = {};
      const query = {
        select() { return this; },
        eq(key, value) { filters[key] = value; return this; },
        order() { return this; },
        range(start, end) {
          const tableRows = rows[table] ?? [];
          const matched = tableRows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
          return Promise.resolve({ data: matched.slice(start, end + 1), error: null });
        },
      };
      return query;
    },
  };
  return client;
}

const session = { user: { id: 'user-a' } };
const ctx = { userId: 'user-a', householdId: 'hh-1', role: 'owner', membershipVersion: '1' };
const txsKey = householdStorageKey(ctx.userId, ctx.householdId, 'finance:txs');
const billsKey = householdStorageKey(ctx.userId, ctx.householdId, 'finance:bills');
const anchorsKey = householdStorageKey(ctx.userId, ctx.householdId, 'finance:anchors');
const journalKey = pendingJournalV2Key(ctx);

test('transaction command is durable before RPC and lost response resolves from authoritative readback after restart', async () => {
  const store = memoryStore();
  let serverTransactions = [];
  const client = fakeSupabase({
    onRpc: async (_name, args) => {
      const raw = JSON.parse(store.values.get(journalKey));
      assert.equal(raw.commands.length, 1, 'journal command must be durable before RPC dispatch');
      serverTransactions = [args.p_tx];
      throw new Error('response lost after commit');
    },
    rows: { transactions: serverTransactions, recurring_bills: [], reconciliation_anchors: [] },
  });
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => client });
  try {
    const transaction = tx('tx-lost');
    const saved = await storageModule.persistTransaction({ session, userId: 'user-a', householdContext: ctx, transaction, allTransactions: [transaction] });
    assert.equal(saved.outcome, 'pending');
    assert.equal((await storageModule.getPendingFinanceSummary(ctx)).pending, 1);
    const restartedStore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => fakeSupabase({ rows: { transactions: serverTransactions, recurring_bills: [], reconciliation_anchors: [] } }) });
    const loaded = await storageModule.loadFinanceRecords({ session, userId: 'user-a', householdContext: ctx, currency: 'USD' });
    assert.equal(loaded.transactions[0].id, 'tx-lost');
    assert.equal(loaded.pendingWriteCount, 0);
    assert.equal((await storageModule.getPendingFinanceOperations(ctx)).length, 0);
    restartedStore();
  } finally { restore(); }
});

test('bill upsert lost response is confirmed by row readback with database decimal and timestamps', async () => {
  const store = memoryStore();
  let serverBills = [];
  const client = fakeSupabase({
    onRpc: async (name, args) => {
      assert.equal(name, 'debtfree_upsert_household_bill_atomic');
      serverBills = [{ ...args.p_bill, household_id: ctx.householdId, amount: 12.5, created_at: 'database-created', updated_at: 'database-updated' }];
      throw new Error('response lost after commit');
    },
    rows: { transactions: [], recurring_bills: serverBills, reconciliation_anchors: [] },
  });
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => client });
  try {
    const result = await storageModule.persistRecurringBill({ session, userId: 'user-a', householdContext: ctx, bill: bill(), currentBills: [] });
    assert.equal(result.outcome, 'pending');
    const remoteClient = fakeSupabase({ rows: { transactions: [], recurring_bills: serverBills, reconciliation_anchors: [] } });
    storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => remoteClient });
    const loaded = await storageModule.loadFinanceRecords({ session, userId: 'user-a', householdContext: ctx, currency: 'USD' });
    assert.equal(loaded.recurringBills[0].id, 'bill-1');
    assert.equal(loaded.pendingWriteCount, 0);
  } finally { restore(); }
});

test('concurrent stale transaction snapshots preserve both cached rows', async () => {
  const store = memoryStore();
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => fakeSupabase() });
  try {
    const a = tx('tx-a');
    const b = tx('tx-b', 2000);
    await Promise.all([
      storageModule.persistTransaction({ session: null, userId: 'user-a', householdContext: ctx, transaction: a, allTransactions: [a] }),
      storageModule.persistTransaction({ session: null, userId: 'user-a', householdContext: ctx, transaction: b, allTransactions: [b] }),
    ]);
    const cached = JSON.parse(store.values.get(txsKey));
    assert.deepEqual(new Set(cached.map(row => row.id)), new Set(['tx-a', 'tx-b']));
  } finally { restore(); }
});

test('server rejection restores local cache and is excluded from active overlays and counts', async () => {
  const store = memoryStore();
  await store.setItem(txsKey, JSON.stringify([{ id: 'existing', household_id: ctx.householdId, amount: '1.00' }]));
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => fakeSupabase({ onRpc: async () => ({ data: null, error: { code: '23514', message: 'Rejected' } }) }) });
  try {
    const transaction = tx('tx-rejected');
    const result = await storageModule.persistTransaction({ session, userId: 'user-a', householdContext: ctx, transaction, allTransactions: [transaction] });
    assert.equal(result.outcome, 'rejected');
    assert.deepEqual(JSON.parse(store.values.get(txsKey)), [{ id: 'existing', household_id: ctx.householdId, amount: '1.00' }]);
    assert.equal((await storageModule.getPendingFinanceSummary(ctx)).total, 0);
    assert.equal((await storageModule.getPendingFinanceSummary(ctx)).rejected, 1);
    assert.equal((await storageModule.getPendingTransactionIds(ctx)).has('tx-rejected'), false);
  } finally { restore(); }
});

test('atomic reconciliation stays grouped in needs review when only component rows match', async () => {
  const store = memoryStore();
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => fakeSupabase() });
  try {
    const adjustment = { id: 'adjustment-1', accountId: 'debt-1', date: parseDateOnly('2026-11-07'), amount: makeMoney('USD', 100),
      category: 'balance_adjustment', payee: 'Verified balance', memo: null, source: 'reconciliation', reconciled: true,
      createdAt: '2026-11-07T12:00:00.000Z', deletedAt: null };
    const anchor = { id: 'anchor-1', accountId: 'debt-1', asOfDate: parseDateOnly('2026-11-07'), verifiedBalance: makeMoney('USD', 50000),
      note: null, createdAt: '2026-11-07T12:00:00.000Z' };
    await storageModule.reconcileDebtAtomic({ session: null, userId: 'user-a', householdContext: ctx, accountId: 'debt-1', verifiedBalance: 500,
      asOfDate: anchor.asOfDate, reason: 'balance_adjustment', anchor, adjustmentTx: adjustment,
      allTransactions: [adjustment], allAnchors: [anchor], expectedVersion: 3 });
    const rows = JSON.parse(store.values.get(journalKey)).commands;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].members.length, 2);
    storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => fakeSupabase({
      rows: { transactions: [JSON.parse(store.values.get(txsKey))[0]], recurring_bills: [], reconciliation_anchors: [JSON.parse(store.values.get(anchorsKey))[0]] },
    }) });
    await storageModule.loadFinanceRecords({ session, userId: 'user-a', householdContext: ctx, currency: 'USD' });
    const summary = await storageModule.getPendingFinanceSummary(ctx);
    assert.equal(summary.total, 1);
    assert.equal(summary.needs_review, 1);
    assert.equal((await storageModule.getPendingFinanceOperations(ctx))[0].kind, 'reconciliation');
  } finally { restore(); }
});

test('soft-delete transaction readback accepts database timestamp after response loss', async () => {
  const store = memoryStore();
  const original = tx('tx-delete');
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => fakeSupabase() });
  try {
    await storageModule.deleteTransaction({ session: null, userId: 'user-a', householdContext: ctx, transactionId: original.id,
      allTransactions: [{ ...original, deletedAt: '2026-11-07T13:00:00.000Z' }] });
    const remoteRow = { ...JSON.parse(store.values.get(txsKey))[0], deleted_at: '2026-11-07T13:01:00.000Z' };
    storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => fakeSupabase({
      rows: { transactions: [remoteRow], recurring_bills: [], reconciliation_anchors: [] },
    }) });
    await storageModule.loadFinanceRecords({ session, userId: 'user-a', householdContext: ctx, currency: 'USD' });
    assert.equal((await storageModule.getPendingFinanceSummary(ctx)).total, 0);
  } finally { restore(); }
});

test('bill command remains review-only and retry cannot dispatch an unconditional upsert', async () => {
  const store = memoryStore();
  let rpcs = 0;
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => fakeSupabase({ onRpc: async () => { rpcs++; return { data: { success: true }, error: null }; } }) });
  try {
    const item = bill('bill-retry');
    await storageModule.persistRecurringBill({ session: null, userId: 'user-a', householdContext: ctx, bill: item, currentBills: [] });
    const operation = (await storageModule.getPendingFinanceOperations(ctx))[0];
    assert.equal(operation.dispatchState, 'not_dispatched');
    assert.equal(storageModule.canRetryPendingFinanceOperation(operation), false);
    assert.equal(rpcs, 0);
    await assert.rejects(storageModule.recoverPendingFinanceWrites({ userId: 'user-a', householdContext: ctx, session, action: 'retry', commandId: operation.commandId }), /review-only/);
    assert.equal(rpcs, 0);
    assert.equal((await storageModule.getPendingFinanceSummary(ctx)).total, 1);
  } finally { restore(); }
});

test('bill command contract passes original bills so a new bill reaches atomic RPC and returns server revision', async () => {
  const store = memoryStore();
  const bills = [];
  const client = fakeSupabase({ rows: { recurring_bills: bills } });
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => client });
  try {
    const adapter = {
      persist: params => storageModule.persistRecurringBill({ ...params, householdContext: ctx, currentBills: params.currentBills }),
      remove: params => storageModule.deleteRecurringBill({ ...params, householdContext: ctx, currentBills: params.currentBills }),
    };
    const result = await executeRecurringBillSave({ session, userId: 'user-a', bill: bill('cmd-create'), currentBills: [], storage: adapter });
    assert.equal(result.syncResult.outcome, 'confirmed');
    assert.equal(result.bills[0].updatedAt, bills[0].updated_at);
    assert.equal(result.syncResult.data.updatedAt, bills[0].updated_at);
    assert.equal(JSON.parse(store.values.get(billsKey))[0].updated_at, bills[0].updated_at);
  } finally { restore(); }
});

test('loaded bill edit uses original revision in durable expectedVersions and guarded server write', async () => {
  const store = memoryStore();
  const priorRow = encodeRecurringBillRow({ ...bill('bill-edit'), updatedAt: '2026-11-01T00:00:00.000Z' }, 'user-a', ctx.householdId, '2026-11-01T00:00:00.000Z');
  const rows = [priorRow];
  let rpcArgs;
  let durableExpectedRevision;
  const fallback = fakeSupabase({ rows: { recurring_bills: rows } });
  const client = fakeSupabase({
    rows: { recurring_bills: rows },
    onRpc: async (name, args) => {
      rpcArgs = args;
      const journal = JSON.parse(store.values.get(journalKey));
      durableExpectedRevision = journal.commands.at(-1).expectedVersions.updated_at;
      return fallback.rpc(name, args);
    },
  });
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => client });
  try {
    const prior = decodeRecurringBillRow(priorRow, 'USD');
    const changed = { ...prior, name: 'Updated utilities', amount: makeMoney('USD', 1750) };
    const adapter = { persist: params => storageModule.persistRecurringBill({ ...params, householdContext: ctx, currentBills: params.currentBills }), remove: params => storageModule.deleteRecurringBill({ ...params, householdContext: ctx, currentBills: params.currentBills }) };
    const result = await executeRecurringBillSave({ session, userId: 'user-a', bill: changed, currentBills: [prior], storage: adapter });
    assert.equal(result.syncResult.outcome, 'confirmed');
    assert.equal(rpcArgs.p_expected_updated_at, prior.updatedAt);
    assert.equal(rpcArgs.p_household_id, ctx.householdId);
    assert.equal(durableExpectedRevision, prior.updatedAt);
    assert.ok(Date.parse(rows[0].updated_at) > Date.parse(prior.updatedAt));
    assert.equal(result.bills[0].updatedAt, rows[0].updated_at);
    assert.equal((await storageModule.getPendingFinanceSummary(ctx)).total, 0);
  } finally { restore(); }
});

test('stale bill edit is rejected and leaves the newer remote row unchanged', async () => {
  const store = memoryStore();
  const stale = encodeRecurringBillRow({ ...bill('bill-stale'), updatedAt: '2026-11-01T00:00:00.000Z' }, 'user-a', ctx.householdId, '2026-11-01T00:00:00.000Z');
  const remote = { ...stale, name: 'Remote newer value', updated_at: '2026-11-05T00:00:00.000Z' };
  const rows = [remote];
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => fakeSupabase({ rows: { recurring_bills: rows } }) });
  try {
    const prior = decodeRecurringBillRow(stale, 'USD');
    const adapter = { persist: params => storageModule.persistRecurringBill({ ...params, householdContext: ctx, currentBills: params.currentBills }), remove: params => storageModule.deleteRecurringBill({ ...params, householdContext: ctx, currentBills: params.currentBills }) };
    await assert.rejects(executeRecurringBillSave({ session, userId: 'user-a', bill: { ...prior, name: 'Stale edit' }, currentBills: [prior], storage: adapter }), /changed on the server/);
    assert.equal(rows[0].name, 'Remote newer value');
    assert.equal(rows[0].updated_at, '2026-11-05T00:00:00.000Z');
  } finally { restore(); }
});

for (const deleteOutcome of ['zero_rows', 'lost_response']) {
  test(`failed bill deletion remains uncertain when RPC outcome is ${deleteOutcome}`, async () => {
    const store = memoryStore();
    const item = { ...bill('bill-readback-failure'), updatedAt: '2026-11-02T00:00:00.000Z' };
    let rpcAttempts = 0;
    const client = fakeSupabase({
      onRpc: async () => {
        rpcAttempts++;
        if (deleteOutcome === 'zero_rows') {
          return { data: { success: true, householdId: ctx.householdId, membershipVersion: ctx.membershipVersion, billId: item.id, deleted: false }, error: null };
        }
        return { data: null, error: { message: 'Network connection dropped' } };
      },
    });
    const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => client });
    try {
      const result = await storageModule.deleteRecurringBill({ session, userId: 'user-a', householdContext: ctx, billId: item.id, currentBills: [item] });
      assert.equal(result.outcome, 'pending');
      assert.equal(result.failureKind, 'uncertain');
      assert.notEqual(result.syncStatus, 'synced');
      assert.equal(rpcAttempts, 1);
      const operations = await storageModule.getPendingFinanceOperations(ctx);
      assert.equal(operations.length, 1);
      assert.equal(operations[0].kind, 'bill_delete');
      assert.equal(operations[0].state, 'pending');
      assert.equal(operations[0].dispatchState, 'uncertain');
      assert.equal((await storageModule.getPendingFinanceSummary(ctx)).total, 1);
    } finally { restore(); }
  });
}

test('loaded bill delete is guarded by the server revision', async () => {
  const store = memoryStore();
  const row = encodeRecurringBillRow({ ...bill('bill-delete'), updatedAt: '2026-11-02T00:00:00.000Z' }, 'user-a', ctx.householdId, '2026-11-02T00:00:00.000Z');
  const rows = [row];
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => fakeSupabase({ rows: { recurring_bills: rows } }) });
  try {
    const prior = decodeRecurringBillRow(row, 'USD');
    const adapter = { persist: params => storageModule.persistRecurringBill({ ...params, householdContext: ctx, currentBills: params.currentBills }), remove: params => storageModule.deleteRecurringBill({ ...params, householdContext: ctx, currentBills: params.currentBills }) };
    const result = await executeRecurringBillRemoval({ session, userId: 'user-a', billId: prior.id, currentBills: [prior], storage: adapter });
    assert.equal(result.syncResult.outcome, 'confirmed');
    assert.deepEqual(result.bills, []);
    assert.deepEqual(rows, []);
  } finally { restore(); }
});

test('bill edit and delete without cached server revision fail before dispatch', async () => {
  const store = memoryStore();
  let writes = 0;
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => fakeSupabase({ onRpc: async () => { writes++; return { data: { success: true }, error: null }; } }) });
  try {
    const item = bill('bill-existing');
    await assert.rejects(storageModule.persistRecurringBill({ session, userId: 'user-a', householdContext: ctx, bill: item, currentBills: [item] }), /revision is unavailable/);
    const second = bill('bill-delete-existing');
    await assert.rejects(storageModule.deleteRecurringBill({ session, userId: 'user-a', householdContext: ctx, billId: second.id, currentBills: [second] }), /revision is unavailable/);
    assert.equal(writes, 0);
  } finally { restore(); }
});

test('new bill ID collision is rejected without overwriting the remote bill', async () => {
  const store = memoryStore();
  const remote = encodeRecurringBillRow({ ...bill('bill-collision'), name: 'Remote bill', updatedAt: '2026-11-03T00:00:00.000Z' }, 'user-a', ctx.householdId, '2026-11-03T00:00:00.000Z');
  const rows = [remote];
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => fakeSupabase({ rows: { recurring_bills: rows } }) });
  try {
    const result = await storageModule.persistRecurringBill({ session, userId: 'user-a', householdContext: ctx, bill: { ...bill('bill-collision'), name: 'Proposed overwrite' }, currentBills: [] });
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.failureKind, 'rejected');
    assert.equal(rows[0].name, 'Remote bill');
    assert.equal(rows[0].updated_at, remote.updated_at);
  } finally { restore(); }
});

test('retry rejection remains rejected and is excluded from active overlay and counts', async () => {
  const store = memoryStore();
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => fakeSupabase({ onRpc: async () => ({ data: null, error: { code: '23514', message: 'Rejected' } }) }) });
  try {
    const item = tx('tx-retry-rejected');
    await storageModule.persistTransaction({ session: null, userId: 'user-a', householdContext: ctx, transaction: item, allTransactions: [item] });
    const command = (await storageModule.getPendingFinanceOperations(ctx))[0];
    await assert.rejects(storageModule.recoverPendingFinanceWrites({ userId: 'user-a', householdContext: ctx, session, action: 'retry', commandId: command.commandId }), /Rejected/);
    const saved = (await storageModule.getPendingFinanceOperations(ctx))[0];
    assert.equal(saved.failure.kind, 'rejected');
    assert.equal((await storageModule.getPendingFinanceSummary(ctx)).total, 0);
    assert.equal((await storageModule.getPendingFinanceSummary(ctx)).rejected, 1);
    assert.equal((await storageModule.getPendingTransactionIds(ctx)).has(item.id), false);
  } finally { restore(); }
});

test('malformed legacy null, array, invalid map, and JSON survive cutover preflight without household overlays', async () => {
  const store = memoryStore();
  const malformed = [
    ['txs', 'null'],
    ['bills', '[]'],
    ['anchors', '{"row-1":"not-a-row"}'],
  ];
  for (const [domain, raw] of malformed) await store.setItem(`debtfree-pending-${domain}-v1.user-a`, raw);
  await store.setItem('debtfree-pending-txs-v1.user-b', '{truncated');
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => fakeSupabase() });
  try {
    await assert.rejects(storageModule.assertHouseholdFinanceContextReady(ctx), /legacy finance evidence/i);
    for (const [domain, raw] of malformed) assert.equal(store.values.get(`debtfree-pending-${domain}-v1.user-a`), raw);
    await assert.rejects(storageModule.assertHouseholdFinanceContextReady({ ...ctx, userId: 'user-b' }), /legacy finance evidence/i);
    assert.equal(store.values.get('debtfree-pending-txs-v1.user-b'), '{truncated');
    assert.equal((await storageModule.getPendingTransactionIds(ctx)).size, 0);
  } finally { restore(); }
});

test('manual server-state adoption returns complete readback and archives resolution separately', async () => {
  const store = memoryStore();
  const restore = storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => fakeSupabase() });
  try {
    const adjustment = { id: 'adjustment-manual', accountId: 'debt-1', date: parseDateOnly('2026-11-07'), amount: makeMoney('USD', 100), category: 'balance_adjustment', payee: 'Verified balance', memo: null, source: 'reconciliation', reconciled: true, createdAt: '2026-11-07T12:00:00.000Z', deletedAt: null };
    const anchor = { id: 'anchor-manual', accountId: 'debt-1', asOfDate: parseDateOnly('2026-11-07'), verifiedBalance: makeMoney('USD', 50000), note: null, createdAt: '2026-11-07T12:00:00.000Z' };
    await storageModule.reconcileDebtAtomic({ session: null, userId: 'user-a', householdContext: ctx, accountId: 'debt-1', verifiedBalance: 500, asOfDate: anchor.asOfDate, reason: 'balance_adjustment', anchor, adjustmentTx: adjustment, allTransactions: [adjustment], allAnchors: [anchor], expectedVersion: 3 });
    const command = (await storageModule.getPendingFinanceOperations(ctx))[0];
    const client = fakeSupabase({ rows: { transactions: [], recurring_bills: [], reconciliation_anchors: [] } });
    storageModule.__configureFinanceStorageForTests({ storage: store, getClient: () => client });
    const recovered = await storageModule.recoverPendingFinanceWrites({ userId: 'user-a', householdContext: ctx, session, action: 'accept_server_state', commandId: command.commandId, acknowledgeServerState: true });
    assert.equal(recovered.resolvedCommandId, command.commandId);
    assert.deepEqual(recovered.authoritativeRecords, { transactions: [], recurringBills: [], reconciliationAnchors: [] });
    assert.equal(recovered.summary.total, 0);
    assert.equal(recovered.summary.resolved, 1);
    assert.equal(recovered.operations[0].resolution.kind, 'accepted_server_state');
    assert.equal(recovered.operations[0].resolution.evidence.observedMembers.length, 2);
    assert.equal(recovered.operations[0].failure, undefined);
    assert.equal((await storageModule.getPendingTransactionIds(ctx)).size, 0);
  } finally { restore(); }
});

