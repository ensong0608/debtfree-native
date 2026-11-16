import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDefaultOnboardingData } from '../src/onboarding-domain.ts';
import { settingsFailureSnapshot } from '../src/settings-contract.ts';

// Exercise the real persistence implementation with only native/network adapters
// replaced. No Supabase connection or device storage is used.
let fixture;
const nativeMocks = new Map([
  ['react-native', `export const PermissionsAndroid = {}; export const Platform = { OS: 'android' };`],
  ['expo-secure-store', `export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'device'; export const getItemAsync = key => globalThis.__settingsFixture.values.get(key) ?? null; export const setItemAsync = (key,value) => { globalThis.__settingsFixture.values.set(key,value); }; export const deleteItemAsync = key => { globalThis.__settingsFixture.values.delete(key); };`],
  ['expo-crypto', `export const randomUUID = () => 'fixture-' + globalThis.__settingsFixture.counter++;`],
  ['./auth', `export const getSupabaseClient = () => globalThis.__settingsFixture.client; export const createSessionVerification = () => ({ getUser: async () => ({ id: 'alice', user_metadata: { debtfree_profile_v2: globalThis.__settingsFixture.profile, debtfree_native_v1: globalThis.__settingsFixture.backup } }) });`],
  ['./finance-storage', `export const assertHouseholdFinanceContextReady = async () => {}; export const clearUserFinanceStorage = async () => {}; export const clearUserFinanceStorageForAccountDeletion = async () => {}; export const deleteAccountHistoryWithCommit = async () => {}; export const loadFinanceRecords = async () => { throw new Error('unexpected currency mutation'); };`],
  ['./dev/local-acceptance', `export const isLocalAcceptanceOwner = () => false; export const saveLocalAcceptanceFixture = async () => { throw new Error('not local acceptance'); };`],
  ['./household-service', `export const loadVerifiedHouseholdContext = async () => ({ selected: { ...globalThis.__settingsFixture.context, householdName: 'Shared', currencyCode: 'USD' }, summaries: [] });`],
]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/src/onboarding-storage.ts') && nativeMocks.has(specifier)) {
      return { url: `data:text/javascript,${encodeURIComponent(nativeMocks.get(specifier))}`, shortCircuit: true };
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !/\.[a-z]+$/i.test(specifier)) {
      const resolved = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(resolved))) return nextResolve(resolved.href, context);
    }
    return nextResolve(specifier, context);
  },
});
const require = createRequire(import.meta.url);
const { loadUserOnboardingData, saveUserOnboardingData, saveUserOnboardingSettingsPatch, FinancialSettingsConflictError, FinancialSettingsUncertainError, HouseholdDataUnavailableError } = require('../src/onboarding-storage.ts');

const session = { user: { id: 'alice' }, access_token: 'fixture' };
function baseData() {
  return { ...createDefaultOnboardingData('alice'), householdId: 'shared', currencyCode: 'USD', settingsRevision: 3, profileSettingsRevision: 0,
    householdContext: { userId: 'alice', householdId: 'shared', role: 'member', membershipVersion: '7' } };
}
function sharedSnapshot(data) {
  const fields = ['householdId', 'countryCode', 'currencyCode', 'primaryIncomeAmount', 'primaryPayFrequency', 'primaryMonthlyIncome', 'additionalIncomes', 'strategy', 'extraMonthlyPayment'];
  return Object.fromEntries(fields.filter(field => data[field] !== undefined).map(field => [field, data[field]]));
}
beforeEach(() => {
  const initial = baseData();
  fixture = { values: new Map(), counter: 0, profile: { ...createDefaultOnboardingData('alice'), householdId: 'personal-original', settingsRevision: 0 },
    context: initial.householdContext, settings: sharedSnapshot(initial), revision: 3, writes: [], loseSharedResponse: false, rejectProfile: false };
  fixture.client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user: { id: 'alice', user_metadata: { debtfree_profile_v2: fixture.profile, debtfree_native_v1: fixture.backup } } }, error: null }),
    },
    from() { return { select() { return this; }, eq() { return this; }, order: async () => ({ data: fixture.debtRows ?? [], error: null }) }; },
    async rpc(name, args) {
      if (name === 'debtfree_get_household_settings') {
        if (fixture.readbackFails && fixture.writes.length) return { data: null, error: { message: 'offline' } };
        return { data: { status: 'ok', householdId: 'shared', role: fixture.context.role, membershipVersion: fixture.context.membershipVersion, revision: fixture.revision, settings: fixture.settings }, error: null };
      }
      fixture.writes.push({ name, args });
      if (name === 'debtfree_save_household_settings') {
        assert.equal(args.p_expected_revision, fixture.revision);
        fixture.revision++;
        fixture.settings = structuredClone(args.p_settings);
        if (fixture.loseSharedResponse) return { data: null, error: { message: 'response lost' } };
        return { data: { status: 'saved', householdId: 'shared', membershipVersion: fixture.context.membershipVersion, revision: fixture.revision, settings: fixture.settings }, error: null };
      }
      if (name === 'debtfree_save_settings') {
        if (fixture.rejectProfile) return { data: null, error: { code: '42501', message: 'profile rejected' } };
        fixture.profile = { ...args.p_settings, settingsRevision: args.p_expected_revision + 1 };
        return fixture.loseProfileResponse ? { data: null, error: { message: "lost" } } : { data: fixture.profile, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  globalThis.__settingsFixture = fixture;
});

test('member strategy patch writes shared settings only and never touches the personal household', async () => {
  fixture.rejectProfile = true;
  const saved = await saveUserOnboardingSettingsPatch(baseData(), { strategy: 'avalanche' }, session);
  assert.equal(saved.strategy, 'avalanche');
  assert.equal(saved.settingsRevision, 4);
  assert.deepEqual(fixture.writes.map(write => write.name), ['debtfree_save_household_settings']);
  assert.equal(fixture.profile.householdId, 'personal-original');
});

test('lost shared response is reconciled without duplicate writes', async () => {
  fixture.loseSharedResponse = true;
  const saved = await saveUserOnboardingSettingsPatch(baseData(), { strategy: 'avalanche' }, session);
  assert.equal(saved.strategy, 'avalanche');
  assert.equal(saved.settingsRevision, 4);
  assert.equal(fixture.writes.length, 1);
});

test('unrelated concurrent settings are retained during safe patch rebase', async () => {
  fixture.settings.extraMonthlyPayment = 25;
  fixture.revision = 4;
  const saved = await saveUserOnboardingSettingsPatch(baseData(), { strategy: 'avalanche' }, session);
  assert.equal(saved.strategy, 'avalanche');
  assert.equal(saved.extraMonthlyPayment, 25);
  assert.equal(saved.settingsRevision, 5);
  assert.equal(fixture.writes.length, 1);
});

test('a concurrent edit to the requested field is shown without overwriting it', async () => {
  fixture.settings.extraMonthlyPayment = 25;
  fixture.revision = 4;
  await assert.rejects(saveUserOnboardingSettingsPatch(baseData(), { extraMonthlyPayment: 50 }, session), error => {
    assert.ok(error instanceof FinancialSettingsConflictError);
    assert.equal(error.reconciledData.extraMonthlyPayment, 25);
    assert.equal(error.reconciledData.settingsRevision, 4);
    return true;
  });
  assert.equal(fixture.writes.length, 0);
});

test('already committed desired value is a success rather than another write', async () => {
  fixture.settings.strategy = 'avalanche';
  fixture.revision = 4;
  const saved = await saveUserOnboardingSettingsPatch(baseData(), { strategy: 'avalanche' }, session);
  assert.equal(saved.strategy, 'avalanche');
  assert.equal(saved.settingsRevision, 4);
  assert.equal(fixture.writes.length, 0);
});

test('partial combined save confirms shared revision and restores authoritative personal fields only', async () => {
  fixture.rejectProfile = true;
  const attempted = { ...baseData(), strategy: 'avalanche', signupCompleted: true, currentStage: 'home' };
  await assert.rejects(saveUserOnboardingData(attempted), error => {
    assert.ok(error instanceof FinancialSettingsUncertainError);
    assert.equal(error.reconciledData.strategy, 'avalanche');
    assert.equal(error.reconciledData.settingsRevision, 4);
    assert.equal(error.reconciledData.signupCompleted, false);
    assert.equal(error.reconciledData.currentStage, 'signup_2');
    assert.equal(error.reconciledData.householdId, 'shared');
    return true;
  });
});

test('personal-only save preserves immutable profile household and does not touch shared settings', async () => {
  const saved = await saveUserOnboardingData({ ...baseData(), signupCompleted: true }, { personalOnly: true });
  assert.equal(saved.householdId, 'shared');
  assert.equal(fixture.profile.householdId, 'personal-original');
  assert.equal(fixture.profile.signupCompleted, true);
  assert.deepEqual(fixture.writes.map(write => write.name), ['debtfree_save_settings']);
});

test('stale personal revision cannot silently overwrite a newer personal profile', async () => {
  fixture.profile.settingsRevision = 2;
  await assert.rejects(saveUserOnboardingData({ ...baseData(), signupCompleted: true }, { personalOnly: true }), FinancialSettingsConflictError);
  assert.equal(fixture.writes.length, 0);
});

test('shared patches cannot rewrite identity or personal onboarding fields', async () => {
  await assert.rejects(saveUserOnboardingSettingsPatch(baseData(), { householdId: 'other' }, session), /unsupported field/);
  await assert.rejects(saveUserOnboardingSettingsPatch(baseData(), { signupCompleted: true }, session), /unsupported field/);
  assert.equal(fixture.writes.length, 0);
});

test('a committed write with failed readback remains explicitly unconfirmed in the UI contract', async () => {
  fixture.loseSharedResponse = true;
  fixture.readbackFails = true;
  const prior = baseData();
  await assert.rejects(saveUserOnboardingSettingsPatch(prior, { strategy: 'avalanche' }, session), error => {
    assert.equal(fixture.settings.strategy, 'avalanche');
    const outcome = settingsFailureSnapshot(error, prior);
    assert.equal(outcome.uncertain, true);
    assert.equal(outcome.data, prior); // Last verified, explicitly labelled unconfirmed.
    return true;
  });
  assert.equal(fixture.writes.length, 1);
});

test('invitee can reopen shared household before first personal signup save without a local-only dead end', async () => {
  fixture.profile = null;
  fixture.debtRows = [{ id: 'shared-card', user_id: 'owner', household_id: 'shared', name: 'Card', category: 'Credit card', balance: '100.0000', apr: '10', minimum_payment: '10.0000', original_balance: null, credit_limit: '1000.0000', due_day: 15, version: 1 }];
  const first = await loadUserOnboardingData(session, { householdId: 'shared' });
  assert.equal(first.debts.length, 1);
  const reopened = await loadUserOnboardingData(session, { householdId: 'shared' });
  assert.equal(reopened.debts[0].id, 'shared-card');
  assert.equal(reopened.signupCompleted, false);
});

test('real household loader returns structured recovery diagnostics for an unsupported category', async () => {
  fixture.profile = null;
  fixture.debtRows = [{ id: 'broken-debt', user_id: 'owner', household_id: 'shared', name: 'Unclassified account', category: null,
    balance: '1234.00', apr: '12.5', minimum_payment: '40.00', original_balance: '1500.00', credit_limit: null,
    due_day: 14, annual_fee_amount: null, annual_fee_next_due_date: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z', version: 9 }];
  await assert.rejects(loadUserOnboardingData(session, { householdId: 'shared' }), error => {
    assert.ok(error instanceof HouseholdDataUnavailableError);
    assert.equal(error.context.householdId, 'shared');
    assert.deepEqual(error.diagnostics, [{ id: 'broken-debt', name: 'Unclassified account', issue: 'Missing category', version: 9, category: null }]);
    return true;
  });
});



test('partial v2 wins over backup and retains defaults across household switch', async () => {
  fixture.backup = { ...fixture.profile, signupCompleted: false, debts: [{ id: 'old' }] };
  fixture.profile = { version: 1, userId: 'alice', householdId: 'personal-original', settingsRevision: 2, signupCompleted: true, managesWithPartner: true, updatedAt: '2026-01-01' };
  const loaded = await loadUserOnboardingData(session);
  assert.equal(loaded.signupCompleted, true); assert.equal(loaded.managesWithPartner, true);
  assert.deepEqual(loaded.goals, ['Pay down my credit card debt']); assert.deepEqual(loaded.debts, []);
  assert.equal(loaded.householdId, 'shared'); assert.equal(loaded.profileSettingsRevision, 2);
});

test('new signup uses defaults and saves CAS zero without writing backup', async () => {
  fixture.profile = null; fixture.backup = undefined;
  const loaded = await loadUserOnboardingData(session);
  assert.equal(loaded.signupCompleted, false); assert.ok(loaded.notifications);
  fixture.loseProfileResponse = true;
  const saved = await saveUserOnboardingData({ ...loaded, signupCompleted: true }, { personalOnly: true });
  assert.equal(saved.profileSettingsRevision, 1);
  assert.equal(fixture.writes[0].args.p_expected_revision, 0);
  assert.equal(fixture.backup, undefined);
});
