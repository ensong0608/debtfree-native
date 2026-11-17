/** A server-verified active household membership bound to one signed-in user. */
export const HOUSEHOLD_ROLES = ['owner', 'member', 'viewer'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

export type HouseholdContext = {
  userId: string;
  householdId: string;
  role: HouseholdRole;
  /** Decimal text preserves the exact PostgreSQL bigint revision. */
  membershipVersion: string;
};

export type HouseholdMembershipSummary = HouseholdContext & {
  householdName: string;
  currencyCode: string;
};

export type HouseholdSelectionHint = {
  version: 1;
  userId: string;
  householdId: string;
};

function nonEmptyIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

/**
 * Parse a membership returned by the server. The caller must also ensure the
 * membership was read from the current server state before activating it.
 */
export function parseHouseholdContext(expectedUserId: string, value: unknown): HouseholdContext {
  const userId = nonEmptyIdentifier(expectedUserId, 'authenticated user');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid household context.');
  }

  const record = value as Record<string, unknown>;
  if (record.userId !== userId) throw new Error('Household context belongs to a different user.');
  const householdId = nonEmptyIdentifier(record.householdId, 'household ID');
  if (typeof record.role !== 'string' || !HOUSEHOLD_ROLES.includes(record.role as HouseholdRole)) {
    throw new Error('Invalid household role.');
  }
  if (typeof record.membershipVersion !== 'string' || !/^[1-9][0-9]*$/.test(record.membershipVersion)) {
    throw new Error('Invalid household membership version.');
  }

  return {
    userId,
    householdId,
    role: record.role as HouseholdRole,
    membershipVersion: record.membershipVersion,
  };
}

export function parseHouseholdMembershipSummary(expectedUserId: string, value: unknown): HouseholdMembershipSummary {
  const context = parseHouseholdContext(expectedUserId, value);
  const record = value as Record<string, unknown>;
  const householdName = nonEmptyIdentifier(record.householdName, 'household name');
  const currencyCode = nonEmptyIdentifier(record.currencyCode, 'household currency');
  if (!/^[A-Za-z]{3}$/.test(currencyCode)) throw new Error('Invalid household currency.');
  return { ...context, householdName, currencyCode: currencyCode.toUpperCase() };
}

/** A viewer is read-only in the UI; database RPC/RLS checks remain authoritative. */
export function canEditHousehold(context: HouseholdContext): boolean {
  return context.role === 'owner' || context.role === 'member';
}

export function sameHouseholdContext(a: HouseholdContext, b: HouseholdContext): boolean {
  return a.userId === b.userId
    && a.householdId === b.householdId
    && a.role === b.role
    && a.membershipVersion === b.membershipVersion;
}

function secureKeyPart(value: string): string {
  return Array.from(value).map(character => character.codePointAt(0)!.toString(16)).join('-');
}

/** Persist only a selector hint; it never grants access without server revalidation. */
export function householdSelectionStorageKey(userId: string): string {
  const normalizedUserId = nonEmptyIdentifier(userId, 'authenticated user');
  return `debtfree-household-selection-v1.${secureKeyPart(normalizedUserId)}`;
}

export function encodeHouseholdSelectionHint(userId: string, householdId: string): string {
  const hint: HouseholdSelectionHint = {
    version: 1,
    userId: nonEmptyIdentifier(userId, 'authenticated user'),
    householdId: nonEmptyIdentifier(householdId, 'household ID'),
  };
  return JSON.stringify(hint);
}

/** Invalid or foreign-user hints are ignored and must be reloaded from server state. */
export function decodeHouseholdSelectionHint(raw: string | null, expectedUserId: string): string | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.userId !== expectedUserId) return null;
  try {
    return nonEmptyIdentifier(record.householdId, 'household ID');
  } catch {
    return null;
  }
}

/** Namespaces local state by both user and household to prevent cross-context reuse. */
export function householdStorageKey(userId: string, householdId: string, domain: string): string {
  const parts = [
    nonEmptyIdentifier(userId, 'authenticated user'),
    nonEmptyIdentifier(householdId, 'household ID'),
    nonEmptyIdentifier(domain, 'storage domain'),
  ];
  return `debtfree-household-v2.${parts.map(secureKeyPart).join('.')}`;
}

/** Resolve a requested or remembered context only from the latest server list. */
export function selectVerifiedHouseholdSummary(
  summaries: readonly HouseholdMembershipSummary[],
  requestedHouseholdId?: string | null,
  hintedHouseholdId?: string | null,
): HouseholdMembershipSummary {
  if (summaries.length === 0) throw new Error('No active household memberships were returned by the server.');
  const ids = new Set<string>();
  for (const summary of summaries) {
    if (ids.has(summary.householdId)) throw new Error('The server returned duplicate household contexts.');
    ids.add(summary.householdId);
  }
  if (requestedHouseholdId) {
    const selected = summaries.find(summary => summary.householdId === requestedHouseholdId);
    if (selected) return selected;
  }
  if (hintedHouseholdId) {
    const selected = summaries.find(summary => summary.householdId === hintedHouseholdId);
    if (selected) return selected;
  }
  if (summaries.length === 1) {
    return summaries[0];
  }
  const owned = summaries.find(summary => summary.role === 'owner');
  return owned ?? summaries[0];
}
