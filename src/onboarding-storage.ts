import { PermissionsAndroid, Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { getSupabaseClient } from './auth';
import { createChunkedStorage, type KeyValueStore } from './secure-chunks';
import {
  createDefaultOnboardingData,
  roundCents,
  type DebtCategory,
  type DebtItem,
  type UserOnboardingData,
} from './onboarding-domain';

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

type SupabaseDebtRow = {
  id: string;
  user_id: string;
  name: string;
  balance: number | string;
  apr: number | string;
  minimum_payment: number | string;
  created_at?: string;
  updated_at?: string;
};

function inferCategoryFromName(name: string): DebtCategory {
  const lower = name.toLowerCase();
  if (lower.includes('mortgage') || lower.includes('home loan')) return 'Mortgage';
  if (lower.includes('auto') || lower.includes('car') || lower.includes('vehicle')) return 'Auto loan';
  if (lower.includes('student')) return 'Student loan';
  if (lower.includes('medical')) return 'Medical debt';
  if (lower.includes('personal')) return 'Personal loan';
  return 'Credit card';
}

function mergeDebtsWithDatabaseRows(
  metaDebts: DebtItem[],
  dbRows: SupabaseDebtRow[],
): DebtItem[] {
  if (dbRows.length === 0) return metaDebts;
  const metaById = new Map<string, DebtItem>(metaDebts.map(d => [d.id, d]));
  const merged: DebtItem[] = dbRows.map(row => {
    const existing = metaById.get(row.id);
    const balance = roundCents(Number(row.balance) || 0);
    const apr = Number(row.apr) || 0;
    const minimumPayment = roundCents(Number(row.minimum_payment) || 0);
    return {
      id: row.id,
      name: row.name,
      category: existing?.category ?? inferCategoryFromName(row.name),
      balance,
      originalBalance: existing?.originalBalance ?? balance,
      apr,
      minimumPayment,
      dueDay: existing?.dueDay ?? null,
      creditLimit: existing?.creditLimit ?? null,
      createdAt: row.created_at ?? existing?.createdAt ?? new Date().toISOString(),
      updatedAt: row.updated_at ?? existing?.updatedAt ?? new Date().toISOString(),
    };
  });
  return merged;
}

/**
 * Load the authenticated user's onboarding and debt state from local SecureStore,
 * Supabase user_metadata, and the Supabase `public.debts` table.
 */
export async function loadUserOnboardingData(session: Session): Promise<UserOnboardingData> {
  const userId = session.user.id;
  const fallback = createDefaultOnboardingData(userId);

  let localData: UserOnboardingData | null = null;
  try {
    const raw = await chunkedStore.getItem(localStateKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as UserOnboardingData;
      if (parsed && parsed.userId === userId && parsed.version === 1) {
        localData = parsed;
      }
    }
  } catch {
    // Ignore local cache parse errors and fall back to remote metadata
  }

  let remoteData: UserOnboardingData | null = null;
  const metaRaw = session.user.user_metadata?.debtfree_native_v1;
  if (metaRaw && typeof metaRaw === 'object') {
    const candidate = metaRaw as UserOnboardingData;
    if (candidate.userId === userId && candidate.version === 1) {
      remoteData = candidate;
    }
  }

  let base: UserOnboardingData = fallback;
  if (localData && remoteData) {
    base =
      (localData.updatedAt ?? '') >= (remoteData.updatedAt ?? '')
        ? localData
        : remoteData;
  } else if (remoteData) {
    base = remoteData;
  } else if (localData) {
    base = localData;
  }

  // Fetch authoritative rows from `public.debts` in sandbox Supabase
  try {
    const supabase = getSupabaseClient();
    const { data: rows, error } = await supabase
      .from('debts')
      .select('id, user_id, name, balance, apr, minimum_payment, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(rows) && rows.length > 0) {
      base = {
        ...base,
        debts: mergeDebtsWithDatabaseRows(base.debts ?? [], rows as SupabaseDebtRow[]),
      };
    }
  } catch {
    // Offline or transient network error; retain base.debts from local/metadata
  }

  try {
    await chunkedStore.setItem(localStateKey(userId), JSON.stringify(base));
  } catch {
    // Ignore local cache write error
  }

  return base;
}

/**
 * Save updated onboarding state to both local SecureStore and Supabase Auth user_metadata.
 */
export async function saveUserOnboardingData(
  data: UserOnboardingData,
): Promise<UserOnboardingData> {
  const stamped: UserOnboardingData = {
    ...data,
    updatedAt: new Date().toISOString(),
  };

  await chunkedStore.setItem(localStateKey(stamped.userId), JSON.stringify(stamped));

  try {
    const supabase = getSupabaseClient();
    await supabase.auth.updateUser({
      data: {
        debtfree_native_v1: stamped,
      },
    });
  } catch {
    // Keep local SecureStore state even if offline; next online save will sync
  }

  return stamped;
}

/**
 * Insert or update a debt row in Supabase `public.debts` for the authenticated user,
 * and persist the updated onboarding data.
 */
export async function upsertUserDebt(
  current: UserOnboardingData,
  debtInput: Omit<DebtItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): Promise<UserOnboardingData> {
  const now = new Date().toISOString();
  const debtId = debtInput.id ?? Crypto.randomUUID();
  const existing = current.debts.find(d => d.id === debtId);

  const debtItem: DebtItem = {
    id: debtId,
    name: debtInput.name.trim(),
    category: debtInput.category,
    balance: roundCents(debtInput.balance),
    originalBalance:
      debtInput.originalBalance !== null ? roundCents(debtInput.originalBalance) : null,
    apr: debtInput.apr,
    minimumPayment: roundCents(debtInput.minimumPayment),
    dueDay: debtInput.dueDay,
    creditLimit: debtInput.creditLimit !== null ? roundCents(debtInput.creditLimit) : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const supabase = getSupabaseClient();
  const { error } = await supabase.from('debts').upsert(
    {
      id: debtItem.id,
      user_id: current.userId,
      name: debtItem.name,
      balance: debtItem.balance,
      apr: debtItem.apr,
      minimum_payment: debtItem.minimumPayment,
      updated_at: now,
    },
    { onConflict: 'id' },
  );

  if (error) {
    throw new Error(`Could not save "${debtItem.name}" to your account: ${error.message}`);
  }

  const nextDebts = existing
    ? current.debts.map(d => (d.id === debtId ? debtItem : d))
    : [...current.debts, debtItem];

  const nextHomeStatus =
    debtItem.category === 'Mortgage' ? 'Own' : current.homeStatus;
  const nextVehicleStatus =
    debtItem.category === 'Auto loan' ? 'Finance' : current.vehicleStatus;

  return saveUserOnboardingData({
    ...current,
    homeStatus: nextHomeStatus,
    vehicleStatus: nextVehicleStatus,
    debts: nextDebts,
  });
}

/**
 * Delete a debt from Supabase `public.debts` for the authenticated user and update onboarding data.
 */
export async function deleteUserDebt(
  current: UserOnboardingData,
  debtId: string,
): Promise<UserOnboardingData> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('debts')
    .delete()
    .eq('id', debtId)
    .eq('user_id', current.userId);

  if (error) {
    throw new Error(`Could not remove debt from your account: ${error.message}`);
  }

  const nextDebts = current.debts.filter(d => d.id !== debtId);
  return saveUserOnboardingData({
    ...current,
    debts: nextDebts,
  });
}

/**
 * Completely reset the user's onboarding progress and debts in both local SecureStore
 * and the sandbox Supabase project (`public.debts` + `auth.users.user_metadata`).
 */
export async function resetUserOnboardingData(userId: string): Promise<void> {
  try {
    await chunkedStore.removeItem(localStateKey(userId));
  } catch {
    // Ignore local cache removal failure
  }

  try {
    const supabase = getSupabaseClient();
    await supabase.from('debts').delete().eq('user_id', userId);
    const fresh = createDefaultOnboardingData(userId);
    await supabase.auth.updateUser({
      data: {
        debtfree_native_v1: fresh,
      },
    });
  } catch {
    // Ignore remote cleanup errors if offline; local state and session will still be cleared
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
