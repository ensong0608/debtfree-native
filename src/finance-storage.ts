import type { Session } from '@supabase/supabase-js';
// @ts-ignore TS5097
import type { getSupabaseClient } from './auth.ts';
// @ts-ignore TS5097: Node direct-load tests need explicit TypeScript extensions.
import { createChunkedStorage, type KeyValueStore } from './secure-chunks.ts';
// @ts-ignore TS5097
import type { LedgerTransaction, ReconciliationAnchor } from './finance/ledger.ts';
// @ts-ignore TS5097
import type { RecurringBill } from './finance/recurring-bills.ts';
// @ts-ignore TS5097
import type { UserOnboardingData } from './onboarding-domain.ts';
// @ts-ignore TS5097
import type { DateOnly } from './finance/calendar.ts';
// @ts-ignore TS5097: Node direct-load tests need explicit TypeScript extensions.
import { createPendingJournal, createPendingJournalV2, preflightHouseholdPendingJournalsV2, preflightLegacyPendingJournal, pendingJournalV2Key, rowMatches, summarizePendingCommands, type HouseholdPendingCommand, type PendingCommand, type PendingSummary } from './finance/pending-journal.ts';
// @ts-ignore TS5097
import { householdStorageKey, parseHouseholdContext, type HouseholdContext } from './household-context.ts';
// @ts-ignore TS5097: Node direct-load tests need explicit TypeScript extensions.
import { transactionHasBillId } from './finance/bill-identity.ts';
// @ts-ignore TS5097: Node direct-load tests need explicit TypeScript extensions.
import { encodeTransactionRow, decodeTransactionRow, encodeRecurringBillRow, decodeRecurringBillRow, encodeReconciliationAnchorRow, decodeReconciliationAnchorRow, mergeFinanceRowsWithPendingWrites, rebaseFinanceCacheRows, classifyFinanceSnapshot, type FinanceSnapshotStatus, type SupabaseTransactionRow, type SupabaseRecurringBillRow, type SupabaseReconciliationAnchorRow } from './finance/storage-domain.ts';

declare const require: (id: string) => { getSupabaseClient: typeof getSupabaseClient };
const secureStoreAdapter: KeyValueStore = {
  getItem: async key => (await import('expo-secure-store')).getItemAsync(key),
  setItem: async (key, value) => {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
  removeItem: async key => (await import('expo-secure-store')).deleteItemAsync(key),
};

let chunkedStore = createChunkedStorage(secureStoreAdapter, () => `${Date.now()}${Math.random().toString(36).slice(2)}`);
let supabaseClientProvider: typeof getSupabaseClient = () => require('./auth').getSupabaseClient();

function safeKey(userId: string, domain: string): string {
  const safeId = userId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `debtfree-${domain}-v1.${safeId}`;
}

function keyPart(value: string): string {
  return Array.from(value).map(character => character.codePointAt(0)!.toString(16)).join('-');
}

function contextCacheKey(context: HouseholdContext, domain: string): string {
  const c = parseHouseholdContext(context.userId, context);
  return householdStorageKey(c.userId, c.householdId, `finance:${domain}`);
}

function contextCacheIndexKey(userId: string): string {
  return `debtfree-finance-index-v2.${keyPart(userId)}`;
}

async function rememberFinanceContext(context: HouseholdContext): Promise<void> {
  const c = parseHouseholdContext(context.userId, context);
  const key = contextCacheIndexKey(c.userId);
  const raw = await chunkedStore.getItem(key);
  let householdIds: string[] = [];
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some(id => typeof id !== 'string' || !id || id !== id.trim())) {
      throw new Error('The local household cache index is malformed; existing cache data was preserved.');
    }
    householdIds = parsed;
  }
  if (!householdIds.includes(c.householdId)) {
    await chunkedStore.setItem(key, JSON.stringify([...householdIds, c.householdId]));
  }
}

async function financeCacheKey(userId: string, domain: string, context?: HouseholdContext): Promise<string> {
  if (!context) return safeKey(userId, domain);
  const verified = parseHouseholdContext(userId, context);
  await rememberFinanceContext(verified);
  return contextCacheKey(verified, domain);
}

function verifiedFinanceContext(userId: string, session: Session | null, context?: HouseholdContext): HouseholdContext | undefined {
  if (session?.user && session.user.id !== userId) throw new Error('Finance session does not match the requested user.');
  if (session?.user && !context) throw new Error('A current server-verified household context is required for authenticated finance data.');
  return context ? parseHouseholdContext(userId, context) : undefined;
}

async function indexedFinanceHouseholds(userId: string): Promise<string[]> {
  const raw = await chunkedStore.getItem(contextCacheIndexKey(userId));
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some(id => typeof id !== 'string' || !id || id !== id.trim())) {
    throw new Error('The local household cache index is malformed; existing cache data was preserved.');
  }
  return [...new Set(parsed)];
}

function scopedJournal(context: HouseholdContext) {
  return createPendingJournalV2(chunkedStore, parseHouseholdContext(context.userId, context));
}

export class PendingFinanceRecoveryError extends Error {
  readonly pendingCount: number;
  readonly staleCount: number;
  readonly rejectedCount: number;
  constructor(message: string, counts: { pendingCount: number; staleCount: number; rejectedCount: number }) {
    super(message);
    this.name = 'PendingFinanceRecoveryError';
    this.pendingCount = counts.pendingCount;
    this.staleCount = counts.staleCount;
    this.rejectedCount = counts.rejectedCount;
  }
}

const cacheWriteQueues = new Map<string, Promise<void>>();
const cacheWriteGenerations = new Map<string, number>();
const mutationGenerations = new Map<string, number>();
const cacheDeltaQueues = new Map<string, Promise<void>>();
const inFlightFinanceLoads = new Map<string, Promise<LoadedFinanceRecords>>();
let lastFinanceCacheError: Error | null = null;
let cacheDeltaSeq = 0;

/** Return the most recent non-fatal local cache write error, cleared on the next clean cache flush or test reset. */
export function getLastFinanceCacheError(): Error | null {
  return lastFinanceCacheError;
}

function cacheScopeKey(userId: string, context?: HouseholdContext): string {
  return context ? `${keyPart(userId)}:${keyPart(context.householdId)}` : `legacy:${keyPart(userId)}`;
}

function getCacheScopeGeneration(scopeKey: string): number {
  return cacheWriteGenerations.get(scopeKey) ?? 0;
}

function getMutationGeneration(scopeKey: string): number {
  return mutationGenerations.get(scopeKey) ?? 0;
}

function bumpMutationGeneration(userId: string, context?: HouseholdContext): void {
  const scopeKey = cacheScopeKey(userId, context);
  mutationGenerations.set(scopeKey, getMutationGeneration(scopeKey) + 1);
}

function bumpAllMutationGenerationsForUser(userId: string): void {
  const userPrefix = `${keyPart(userId)}:`;
  const legacyScope = `legacy:${keyPart(userId)}`;
  for (const key of new Set([...mutationGenerations.keys(), ...cacheWriteGenerations.keys(), ...cacheWriteQueues.keys()])) {
    if (key === legacyScope || key.startsWith(userPrefix)) {
      mutationGenerations.set(key, getMutationGeneration(key) + 1);
    }
  }
  mutationGenerations.set(legacyScope, getMutationGeneration(legacyScope) + 1);
}

function invalidateInFlightLoads(userId: string, context?: HouseholdContext): void {
  const prefix = context ? `${cacheScopeKey(userId, context)}:` : `legacy:${keyPart(userId)}:`;
  for (const key of inFlightFinanceLoads.keys()) {
    if (key.startsWith(prefix)) inFlightFinanceLoads.delete(key);
  }
}

function invalidateCacheScope(userId: string, context?: HouseholdContext): void {
  const scopeKey = cacheScopeKey(userId, context);
  cacheWriteGenerations.set(scopeKey, getCacheScopeGeneration(scopeKey) + 1);
  invalidateInFlightLoads(userId, context);
}

function invalidateAllCacheScopesForUser(userId: string): void {
  const userPrefix = `${keyPart(userId)}:`;
  const legacyScope = `legacy:${keyPart(userId)}`;
  for (const key of new Set([...cacheWriteQueues.keys(), ...cacheWriteGenerations.keys()])) {
    if (key === legacyScope || key.startsWith(userPrefix)) {
      cacheWriteGenerations.set(key, getCacheScopeGeneration(key) + 1);
    }
  }
  for (const key of inFlightFinanceLoads.keys()) {
    if (key.startsWith(userPrefix) || key.startsWith(`${legacyScope}:`)) {
      inFlightFinanceLoads.delete(key);
    }
  }
}

function invalidateAllCacheScopes(): void {
  for (const key of new Set([...cacheWriteQueues.keys(), ...cacheWriteGenerations.keys()])) {
    cacheWriteGenerations.set(key, getCacheScopeGeneration(key) + 1);
  }
  inFlightFinanceLoads.clear();
}

function enqueueFinanceCacheWrite(userId: string, context: HouseholdContext | undefined, work: () => Promise<void>): void {
  const scopeKey = cacheScopeKey(userId, context);
  const enqueuedGen = getCacheScopeGeneration(scopeKey);
  const previous = cacheWriteQueues.get(scopeKey) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    if (getCacheScopeGeneration(scopeKey) !== enqueuedGen) return;
    try {
      await work();
      lastFinanceCacheError = null;
    } catch (err) {
      /* Cache failure cannot undo a confirmed server mutation, but surface diagnostics. */
      lastFinanceCacheError = err instanceof Error ? err : new Error(String(err));
    }
  });
  cacheWriteQueues.set(scopeKey, next);
  void next.finally(() => {
    if (cacheWriteQueues.get(scopeKey) === next) cacheWriteQueues.delete(scopeKey);
  });
}

async function flushUserFinanceCacheWrites(userId: string): Promise<void> {
  const userPrefix = `${keyPart(userId)}:`;
  const legacyScope = `legacy:${keyPart(userId)}`;
  const pending = [...cacheWriteQueues.entries()]
    .filter(([key]) => key === legacyScope || key.startsWith(userPrefix))
    .map(([, promise]) => promise);
  if (pending.length > 0) await Promise.allSettled(pending);
}

export async function flushFinanceCacheWrites(userId?: string, context?: HouseholdContext): Promise<void> {
  if (userId) {
    if (!context) { await flushUserFinanceCacheWrites(userId); return; }
    const pending = cacheWriteQueues.get(cacheScopeKey(userId, context));
    if (pending) await pending.catch(() => {});
    return;
  }
  const all = [...cacheWriteQueues.values()];
  if (all.length > 0) await Promise.allSettled(all);
}

/**
 * Read-only cutover preflight. It never moves, clears, or reassigns old evidence.
 * Call after refreshing the user's current server membership and before activating
 * or switching into this household context.
 */
export async function assertHouseholdFinanceContextReady(
  context: HouseholdContext,
  options: { allowCurrentMembershipPending?: boolean; session?: Session | null; autoReconcileWithServer?: boolean } = {},
): Promise<void> {
  const c = parseHouseholdContext(context.userId, context);
  const legacy = await preflightLegacyPendingJournal(chunkedStore, c.userId, {
    key: userId => safeKey(userId, 'pending-journal'),
  });
  if (legacy.commands.length > 0) {
    throw new PendingFinanceRecoveryError(
      'An unresolved account-only finance command must be reconciled before activating a household. Legacy evidence was preserved.',
      { pendingCount: legacy.unresolved || legacy.commands.length, staleCount: 0, rejectedCount: legacy.rejected },
    );
  }

  for (const domain of ['pending-txs', 'pending-bills', 'pending-anchors']) {
    const raw = await chunkedStore.getItem(safeKey(c.userId, domain));
    if (raw === null) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch {
      throw new PendingFinanceRecoveryError(
        'Malformed legacy finance evidence must be reviewed before activating a household. The original bytes were preserved.',
        { pendingCount: 1, staleCount: 0, rejectedCount: 0 },
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length > 0) {
      throw new PendingFinanceRecoveryError(
        'Legacy finance evidence must be explicitly reconciled before activating a household. The original bytes were preserved.',
        { pendingCount: 1, staleCount: 0, rejectedCount: 0 },
      );
    }
  }

  const isBlocking = (command: HouseholdPendingCommand) => {
    if (command.resolution) return false;
    if (command.membershipVersion !== c.membershipVersion) return true;
    if (options.allowCurrentMembershipPending) return false;
    return true;
  };

  let household = await preflightHouseholdPendingJournalsV2(
    chunkedStore, c.userId, c.householdId, c.membershipVersion,
  );
  let unsafe = household.commands.filter(isBlocking);
  if (unsafe.length > 0 && options.autoReconcileWithServer && options.session?.user?.id === c.userId) {
    try {
      await withFinanceLock(c.userId, () => recoverPendingFinanceWritesUnlocked({
        householdContext: c,
        userId: c.userId,
        session: options.session!,
        action: 'readback',
      }), c);
    } catch {
      // Preserve pending evidence if auto-readback fails; readiness still enforces recovery below.
    }
    household = await preflightHouseholdPendingJournalsV2(
      chunkedStore, c.userId, c.householdId, c.membershipVersion,
    );
    unsafe = household.commands.filter(isBlocking);
  }
  if (unsafe.length > 0) {
    const staleCount = unsafe.filter(command => command.membershipVersion !== c.membershipVersion).length;
    const rejectedCount = unsafe.filter(command => command.failure?.kind === 'rejected').length;
    throw new PendingFinanceRecoveryError(
      'A household finance command still needs authoritative recovery before this context can be activated. Pending evidence was preserved.',
      { pendingCount: unsafe.length, staleCount, rejectedCount },
    );
  }
}

function isLocalAcceptanceFinanceOwner(userId: string): boolean {
  return typeof __DEV__ !== 'undefined' && Boolean(__DEV__) &&
    process.env.EXPO_PUBLIC_ENABLE_LOCAL_ACCEPTANCE === 'true' &&
    userId === 'local-acceptance-owner-v1';
}

async function clearLocalAcceptancePendingForRow(userId: string, domain: 'transactions' | 'bills' | 'anchors', rowId: string): Promise<void> {
  if (!isLocalAcceptanceFinanceOwner(userId)) return;
  const commands = await pendingJournal.list(userId);
  await Promise.all(
    commands
      .filter(command => command.members.some(member => member.domain === domain && member.rowId === rowId))
      .map(command => pendingJournal.remove(userId, command.commandId)),
  );
}

/** Seed only the reserved, explicitly enabled development fixture namespace. */
export async function seedLocalAcceptanceFinanceRecords(params: {
  userId: string;
  transactions: LedgerTransaction[];
  recurringBills: RecurringBill[];
  reconciliationAnchors: ReconciliationAnchor[];
}): Promise<void> {
  if (!isLocalAcceptanceFinanceOwner(params.userId)) {
    throw new Error('Local acceptance finance storage is restricted to its opted-in development owner.');
  }
  await Promise.all([
    chunkedStore.setItem(safeKey(params.userId, 'txs'), JSON.stringify(params.transactions.map(row => encodeTransactionRow(row, params.userId)))),
    chunkedStore.setItem(safeKey(params.userId, 'bills'), JSON.stringify(params.recurringBills.map(row => encodeRecurringBillRow(row, params.userId)))),
    chunkedStore.setItem(safeKey(params.userId, 'anchors'), JSON.stringify(params.reconciliationAnchors.map(row => encodeReconciliationAnchorRow(row, params.userId)))),
  ]);
}
let pendingJournal = createPendingJournal(chunkedStore, { key: userId => safeKey(userId, 'pending-journal') });
/** Test seam for deterministic storage-boundary tests; production uses SecureStore and the app client. */
export function __configureFinanceStorageForTests(dependencies: {
  storage?: KeyValueStore;
  getClient?: typeof getSupabaseClient;
}): () => void {
  const priorStore = chunkedStore;
  const priorProvider = supabaseClientProvider;
  invalidateAllCacheScopes();
  mutationGenerations.clear();
  cacheDeltaQueues.clear();
  lastFinanceCacheError = null;
  if (dependencies.storage) chunkedStore = dependencies.storage as typeof chunkedStore;
  if (dependencies.getClient) supabaseClientProvider = dependencies.getClient;
  pendingJournal = createPendingJournal(chunkedStore, { key: userId => safeKey(userId, 'pending-journal') });
  legacyMigrations.clear();
  return () => {
    invalidateAllCacheScopes();
    mutationGenerations.clear();
    cacheDeltaQueues.clear();
    lastFinanceCacheError = null;
    chunkedStore = priorStore;
    supabaseClientProvider = priorProvider;
    pendingJournal = createPendingJournal(chunkedStore, { key: userId => safeKey(userId, 'pending-journal') });
    legacyMigrations.clear();
  };
}

/** Offline writes are cache-only and are not automatically replayed. */
export type FinanceSyncStatus = 'synced' | 'cached_offline';

export type LoadedFinanceRecords = {
  transactions: LedgerTransaction[];
  recurringBills: RecurringBill[];
  reconciliationAnchors: ReconciliationAnchor[];
  syncStatus: FinanceSyncStatus;
  snapshotStatus: FinanceSnapshotStatus;
  pendingWriteCount: number;
  error?: Error;
  failureKind?: 'rejected' | 'uncertain';
};

export type FinanceMutationOutcome = 'confirmed' | 'pending' | 'rejected';

export type FinanceMutationResult<T> = {
  data: T;
  syncStatus: FinanceSyncStatus;
  outcome: FinanceMutationOutcome;
  error?: Error;
  failureKind?: 'rejected' | 'uncertain';
  accountBalance?: number;
  accountVersion?: number;
  oldAccountBalance?: number;
  oldAccountVersion?: number;
  oldAccountId?: string | null;
  updatedAt?: string;
  isConflict?: boolean;
};

type PendingRows = Record<string, unknown | null>;
async function readPending(userId: string, domain: string, context?: HouseholdContext): Promise<PendingRows> {
  if (!context) await migrateLegacyPending(userId);
  const rows: PendingRows = {};
  const commands = context ? await scopedJournal(context).list() : await pendingJournal.list(userId);
  for (const command of commands) {
    if (context) {
      const verified = parseHouseholdContext(userId, context);
      if ((command as HouseholdPendingCommand).householdId !== verified.householdId) {
        throw new Error('Pending finance row does not belong to the selected household.');
      }
      if (command.resolution) continue;
      if ((command as HouseholdPendingCommand).membershipVersion !== verified.membershipVersion) {
        throw new Error('Pending finance command belongs to a stale household membership version.');
      }
      for (const member of command.members) {
        if (member.domain !== domain || member.desired === null) continue;
        if (!member.desired || typeof member.desired !== 'object' || Array.isArray(member.desired)
            || (member.desired as Record<string, unknown>).household_id !== verified.householdId) {
          throw new Error('Pending finance row does not belong to the selected household.');
        }
      }
    }
    if (command.resolution || command.kind === 'migration_diagnostic' || ((command.kind === 'bill_upsert' || command.kind === 'bill_delete') && command.state === 'needs_review')) continue;
    if (command.failure?.kind === 'rejected') continue;
    for (const member of command.members) if (member.domain === domain) rows[member.rowId] = member.desired;
  }
  return rows;
}
const legacyMigrations = new Map<string, Promise<void>>();
async function migrateLegacyPending(userId: string): Promise<void> {
  const current = legacyMigrations.get(userId);
  if (current) return current;
  const migration = (async () => {
    for (const [domain, legacyName] of [['transactions', 'txs'], ['bills', 'bills'], ['anchors', 'anchors']] as const) {
      const key = safeKey(userId, `pending-${legacyName}`);
      const raw = await chunkedStore.getItem(key);
      let legacy: PendingRows = {};
      let valid = false;
      try {
        const parsed: unknown = JSON.parse(raw ?? '{}');
        valid = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.values(parsed).every(value => value === null || (typeof value === 'object' && !Array.isArray(value)));
        if (valid) legacy = parsed as PendingRows;
      } catch { /* preserve malformed raw bytes below */ }
      if (!valid) {
        const commandId = `legacy:diagnostic:${domain}`;
        if (!(await pendingJournal.get(userId, commandId))) {
          const now = new Date().toISOString();
          await pendingJournal.save({ commandId, kind: 'migration_diagnostic', userId, expectedVersions: {}, payload: null, members: [], state: 'needs_review', dispatchState: 'uncertain',
            createdAt: now, updatedAt: now, diagnostic: { sourceDomain: domain, raw: raw ?? '', reason: 'Legacy pending map was not a valid object of row intents; raw evidence retained for manual review.' }, reviewReason: 'Malformed legacy pending data was retained without applying it as a financial row.' });
        }
        continue;
      }
      for (const [rowId, desired] of Object.entries(legacy)) {
        const commandId = `legacy:${domain}:${rowId}`;
        if (await pendingJournal.get(userId, commandId)) continue;
        const now = new Date().toISOString();
        await pendingJournal.save({ commandId, kind: 'legacy', userId, expectedVersions: {}, payload: null,
          members: [{ domain, rowId, desired }], state: 'needs_review', dispatchState: 'uncertain',
          createdAt: now, updatedAt: now, reviewReason: 'Legacy pending intent lacks a complete durable command and must be reviewed.' });
      }
      await chunkedStore.removeItem(key);
    }
  })();
  legacyMigrations.set(userId, migration);
  try { await migration; } finally { if (legacyMigrations.get(userId) === migration) legacyMigrations.delete(userId); }
}
async function savePendingCommand(userId: string, command: Omit<PendingCommand, 'userId' | 'createdAt' | 'updatedAt'>, context?: HouseholdContext): Promise<void> {
  const commands = context ? await scopedJournal(context).list() : await pendingJournal.list(userId);
  const unresolved = commands.find(existing => !existing.resolution && existing.failure?.kind !== 'rejected' &&
    existing.members.some(a => command.members.some(b => a.domain === b.domain && a.rowId === b.rowId)));
  if (unresolved) throw new Error(`A previous ${unresolved.kind} operation for this record still needs recovery.`);
  const now = new Date().toISOString();
  if (context) {
    const verified = parseHouseholdContext(userId, context);
    await scopedJournal(verified).save({ ...command, userId, householdId: verified.householdId, membershipVersion: verified.membershipVersion, createdAt: now, updatedAt: now });
  } else {
    await pendingJournal.save({ ...command, userId, createdAt: now, updatedAt: now });
  }
}
function newCommandId(kind: string, identity: string): string {
  return `${kind}:${identity}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
async function finishPendingCommand(userId: string, commandId: string, context?: HouseholdContext): Promise<void> {
  if (context) await scopedJournal(context).remove(commandId);
  else await pendingJournal.remove(userId, commandId);
}
async function rejectPendingCommand(userId: string, commandId: string, message: string, context?: HouseholdContext): Promise<void> {
  if (context) await scopedJournal(context).markRejected(commandId, message);
  else await pendingJournal.markRejected(userId, commandId, message);
}
async function updatePendingCommand(
  userId: string,
  commandId: string,
  patch: Partial<Omit<PendingCommand, 'commandId' | 'kind' | 'userId' | 'createdAt' | 'expectedVersions'>>,
  context?: HouseholdContext,
): Promise<PendingCommand | HouseholdPendingCommand> {
  if (context) return scopedJournal(context).update(commandId, patch);
  return pendingJournal.update(userId, commandId, patch);
}
async function listPendingCommands(userId: string, context?: HouseholdContext): Promise<Array<PendingCommand | HouseholdPendingCommand>> {
  if (context) return scopedJournal(context).list();
  return pendingJournal.list(userId);
}
async function getPendingFinanceSummaryUnlocked(userId: string, context?: HouseholdContext): Promise<PendingSummary> {
  if (!context) {
    await migrateLegacyPending(userId);
    return pendingJournal.summarize(userId);
  }
  const verified = parseHouseholdContext(userId, context);
  const { commands } = await preflightHouseholdPendingJournalsV2(chunkedStore, verified.userId, verified.householdId, verified.membershipVersion);
  return summarizePendingCommands(commands);
}
export async function getPendingFinanceSummary(context: HouseholdContext): Promise<PendingSummary> {
  const verified = parseHouseholdContext(context.userId, context);
  return withFinanceLock(verified.userId, () => getPendingFinanceSummaryUnlocked(verified.userId, verified), verified);
}
export async function getPendingFinanceOperations(context: HouseholdContext): Promise<HouseholdPendingCommand[]> {
  const verified = parseHouseholdContext(context.userId, context);
  return withFinanceLock(
    verified.userId,
    async () => (await preflightHouseholdPendingJournalsV2(chunkedStore, verified.userId, verified.householdId, verified.membershipVersion)).commands,
    verified,
  );
}

function isSafeVersion(value: unknown): value is number | string {
  return (typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && value.length > 0);
}

function isHouseholdReceipt(value: unknown, context: HouseholdContext | undefined): value is Record<string, unknown> {
  if (!context || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  return receipt.success === true && receipt.householdId === context.householdId
    && String(receipt.membershipVersion ?? '') === context.membershipVersion;
}

function isHouseholdRow(value: unknown, context: HouseholdContext | undefined, id: string): value is Record<string, unknown> {
  return Boolean(context && value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).id === id
    && (value as Record<string, unknown>).household_id === context.householdId);
}

/** Storage-owned allowlist used by recovery UI and API; bills, anchors and grouped commands remain review-only. */
export function canRetryPendingFinanceOperation(command: HouseholdPendingCommand): boolean {
  if (command.dispatchState !== 'not_dispatched' || command.failure?.kind === 'rejected' || command.resolution || command.members.length !== 1 || command.members[0].domain !== 'transactions') return false;
  const payload = command.payload as Record<string, any> | null;
  if (!payload || typeof payload !== 'object' || payload.p_household_id !== command.householdId
      || payload.p_expected_membership_version !== command.membershipVersion) return false;
  if (command.kind === 'transaction_create') return payload.rpc_name === 'debtfree_record_household_transaction_atomic'
    && payload.p_tx?.id === command.members[0].rowId && payload.p_idempotency_key === command.members[0].rowId
    && (payload.p_tx.account_id == null || isSafeVersion(payload.p_expected_version));
  if (command.kind === 'transaction_update') return payload.rpc_name === 'debtfree_update_household_transaction_atomic'
    && payload.p_tx?.id === command.members[0].rowId && payload.p_idempotency_key === command.members[0].rowId
    && isSafeVersion(payload.p_expected_tx_version) && isSafeVersion(payload.p_expected_version)
    && isSafeVersion(payload.p_expected_old_account_version);
  if (command.kind === 'transaction_delete') return payload.rpc_name === 'debtfree_delete_household_transaction_atomic'
    && payload.p_tx_id === command.members[0].rowId && payload.p_idempotency_key === command.members[0].rowId
    && isSafeVersion(payload.p_expected_tx_version) && isSafeVersion(payload.p_expected_version);
  return false;
}

export type FinanceRecoveryResult = { summary: PendingSummary; operations: HouseholdPendingCommand[]; retriedCommandId?: string; authoritativeRecords?: { transactions: unknown[]; recurringBills: unknown[]; reconciliationAnchors: unknown[] }; resolvedCommandId?: string };
async function readCompleteTransactions(supabase: ReturnType<typeof supabaseClientProvider>, context: HouseholdContext): Promise<SupabaseTransactionRow[]> {
  const rows: SupabaseTransactionRow[] = [];
  const ids = new Set<string>();
  let cursor: { date: string; id: string } | null = null;
  for (;;) {
    const result = await supabase.rpc('debtfree_get_household_transaction_page', {
      p_household_id: context.householdId, p_expected_membership_version: context.membershipVersion,
      p_before_date: cursor?.date ?? null, p_before_id: cursor?.id ?? null,
    });
    if (result.error) {
      if (cursor || result.error.code !== 'PGRST202') throw new Error(result.error.message);
      const verifyHousehold = async () => {
        const guard = await supabase.from('households').select('id,lifecycle_state,membership_version')
          .eq('id', context.householdId).range(0, 1);
        if (guard.error) throw new Error(guard.error.message);
        const household = guard.data;
        if (!Array.isArray(household) || household.length !== 1 || household[0]?.id !== context.householdId ||
            household[0].lifecycle_state !== 'active' || String(household[0].membership_version) !== context.membershipVersion) {
          throw new Error('Household access denied or membership version changed.');
        }
      };
      await verifyHousehold();
      for (let offset = 0; ; offset += 500) {
        const fallback = await supabase.from('transactions')
          .select('id,user_id,household_id,account_id,date,applies_to_date,amount,category,payee,memo,source,reconciled,created_at,updated_at,deleted_at,principal_amount,interest_amount,escrow_amount,fee_amount')
          .eq('household_id', context.householdId).order('date', { ascending: false })
          .order('id', { ascending: false }).range(offset, offset + 499);
        if (fallback.error) throw new Error(fallback.error.message);
        if (!Array.isArray(fallback.data) || fallback.data.length > 500) throw new Error('Invalid transaction page.');
        for (const row of fallback.data) {
          if (!row || typeof row !== 'object' || row.household_id !== context.householdId ||
              typeof row.id !== 'string' || !row.id || ids.has(row.id) ||
              typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
              (row.user_id !== null && (typeof row.user_id !== 'string' || !row.user_id)) ||
              !['string', 'number'].includes(typeof row.amount) || !Number.isFinite(Number(row.amount)) ||
              typeof row.category !== 'string' || typeof row.payee !== 'string' ||
              typeof row.source !== 'string' || typeof row.reconciled !== 'boolean' ||
              typeof row.created_at !== 'string' || typeof row.updated_at !== 'string' ||
              ![row.account_id, row.applies_to_date, row.memo, row.deleted_at].every(value => value === null || typeof value === 'string') ||
              ![row.principal_amount, row.interest_amount, row.escrow_amount, row.fee_amount].every(value =>
                value === null || ((typeof value === 'string' || typeof value === 'number') && Number.isFinite(Number(value))))) {
            throw new Error('Invalid or duplicate transaction row.');
          }
          ids.add(row.id);
          rows.push(row as SupabaseTransactionRow);
        }
        if (fallback.data.length < 500) break;
      }
      await verifyHousehold();
      return rows;
    }
    const page = result.data as { rows?: unknown; nextCursor?: unknown } | null;
    if (!page || typeof page !== 'object' || !Array.isArray(page.rows) ||
        page.rows.length > 500 || !('nextCursor' in page) || (cursor && page.rows.length === 0)) {
      throw new Error('Invalid transaction page.');
    }
    for (const row of page.rows) {
      if (!row || typeof row !== 'object' || row.household_id !== context.householdId ||
          typeof row.id !== 'string' || !row.id || ids.has(row.id) ||
          typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
        throw new Error('Invalid or duplicate transaction row.');
      }
      ids.add(row.id);
      rows.push(row as SupabaseTransactionRow);
    }
    if (page.nextCursor === null) return rows;
    const next = page.nextCursor as { date?: unknown; id?: unknown } | null;
    const last = page.rows[page.rows.length - 1];
    if (page.rows.length !== 500 || !next || typeof next !== 'object' ||
        typeof next.date !== 'string' || typeof next.id !== 'string' ||
        next.date !== last.date || next.id !== last.id) {
      throw new Error('Invalid transaction cursor.');
    }
    cursor = { date: next.date, id: next.id };
  }
}

async function readCompleteFinanceDomain(supabase: ReturnType<typeof supabaseClientProvider>, table: string, context: HouseholdContext, order?: { column: string; ascending: boolean }): Promise<unknown[]> {
  const pageSize = 500;
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from(table).select('*').eq('household_id', context.householdId);
    if (order) query = query.order(order.column, { ascending: order.ascending });
    const result = await query.range(offset, offset + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    const page = (result.data ?? []) as unknown[];
    if (page.some(row => !row || typeof row !== 'object' || (row as { household_id?: unknown }).household_id !== context.householdId)) {
      throw new Error('Finance readback returned a row outside the selected household.');
    }
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function recoverPendingFinanceWritesUnlocked(params: {
  householdContext: HouseholdContext;
  userId: string;
  session: Session | null;
  action: 'readback' | 'retry' | 'accept_server_state' | 'accept_all_server_state';
  commandId?: string;
  acknowledgeServerState?: true;
}): Promise<FinanceRecoveryResult> {
  const context = parseHouseholdContext(params.userId, params.householdContext);
  const { userId, session, action } = params;
  if (!session?.user || session.user.id !== userId) throw new Error('Finance recovery requires a matching authenticated user.');
  const journalForVersion = (membershipVersion: string) =>
    createPendingJournalV2(chunkedStore, { ...context, membershipVersion });
  const preflight = await preflightHouseholdPendingJournalsV2(chunkedStore, context.userId, context.householdId, context.membershipVersion);
  const supabase = supabaseClientProvider();
  let authoritativeRecords: FinanceRecoveryResult['authoritativeRecords'];
  let resolvedCommandId: string | undefined;
  if (action === 'readback' || action === 'accept_server_state' || action === 'accept_all_server_state') {
    const [txs, bills, anchors] = await Promise.all([
      readCompleteTransactions(supabase, context),
      readCompleteFinanceDomain(supabase, 'recurring_bills', context),
      readCompleteFinanceDomain(supabase, 'reconciliation_anchors', context),
    ]);
    const evidence = { byDomain: {
      transactions: { authoritative: true, complete: true, rows: (txs as SupabaseTransactionRow[]).map(row => ({ id: row.id, row })) },
      bills: { authoritative: true, complete: true, rows: (bills as SupabaseRecurringBillRow[]).map(row => ({ id: row.id, row })) },
      anchors: { authoritative: true, complete: true, rows: (anchors as SupabaseReconciliationAnchorRow[]).map(row => ({ id: row.id, row })) },
    } };
    authoritativeRecords = { transactions: txs, recurringBills: bills, reconciliationAnchors: anchors };
    if (action === 'readback') {
      for (const command of preflight.commands) {
        if (!command.resolution) {
          await journalForVersion(command.membershipVersion).evaluateReadback(command.commandId, evidence);
        }
      }
    } else if (action === 'accept_server_state') {
      if (!params.commandId) throw new Error('A commandId is required to accept authoritative server state.');
      if (params.acknowledgeServerState !== true) throw new Error('Explicit acknowledgement is required to accept authoritative server state.');
      const target = preflight.commands.find(command => command.commandId === params.commandId);
      if (!target) throw new Error('Pending operation was not found.');
      await journalForVersion(target.membershipVersion).acceptServerState(target.commandId, evidence, params.acknowledgeServerState);
      resolvedCommandId = target.commandId;
    } else {
      if (params.acknowledgeServerState !== true) throw new Error('Explicit acknowledgement is required to accept authoritative server state.');
      for (const command of preflight.commands) {
        if (!command.resolution) {
          await journalForVersion(command.membershipVersion).acceptServerState(command.commandId, evidence, params.acknowledgeServerState);
          resolvedCommandId = command.commandId;
        }
      }
    }
  } else {
    if (!params.commandId) throw new Error('A commandId is required for explicit retry.');
    const command = preflight.commands.find(item => item.commandId === params.commandId);
    if (!command) throw new Error('Pending operation was not found.');
    if (command.membershipVersion !== context.membershipVersion) {
      throw new Error('This command belongs to an older household membership version and cannot be retried automatically. Sync & recover or use server data instead.');
    }
    const journal = scopedJournal(context);
    if (!canRetryPendingFinanceOperation(command)) throw new Error('This command is review-only and cannot be retried safely.');
    await journal.update(command.commandId, { dispatchState: 'dispatched', updatedAt: new Date().toISOString() });
    try {
      const payload = command.payload as Record<string, any>;
      let error: { message: string; code?: string } | null = null;
      if (command.kind === 'transaction_create' || command.kind === 'transaction_update' || command.kind === 'transaction_delete') {
        const { rpc_name: rpcName, ...args } = payload;
        const result = await supabase.rpc(rpcName, args);
        error = result.error;
        const retryReceipt = result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data as Record<string, unknown> : null;
        const expectedRowId = command.kind === 'transaction_delete' ? String(payload.p_tx_id) : String((payload.p_tx as Record<string, unknown> | undefined)?.id ?? '');
        const retryRow = retryReceipt?.row;
        if (!error && (!isHouseholdReceipt(retryReceipt, context) || !isHouseholdRow(retryRow, context, expectedRowId)
            || (command.kind === 'transaction_delete' && (retryRow as Record<string, unknown> | null)?.deleted_at == null))) {
          error = { message: 'Atomic household transaction retry returned a mismatched household receipt.' };
        }
      } else {
        await journal.update(command.commandId, { state: 'needs_review', dispatchState: 'not_dispatched', reviewReason: 'This command has no supported idempotent retry operation.' });
        throw new Error('This command has no supported idempotent retry operation.');
      }
      if (error) {
        const rejected = ['42501', '23514', '23502', '23503', '23505', '22P02', '42883', 'PGRST202', 'P0001', 'P0002'].includes(error.code ?? '');
        if (rejected) await journal.markRejected(command.commandId, error.message);
        else await journal.update(command.commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: error.message }, updatedAt: new Date().toISOString() });
        throw new Error(error.message);
      }
      await journal.remove(command.commandId);
    } catch (error) {
      const latest = await journal.get(command.commandId);
      if (latest?.dispatchState === 'dispatched' && latest.failure?.kind !== 'rejected') await journal.update(command.commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
  }
  bumpMutationGeneration(userId, context);
  const latest = await preflightHouseholdPendingJournalsV2(chunkedStore, context.userId, context.householdId, context.membershipVersion);
  return {
    summary: summarizePendingCommands(latest.commands),
    operations: latest.commands,
    retriedCommandId: action === 'retry' ? params.commandId : undefined,
    authoritativeRecords,
    resolvedCommandId,
  };
}

export async function recoverPendingFinanceWrites(params: {
  householdContext: HouseholdContext;
  userId: string;
  session: Session | null;
  action: 'readback' | 'retry' | 'accept_server_state' | 'accept_all_server_state';
  commandId?: string;
  acknowledgeServerState?: true;
}): Promise<FinanceRecoveryResult> {
  const context = parseHouseholdContext(params.userId, params.householdContext);
  invalidateInFlightLoads(params.userId, context);
  return withFinanceLock(params.userId, () => recoverPendingFinanceWritesUnlocked(params), context);
}
export async function getPendingTransactionIds(context: HouseholdContext): Promise<Set<string>> {
  const verified = parseHouseholdContext(context.userId, context);
  return withFinanceLock(verified.userId, async () => {
    const pending = await readPending(verified.userId, 'transactions', verified);
    return new Set(Object.keys(pending));
  }, verified);
}
async function writePending(userId: string, domain: string, pending: PendingRows): Promise<void> {
  // New pending operations are committed atomically in the journal envelope.
  void userId; void domain; void pending;
}
async function restoreCache(key: string, raw: string | null): Promise<void> {
  if (raw === null) await chunkedStore.removeItem(key);
  else await chunkedStore.setItem(key, raw);
}
async function mergeRowsIntoCache<T extends { id: string }>(key: string, supplied: readonly T[], overrides: readonly T[] = [], removeIds: readonly string[] = [], strict = false): Promise<T[]> {
  let cached: T[] = [];
  try { cached = JSON.parse(await chunkedStore.getItem(key) ?? '[]') as T[]; } catch { /* start from caller snapshot */ }
  const merged = rebaseFinanceCacheRows(cached, supplied, overrides, removeIds);
  if (strict) await chunkedStore.setItem(key, JSON.stringify(merged));
  else await chunkedStore.setItem(key, JSON.stringify(merged)).catch(() => {});
  return merged;
}

type CacheDeltaStamps = {
  transactions?: Record<string, string>;
  bills?: Record<string, string>;
  removedBillIds?: Record<string, string>;
  anchors?: Record<string, string>;
  removedAnchorIds?: Record<string, string>;
};

type FinanceCacheDelta = {
  transactions: Record<string, SupabaseTransactionRow>;
  bills: Record<string, SupabaseRecurringBillRow>;
  removedBillIds: string[];
  anchors: Record<string, SupabaseReconciliationAnchorRow>;
  removedAnchorIds: string[];
  stamps: Required<CacheDeltaStamps>;
};

type CacheDeltaUpdate = {
  transaction?: SupabaseTransactionRow;
  bill?: SupabaseRecurringBillRow;
  removedBillId?: string;
  anchor?: SupabaseReconciliationAnchorRow;
  removedAnchorId?: string;
};

type FinanceCacheKeys = {
  transactions: string;
  bills: string;
  anchors: string;
  cacheDelta: string;
};

type LocalFinanceBaseline = {
  transactions: LedgerTransaction[];
  recurringBills: RecurringBill[];
  reconciliationAnchors: ReconciliationAnchor[];
  pendingWriteCount: number;
};

function emptyFinanceCacheDelta(): FinanceCacheDelta {
  return {
    transactions: {},
    bills: {},
    removedBillIds: [],
    anchors: {},
    removedAnchorIds: [],
    stamps: { transactions: {}, bills: {}, removedBillIds: {}, anchors: {}, removedAnchorIds: {} },
  };
}

function nextCacheDeltaStamp(revision?: string | null): string {
  cacheDeltaSeq += 1;
  return `${cacheDeltaSeq}:${revision ?? ''}`;
}

async function cacheDeltaKey(userId: string, context?: HouseholdContext): Promise<string> {
  return financeCacheKey(userId, 'cache-delta', context);
}

async function resolveFinanceCacheKeys(userId: string, context?: HouseholdContext): Promise<FinanceCacheKeys> {
  const [transactions, bills, anchors, cacheDelta] = await Promise.all([
    financeCacheKey(userId, 'txs', context),
    financeCacheKey(userId, 'bills', context),
    financeCacheKey(userId, 'anchors', context),
    cacheDeltaKey(userId, context),
  ]);
  return { transactions, bills, anchors, cacheDelta };
}

async function withCacheDeltaLock<T>(scopeKey: string, work: () => Promise<T>): Promise<T> {
  const previous = cacheDeltaQueues.get(scopeKey) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  cacheDeltaQueues.set(scopeKey, tail);
  await previous.catch(() => {});
  try { return await work(); }
  finally { release(); if (cacheDeltaQueues.get(scopeKey) === tail) cacheDeltaQueues.delete(scopeKey); }
}

function parseFinanceCacheDelta(raw: string | null, context?: HouseholdContext): FinanceCacheDelta {
  if (!raw) return emptyFinanceCacheDelta();
  try {
    const parsed = JSON.parse(raw) as Partial<FinanceCacheDelta> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyFinanceCacheDelta();
    const transactions = parsed.transactions && typeof parsed.transactions === 'object' && !Array.isArray(parsed.transactions)
      ? parsed.transactions : {};
    const bills = parsed.bills && typeof parsed.bills === 'object' && !Array.isArray(parsed.bills)
      ? parsed.bills : {};
    const anchors = parsed.anchors && typeof parsed.anchors === 'object' && !Array.isArray(parsed.anchors)
      ? parsed.anchors : {};
    if (context) {
      for (const row of [...Object.values(transactions), ...Object.values(bills), ...Object.values(anchors)]) {
        if (!row || typeof row !== 'object' || row.household_id !== context.householdId) {
          return emptyFinanceCacheDelta();
        }
      }
    }
    const rawStamps: CacheDeltaStamps = parsed.stamps && typeof parsed.stamps === 'object' && !Array.isArray(parsed.stamps)
      ? (parsed.stamps as CacheDeltaStamps) : {};
    return {
      transactions: { ...transactions },
      bills: { ...bills },
      removedBillIds: Array.isArray(parsed.removedBillIds) ? parsed.removedBillIds.filter((id): id is string => typeof id === 'string') : [],
      anchors: { ...anchors },
      removedAnchorIds: Array.isArray(parsed.removedAnchorIds) ? parsed.removedAnchorIds.filter((id): id is string => typeof id === 'string') : [],
      stamps: {
        transactions: { ...(rawStamps.transactions ?? {}) },
        bills: { ...(rawStamps.bills ?? {}) },
        removedBillIds: { ...(rawStamps.removedBillIds ?? {}) },
        anchors: { ...(rawStamps.anchors ?? {}) },
        removedAnchorIds: { ...(rawStamps.removedAnchorIds ?? {}) },
      },
    };
  } catch {
    return emptyFinanceCacheDelta();
  }
}

function isCacheDeltaEmpty(delta: FinanceCacheDelta): boolean {
  return Object.keys(delta.transactions).length === 0
    && Object.keys(delta.bills).length === 0
    && delta.removedBillIds.length === 0
    && Object.keys(delta.anchors).length === 0
    && delta.removedAnchorIds.length === 0;
}

function hasCacheDeltaStamps(stamps: CacheDeltaStamps): boolean {
  return Object.keys(stamps.transactions ?? {}).length > 0
    || Object.keys(stamps.bills ?? {}).length > 0
    || Object.keys(stamps.removedBillIds ?? {}).length > 0
    || Object.keys(stamps.anchors ?? {}).length > 0
    || Object.keys(stamps.removedAnchorIds ?? {}).length > 0;
}

async function readCacheDelta(userId: string, context?: HouseholdContext, preResolvedDeltaKey?: string): Promise<FinanceCacheDelta> {
  const scopeKey = cacheScopeKey(userId, context);
  const deltaKey = preResolvedDeltaKey ?? await cacheDeltaKey(userId, context);
  return withCacheDeltaLock(scopeKey, async () => {
    try {
      return parseFinanceCacheDelta(await chunkedStore.getItem(deltaKey), context);
    } catch {
      return emptyFinanceCacheDelta();
    }
  });
}

async function readCacheDeltaStamps(userId: string, context?: HouseholdContext, preResolvedDeltaKey?: string): Promise<CacheDeltaStamps> {
  const delta = await readCacheDelta(userId, context, preResolvedDeltaKey);
  const stamps: CacheDeltaStamps = {};
  for (const id of Object.keys(delta.transactions)) {
    (stamps.transactions ??= {})[id] = delta.stamps.transactions[id] ?? '';
  }
  for (const id of Object.keys(delta.bills)) {
    (stamps.bills ??= {})[id] = delta.stamps.bills[id] ?? '';
  }
  for (const id of delta.removedBillIds) {
    (stamps.removedBillIds ??= {})[id] = delta.stamps.removedBillIds[id] ?? '';
  }
  for (const id of Object.keys(delta.anchors)) {
    (stamps.anchors ??= {})[id] = delta.stamps.anchors[id] ?? '';
  }
  for (const id of delta.removedAnchorIds) {
    (stamps.removedAnchorIds ??= {})[id] = delta.stamps.removedAnchorIds[id] ?? '';
  }
  return stamps;
}

async function recordCacheDelta(userId: string, context: HouseholdContext | undefined, update: CacheDeltaUpdate): Promise<CacheDeltaStamps> {
  const scopeKey = cacheScopeKey(userId, context);
  try {
    const deltaKey = await cacheDeltaKey(userId, context);
    return await withCacheDeltaLock(scopeKey, async () => {
      const delta = parseFinanceCacheDelta(await chunkedStore.getItem(deltaKey), context);
      const written: CacheDeltaStamps = {};
      if (update.transaction) {
        const stamp = nextCacheDeltaStamp(update.transaction.updated_at);
        delta.transactions[update.transaction.id] = update.transaction;
        delta.stamps.transactions[update.transaction.id] = stamp;
        written.transactions = { [update.transaction.id]: stamp };
      }
      if (update.bill) {
        const stamp = nextCacheDeltaStamp(update.bill.updated_at);
        delta.bills[update.bill.id] = update.bill;
        delta.stamps.bills[update.bill.id] = stamp;
        delta.removedBillIds = delta.removedBillIds.filter(id => id !== update.bill!.id);
        delete delta.stamps.removedBillIds[update.bill.id];
        written.bills = { [update.bill.id]: stamp };
      }
      if (update.removedBillId) {
        const stamp = nextCacheDeltaStamp();
        delete delta.bills[update.removedBillId];
        delete delta.stamps.bills[update.removedBillId];
        if (!delta.removedBillIds.includes(update.removedBillId)) delta.removedBillIds.push(update.removedBillId);
        delta.stamps.removedBillIds[update.removedBillId] = stamp;
        written.removedBillIds = { [update.removedBillId]: stamp };
      }
      if (update.anchor) {
        const stamp = nextCacheDeltaStamp(update.anchor.created_at);
        delta.anchors[update.anchor.id] = update.anchor;
        delta.stamps.anchors[update.anchor.id] = stamp;
        delta.removedAnchorIds = delta.removedAnchorIds.filter(id => id !== update.anchor!.id);
        delete delta.stamps.removedAnchorIds[update.anchor.id];
        written.anchors = { [update.anchor.id]: stamp };
      }
      if (update.removedAnchorId) {
        const stamp = nextCacheDeltaStamp();
        delete delta.anchors[update.removedAnchorId];
        delete delta.stamps.anchors[update.removedAnchorId];
        if (!delta.removedAnchorIds.includes(update.removedAnchorId)) delta.removedAnchorIds.push(update.removedAnchorId);
        delta.stamps.removedAnchorIds[update.removedAnchorId] = stamp;
        written.removedAnchorIds = { [update.removedAnchorId]: stamp };
      }
      await chunkedStore.setItem(deltaKey, JSON.stringify(delta));
      return written;
    });
  } catch (err) {
    lastFinanceCacheError = err instanceof Error ? err : new Error(String(err));
    return {};
  }
}

async function clearCacheDeltaEntries(
  userId: string,
  context: HouseholdContext | undefined,
  stampsToClear: CacheDeltaStamps,
  preResolvedDeltaKey?: string,
): Promise<void> {
  if (!hasCacheDeltaStamps(stampsToClear)) return;
  const scopeKey = cacheScopeKey(userId, context);
  const deltaKey = preResolvedDeltaKey ?? await cacheDeltaKey(userId, context);
  await withCacheDeltaLock(scopeKey, async () => {
    const raw = await chunkedStore.getItem(deltaKey);
    if (!raw) return;
    const delta = parseFinanceCacheDelta(raw, context);
    for (const [id, expected] of Object.entries(stampsToClear.transactions ?? {})) {
      if ((delta.stamps.transactions[id] ?? '') === expected) {
        delete delta.transactions[id];
        delete delta.stamps.transactions[id];
      }
    }
    for (const [id, expected] of Object.entries(stampsToClear.bills ?? {})) {
      if ((delta.stamps.bills[id] ?? '') === expected) {
        delete delta.bills[id];
        delete delta.stamps.bills[id];
      }
    }
    for (const [id, expected] of Object.entries(stampsToClear.removedBillIds ?? {})) {
      if ((delta.stamps.removedBillIds[id] ?? '') === expected) {
        delta.removedBillIds = delta.removedBillIds.filter(item => item !== id);
        delete delta.stamps.removedBillIds[id];
      }
    }
    for (const [id, expected] of Object.entries(stampsToClear.anchors ?? {})) {
      if ((delta.stamps.anchors[id] ?? '') === expected) {
        delete delta.anchors[id];
        delete delta.stamps.anchors[id];
      }
    }
    for (const [id, expected] of Object.entries(stampsToClear.removedAnchorIds ?? {})) {
      if ((delta.stamps.removedAnchorIds[id] ?? '') === expected) {
        delta.removedAnchorIds = delta.removedAnchorIds.filter(item => item !== id);
        delete delta.stamps.removedAnchorIds[id];
      }
    }
    if (isCacheDeltaEmpty(delta)) await chunkedStore.removeItem(deltaKey);
    else await chunkedStore.setItem(deltaKey, JSON.stringify(delta));
  });
}

function applyCacheDeltaToRows<T extends { id: string }>(
  base: readonly T[],
  overrides: Readonly<Record<string, T>>,
  removeIds: readonly string[] = [],
): T[] {
  const byId = new Map(base.map(row => [row.id, row]));
  for (const row of Object.values(overrides)) byId.set(row.id, row);
  for (const id of removeIds) byId.delete(id);
  return [...byId.values()];
}

async function readLocalFinanceBaseline(
  userId: string,
  currency: string,
  context: HouseholdContext | undefined,
  cacheKeys: FinanceCacheKeys,
): Promise<LocalFinanceBaseline> {
  const [pendingTxs, pendingBills, pendingAnchors, pendingSummary, delta] = await Promise.all([
    readPending(userId, 'transactions', context),
    readPending(userId, 'bills', context),
    readPending(userId, 'anchors', context),
    getPendingFinanceSummaryUnlocked(userId, context),
    readCacheDelta(userId, context, cacheKeys.cacheDelta),
  ]);

  let parsedTxs: SupabaseTransactionRow[] = [];
  try {
    const rawTxs = await chunkedStore.getItem(cacheKeys.transactions);
    const candidate = rawTxs ? JSON.parse(rawTxs) as SupabaseTransactionRow[] : [];
    if (!Array.isArray(candidate) || (context && candidate.some(row => row?.household_id !== context.householdId))) {
      throw new Error('Cached transactions are outside the selected household.');
    }
    parsedTxs = candidate;
  } catch {
    // Local cache read failed; fall back to empty base while preserving delta/pending layers.
  }

  let parsedBills: SupabaseRecurringBillRow[] = [];
  try {
    const rawBills = await chunkedStore.getItem(cacheKeys.bills);
    const candidate = rawBills ? JSON.parse(rawBills) as SupabaseRecurringBillRow[] : [];
    if (!Array.isArray(candidate) || (context && candidate.some(row => row?.household_id !== context.householdId))) {
      throw new Error('Cached recurring bills are outside the selected household.');
    }
    parsedBills = candidate;
  } catch {
    // Local cache read failed
  }

  let parsedAnchors: SupabaseReconciliationAnchorRow[] = [];
  try {
    const rawAnchors = await chunkedStore.getItem(cacheKeys.anchors);
    const candidate = rawAnchors ? JSON.parse(rawAnchors) as SupabaseReconciliationAnchorRow[] : [];
    if (!Array.isArray(candidate) || (context && candidate.some(row => row?.household_id !== context.householdId))) {
      throw new Error('Cached reconciliation anchors are outside the selected household.');
    }
    parsedAnchors = candidate;
  } catch {
    // Local cache read failed
  }

  const transactions = mergeFinanceRowsWithPendingWrites(
    applyCacheDeltaToRows(parsedTxs, delta.transactions),
    pendingTxs,
  ).map(r => ({
    ...decodeTransactionRow(r, currency),
    isPending: Object.prototype.hasOwnProperty.call(pendingTxs, r.id),
  }));

  const recurringBills = mergeFinanceRowsWithPendingWrites(
    applyCacheDeltaToRows(parsedBills, delta.bills, delta.removedBillIds),
    pendingBills,
  ).map(r => decodeRecurringBillRow(r, currency));

  const reconciliationAnchors = mergeFinanceRowsWithPendingWrites(
    applyCacheDeltaToRows(parsedAnchors, delta.anchors, delta.removedAnchorIds),
    pendingAnchors,
  ).map(r => decodeReconciliationAnchorRow(r, currency));

  return {
    transactions,
    recurringBills,
    reconciliationAnchors,
    pendingWriteCount: pendingSummary.total,
  };
}

function buildCachedLoadResult(
  baseline: LocalFinanceBaseline,
  failure?: { error: Error; failureKind: 'rejected' | 'uncertain' },
): LoadedFinanceRecords {
  return {
    transactions: baseline.transactions,
    recurringBills: baseline.recurringBills,
    reconciliationAnchors: baseline.reconciliationAnchors,
    syncStatus: 'cached_offline',
    snapshotStatus: classifyFinanceSnapshot('cache', baseline.pendingWriteCount > 0),
    pendingWriteCount: baseline.pendingWriteCount,
    ...(failure ? { error: failure.error, failureKind: failure.failureKind } : {}),
  };
}

/**
 * Load transactions, recurring bills, and reconciliation anchors from Supabase or local cache.
 * Remote network reads run outside `withFinanceLock` so slow syncs never block local mutations.
 */
async function loadFinanceRecordsThreePhase(params: {
  session: Session | null;
  userId: string;
  currency: string;
  householdContext?: HouseholdContext;
}): Promise<LoadedFinanceRecords> {
  const { session, userId, currency } = params;

  for (let attempt = 0; attempt < 2; attempt++) {
    // Phase 1 (under lock): flush cache writes, read baseline, check recovery readiness, capture generations.
    const phase1 = await withFinanceLock(userId, async () => {
      const context = verifiedFinanceContext(userId, session, params.householdContext);
      if (context) await rememberFinanceContext(context);
      const scopeKey = cacheScopeKey(userId, context);
      const cacheKeys = await resolveFinanceCacheKeys(userId, context);
      await flushFinanceCacheWrites(userId, context);
      const baseline = await readLocalFinanceBaseline(userId, currency, context, cacheKeys);

      if (!session) {
        return { done: true as const, result: buildCachedLoadResult(baseline) };
      }
      if (!session.user || session.user.id !== userId) {
        return {
          done: true as const,
          result: buildCachedLoadResult(baseline, {
            error: new Error('Finance session does not match the requested user.'),
            failureKind: 'rejected',
          }),
        };
      }
      try {
        if (!context) throw new Error('A current household context is required for authenticated finance reads.');
        await assertHouseholdFinanceContextReady(context, { allowCurrentMembershipPending: true });
      } catch (err) {
        return {
          done: true as const,
          result: buildCachedLoadResult(baseline, {
            error: err instanceof Error ? err : new Error(String(err)),
            failureKind: 'uncertain',
          }),
        };
      }
      return {
        done: false as const,
        context,
        scopeKey,
        cacheKeys,
        startMutationGen: getMutationGeneration(scopeKey),
        startCacheGen: getCacheScopeGeneration(scopeKey),
      };
    }, params.householdContext);

    if (phase1.done) return phase1.result;

    // Phase 2 (lock-free): fetch authoritative remote domains without blocking concurrent mutations.
    let remoteData: {
      txRows: SupabaseTransactionRow[];
      billRows: SupabaseRecurringBillRow[];
      anchorRows: SupabaseReconciliationAnchorRow[];
    };
    try {
      const supabase = supabaseClientProvider();
      const [txRows, billRows, anchorRows] = await Promise.all([
        readCompleteTransactions(supabase, phase1.context),
        readCompleteFinanceDomain(supabase, 'recurring_bills', phase1.context, { column: 'due_day', ascending: true }),
        readCompleteFinanceDomain(supabase, 'reconciliation_anchors', phase1.context, { column: 'as_of_date', ascending: false }),
      ]);
      remoteData = {
        txRows,
        billRows: billRows as SupabaseRecurringBillRow[],
        anchorRows: anchorRows as SupabaseReconciliationAnchorRow[],
      };
    } catch (err) {
      return withFinanceLock(userId, async () => {
        const baseline = await readLocalFinanceBaseline(userId, currency, phase1.context, phase1.cacheKeys);
        return buildCachedLoadResult(baseline, {
          error: err instanceof Error ? err : new Error(String(err)),
          failureKind: 'uncertain',
        });
      }, params.householdContext);
    }

    // Phase 3 (under lock): validate cache & mutation generations before applying remote rows.
    const phase3 = await withFinanceLock(userId, async () => {
      if (getCacheScopeGeneration(phase1.scopeKey) !== phase1.startCacheGen) {
        const cleanBaseline = await readLocalFinanceBaseline(userId, currency, phase1.context, phase1.cacheKeys);
        return { status: 'done' as const, result: buildCachedLoadResult(cleanBaseline) };
      }

      if (getMutationGeneration(phase1.scopeKey) !== phase1.startMutationGen) {
        if (attempt === 0) {
          return { status: 'retry' as const };
        }
        const localBaseline = await readLocalFinanceBaseline(userId, currency, phase1.context, phase1.cacheKeys);
        return { status: 'done' as const, result: buildCachedLoadResult(localBaseline) };
      }

      try {
        const { txRows, billRows, anchorRows } = remoteData;
        // Evaluate each single-row command against complete readback. Grouped reconciliation
        // deliberately has no complete-command proof from row snapshots alone.
        const evidence = {
          byDomain: {
            transactions: { authoritative: true, complete: true, rows: txRows.map(row => ({ id: row.id, row })) },
            bills: { authoritative: true, complete: true, rows: billRows.map(row => ({ id: row.id, row })) },
            anchors: { authoritative: true, complete: true, rows: anchorRows.map(row => ({ id: row.id, row })) },
          },
        };
        for (const command of await scopedJournal(phase1.context).list()) {
          try { await scopedJournal(phase1.context).evaluateReadback(command.commandId, evidence); } catch { /* retain corrupt/unsupported operation for review */ }
        }
        const [currentPendingTxs, currentPendingBills, currentPendingAnchors] = await Promise.all([
          readPending(userId, 'transactions', phase1.context),
          readPending(userId, 'bills', phase1.context),
          readPending(userId, 'anchors', phase1.context),
        ]);
        const remoteTxRows = mergeFinanceRowsWithPendingWrites(txRows, currentPendingTxs);
        const remoteBillRows = mergeFinanceRowsWithPendingWrites(billRows, currentPendingBills);
        const remoteAnchorRows = mergeFinanceRowsWithPendingWrites(anchorRows, currentPendingAnchors);
        const remoteTxs = remoteTxRows.map(r => ({
          ...decodeTransactionRow(r, currency),
          isPending: Object.prototype.hasOwnProperty.call(currentPendingTxs, r.id),
        }));
        const remoteBills = remoteBillRows.map(r => decodeRecurringBillRow(r, currency));
        const remoteAnchors = remoteAnchorRows.map(r => decodeReconciliationAnchorRow(r, currency));
        const snapshotDeltaStamps = await readCacheDeltaStamps(userId, phase1.context, phase1.cacheKeys.cacheDelta);

        // Keep durable unsynced local intents; authoritative remote rows only replace
        // records that have no outstanding local write.
        enqueueFinanceCacheWrite(userId, phase1.context, async () => {
          await Promise.all([
            chunkedStore.setItem(phase1.cacheKeys.transactions, JSON.stringify(remoteTxRows)),
            chunkedStore.setItem(phase1.cacheKeys.bills, JSON.stringify(remoteBillRows)),
            chunkedStore.setItem(phase1.cacheKeys.anchors, JSON.stringify(remoteAnchorRows)),
          ]);
          await clearCacheDeltaEntries(userId, phase1.context, snapshotDeltaStamps, phase1.cacheKeys.cacheDelta);
        });

        const pendingWriteCount = (await getPendingFinanceSummaryUnlocked(userId, phase1.context)).total;
        const snapshotStatus = classifyFinanceSnapshot('authoritative', pendingWriteCount > 0);
        return {
          status: 'done' as const,
          result: {
            transactions: remoteTxs,
            recurringBills: remoteBills,
            reconciliationAnchors: remoteAnchors,
            syncStatus: pendingWriteCount > 0 ? ('cached_offline' as const) : ('synced' as const),
            snapshotStatus,
            pendingWriteCount,
          },
        };
      } catch (err) {
        const localBaseline = await readLocalFinanceBaseline(userId, currency, phase1.context, phase1.cacheKeys);
        return {
          status: 'done' as const,
          result: buildCachedLoadResult(localBaseline, {
            error: err instanceof Error ? err : new Error(String(err)),
            failureKind: 'uncertain',
          }),
        };
      }
    }, params.householdContext);

    if (phase3.status === 'done') return phase3.result;
  }

  // Unreachable because attempt === 1 always returns 'done'.
  throw new Error('Finance load retry exhausted unexpectedly.');
}

/** Persist a ledger transaction to Supabase and local cache. */
async function persistTransactionUnlocked(params: {
  session: Session | null;
  userId: string;
  householdContext?: HouseholdContext;
  transaction: LedgerTransaction;
  allTransactions: LedgerTransaction[];
  expectedVersion?: number;
}): Promise<FinanceMutationResult<LedgerTransaction>> {
  const { session, userId, transaction, allTransactions, expectedVersion } = params;
  if (!session && isLocalAcceptanceFinanceOwner(userId)) {
    bumpMutationGeneration(userId);
    await clearLocalAcceptancePendingForRow(userId, 'transactions', transaction.id);
    const updatedAt = transaction.updatedAt ?? new Date().toISOString();
    const localTx: LedgerTransaction = { ...transaction, updatedAt, isPending: false };
    const row = encodeTransactionRow(localTx, userId, null);
    const cacheKey = await financeCacheKey(userId, 'txs');
    await mergeRowsIntoCache(cacheKey, allTransactions.map(tx => encodeTransactionRow(tx, userId, null)), [row]);
    return { data: localTx, syncStatus: 'synced', outcome: 'confirmed', updatedAt };
  }
  const context = verifiedFinanceContext(userId, session, params.householdContext);
  if (context) await rememberFinanceContext(context);
  const commandId = newCommandId('transaction:create', transaction.id);
  const row = encodeTransactionRow(transaction, userId, context?.householdId ?? null);
  await savePendingCommand(userId, { commandId, kind: 'transaction_create', expectedVersions: { account: expectedVersion ?? null },
    payload: { rpc_name: 'debtfree_record_household_transaction_atomic', p_household_id: context?.householdId, p_expected_membership_version: context?.membershipVersion, p_tx: row, p_idempotency_key: transaction.id, p_expected_version: expectedVersion ?? null },
    members: [{ domain: 'transactions', rowId: transaction.id, desired: row }], state: 'pending',
    dispatchState: session?.user?.id === userId ? 'dispatched' : 'not_dispatched' }, context);
  bumpMutationGeneration(userId, context);

  if (!(session && session.user && session.user.id === userId)) {
    const cacheKey = await financeCacheKey(userId, 'txs', context);
    await mergeRowsIntoCache(cacheKey, allTransactions.map(tx => encodeTransactionRow(tx, userId, context?.householdId ?? null)), [row]);
  }

  // 2. If authenticated, upsert to Supabase
  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = supabaseClientProvider();
      const row = encodeTransactionRow(transaction, userId, context?.householdId ?? null);

      // Debt-affecting records require the atomic RPC. A missing RPC may use a
      // plain insert only for cash-only entries that cannot mutate debt balance.
      try {
        const { data, error: rpcError } = await supabase.rpc('debtfree_record_household_transaction_atomic', {
          p_household_id: context!.householdId,
          p_expected_membership_version: context!.membershipVersion,
          p_tx: row,
          p_idempotency_key: transaction.id,
          p_expected_version: expectedVersion ?? null,
        });
        if (!rpcError) {
          const receipt = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
          if (!isHouseholdReceipt(receipt, context) || !isHouseholdRow(receipt.row, context, transaction.id)) {
            await updatePendingCommand(userId, commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: 'Transaction receipt did not match the selected household and transaction.' } }, context);
            return {
              data: transaction,
              syncStatus: 'cached_offline',
              outcome: 'pending',
              failureKind: 'uncertain',
              error: new Error('Transaction write could not be confirmed for this household.')
            };
          }
          const rawBalance = receipt.new_balance;
          const accountBalance = typeof rawBalance === 'number' ? rawBalance : typeof rawBalance === 'string' ? Number(rawBalance) : undefined;
          const rawVersion = receipt.new_version;
          const accountVersion = typeof rawVersion === 'number' ? rawVersion : typeof rawVersion === 'string' ? Number(rawVersion) : undefined;
          const rawUpdatedAt = typeof receipt.updated_at === 'string' ? receipt.updated_at : undefined;

          const confirmedTx: LedgerTransaction = {
            ...transaction,
            updatedAt: rawUpdatedAt ?? transaction.updatedAt,
            isPending: false,
          };
          const confirmedRow = receipt.row as SupabaseTransactionRow;
          const deltaStamps = await recordCacheDelta(userId, context, { transaction: confirmedRow });
          await finishPendingCommand(userId, commandId, context);
          enqueueFinanceCacheWrite(userId, context, async () => {
            await mergeRowsIntoCache(await financeCacheKey(userId, 'txs', context),
              allTransactions.map(tx => encodeTransactionRow(tx, userId, context?.householdId ?? null)),
              [confirmedRow], [], true);
            await clearCacheDeltaEntries(userId, context, deltaStamps);
          });

          return {
            data: confirmedTx,
            syncStatus: 'synced',
            outcome: 'confirmed',
            accountBalance: Number.isFinite(accountBalance) ? accountBalance : undefined,
            accountVersion: Number.isSafeInteger(accountVersion) ? accountVersion : undefined,
            updatedAt: rawUpdatedAt,
          };
        }
        // Never bypass atomic RPCs with direct table inserts, including cash-only entries.
        // Missing migrations are a confirmed rejection, not a reason to weaken the ledger.

        const isConflict = rpcError.message.includes('CONCURRENCY_CONFLICT') ||
          rpcError.message.includes('MISSING_REVISION') ||
          rpcError.code === 'P0001' ||
          rpcError.code === 'P0002';
        const isIdempotencyConflict = rpcError.message.includes('IDEMPOTENCY_CONFLICT');
        const rejected = isConflict || isIdempotencyConflict || ['42501', '23514', '23502', '23503', '23505', '22P02', '42883', 'PGRST202'].includes(rpcError.code ?? '');
        if (rejected) {
          await rejectPendingCommand(userId, commandId, rpcError.message, context);
        }
        const userMsg = isConflict
          ? 'Account revision conflict: This debt was updated concurrently by another session. Please refresh.'
          : (isIdempotencyConflict ? 'Duplicate transaction conflict: This ID was used with different financial data.' : rpcError.message);
        return {
          data: { ...transaction, isPending: !rejected },
          syncStatus: 'cached_offline',
          outcome: rejected ? 'rejected' : 'pending',
          failureKind: rejected ? 'rejected' : 'uncertain',
          isConflict,
          error: new Error(userMsg),
        };
      } catch (err) {
        return {
          data: { ...transaction, isPending: true },
          syncStatus: 'cached_offline',
          outcome: 'pending',
          failureKind: 'uncertain',
          error: err instanceof Error ? err : new Error(String(err))
        };
      }
    } catch (err) {
      return {
        data: { ...transaction, isPending: true },
        syncStatus: 'cached_offline',
        outcome: 'pending',
        failureKind: 'uncertain',
        error: err instanceof Error ? err : new Error(String(err))
      };
    }
  }

  return { data: { ...transaction, isPending: true }, syncStatus: 'cached_offline', outcome: 'pending' };
}

/** Update an existing ledger transaction with atomic debt balance recalculation. */
async function updateTransactionUnlocked(params: {
  session: Session | null;
  userId: string;
  householdContext?: HouseholdContext;
  transaction: LedgerTransaction;
  allTransactions: LedgerTransaction[];
  expectedVersion?: number;
  expectedOldAccountVersion?: number;
  expectedTxVersion?: string;
}): Promise<FinanceMutationResult<LedgerTransaction>> {
  const {
    session,
    userId,
    transaction,
    allTransactions,
    expectedVersion,
    expectedOldAccountVersion,
    expectedTxVersion,
  } = params;
  if (!session && isLocalAcceptanceFinanceOwner(userId)) {
    bumpMutationGeneration(userId);
    await clearLocalAcceptancePendingForRow(userId, 'transactions', transaction.id);
    const updatedAt = new Date().toISOString();
    const localTx: LedgerTransaction = { ...transaction, updatedAt, isPending: false };
    const row = encodeTransactionRow(localTx, userId, null);
    const cacheKey = await financeCacheKey(userId, 'txs');
    await mergeRowsIntoCache(cacheKey, allTransactions.map(tx => encodeTransactionRow(tx, userId, null)), [row]);
    return { data: localTx, syncStatus: 'synced', outcome: 'confirmed', updatedAt };
  }
  const context = verifiedFinanceContext(userId, session, params.householdContext);
  if (context) await rememberFinanceContext(context);
  const commandId = newCommandId('transaction:update', transaction.id);
  const row = encodeTransactionRow(transaction, userId, context?.householdId ?? null);
  const payload = { rpc_name: 'debtfree_update_household_transaction_atomic', p_household_id: context?.householdId,
    p_expected_membership_version: context?.membershipVersion, p_tx: row, p_idempotency_key: transaction.id,
    p_expected_version: expectedVersion ?? null, p_expected_old_account_version: expectedOldAccountVersion ?? null,
    p_expected_tx_version: expectedTxVersion ?? null };
  await savePendingCommand(userId, { commandId, kind: 'transaction_update',
    expectedVersions: { account: expectedVersion ?? null, oldAccount: expectedOldAccountVersion ?? null, transaction: expectedTxVersion ?? null },
    payload, members: [{ domain: 'transactions', rowId: transaction.id, desired: row }], state: 'pending',
    dispatchState: session?.user?.id === userId ? 'dispatched' : 'not_dispatched' }, context);
  bumpMutationGeneration(userId, context);

  // 1. Update local cache immediately only when offline
  if (!(session && session.user && session.user.id === userId)) {
    const cacheKey = await financeCacheKey(userId, 'txs', context);
    await mergeRowsIntoCache(cacheKey, allTransactions.map(tx => encodeTransactionRow(tx, userId, context?.householdId ?? null)), [encodeTransactionRow(transaction, userId, context?.householdId ?? null)]);
  }

  // 2. If authenticated, update via atomic RPC
  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = supabaseClientProvider();
      const row = encodeTransactionRow(transaction, userId, context?.householdId ?? null);

      const { data, error: rpcError } = await supabase.rpc('debtfree_update_household_transaction_atomic', {
        p_household_id: context!.householdId,
        p_expected_membership_version: context!.membershipVersion,
        p_tx: row,
        p_idempotency_key: transaction.id,
        p_expected_version: expectedVersion ?? null,
        p_expected_old_account_version: expectedOldAccountVersion ?? null,
        p_expected_tx_version: expectedTxVersion ?? null,
      });

      if (!rpcError) {
        const receipt = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
        if (!isHouseholdReceipt(receipt, context) || !isHouseholdRow(receipt.row, context, transaction.id)) {
          await updatePendingCommand(userId, commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: 'Transaction update receipt did not match the selected household and transaction.' } }, context);
          return {
            data: transaction,
            syncStatus: 'cached_offline',
            outcome: 'pending',
            failureKind: 'uncertain',
            error: new Error('Transaction update could not be confirmed for this household.')
          };
        }
        const confirmedRow = receipt.row as SupabaseTransactionRow;
        const deltaStamps = await recordCacheDelta(userId, context, { transaction: confirmedRow });
        await finishPendingCommand(userId, commandId, context);
        const rawBalance = receipt.new_balance;
        const accountBalance = typeof rawBalance === 'number' ? rawBalance : typeof rawBalance === 'string' ? Number(rawBalance) : undefined;
        const rawVersion = receipt.new_version;
        const accountVersion = typeof rawVersion === 'number' ? rawVersion : typeof rawVersion === 'string' ? Number(rawVersion) : undefined;

        const rawOldBalance = receipt.old_balance;
        const oldAccountBalance = typeof rawOldBalance === 'number' ? rawOldBalance : typeof rawOldBalance === 'string' ? Number(rawOldBalance) : undefined;
        const rawOldVersion = receipt.old_version;
        const oldAccountVersion = typeof rawOldVersion === 'number' ? rawOldVersion : typeof rawOldVersion === 'string' ? Number(rawOldVersion) : undefined;
        const oldAccountId = receipt.old_account_id as string | null | undefined;
        const rawUpdatedAt = typeof receipt.updated_at === 'string' ? receipt.updated_at : undefined;

        const confirmedTx: LedgerTransaction = {
          ...transaction,
          updatedAt: rawUpdatedAt ?? transaction.updatedAt,
          isPending: false,
        };
        enqueueFinanceCacheWrite(userId, context, async () => {
          await mergeRowsIntoCache(await financeCacheKey(userId, 'txs', context),
            allTransactions.map(tx => encodeTransactionRow(tx, userId, context?.householdId ?? null)),
            [confirmedRow], [], true);
          await clearCacheDeltaEntries(userId, context, deltaStamps);
        });

        return {
          data: confirmedTx,
          syncStatus: 'synced',
          outcome: 'confirmed',
          accountBalance: Number.isFinite(accountBalance) ? accountBalance : undefined,
          accountVersion: Number.isSafeInteger(accountVersion) ? accountVersion : undefined,
          oldAccountBalance: Number.isFinite(oldAccountBalance) ? oldAccountBalance : undefined,
          oldAccountVersion: Number.isSafeInteger(oldAccountVersion) ? oldAccountVersion : undefined,
          oldAccountId,
          updatedAt: rawUpdatedAt,
        };
      }

      const isConflict = rpcError.message.includes('CONCURRENCY_CONFLICT') ||
        rpcError.message.includes('MISSING_REVISION') ||
        rpcError.code === 'P0001' ||
        rpcError.code === 'P0002';
      const isIdempotencyConflict = rpcError.message.includes('IDEMPOTENCY_CONFLICT');
      const rejected = isConflict || isIdempotencyConflict || ['42501', '23514', '23502', '23503', '23505', '22P02', '42883', 'PGRST202'].includes(rpcError.code ?? '');
      if (rejected) {
        await rejectPendingCommand(userId, commandId, rpcError.message, context);
      }
      const userMsg = isConflict
        ? 'Account revision conflict: This debt was updated concurrently by another session. Please refresh.'
        : (isIdempotencyConflict ? 'Conflict: Transaction cannot be updated with contradictory data.' : rpcError.message);
      return {
        data: { ...transaction, isPending: !rejected },
        syncStatus: 'cached_offline',
        outcome: rejected ? 'rejected' : 'pending',
        failureKind: rejected ? 'rejected' : 'uncertain',
        isConflict,
        error: new Error(userMsg),
      };
    } catch (err) {
      return {
        data: { ...transaction, isPending: true },
        syncStatus: 'cached_offline',
        outcome: 'pending',
        failureKind: 'uncertain',
        error: err instanceof Error ? err : new Error(String(err))
      };
    }
  }

  return { data: { ...transaction, isPending: true }, syncStatus: 'cached_offline', outcome: 'pending' };
}

/** Soft-delete a transaction and atomically reverse its debt balance effect. */
async function deleteTransactionUnlocked(params: {
  session: Session | null;
  userId: string;
  householdContext?: HouseholdContext;
  transactionId: string;
  allTransactions: LedgerTransaction[];
  expectedVersion?: number;
  expectedTxVersion?: string;
}): Promise<FinanceMutationResult<string>> {
  const { session, userId, transactionId, allTransactions, expectedVersion, expectedTxVersion } = params;
  if (!session && isLocalAcceptanceFinanceOwner(userId)) {
    bumpMutationGeneration(userId);
    const targetTx = allTransactions.find(t => t.id === transactionId);
    if (!targetTx) return { data: transactionId, syncStatus: 'cached_offline', outcome: 'rejected', failureKind: 'rejected', error: new Error('Transaction to delete was not found.') };
    await clearLocalAcceptancePendingForRow(userId, 'transactions', transactionId);
    const deletedAt = targetTx.deletedAt ?? new Date().toISOString();
    const desiredDeletedRow = encodeTransactionRow({ ...targetTx, deletedAt, updatedAt: deletedAt }, userId, null);
    const cacheKey = await financeCacheKey(userId, 'txs');
    await mergeRowsIntoCache(cacheKey, allTransactions.map(tx => encodeTransactionRow(tx, userId, null)), [desiredDeletedRow]);
    return { data: transactionId, syncStatus: 'synced', outcome: 'confirmed', updatedAt: deletedAt };
  }
  const context = verifiedFinanceContext(userId, session, params.householdContext);
  if (context) await rememberFinanceContext(context);
  const commandId = newCommandId('transaction:delete', transactionId);
  const targetTx = allTransactions.find(t => t.id === transactionId);
  if (!targetTx) return { data: transactionId, syncStatus: 'cached_offline', outcome: 'rejected', failureKind: 'rejected', error: new Error('Transaction to delete was not found.') };
  const desiredDeletedRow = encodeTransactionRow(
    { ...targetTx, deletedAt: targetTx.deletedAt ?? new Date().toISOString() },
    userId,
    context?.householdId ?? null,
  );
  const deletePayload = { rpc_name: 'debtfree_delete_household_transaction_atomic', p_household_id: context?.householdId,
    p_expected_membership_version: context?.membershipVersion, p_tx_id: transactionId, p_idempotency_key: transactionId,
    p_expected_version: expectedVersion ?? null, p_expected_tx_version: expectedTxVersion ?? null };
  await savePendingCommand(userId, { commandId, kind: 'transaction_delete',
    expectedVersions: { account: expectedVersion ?? null, transaction: expectedTxVersion ?? null }, payload: deletePayload,
    members: [{ domain: 'transactions', rowId: transactionId, desired: desiredDeletedRow }], state: 'pending',
    dispatchState: session?.user?.id === userId ? 'dispatched' : 'not_dispatched' }, context);
  bumpMutationGeneration(userId, context);

  if (!(session && session.user && session.user.id === userId)) {
    const cacheKey = await financeCacheKey(userId, 'txs', context);
    await mergeRowsIntoCache(cacheKey, allTransactions.map(tx => encodeTransactionRow(tx, userId, context?.householdId ?? null)), [desiredDeletedRow]);
  }

  // 2. If authenticated, soft delete via atomic RPC
  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = supabaseClientProvider();
      const { data, error: rpcError } = await supabase.rpc('debtfree_delete_household_transaction_atomic', {
        p_household_id: context!.householdId,
        p_expected_membership_version: context!.membershipVersion,
        p_tx_id: transactionId,
        p_idempotency_key: transactionId,
        p_expected_version: expectedVersion ?? null,
        p_expected_tx_version: expectedTxVersion ?? null,
      });

      if (!rpcError) {
        const receipt = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
        if (!isHouseholdReceipt(receipt, context) || !isHouseholdRow(receipt.row, context, transactionId)
            || (receipt.row as Record<string, unknown>).deleted_at == null) {
          await updatePendingCommand(userId, commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: 'Transaction deletion receipt did not match the selected household and deleted transaction.' } }, context);
          return {
            data: transactionId,
            syncStatus: 'cached_offline',
            outcome: 'pending',
            failureKind: 'uncertain',
            error: new Error('Transaction deletion could not be confirmed for this household.')
          };
        }
        const rawBalance = receipt.new_balance;
        const accountBalance = typeof rawBalance === 'number' ? rawBalance : typeof rawBalance === 'string' ? Number(rawBalance) : undefined;
        const rawVersion = receipt.new_version;
        const accountVersion = typeof rawVersion === 'number' ? rawVersion : typeof rawVersion === 'string' ? Number(rawVersion) : undefined;

        const rawUpdatedAt = typeof receipt.updated_at === 'string' ? receipt.updated_at : undefined;
        const confirmedRow = receipt.row as SupabaseTransactionRow;
        const deltaStamps = await recordCacheDelta(userId, context, { transaction: confirmedRow });
        await finishPendingCommand(userId, commandId, context);
        enqueueFinanceCacheWrite(userId, context, async () => {
          await mergeRowsIntoCache(await financeCacheKey(userId, 'txs', context),
            allTransactions.map(tx => encodeTransactionRow(tx, userId, context?.householdId ?? null)),
            [confirmedRow], [], true);
          await clearCacheDeltaEntries(userId, context, deltaStamps);
        });

        return {
          data: transactionId,
          syncStatus: 'synced',
          outcome: 'confirmed',
          accountBalance: Number.isFinite(accountBalance) ? accountBalance : undefined,
          accountVersion: Number.isSafeInteger(accountVersion) ? accountVersion : undefined,
          updatedAt: rawUpdatedAt,
        };
      }

      const isConflict = rpcError.message.includes('CONCURRENCY_CONFLICT') ||
        rpcError.message.includes('MISSING_REVISION') ||
        rpcError.code === 'P0001' ||
        rpcError.code === 'P0002';
      const rejected = isConflict || ['42501', '23514', '23502', '23503', '23505', '22P02', '42883', 'PGRST202'].includes(rpcError.code ?? '');
      if (rejected) {
        await rejectPendingCommand(userId, commandId, rpcError.message, context);
      }
      const userMsg = isConflict
        ? 'Account revision conflict: This debt was updated concurrently by another session. Please refresh.'
        : rpcError.message;
      return {
        data: transactionId,
        syncStatus: 'cached_offline',
        outcome: rejected ? 'rejected' : 'pending',
        failureKind: rejected ? 'rejected' : 'uncertain',
        isConflict,
        error: new Error(userMsg),
      };
    } catch (err) {
      return {
        data: transactionId,
        syncStatus: 'cached_offline',
        outcome: 'pending',
        failureKind: 'uncertain',
        error: err instanceof Error ? err : new Error(String(err))
      };
    }
  }

  return { data: transactionId, syncStatus: 'cached_offline', outcome: 'pending' };
}

/** Persist a recurring bill through an explicitly household-bound RPC. */
async function persistRecurringBillUnlocked(params: {
  session: Session | null;
  userId: string;
  householdContext?: HouseholdContext;
  bill: RecurringBill;
  currentBills: RecurringBill[];
}): Promise<FinanceMutationResult<RecurringBill>> {
  const { session, userId, bill, currentBills } = params;
  if (!session && isLocalAcceptanceFinanceOwner(userId)) {
    bumpMutationGeneration(userId);
    await clearLocalAcceptancePendingForRow(userId, 'bills', bill.id);
    const updatedAt = new Date().toISOString();
    const localBill: RecurringBill = { ...bill, updatedAt };
    const row = encodeRecurringBillRow(localBill, userId, null, updatedAt);
    const cacheKey = await financeCacheKey(userId, 'bills');
    await mergeRowsIntoCache(cacheKey, currentBills.map(item => encodeRecurringBillRow(item, userId, null)), [row]);
    return { data: localBill, syncStatus: 'synced', outcome: 'confirmed', updatedAt };
  }
  const context = verifiedFinanceContext(userId, session, params.householdContext);
  if (context) await rememberFinanceContext(context);
  const commandId = newCommandId('bill:upsert', bill.id);
  const previousBill = currentBills.find(item => item.id === bill.id);
  const expectedRevision = previousBill?.updatedAt;
  if (previousBill && !expectedRevision) throw new Error('This recurring bill update needs review because its server revision is unavailable.');
  const now = Date.now();
  const expectedMillis = expectedRevision ? Date.parse(expectedRevision) : Number.NaN;
  const updatedAt = new Date(Number.isFinite(expectedMillis) ? Math.max(now, expectedMillis + 1) : now).toISOString();
  const row = encodeRecurringBillRow({ ...bill, updatedAt }, userId, context?.householdId ?? null, updatedAt);
  const payload = {
    rpc_name: 'debtfree_upsert_household_bill_atomic',
    p_household_id: context?.householdId,
    p_expected_membership_version: context?.membershipVersion,
    p_bill: row,
    p_expected_updated_at: expectedRevision ?? null,
    p_idempotency_key: bill.id,
  };
  await savePendingCommand(userId, { commandId, kind: 'bill_upsert', expectedVersions: { updated_at: expectedRevision ?? null }, payload,
    members: [{ domain: 'bills', rowId: bill.id, desired: row }], state: 'pending',
    dispatchState: session?.user?.id === userId ? 'dispatched' : 'not_dispatched' }, context);
  bumpMutationGeneration(userId, context);
  const cacheKey = await financeCacheKey(userId, 'bills', context);
  const previousCache = await chunkedStore.getItem(cacheKey);
  await mergeRowsIntoCache(cacheKey, currentBills.map(item => encodeRecurringBillRow(item, userId, context?.householdId ?? null)), [row]);
  const pending = await readPending(userId, 'bills', context);
  const previousPending = { ...pending };
  pending[bill.id] = row;
  await writePending(userId, 'bills', pending);

  if (!session || session.user?.id !== userId) {
    await updatePendingCommand(userId, commandId, { state: 'needs_review', dispatchState: 'not_dispatched', reviewReason: 'Offline bill changes require manual review and are never replayed automatically.' }, context);
    return { data: bill, syncStatus: 'cached_offline', outcome: 'pending' };
  }
  try {
    const { rpc_name: _rpcName, ...rpcArgs } = payload;
    const { data, error } = await supabaseClientProvider().rpc('debtfree_upsert_household_bill_atomic', rpcArgs);
    if (error) {
      const rejected = ['42501', '23514', '23502', '23503', '23505', '22P02', '42883', 'PGRST202', 'P0001', 'P0002'].includes(error.code ?? '');
      if (rejected) {
        await rejectPendingCommand(userId, commandId, error.message, context);
        await writePending(userId, 'bills', previousPending).catch(() => {});
        await restoreCache(cacheKey, previousCache).catch(() => {});
      } else await updatePendingCommand(userId, commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: error.message } }, context);
      return { data: bill, syncStatus: 'cached_offline', outcome: rejected ? 'rejected' : 'pending', failureKind: rejected ? 'rejected' : 'uncertain', error: new Error(error.message) };
    }
    const receipt = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
    const returned = receipt?.row && typeof receipt.row === 'object' && !Array.isArray(receipt.row) ? receipt.row as SupabaseRecurringBillRow : null;
    if (!isHouseholdReceipt(receipt, context) || !isHouseholdRow(returned, context, bill.id)) {
      await updatePendingCommand(userId, commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: 'Household bill write receipt did not match this bill and household.' } }, context);
      return { data: bill, syncStatus: 'cached_offline', outcome: 'pending', failureKind: 'uncertain', error: new Error('Household bill write could not be confirmed for this household.') };
    }
    const confirmedBill = decodeRecurringBillRow(returned, bill.amount.currency);
    const deltaStamps = await recordCacheDelta(userId, context, { bill: returned });
    await finishPendingCommand(userId, commandId, context);
    delete pending[bill.id];
    await writePending(userId, 'bills', pending).catch(() => {});
    enqueueFinanceCacheWrite(userId, context, async () => {
      await mergeRowsIntoCache(cacheKey, [], [returned], [], true);
      await clearCacheDeltaEntries(userId, context, deltaStamps);
    });
    return { data: confirmedBill, syncStatus: 'synced', outcome: 'confirmed', updatedAt: confirmedBill.updatedAt };
  } catch (error) {
    await updatePendingCommand(userId, commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: error instanceof Error ? error.message : String(error) } }, context).catch(() => {});
    return { data: bill, syncStatus: 'cached_offline', outcome: 'pending', failureKind: 'uncertain', error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** Delete a recurring bill through an explicitly household-bound RPC. */
async function deleteRecurringBillUnlocked(params: {
  session: Session | null;
  userId: string;
  householdContext?: HouseholdContext;
  billId: string;
  currentBills: RecurringBill[];
}): Promise<FinanceMutationResult<string>> {
  const { session, userId, billId, currentBills } = params;
  if (!session && isLocalAcceptanceFinanceOwner(userId)) {
    bumpMutationGeneration(userId);
    const previousBill = currentBills.find(item => item.id === billId);
    if (!previousBill) return { data: billId, syncStatus: 'cached_offline', outcome: 'rejected', failureKind: 'rejected', error: new Error('Recurring bill to delete was not found.') };
    await clearLocalAcceptancePendingForRow(userId, 'bills', billId);
    const cacheKey = await financeCacheKey(userId, 'bills');
    await mergeRowsIntoCache(cacheKey, currentBills.map(item => encodeRecurringBillRow(item, userId, null)), [], [billId]);
    return { data: billId, syncStatus: 'synced', outcome: 'confirmed', updatedAt: new Date().toISOString() };
  }
  const context = verifiedFinanceContext(userId, session, params.householdContext);
  if (context) await rememberFinanceContext(context);
  const commandId = newCommandId('bill:delete', billId);
  const previousBill = currentBills.find(item => item.id === billId);
  if (!previousBill) return { data: billId, syncStatus: 'cached_offline', outcome: 'rejected', failureKind: 'rejected', error: new Error('Recurring bill to delete was not found.') };
  const expectedRevision = previousBill.updatedAt;
  if (!expectedRevision) throw new Error('This recurring bill deletion needs review because its server revision is unavailable.');
  const payload = {
    rpc_name: 'debtfree_delete_household_bill_atomic',
    p_household_id: context?.householdId,
    p_expected_membership_version: context?.membershipVersion,
    p_bill_id: billId,
    p_expected_updated_at: expectedRevision,
    p_operation_id: commandId,
  };
  await savePendingCommand(userId, { commandId, kind: 'bill_delete', expectedVersions: { updated_at: expectedRevision }, payload,
    members: [{ domain: 'bills', rowId: billId, desired: null }], state: 'pending',
    dispatchState: session?.user?.id === userId ? 'dispatched' : 'not_dispatched' }, context);
  bumpMutationGeneration(userId, context);
  const cacheKey = await financeCacheKey(userId, 'bills', context);
  const previousCache = await chunkedStore.getItem(cacheKey);
  await mergeRowsIntoCache(cacheKey, currentBills.map(item => encodeRecurringBillRow(item, userId, context?.householdId ?? null)), [], [billId]);
  if (!session || session.user?.id !== userId) {
    await updatePendingCommand(userId, commandId, { state: 'needs_review', dispatchState: 'not_dispatched', reviewReason: 'Offline bill changes require manual review and are never replayed automatically.' }, context);
    return { data: billId, syncStatus: 'cached_offline', outcome: 'pending' };
  }
  try {
    const { rpc_name: _rpcName, ...rpcArgs } = payload;
    const { data, error } = await supabaseClientProvider().rpc('debtfree_delete_household_bill_atomic', rpcArgs);
    if (error) {
      const rejected = ['42501', '23514', '23502', '23503', '23505', '22P02', '42883', 'PGRST202', 'P0001', 'P0002'].includes(error.code ?? '');
      if (rejected) {
        await rejectPendingCommand(userId, commandId, error.message, context);
        await restoreCache(cacheKey, previousCache).catch(() => {});
      } else await updatePendingCommand(userId, commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: error.message } }, context);
      return { data: billId, syncStatus: 'cached_offline', outcome: rejected ? 'rejected' : 'pending', failureKind: rejected ? 'rejected' : 'uncertain', error: new Error(error.message) };
    }
    const receipt = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
    if (!isHouseholdReceipt(receipt, context) || receipt.billId !== billId || receipt.deleted !== true) {
      await updatePendingCommand(userId, commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: 'Household bill deletion receipt did not match this bill and household.' } }, context);
      return { data: billId, syncStatus: 'cached_offline', outcome: 'pending', failureKind: 'uncertain', error: new Error('Household bill deletion could not be confirmed for this household.') };
    }
    const deltaStamps = await recordCacheDelta(userId, context, { removedBillId: billId });
    await finishPendingCommand(userId, commandId, context);
    enqueueFinanceCacheWrite(userId, context, async () => {
      await mergeRowsIntoCache(cacheKey, currentBills.map(item => encodeRecurringBillRow(item, userId, context?.householdId ?? null)), [], [billId], true);
      await clearCacheDeltaEntries(userId, context, deltaStamps);
    });
    return { data: billId, syncStatus: 'synced', outcome: 'confirmed', updatedAt: new Date().toISOString() };
  } catch (error) {
    await updatePendingCommand(userId, commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: error instanceof Error ? error.message : String(error) } }, context).catch(() => {});
    return { data: billId, syncStatus: 'cached_offline', outcome: 'pending', failureKind: 'uncertain', error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** Persist a reconciliation anchor through an explicitly household-bound RPC. */
async function persistReconciliationAnchorUnlocked(params: {
  session: Session | null;
  userId: string;
  householdContext?: HouseholdContext;
  anchor: ReconciliationAnchor;
  allAnchors: ReconciliationAnchor[];
}): Promise<FinanceMutationResult<ReconciliationAnchor>> {
  const { session, userId, anchor, allAnchors } = params;
  if (!session && isLocalAcceptanceFinanceOwner(userId)) {
    bumpMutationGeneration(userId);
    await clearLocalAcceptancePendingForRow(userId, 'anchors', anchor.id);
    const row = encodeReconciliationAnchorRow(anchor, userId, null);
    const cacheKey = await financeCacheKey(userId, 'anchors');
    await mergeRowsIntoCache(cacheKey, allAnchors.map(item => encodeReconciliationAnchorRow(item, userId, null)), [row]);
    return { data: anchor, syncStatus: 'synced', outcome: 'confirmed', updatedAt: anchor.createdAt };
  }
  const context = verifiedFinanceContext(userId, session, params.householdContext);
  if (context) await rememberFinanceContext(context);
  const commandId = newCommandId('anchor:upsert', anchor.id);
  const row = encodeReconciliationAnchorRow(anchor, userId, context?.householdId ?? null);
  const payload = { rpc_name: 'debtfree_upsert_household_anchor_atomic', p_household_id: context?.householdId,
    p_expected_membership_version: context?.membershipVersion, p_anchor: row, p_idempotency_key: commandId };
  await savePendingCommand(userId, { commandId, kind: 'anchor_upsert', expectedVersions: {}, payload,
    members: [{ domain: 'anchors', rowId: anchor.id, desired: row }], state: 'pending',
    dispatchState: session?.user?.id === userId ? 'dispatched' : 'not_dispatched' }, context);
  bumpMutationGeneration(userId, context);
  const cacheKey = await financeCacheKey(userId, 'anchors', context);
  const previousCache = await chunkedStore.getItem(cacheKey);
  await mergeRowsIntoCache(cacheKey, allAnchors.map(item => encodeReconciliationAnchorRow(item, userId, context?.householdId ?? null)), [row]);
  const pending = await readPending(userId, 'anchors', context);
  const previousPending = { ...pending };
  pending[anchor.id] = row;
  await writePending(userId, 'anchors', pending);
  if (!session || session.user?.id !== userId) {
    await updatePendingCommand(userId, commandId, { state: 'needs_review', dispatchState: 'not_dispatched', reviewReason: 'Offline anchor changes require manual review and are never replayed automatically.' }, context);
    return { data: anchor, syncStatus: 'cached_offline', outcome: 'pending' };
  }
  try {
    const { rpc_name: _rpcName, ...rpcArgs } = payload;
    const { data, error } = await supabaseClientProvider().rpc('debtfree_upsert_household_anchor_atomic', rpcArgs);
    if (error) {
      const rejected = ['42501', '23514', '23502', '23503', '23505', '22P02', '42883', 'PGRST202', 'P0001', 'P0002'].includes(error.code ?? '');
      if (rejected) {
        await rejectPendingCommand(userId, commandId, error.message, context);
        await writePending(userId, 'anchors', previousPending).catch(() => {});
        await restoreCache(cacheKey, previousCache).catch(() => {});
      } else await updatePendingCommand(userId, commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: error.message } }, context);
      return { data: anchor, syncStatus: 'cached_offline', outcome: rejected ? 'rejected' : 'pending', failureKind: rejected ? 'rejected' : 'uncertain', error: new Error(error.message) };
    }
    const receipt = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
    const returned = receipt?.row && typeof receipt.row === 'object' && !Array.isArray(receipt.row) ? receipt.row as SupabaseReconciliationAnchorRow : null;
    if (!isHouseholdReceipt(receipt, context) || !isHouseholdRow(returned, context, anchor.id)) {
      await updatePendingCommand(userId, commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: 'Household anchor receipt did not match this anchor and household.' } }, context);
      return { data: anchor, syncStatus: 'cached_offline', outcome: 'pending', failureKind: 'uncertain', error: new Error('Household anchor write could not be confirmed for this household.') };
    }
    const confirmedAnchor = decodeReconciliationAnchorRow(returned, anchor.verifiedBalance.currency);
    const deltaStamps = await recordCacheDelta(userId, context, { anchor: returned });
    await finishPendingCommand(userId, commandId, context);
    delete pending[anchor.id];
    await writePending(userId, 'anchors', pending).catch(() => {});
    enqueueFinanceCacheWrite(userId, context, async () => {
      await mergeRowsIntoCache(cacheKey, [], [returned], [], true);
      await clearCacheDeltaEntries(userId, context, deltaStamps);
    });
    return { data: confirmedAnchor, syncStatus: 'synced', outcome: 'confirmed', updatedAt: confirmedAnchor.createdAt };
  } catch (error) {
    await updatePendingCommand(userId, commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: error instanceof Error ? error.message : String(error) } }, context).catch(() => {});
    return { data: anchor, syncStatus: 'cached_offline', outcome: 'pending', failureKind: 'uncertain', error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export type ReconcileDebtAtomicResult = {
  syncStatus: FinanceSyncStatus;
  outcome: FinanceMutationOutcome;
  newBalance: number;
  newVersion?: number;
  failureKind?: 'rejected' | 'uncertain';
  isConflict?: boolean;
  error?: Error;
};

/** Atomically reconcile a debt: creates anchor, adjustment transaction (if drift != 0), and updates balance in one shot. */
async function reconcileDebtAtomicUnlocked(params: {
  session: Session | null;
  userId: string;
  householdContext?: HouseholdContext;
  accountId: string;
  verifiedBalance: number;
  asOfDate: DateOnly;
  reason: 'interest_adjustment' | 'balance_adjustment' | 'credit_adjustment';
  anchor: ReconciliationAnchor;
  adjustmentTx: LedgerTransaction | null;
  allTransactions: LedgerTransaction[];
  allAnchors: ReconciliationAnchor[];
  expectedVersion?: number;
}): Promise<ReconcileDebtAtomicResult> {
  const {
    session,
    userId,
    accountId,
    verifiedBalance,
    asOfDate,
    reason,
    anchor,
    adjustmentTx,
    allTransactions,
    allAnchors,
    expectedVersion,
  } = params;
  if (!session && isLocalAcceptanceFinanceOwner(userId)) {
    bumpMutationGeneration(userId);
    await clearLocalAcceptancePendingForRow(userId, 'anchors', anchor.id);
    if (adjustmentTx) await clearLocalAcceptancePendingForRow(userId, 'transactions', adjustmentTx.id);
    const txCacheKey = await financeCacheKey(userId, 'txs');
    const anchorCacheKey = await financeCacheKey(userId, 'anchors');
    await Promise.all([
      adjustmentTx
        ? mergeRowsIntoCache(txCacheKey, allTransactions.map(tx => encodeTransactionRow(tx, userId, null)), [encodeTransactionRow({ ...adjustmentTx, isPending: false }, userId, null)])
        : Promise.resolve(),
      mergeRowsIntoCache(anchorCacheKey, allAnchors.map(a => encodeReconciliationAnchorRow(a, userId, null)), [encodeReconciliationAnchorRow(anchor, userId, null)]),
    ]);
    return { syncStatus: 'synced', outcome: 'confirmed', newBalance: verifiedBalance };
  }
  const context = verifiedFinanceContext(userId, session, params.householdContext);
  if (context) await rememberFinanceContext(context);
  const commandId = newCommandId('reconciliation', anchor.id);
  const reconciliationPayload = { account_id: accountId, verified_balance: verifiedBalance, as_of_date: asOfDate, reason,
    anchor_id: anchor.id, adjustment_id: adjustmentTx ? adjustmentTx.id : null, expected_version: expectedVersion ?? null };
  const groupedMembers = [
    { domain: 'anchors', rowId: anchor.id, desired: encodeReconciliationAnchorRow(anchor, userId, context?.householdId ?? null) },
    ...(adjustmentTx ? [{ domain: 'transactions', rowId: adjustmentTx.id, desired: encodeTransactionRow(adjustmentTx, userId, context?.householdId ?? null) }] : []),
  ];
  await savePendingCommand(userId, { commandId, kind: 'reconciliation', expectedVersions: { account: expectedVersion ?? null },
    payload: { rpc_name: 'debtfree_reconcile_household_debt_atomic', p_household_id: context?.householdId,
      p_expected_membership_version: context?.membershipVersion, p_reconciliation: reconciliationPayload, p_idempotency_key: commandId },
    members: groupedMembers, state: 'pending', dispatchState: session?.user?.id === userId ? 'dispatched' : 'not_dispatched' }, context);
  bumpMutationGeneration(userId, context);

  // 1. Update local caches immediately
  const txCacheKey = await financeCacheKey(userId, 'txs', context);
  const anchorCacheKey = await financeCacheKey(userId, 'anchors', context);
  const prevTxCache = await chunkedStore.getItem(txCacheKey);
  const prevAnchorCache = await chunkedStore.getItem(anchorCacheKey);

  const pendingTxs = await readPending(userId, 'transactions', context);
  const prevPendingTxs = { ...pendingTxs };
  const pendingAnchors = await readPending(userId, 'anchors', context);
  const prevPendingAnchors = { ...pendingAnchors };

  if (adjustmentTx) {
    pendingTxs[adjustmentTx.id] = encodeTransactionRow(adjustmentTx, userId, context?.householdId ?? null);
  }
  pendingAnchors[anchor.id] = encodeReconciliationAnchorRow(anchor, userId, context?.householdId ?? null);

  await Promise.all([
    writePending(userId, 'txs', pendingTxs),
    writePending(userId, 'anchors', pendingAnchors),
    mergeRowsIntoCache(txCacheKey, allTransactions.map(tx => encodeTransactionRow(tx, userId, context?.householdId ?? null)), adjustmentTx ? [encodeTransactionRow(adjustmentTx, userId, context?.householdId ?? null)] : []),
    mergeRowsIntoCache(anchorCacheKey, allAnchors.map(a => encodeReconciliationAnchorRow(a, userId, context?.householdId ?? null)), [encodeReconciliationAnchorRow(anchor, userId, context?.householdId ?? null)]),
  ]);

  // 2. If authenticated, call atomic RPC
  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = supabaseClientProvider();
      const payload = {
        account_id: accountId,
        verified_balance: verifiedBalance,
        as_of_date: asOfDate,
        reason,
        anchor_id: anchor.id,
        adjustment_id: adjustmentTx ? adjustmentTx.id : null,
        expected_version: expectedVersion ?? null,
      };

      const { data, error: rpcError } = await supabase.rpc('debtfree_reconcile_household_debt_atomic', {
        p_household_id: context!.householdId,
        p_expected_membership_version: context!.membershipVersion,
        p_reconciliation: payload,
        p_idempotency_key: commandId,
      });

      if (!rpcError) {
        const receipt = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
        const anchorRow = receipt?.anchorRow;
        const transactionRow = receipt?.transactionRow;
        if (!isHouseholdReceipt(receipt, context) || !isHouseholdRow(anchorRow, context, anchor.id)
            || (adjustmentTx ? !isHouseholdRow(transactionRow, context, adjustmentTx.id) : transactionRow !== null)) {
          await updatePendingCommand(userId, commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: 'Reconciliation receipt rows did not match the selected household and operation.' } }, context);
          return {
            syncStatus: 'cached_offline',
            outcome: 'pending',
            newBalance: verifiedBalance,
            failureKind: 'uncertain',
            error: new Error('Reconciliation could not be confirmed for this household.')
          };
        }
        const confirmedAnchorRow = anchorRow as SupabaseReconciliationAnchorRow;
        const confirmedTxRow = adjustmentTx ? (transactionRow as SupabaseTransactionRow) : undefined;
        const deltaStamps = await recordCacheDelta(userId, context, {
          anchor: confirmedAnchorRow,
          ...(confirmedTxRow ? { transaction: confirmedTxRow } : {}),
        });
        await finishPendingCommand(userId, commandId, context);
        if (adjustmentTx) delete pendingTxs[adjustmentTx.id];
        delete pendingAnchors[anchor.id];
        await Promise.all([
          writePending(userId, 'txs', pendingTxs),
          writePending(userId, 'anchors', pendingAnchors),
        ]);
        enqueueFinanceCacheWrite(userId, context, async () => {
          await Promise.all([
            confirmedTxRow
              ? mergeRowsIntoCache(txCacheKey, [], [confirmedTxRow], [], true)
              : Promise.resolve(),
            mergeRowsIntoCache(anchorCacheKey, [], [confirmedAnchorRow], [], true),
          ]);
          await clearCacheDeltaEntries(userId, context, deltaStamps);
        });
        const rawBalance = receipt.new_balance;
        const newBalance = typeof rawBalance === 'number' ? rawBalance : Number(rawBalance) || verifiedBalance;
        const rawVersion = receipt.new_version;
        const newVersion = typeof rawVersion === 'number' ? rawVersion : typeof rawVersion === 'string' ? Number(rawVersion) : undefined;

        return {
          syncStatus: 'synced',
          outcome: 'confirmed',
          newBalance,
          newVersion: Number.isSafeInteger(newVersion) ? newVersion : undefined,
        };
      }

      const isConflict = rpcError.message.includes('CONCURRENCY_CONFLICT') || rpcError.message.includes('MISSING_REVISION') || rpcError.code === 'P0001' || rpcError.code === 'P0002';
      const isIdempotencyConflict = rpcError.message.includes('IDEMPOTENCY_CONFLICT');
      const rejected = isConflict || isIdempotencyConflict || ['42501', '23514', '23502', '23503', '23505', '22P02', '42883', 'PGRST202'].includes(rpcError.code ?? '');
      if (rejected) {
        await rejectPendingCommand(userId, commandId, rpcError.message, context);
        await Promise.all([
          writePending(userId, 'txs', prevPendingTxs),
          writePending(userId, 'anchors', prevPendingAnchors),
          restoreCache(txCacheKey, prevTxCache),
          restoreCache(anchorCacheKey, prevAnchorCache),
        ]);
      }
      const userMsg = isConflict
        ? 'Account revision conflict: This debt was updated concurrently by another session. Please refresh.'
        : (isIdempotencyConflict ? 'Reconciliation anchor conflict: Anchor ID reused with conflicting data.' : rpcError.message);
      return {
        syncStatus: 'cached_offline',
        outcome: rejected ? 'rejected' : 'pending',
        newBalance: verifiedBalance,
        failureKind: rejected ? 'rejected' : 'uncertain',
        isConflict,
        error: new Error(userMsg),
      };
    } catch (err) {
      return {
        syncStatus: 'cached_offline',
        outcome: 'pending',
        newBalance: verifiedBalance,
        failureKind: 'uncertain',
        error: err instanceof Error ? err : new Error(String(err))
      };
    }
  }

  return { syncStatus: 'cached_offline', outcome: 'pending', newBalance: verifiedBalance };
}

/** Persist prototype financial records directly to device SecureStore cache for a user. */
export async function seedPrototypeHouseholdToStorage(userId: string): Promise<{
  onboardingData: UserOnboardingData;
  recurringBills: RecurringBill[];
  transactions: LedgerTransaction[];
  reconciliationAnchors: ReconciliationAnchor[];
}> {
  const {
    PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA,
    PROTOTYPE_RECURRING_BILLS,
    PROTOTYPE_TRANSACTIONS,
    PROTOTYPE_RECONCILIATION_ANCHORS,
  } = await import('./finance/prototype-loader');

  const onboardingData: UserOnboardingData = {
    ...PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA,
    userId,
    updatedAt: new Date().toISOString(),
  };

  const encodedTxs = PROTOTYPE_TRANSACTIONS.map(tx => encodeTransactionRow(tx, userId));
  const encodedBills = PROTOTYPE_RECURRING_BILLS.map(bill => encodeRecurringBillRow(bill, userId));
  const encodedAnchors = PROTOTYPE_RECONCILIATION_ANCHORS.map(anchor => encodeReconciliationAnchorRow(anchor, userId));

  await Promise.all([
    chunkedStore.setItem(safeKey(userId, 'txs'), JSON.stringify(encodedTxs)),
    chunkedStore.setItem(safeKey(userId, 'bills'), JSON.stringify(encodedBills)),
    chunkedStore.setItem(safeKey(userId, 'anchors'), JSON.stringify(encodedAnchors)),
  ]);

  return {
    onboardingData,
    recurringBills: PROTOTYPE_RECURRING_BILLS,
    transactions: PROTOTYPE_TRANSACTIONS,
    reconciliationAnchors: PROTOTYPE_RECONCILIATION_ANCHORS,
  };
}

/**
 * Completely clear all locally cached finance records and pending offline write intents
 * for a specific user. Used during safe financial data reset.
 */
async function clearUserFinanceStorageUnlocked(userId: string): Promise<void> {
  invalidateAllCacheScopesForUser(userId);
  bumpAllMutationGenerationsForUser(userId);
  await flushUserFinanceCacheWrites(userId);
  await Promise.all([
    chunkedStore.removeItem(safeKey(userId, 'txs')).catch(() => {}),
    chunkedStore.removeItem(safeKey(userId, 'bills')).catch(() => {}),
    chunkedStore.removeItem(safeKey(userId, 'anchors')).catch(() => {}),
    chunkedStore.removeItem(safeKey(userId, 'cache-delta')).catch(() => {}),
    chunkedStore.removeItem(safeKey(userId, 'pending-txs')).catch(() => {}),
    chunkedStore.removeItem(safeKey(userId, 'pending-bills')).catch(() => {}),
    chunkedStore.removeItem(safeKey(userId, 'pending-anchors')).catch(() => {}),
    chunkedStore.removeItem(safeKey(userId, 'pending-journal')).catch(() => {}),
  ]);
  legacyMigrations.delete(userId);
}

async function indexedJournalVersions(userId: string, householdId: string): Promise<string[]> {
  const indexKey = householdStorageKey(userId, householdId, 'pending-journal-v2-index');
  const raw = await chunkedStore.getItem(indexKey);
  if (raw === null) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('A household pending-journal index is malformed; local finance evidence was preserved.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A household pending-journal index is malformed; local finance evidence was preserved.');
  const index = value as Record<string, unknown>;
  const versions = index.membershipVersions;
  if (index.version !== 1 || index.userId !== userId || index.householdId !== householdId || !Array.isArray(versions)
      || versions.some(version => typeof version !== 'string' || !/^[1-9][0-9]*$/.test(version))
      || new Set(versions).size !== versions.length) {
    throw new Error('A household pending-journal index is mismatched or malformed; local finance evidence was preserved.');
  }
  return versions as string[];
}

async function clearHouseholdFinanceStorageUnlocked(context: HouseholdContext): Promise<void> {
  const c = parseHouseholdContext(context.userId, context);
  invalidateCacheScope(c.userId, c);
  bumpMutationGeneration(c.userId, c);
  await flushFinanceCacheWrites(c.userId, c);
  const versions = await indexedJournalVersions(c.userId, c.householdId);
  const removals = [
    ...['txs', 'bills', 'anchors', 'cache-delta'].map(domain => chunkedStore.removeItem(contextCacheKey(c, domain))),
    ...versions.map(membershipVersion => chunkedStore.removeItem(pendingJournalV2Key({ ...c, membershipVersion }))),
    chunkedStore.removeItem(householdStorageKey(c.userId, c.householdId, 'pending-journal-v2-index')),
  ];
  const results = await Promise.allSettled(removals);
  if (results.some(result => result.status === 'rejected')) throw new Error('The server reset was confirmed, but this device could not confirm removal of all finance cache and journal data for this household.');
  legacyMigrations.delete(c.userId);
}

/** Strict cleanup used after confirmed account deletion. Unlike cache recovery, removal failures are surfaced. */
async function clearUserFinanceStorageForAccountDeletionUnlocked(userId: string): Promise<void> {
  invalidateAllCacheScopesForUser(userId);
  bumpAllMutationGenerationsForUser(userId);
  await flushUserFinanceCacheWrites(userId);
  const households = await indexedFinanceHouseholds(userId);
  const scopedKeys: string[] = [];
  for (const householdId of households) {
    scopedKeys.push(...['txs', 'bills', 'anchors', 'cache-delta'].map(domain => contextCacheKey({ userId, householdId, role: 'viewer', membershipVersion: '1' }, domain)));
    for (const version of await indexedJournalVersions(userId, householdId)) {
      scopedKeys.push(pendingJournalV2Key({ userId, householdId, role: 'viewer', membershipVersion: version }));
    }
    scopedKeys.push(householdStorageKey(userId, householdId, 'pending-journal-v2-index'));
  }
  const legacyKeys = ['txs', 'bills', 'anchors', 'cache-delta', 'pending-txs', 'pending-bills', 'pending-anchors', 'pending-journal'].map(domain => safeKey(userId, domain));
  const results = await Promise.allSettled([...new Set([...scopedKeys, ...legacyKeys, contextCacheIndexKey(userId)])].map(key => chunkedStore.removeItem(key)));
  if (results.some(result => result.status === 'rejected')) throw new Error('Account deletion was confirmed, but this device could not confirm removal of all finance cache and journal data.');
  legacyMigrations.delete(userId);
}


// Serialize all local finance state for a user, including readback and rollback.
const financeQueues = new Map<string, Promise<void>>();
async function withFinanceLock<T>(userId: string, work: () => Promise<T>, context?: HouseholdContext): Promise<T> {
  const lockKey = context ? `${keyPart(userId)}:${keyPart(context.householdId)}` : userId;
  const previous = financeQueues.get(lockKey) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  financeQueues.set(lockKey, tail);
  await previous.catch(() => {});
  try { return await work(); }
  finally { release(); if (financeQueues.get(lockKey) === tail) financeQueues.delete(lockKey); }
}

type ConfirmedAccountDeletionReceipt = {
  billId: string | null;
  deletedTransactions: number;
  deletedReconciliationAnchors: number;
};

/**
 * Serialize a confirmed debt-history deletion against local finance writes, then
 * purge only the account, exact paired bill and their linked local history.
 * The callback must validate the server receipt before it resolves.
 */
function commandTargetsOnlyDebt(command: HouseholdPendingCommand, debtId: string): boolean {
  if (command.members.length === 0) return false;
  return command.members.every(member => {
    const desired = member.desired && typeof member.desired === 'object' && !Array.isArray(member.desired)
      ? member.desired as Record<string, unknown>
      : null;
    if (member.domain === 'transactions' || member.domain === 'anchors') {
      return desired?.account_id === debtId;
    }
    if (member.domain === 'bills') {
      return desired?.credit_account_id === debtId;
    }
    return false;
  });
}

async function assertAccountDeletionReady(context: HouseholdContext, debtId: string): Promise<void> {
  const c = parseHouseholdContext(context.userId, context);
  const legacy = await preflightLegacyPendingJournal(chunkedStore, c.userId, {
    key: userId => safeKey(userId, 'pending-journal'),
  });
  if (legacy.commands.length > 0) {
    throw new Error('Finish syncing or recovering pending account-only finance changes before deleting this account.');
  }
  for (const domain of ['pending-txs', 'pending-bills', 'pending-anchors']) {
    const raw = await chunkedStore.getItem(safeKey(c.userId, domain));
    if (raw === null) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch {
      throw new Error('Review malformed legacy finance evidence before deleting this account.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length > 0) {
      throw new Error('Reconcile legacy finance evidence before deleting this account.');
    }
  }
  const household = await preflightHouseholdPendingJournalsV2(chunkedStore, c.userId, c.householdId, c.membershipVersion);
  const blocking = household.commands.some(command => {
    if (command.resolution || command.failure?.kind === 'rejected') return false;
    return !commandTargetsOnlyDebt(command, debtId);
  });
  if (blocking) {
    throw new Error('Finish syncing or recovering pending household changes before deleting this account.');
  }
}

export function deleteAccountHistoryWithCommit<T extends ConfirmedAccountDeletionReceipt>(params: {
  userId: string;
  householdContext?: HouseholdContext;
  debtId: string;
  commit: () => Promise<T>;
}): Promise<T> {
  const context = params.householdContext ? parseHouseholdContext(params.userId, params.householdContext) : undefined;
  if (!context && params.userId !== 'local-acceptance-owner-v1') {
    throw new Error('A current server-verified household context is required for account-history deletion.');
  }
  invalidateInFlightLoads(params.userId, context);
  return withFinanceLock(params.userId, async () => {
    await flushFinanceCacheWrites(params.userId, context);
    if (context) await assertAccountDeletionReady(context, params.debtId);
    else await migrateLegacyPending(params.userId);
    const receipt = await params.commit();
    invalidateCacheScope(params.userId, context);
    bumpMutationGeneration(params.userId, context);
    const billId = receipt.billId;

    const txKey = await financeCacheKey(params.userId, 'txs', context);
    let deletedTransactionIds = new Set<string>();
    let transactionCacheTrusted = true;
    const rawTransactions = await chunkedStore.getItem(txKey);
    if (rawTransactions !== null) {
      try {
        const parsed: unknown = JSON.parse(rawTransactions);
        if (!Array.isArray(parsed)) throw new TypeError('Cached transactions are malformed.');
        const remaining = parsed.filter((row: unknown) => {
          if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('Cached transaction row is malformed.');
          const value = row as { id?: unknown; account_id?: unknown; memo?: unknown };
          if (typeof value.id !== 'string') throw new TypeError('Cached transaction ID is malformed.');
          if (context && (row as Record<string, unknown>).household_id !== context.householdId) throw new TypeError('Cached transaction belongs to another household.');
          const remove = value.account_id === params.debtId || Boolean(billId && transactionHasBillId({
            id: value.id,
            memo: typeof value.memo === 'string' ? value.memo : null,
          }, billId));
          if (remove) deletedTransactionIds.add(value.id);
          return !remove;
        });
        if (remaining.length === parsed.length) {
          // Keep the exact cache bytes when this account had no local rows.
        } else if (remaining.length) {
          await chunkedStore.setItem(txKey, JSON.stringify(remaining));
        } else {
          await chunkedStore.removeItem(txKey);
        }
      } catch {
        // A malformed cache cannot be selectively trusted after a destructive
        // server receipt; drop this cache domain so authoritative reload can repopulate it.
        await chunkedStore.removeItem(txKey);
        deletedTransactionIds = new Set();
        transactionCacheTrusted = false;
      }
    }

    const billKey = await financeCacheKey(params.userId, 'bills', context);
    if (billId) {
      const rawBills = await chunkedStore.getItem(billKey);
      if (rawBills !== null) {
        try {
          const parsed: unknown = JSON.parse(rawBills);
          if (!Array.isArray(parsed)) throw new TypeError('Cached bills are malformed.');
          const remaining = parsed.filter((row: unknown) => {
            if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('Cached bill row is malformed.');
            if (context && (row as Record<string, unknown>).household_id !== context.householdId) throw new TypeError('Cached bill belongs to another household.');
            return (row as { id?: unknown }).id !== billId;
          });
          if (remaining.length !== parsed.length) {
            if (remaining.length) await chunkedStore.setItem(billKey, JSON.stringify(remaining));
            else await chunkedStore.removeItem(billKey);
          }
        } catch {
          await chunkedStore.removeItem(billKey);
        }
      }
    }

    const anchorKey = await financeCacheKey(params.userId, 'anchors', context);
    const rawAnchors = await chunkedStore.getItem(anchorKey);
    if (!transactionCacheTrusted || deletedTransactionIds.size !== receipt.deletedTransactions) {
      if (rawAnchors !== null) await chunkedStore.removeItem(anchorKey);
    } else if (rawAnchors !== null) {
      try {
        const parsed: unknown = JSON.parse(rawAnchors);
        if (!Array.isArray(parsed)) throw new TypeError('Cached anchors are malformed.');
        const remaining = parsed.filter((row: unknown) => {
          if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('Cached anchor row is malformed.');
          if (context && (row as Record<string, unknown>).household_id !== context.householdId) throw new TypeError('Cached anchor belongs to another household.');
          const value = row as { account_id?: unknown; created_adjustment_id?: unknown };
          return value.account_id !== params.debtId &&
            !(typeof value.created_adjustment_id === 'string' && deletedTransactionIds.has(value.created_adjustment_id));
        });
        if (remaining.length !== parsed.length) {
          if (remaining.length) await chunkedStore.setItem(anchorKey, JSON.stringify(remaining));
          else await chunkedStore.removeItem(anchorKey);
        }
      } catch {
        await chunkedStore.removeItem(anchorKey);
      }
    }

    const deltaKey = await cacheDeltaKey(params.userId, context);
    await withCacheDeltaLock(cacheScopeKey(params.userId, context), async () => {
      const rawDelta = await chunkedStore.getItem(deltaKey);
      if (rawDelta === null) return;
      const delta = parseFinanceCacheDelta(rawDelta, context);
      for (const [id, row] of Object.entries(delta.transactions)) {
        const remove = deletedTransactionIds.has(id) || row.account_id === params.debtId || Boolean(billId && transactionHasBillId({
          id,
          memo: typeof row.memo === 'string' ? row.memo : null,
        }, billId));
        if (remove) {
          delete delta.transactions[id];
          delete delta.stamps.transactions[id];
        }
      }
      if (billId) {
        delete delta.bills[billId];
        delete delta.stamps.bills[billId];
        delta.removedBillIds = delta.removedBillIds.filter(id => id !== billId);
        delete delta.stamps.removedBillIds[billId];
      }
      for (const [id, row] of Object.entries(delta.anchors)) {
        if (row.account_id === params.debtId || !transactionCacheTrusted || deletedTransactionIds.size !== receipt.deletedTransactions) {
          delete delta.anchors[id];
          delete delta.stamps.anchors[id];
        }
      }
      if (isCacheDeltaEmpty(delta)) await chunkedStore.removeItem(deltaKey);
      else await chunkedStore.setItem(deltaKey, JSON.stringify(delta));
    }).catch(() => {});

    const pendingToScan: Array<PendingCommand | HouseholdPendingCommand> = context
      ? (await preflightHouseholdPendingJournalsV2(chunkedStore, context.userId, context.householdId, context.membershipVersion)).commands
      : await listPendingCommands(params.userId);
    for (const command of pendingToScan) {
      const targetsDeletedIdentity = command.members.some(member => {
        const value = member.desired && typeof member.desired === 'object' && !Array.isArray(member.desired)
          ? member.desired as { account_id?: unknown; memo?: unknown; created_adjustment_id?: unknown }
          : null;
        if (member.domain === 'transactions') {
          return deletedTransactionIds.has(member.rowId) || value?.account_id === params.debtId || Boolean(billId && transactionHasBillId({
            id: member.rowId,
            memo: typeof value?.memo === 'string' ? value.memo : null,
          }, billId));
        }
        if (member.domain === 'anchors') {
          return value?.account_id === params.debtId ||
            (typeof value?.created_adjustment_id === 'string' && deletedTransactionIds.has(value.created_adjustment_id));
        }
        return member.domain === 'bills' && Boolean(billId) && member.rowId === billId;
      });
      if (targetsDeletedIdentity) {
        if (context) {
          await createPendingJournalV2(chunkedStore, {
            ...context,
            membershipVersion: (command as HouseholdPendingCommand).membershipVersion,
          }).remove(command.commandId);
        } else {
          await finishPendingCommand(params.userId, command.commandId);
        }
      }
    }

    return receipt;
  }, context);
}

export function loadFinanceRecords(params: Parameters<typeof loadFinanceRecordsThreePhase>[0]): ReturnType<typeof loadFinanceRecordsThreePhase> {
  const context = verifiedFinanceContext(params.userId, params.session, params.householdContext);
  const loadKey = `${cacheScopeKey(params.userId, context)}:${context?.membershipVersion ?? 'local'}:${params.currency}:${params.session?.user?.id ?? 'anon'}`;
  const existing = inFlightFinanceLoads.get(loadKey);
  if (existing) return existing;
  const run = loadFinanceRecordsThreePhase(params)
    .finally(() => {
      if (inFlightFinanceLoads.get(loadKey) === run) inFlightFinanceLoads.delete(loadKey);
    });
  inFlightFinanceLoads.set(loadKey, run);
  return run;
}

export function persistTransaction(params: Parameters<typeof persistTransactionUnlocked>[0]): ReturnType<typeof persistTransactionUnlocked> {
  invalidateInFlightLoads(params.userId, params.householdContext);
  return withFinanceLock(params.userId, () => persistTransactionUnlocked(params), params.householdContext);
}

export function updateTransaction(params: Parameters<typeof updateTransactionUnlocked>[0]): ReturnType<typeof updateTransactionUnlocked> {
  invalidateInFlightLoads(params.userId, params.householdContext);
  return withFinanceLock(params.userId, () => updateTransactionUnlocked(params), params.householdContext);
}

export function deleteTransaction(params: Parameters<typeof deleteTransactionUnlocked>[0]): ReturnType<typeof deleteTransactionUnlocked> {
  invalidateInFlightLoads(params.userId, params.householdContext);
  return withFinanceLock(params.userId, () => deleteTransactionUnlocked(params), params.householdContext);
}

export function persistRecurringBill(params: Parameters<typeof persistRecurringBillUnlocked>[0]): ReturnType<typeof persistRecurringBillUnlocked> {
  invalidateInFlightLoads(params.userId, params.householdContext);
  return withFinanceLock(params.userId, () => persistRecurringBillUnlocked(params), params.householdContext);
}

export function deleteRecurringBill(params: Parameters<typeof deleteRecurringBillUnlocked>[0]): ReturnType<typeof deleteRecurringBillUnlocked> {
  invalidateInFlightLoads(params.userId, params.householdContext);
  return withFinanceLock(params.userId, () => deleteRecurringBillUnlocked(params), params.householdContext);
}

export function persistReconciliationAnchor(params: Parameters<typeof persistReconciliationAnchorUnlocked>[0]): ReturnType<typeof persistReconciliationAnchorUnlocked> {
  invalidateInFlightLoads(params.userId, params.householdContext);
  return withFinanceLock(params.userId, () => persistReconciliationAnchorUnlocked(params), params.householdContext);
}

export function reconcileDebtAtomic(params: Parameters<typeof reconcileDebtAtomicUnlocked>[0]): ReturnType<typeof reconcileDebtAtomicUnlocked> {
  invalidateInFlightLoads(params.userId, params.householdContext);
  return withFinanceLock(params.userId, () => reconcileDebtAtomicUnlocked(params), params.householdContext);
}

export function clearUserFinanceStorage(userId: string): ReturnType<typeof clearUserFinanceStorageUnlocked> {
  invalidateAllCacheScopesForUser(userId);
  return withFinanceLock(userId, () => clearUserFinanceStorageUnlocked(userId));
}

export function clearHouseholdFinanceStorage(context: HouseholdContext): Promise<void> {
  const verified = parseHouseholdContext(context.userId, context);
  invalidateCacheScope(verified.userId, verified);
  return withFinanceLock(verified.userId, () => clearHouseholdFinanceStorageUnlocked(verified), verified);
}

export function clearUserFinanceStorageForAccountDeletion(userId: string): ReturnType<typeof clearUserFinanceStorageForAccountDeletionUnlocked> {
  invalidateAllCacheScopesForUser(userId);
  return withFinanceLock(userId, () => clearUserFinanceStorageForAccountDeletionUnlocked(userId));
}
