import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createChunkedStorage, type KeyValueStore } from './secure-chunks';
import {
  EMPTY_PAYEE_MEMORY_STATE,
  type CsvImportPreset,
  type CsvPayeeRule,
  type PayeeMemoryEntry,
  type PayeeMemoryStoreState,
} from './finance/payee-memory';

const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const storageKeyForUser = (userId: string) => `bitless-payee-memory.${userId.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
const secureKv: KeyValueStore = {
  getItem: key => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, secureOptions),
  removeItem: key => SecureStore.deleteItemAsync(key),
};
const chunkedStore = createChunkedStorage(secureKv, () => Crypto.randomUUID());

const writeQueues = new Map<string, Promise<void>>();

function normalizeState(raw: unknown): PayeeMemoryStoreState {
  if (!raw || typeof raw !== 'object') return EMPTY_PAYEE_MEMORY_STATE;
  const obj = raw as {
    payees?: Record<string, PayeeMemoryEntry>;
    presets?: CsvImportPreset[];
    rules?: CsvPayeeRule[];
  };
  return {
    payees: obj.payees && typeof obj.payees === 'object' ? obj.payees : {},
    presets: Array.isArray(obj.presets) ? obj.presets : [],
    rules: Array.isArray(obj.rules) ? obj.rules : [],
  };
}

export async function loadPayeeMemoryState(userId?: string): Promise<PayeeMemoryStoreState> {
  if (!userId) return EMPTY_PAYEE_MEMORY_STATE;
  try {
    const raw = await chunkedStore.getItem(storageKeyForUser(userId));
    if (!raw) return EMPTY_PAYEE_MEMORY_STATE;
    return normalizeState(JSON.parse(raw));
  } catch {
    return EMPTY_PAYEE_MEMORY_STATE;
  }
}

export async function savePayeeMemoryState(
  userId: string | undefined,
  updater: PayeeMemoryStoreState | ((current: PayeeMemoryStoreState) => PayeeMemoryStoreState),
): Promise<PayeeMemoryStoreState> {
  if (!userId) {
    return typeof updater === 'function' ? updater(EMPTY_PAYEE_MEMORY_STATE) : updater;
  }
  const key = storageKeyForUser(userId);
  let resolved = EMPTY_PAYEE_MEMORY_STATE;
  const prior = writeQueues.get(key) ?? Promise.resolve();
  const next = prior
    .catch(() => undefined)
    .then(async () => {
      const current = typeof updater === 'function' ? await loadPayeeMemoryState(userId) : EMPTY_PAYEE_MEMORY_STATE;
      resolved = typeof updater === 'function' ? updater(current) : updater;
      await chunkedStore.setItem(key, JSON.stringify(resolved));
    });
  writeQueues.set(key, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(key) === next) writeQueues.delete(key);
  }
  return resolved;
}
