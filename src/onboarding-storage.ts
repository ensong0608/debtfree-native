import { PermissionsAndroid, Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { getSupabaseClient } from './auth';
import { createChunkedStorage, type KeyValueStore } from './secure-chunks';
import {
  createDefaultOnboardingData,
  resolveCurrencyOption,
  type DebtItem,
  type UserOnboardingData,
} from './onboarding-domain';

import { assertCurrencyChangeAllowed, canonicalDebtAmount, canonicalOptionalDebtAmount, decodeDebtAmount, resolveDatabaseDebtCategory, validateStoredAmounts } from './debt-storage-domain';
import { loadFinanceRecords } from './finance-storage';

const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const secureStoreAdapter: KeyValueStore = {
  getItem: key => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, secureOptions),
  removeItem: key => SecureStore.deleteItemAsync(key),
};

const chunkedStore = createChunkedStorage(secureStoreAdapter, () => Crypto.randomUUID());

function localStateKey(userId: string): string {
  // SecureStore keys must only contain alphanumeric, '.', '-', '_'
  const safeId = userId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `debtfree-onboarding-v1.${safeId}`;
}

/** A failed remote read must not be misrepresented as an empty account list. */
export class OnboardingDataUnavailableError extends Error {
  constructor(message = 'Your saved financial data could not be verified. Reconnect and try again.') {
    super(message);
    this.name = 'OnboardingDataUnavailableError';
  }
}

type SupabaseDebtRow = {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  balance: number | string;
  apr: number | string;
  minimum_payment: number | string;
  original_balance: number | string | null;
  credit_limit: number | string | null;
  due_day: number | null;
  created_at?: string;
  updated_at?: string;
  version?: number | string;
};

const DEBT_ROW_COLUMNS = 'id, user_id, name, category, balance, apr, minimum_payment, original_balance, due_day, credit_limit, created_at, updated_at, version';

function mergeDebtsWithDatabaseRows(
  metaDebts: DebtItem[],
  dbRows: SupabaseDebtRow[],
  currency: string,
): DebtItem[] {
  const metaById = new Map<string, DebtItem>(metaDebts.map(d => [d.id, d]));
  // A successfully fetched empty set means *empty*, never resurrect deleted metadata debts.
  return dbRows.map(row => {
    const existing = metaById.get(row.id);
    // public.debts is authoritative; never promote a stale metadata category.
    // An actually missing database value may use a known, validated legacy value.
    let category: DebtItem['category'];
    try { category = resolveDatabaseDebtCategory(row.category, existing?.category); }
    catch { throw new OnboardingDataUnavailableError('Saved debt category is missing or unsupported. Verify the sandbox debt schema and data before continuing.'); }
    const apr = Number(row.apr);
    if (!Number.isFinite(apr) || apr < 0 || apr > 100) throw new OnboardingDataUnavailableError('Saved debt APR is invalid.');
    const serverVersion = Number(row.version);
    if (!Number.isSafeInteger(serverVersion) || serverVersion < 1) {
      throw new OnboardingDataUnavailableError('Saved debt revision is missing or invalid. Apply the approved sandbox concurrency migration before editing debts.');
    }
    return {
      id: row.id,
      name: row.name,
      category,
      balance: decodeDebtAmount(row.balance, currency, true),
      originalBalance: row.original_balance == null ? null : decodeDebtAmount(row.original_balance, currency),
      apr,
      minimumPayment: decodeDebtAmount(row.minimum_payment, currency),
      dueDay: row.due_day ?? null,
      creditLimit: row.credit_limit == null ? null : decodeDebtAmount(row.credit_limit, currency),
      createdAt: row.created_at ?? existing?.createdAt ?? '',
      updatedAt: row.updated_at ?? existing?.updatedAt ?? '',
      serverVersion,
    };
  });
}


/** Missing schema capabilities are not the same as an empty inventory. */
function schemaCompatibilityError(error: { code?: string; message?: string } | null | undefined): OnboardingDataUnavailableError | null {
  if (error && ['42703', '42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code ?? '')) {
    return new OnboardingDataUnavailableError(
      'DebtFree sandbox schema is not ready. Review and apply the ordered native SQL migrations to the sandbox, then retry. No local debt data was substituted.',
    );
  }
  return null;
}

async function assertAuthenticatedUser(userId: string) {
  const { data, error } = await getSupabaseClient().auth.getUser();
  if (error || !data.user || data.user.id !== userId) {
    throw new OnboardingDataUnavailableError('Could not verify the current user. Reconnect and try again.');
  }
  return data.user;
}

/**
 * public.debts is the only authoritative debt store. Auth metadata stores profile
 * preferences, not debt records. Per-user SecureStore is a recovery cache only.
 */
export async function loadUserOnboardingData(session: Session): Promise<UserOnboardingData> {
  const userId = session.user.id;
  const fallback = createDefaultOnboardingData(userId);
  let localData: UserOnboardingData | null = null;
  try {
    const raw = await chunkedStore.getItem(localStateKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as UserOnboardingData;
      if (parsed?.userId === userId && parsed.version === 1) localData = parsed;
    }
  } catch {
    // Damaged local cache cannot replace authoritative server records.
  }

  const verifiedUser = await assertAuthenticatedUser(userId);
  const metaRaw = verifiedUser.user_metadata?.debtfree_native_v1;
  const candidate = metaRaw && typeof metaRaw === 'object' ? metaRaw as UserOnboardingData : null;
  const remoteData = candidate?.userId === userId && candidate.version === 1 ? candidate : null;
  if (localData && !remoteData && (localData.onboardingCompleted || localData.signupCompleted || localData.debts.length > 0)) {
    throw new OnboardingDataUnavailableError('This device has local-only onboarding data. Automatic overwrite is blocked; recover it before continuing.');
  }
  const profileOnly = (d: UserOnboardingData) => ({ ...d, debts: [] });
  if (localData && remoteData && localData.updatedAt > remoteData.updatedAt &&
      JSON.stringify(profileOnly(localData)) !== JSON.stringify(profileOnly(remoteData))) {
    throw new OnboardingDataUnavailableError('This device has unconfirmed newer local changes. Automatic overwrite is blocked; recover them before continuing.');
  }

  const supabase = getSupabaseClient();
  const { data: rows, error } = await supabase.from('debts')
    .select(DEBT_ROW_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error || !Array.isArray(rows)) {
    throw schemaCompatibilityError(error) ?? new OnboardingDataUnavailableError('Unable to load saved debt accounts. Retry when connected.');
  }
  if (rows.some((row: SupabaseDebtRow) => row.user_id !== userId)) {
    throw new OnboardingDataUnavailableError('Received a debt record outside the current account.');
  }
  const base = remoteData ?? fallback;
  const verified: UserOnboardingData = {
    ...base,
    debts: mergeDebtsWithDatabaseRows(base.debts ?? [], rows as SupabaseDebtRow[], resolveCurrencyOption(base).code),
  };
  validateStoredAmounts(verified);
  try { await chunkedStore.setItem(localStateKey(userId), JSON.stringify(verified)); } catch {
    // A failed optional cache write must not change the verified server result.
  }
  return verified;
}

async function assertStoredCurrencyUnchanged(data: UserOnboardingData): Promise<void> {
  const previousRaw = await chunkedStore.getItem(localStateKey(data.userId));
  const cached = previousRaw ? JSON.parse(previousRaw) as UserOnboardingData : null;
  const previous = cached?.userId === data.userId && cached.version === 1 ? cached : null;
  const nextCurrency = resolveCurrencyOption(data).code;
  if (previous && resolveCurrencyOption(previous).code === nextCurrency) return;
  const { data: sessionResult, error } = await getSupabaseClient().auth.getSession();
  if (error || !sessionResult.session || sessionResult.session.user.id !== data.userId) {
    throw new OnboardingDataUnavailableError('Financial records could not be verified for this currency change. Reconnect and retry.');
  }
  const priorUser = previous ?? await assertAuthenticatedUser(data.userId).then(user => {
    const candidate = user.user_metadata?.debtfree_native_v1;
    return candidate && typeof candidate === 'object' && (candidate as UserOnboardingData).userId === data.userId
      ? candidate as UserOnboardingData : null;
  });
  if (priorUser && resolveCurrencyOption(priorUser).code === nextCurrency) return;
  const records = await loadFinanceRecords({ session: sessionResult.session, userId: data.userId, currency: priorUser ? resolveCurrencyOption(priorUser).code : nextCurrency });
  if (records.syncStatus !== 'synced') {
    throw new OnboardingDataUnavailableError('Financial records could not be verified for this currency change. Reconnect and retry.');
  }
  assertCurrencyChangeAllowed(priorUser ?? data, nextCurrency, {
    transactions: records.transactions,
    recurringBills: records.recurringBills,
    reconciliationAnchors: records.reconciliationAnchors,
    complete: true,
  });
}

/** The database, not a client timestamp, must decide whether settings may be updated. */
export class FinancialSettingsConflictError extends Error {
  constructor() { super('Financial settings changed on another device. Reload before saving.'); this.name = 'FinancialSettingsConflictError'; }
}

export class FinancialSettingsUncertainError extends Error {
  constructor() { super('The settings save could not be confirmed. Reconnect and reload before retrying.'); this.name = 'FinancialSettingsUncertainError'; }
}

function revisionOf(value: UserOnboardingData | null | undefined): number {
  const revision = value?.settingsRevision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new OnboardingDataUnavailableError('Saved settings revision is invalid.');
  return revision;
}

function persistedSettings(data: UserOnboardingData): Omit<UserOnboardingData, 'debts'> & { debts: [] } {
  return { ...data, debts: [] };
}

function sameSettings(a: UserOnboardingData, b: UserOnboardingData): boolean {
  // PostgreSQL jsonb may reorder object keys; compare canonical structures.
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(object).sort().map(key => [key, canonical(object[key])]));
    }
    return value;
  };
  const comparable = (value: UserOnboardingData) => {
    const { settingsRevision: _revision, updatedAt: _timestamp, ...rest } = persistedSettings(value);
    return canonical(rest);
  };
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}

/**
 * The sandbox RPC atomically checks the previous revision on auth.users and
 * advances it. The reset path remains unchanged and is recognized by the SQL
 * revision guard. No second authoritative settings table is introduced.
 */
export async function saveUserOnboardingData(data: UserOnboardingData): Promise<UserOnboardingData> {
  await assertStoredCurrencyUnchanged(data);
  validateStoredAmounts(data);
  await assertAuthenticatedUser(data.userId);
  const expected = revisionOf(data);
  const stamped = persistedSettings({ ...data, updatedAt: new Date().toISOString() });
  const { data: saved, error } = await getSupabaseClient().rpc('debtfree_save_settings', {
    p_expected_revision: expected,
    p_settings: stamped,
  });
  let confirmed: UserOnboardingData | null = null;
  if (!error && saved && typeof saved === 'object' && !Array.isArray(saved)) {
    const candidate = saved as UserOnboardingData;
    if (candidate.userId === data.userId && revisionOf(candidate) === expected + 1 && sameSettings(candidate, stamped)) {
      confirmed = { ...candidate, debts: data.debts };
    }
  }
  if (!confirmed) {
    // Lost RPC response: read the server before declaring failure or retrying.
    // A conflicting newer revision must never be treated as a successful write.
    const user = await assertAuthenticatedUser(data.userId);
    const raw = user.user_metadata?.debtfree_native_v1;
    const remote = raw && typeof raw === 'object' ? raw as UserOnboardingData : null;
    if (remote?.userId === data.userId && revisionOf(remote) === expected + 1 && sameSettings(remote, stamped)) {
      confirmed = { ...remote, debts: data.debts };
    } else {
      const incompatible = schemaCompatibilityError(error);
      if (incompatible) throw incompatible;
      if (remote?.userId === data.userId && revisionOf(remote) !== expected ||
          error?.code === 'P0001' && error.message?.includes('DEBTFREE_SETTINGS_CONFLICT')) {
        throw new FinancialSettingsConflictError();
      }
      throw new FinancialSettingsUncertainError();
    }
  }
  // An optional cache is never used to claim a failed server write succeeded.
  try { await chunkedStore.setItem(localStateKey(data.userId), JSON.stringify(confirmed)); } catch { /* optional */ }
  return confirmed;
}

/** A server rejection that was verified not to commit. */
export class DebtWriteFailedError extends Error {
  constructor(message = 'The server rejected this debt update.') {
    super(message);
    this.name = 'DebtWriteFailedError';
  }
}

/** A known SQLSTATE indicates the request was rejected, rather than lost in transit. */
function isConfirmedServerRejection(code: string | undefined): boolean {
  return code === '42501' || code === '23514' || code === '23502' ||
    code === '23503' || code === '22P02';
}

/** A write lost a compare-and-swap race against newer server state. */
export class DebtWriteConflictError extends Error {
  constructor(message = 'This debt changed on another device or was deleted. Reload before editing again.') {
    super(message);
    this.name = 'DebtWriteConflictError';
  }
}

/** A write may have succeeded; do not retry with a new debt identifier. */
export class DebtWriteUncertainError extends Error {
  constructor(message = 'The debt update could not be confirmed. Reconnect and retry with the same draft.') {
    super(message);
    this.name = 'DebtWriteUncertainError';
  }
}

function debtRowMatches(
  row: SupabaseDebtRow, values: Record<string, string | number | null>, currency: string,
): boolean {
  return row.name === values.name && row.category === values.category &&
    row.due_day === values.due_day && Number(row.apr) === values.apr &&
    canonicalDebtAmount(row.balance, currency, true) === values.balance &&
    canonicalDebtAmount(row.minimum_payment, currency) === values.minimum_payment &&
    canonicalOptionalDebtAmount(row.original_balance, currency) === values.original_balance &&
    canonicalOptionalDebtAmount(row.credit_limit, currency) === values.credit_limit;
}

/** Read back a disputed or interrupted write; a failed reconciliation is uncertain. */
async function verifyDebtRow(userId: string, debtId: string): Promise<SupabaseDebtRow | null> {
  const { data, error } = await getSupabaseClient().from('debts')
    .select(DEBT_ROW_COLUMNS).eq('user_id', userId).eq('id', debtId).maybeSingle();
  if (error) {
    const incompatible = schemaCompatibilityError(error);
    if (incompatible) throw incompatible;
    throw new DebtWriteUncertainError();
  }
  return data as SupabaseDebtRow | null;
}

/** A missing row alone is not proof of deletion (RLS may also hide rows). */
async function verifyDebtTombstone(userId: string, debtId: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient().from('debtfree_deleted_debt_ids')
    .select('id, deleted_user_id').eq('id', debtId).eq('deleted_user_id', userId).maybeSingle();
  if (error) throw schemaCompatibilityError(error) ?? new DebtWriteUncertainError();
  return data?.id === debtId && data.deleted_user_id === userId;
}

async function cacheConfirmedDebts(next: UserOnboardingData): Promise<void> {
  try { await chunkedStore.setItem(localStateKey(next.userId), JSON.stringify(next)); } catch {
    // Optional local cache may fail; the server-confirmed table result wins.
  }
}

/**
 * Persist exactly one authoritative debt row. A stable UI draft ID allows safe
 * retries, while conditional revisions prevent stale cross-device overwrites.
 * Profile metadata is deliberately NOT written as a second financial copy.
 */
export async function upsertUserDebt(
  current: UserOnboardingData,
  debtInput: Omit<DebtItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): Promise<UserOnboardingData> {
  await assertStoredCurrencyUnchanged(current);
  await assertAuthenticatedUser(current.userId);
  const debtId = debtInput.id ?? Crypto.randomUUID();
  const existing = current.debts.find(d => d.id === debtId);
  if (existing && (!Number.isSafeInteger(existing.serverVersion) || (existing.serverVersion ?? 0) < 1)) {
    throw new OnboardingDataUnavailableError('Debt revision is unavailable. Apply the approved sandbox concurrency migration before editing.');
  }
  const currency = resolveCurrencyOption(current).code;
  const now = new Date().toISOString();
  const values = {
    name: debtInput.name.trim(), category: debtInput.category, due_day: debtInput.dueDay,
    balance: canonicalDebtAmount(debtInput.balance, currency, true),
    apr: debtInput.apr,
    minimum_payment: canonicalDebtAmount(debtInput.minimumPayment, currency),
    original_balance: canonicalOptionalDebtAmount(debtInput.originalBalance, currency),
    credit_limit: canonicalOptionalDebtAmount(debtInput.creditLimit, currency),
  };
  const supabase = getSupabaseClient();
  const response = existing
    ? await supabase.from('debts').update({ ...values, updated_at: now })
      .eq('user_id', current.userId).eq('id', debtId).eq('version', existing.serverVersion!)
      .select(DEBT_ROW_COLUMNS)
    : await supabase.from('debts').insert({ ...values, id: debtId, user_id: current.userId, updated_at: now })
      .select(DEBT_ROW_COLUMNS);

  // A network interruption or zero conditional-update rows is not confirmed
  // failure. Query server state first; accept an identical completed write.
  let row = Array.isArray(response.data) && response.data.length === 1
    ? response.data[0] as SupabaseDebtRow : null;
  if (response.error || !row) {
    const observed = await verifyDebtRow(current.userId, debtId);
    if (observed && debtRowMatches(observed, values, currency)) row = observed;
    else if (observed || existing || response.error?.code === '23505') throw new DebtWriteConflictError();
    else if (response.error && isConfirmedServerRejection(response.error.code)) {
      throw new DebtWriteFailedError(`The server rejected the debt save: ${response.error.message}`);
    }
    else if (response.error) throw new DebtWriteUncertainError(`Could not verify debt save: ${response.error.message}`);
    else throw new DebtWriteUncertainError();
  }
  if (!row) throw new DebtWriteUncertainError();
  const [savedDebt] = mergeDebtsWithDatabaseRows(existing ? [existing] : [], [row], currency);
  const updatedDebts = existing
    ? current.debts.map(d => d.id === debtId ? savedDebt : d)
    : [...current.debts, savedDebt];
  const next: UserOnboardingData = { ...current, debts: updatedDebts };
  await cacheConfirmedDebts(next);
  return next;
}

/**
 * Deletion uses the same server-side revision guard as updates. The server's
 * tombstone trigger permanently rejects recreation of a confirmed deleted ID.
 */
export async function deleteUserDebt(
  current: UserOnboardingData,
  debtId: string,
): Promise<UserOnboardingData> {
  await assertAuthenticatedUser(current.userId);
  const existing = current.debts.find(d => d.id === debtId);
  if (!existing) return current; // Already removed in this snapshot.
  if (!Number.isSafeInteger(existing.serverVersion) || (existing.serverVersion ?? 0) < 1) {
    throw new OnboardingDataUnavailableError('Debt revision is unavailable. Apply the approved sandbox concurrency migration before deleting.');
  }
  const { data, error } = await getSupabaseClient().from('debts').delete()
    .eq('user_id', current.userId).eq('id', debtId)
    .eq('version', existing.serverVersion!).select('id');
  if (error || !Array.isArray(data) || data.length !== 1) {
    const observed = await verifyDebtRow(current.userId, debtId);
    if (observed) {
      if (error && isConfirmedServerRejection(error.code)) throw new DebtWriteFailedError(`The server rejected debt deletion: ${error.message}`);
      throw new DebtWriteConflictError();
    }
    // A verified tombstone, not merely an invisible/absent row, confirms deletion.
    if (!await verifyDebtTombstone(current.userId, debtId)) {
      if (error && isConfirmedServerRejection(error.code)) {
        throw new DebtWriteFailedError(`The server rejected debt deletion: ${error.message}`);
      }
      throw new DebtWriteUncertainError('Debt row is not visible, but no deletion tombstone was confirmed. Reload before retrying.');
    }
  }
  const next = { ...current, debts: current.debts.filter(d => d.id !== debtId) };
  await cacheConfirmedDebts(next);
  return next;
}

/**
 * Completely reset the user's onboarding progress and debts in both local SecureStore
 * and the sandbox Supabase project (`public.debts` + `auth.users.user_metadata`).
 */
export async function resetUserOnboardingData(userId: string): Promise<void> {
  await assertAuthenticatedUser(userId);
  const supabase = getSupabaseClient();
  const { error: deleteError } = await supabase.from('debts').delete().eq('user_id', userId);
  if (deleteError) throw new Error(`Could not reset saved debt accounts: ${deleteError.message}`);
  const fresh = createDefaultOnboardingData(userId);
  const { error: updateError } = await supabase.auth.updateUser({ data: { debtfree_native_v1: fresh } });
  if (updateError) throw new Error(`Could not reset saved onboarding data: ${updateError.message}`);
  try { await chunkedStore.removeItem(localStateKey(userId)); } catch {
    // The confirmed remote reset wins. A stale cache must never replace it.
  }
}

/**
 * Request native OS notification permission when the user taps "Enable notifications".
 */
export async function requestNativeNotificationPermission(): Promise<
  'granted' | 'denied' | 'unavailable'
> {
  if (Platform.OS === 'android') {
    const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
    if (apiLevel < 33) {
      // Android 12 and below grant notification permission at install time
      return 'granted';
    }
    try {
      const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
      if (!permission) return 'granted';
      const alreadyGranted = await PermissionsAndroid.check(permission);
      if (alreadyGranted) return 'granted';
      const result = await PermissionsAndroid.request(permission, {
        title: 'Enable DebtFree Payment Reminders',
        message:
          'Allow DebtFree to send upcoming payment reminders, past-due alerts, and payoff milestone notifications.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now',
      });
      return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
    } catch {
      return 'unavailable';
    }
  }
  return 'unavailable';
}
