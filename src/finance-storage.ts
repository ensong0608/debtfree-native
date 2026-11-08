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
import { createPendingJournal, rowMatches, type PendingCommand, type PendingSummary, type ReadbackEvidence } from './finance/pending-journal.ts';
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

/** Seed only the reserved, explicitly enabled development fixture namespace. */
export async function seedLocalAcceptanceFinanceRecords(params: {
  userId: string;
  transactions: LedgerTransaction[];
  recurringBills: RecurringBill[];
  reconciliationAnchors: ReconciliationAnchor[];
}): Promise<void> {
  if (!__DEV__ || process.env.EXPO_PUBLIC_ENABLE_LOCAL_ACCEPTANCE !== 'true' || params.userId !== 'local-acceptance-owner-v1') {
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
  if (dependencies.storage) chunkedStore = dependencies.storage as typeof chunkedStore;
  if (dependencies.getClient) supabaseClientProvider = dependencies.getClient;
  pendingJournal = createPendingJournal(chunkedStore, { key: userId => safeKey(userId, 'pending-journal') });
  legacyMigrations.clear();
  return () => {
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
async function readPending(userId: string, domain: string): Promise<PendingRows> {
  await migrateLegacyPending(userId);
  const rows: PendingRows = {};
  for (const command of await pendingJournal.list(userId)) {
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
async function savePendingCommand(userId: string, command: Omit<PendingCommand, 'userId' | 'createdAt' | 'updatedAt'>): Promise<void> {
  const unresolved = (await pendingJournal.list(userId)).find(existing => !existing.resolution && existing.failure?.kind !== 'rejected' &&
    existing.members.some(a => command.members.some(b => a.domain === b.domain && a.rowId === b.rowId)));
  if (unresolved) throw new Error(`A previous ${unresolved.kind} operation for this record still needs recovery.`);
  const now = new Date().toISOString();
  await pendingJournal.save({ ...command, userId, createdAt: now, updatedAt: now });
}
function newCommandId(kind: string, identity: string): string {
  return `${kind}:${identity}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
async function finishPendingCommand(userId: string, commandId: string): Promise<void> { await pendingJournal.remove(userId, commandId); }
async function rejectPendingCommand(userId: string, commandId: string, message: string): Promise<void> { await pendingJournal.markRejected(userId, commandId, message); }
async function getPendingFinanceSummaryUnlocked(userId: string): Promise<PendingSummary> {
  await migrateLegacyPending(userId);
  return pendingJournal.summarize(userId);
}
export async function getPendingFinanceSummary(userId: string): Promise<PendingSummary> {
  return withFinanceLock(userId, () => getPendingFinanceSummaryUnlocked(userId));
}
export async function getPendingFinanceOperations(userId: string): Promise<PendingCommand[]> {
  return withFinanceLock(userId, async () => { await migrateLegacyPending(userId); return pendingJournal.list(userId); });
}

function isSafeVersion(value: unknown): value is number | string {
  return (typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && value.length > 0);
}

/** Storage-owned allowlist used by recovery UI and API; bills, anchors and grouped commands remain review-only. */
export function canRetryPendingFinanceOperation(command: PendingCommand): boolean {
  if (command.dispatchState !== 'not_dispatched' || command.failure?.kind === 'rejected' || command.resolution || command.members.length !== 1 || command.members[0].domain !== 'transactions') return false;
  const payload = command.payload as Record<string, any> | null;
  if (!payload || typeof payload !== 'object') return false;
  if (command.kind === 'transaction_create') return payload.p_tx?.id === command.members[0].rowId && payload.p_idempotency_key === command.members[0].rowId &&
    (payload.p_tx.account_id == null || isSafeVersion(payload.p_expected_version));
  if (command.kind === 'transaction_update') return payload.p_tx?.id === command.members[0].rowId && payload.p_idempotency_key === command.members[0].rowId &&
    isSafeVersion(payload.p_expected_tx_version) && isSafeVersion(payload.p_expected_version) && isSafeVersion(payload.p_expected_old_account_version);
  if (command.kind === 'transaction_delete') return payload.p_tx_id === command.members[0].rowId &&
    isSafeVersion(payload.p_expected_tx_version) && isSafeVersion(payload.p_expected_version);
  return false;
}

export type FinanceRecoveryResult = { summary: PendingSummary; operations: PendingCommand[]; retriedCommandId?: string; authoritativeRecords?: { transactions: unknown[]; recurringBills: unknown[]; reconciliationAnchors: unknown[] }; resolvedCommandId?: string };
async function readCompleteFinanceDomain(supabase: ReturnType<typeof supabaseClientProvider>, table: string, userId: string, order?: { column: string; ascending: boolean }): Promise<unknown[]> {
  const pageSize = 500;
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from(table).select('*').eq('user_id', userId);
    if (order) query = query.order(order.column, { ascending: order.ascending });
    const result = await query.range(offset, offset + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    const page = (result.data ?? []) as unknown[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function recoverPendingFinanceWrites(params: {
  userId: string;
  session: Session | null;
  action: 'readback' | 'retry' | 'accept_server_state';
  commandId?: string;
  acknowledgeServerState?: true;
}): Promise<FinanceRecoveryResult> {
  return withFinanceLock(params.userId, async () => {
    const { userId, session, action } = params;
    await migrateLegacyPending(userId);
    if (!session?.user || session.user.id !== userId) throw new Error('Finance recovery requires a matching authenticated user.');
    const supabase = supabaseClientProvider();
    let authoritativeRecords: FinanceRecoveryResult['authoritativeRecords'];
    let resolvedCommandId: string | undefined;
    if (action === 'readback' || action === 'accept_server_state') {
      const [txs, bills, anchors] = await Promise.all([
        readCompleteFinanceDomain(supabase, 'transactions', userId),
        readCompleteFinanceDomain(supabase, 'recurring_bills', userId),
        readCompleteFinanceDomain(supabase, 'reconciliation_anchors', userId),
      ]);
      const evidence = { byDomain: {
        transactions: { authoritative: true, complete: true, rows: (txs as SupabaseTransactionRow[]).map(row => ({ id: row.id, row })) },
        bills: { authoritative: true, complete: true, rows: (bills as SupabaseRecurringBillRow[]).map(row => ({ id: row.id, row })) },
        anchors: { authoritative: true, complete: true, rows: (anchors as SupabaseReconciliationAnchorRow[]).map(row => ({ id: row.id, row })) },
      } };
      authoritativeRecords = { transactions: txs, recurringBills: bills, reconciliationAnchors: anchors };
      if (action === 'readback') {
        for (const command of await pendingJournal.list(userId)) if (!command.resolution && command.kind !== 'migration_diagnostic') await pendingJournal.evaluateReadback(userId, command.commandId, evidence);
      } else {
        if (!params.commandId) throw new Error('A commandId is required to accept authoritative server state.');
        if (params.acknowledgeServerState !== true) throw new Error('Explicit acknowledgement is required to accept authoritative server state.');
        await pendingJournal.acceptServerState(userId, params.commandId, evidence, params.acknowledgeServerState);
        resolvedCommandId = params.commandId;
      }
    } else {
      if (!params.commandId) throw new Error('A commandId is required for explicit retry.');
      const command = await pendingJournal.get(userId, params.commandId);
      if (!command) throw new Error('Pending operation was not found.');
      if (!canRetryPendingFinanceOperation(command)) throw new Error('This command is review-only and cannot be retried safely.');
      await pendingJournal.update(userId, command.commandId, { dispatchState: 'dispatched', updatedAt: new Date().toISOString() });
      try {
        const payload = command.payload as Record<string, any>;
        let error: { message: string; code?: string } | null = null;
        if (command.kind === 'transaction_create' || command.kind === 'transaction_update') {
          const rpcName = command.kind === 'transaction_create' ? 'debtfree_record_transaction_atomic' : 'debtfree_update_transaction_atomic';
          const result = await supabase.rpc(rpcName, payload);
          error = result.error;
          if (!error && (!(result.data as { success?: unknown } | null)?.success)) error = { message: 'Atomic transaction retry was not confirmed.' };
        } else if (command.kind === 'transaction_delete') {
          const result = await supabase.rpc('debtfree_delete_transaction_atomic', payload);
          error = result.error;
          if (!error && (!(result.data as { success?: unknown } | null)?.success)) error = { message: 'Atomic transaction delete retry was not confirmed.' };
        } else {
          await pendingJournal.update(userId, command.commandId, { state: 'needs_review', dispatchState: 'not_dispatched', reviewReason: 'This command has no supported idempotent retry operation.' });
          throw new Error('This command has no supported idempotent retry operation.');
        }
        if (error) {
          const rejected = ['42501', '23514', '23502', '23503', '23505', '22P02', '42883', 'PGRST202', 'P0001', 'P0002'].includes(error.code ?? '');
          if (rejected) await pendingJournal.markRejected(userId, command.commandId, error.message);
          else await pendingJournal.update(userId, command.commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: error.message }, updatedAt: new Date().toISOString() });
          throw new Error(error.message);
        }
        await pendingJournal.remove(userId, command.commandId);
      } catch (error) {
        const latest = await pendingJournal.get(userId, command.commandId);
        if (latest?.dispatchState === 'dispatched' && latest.failure?.kind !== 'rejected') await pendingJournal.update(userId, command.commandId, { dispatchState: 'uncertain', failure: { kind: 'uncertain', message: error instanceof Error ? error.message : String(error) } });
        throw error;
      }
    }
    return { summary: await getPendingFinanceSummaryUnlocked(userId), operations: await pendingJournal.list(userId), retriedCommandId: action === 'retry' ? params.commandId : undefined, authoritativeRecords, resolvedCommandId };
  });
}
export async function getPendingTransactionIds(userId: string): Promise<Set<string>> {
  return withFinanceLock(userId, async () => {
    const pending = await readPending(userId, 'transactions');
    return new Set(Object.keys(pending));
  });
}
async function writePending(userId: string, domain: string, pending: PendingRows): Promise<void> {
  // New pending operations are committed atomically in the journal envelope.
  void userId; void domain; void pending;
}
async function restoreCache(key: string, raw: string | null): Promise<void> {
  if (raw === null) await chunkedStore.removeItem(key);
  else await chunkedStore.setItem(key, raw);
}
async function mergeRowsIntoCache<T extends { id: string }>(key: string, supplied: readonly T[], overrides: readonly T[] = [], removeIds: readonly string[] = []): Promise<T[]> {
  let cached: T[] = [];
  try { cached = JSON.parse(await chunkedStore.getItem(key) ?? '[]') as T[]; } catch { /* start from caller snapshot */ }
  const merged = rebaseFinanceCacheRows(cached, supplied, overrides, removeIds);
  await chunkedStore.setItem(key, JSON.stringify(merged)).catch(() => {});
  return merged;
}

/** Persist authoritative server timestamps after a confirmed mutation. */
async function cacheConfirmedTransaction(userId: string, transaction: LedgerTransaction): Promise<void> {
  try {
    const key = safeKey(userId, 'txs');
    const rows = JSON.parse(await chunkedStore.getItem(key) ?? '[]') as SupabaseTransactionRow[];
    const confirmed = encodeTransactionRow({ ...transaction, isPending: false }, userId);
    const index = rows.findIndex(row => row.id === transaction.id);
    if (index >= 0) rows[index] = confirmed;
    else rows.unshift(confirmed);
    await chunkedStore.setItem(key, JSON.stringify(rows));
  } catch { /* Cache failure cannot undo a confirmed server mutation. */ }
}

/** Load transactions, recurring bills, and reconciliation anchors from Supabase or local cache. */
async function loadFinanceRecordsUnlocked(params: {
  session: Session | null;
  userId: string;
  currency: string;
}): Promise<LoadedFinanceRecords> {
  const { session, userId, currency } = params;

  // 1. Try reading from local storage cache first as baseline
  let cachedTxs: LedgerTransaction[] = [];
  let cachedBills: RecurringBill[] = [];
  let cachedAnchors: ReconciliationAnchor[] = [];
  const [pendingTxs, pendingBills, pendingAnchors] = await Promise.all([
    readPending(userId, 'transactions'), readPending(userId, 'bills'), readPending(userId, 'anchors'),
  ]);
  const cachedPendingWriteCount = (await getPendingFinanceSummaryUnlocked(userId)).total;

  try {
    const rawTxs = await chunkedStore.getItem(safeKey(userId, 'txs'));
    if (rawTxs) {
      const parsed = JSON.parse(rawTxs) as SupabaseTransactionRow[];
      cachedTxs = mergeFinanceRowsWithPendingWrites(parsed, pendingTxs).map(r => ({
        ...decodeTransactionRow(r, currency),
        isPending: Object.prototype.hasOwnProperty.call(pendingTxs, r.id),
      }));
    }
  } catch {
    // Local cache read failed
  }

  try {
    const rawBills = await chunkedStore.getItem(safeKey(userId, 'bills'));
    if (rawBills) {
      const parsed = JSON.parse(rawBills) as SupabaseRecurringBillRow[];
      cachedBills = mergeFinanceRowsWithPendingWrites(parsed, pendingBills).map(r => decodeRecurringBillRow(r, currency));
    }
  } catch {
    // Local cache read failed
  }

  try {
    const rawAnchors = await chunkedStore.getItem(safeKey(userId, 'anchors'));
    if (rawAnchors) {
      const parsed = JSON.parse(rawAnchors) as SupabaseReconciliationAnchorRow[];
      cachedAnchors = mergeFinanceRowsWithPendingWrites(parsed, pendingAnchors).map(r => decodeReconciliationAnchorRow(r, currency));
    }
  } catch {
    // Local cache read failed
  }

  // If not logged in or in preview mode, return cached records with offline status
  if (!session) {
    return {
      transactions: cachedTxs,
      recurringBills: cachedBills,
      reconciliationAnchors: cachedAnchors,
      syncStatus: 'cached_offline',
      snapshotStatus: classifyFinanceSnapshot('cache', cachedPendingWriteCount > 0),
      pendingWriteCount: cachedPendingWriteCount,
    };
  }
  if (!session.user || session.user.id !== userId) {
    return {
      transactions: cachedTxs,
      recurringBills: cachedBills,
      reconciliationAnchors: cachedAnchors,
      syncStatus: 'cached_offline',
      snapshotStatus: classifyFinanceSnapshot('cache', cachedPendingWriteCount > 0),
      pendingWriteCount: cachedPendingWriteCount,
      error: new Error('Finance session does not match the requested user.'),
      failureKind: 'rejected',
    };
  }

  // 2. Fetch authoritative records from Supabase
  const supabase = supabaseClientProvider();

  try {
    const [txRows, billRows, anchorRows] = await Promise.all([
      readCompleteFinanceDomain(supabase, 'transactions', userId, { column: 'date', ascending: false }),
      readCompleteFinanceDomain(supabase, 'recurring_bills', userId, { column: 'due_day', ascending: true }),
      readCompleteFinanceDomain(supabase, 'reconciliation_anchors', userId, { column: 'as_of_date', ascending: false }),
    ]);

    // Evaluate each single-row command against complete readback. Grouped reconciliation
    // deliberately has no complete-command proof from row snapshots alone.
    const evidence = { byDomain: {
      transactions: { authoritative: true, complete: true, rows: (txRows as SupabaseTransactionRow[]).map(row => ({ id: row.id, row })) },
      bills: { authoritative: true, complete: true, rows: (billRows as SupabaseRecurringBillRow[]).map(row => ({ id: row.id, row })) },
      anchors: { authoritative: true, complete: true, rows: (anchorRows as SupabaseReconciliationAnchorRow[]).map(row => ({ id: row.id, row })) },
    } };
    for (const command of await pendingJournal.list(userId)) {
      try { await pendingJournal.evaluateReadback(userId, command.commandId, evidence); } catch { /* retain corrupt/unsupported operation for review */ }
    }
    const [currentPendingTxs, currentPendingBills, currentPendingAnchors] = await Promise.all([
      readPending(userId, 'transactions'), readPending(userId, 'bills'), readPending(userId, 'anchors'),
    ]);
    const remoteTxRows = mergeFinanceRowsWithPendingWrites(txRows as SupabaseTransactionRow[], currentPendingTxs);
    const remoteBillRows = mergeFinanceRowsWithPendingWrites(billRows as SupabaseRecurringBillRow[], currentPendingBills);
    const remoteAnchorRows = mergeFinanceRowsWithPendingWrites(anchorRows as SupabaseReconciliationAnchorRow[], currentPendingAnchors);
    const remoteTxs = remoteTxRows.map(r => ({ ...decodeTransactionRow(r, currency), isPending: Object.prototype.hasOwnProperty.call(currentPendingTxs, r.id) }));
    const remoteBills = remoteBillRows.map(r => decodeRecurringBillRow(r, currency));
    const remoteAnchors = remoteAnchorRows.map(r => decodeReconciliationAnchorRow(r, currency));
    // Keep durable unsynced local intents; authoritative remote rows only replace
    // records that have no outstanding local write.
    await chunkedStore.setItem(safeKey(userId, 'txs'), JSON.stringify(remoteTxRows)).catch(() => {});
    await chunkedStore.setItem(safeKey(userId, 'bills'), JSON.stringify(remoteBillRows)).catch(() => {});
    await chunkedStore.setItem(safeKey(userId, 'anchors'), JSON.stringify(remoteAnchorRows)).catch(() => {});

    const pendingWriteCount = (await getPendingFinanceSummaryUnlocked(userId)).total;
    const snapshotStatus = classifyFinanceSnapshot('authoritative', pendingWriteCount > 0);
    return {
      transactions: remoteTxs,
      recurringBills: remoteBills,
      reconciliationAnchors: remoteAnchors,
      syncStatus: pendingWriteCount > 0 ? 'cached_offline' : 'synced',
      snapshotStatus,
      pendingWriteCount,
    };
  } catch (err) {
    // If network/remote error, gracefully fall back to cached records
    return {
      transactions: cachedTxs,
      recurringBills: cachedBills,
      reconciliationAnchors: cachedAnchors,
      syncStatus: 'cached_offline',
      snapshotStatus: classifyFinanceSnapshot('cache', cachedPendingWriteCount > 0),
      pendingWriteCount: cachedPendingWriteCount,
      error: err instanceof Error ? err : new Error(String(err)),
      failureKind: 'uncertain',
    };
  }
}

/** Persist a ledger transaction to Supabase and local cache. */
async function persistTransactionUnlocked(params: {
  session: Session | null;
  userId: string;
  transaction: LedgerTransaction;
  allTransactions: LedgerTransaction[];
  expectedVersion?: number;
}): Promise<FinanceMutationResult<LedgerTransaction>> {
  const { session, userId, transaction, allTransactions, expectedVersion } = params;
  const commandId = newCommandId('transaction:create', transaction.id);
  const row = encodeTransactionRow(transaction, userId);
  await savePendingCommand(userId, { commandId, kind: 'transaction_create', expectedVersions: { account: expectedVersion ?? null },
    payload: { p_tx: row, p_idempotency_key: transaction.id, p_expected_version: expectedVersion ?? null },
    members: [{ domain: 'transactions', rowId: transaction.id, desired: row }], state: 'pending',
    dispatchState: session?.user?.id === userId ? 'dispatched' : 'not_dispatched' });

  // 1. Update local cache immediately
  const cacheKey = safeKey(userId, 'txs');
  const previousCache = await chunkedStore.getItem(cacheKey);
  await mergeRowsIntoCache(cacheKey, allTransactions.map(tx => encodeTransactionRow(tx, userId)), [encodeTransactionRow(transaction, userId)]);
  const pending = await readPending(userId, 'transactions');
  const previousPending = { ...pending };
  pending[transaction.id] = encodeTransactionRow(transaction, userId);
  await writePending(userId, 'txs', pending);

  // 2. If authenticated, upsert to Supabase
  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = supabaseClientProvider();
      const row = encodeTransactionRow(transaction, userId);

      // Debt-affecting records require the atomic RPC. A missing RPC may use a
      // plain insert only for cash-only entries that cannot mutate debt balance.
      try {
        const { data, error: rpcError } = await supabase.rpc('debtfree_record_transaction_atomic', {
          p_tx: row,
          p_idempotency_key: transaction.id,
          p_expected_version: expectedVersion ?? null,
        });
        if (!rpcError) {
          if (!data || typeof data !== 'object' || (data as { success?: unknown }).success !== true) {
            await rejectPendingCommand(userId, commandId, 'Atomic transaction write was not confirmed.');
            await writePending(userId, 'txs', previousPending);
            await restoreCache(cacheKey, previousCache);
            return {
              data: transaction,
              syncStatus: 'cached_offline',
              outcome: 'rejected',
              failureKind: 'rejected',
              error: new Error('Atomic transaction write was not confirmed.')
            };
          }
          delete pending[transaction.id];
          await finishPendingCommand(userId, commandId);
          await writePending(userId, 'txs', pending).catch(() => {});
          const rawBalance = (data as { new_balance?: unknown }).new_balance;
          const accountBalance = typeof rawBalance === 'number' ? rawBalance : typeof rawBalance === 'string' ? Number(rawBalance) : undefined;
          const rawVersion = (data as { new_version?: unknown }).new_version;
          const accountVersion = typeof rawVersion === 'number' ? rawVersion : typeof rawVersion === 'string' ? Number(rawVersion) : undefined;
          const rawUpdatedAt = (data as { updated_at?: unknown }).updated_at as string | undefined;

          const confirmedTx: LedgerTransaction = {
            ...transaction,
            updatedAt: rawUpdatedAt ?? transaction.updatedAt,
            isPending: false,
          };
          await cacheConfirmedTransaction(userId, confirmedTx);

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
          await rejectPendingCommand(userId, commandId, rpcError.message);
          await writePending(userId, 'txs', previousPending).catch(() => {});
          await restoreCache(cacheKey, previousCache).catch(() => {});
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

  const commandId = newCommandId('transaction:update', transaction.id);
  const row = encodeTransactionRow(transaction, userId);
  const payload = { p_tx: row, p_idempotency_key: transaction.id, p_expected_version: expectedVersion ?? null,
    p_expected_old_account_version: expectedOldAccountVersion ?? null, p_expected_tx_version: expectedTxVersion ?? null };
  await savePendingCommand(userId, { commandId, kind: 'transaction_update',
    expectedVersions: { account: expectedVersion ?? null, oldAccount: expectedOldAccountVersion ?? null, transaction: expectedTxVersion ?? null },
    payload, members: [{ domain: 'transactions', rowId: transaction.id, desired: row }], state: 'pending',
    dispatchState: session?.user?.id === userId ? 'dispatched' : 'not_dispatched' });

  // 1. Update local cache immediately
  const cacheKey = safeKey(userId, 'txs');
  const previousCache = await chunkedStore.getItem(cacheKey);
  await mergeRowsIntoCache(cacheKey, allTransactions.map(tx => encodeTransactionRow(tx, userId)), [encodeTransactionRow(transaction, userId)]);
  const pending = await readPending(userId, 'transactions');
  const previousPending = { ...pending };
  pending[transaction.id] = encodeTransactionRow(transaction, userId);
  await writePending(userId, 'txs', pending);

  // 2. If authenticated, update via atomic RPC
  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = supabaseClientProvider();
      const row = encodeTransactionRow(transaction, userId);

      const { data, error: rpcError } = await supabase.rpc('debtfree_update_transaction_atomic', {
        p_tx: row,
        p_idempotency_key: transaction.id,
        p_expected_version: expectedVersion ?? null,
        p_expected_old_account_version: expectedOldAccountVersion ?? null,
        p_expected_tx_version: expectedTxVersion ?? null,
      });

      if (!rpcError) {
        if (!data || typeof data !== 'object' || (data as { success?: unknown }).success !== true) {
          await rejectPendingCommand(userId, commandId, 'Atomic transaction update was not confirmed.');
          await writePending(userId, 'txs', previousPending);
          await restoreCache(cacheKey, previousCache);
          return {
            data: transaction,
            syncStatus: 'cached_offline',
            outcome: 'rejected',
            failureKind: 'rejected',
            error: new Error('Atomic transaction update was not confirmed.')
          };
        }
        delete pending[transaction.id];
        await finishPendingCommand(userId, commandId);
        await writePending(userId, 'txs', pending).catch(() => {});
        const rawBalance = (data as { new_balance?: unknown }).new_balance;
        const accountBalance = typeof rawBalance === 'number' ? rawBalance : typeof rawBalance === 'string' ? Number(rawBalance) : undefined;
        const rawVersion = (data as { new_version?: unknown }).new_version;
        const accountVersion = typeof rawVersion === 'number' ? rawVersion : typeof rawVersion === 'string' ? Number(rawVersion) : undefined;

        const rawOldBalance = (data as { old_balance?: unknown }).old_balance;
        const oldAccountBalance = typeof rawOldBalance === 'number' ? rawOldBalance : typeof rawOldBalance === 'string' ? Number(rawOldBalance) : undefined;
        const rawOldVersion = (data as { old_version?: unknown }).old_version;
        const oldAccountVersion = typeof rawOldVersion === 'number' ? rawOldVersion : typeof rawOldVersion === 'string' ? Number(rawOldVersion) : undefined;
        const oldAccountId = (data as { old_account_id?: unknown }).old_account_id as string | null | undefined;
        const rawUpdatedAt = (data as { updated_at?: unknown }).updated_at as string | undefined;

        const confirmedTx: LedgerTransaction = {
          ...transaction,
          updatedAt: rawUpdatedAt ?? transaction.updatedAt,
          isPending: false,
        };
        await cacheConfirmedTransaction(userId, confirmedTx);

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
          await rejectPendingCommand(userId, commandId, rpcError.message);
        await writePending(userId, 'txs', previousPending).catch(() => {});
        await restoreCache(cacheKey, previousCache).catch(() => {});
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
  transactionId: string;
  allTransactions: LedgerTransaction[];
  expectedVersion?: number;
  expectedTxVersion?: string;
}): Promise<FinanceMutationResult<string>> {
  const { session, userId, transactionId, allTransactions, expectedVersion, expectedTxVersion } = params;
  const commandId = newCommandId('transaction:delete', transactionId);
  const targetTx = allTransactions.find(t => t.id === transactionId);
  if (!targetTx) return { data: transactionId, syncStatus: 'cached_offline', outcome: 'rejected', failureKind: 'rejected', error: new Error('Transaction to delete was not found.') };
  const desiredDeletedRow = encodeTransactionRow(targetTx, userId);
  const deletePayload = { p_tx_id: transactionId, p_expected_version: expectedVersion ?? null, p_expected_tx_version: expectedTxVersion ?? null };
  await savePendingCommand(userId, { commandId, kind: 'transaction_delete',
    expectedVersions: { account: expectedVersion ?? null, transaction: expectedTxVersion ?? null }, payload: deletePayload,
    members: [{ domain: 'transactions', rowId: transactionId, desired: desiredDeletedRow }], state: 'pending',
    dispatchState: session?.user?.id === userId ? 'dispatched' : 'not_dispatched' });

  // 1. Update local cache
  const cacheKey = safeKey(userId, 'txs');
  const previousCache = await chunkedStore.getItem(cacheKey);
  await mergeRowsIntoCache(cacheKey, allTransactions.map(tx => encodeTransactionRow(tx, userId)), [desiredDeletedRow]);
  const pending = await readPending(userId, 'transactions');
  const previousPending = { ...pending };
  if (targetTx) {
    pending[transactionId] = encodeTransactionRow(targetTx, userId);
  }
  await writePending(userId, 'txs', pending);

  // 2. If authenticated, soft delete via atomic RPC
  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = supabaseClientProvider();
      const { data, error: rpcError } = await supabase.rpc('debtfree_delete_transaction_atomic', {
        p_tx_id: transactionId,
        p_expected_version: expectedVersion ?? null,
        p_expected_tx_version: expectedTxVersion ?? null,
      });

      if (!rpcError) {
        if (!data || typeof data !== 'object' || (data as { success?: unknown }).success !== true) {
          await rejectPendingCommand(userId, commandId, 'Atomic transaction deletion was not confirmed.');
          await writePending(userId, 'txs', previousPending);
          await restoreCache(cacheKey, previousCache);
          return {
            data: transactionId,
            syncStatus: 'cached_offline',
            outcome: 'rejected',
            failureKind: 'rejected',
            error: new Error('Atomic transaction deletion was not confirmed.')
          };
        }
        delete pending[transactionId];
        await finishPendingCommand(userId, commandId);
        await writePending(userId, 'txs', pending).catch(() => {});
        const rawBalance = (data as { new_balance?: unknown }).new_balance;
        const accountBalance = typeof rawBalance === 'number' ? rawBalance : typeof rawBalance === 'string' ? Number(rawBalance) : undefined;
        const rawVersion = (data as { new_version?: unknown }).new_version;
        const accountVersion = typeof rawVersion === 'number' ? rawVersion : typeof rawVersion === 'string' ? Number(rawVersion) : undefined;

        const rawUpdatedAt = (data as { updated_at?: unknown }).updated_at as string | undefined;
        if (targetTx) await cacheConfirmedTransaction(userId, {
          ...targetTx,
          deletedAt: targetTx.deletedAt ?? rawUpdatedAt ?? new Date().toISOString(),
          updatedAt: rawUpdatedAt ?? targetTx.updatedAt,
          isPending: false,
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
        await rejectPendingCommand(userId, commandId, rpcError.message);
        await writePending(userId, 'txs', previousPending).catch(() => {});
        await restoreCache(cacheKey, previousCache).catch(() => {});
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

/** Persist a recurring bill to Supabase and local cache. */
async function persistRecurringBillUnlocked(params: {
  session: Session | null;
  userId: string;
  bill: RecurringBill;
  currentBills: RecurringBill[];
}): Promise<FinanceMutationResult<RecurringBill>> {
  const { session, userId, bill, currentBills } = params;
  const commandId = newCommandId('bill:upsert', bill.id);
  const previousBill = currentBills.find(item => item.id === bill.id);
  const isExistingBill = Boolean(previousBill);
  const expectedRevision = previousBill?.updatedAt;
  const reviewRow = encodeRecurringBillRow(bill, userId);
  if (isExistingBill && (!expectedRevision || typeof expectedRevision !== 'string')) {
    await savePendingCommand(userId, { commandId, kind: 'bill_upsert', expectedVersions: {}, payload: { table: 'recurring_bills', operation: 'update', row: reviewRow },
      members: [{ domain: 'bills', rowId: bill.id, desired: reviewRow }], state: 'needs_review', dispatchState: 'not_dispatched',
      reviewReason: 'Bill update has no trustworthy server revision for compare-and-swap; no write was dispatched.' });
    throw new Error('This recurring bill update needs review because its server revision is unavailable.');
  }
  const now = Date.now();
  const expectedMillis = expectedRevision ? Date.parse(expectedRevision) : Number.NaN;
  const updatedAt = new Date(Number.isFinite(expectedMillis) ? Math.max(now, expectedMillis + 1) : now).toISOString();
  const row = encodeRecurringBillRow({ ...bill, updatedAt }, userId, null, updatedAt);
  const operation = isExistingBill ? 'update' : 'insert';
  const payload = isExistingBill
    ? { table: 'recurring_bills', operation, row, filters: { id: bill.id, user_id: userId, updated_at: expectedRevision } }
    : { table: 'recurring_bills', operation, row };
  await savePendingCommand(userId, { commandId, kind: 'bill_upsert', expectedVersions: isExistingBill ? { updated_at: expectedRevision! } : {}, payload,
    members: [{ domain: 'bills', rowId: bill.id, desired: row }], state: 'pending',
    dispatchState: session?.user?.id === userId ? 'dispatched' : 'not_dispatched' });

  // 1. Update local cache
  const cacheKey = safeKey(userId, 'bills');
  const previousCache = await chunkedStore.getItem(cacheKey);
  await mergeRowsIntoCache(cacheKey, currentBills.map(b => encodeRecurringBillRow(b, userId)), [row]);
  const pending = await readPending(userId, 'bills');
  const previousPending = { ...pending };
  pending[bill.id] = row;
  await writePending(userId, 'bills', pending);

  // 2. If authenticated, upsert to Supabase
  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = supabaseClientProvider();
      let result: { data?: unknown; error: { code?: string; message: string } | null };
      if (isExistingBill) {
        result = await supabase.from('recurring_bills').update(row).eq('id', bill.id).eq('user_id', userId).eq('updated_at', expectedRevision!).select('*');
      } else {
        result = await supabase.from('recurring_bills').insert(row).select('*');
      }
      let returned = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!result.error && !returned) {
        const readback = await supabase.from('recurring_bills').select('*').eq('id', bill.id).eq('user_id', userId);
        const rows = Array.isArray(readback.data) ? readback.data : readback.data ? [readback.data] : [];
        const match = rows.find((candidate: any) => candidate.updated_at === updatedAt && rowMatches(candidate, row));
        if (match) returned = match;
        else if (isExistingBill) result = { data: null, error: { code: 'CAS_CONFLICT', message: 'Recurring bill changed on the server. Refresh before saving.' } };
        else if (rows.some((candidate: any) => candidate.id === bill.id)) result = { data: null, error: { code: '23505', message: 'Recurring bill ID already exists on the server.' } };
        else throw new Error('Recurring bill write could not be confirmed by server readback.');
      }
      const error = result.error;
      if (error) {
        const rejected = ['42501', '23514', '23502', '23503', '23505', '22P02', 'CAS_CONFLICT'].includes(error.code ?? '');
        if (rejected) await rejectPendingCommand(userId, commandId, error.message);
        if (rejected) { await writePending(userId, 'bills', previousPending).catch(() => {}); await restoreCache(cacheKey, previousCache).catch(() => {}); }
        return {
          data: bill,
          syncStatus: 'cached_offline',
          outcome: rejected ? 'rejected' : 'pending',
          failureKind: rejected ? 'rejected' : 'uncertain',
          isConflict: error.code === 'CAS_CONFLICT',
          error: new Error(error.message)
        };
      }
      const confirmedBill = decodeRecurringBillRow(returned as SupabaseRecurringBillRow, bill.amount.currency);
      await finishPendingCommand(userId, commandId);
      delete pending[bill.id];
      await writePending(userId, 'bills', pending).catch(() => {});
      await mergeRowsIntoCache(cacheKey, [], [returned as SupabaseRecurringBillRow]);
      return { data: confirmedBill, syncStatus: 'synced', outcome: 'confirmed', updatedAt: confirmedBill.updatedAt };
    } catch (err) {
      try {
        const supabase = supabaseClientProvider();
        const readback = await supabase.from('recurring_bills').select('*').eq('id', bill.id).eq('user_id', userId);
        const rows = Array.isArray(readback.data) ? readback.data : readback.data ? [readback.data] : [];
        const committed = rows.find((candidate: any) => candidate.updated_at === updatedAt && rowMatches(candidate, row));
        if (committed) {
          await finishPendingCommand(userId, commandId);
          delete pending[bill.id];
          await writePending(userId, 'bills', pending).catch(() => {});
          await mergeRowsIntoCache(cacheKey, [], [committed as SupabaseRecurringBillRow]);
          const confirmedBill = decodeRecurringBillRow(committed as SupabaseRecurringBillRow, bill.amount.currency);
          return { data: confirmedBill, syncStatus: 'synced', outcome: 'confirmed', updatedAt: confirmedBill.updatedAt };
        }
      } catch { /* retain the uncertain command for manual authoritative review */ }
      await pendingJournal.update(userId, commandId, { state: 'needs_review', dispatchState: 'uncertain', failure: { kind: 'uncertain', message: err instanceof Error ? err.message : String(err) }, reviewReason: 'Server outcome is uncertain; manual authoritative readback is required. No automatic bill replay is supported.' }).catch(() => {});
      return {
        data: bill,
        syncStatus: 'cached_offline',
        outcome: 'pending',
        failureKind: 'uncertain',
        error: err instanceof Error ? err : new Error(String(err))
      };
    }
  }
  await pendingJournal.update(userId, commandId, { state: 'needs_review', dispatchState: 'not_dispatched', reviewReason: 'Offline bill changes require manual review and are never replayed automatically.' });
  return { data: bill, syncStatus: 'cached_offline', outcome: 'pending' };
}

/** Delete a recurring bill from Supabase and local cache. */
async function deleteRecurringBillUnlocked(params: {
  session: Session | null;
  userId: string;
  billId: string;
  currentBills: RecurringBill[];
}): Promise<FinanceMutationResult<string>> {
  const { session, userId, billId, currentBills } = params;
  const commandId = newCommandId('bill:delete', billId);
  const previousBill = currentBills.find(item => item.id === billId);
  if (!previousBill) return { data: billId, syncStatus: 'cached_offline', outcome: 'rejected', failureKind: 'rejected', error: new Error('Recurring bill to delete was not found.') };
  const expectedRevision = previousBill.updatedAt;
  const payload = { table: 'recurring_bills', operation: 'delete', filters: { id: billId, user_id: userId, updated_at: expectedRevision ?? null } };
  if (!expectedRevision) {
    await savePendingCommand(userId, { commandId, kind: 'bill_delete', expectedVersions: {}, payload,
      members: [{ domain: 'bills', rowId: billId, desired: null }], state: 'needs_review', dispatchState: 'not_dispatched',
      reviewReason: 'Bill deletion has no trustworthy server revision for compare-and-swap; no write was dispatched.' });
    throw new Error('This recurring bill deletion needs review because its server revision is unavailable.');
  }
  await savePendingCommand(userId, { commandId, kind: 'bill_delete', expectedVersions: { updated_at: expectedRevision }, payload,
    members: [{ domain: 'bills', rowId: billId, desired: null }], state: 'pending', dispatchState: session?.user?.id === userId ? 'dispatched' : 'not_dispatched' });
  const cacheKey = safeKey(userId, 'bills');
  const previousCache = await chunkedStore.getItem(cacheKey);
  const priorRows = currentBills.map(item => encodeRecurringBillRow(item, userId));
  await mergeRowsIntoCache(cacheKey, priorRows, [], [billId]);
  if (!session || session.user?.id !== userId) {
    await pendingJournal.update(userId, commandId, { state: 'needs_review', dispatchState: 'not_dispatched', reviewReason: 'Offline bill changes require manual review and are never replayed automatically.' });
    return { data: billId, syncStatus: 'cached_offline', outcome: 'pending' };
  }
  try {
    const supabase = supabaseClientProvider();
    const result = await supabase.from('recurring_bills').delete().eq('id', billId).eq('user_id', userId).eq('updated_at', expectedRevision).select('*');
    const deletedRows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
    if (result.error) throw new Error(result.error.message);
    if (deletedRows.length === 0) {
      const readback = await supabase.from('recurring_bills').select('*').eq('id', billId).eq('user_id', userId);
      if (readback.error) throw new Error(readback.error.message);
      if (!Array.isArray(readback.data)) throw new Error('Recurring bill deletion readback was incomplete.');
      const rows = Array.isArray(readback.data) ? readback.data : readback.data ? [readback.data] : [];
      if (rows.length > 0) {
        await rejectPendingCommand(userId, commandId, 'Recurring bill changed on the server. Refresh before deleting.');
        await restoreCache(cacheKey, previousCache);
        return { data: billId, syncStatus: 'cached_offline', outcome: 'rejected', failureKind: 'rejected', isConflict: true, error: new Error('Recurring bill changed on the server. Refresh before deleting.') };
      }
    }
    await finishPendingCommand(userId, commandId);
    return { data: billId, syncStatus: 'synced', outcome: 'confirmed', updatedAt: new Date().toISOString() };
  } catch (error) {
    try {
      const supabase = supabaseClientProvider();
      const readback = await supabase.from('recurring_bills').select('*').eq('id', billId).eq('user_id', userId);
      if (readback.error) throw new Error(readback.error.message);
      if (!Array.isArray(readback.data)) throw new Error('Recurring bill deletion readback was incomplete.');
      const rows = Array.isArray(readback.data) ? readback.data : readback.data ? [readback.data] : [];
      if (rows.length === 0) {
        await finishPendingCommand(userId, commandId);
        return { data: billId, syncStatus: 'synced', outcome: 'confirmed', updatedAt: new Date().toISOString() };
      }
    } catch { /* retain the uncertain command for manual authoritative review */ }
    await pendingJournal.update(userId, commandId, { state: 'needs_review', dispatchState: 'uncertain', failure: { kind: 'uncertain', message: error instanceof Error ? error.message : String(error) }, reviewReason: 'Server outcome is uncertain; manual authoritative readback is required. No automatic bill replay is supported.' });
    return { data: billId, syncStatus: 'cached_offline', outcome: 'pending', failureKind: 'uncertain', error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** Persist a reconciliation anchor to Supabase and local cache. */
async function persistReconciliationAnchorUnlocked(params: {
  session: Session | null;
  userId: string;
  anchor: ReconciliationAnchor;
  allAnchors: ReconciliationAnchor[];
}): Promise<FinanceMutationResult<ReconciliationAnchor>> {
  const { session, userId, anchor, allAnchors } = params;
  const commandId = newCommandId('anchor:upsert', anchor.id);
  const row = encodeReconciliationAnchorRow(anchor, userId);
  await savePendingCommand(userId, { commandId, kind: 'anchor_upsert', expectedVersions: {}, payload: { table: 'reconciliation_anchors', operation: 'upsert', row, onConflict: 'id' },
    members: [{ domain: 'anchors', rowId: anchor.id, desired: row }], state: 'pending',
    dispatchState: session?.user?.id === userId ? 'dispatched' : 'not_dispatched' });

  // 1. Update local cache
  const cacheKey = safeKey(userId, 'anchors');
  const previousCache = await chunkedStore.getItem(cacheKey);
  await mergeRowsIntoCache(cacheKey, allAnchors.map(a => encodeReconciliationAnchorRow(a, userId)), [row]);
  const pending = await readPending(userId, 'anchors');
  const previousPending = { ...pending };
  pending[anchor.id] = encodeReconciliationAnchorRow(anchor, userId);
  await writePending(userId, 'anchors', pending);

  // 2. If authenticated, upsert to Supabase
  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = supabaseClientProvider();
      const row = encodeReconciliationAnchorRow(anchor, userId);
      const { error } = await supabase.from('reconciliation_anchors').upsert(row, { onConflict: 'id' });
      if (error) {
        const rejected = ['42501', '23514', '23502', '23503', '22P02'].includes(error.code ?? '');
        if (rejected) await rejectPendingCommand(userId, commandId, error.message);
        if (rejected) { await writePending(userId, 'anchors', previousPending).catch(() => {}); await restoreCache(cacheKey, previousCache).catch(() => {}); }
        return {
          data: anchor,
          syncStatus: 'cached_offline',
          outcome: rejected ? 'rejected' : 'pending',
          failureKind: rejected ? 'rejected' : 'uncertain',
          error: new Error(error.message)
        };
      }
      await finishPendingCommand(userId, commandId);
      delete pending[anchor.id];
      await writePending(userId, 'anchors', pending).catch(() => {});
      return { data: anchor, syncStatus: 'synced', outcome: 'confirmed' };
    } catch (err) {
      return {
        data: anchor,
        syncStatus: 'cached_offline',
        outcome: 'pending',
        failureKind: 'uncertain',
        error: err instanceof Error ? err : new Error(String(err))
      };
    }
  }

  return { data: anchor, syncStatus: 'cached_offline', outcome: 'pending' };
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

  const commandId = newCommandId('reconciliation', anchor.id);
  const reconciliationPayload = { account_id: accountId, verified_balance: verifiedBalance, as_of_date: asOfDate, reason,
    anchor_id: anchor.id, adjustment_id: adjustmentTx ? adjustmentTx.id : null, expected_version: expectedVersion ?? null };
  const groupedMembers = [
    { domain: 'anchors', rowId: anchor.id, desired: encodeReconciliationAnchorRow(anchor, userId) },
    ...(adjustmentTx ? [{ domain: 'transactions', rowId: adjustmentTx.id, desired: encodeTransactionRow(adjustmentTx, userId) }] : []),
  ];
  await savePendingCommand(userId, { commandId, kind: 'reconciliation', expectedVersions: { account: expectedVersion ?? null },
    payload: { rpc: 'debtfree_reconcile_debt_atomic', args: { p_reconciliation: reconciliationPayload } },
    members: groupedMembers, state: 'pending', dispatchState: session?.user?.id === userId ? 'dispatched' : 'not_dispatched' });

  // 1. Update local caches immediately
  const txCacheKey = safeKey(userId, 'txs');
  const anchorCacheKey = safeKey(userId, 'anchors');
  const prevTxCache = await chunkedStore.getItem(txCacheKey);
  const prevAnchorCache = await chunkedStore.getItem(anchorCacheKey);

  const pendingTxs = await readPending(userId, 'transactions');
  const prevPendingTxs = { ...pendingTxs };
  const pendingAnchors = await readPending(userId, 'anchors');
  const prevPendingAnchors = { ...pendingAnchors };

  if (adjustmentTx) {
    pendingTxs[adjustmentTx.id] = encodeTransactionRow(adjustmentTx, userId);
  }
  pendingAnchors[anchor.id] = encodeReconciliationAnchorRow(anchor, userId);

  await Promise.all([
    writePending(userId, 'txs', pendingTxs),
    writePending(userId, 'anchors', pendingAnchors),
    mergeRowsIntoCache(txCacheKey, allTransactions.map(tx => encodeTransactionRow(tx, userId)), adjustmentTx ? [encodeTransactionRow(adjustmentTx, userId)] : []),
    mergeRowsIntoCache(anchorCacheKey, allAnchors.map(a => encodeReconciliationAnchorRow(a, userId)), [encodeReconciliationAnchorRow(anchor, userId)]),
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

      const { data, error: rpcError } = await supabase.rpc('debtfree_reconcile_debt_atomic', {
        p_reconciliation: payload,
      });

      if (!rpcError) {
        if (!data || typeof data !== 'object' || (data as { success?: unknown }).success !== true) {
          await rejectPendingCommand(userId, commandId, 'Atomic reconciliation was not confirmed.');
          await Promise.all([
            writePending(userId, 'txs', prevPendingTxs),
            writePending(userId, 'anchors', prevPendingAnchors),
            restoreCache(txCacheKey, prevTxCache),
            restoreCache(anchorCacheKey, prevAnchorCache),
          ]);
          return {
            syncStatus: 'cached_offline',
            outcome: 'rejected',
            newBalance: verifiedBalance,
            failureKind: 'rejected',
            error: new Error('Atomic reconciliation was not confirmed.')
          };
        }
        if (adjustmentTx) {
          delete pendingTxs[adjustmentTx.id];
          await cacheConfirmedTransaction(userId, { ...adjustmentTx, isPending: false });
        }
        await finishPendingCommand(userId, commandId);
        delete pendingAnchors[anchor.id];
        await Promise.all([
          writePending(userId, 'txs', pendingTxs),
          writePending(userId, 'anchors', pendingAnchors),
        ]);
        const rawBalance = (data as { new_balance?: unknown }).new_balance;
        const newBalance = typeof rawBalance === 'number' ? rawBalance : Number(rawBalance) || verifiedBalance;
        const rawVersion = (data as { new_version?: unknown }).new_version;
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
        await rejectPendingCommand(userId, commandId, rpcError.message);
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
  await Promise.all([
    chunkedStore.removeItem(safeKey(userId, 'txs')).catch(() => {}),
    chunkedStore.removeItem(safeKey(userId, 'bills')).catch(() => {}),
    chunkedStore.removeItem(safeKey(userId, 'anchors')).catch(() => {}),
    chunkedStore.removeItem(safeKey(userId, 'pending-txs')).catch(() => {}),
    chunkedStore.removeItem(safeKey(userId, 'pending-bills')).catch(() => {}),
    chunkedStore.removeItem(safeKey(userId, 'pending-anchors')).catch(() => {}),
    chunkedStore.removeItem(safeKey(userId, 'pending-journal')).catch(() => {}),
  ]);
  legacyMigrations.delete(userId);
}


// Serialize all local finance state for a user, including readback and rollback.
const financeQueues = new Map<string, Promise<void>>();
async function withFinanceLock<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const previous = financeQueues.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  financeQueues.set(userId, tail);
  await previous.catch(() => {});
  try { return await work(); }
  finally { release(); if (financeQueues.get(userId) === tail) financeQueues.delete(userId); }
}

export function loadFinanceRecords(params: Parameters<typeof loadFinanceRecordsUnlocked>[0]): ReturnType<typeof loadFinanceRecordsUnlocked> {
  return withFinanceLock(params.userId, () => loadFinanceRecordsUnlocked(params));
}

export function persistTransaction(params: Parameters<typeof persistTransactionUnlocked>[0]): ReturnType<typeof persistTransactionUnlocked> {
  return withFinanceLock(params.userId, () => persistTransactionUnlocked(params));
}

export function updateTransaction(params: Parameters<typeof updateTransactionUnlocked>[0]): ReturnType<typeof updateTransactionUnlocked> {
  return withFinanceLock(params.userId, () => updateTransactionUnlocked(params));
}

export function deleteTransaction(params: Parameters<typeof deleteTransactionUnlocked>[0]): ReturnType<typeof deleteTransactionUnlocked> {
  return withFinanceLock(params.userId, () => deleteTransactionUnlocked(params));
}

export function persistRecurringBill(params: Parameters<typeof persistRecurringBillUnlocked>[0]): ReturnType<typeof persistRecurringBillUnlocked> {
  return withFinanceLock(params.userId, () => persistRecurringBillUnlocked(params));
}

export function deleteRecurringBill(params: Parameters<typeof deleteRecurringBillUnlocked>[0]): ReturnType<typeof deleteRecurringBillUnlocked> {
  return withFinanceLock(params.userId, () => deleteRecurringBillUnlocked(params));
}

export function persistReconciliationAnchor(params: Parameters<typeof persistReconciliationAnchorUnlocked>[0]): ReturnType<typeof persistReconciliationAnchorUnlocked> {
  return withFinanceLock(params.userId, () => persistReconciliationAnchorUnlocked(params));
}

export function reconcileDebtAtomic(params: Parameters<typeof reconcileDebtAtomicUnlocked>[0]): ReturnType<typeof reconcileDebtAtomicUnlocked> {
  return withFinanceLock(params.userId, () => reconcileDebtAtomicUnlocked(params));
}

export function clearUserFinanceStorage(userId: string): ReturnType<typeof clearUserFinanceStorageUnlocked> {
  return withFinanceLock(userId, () => clearUserFinanceStorageUnlocked(userId));
}
