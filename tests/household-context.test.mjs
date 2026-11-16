import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canEditHousehold,
  decodeHouseholdSelectionHint,
  encodeHouseholdSelectionHint,
  householdSelectionStorageKey,
  householdStorageKey,
  parseHouseholdContext,
  parseHouseholdMembershipSummary,
  sameHouseholdContext,
  selectVerifiedHouseholdSummary,
} from '../src/household-context.ts';

const member = {
  userId: 'user-a',
  householdId: 'house:one',
  role: 'member',
  membershipVersion: '12',
};

test('only accepts a well-formed context for the authenticated user', () => {
  assert.deepEqual(parseHouseholdContext('user-a', member), member);
  assert.throws(() => parseHouseholdContext('user-b', member), /different user/);
  for (const mutate of [
    value => { value.householdId = ' '; },
    value => { value.role = 'admin'; },
    value => { value.membershipVersion = 0; },
    value => { value.membershipVersion = '01'; },
    value => { value.membershipVersion = '1e2'; },
  ]) {
    const value = { ...member };
    mutate(value);
    assert.throws(() => parseHouseholdContext('user-a', value));
  }
});

test('membership summaries normalize supported currency and expose only the three product roles', () => {
  assert.deepEqual(parseHouseholdMembershipSummary('user-a', {
    ...member,
    householdName: 'Family',
    currencyCode: 'cad',
  }), { ...member, householdName: 'Family', currencyCode: 'CAD' });
  assert.equal(canEditHousehold(parseHouseholdContext('user-a', member)), true);
  assert.equal(canEditHousehold(parseHouseholdContext('user-a', { ...member, role: 'viewer' })), false);
  assert.throws(() => parseHouseholdMembershipSummary('user-a', {
    ...member,
    householdName: 'Family',
    currencyCode: 'US$',
  }), /currency/);
});

test('membership version changes invalidate a previously verified context', () => {
  const current = parseHouseholdContext('user-a', member);
  assert.equal(sameHouseholdContext(current, { ...current }), true);
  assert.equal(sameHouseholdContext(current, { ...current, membershipVersion: '13' }), false);
  assert.equal(sameHouseholdContext(current, { ...current, role: 'viewer' }), false);
});

test('selection hints are user-scoped and never authorize another household', () => {
  const raw = encodeHouseholdSelectionHint('user-a', 'house:one');
  assert.equal(decodeHouseholdSelectionHint(raw, 'user-a'), 'house:one');
  assert.equal(decodeHouseholdSelectionHint(raw, 'user-b'), null);
  assert.equal(decodeHouseholdSelectionHint('{bad json', 'user-a'), null);
  assert.notEqual(householdSelectionStorageKey('user-a'), householdSelectionStorageKey('user-b'));
  assert.match(householdSelectionStorageKey('user:a'), /^[A-Za-z0-9._-]+$/);
});

test('cache namespaces separate each user, household, and data domain with SecureStore-safe keys', () => {
  const key = householdStorageKey('user:a', 'household:one', 'transactions');
  assert.notEqual(key, householdStorageKey('user:b', 'household:one', 'transactions'));
  assert.notEqual(key, householdStorageKey('user:a', 'household:two', 'transactions'));
  assert.notEqual(key, householdStorageKey('user:a', 'household:one', 'bills'));
  assert.notEqual(
    householdStorageKey('a.b', 'c', 'transactions'),
    householdStorageKey('a', 'b.c', 'transactions'),
  );
  assert.match(key, /^[A-Za-z0-9._-]+$/);
});

test('selectVerifiedHouseholdSummary gracefully falls back when hinted household is stale or missing', () => {
  const summaries = [
    {
      userId: 'user-a',
      householdId: 'personal-1',
      householdName: 'Personal Household',
      role: 'owner',
      currencyCode: 'USD',
      membershipVersion: '1',
    },
    {
      userId: 'user-a',
      householdId: 'shared-2',
      householdName: 'Family Budget',
      role: 'member',
      currencyCode: 'USD',
      membershipVersion: '3',
    },
  ];

  // 1. Matches requested ID if present
  assert.equal(selectVerifiedHouseholdSummary(summaries, 'shared-2', 'personal-1').householdId, 'shared-2');

  // 2. Matches hinted ID if requested is omitted/null
  assert.equal(selectVerifiedHouseholdSummary(summaries, null, 'personal-1').householdId, 'personal-1');

  // 3. Stale hint (e.g. household the user just left) gracefully falls back to owned household
  assert.equal(selectVerifiedHouseholdSummary(summaries, null, 'left-household-999').householdId, 'personal-1');

  // 4. Stale hint with single membership falls back to that single membership
  assert.equal(selectVerifiedHouseholdSummary([summaries[1]], null, 'left-household-999').householdId, 'shared-2');

  // 5. Throws if server returns 0 summaries
  assert.throws(() => selectVerifiedHouseholdSummary([], null, null), /No active household memberships/);

  // 6. Throws on duplicate summaries
  assert.throws(() => selectVerifiedHouseholdSummary([summaries[0], summaries[0]], null, null), /duplicate/);
});
