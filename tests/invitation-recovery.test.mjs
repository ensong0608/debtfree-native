import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvitationIntentStore, decodeInvitationIntent, invitationForUser, joinHouseholdWithRecovery, withStartupDeadline, StartupTimeoutError } from '../src/invitation-intent.ts';
import { SessionVerification } from '../src/identity-verification.ts';
import { createBoundedFetch } from '../src/network-timeout.ts';
import { createDefaultOnboardingData, resolveAuthenticatedStage } from '../src/onboarding-domain.ts';
import { createSelectionCommitter } from '../src/selection-commit.ts';
import { acceptOnboardingSnapshot } from '../src/onboarding-snapshot.ts';

function memory() {
  const values = new Map();
  return { getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); }, removeItem: async key => { values.delete(key); } };
}
const token = 'a'.repeat(64);
const intent = { version: 1, token, userId: null, acceptedHouseholdId: null };

test('pending invitation survives store recreation and is isolated after binding to a user', async () => {
  const storage = memory();
  await createInvitationIntentStore(storage).save(intent);
  const restored = await createInvitationIntentStore(storage).load();
  assert.deepEqual(restored, intent);
  assert.equal(invitationForUser({ ...restored, userId: 'alice' }, 'bob'), null);
  assert.equal(decodeInvitationIntent(JSON.stringify({ ...intent, acceptedHouseholdId: 'household' })), null);
  assert.equal(decodeInvitationIntent('corrupt'), null);
});

test('confirmed acceptance survives failed opening and retries only the exact verified household', async () => {
  const storage = memory();
  let accepts = 0;
  const options = {
    userId: 'alice', token, store: createInvitationIntentStore(storage),
    accept: async () => { accepts++; return { userId: 'alice', householdId: 'shared-household' }; },
    open: async id => { assert.equal(id, 'shared-household'); throw new Error('offline'); },
  };
  await assert.rejects(joinHouseholdWithRecovery(options), /offline/);
  assert.equal((await options.store.load()).acceptedHouseholdId, 'shared-household');
  const completed = await joinHouseholdWithRecovery({ ...options, store: createInvitationIntentStore(storage), open: async id => ({ id, verified: true }) });
  assert.equal(accepts, 1);
  assert.deepEqual(completed.result, { id: 'shared-household', verified: true });
  // Intent clears only after the caller installs the successful result.
  assert.ok(await options.store.load());
  await options.store.clear(completed.intent);
  assert.equal(await options.store.load(), null);
});

test('wrong-account recovery cannot accept or open a stored join', async () => {
  const store = createInvitationIntentStore(memory());
  await store.save({ ...intent, userId: 'alice', acceptedHouseholdId: 'private' });
  await assert.rejects(joinHouseholdWithRecovery({ userId: 'bob', token, store,
    accept: async () => assert.fail('must not accept'), open: async () => assert.fail('must not open') }), /another signed-in account/);
  assert.equal((await store.load()).userId, 'alice');
});

test('a newer invitation cannot be overwritten or cleared by an older acceptance', async () => {
  const store = createInvitationIntentStore(memory());
  const newer = { ...intent, token: 'b'.repeat(64) };
  await assert.rejects(joinHouseholdWithRecovery({ userId: 'alice', token, store,
    accept: async () => { await store.save(newer); return { userId: 'alice', householdId: 'old' }; },
    open: async () => assert.fail('must not open old household') }), /newer invitation/);
  await store.clear({ ...intent, userId: 'alice' });
  assert.deepEqual(await store.load(), newer);
});

test('an unconfirmed acceptance retains its token for explicit retry and membership recovery', async () => {
  const store = createInvitationIntentStore(memory());
  await assert.rejects(joinHouseholdWithRecovery({ userId: 'alice', token, store,
    accept: async () => { throw new Error('response lost'); }, open: async () => assert.fail() }), /response lost/);
  assert.equal((await store.load()).token, token);
  assert.equal((await store.load()).acceptedHouseholdId, null);
});

test('receiving the same link atomically preserves binding and accepted receipt', async () => {
  const store = createInvitationIntentStore(memory());
  await store.receive(token);
  const bound = await store.bind('alice', token);
  await Promise.all([
    store.update(bound, { ...bound, acceptedHouseholdId: 'exact-household' }),
    store.receive(token),
  ]);
  assert.deepEqual(await store.load(), { ...bound, acceptedHouseholdId: 'exact-household' });
  await store.receive(token);
  assert.equal((await store.load()).acceptedHouseholdId, 'exact-household');
});

test('accepted selection writes are ordered and superseded queued operations never write', async () => {
  const writes = [];
  let release;
  const firstWrite = new Promise(resolve => { release = resolve; });
  const commit = createSelectionCommitter(async (_userId, householdId) => {
    if (householdId === 'first') await firstWrite;
    writes.push(householdId);
  });
  let current = 'first';
  const first = commit('alice', 'first', () => current === 'first');
  // Let the accepted first selection start its native write.
  await new Promise(resolve => setImmediate(resolve));
  const stale = commit('alice', 'stale', () => current === 'stale');
  current = 'newest';
  const newest = commit('alice', 'newest', () => current === 'newest');
  release();
  assert.deepEqual(await Promise.all([first, stale, newest]), [true, false, true]);
  assert.deepEqual(writes, ['first', 'newest']);
});

test('late screen snapshots cannot replace a different active household or user', () => {
  const active = { ...createDefaultOnboardingData('alice'), householdId: 'active', settingsRevision: 1 };
  assert.equal(acceptOnboardingSnapshot(active, { ...active, householdId: 'old', settingsRevision: 999 }), active);
  assert.equal(acceptOnboardingSnapshot(active, { ...active, userId: 'bob', settingsRevision: 999 }), active);
});

test('member signup resolves to Home, owner setup remains, and a foreign context cannot bypass setup', () => {
  const data = createDefaultOnboardingData('alice');
  const member = { ...data, signupCompleted: true, householdContext: { userId: 'alice', householdId: data.householdId, role: 'member', membershipVersion: '1' } };
  assert.equal(resolveAuthenticatedStage(member), 'home');
  assert.equal(resolveAuthenticatedStage({ ...member, signupCompleted: false }), 'signup_2');
  assert.equal(resolveAuthenticatedStage({ ...member, householdContext: { ...member.householdContext, role: 'viewer' } }), 'home');
  assert.equal(resolveAuthenticatedStage({ ...member, householdContext: { ...member.householdContext, role: 'owner' } }), 'signup_2');
  assert.notEqual(resolveAuthenticatedStage({ ...member, householdContext: { ...member.householdContext, userId: 'bob' } }), 'home');
});

test('identity is verified once per load, rejects a different account or token, and failures stay failures', async () => {
  const session = { user: { id: 'alice' }, access_token: 'one' };
  let calls = 0;
  const verification = new SessionVerification(session, async () => { calls++; return { id: 'alice' }; });
  await Promise.all([verification.getUser(session), verification.getUser(session)]);
  await verification.getUser(session);
  assert.equal(calls, 1);
  await assert.rejects(verification.getUser({ ...session, access_token: 'two' }));
  await assert.rejects(verification.getUser({ ...session, user: { id: 'bob' } }));
  const invalid = new SessionVerification(session, async () => ({ id: 'bob' }));
  await assert.rejects(invalid.getUser(session));
});

test('startup deadline stops waiting, while timely results remain unchanged', async () => {
  await assert.rejects(withStartupDeadline(new Promise(() => {}), 5), StartupTimeoutError);
  assert.equal(await withStartupDeadline(Promise.resolve('ready'), 100), 'ready');
});

test('bounded fetch aborts a stalled request once, without retrying a possible write', async () => {
  let calls = 0;
  const fetcher = createBoundedFetch(async (_input, init) => {
    calls++;
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  }, 5);
  await assert.rejects(fetcher('https://example.test', { method: 'POST' }), /aborted/);
  assert.equal(calls, 1);
});
