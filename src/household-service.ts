import type { SessionVerification } from './identity-verification';
import type { Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { getSupabaseClient } from './auth';
import {
  decodeHouseholdSelectionHint,
  encodeHouseholdSelectionHint,
  householdSelectionStorageKey,
  parseHouseholdMembershipSummary,
  selectVerifiedHouseholdSummary,
  type HouseholdMembershipSummary,
} from './household-context';

export class HouseholdContextUnavailableError extends Error {
  constructor(message = 'Your active household membership could not be verified. Reconnect and try again.') {
    super(message);
    this.name = 'HouseholdContextUnavailableError';
  }
}

function rpcObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (Array.isArray(value) && value.length === 1 && value[0] && typeof value[0] === 'object' && !Array.isArray(value[0])) {
    return value[0] as Record<string, unknown>;
  }
  return null;
}

function rpcErrorMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  if (!error) return fallback;
  if (['PGRST202', '42883', '42P01', '42703'].includes(error.code ?? '')) {
    return 'Household services are not ready on the server. Reconnect after the approved household update is available.';
  }
  return fallback;
}

async function assertSessionUser(session: Session, verification?: SessionVerification): Promise<string> {
  const expectedUserId = session?.user?.id;
  if (!expectedUserId) throw new HouseholdContextUnavailableError('A signed-in account is required to load household memberships.');
  const { data, error } = verification
    ? { data: { user: await verification.getUser(session) }, error: null }
    : await getSupabaseClient().auth.getUser();
  if (error || !data.user || data.user.id !== expectedUserId) {
    throw new HouseholdContextUnavailableError('Your signed-in account could not be verified.');
  }
  return expectedUserId;
}

/** Fetch membership contexts from server authority; local hints are never returned as access. */
export async function listVerifiedHouseholdContexts(session: Session, verification?: SessionVerification): Promise<HouseholdMembershipSummary[]> {
  const userId = await assertSessionUser(session, verification);
  const { data, error } = await getSupabaseClient().rpc('debtfree_list_household_contexts');
  if (error || !Array.isArray(data)) {
    throw new HouseholdContextUnavailableError(rpcErrorMessage(error, 'Your household memberships could not be loaded.'));
  }
  try {
    const summaries = data.map(value => parseHouseholdMembershipSummary(userId, value));
    const ids = new Set<string>();
    for (const summary of summaries) {
      if (ids.has(summary.householdId)) throw new Error('Duplicate household identity.');
      ids.add(summary.householdId);
    }
    return summaries;
  } catch {
    throw new HouseholdContextUnavailableError('The server returned an invalid household membership context.');
  }
}

/** Bootstrap is allowed only for a new account; the server performs the no-data preflight. */
export async function ensurePersonalHouseholdContext(
  session: Session,
  identity: { householdName: string; currencyCode: string },
  verification?: SessionVerification,
): Promise<HouseholdMembershipSummary> {
  const userId = await assertSessionUser(session, verification);
  const name = identity.householdName.trim();
  const currencyCode = identity.currencyCode.toUpperCase();
  if (!name || name.length > 120 || !/^[A-Z]{3}$/.test(currencyCode)) {
    throw new HouseholdContextUnavailableError('Initial household name or currency is invalid.');
  }
  const { data, error } = await getSupabaseClient().rpc('debtfree_ensure_personal_household', {
    p_household_name: name,
    p_currency_code: currencyCode,
  });
  const record = rpcObject(data);
  if (error || !record) {
    throw new HouseholdContextUnavailableError(rpcErrorMessage(error, 'Your initial household could not be created safely.'));
  }
  try {
    return parseHouseholdMembershipSummary(userId, record);
  } catch {
    throw new HouseholdContextUnavailableError('The server did not confirm the initial household context.');
  }
}

/**
 * Resolve one current server membership without changing the selected-household hint.
 * A stale/missing hint is never silently redirected when more than one context exists.
 */
export async function loadVerifiedHouseholdContext(
  session: Session,
  options: { requestedHouseholdId?: string | null; bootstrapIdentity?: { householdName: string; currencyCode: string }; suppressBootstrap?: boolean; verification?: SessionVerification } = {},
): Promise<{ selected: HouseholdMembershipSummary; summaries: HouseholdMembershipSummary[] }> {
  // The list operation verifies the session user before asking the server for
  // current memberships; do not repeat the same auth request here.
  let summaries = await listVerifiedHouseholdContexts(session, options.verification);
  const userId = session.user.id;
  if (summaries.length === 0) {
    if (options.suppressBootstrap) {
      throw new HouseholdContextUnavailableError('No active household membership is available yet.');
    }
    const initial = await ensurePersonalHouseholdContext(session, options.bootstrapIdentity ?? {
      householdName: 'My Household',
      currencyCode: 'USD',
    }, options.verification);
    summaries = [initial];
  }

  let hintedHouseholdId: string | null = null;
  try {
    hintedHouseholdId = decodeHouseholdSelectionHint(
      await SecureStore.getItemAsync(householdSelectionStorageKey(userId)), userId,
    );
  } catch {
    // Losing a non-authoritative selection hint cannot authorize or redirect access.
  }
  let selected: HouseholdMembershipSummary;
  try {
    selected = selectVerifiedHouseholdSummary(summaries, options.requestedHouseholdId, hintedHouseholdId);
  } catch (error) {
    throw new HouseholdContextUnavailableError(error instanceof Error ? error.message : undefined);
  }
  return { selected, summaries };
}

export async function saveHouseholdSelectionHint(userId: string, householdId: string): Promise<void> {
  await SecureStore.setItemAsync(
    householdSelectionStorageKey(userId),
    encodeHouseholdSelectionHint(userId, householdId),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
}
