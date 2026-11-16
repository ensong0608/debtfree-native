import { PermissionsAndroid, Platform } from 'react-native';
import { PERSONAL_SETTINGS_FIELDS, SHARED_SETTINGS_FIELDS, reconcileConfirmedPersonalSettings } from './settings-contract';
import type { Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { createSessionVerification, getSupabaseClient } from './auth';
import type { SessionVerification } from './identity-verification';
import { createChunkedStorage, type KeyValueStore } from './secure-chunks';
import {
  createDefaultOnboardingData,
  resolveCurrencyOption,
  type DebtItem,
  type UserOnboardingData,
} from './onboarding-domain';

import { assertCurrencyChangeAllowed, canonicalDebtAmount, canonicalOptionalDebtAmount, decodeDebtAmount, resolveDatabaseDebtCategory, validateStoredAmounts } from './debt-storage-domain';
import { parseDateOnly } from './finance/calendar';
import type { UnifiedLoanSettings } from './finance/unified-loan';
import type { RecurringBill } from './finance/recurring-bills';
import { validateObligationSchedule } from './finance/obligation-schedule';
import { assertHouseholdFinanceContextReady, clearUserFinanceStorage, clearUserFinanceStorageForAccountDeletion, deleteAccountHistoryWithCommit, loadFinanceRecords } from './finance-storage';
import { isLocalAcceptanceOwner, saveLocalAcceptanceFixture } from './dev/local-acceptance';
import { loadVerifiedHouseholdContext } from './household-service';
import type { HouseholdContext } from './household-context';
import { categoryDiagnostics, type DebtCategoryDiagnostic } from './recovery-domain';
export type { DebtCategoryDiagnostic } from './recovery-domain';

const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const secureStoreAdapter: KeyValueStore = {
  getItem: key => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, secureOptions),
  removeItem: key => SecureStore.deleteItemAsync(key),
};

const chunkedStore = createChunkedStorage(secureStoreAdapter, () => Crypto.randomUUID());

function secureKeyPart(value: string): string {
  return Array.from(value).map(character => character.codePointAt(0)!.toString(16)).join('-');
}

function localStateKey(userId: string, householdId: string): string {
  return `debtfree-onboarding-v2.${secureKeyPart(userId)}.${secureKeyPart(householdId)}`;
}

function legacyLocalStateKey(userId: string): string {
  const safeId = userId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `debtfree-onboarding-v1.${safeId}`;
}

function localStateIndexKey(userId: string): string {
  return `debtfree-onboarding-index-v2.${secureKeyPart(userId)}`;
}

async function rememberHouseholdCache(userId: string, householdId: string): Promise<void> {
  const key = localStateIndexKey(userId);
  const raw = await chunkedStore.getItem(key);
  let ids: string[] = [];
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some(id => typeof id !== 'string' || !id || id !== id.trim())) {
      throw new Error('The household cache index is invalid; local data was preserved.');
    }
    ids = parsed;
  }
  if (!ids.includes(householdId)) await chunkedStore.setItem(key, JSON.stringify([...ids, householdId]));
}

async function cacheHouseholdData(data: UserOnboardingData): Promise<void> {
  await rememberHouseholdCache(data.userId, data.householdId);
  await chunkedStore.setItem(localStateKey(data.userId, data.householdId), JSON.stringify(data));
}

async function householdCacheIds(userId: string): Promise<string[]> {
  const raw = await chunkedStore.getItem(localStateIndexKey(userId));
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some(id => typeof id !== 'string' || !id || id !== id.trim())) {
    throw new Error('The household cache index is invalid; local data was preserved.');
  }
  return [...new Set(parsed)];
}

/** A failed remote read must not be misrepresented as an empty account list. */
export class OnboardingDataUnavailableError extends Error {
  constructor(message = 'Your saved financial data could not be verified. Reconnect and try again.') {
    super(message);
    this.name = 'OnboardingDataUnavailableError';
  }
}

export class HouseholdDataUnavailableError extends OnboardingDataUnavailableError {
  readonly context: HouseholdContext;
  readonly summaries: import('./household-context').HouseholdMembershipSummary[];
  readonly diagnostics: DebtCategoryDiagnostic[];
  constructor(context: HouseholdContext, summaries: import('./household-context').HouseholdMembershipSummary[], diagnostics: DebtCategoryDiagnostic[]) {
    super('Choose an account category to finish loading your household.');
    this.name = 'HouseholdDataUnavailableError';
    this.context = context;
    this.summaries = summaries;
    this.diagnostics = diagnostics;
  }
}

type SupabaseDebtRow = {
  id: string;
  user_id: string;
  household_id: string | null;
  name: string;
  category: string | null;
  balance: number | string;
  apr: number | string;
  minimum_payment: number | string;
  original_balance: number | string | null;
  credit_limit: number | string | null;
  due_day: number | null;
  annual_fee_amount?: number | string | null;
  annual_fee_next_due_date?: string | null;
  created_at?: string;
  updated_at?: string;
  version?: number | string;
};

const DEBT_ROW_COLUMNS = 'id, user_id, household_id, name, category, balance, apr, minimum_payment, original_balance, due_day, credit_limit, annual_fee_amount, annual_fee_next_due_date, created_at, updated_at, version';

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
    const annualFeeNextDueDate = row.annual_fee_next_due_date === undefined
      ? existing?.annualFeeNextDueDate ?? null
      : row.annual_fee_next_due_date == null ? null : parseDateOnly(row.annual_fee_next_due_date);
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
      annualFeeAmount: row.annual_fee_amount === undefined
        ? existing?.annualFeeAmount ?? null
        : row.annual_fee_amount == null ? null : decodeDebtAmount(row.annual_fee_amount, currency),
      annualFeeNextDueDate,
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

/** Only personal fields may be restored from the partial profile envelope. */
function projectPersonalProfile(raw: unknown, userId: string): UserOnboardingData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== 1 || value.userId !== userId || typeof value.householdId !== 'string' || !value.householdId ||
      (value.settingsRevision !== undefined && (!Number.isSafeInteger(value.settingsRevision) || (value.settingsRevision as number) < 0))) return null;
  const result = createDefaultOnboardingData(userId);
  const valid: Record<string, (v: unknown) => boolean> = {
    currentStage: v => typeof v === 'string', signupCompleted: v => typeof v === 'boolean', onboardingCompleted: v => typeof v === 'boolean',
    goals: v => Array.isArray(v) && v.every(x => typeof x === 'string'), referralSource: v => typeof v === 'string',
    consideredBeforeAi: v => v === null || v === 'yes' || v === 'no', managesWithPartner: v => v === null || typeof v === 'boolean',
    worksWithProfessional: v => v === null || typeof v === 'boolean', selectedPlan: v => typeof v === 'string',
    notifications: v => !!v && typeof v === 'object' && !Array.isArray(v), completedAt: v => v === null || typeof v === 'string',
  };
  for (const field of PERSONAL_SETTINGS_FIELDS) {
    if (value[field] !== undefined && valid[field](value[field])) Object.assign(result, { [field]: value[field] });
  }
  result.notifications = { ...createDefaultOnboardingData(userId).notifications, ...result.notifications };
  result.householdId = value.householdId as string;
  result.settingsRevision = (value.settingsRevision as number | undefined) ?? 0;
  if (typeof value.updatedAt === 'string') result.updatedAt = value.updatedAt;
  return result;
}

/**
 * public.debts is the only authoritative debt store. Auth metadata stores profile
 * preferences, not debt records. Per-user SecureStore is a recovery cache only.
 */
export async function loadUserOnboardingData(
  session: Session,
  options: { householdId?: string | null; suppressBootstrap?: boolean; verification?: SessionVerification; onMembershipsVerified?: (summaries: import('./household-context').HouseholdMembershipSummary[]) => void } = {},
): Promise<UserOnboardingData> {
  const userId = session.user.id;
  const fallback = createDefaultOnboardingData(userId);
  const verification = options.verification ?? createSessionVerification(session);
  const verifiedUser = await verification.getUser(session);
  const metaRaw = verifiedUser.user_metadata?.debtfree_profile_v2;
  const remoteData = projectPersonalProfile(metaRaw, userId);

  let householdSelection: Awaited<ReturnType<typeof loadVerifiedHouseholdContext>>;
  try {
    householdSelection = await loadVerifiedHouseholdContext(session, {
      requestedHouseholdId: options.householdId,
      suppressBootstrap: options.suppressBootstrap,
      verification,
      bootstrapIdentity: {
        householdName: 'My Household',
        currencyCode: 'USD',
      },
    });
  } catch (error) {
    throw new OnboardingDataUnavailableError(error instanceof Error ? error.message : 'Your household membership could not be verified.');
  }

  let householdSettings: Record<string, unknown> | null = null;
  let householdRevision = -1;
  let context: HouseholdContext | null = null;
  // Membership can change between context discovery and the settings read.
  // Re-list the same requested household once, then stop rather than combining
  // settings from one membership version with data authorized by another.
  for (let attempt = 0; attempt < 2; attempt++) {
    const summary = householdSelection.selected;
    const nextContext: HouseholdContext = {
      userId,
      householdId: summary.householdId,
      role: summary.role,
      membershipVersion: summary.membershipVersion,
    };
    const result = await getSupabaseClient().rpc('debtfree_get_household_settings', {
      p_household_id: summary.householdId,
    });
    const payload = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? result.data as Record<string, unknown> : null;
    const revision = payload?.revision;
    const numericRevision = typeof revision === 'number' ? revision : typeof revision === 'string' && /^\d+$/.test(revision) ? Number(revision) : NaN;
    const settings = payload?.settings;
    const matches = !result.error && payload?.status === 'ok'
      && payload.householdId === summary.householdId
      && payload.role === summary.role
      && payload.membershipVersion === summary.membershipVersion
      && Number.isSafeInteger(numericRevision) && numericRevision >= 0
      && settings !== null && typeof settings === 'object' && !Array.isArray(settings)
      && (settings as Record<string, unknown>).householdId === summary.householdId;
    if (matches) {
      householdSettings = settings as Record<string, unknown>;
      householdRevision = numericRevision;
      context = nextContext;
      break;
    }
    if (attempt === 1) {
      throw schemaCompatibilityError(result.error) ?? new OnboardingDataUnavailableError(
        'The selected household changed while it was loading. Refresh and try again.',
      );
    }
    try {
      householdSelection = await loadVerifiedHouseholdContext(session, { requestedHouseholdId: summary.householdId, verification });
    } catch (error) {
      throw new OnboardingDataUnavailableError(error instanceof Error ? error.message : 'Your household membership changed while it was loading.');
    }
  }
  options.onMembershipsVerified?.(householdSelection.summaries);
  if (!householdSettings || !context || householdRevision < 0) {
    throw new OnboardingDataUnavailableError('Household settings could not be verified.');
  }

  try {
    await assertHouseholdFinanceContextReady(context, { allowCurrentMembershipPending: true });
  } catch (error) {
    throw new OnboardingDataUnavailableError(error instanceof Error
      ? error.message
      : 'Unresolved finance changes must be reviewed before opening this household.');
  }

  let localData: UserOnboardingData | null = null;
  let legacyCache = false;
  try {
    const raw = await chunkedStore.getItem(localStateKey(userId, context.householdId));
    if (raw) {
      const parsed = JSON.parse(raw) as UserOnboardingData;
      if (parsed?.userId === userId && parsed.version === 1 && parsed.householdId === context.householdId) localData = parsed;
    }
  } catch {
    // Damaged local cache cannot replace authoritative server records.
  }
  // A v1 cache can move only when the server-verified legacy profile proves
  // its original household identity. Keep the old key intact for recovery.
  if (!localData && remoteData?.householdId === context.householdId) {
    try {
      const raw = await chunkedStore.getItem(legacyLocalStateKey(userId));
      const parsed = raw ? JSON.parse(raw) as UserOnboardingData : null;
      if (parsed?.userId === userId && parsed.version === 1 && parsed.householdId === context.householdId) { localData = parsed; legacyCache = true; }
    } catch {
      // Keep malformed legacy evidence untouched; server data remains authoritative.
    }
  }
  // An invitee can reopen the app before saving their first personal signup
  // answer. Its household cache contains server-read debts, not local onboarding
  // debts awaiting upload. Current membership/settings/debts are still re-read.
  const sharedEntryCache = localData && context.role !== 'owner'
    && localData.householdContext?.userId === userId
    && localData.householdContext.householdId === context.householdId
    && localData.profileSettingsRevision === 0 && !localData.signupCompleted && !localData.onboardingCompleted;
  if (localData && !remoteData && !sharedEntryCache && (localData.onboardingCompleted || localData.signupCompleted || localData.debts.length > 0)) {
    throw new OnboardingDataUnavailableError('This device has local-only onboarding data. Automatic overwrite is blocked; recover it before continuing.');
  }
  const personalFields = (d: UserOnboardingData) => ({
    currentStage: d.currentStage, signupCompleted: d.signupCompleted, onboardingCompleted: d.onboardingCompleted,
    goals: d.goals, referralSource: d.referralSource, consideredBeforeAi: d.consideredBeforeAi,
    managesWithPartner: d.managesWithPartner, worksWithProfessional: d.worksWithProfessional,
    selectedPlan: d.selectedPlan, notifications: d.notifications, completedAt: d.completedAt,
  });
  if (localData && remoteData && !legacyCache && localData.profileSettingsRevision !== undefined && localData.profileSettingsRevision >= (remoteData.settingsRevision ?? 0) && localData.updatedAt > remoteData.updatedAt &&
      JSON.stringify(personalFields(localData)) !== JSON.stringify(personalFields(remoteData))) {
    throw new OnboardingDataUnavailableError('This device has unconfirmed newer local changes. Automatic overwrite is blocked; recover them before continuing.');
  }

  const base = remoteData ?? fallback;
  const shared = householdSettings as Partial<UserOnboardingData>;
  const verifiedBase: UserOnboardingData = {
    ...base,
    ...shared,
    userId,
    householdId: context.householdId,
    householdContext: context,
    settingsRevision: householdRevision,
    profileSettingsRevision: remoteData?.settingsRevision ?? 0,
    updatedAt: localData?.updatedAt ?? base.updatedAt,
    debts: [],
  };
  const supabase = getSupabaseClient();
  const { data: rows, error } = await supabase.from('debts')
    .select(DEBT_ROW_COLUMNS)
    .eq('household_id', context.householdId)
    .order('created_at', { ascending: true });
  if (error || !Array.isArray(rows)) {
    throw schemaCompatibilityError(error) ?? new OnboardingDataUnavailableError('Unable to load saved debt accounts. Retry when connected.');
  }
  if (rows.some((row: SupabaseDebtRow) => row.household_id !== context!.householdId)) {
    throw new OnboardingDataUnavailableError('Received a debt record outside the selected household.');
  }
  const diagnostics = categoryDiagnostics(rows as SupabaseDebtRow[], category => resolveDatabaseDebtCategory(category, undefined));
  if (diagnostics.length) throw new HouseholdDataUnavailableError(context, householdSelection.summaries, diagnostics);
  const verified: UserOnboardingData = {
    ...verifiedBase,
    debts: mergeDebtsWithDatabaseRows([], rows as SupabaseDebtRow[], resolveCurrencyOption(verifiedBase).code),
  };
  validateStoredAmounts(verified);
  try { await cacheHouseholdData(verified); } catch {
    // A failed optional cache write must not change the verified server result.
  }
  return verified;
}

async function assertStoredCurrencyUnchanged(data: UserOnboardingData): Promise<void> {
  if (isLocalAcceptanceOwner(data.userId)) return;
  const nextCurrency = resolveCurrencyOption(data).code;
  const { data: sessionResult, error } = await getSupabaseClient().auth.getSession();
  if (error || !sessionResult.session || sessionResult.session.user.id !== data.userId) {
    throw new OnboardingDataUnavailableError('Financial records could not be verified for this currency change. Reconnect and retry.');
  }
  const context = data.householdContext;
  if (!context || context.userId !== data.userId || context.householdId !== data.householdId) {
    throw new OnboardingDataUnavailableError('Household currency could not be verified. Reconnect and retry.');
  }
    const { data: rawSettings, error: settingsError } = await getSupabaseClient().rpc('debtfree_get_household_settings', {
      p_household_id: data.householdId,
    });
    const payload = rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)
      ? rawSettings as Record<string, unknown> : null;
    const settingsObj = !settingsError && payload?.status === 'ok' && payload.householdId === data.householdId
      && payload.role === context.role && payload.membershipVersion === context.membershipVersion
      && payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings)
      ? payload.settings as Partial<UserOnboardingData> : null;
  if (!settingsObj || typeof settingsObj.currencyCode !== 'string' || !settingsObj.currencyCode) {
    throw new OnboardingDataUnavailableError('Household currency could not be verified. Reconnect and retry.');
  }
  const priorHouseholdCurrency = resolveCurrencyOption({ ...data, ...settingsObj }).code;
  const priorUser = { ...data, currencyCode: priorHouseholdCurrency };
  if (priorHouseholdCurrency === nextCurrency) return;
  const records = await loadFinanceRecords({
    session: sessionResult.session,
    userId: data.userId,
    currency: priorHouseholdCurrency,
    householdContext: data.householdContext,
  });
  if (records.syncStatus !== 'synced') {
    throw new OnboardingDataUnavailableError('Financial records could not be verified for this currency change. Reconnect and retry.');
  }
  assertCurrencyChangeAllowed(priorUser, nextCurrency, {
    transactions: records.transactions,
    recurringBills: records.recurringBills,
    reconciliationAnchors: records.reconciliationAnchors,
    complete: true,
  });
}

/** The database, not a client timestamp, must decide whether settings may be updated. */
export class FinancialSettingsConflictError extends Error {
  constructor() { super('These settings changed elsewhere. Review the latest values and try your change again.'); this.name = 'FinancialSettingsConflictError'; }
}

export class FinancialSettingsUncertainError extends Error {
  constructor() { super('We could not confirm this save. Reconnect and refresh this screen to check the latest values.'); this.name = 'FinancialSettingsUncertainError'; }
}

function revisionOf(value: UserOnboardingData | null | undefined): number {
  const revision = value?.settingsRevision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new OnboardingDataUnavailableError('Saved settings revision is invalid.');
  return revision;
}

function profileRevisionOf(value: UserOnboardingData | null | undefined): number {
  const revision = value?.profileSettingsRevision ?? value?.settingsRevision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new OnboardingDataUnavailableError('Saved profile revision is invalid.');
  return revision;
}

type PersistedProfileSettings = Record<string, unknown> & { userId: string; version: 1; householdId: string; settingsRevision: number; debts: [] };

function persistedSettings(data: UserOnboardingData): PersistedProfileSettings {
  const profile: Record<string, unknown> = {
    userId: data.userId,
    version: 1,
    householdId: data.householdId,
    settingsRevision: data.profileSettingsRevision ?? 0,
    debts: [],
  };
  for (const field of [...PERSONAL_SETTINGS_FIELDS, 'updatedAt'] as const) {
    if (data[field] !== undefined) profile[field] = data[field];
  }
  return profile as PersistedProfileSettings;
}

function persistedHouseholdSettings(data: UserOnboardingData): Record<string, unknown> {
  const result: Record<string, unknown> = { householdId: data.householdId };
  for (const field of SHARED_SETTINGS_FIELDS) {
    const value = data[field];
    if (value !== undefined) result[field] = value;
  }
  return result;
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
    const { settingsRevision: _settingsRevision, updatedAt: _updatedAt, ...rest } = persistedSettings(value);
    return canonical(rest);
  };
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}

function canonicalJson(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item !== null && typeof item === 'object') {
      const object = item as Record<string, unknown>;
      return Object.fromEntries(Object.keys(object).sort().map(key => [key, canonical(object[key])]));
    }
    return item;
  };
  return JSON.stringify(canonical(value));
}

async function saveHouseholdSettings(data: UserOnboardingData): Promise<number> {
  const context = data.householdContext;
  if (!context || context.userId !== data.userId || context.householdId !== data.householdId) {
    throw new OnboardingDataUnavailableError('A current server-verified household context is required to save shared settings.');
  }
  const expectedRevision = revisionOf(data);
  const readCurrent = async () => {
    const { data: raw, error } = await getSupabaseClient().rpc('debtfree_get_household_settings', {
      p_household_id: context.householdId,
    });
    const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    const revisionRaw = value?.revision;
    const revision = typeof revisionRaw === 'number' ? revisionRaw
      : typeof revisionRaw === 'string' && /^\d+$/.test(revisionRaw) ? Number(revisionRaw) : NaN;
    const settings = value?.settings;
    if (error || value?.status !== 'ok' || value.householdId !== context.householdId
        || value.role !== context.role || value.membershipVersion !== context.membershipVersion
        || !Number.isSafeInteger(revision) || revision < 0
        || !settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw schemaCompatibilityError(error) ?? new FinancialSettingsUncertainError();
    }
    return { revision, settings: settings as Record<string, unknown> };
  };

  const desired = persistedHouseholdSettings(data);
  const before = await readCurrent();
  if (before.revision !== expectedRevision) throw new FinancialSettingsConflictError();
  if (!Object.hasOwn(desired, 'archivedPaidOffDebtIds') && Object.hasOwn(before.settings, 'archivedPaidOffDebtIds')) {
    desired.archivedPaidOffDebtIds = before.settings.archivedPaidOffDebtIds;
  }
  if (canonicalJson(before.settings) === canonicalJson(desired)) return expectedRevision;

  const response = await getSupabaseClient().rpc('debtfree_save_household_settings', {
    p_household_id: context.householdId,
    p_expected_revision: expectedRevision,
    p_expected_membership_version: context.membershipVersion,
    p_settings: desired,
  });
  const saved = response.data && typeof response.data === 'object' && !Array.isArray(response.data)
    ? response.data as Record<string, unknown> : null;
  const savedRevision = typeof saved?.revision === 'number' ? saved.revision
    : typeof saved?.revision === 'string' && /^\d+$/.test(saved.revision) ? Number(saved.revision) : NaN;
  if (!response.error && saved?.status === 'saved' && saved.householdId === context.householdId
      && saved.membershipVersion === context.membershipVersion && savedRevision === expectedRevision + 1
      && canonicalJson(saved.settings) === canonicalJson(desired)) return savedRevision;
  if (saved?.status === 'conflict' || saved?.status === 'membership_version_conflict') throw new FinancialSettingsConflictError();

  // If the response was lost, authoritative readback can confirm only the exact
  // next revision and exact payload. Never retry the write with a new revision.
  let after: { revision: number; settings: Record<string, unknown> };
  try { after = await readCurrent(); } catch { throw new FinancialSettingsUncertainError(); }
  if (after.revision === expectedRevision + 1 && canonicalJson(after.settings) === canonicalJson(desired)) return after.revision;
  if (after.revision !== expectedRevision) throw new FinancialSettingsConflictError();
  throw schemaCompatibilityError(response.error) ?? new FinancialSettingsUncertainError();
}

/** Shared data uses household CAS; onboarding/profile preferences remain user-scoped. */
export async function saveUserOnboardingData(data: UserOnboardingData, options?: { personalOnly?: boolean }): Promise<UserOnboardingData> {
  if (isLocalAcceptanceOwner(data.userId)) {
    validateStoredAmounts(data);
    return saveLocalAcceptanceFixture(data);
  }
  if (!options?.personalOnly) await assertStoredCurrencyUnchanged(data);
  validateStoredAmounts(data);
  // Read the personal baseline before dispatching either write. A profile's
  // original household binding is separate from the active shared household.
  const currentUser = await assertAuthenticatedUser(data.userId);
  const rawProfile = currentUser.user_metadata?.debtfree_profile_v2;
  let confirmedProfile = projectPersonalProfile(rawProfile, data.userId) ?? createDefaultOnboardingData(data.userId);
  const expectedProfileRevision = profileRevisionOf(data);
  const profileData = { ...data, householdId: confirmedProfile.householdId };
  const personalChanged = !sameSettings(confirmedProfile, profileData);
  if (personalChanged && (confirmedProfile.settingsRevision ?? 0) !== expectedProfileRevision) {
    const error = new FinancialSettingsConflictError();
    throw error;
  }
  const householdRevision = options?.personalOnly ? revisionOf(data) : await saveHouseholdSettings(data);
  try {
  if (!personalChanged) {
    const confirmed = { ...data, settingsRevision: householdRevision, profileSettingsRevision: confirmedProfile.settingsRevision ?? 0 };
    try { await cacheHouseholdData(confirmed); } catch { /* optional */ }
    return confirmed;
  }
  const stamped = persistedSettings({
    ...profileData,
    profileSettingsRevision: expectedProfileRevision,
    updatedAt: new Date().toISOString(),
  });
  const { data: saved, error } = await getSupabaseClient().rpc('debtfree_save_settings', {
    p_expected_revision: expectedProfileRevision,
    p_settings: stamped,
  });
  let profileRevision: number | null = null;
  if (!error && saved && typeof saved === 'object' && !Array.isArray(saved)) {
    const candidate = saved as UserOnboardingData;
    if (candidate.userId === data.userId && candidate.householdId === profileData.householdId
        && candidate.settingsRevision === expectedProfileRevision + 1 && sameSettings(candidate, profileData)) {
      profileRevision = candidate.settingsRevision;
    }
  }
  if (profileRevision === null) {
    // Lost RPC response: read the server before declaring failure or retrying.
    const user = await assertAuthenticatedUser(data.userId);
    const raw = user.user_metadata?.debtfree_profile_v2;
    const remote = projectPersonalProfile(raw, data.userId);
    if (remote?.userId === data.userId && remote.version === 1 && remote.householdId === profileData.householdId) confirmedProfile = remote;
    if (remote?.userId === data.userId && remote.householdId === profileData.householdId
        && remote.settingsRevision === expectedProfileRevision + 1 && sameSettings(remote, profileData)) {
      profileRevision = remote.settingsRevision;
    } else {
      const incompatible = schemaCompatibilityError(error);
      if (incompatible) throw incompatible;
      if (remote?.userId === data.userId && remote.settingsRevision !== expectedProfileRevision ||
          error?.code === 'P0001' && error.message?.includes('DEBTFREE_SETTINGS_CONFLICT')) {
        throw new FinancialSettingsConflictError();
      }
      throw new FinancialSettingsUncertainError();
    }
  }
  const confirmed: UserOnboardingData = {
    ...data,
    settingsRevision: householdRevision,
    profileSettingsRevision: profileRevision,
    updatedAt: stamped.updatedAt as string,
  };
  try { await cacheHouseholdData(confirmed); } catch { /* optional */ }
  return confirmed;
  } catch (error) {
    if (error && typeof error === 'object') Object.assign(error, { reconciledData: reconcileConfirmedPersonalSettings(data, confirmedProfile, householdRevision) });
    throw error;
  }
}

/** Save a narrow settings patch with CAS rebase only when none of its target fields changed. */
export async function saveUserOnboardingSettingsPatch(
  current: UserOnboardingData,
  patch: Partial<UserOnboardingData>,
  session: Session | null,
): Promise<UserOnboardingData> {
  if (Object.keys(patch).some(key => !(SHARED_SETTINGS_FIELDS as readonly string[]).includes(key))) {
    throw new Error('This shared-settings change includes an unsupported field. No changes were sent.');
  }
  if (isLocalAcceptanceOwner(current.userId)) return saveUserOnboardingData({ ...current, ...patch });
  const saveShared = async (base: UserOnboardingData) => {
    const candidate = { ...base, ...patch };
    await assertStoredCurrencyUnchanged(candidate);
    validateStoredAmounts(candidate);
    const settingsRevision = await saveHouseholdSettings(candidate);
    const confirmed = { ...candidate, settingsRevision };
    try { await cacheHouseholdData(confirmed); } catch { /* optional */ }
    return confirmed;
  };
  try {
    return await saveShared(current);
  } catch (error) {
    if (!(error instanceof FinancialSettingsConflictError || error instanceof FinancialSettingsUncertainError) || !session) throw error;
    let fresh: UserOnboardingData;
    try { fresh = await loadUserOnboardingData(session, { householdId: current.householdId }); }
    catch { throw error; }
    // Keep caller-owned drafts, pending data and account state; refresh only the
    // shared settings snapshot and its CAS revision.
    const shared = persistedHouseholdSettings(fresh);
    const reconciled = { ...current, ...shared, settingsRevision: fresh.settingsRevision, householdContext: fresh.householdContext } as UserOnboardingData;
    const keys = Object.keys(patch) as (keyof UserOnboardingData)[];
    if (keys.every(key => canonicalJson(fresh[key]) === canonicalJson(patch[key]))) return reconciled;
    const changed = keys.some(key => canonicalJson(fresh[key]) !== canonicalJson(current[key]));
    if (changed || error instanceof FinancialSettingsUncertainError) {
      Object.assign(error, { reconciledData: reconciled });
      throw error;
    }
    try { return await saveShared(reconciled); }
    catch (retryError) {
      // A dispatched retry may itself have committed; never present the pre-write
      // snapshot as authoritative without another read.
      if (retryError instanceof FinancialSettingsConflictError || retryError instanceof FinancialSettingsUncertainError) {
        try {
          const latest = await loadUserOnboardingData(session, { householdId: current.householdId });
          const snapshot = { ...current, ...persistedHouseholdSettings(latest), settingsRevision: latest.settingsRevision, householdContext: latest.householdContext } as UserOnboardingData;
          if (keys.every(key => canonicalJson(latest[key]) === canonicalJson(patch[key]))) return snapshot;
          Object.assign(retryError, { reconciledData: snapshot });
        } catch { /* Preserve the original uncertain outcome. */ }
      }
      throw retryError;
    }
  }
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
    canonicalOptionalDebtAmount(row.credit_limit, currency) === values.credit_limit &&
    canonicalOptionalDebtAmount(row.annual_fee_amount, currency) === values.annual_fee_amount &&
    (row.annual_fee_next_due_date ?? null) === values.annual_fee_next_due_date;
}

/** Read back a disputed or interrupted write; a failed reconciliation is uncertain. */
async function verifyDebtRow(householdId: string, debtId: string): Promise<SupabaseDebtRow | null> {
  const { data, error } = await getSupabaseClient().from('debts')
    .select(DEBT_ROW_COLUMNS).eq('household_id', householdId).eq('id', debtId).maybeSingle();
  if (error) {
    const incompatible = schemaCompatibilityError(error);
    if (incompatible) throw incompatible;
    throw new DebtWriteUncertainError();
  }
  return data as SupabaseDebtRow | null;
}

export async function cacheConfirmedDebts(next: UserOnboardingData): Promise<void> {
  try { await cacheHouseholdData(next); } catch {
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
  atomicLoanSettings?: UnifiedLoanSettings,
  legacyBillProof?: RecurringBill,
): Promise<UserOnboardingData> {
  if (atomicLoanSettings) {
    if (!debtInput.id || (debtInput.category !== 'Mortgage' && debtInput.category !== 'Auto loan')) throw new Error('Atomic loan save requires a mortgage or auto loan ID.');
    const schedule = atomicLoanSettings.obligationSchedules?.['debt:' + debtInput.id];
    if (debtInput.balance > 0 && (!schedule || debtInput.dueDay == null)) throw new Error('A due day and schedule are required for this loan.');
    if (schedule) validateObligationSchedule(schedule);
    const relation = current.loanBillPairingByDebtId?.[debtInput.id];
    if (!isLocalAcceptanceOwner(current.userId) && relation?.status === 'linked' && !relation.canonical && (legacyBillProof?.id !== relation.billId || !legacyBillProof?.updatedAt)) throw new OnboardingDataUnavailableError('Reload the legacy recurring payment before converting this loan. Its server revision is required.');
  }
  if (isLocalAcceptanceOwner(current.userId)) {
    const debtId = debtInput.id ?? Crypto.randomUUID();
    const existing = current.debts.some(debt => debt.id === debtId);
    const now = new Date().toISOString();
    const nextDebt: DebtItem = { ...debtInput, id: debtId, createdAt: current.debts.find(debt => debt.id === debtId)?.createdAt ?? now, updatedAt: now };
    const wasArchived = (current.archivedPaidOffDebtIds ?? []).includes(debtId);
    const archivedPaidOffDebtIds = nextDebt.balance > 0
      ? (current.archivedPaidOffDebtIds ?? []).filter(id => id !== debtId)
      : current.archivedPaidOffDebtIds;
    const archiveChanged = wasArchived && nextDebt.balance > 0;
    const next = {
      ...current,
      ...atomicLoanSettings,
      debts: existing ? current.debts.map(debt => debt.id === debtId ? nextDebt : debt) : [...current.debts, nextDebt],
      archivedPaidOffDebtIds,
      ...((archiveChanged || atomicLoanSettings) ? { settingsRevision: (current.settingsRevision ?? 0) + 1 } : {}),
    };
    return saveLocalAcceptanceFixture(next);
  }
  const householdContext = current.householdContext;
  if (!householdContext || householdContext.userId !== current.userId || householdContext.householdId !== current.householdId) {
    throw new OnboardingDataUnavailableError('A verified household context is required to change debt accounts.');
  }
  await assertStoredCurrencyUnchanged(current);
  await assertAuthenticatedUser(current.userId);
  const debtId = debtInput.id ?? Crypto.randomUUID();
  const existing = current.debts.find(d => d.id === debtId);
  if (existing && (!Number.isSafeInteger(existing.serverVersion) || (existing.serverVersion ?? 0) < 1)) {
    throw new OnboardingDataUnavailableError('Debt revision is unavailable. Apply the approved sandbox concurrency migration before editing.');
  }
  const currency = resolveCurrencyOption(current).code;
  const values = {
    name: debtInput.name.trim(), category: debtInput.category, due_day: debtInput.dueDay,
    balance: canonicalDebtAmount(debtInput.balance, currency, true),
    apr: debtInput.apr,
    minimum_payment: canonicalDebtAmount(debtInput.minimumPayment, currency),
    original_balance: canonicalOptionalDebtAmount(debtInput.originalBalance, currency),
    credit_limit: canonicalOptionalDebtAmount(debtInput.creditLimit, currency),
    annual_fee_amount: canonicalOptionalDebtAmount(debtInput.annualFeeAmount, currency),
    annual_fee_next_due_date: debtInput.annualFeeNextDueDate ?? null,
  };
  const debtRow = { ...values, id: debtId, user_id: current.userId, household_id: current.householdId };
  const supabase = getSupabaseClient();
  const desiredLoanSettings = atomicLoanSettings ? persistedHouseholdSettings({ ...current, ...atomicLoanSettings }) : null;
  const response = await Promise.resolve(supabase.rpc(atomicLoanSettings ? 'debtfree_upsert_household_loan_atomic' : 'debtfree_upsert_household_debt_atomic', {
    p_household_id: current.householdId,
    p_expected_membership_version: householdContext.membershipVersion,
    p_debt: debtRow,
    p_expected_version: existing?.serverVersion ?? null,
    p_idempotency_key: debtId,
    ...(desiredLoanSettings ? { p_expected_settings_revision: revisionOf(current), p_settings: desiredLoanSettings,
      p_legacy_bill_proof: legacyBillProof ? { id: legacyBillProof.id, updatedAt: legacyBillProof.updatedAt, amountMinor: legacyBillProof.amount.minorUnits, currency: legacyBillProof.amount.currency, dueDay: legacyBillProof.dueDay, category: legacyBillProof.category, paymentMethod: legacyBillProof.paymentMethod, active: legacyBillProof.active } : null } : {}),
  })).catch(() => ({ data: null, error: { message: 'Connection interrupted while saving the account', code: undefined } }));

  // A network interruption or zero conditional-update rows is not confirmed
  // failure. Query server state first; accept an identical completed write.
  const rpcData = response.data && typeof response.data === 'object' && !Array.isArray(response.data)
    ? response.data as Record<string, unknown> : null;
  let row = rpcData?.success === true && rpcData.row && typeof rpcData.row === 'object' && !Array.isArray(rpcData.row)
    ? rpcData.row as SupabaseDebtRow : null;
  if (atomicLoanSettings) {
    const incompatible = schemaCompatibilityError(response.error);
    if (incompatible) throw incompatible;
    if (response.error?.code === '40001' || response.error?.code === '23505' || response.error?.code === 'P0001' || response.error?.code === 'P0002') throw new DebtWriteConflictError();
    if (response.error && (isConfirmedServerRejection(response.error.code) || response.error.code === '22023')) throw new DebtWriteFailedError('The server rejected the loan save: ' + response.error.message);
    // A row-only match never proves an atomic loan save. Confirm its settings too.
    const expectedSettings = { ...desiredLoanSettings! };
    const reopened = (current.archivedPaidOffDebtIds ?? []).includes(debtId) && debtInput.balance > 0;
    if (reopened) expectedSettings.archivedPaidOffDebtIds = (current.archivedPaidOffDebtIds ?? []).filter(id => id !== debtId);
    const expectedRevision = revisionOf(current) + 1 + (reopened ? 1 : 0);
    let proof = rpcData;
    if (response.error || !row) {
      const [observed, settingsResponse] = await Promise.all([
        verifyDebtRow(current.householdId, debtId),
        supabase.rpc('debtfree_get_household_settings', { p_household_id: current.householdId }),
      ]);
      proof = !settingsResponse.error && settingsResponse.data && typeof settingsResponse.data === 'object'
        ? settingsResponse.data as Record<string, unknown> : null;
      if (!observed || !debtRowMatches(observed, values, currency)) throw new DebtWriteUncertainError('Loan save could not be verified. Reload before retrying; local records were preserved.');
      row = observed;
      if (proof?.status !== 'ok' || proof.householdId !== current.householdId || proof.membershipVersion !== householdContext.membershipVersion) throw new FinancialSettingsUncertainError();
    }
    if (!row || row.id !== debtId || !debtRowMatches(row, values, currency) || proof?.householdId !== current.householdId || proof.membershipVersion !== householdContext.membershipVersion) throw new DebtWriteUncertainError();
    const provenRevision = Number(proof?.revision);
    if (provenRevision !== expectedRevision || canonicalJson(proof?.settings) !== canonicalJson(expectedSettings)) {
      throw new FinancialSettingsUncertainError();
    }
  }
  if ((response.error && !atomicLoanSettings) || !row) {
    const observed = await verifyDebtRow(current.householdId, debtId);
    if (observed && debtRowMatches(observed, values, currency)) row = observed;
    else if (observed || existing || response.error?.code === '23505') throw new DebtWriteConflictError();
    else if (response.error && isConfirmedServerRejection(response.error.code)) {
      throw new DebtWriteFailedError(`The server rejected the debt save: ${response.error.message}`);
    }
    else if (response.error) throw new DebtWriteUncertainError(`Could not verify debt save: ${response.error.message}`);
    else throw new DebtWriteUncertainError();
  }
  if (!row) throw new DebtWriteUncertainError();
  if (row.household_id !== current.householdId) throw new DebtWriteUncertainError('The server returned a debt outside the selected household.');
  const [savedDebt] = mergeDebtsWithDatabaseRows(existing ? [existing] : [], [row], currency);
  const updatedDebts = existing
    ? current.debts.map(d => d.id === debtId ? savedDebt : d)
    : [...current.debts, savedDebt];
  const wasArchived = (current.archivedPaidOffDebtIds ?? []).includes(debtId);
  const reopenedArchivedDebt = wasArchived && savedDebt.balance > 0;
  const archivedPaidOffDebtIds = updatedDebts.some(debt => debt.id === debtId && debt.balance > 0)
    ? (current.archivedPaidOffDebtIds ?? []).filter(id => id !== debtId)
    : current.archivedPaidOffDebtIds;
  const next: UserOnboardingData = {
    ...current,
    ...atomicLoanSettings,
    debts: updatedDebts,
    archivedPaidOffDebtIds,
    ...(atomicLoanSettings ? { settingsRevision: revisionOf(current) + 1 + (reopenedArchivedDebt ? 1 : 0) }
      : reopenedArchivedDebt ? { settingsRevision: revisionOf(current) + 1 } : {}),
  };
  await cacheConfirmedDebts(next);
  return next;
}

export type AccountDeletionReceipt = {
  version: 1;
  success: true;
  operationId: string;
  debtId: string;
  billId: string | null;
  deletedTransactions: number;
  deletedReconciliationAnchors: number;
  deletedBills: number;
  deletedDebts: 1;
  settingsRevision: number;
  historyCleanupComplete: true;
};

export type DeleteUserDebtResult = { data: UserOnboardingData; receipt: AccountDeletionReceipt | null };

/** Remove only metadata identities owned by the deleted debt and exact removed bill. */
function settingsAfterDebtDeletion(data: UserOnboardingData, debtId: string, billId: string | null): UserOnboardingData {
  const loanBillPairingByDebtId = { ...(data.loanBillPairingByDebtId ?? {}) };
  delete loanBillPairingByDebtId[debtId];
  if (billId) {
    for (const [key, relation] of Object.entries(loanBillPairingByDebtId)) {
      if (relation?.billId === billId) delete loanBillPairingByDebtId[key];
    }
  }
  const mortgageEscrowByDebtId = { ...(data.mortgageEscrowByDebtId ?? {}) };
  const mortgageExtraPaymentByDebtId = { ...(data.mortgageExtraPaymentByDebtId ?? {}) };
  const debtPaymentSplitPlansByDebtId = { ...(data.debtPaymentSplitPlansByDebtId ?? {}) };
  const billPaymentSplitPlansByBillId = { ...(data.billPaymentSplitPlansByBillId ?? {}) };
  const recurringBillCategoryLabelByBillId = { ...(data.recurringBillCategoryLabelByBillId ?? {}) };
  const obligationSchedules = { ...(data.obligationSchedules ?? {}) };
  delete mortgageEscrowByDebtId[debtId];
  delete mortgageExtraPaymentByDebtId[debtId];
  delete debtPaymentSplitPlansByDebtId[debtId];
  delete obligationSchedules[`debt:${debtId}`];
  if (billId) {
    delete billPaymentSplitPlansByBillId[billId];
    delete recurringBillCategoryLabelByBillId[billId];
    delete obligationSchedules[`bill:${billId}`];
  }
  return {
    ...data,
    archivedPaidOffDebtIds: (data.archivedPaidOffDebtIds ?? []).filter(id => id !== debtId),
    loanBillPairingByDebtId,
    mortgageEscrowByDebtId,
    mortgageExtraPaymentByDebtId,
    debtPaymentSplitPlansByDebtId,
    billPaymentSplitPlansByBillId,
    recurringBillCategoryLabelByBillId,
    obligationSchedules,
  };
}

/**
 * Debt, exact paired bill history, settings and local finance caches are removed
 * only after the server returns a matching cleanup receipt.
 */
export async function deleteUserDebt(
  current: UserOnboardingData,
  debtId: string,
  localPairedBillId: string | null = null,
): Promise<DeleteUserDebtResult> {
  const existing = current.debts.find(d => d.id === debtId);
  if (!existing) return { data: current, receipt: null };
  if (isLocalAcceptanceOwner(current.userId)) {
    return deleteAccountHistoryWithCommit({
      userId: current.userId,
      householdContext: current.householdContext,
      debtId,
      commit: async () => {
        const saved = await saveLocalAcceptanceFixture(settingsAfterDebtDeletion({
          ...current,
          debts: current.debts.filter(debt => debt.id !== debtId),
        }, debtId, localPairedBillId));
        const receipt: AccountDeletionReceipt = {
          version: 1, success: true, operationId: Crypto.randomUUID(), debtId,
          billId: localPairedBillId, deletedTransactions: 0, deletedReconciliationAnchors: 0,
          deletedBills: localPairedBillId ? 1 : 0, deletedDebts: 1,
          settingsRevision: saved.settingsRevision ?? 0, historyCleanupComplete: true,
        };
        return {
          data: saved,
          billId: receipt.billId,
          deletedTransactions: receipt.deletedTransactions,
          deletedReconciliationAnchors: receipt.deletedReconciliationAnchors,
          receipt,
        };
      },
    }).then(result => ({ data: result.data, receipt: result.receipt }));
  }
  const householdContext = current.householdContext;
  if (!householdContext || householdContext.userId !== current.userId || householdContext.householdId !== current.householdId) {
    throw new OnboardingDataUnavailableError('A verified household context is required to delete an account.');
  }
  await assertAuthenticatedUser(current.userId);
  if (!Number.isSafeInteger(existing.serverVersion) || (existing.serverVersion ?? 0) < 1) {
    throw new OnboardingDataUnavailableError('Debt revision is unavailable. Apply the approved sandbox concurrency migration before deleting.');
  }
  return deleteAccountHistoryWithCommit({
    userId: current.userId,
    householdContext,
    debtId,
    commit: async () => {
      const operationId = Crypto.randomUUID();
      const { data, error } = await getSupabaseClient().rpc('debtfree_delete_household_debt_atomic', {
        p_household_id: current.householdId,
        p_expected_membership_version: householdContext.membershipVersion,
        p_debt_id: debtId,
        p_expected_version: existing.serverVersion!,
        p_operation_id: operationId,
      });
      if (error) {
        if (error.message.includes('ACCOUNT_DELETE_AMBIGUOUS_HISTORY')) {
          throw new DebtWriteConflictError(`Account deletion needs review. Resolve the linked transaction identities before retrying. ${error.message}`);
        }
        if (error.code === 'P0001' || error.code === 'P0002') {
          if (error.code === 'P0001') throw new DebtWriteConflictError(`Account deletion needs review: ${error.message}`);
          throw new DebtWriteUncertainError(`Account deletion could not be confirmed: ${error.message}. Local data was kept; reload before retrying.`);
        }
        if (isConfirmedServerRejection(error.code)) {
          throw new DebtWriteFailedError(`The server rejected account deletion: ${error.message}. No local records were cleared.`);
        }
        throw new DebtWriteUncertainError(`Account deletion may have reached the server, but its cleanup receipt was not received. Local data was kept; reload before retrying. ${error.message}`);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new DebtWriteUncertainError('The server did not return a cleanup receipt. Local account history was kept; reload before retrying.');
      }
      const value = data as Record<string, unknown>;
      const settings = value.settings;
      const billId = value.billId === null ? null : typeof value.billId === 'string' ? value.billId : undefined;
      const settingsRevision = value.settingsRevision;
      const deletedTransactions = value.deletedTransactions;
      const deletedReconciliationAnchors = value.deletedReconciliationAnchors;
      const deletedBills = value.deletedBills;
      const validCount = (candidate: unknown): candidate is number => typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0;
      if (value.version !== 2 || value.success !== true || value.operationId !== operationId || value.householdId !== current.householdId ||
          value.membershipVersion !== householdContext.membershipVersion || value.debtId !== debtId ||
          billId === undefined || value.deletedDebts !== 1 || deletedBills !== (billId ? 1 : 0) ||
          !validCount(deletedTransactions) || !validCount(deletedReconciliationAnchors) ||
          typeof settingsRevision !== 'number' || !Number.isSafeInteger(settingsRevision) || settingsRevision < 1 || value.historyCleanupComplete !== true ||
          !settings || typeof settings !== 'object' || Array.isArray(settings) ||
          (settings as Record<string, unknown>).householdId !== current.householdId) {
        throw new DebtWriteUncertainError('The server cleanup receipt was incomplete or did not match this account. Local account history was kept; reload before retrying.');
      }
      const receipt: AccountDeletionReceipt = {
        version: 1, success: true, operationId, debtId, billId,
        deletedTransactions,
        deletedReconciliationAnchors,
        deletedBills: deletedBills as number,
        deletedDebts: 1,
        settingsRevision: settingsRevision as number,
        historyCleanupComplete: true,
      };
      let next: UserOnboardingData = {
        ...current,
        ...(settings as Partial<UserOnboardingData>),
        householdId: current.householdId,
        householdContext,
        settingsRevision: settingsRevision as number,
        debts: current.debts.filter(debt => debt.id !== debtId),
      };
      next = settingsAfterDebtDeletion(next, debtId, billId);
      await cacheConfirmedDebts(next);
      return {
        data: next,
        billId,
        deletedTransactions,
        deletedReconciliationAnchors,
        receipt,
      };
    },
  }).then(result => ({ data: result.data, receipt: result.receipt }));
}

/**
 * Reset server financial records first, then separately reset onboarding metadata
 * and purge local caches. The metadata update is not part of the financial transaction.
 */
export async function resetUserOnboardingData(current: UserOnboardingData): Promise<void> {
  const { userId, householdId, householdContext } = current;
  if (!householdContext || householdContext.userId !== userId || householdContext.householdId !== householdId) {
    throw new Error('A current server-verified household context is required to reset data.');
  }
  await assertAuthenticatedUser(userId);
  const operationKey = `debtfree-reset-operation-v1.${secureKeyPart(userId)}.${secureKeyPart(householdId)}`;
  let operationId: string | null = await SecureStore.getItemAsync(operationKey);
  if (operationId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    throw new Error('A previous reset operation is malformed. Preserve local data and contact support before retrying.');
  }
  if (!operationId) {
    operationId = Crypto.randomUUID();
    await SecureStore.setItemAsync(operationKey, operationId, secureOptions);
  }

  // The same operation ID is retained if the server response or later local
  // cleanup is uncertain, so a retry cannot start a second destructive reset.
  const { data: rawReceipt, error } = await getSupabaseClient().rpc('debtfree_reset_household_financial_data_atomic', {
    p_household_id: householdId,
    p_expected_membership_version: householdContext.membershipVersion,
    p_operation_id: operationId,
  });
  const receipt = rawReceipt && typeof rawReceipt === 'object' && !Array.isArray(rawReceipt)
    ? rawReceipt as Record<string, unknown> : null;
  const revision = receipt?.settingsRevision;
  const settings = receipt?.settings;
  if (error || !receipt || receipt.success !== true || receipt.operationId !== operationId
      || receipt.householdId !== householdId || receipt.membershipVersion !== householdContext.membershipVersion
      || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0
      || !settings || typeof settings !== 'object' || Array.isArray(settings)
      || (settings as Record<string, unknown>).householdId !== householdId) {
    throw new Error('Financial reset could not be confirmed. Local household data and the reset operation ID were kept; reconnect and retry the same operation.');
  }

  const fresh: UserOnboardingData = {
    ...createDefaultOnboardingData(userId),
    ...(settings as Partial<UserOnboardingData>),
    userId,
    householdId,
    householdContext,
    settingsRevision: revision,
    profileSettingsRevision: current.profileSettingsRevision,
    householdName: typeof (settings as Record<string, unknown>).householdName === 'string'
      ? (settings as Record<string, unknown>).householdName as string : current.householdName,
  };
  try {
    await saveUserOnboardingData(fresh);
  } catch (saveError) {
    throw new Error(`Household financial data was reset, but profile reset could not be confirmed. Local caches and the operation ID were retained. ${saveError instanceof Error ? saveError.message : ''}`);
  }

  const financeStorage = await import('./finance-storage');
  await financeStorage.clearHouseholdFinanceStorage(householdContext);
  await chunkedStore.removeItem(localStateKey(userId, householdId));
  await SecureStore.deleteItemAsync(operationKey);
}

/** Purge user-scoped device data after the server confirms permanent account deletion. */
export async function clearUserDeviceDataAfterAccountDeletion(userId: string, householdIds: string | readonly string[]): Promise<void> {
  const safeId = userId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const accentId = Array.from(userId).map(c => c.codePointAt(0)!.toString(16)).join('-');
  const ids = [...new Set(typeof householdIds === 'string' ? [householdIds] : householdIds)];
  const checkpointKeys = ids.map(householdId => 'finance-backup-checkpoint.' + [userId, householdId]
    .map(value => Array.from(value).map(c => c.codePointAt(0)!.toString(16)).join('-')).join('.'));
  const cachedHouseholds = await householdCacheIds(userId);
  const removals = await Promise.allSettled([
    clearUserFinanceStorageForAccountDeletion(userId),
    ...cachedHouseholds.map(id => chunkedStore.removeItem(localStateKey(userId, id))),
    chunkedStore.removeItem(localStateIndexKey(userId)),
    chunkedStore.removeItem(legacyLocalStateKey(userId)),
    ...checkpointKeys.map(key => chunkedStore.removeItem(key)),
    ...[
      `debtfree-pref-theme.${safeId}`,
      `debtfree-pref-haptics.${safeId}`,
      `debtfree-pref-text-scaling.${safeId}`,
      `debtfree-pref-accent.${accentId}`,
    ].map(key => SecureStore.deleteItemAsync(key)),
  ]);
  if (removals.some(result => result.status === 'rejected')) {
    throw new Error('Your account was deleted, but this device could not confirm removal of all local data. Remove DebtFree from this device before sharing it.');
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
