import { getSupabaseClient } from './auth';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import type { Session } from '@supabase/supabase-js';
import { listVerifiedHouseholdContexts } from './household-service';

export type AccountDeletionRequest = {
  operationId: string;
  deleteEmptyHouseholdIds: string[];
  expectedMembershipVersions: Record<string, string>;
  pendingCommandsClear: true;
};

const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function safeAccountId(userId: string): string {
  return Array.from(userId).map(character => character.codePointAt(0)!.toString(16)).join('-');
}
function accountDeletionRequestKey(userId: string): string {
  return `debtfree-account-deletion-v1.${safeAccountId(userId)}`;
}

/** Build and persist the exact preflight sent to the service; retry the same operation ID after uncertainty. */
export async function prepareAccountDeletionRequest(
  session: Session,
  deleteEmptyHouseholdIds: string[],
): Promise<AccountDeletionRequest> {
  const userId = session?.user?.id;
  if (!userId) throw new Error('A signed-in account is required to prepare deletion.');
  const key = accountDeletionRequestKey(userId);
  const raw = await SecureStore.getItemAsync(key);
  if (raw) {
    let prior: unknown;
    try { prior = JSON.parse(raw); } catch { throw new Error('A saved deletion attempt is malformed. Keep the account signed in and contact support before retrying.'); }
    if (!prior || typeof prior !== 'object' || Array.isArray(prior)) throw new Error('A saved deletion attempt is malformed.');
    const record = prior as Partial<AccountDeletionRequest>;
    if (!uuidPattern.test(record.operationId ?? '') || record.pendingCommandsClear !== true
        || !Array.isArray(record.deleteEmptyHouseholdIds) || !record.deleteEmptyHouseholdIds.every(id => typeof id === 'string')
        || !record.expectedMembershipVersions || typeof record.expectedMembershipVersions !== 'object') {
      throw new Error('A saved deletion attempt is malformed.');
    }
    return record as AccountDeletionRequest;
  }

  const summaries = await listVerifiedHouseholdContexts(session);
  const ownerHouseholdIds = summaries.filter(summary => summary.role === 'owner').map(summary => summary.householdId).sort();
  const selected = [...new Set(deleteEmptyHouseholdIds)].sort();
  if (selected.length !== deleteEmptyHouseholdIds.length || selected.some(id => !ownerHouseholdIds.includes(id))) {
    throw new Error('Only a currently owned household can be selected for deletion. Refresh and try again.');
  }
  const financeStorage = await import('./finance-storage');
  for (const summary of summaries) {
    await financeStorage.assertHouseholdFinanceContextReady({
      userId: summary.userId,
      householdId: summary.householdId,
      role: summary.role,
      membershipVersion: summary.membershipVersion,
    });
  }
  const expectedMembershipVersions = Object.fromEntries(summaries.map(summary => [summary.householdId, summary.membershipVersion]));
  const request: AccountDeletionRequest = {
    operationId: Crypto.randomUUID(),
    deleteEmptyHouseholdIds: selected,
    expectedMembershipVersions,
    pendingCommandsClear: true,
  };
  await SecureStore.setItemAsync(key, JSON.stringify(request), secureOptions);
  return request;
}

export async function getPendingAccountDeletionRequest(userId: string): Promise<AccountDeletionRequest | null> {
  const raw = await SecureStore.getItemAsync(accountDeletionRequestKey(userId));
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('A saved account-deletion operation is malformed.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A saved account-deletion operation is malformed.');
  const record = value as Partial<AccountDeletionRequest>;
  if (!uuidPattern.test(record.operationId ?? '') || record.pendingCommandsClear !== true
      || !Array.isArray(record.deleteEmptyHouseholdIds) || !record.deleteEmptyHouseholdIds.every(id => typeof id === 'string')
      || !record.expectedMembershipVersions || typeof record.expectedMembershipVersions !== 'object' || Array.isArray(record.expectedMembershipVersions)) {
    throw new Error('A saved account-deletion operation is malformed.');
  }
  return record as AccountDeletionRequest;
}

/** Call the authenticated server endpoint and accept only an explicit matching completion receipt. */
export async function deleteAuthenticatedAccount(expectedUserId: string, request: AccountDeletionRequest): Promise<void> {
  if (!uuidPattern.test(request.operationId) || request.pendingCommandsClear !== true) {
    throw new Error('Account deletion preflight was invalid. Your local data was kept.');
  }
  const client = getSupabaseClient();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionData.session || sessionData.session.user.id !== expectedUserId) {
    throw new Error('Your signed-in account could not be verified. Your account and local data were kept.');
  }

  const { data: userData, error: userError } = await client.auth.getUser();
  if (!userError && userData.user?.id !== expectedUserId) {
    throw new Error('Your signed-in account could not be verified. Your account and local data were kept.');
  }

  // If Auth deletion succeeded but its response was lost, the gateway may still accept this
  // unexpired JWT so the Edge Function can confirm deletion idempotently.
  const { data, error } = await client.functions.invoke('delete-account', { body: request });
  if (error) {
    throw new Error('Account deletion could not be confirmed. Your local data and operation ID were kept; reconnect and retry the same request.');
  }
  if (!data || data.success !== true || data.status !== 'deleted'
      || data.operationId !== request.operationId || data.deletedUserId !== expectedUserId) {
    throw new Error('Account deletion did not return a valid completion receipt. Your local data and operation ID were kept; retry before signing out.');
  }
  await SecureStore.deleteItemAsync(accountDeletionRequestKey(expectedUserId));
}
