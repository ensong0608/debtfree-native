import type { Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { getSupabaseClient } from './auth';
import { createChunkedStorage, type KeyValueStore } from './secure-chunks';
import {
  type LedgerTransaction,
  type ReconciliationAnchor,
} from './finance/ledger';
import {
  type RecurringBill,
} from './finance/recurring-bills';
import { type DateOnly } from './finance/calendar';
import {
  encodeTransactionRow,
  decodeTransactionRow,
  encodeRecurringBillRow,
  decodeRecurringBillRow,
  encodeReconciliationAnchorRow,
  decodeReconciliationAnchorRow,
  mergeFinanceRowsWithPendingWrites,
  reconcilePendingTransactionRows,
  type SupabaseTransactionRow,
  type SupabaseRecurringBillRow,
  type SupabaseReconciliationAnchorRow,
} from './finance/storage-domain';

const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const secureStoreAdapter: KeyValueStore = {
  getItem: key => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, secureOptions),
  removeItem: key => SecureStore.deleteItemAsync(key),
};

const chunkedStore = createChunkedStorage(secureStoreAdapter, () => Crypto.randomUUID());

function safeKey(userId: string, domain: string): string {
  const safeId = userId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `debtfree-${domain}-v1.${safeId}`;
}

/** Offline writes are cache-only and are not automatically replayed. */
export type FinanceSyncStatus = 'synced' | 'cached_offline';

export type LoadedFinanceRecords = {
  transactions: LedgerTransaction[];
  recurringBills: RecurringBill[];
  reconciliationAnchors: ReconciliationAnchor[];
  syncStatus: FinanceSyncStatus;
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
  try { return JSON.parse(await chunkedStore.getItem(safeKey(userId, `pending-${domain}`)) ?? '{}') as PendingRows; }
  catch { return {}; }
}
export async function getPendingTransactionIds(userId: string): Promise<Set<string>> {
  const pending = await readPending(userId, 'txs');
  return new Set(Object.keys(pending));
}
async function writePending(userId: string, domain: string, pending: PendingRows): Promise<void> {
  await chunkedStore.setItem(safeKey(userId, `pending-${domain}`), JSON.stringify(pending));
}
async function restoreCache(key: string, raw: string | null): Promise<void> {
  if (raw === null) await chunkedStore.removeItem(key);
  else await chunkedStore.setItem(key, raw);
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
export async function loadFinanceRecords(params: {
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
    readPending(userId, 'txs'), readPending(userId, 'bills'), readPending(userId, 'anchors'),
  ]);

  try {
    const rawTxs = await chunkedStore.getItem(safeKey(userId, 'txs'));
    if (rawTxs) {
      const parsed = JSON.parse(rawTxs) as SupabaseTransactionRow[];
      cachedTxs = parsed.map(r => ({ ...decodeTransactionRow(r, currency), isPending: Boolean(pendingTxs[r.id]) }));
    }
  } catch {
    // Local cache read failed
  }

  try {
    const rawBills = await chunkedStore.getItem(safeKey(userId, 'bills'));
    if (rawBills) {
      const parsed = JSON.parse(rawBills) as SupabaseRecurringBillRow[];
      cachedBills = parsed.map(r => decodeRecurringBillRow(r, currency));
    }
  } catch {
    // Local cache read failed
  }

  try {
    const rawAnchors = await chunkedStore.getItem(safeKey(userId, 'anchors'));
    if (rawAnchors) {
      const parsed = JSON.parse(rawAnchors) as SupabaseReconciliationAnchorRow[];
      cachedAnchors = parsed.map(r => decodeReconciliationAnchorRow(r, currency));
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
    };
  }
  if (!session.user || session.user.id !== userId) {
    return {
      transactions: cachedTxs,
      recurringBills: cachedBills,
      reconciliationAnchors: cachedAnchors,
      syncStatus: 'cached_offline',
      error: new Error('Finance session does not match the requested user.'),
      failureKind: 'rejected',
    };
  }

  // 2. Fetch authoritative records from Supabase
  const supabase = getSupabaseClient();

  try {
    const [txsRes, billsRes, anchorsRes] = await Promise.all([
      supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('date', { ascending: false }),
      supabase
        .from('recurring_bills')
        .select('*')
        .eq('user_id', userId)
        .order('due_day', { ascending: true }),
      supabase
        .from('reconciliation_anchors')
        .select('*')
        .eq('user_id', userId)
        .order('as_of_date', { ascending: false }),
    ]);

    // If any remote query had an error, gracefully fall back to cached records with cached_offline
    if (txsRes.error || billsRes.error || anchorsRes.error) {
      const queryError = txsRes.error ?? billsRes.error ?? anchorsRes.error;
      return {
        transactions: cachedTxs,
        recurringBills: cachedBills,
        reconciliationAnchors: cachedAnchors,
        syncStatus: 'cached_offline',
        error: new Error(queryError?.message ?? 'Finance records could not be loaded.'),
        failureKind: ['42501'].includes(queryError?.code ?? '') ? 'rejected' : 'uncertain',
      };
    }

    // Authoritative data received: overwrite local cache even when empty array
    const resolved = reconcilePendingTransactionRows(txsRes.data as SupabaseTransactionRow[], pendingTxs);
    const remoteTxRows = resolved.rows;
    if (resolved.confirmedIds.length) {
      // A lost RPC response may already have committed. Readback clears the
      // provisional flag without repeating the financial mutation.
      await writePending(userId, 'txs', resolved.unresolved);
    }
    const remoteBillRows = mergeFinanceRowsWithPendingWrites(billsRes.data as SupabaseRecurringBillRow[], pendingBills);
    const remoteAnchorRows = mergeFinanceRowsWithPendingWrites(anchorsRes.data as SupabaseReconciliationAnchorRow[], pendingAnchors);
    const remoteTxs = remoteTxRows.map(r => ({ ...decodeTransactionRow(r, currency), isPending: Object.prototype.hasOwnProperty.call(resolved.unresolved, r.id) }));
    const remoteBills = remoteBillRows.map(r => decodeRecurringBillRow(r, currency));
    const remoteAnchors = remoteAnchorRows.map(r => decodeReconciliationAnchorRow(r, currency));
    // Keep durable unsynced local intents; authoritative remote rows only replace
    // records that have no outstanding local write.
    await chunkedStore.setItem(safeKey(userId, 'txs'), JSON.stringify(remoteTxRows)).catch(() => {});
    await chunkedStore.setItem(safeKey(userId, 'bills'), JSON.stringify(remoteBillRows)).catch(() => {});
    await chunkedStore.setItem(safeKey(userId, 'anchors'), JSON.stringify(remoteAnchorRows)).catch(() => {});

    return {
      transactions: remoteTxs,
      recurringBills: remoteBills,
      reconciliationAnchors: remoteAnchors,
      syncStatus: Object.keys(resolved.unresolved).length || Object.keys(pendingBills).length || Object.keys(pendingAnchors).length ? 'cached_offline' : 'synced',
    };
  } catch (err) {
    // If network/remote error, gracefully fall back to cached records
    return {
      transactions: cachedTxs,
      recurringBills: cachedBills,
      reconciliationAnchors: cachedAnchors,
      syncStatus: 'cached_offline',
      error: err instanceof Error ? err : new Error(String(err)),
      failureKind: 'uncertain',
    };
  }
}

/** Persist a ledger transaction to Supabase and local cache. */
export async function persistTransaction(params: {
  session: Session | null;
  userId: string;
  transaction: LedgerTransaction;
  allTransactions: LedgerTransaction[];
  expectedVersion?: number;
}): Promise<FinanceMutationResult<LedgerTransaction>> {
  const { session, userId, transaction, allTransactions, expectedVersion } = params;

  // 1. Update local cache immediately
  const cacheKey = safeKey(userId, 'txs');
  const previousCache = await chunkedStore.getItem(cacheKey);
  const encodedAll = allTransactions.map(tx => encodeTransactionRow(tx, userId));
  const pending = await readPending(userId, 'txs');
  const previousPending = { ...pending };
  pending[transaction.id] = encodeTransactionRow(transaction, userId);
  await writePending(userId, 'txs', pending);
  await chunkedStore.setItem(cacheKey, JSON.stringify(encodedAll)).catch(() => {});

  // 2. If authenticated, upsert to Supabase
  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = getSupabaseClient();
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
export async function updateTransaction(params: {
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

  // 1. Update local cache immediately
  const cacheKey = safeKey(userId, 'txs');
  const previousCache = await chunkedStore.getItem(cacheKey);
  const encodedAll = allTransactions.map(tx => encodeTransactionRow(tx, userId));
  const pending = await readPending(userId, 'txs');
  const previousPending = { ...pending };
  pending[transaction.id] = encodeTransactionRow(transaction, userId);
  await writePending(userId, 'txs', pending);
  await chunkedStore.setItem(cacheKey, JSON.stringify(encodedAll)).catch(() => {});

  // 2. If authenticated, update via atomic RPC
  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = getSupabaseClient();
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
export async function deleteTransaction(params: {
  session: Session | null;
  userId: string;
  transactionId: string;
  allTransactions: LedgerTransaction[];
  expectedVersion?: number;
  expectedTxVersion?: string;
}): Promise<FinanceMutationResult<string>> {
  const { session, userId, transactionId, allTransactions, expectedVersion, expectedTxVersion } = params;

  // 1. Update local cache
  const cacheKey = safeKey(userId, 'txs');
  const previousCache = await chunkedStore.getItem(cacheKey);
  const encodedAll = allTransactions.map(tx => encodeTransactionRow(tx, userId));
  const pending = await readPending(userId, 'txs');
  const previousPending = { ...pending };
  const targetTx = allTransactions.find(t => t.id === transactionId);
  if (targetTx) {
    pending[transactionId] = encodeTransactionRow(targetTx, userId);
  }
  await writePending(userId, 'txs', pending);
  await chunkedStore.setItem(cacheKey, JSON.stringify(encodedAll)).catch(() => {});

  // 2. If authenticated, soft delete via atomic RPC
  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = getSupabaseClient();
      const { data, error: rpcError } = await supabase.rpc('debtfree_delete_transaction_atomic', {
        p_tx_id: transactionId,
        p_expected_version: expectedVersion ?? null,
        p_expected_tx_version: expectedTxVersion ?? null,
      });

      if (!rpcError) {
        if (!data || typeof data !== 'object' || (data as { success?: unknown }).success !== true) {
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
export async function persistRecurringBill(params: {
  session: Session | null;
  userId: string;
  bill: RecurringBill;
  allBills: RecurringBill[];
}): Promise<FinanceMutationResult<RecurringBill>> {
  const { session, userId, bill, allBills } = params;

  // 1. Update local cache
  const cacheKey = safeKey(userId, 'bills');
  const previousCache = await chunkedStore.getItem(cacheKey);
  const encodedAll = allBills.map(b => encodeRecurringBillRow(b, userId));
  const pending = await readPending(userId, 'bills');
  const previousPending = { ...pending };
  pending[bill.id] = encodeRecurringBillRow(bill, userId);
  await writePending(userId, 'bills', pending);
  await chunkedStore.setItem(cacheKey, JSON.stringify(encodedAll)).catch(() => {});

  // 2. If authenticated, upsert to Supabase
  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = getSupabaseClient();
      const row = encodeRecurringBillRow(bill, userId);
      const { error } = await supabase.from('recurring_bills').upsert(row, { onConflict: 'id' });
      if (error) {
        const rejected = ['42501', '23514', '23502', '23503', '22P02'].includes(error.code ?? '');
        if (rejected) { await writePending(userId, 'bills', previousPending).catch(() => {}); await restoreCache(cacheKey, previousCache).catch(() => {}); }
        return {
          data: bill,
          syncStatus: 'cached_offline',
          outcome: rejected ? 'rejected' : 'pending',
          failureKind: rejected ? 'rejected' : 'uncertain',
          error: new Error(error.message)
        };
      }
      delete pending[bill.id];
      await writePending(userId, 'bills', pending).catch(() => {});
      return { data: bill, syncStatus: 'synced', outcome: 'confirmed' };
    } catch (err) {
      return {
        data: bill,
        syncStatus: 'cached_offline',
        outcome: 'pending',
        failureKind: 'uncertain',
        error: err instanceof Error ? err : new Error(String(err))
      };
    }
  }

  return { data: bill, syncStatus: 'cached_offline', outcome: 'pending' };
}

/** Delete a recurring bill from Supabase and local cache. */
export async function deleteRecurringBill(params: {
  session: Session | null;
  userId: string;
  billId: string;
  allBills: RecurringBill[];
}): Promise<FinanceMutationResult<string>> {
  const { session, userId, billId, allBills } = params;

  const nextBills = allBills.filter(b => b.id !== billId);
  const cacheKey = safeKey(userId, 'bills');
  const previousCache = await chunkedStore.getItem(cacheKey);
  const encodedAll = nextBills.map(b => encodeRecurringBillRow(b, userId));
  const pending = await readPending(userId, 'bills');
  const previousPending = { ...pending };
  pending[billId] = null;
  await writePending(userId, 'bills', pending);
  await chunkedStore.setItem(cacheKey, JSON.stringify(encodedAll)).catch(() => {});

  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('recurring_bills').delete().eq('id', billId).eq('user_id', userId);
      if (error) {
        const rejected = ['42501', '23514', '23502', '23503', '22P02'].includes(error.code ?? '');
        if (rejected) { await writePending(userId, 'bills', previousPending).catch(() => {}); await restoreCache(cacheKey, previousCache).catch(() => {}); }
        return {
          data: billId,
          syncStatus: 'cached_offline',
          outcome: rejected ? 'rejected' : 'pending',
          failureKind: rejected ? 'rejected' : 'uncertain',
          error: new Error(error.message)
        };
      }
      delete pending[billId];
      await writePending(userId, 'bills', pending).catch(() => {});
      return { data: billId, syncStatus: 'synced', outcome: 'confirmed' };
    } catch (err) {
      return {
        data: billId,
        syncStatus: 'cached_offline',
        outcome: 'pending',
        failureKind: 'uncertain',
        error: err instanceof Error ? err : new Error(String(err))
      };
    }
  }

  return { data: billId, syncStatus: 'cached_offline', outcome: 'pending' };
}

/** Persist a reconciliation anchor to Supabase and local cache. */
export async function persistReconciliationAnchor(params: {
  session: Session | null;
  userId: string;
  anchor: ReconciliationAnchor;
  allAnchors: ReconciliationAnchor[];
}): Promise<FinanceMutationResult<ReconciliationAnchor>> {
  const { session, userId, anchor, allAnchors } = params;

  // 1. Update local cache
  const cacheKey = safeKey(userId, 'anchors');
  const previousCache = await chunkedStore.getItem(cacheKey);
  const encodedAll = allAnchors.map(a => encodeReconciliationAnchorRow(a, userId));
  const pending = await readPending(userId, 'anchors');
  const previousPending = { ...pending };
  pending[anchor.id] = encodeReconciliationAnchorRow(anchor, userId);
  await writePending(userId, 'anchors', pending);
  await chunkedStore.setItem(cacheKey, JSON.stringify(encodedAll)).catch(() => {});

  // 2. If authenticated, upsert to Supabase
  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = getSupabaseClient();
      const row = encodeReconciliationAnchorRow(anchor, userId);
      const { error } = await supabase.from('reconciliation_anchors').upsert(row, { onConflict: 'id' });
      if (error) {
        const rejected = ['42501', '23514', '23502', '23503', '22P02'].includes(error.code ?? '');
        if (rejected) { await writePending(userId, 'anchors', previousPending).catch(() => {}); await restoreCache(cacheKey, previousCache).catch(() => {}); }
        return {
          data: anchor,
          syncStatus: 'cached_offline',
          outcome: rejected ? 'rejected' : 'pending',
          failureKind: rejected ? 'rejected' : 'uncertain',
          error: new Error(error.message)
        };
      }
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
export async function reconcileDebtAtomic(params: {
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

  // 1. Update local caches immediately
  const txCacheKey = safeKey(userId, 'txs');
  const anchorCacheKey = safeKey(userId, 'anchors');
  const prevTxCache = await chunkedStore.getItem(txCacheKey);
  const prevAnchorCache = await chunkedStore.getItem(anchorCacheKey);

  const pendingTxs = await readPending(userId, 'txs');
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
    chunkedStore.setItem(txCacheKey, JSON.stringify(allTransactions.map(tx => encodeTransactionRow(tx, userId)))),
    chunkedStore.setItem(anchorCacheKey, JSON.stringify(allAnchors.map(a => encodeReconciliationAnchorRow(a, userId)))),
  ]);

  // 2. If authenticated, call atomic RPC
  if (session && session.user && session.user.id === userId) {
    try {
      const supabase = getSupabaseClient();
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
