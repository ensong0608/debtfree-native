import test from 'node:test';
import assert from 'node:assert/strict';
import { repairDebtCategory, CategoryRepairUncertainError } from '../src/debt-category-repair.ts';

const session = { user: { id: 'actor' }, access_token: 'session-token' };
const context = { userId: 'actor', householdId: 'household-a', role: 'member', membershipVersion: '12' };
const diagnostic = { id: 'debt-a', name: 'Unclassified', issue: 'Missing category', category: null, version: '7' };

function setup({ role = 'member', membershipVersion = '12', pending = 0, loseResponse = false, repairResult = 'apply', category = null } = {}) {
  const row = { id: 'debt-a', household_id: 'household-a', category, version: '7', annual_fee_amount: null };
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'actor' } }, error: null }) },
    from(table) {
      assert.equal(table, 'debts');
      const filters = {};
      const query = {
        select(columns) { calls.push({ kind: 'select', columns }); return this; },
        eq(key, value) { filters[key] = value; return this; },
        async maybeSingle() { calls.push({ kind: 'read', ...filters }); return { data: filters.id === row.id && filters.household_id === row.household_id ? { ...row } : null, error: null }; },
      };
      return query;
    },
    async rpc(name, args) {
      calls.push({ kind: 'rpc', name, args });
      if (repairResult === 'apply') {
        row.category = args.p_category;
        row.version = '8';
        return loseResponse ? { data: null, error: { message: 'response lost' } } : { data: { success: true, householdId: 'household-a', membershipVersion: '12', debtId: 'debt-a', category: args.p_category, version: '8' }, error: null };
      }
      return { data: null, error: { code: '40001', message: 'CONCURRENCY_CONFLICT' } };
    },
  };
  const deps = {
    getClient: () => client,
    createSessionVerification: value => ({ session: value }),
    listVerifiedHouseholdContexts: async () => [{ ...context, role, membershipVersion }],
    getPendingFinanceSummary: async () => ({ total: pending }),
  };
  return { row, calls, deps };
}

test('repair sends only the exact household, membership, debt version and chosen category arguments', async () => {
  const { calls, deps } = setup();
  const result = await repairDebtCategory({ session, context, diagnostic, category: 'Credit card' }, deps);
  assert.deepEqual(result, { category: 'Credit card', version: '8' });
  assert.deepEqual(calls.find(call => call.kind === 'rpc'), {
    kind: 'rpc', name: 'debtfree_repair_debt_category', args: {
      p_household_id: 'household-a', p_expected_membership_version: '12', p_debt_id: 'debt-a',
      p_expected_debt_version: '7', p_category: 'Credit card',
    },
  });
});

test('lost RPC response is confirmed only by exact category and next version without retry', async () => {
  const { calls, deps } = setup({ loseResponse: true });
  const result = await repairDebtCategory({ session, context, diagnostic, category: 'Mortgage' }, deps);
  assert.deepEqual(result, { category: 'Mortgage', version: '8' });
  assert.equal(calls.filter(call => call.kind === 'rpc').length, 1);
  assert.equal(calls.filter(call => call.kind === 'read').length, 2);
});

test('mismatching readback remains uncertain and the write is never retried', async () => {
  const { calls, deps } = setup({ loseResponse: true });
  deps.getClient().rpc = async () => { calls.push({ kind: 'rpc' }); return { data: null, error: { message: 'response lost' } }; };
  await assert.rejects(repairDebtCategory({ session, context, diagnostic, category: 'Auto loan' }, deps), CategoryRepairUncertainError);
  assert.equal(calls.filter(call => call.kind === 'rpc').length, 1);
});

test('pending writes in the source household prevent category repair before any RPC', async () => {
  const { calls, deps } = setup({ pending: 1 });
  await assert.rejects(repairDebtCategory({ session, context, diagnostic, category: 'Credit card' }, deps), /pending account changes/);
  assert.equal(calls.some(call => call.kind === 'rpc'), false);
});

test('viewer and foreign household contexts are rejected before reads or repair', async () => {
  const viewer = setup({ role: 'viewer' });
  await assert.rejects(repairDebtCategory({ session, context: { ...context, role: 'viewer' }, diagnostic, category: 'Credit card' }, viewer.deps), /read-only/);
  assert.equal(viewer.calls.length, 0);
  const foreign = setup({ membershipVersion: '12' });
  await assert.rejects(repairDebtCategory({ session, context: { ...context, householdId: 'household-foreign' }, diagnostic, category: 'Credit card' }, foreign.deps), /membership changed/);
  assert.equal(foreign.calls.some(call => call.kind === 'rpc'), false);
});

test('annual fee debt can only be repaired as a credit card', async () => {
  const { calls, deps } = setup();
  const originalGetClient = deps.getClient;
  const client = originalGetClient();
  const from = client.from.bind(client);
  client.from = table => {
    const query = from(table);
    const select = query.select.bind(query);
    query.select = () => { select(); const maybeSingle = query.maybeSingle.bind(query); query.maybeSingle = async () => ({ ...(await maybeSingle()), data: { id: 'debt-a', household_id: 'household-a', category: null, version: '7', annual_fee_amount: '99' } }); return query; };
    return query;
  };
  deps.getClient = () => client;
  await assert.rejects(repairDebtCategory({ session, context, diagnostic, category: 'Personal loan' }, deps), /annual fee/);
  assert.equal(calls.some(call => call.kind === 'rpc'), false);
});
