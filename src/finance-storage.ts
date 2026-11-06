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
import {
  encodeTransactionRow,
  decodeTransactionRow,
  encodeRecurringBillRow,
  decodeRecurringBillRow,
  encodeReconciliationAnchorRow,
  decodeReconciliationAnchorRow,
  mergeFinanceRowsWithPendingWrites,
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

export type FinanceMutationResult<T> = {
  data: T;
  syncStatus: FinanceSyncStatus;
  error?: Error;
  failureKind?: 'rejected' | 'uncertain';
  accountBalance?: number;
  accountVersion?: number;
};

type PendingRows = Record<string, Record<string, unknown> | null>;
async function readPending(userId: string, domain: string): Promise<PendingRows> {
  try { return JSON.parse(await chunkedStore.getItem(safeKey(userId, `pending-${domain}`)) ?? '{}') as PendingRows; }
  catch { return {}; }
}
async function writePending(userId: string, domain: string, pending: PendingRows): Promise<void> {
  await chunkedStore.setItem(safeKey(userId, `pending-${domain}`), JSON.stringify(pending));
}
async function restoreCache(key: string, raw: string | null): Promise<void> {
  if (raw === null) await chunkedStore.removeItem(key);
  else await chunkedStore.setItem(key, raw);
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
      cachedTxs = parsed.map(r => decodeTransactionRow(r, currency));
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
    const remoteTxRows = mergeFinanceRowsWithPendingWrites(txsRes.data as SupabaseTransactionRow[], pendingTxs);
    const remoteBillRows = mergeFinanceRowsWithPendingWrites(billsRes.data as SupabaseRecurringBillRow[], pendingBills);
    const remoteAnchorRows = mergeFinanceRowsWithPendingWrites(anchorsRes.data as SupabaseReconciliationAnchorRow[], pendingAnchors);
    const remoteTxs = remoteTxRows.map(r => decodeTransactionRow(r, currency));
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
      syncStatus: Object.keys(pendingTxs).length || Object.keys(pendingBills).length || Object.keys(pendingAnchors).length ? 'cached_offline' : 'synced',
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
}): Promise<FinanceMutationResult<LedgerTransaction>> {
  const { session, userId, transaction, allTransactions } = params;

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
        });
        if (!rpcError) {
          if (!data || typeof data !== 'object' || (data as { success?: unknown }).success !== true) {
            await writePending(userId, 'txs', previousPending);
            await restoreCache(cacheKey, previousCache);
            return { data: transaction, syncStatus: 'cached_offline', failureKind: 'rejected', error: new Error('Atomic transaction write was not confirmed.') };
          }
          delete pending[transaction.id];
          await writePending(userId, 'txs', pending).catch(() => {});
          const rawBalance = (data as { new_balance?: unknown }).new_balance;
          const accountBalance = typeof rawBalance === 'number' ? rawBalance : typeof rawBalance === 'string' ? Number(rawBalance) : undefined;
          const rawVersion = (data as { new_version?: unknown }).new_version;
          const accountVersion = typeof rawVersion === 'number' ? rawVersion : typeof rawVersion === 'string' ? Number(rawVersion) : undefined;
          return {
            data: transaction,
            syncStatus: 'synced',
            accountBalance: Number.isFinite(accountBalance) ? accountBalance : undefined,
            accountVersion: Number.isSafeInteger(accountVersion) ? accountVersion : undefined,
          };
        }
        const missingRpc = rpcError.code === '42883' || rpcError.code === 'PGRST202';
        const cashOnly = transaction.accountId === null && (transaction.category === 'debit_bill' || transaction.category === 'debit_spending');
        if (missingRpc && cashOnly) {
          const { error: insertError } = await supabase.from('transactions').insert(row);
          if (!insertError) {
            delete pending[transaction.id];
            await writePending(userId, 'txs', pending).catch(() => {});
            return { data: transaction, syncStatus: 'synced' };
          }
          await writePending(userId, 'txs', previousPending);
          await restoreCache(cacheKey, previousCache);
          return { data: transaction, syncStatus: 'cached_offline', failureKind: 'rejected', error: new Error(insertError.message) };
        }
        const rejected = ['42501', '23514', '23502', '23503', '23505', '22P02', '42883', 'PGRST202'].includes(rpcError.code ?? '');
        if (rejected) {
          await writePending(userId, 'txs', previousPending).catch(() => {});
          await restoreCache(cacheKey, previousCache).catch(() => {});
        }
        return { data: transaction, syncStatus: 'cached_offline', failureKind: rejected ? 'rejected' : 'uncertain', error: new Error(rpcError.message) };
      } catch (err) {
        return { data: transaction, syncStatus: 'cached_offline', failureKind: 'uncertain', error: err instanceof Error ? err : new Error(String(err)) };
      }
    } catch (err) {
      return { data: transaction, syncStatus: 'cached_offline', failureKind: 'uncertain', error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  return { data: transaction, syncStatus: 'cached_offline' };
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
        return { data: bill, syncStatus: 'cached_offline', failureKind: rejected ? 'rejected' : 'uncertain', error: new Error(error.message) };
      }
      delete pending[bill.id];
      await writePending(userId, 'bills', pending).catch(() => {});
      return { data: bill, syncStatus: 'synced' };
    } catch (err) {
      return { data: bill, syncStatus: 'cached_offline', failureKind: 'uncertain', error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  return { data: bill, syncStatus: 'cached_offline' };
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
        return { data: billId, syncStatus: 'cached_offline', failureKind: rejected ? 'rejected' : 'uncertain', error: new Error(error.message) };
      }
      delete pending[billId];
      await writePending(userId, 'bills', pending).catch(() => {});
      return { data: billId, syncStatus: 'synced' };
    } catch (err) {
      return { data: billId, syncStatus: 'cached_offline', failureKind: 'uncertain', error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  return { data: billId, syncStatus: 'cached_offline' };
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
        return { data: anchor, syncStatus: 'cached_offline', failureKind: rejected ? 'rejected' : 'uncertain', error: new Error(error.message) };
      }
      delete pending[anchor.id];
      await writePending(userId, 'anchors', pending).catch(() => {});
      return { data: anchor, syncStatus: 'synced' };
    } catch (err) {
      return { data: anchor, syncStatus: 'cached_offline', failureKind: 'uncertain', error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  return { data: anchor, syncStatus: 'cached_offline' };
}
