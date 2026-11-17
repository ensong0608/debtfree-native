import type { Session, SupabaseClient } from '@supabase/supabase-js';
// @ts-ignore TS5097: Node direct-load tests need explicit TypeScript extensions.
import { HOUSEHOLD_ROLES, parseHouseholdContext, type HouseholdContext, type HouseholdMembershipSummary, type HouseholdRole } from './household-context.ts';
// @ts-ignore TS5097: Node direct-load tests need explicit TypeScript extensions.
import type { UserOnboardingData } from './onboarding-domain.ts';
// @ts-ignore TS5097: Node direct-load tests need explicit TypeScript extensions.
import type { PendingSummary } from './finance/pending-journal.ts';
// @ts-ignore TS5097: Node direct-load tests need explicit TypeScript extensions.
import { RestoreRejectedError, type RestoreAdapter, type RestoreReceipt, type RestoreRpcRequest, type SnapshotBaseline } from './finance/backup-recovery.ts';
// @ts-ignore TS5097: Node direct-load tests need explicit TypeScript extensions.
import type { BackupOwner, NativeBackup } from './finance/backup.ts';

export const HOUSEHOLD_INVITE_SCHEME = 'com.debtfree.native.test';

export type HouseholdInvitationRole = 'member' | 'viewer';

export type HouseholdInvitationSummary = {
  invitationId: string;
  emailHint: string;
  role: HouseholdInvitationRole;
  expiresAt: string;
  expired: boolean;
  deliveryState: 'prepared' | 'sent' | 'uncertain';
};

export type HouseholdMemberSummary = {
  userId: string;
  role: HouseholdRole;
  emailHint: string | null;
  isSelf: boolean;
  joinedAt: string;
};

export type InviteDeliveryStatus = {
  status: 'sent' | 'failed' | 'unconfigured';
  message: string;
};

export type CreatedOrRotatedInviteResult = {
  invitationId: string;
  householdId: string;
  role: HouseholdInvitationRole;
  expiresAt: string;
  membershipVersion: string;
  rawToken: string;
  inviteUrl: string;
  inviteWebUrl: string;
  deliveryState: 'prepared' | 'sent' | 'uncertain';
  delivery: InviteDeliveryStatus;
};

export type AcceptHouseholdInviteResult = {
  userId: string;
  householdId: string;
  role: HouseholdRole;
  membershipVersion: string;
};

export type SwitchHouseholdResult = {
  selected: HouseholdMembershipSummary;
  summaries: HouseholdMembershipSummary[];
  onboardingData: UserOnboardingData;
};

export type HouseholdCollaborationDeps = {
  getClient: () => SupabaseClient;
  listVerifiedHouseholdContexts: (session: Session) => Promise<HouseholdMembershipSummary[]>;
  loadUserOnboardingData: (
    session: Session,
    options?: { householdId?: string | null },
  ) => Promise<UserOnboardingData>;
  saveHouseholdSelectionHint: (userId: string, householdId: string) => Promise<void>;
  getPendingFinanceSummary: (context: HouseholdContext) => Promise<PendingSummary>;
  sha256Hex: (raw: string) => Promise<string>;
  randomToken: () => Promise<string>;
};

async function defaultGetClient(): Promise<SupabaseClient> {
  // @ts-ignore TS5097: runtime dynamic import avoids loading React Native auth in Node tests.
  const mod = await import('./auth.ts');
  return mod.getSupabaseClient();
}

async function defaultSha256Hex(raw: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  const ExpoCrypto = await import('expo-crypto');
  return ExpoCrypto.digestStringAsync(ExpoCrypto.CryptoDigestAlgorithm.SHA256, raw);
}

async function defaultRandomToken(): Promise<string> {
  const bytes = new Uint8Array(32);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    const ExpoCrypto = await import('expo-crypto');
    const randomBytes = await ExpoCrypto.getRandomBytesAsync(32);
    bytes.set(randomBytes);
  }
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

let testDeps: Partial<HouseholdCollaborationDeps> = {};

export function __configureHouseholdCollaborationForTests(deps: Partial<HouseholdCollaborationDeps>): void {
  testDeps = { ...deps };
}

export function __resetHouseholdCollaborationForTests(): void {
  testDeps = {};
}

async function resolveClient(): Promise<SupabaseClient> {
  if (testDeps.getClient) return testDeps.getClient();
  return defaultGetClient();
}

async function resolveSha256Hex(raw: string): Promise<string> {
  return (testDeps.sha256Hex ?? defaultSha256Hex)(raw);
}

async function resolveRandomToken(): Promise<string> {
  return (testDeps.randomToken ?? defaultRandomToken)();
}

async function resolveListVerifiedHouseholdContexts(session: Session): Promise<HouseholdMembershipSummary[]> {
  if (testDeps.listVerifiedHouseholdContexts) return testDeps.listVerifiedHouseholdContexts(session);
  // @ts-ignore TS5097: runtime dynamic import keeps Node unit tests native-free.
  const mod = await import('./household-service.ts');
  return mod.listVerifiedHouseholdContexts(session);
}

async function resolveLoadUserOnboardingData(
  session: Session,
  options?: { householdId?: string | null },
): Promise<UserOnboardingData> {
  if (testDeps.loadUserOnboardingData) return testDeps.loadUserOnboardingData(session, options);
  // @ts-ignore TS5097: runtime dynamic import keeps Node unit tests native-free.
  const mod = await import('./onboarding-storage.ts');
  return mod.loadUserOnboardingData(session, options);
}


async function resolvePendingFinanceSummary(context: HouseholdContext): Promise<PendingSummary> {
  if (testDeps.getPendingFinanceSummary) return testDeps.getPendingFinanceSummary(context);
  // @ts-ignore TS5097: runtime dynamic import keeps Node unit tests native-free.
  const mod = await import('./finance-storage.ts');
  return mod.getPendingFinanceSummary(context);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (Array.isArray(value) && value.length === 1 && value[0] && typeof value[0] === 'object' && !Array.isArray(value[0])) {
    return value[0] as Record<string, unknown>;
  }
  return null;
}

function requirePositiveVersionString(value: unknown, label = 'membership version'): string {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof normalized !== 'string' || !/^[1-9][0-9]*$/.test(normalized)) {
    throw new Error(`Server returned an invalid ${label}.`);
  }
  return normalized;
}

function normalizeInviteRole(value: unknown): HouseholdInvitationRole {
  if (value === 'viewer') return 'viewer';
  if (value === 'member' || value === 'admin') return 'member';
  throw new Error('Server returned an invalid invitation role.');
}

function normalizeHouseholdRole(value: unknown): HouseholdRole {
  if (value === 'admin') return 'member';
  if (typeof value === 'string' && HOUSEHOLD_ROLES.includes(value as HouseholdRole)) {
    return value as HouseholdRole;
  }
  throw new Error('Server returned an invalid household member role.');
}

function normalizeDeliveryState(value: unknown): 'prepared' | 'sent' | 'uncertain' {
  if (value === 'prepared' || value === 'sent' || value === 'uncertain') return value;
  return 'uncertain';
}

function formatRpcError(error: { code?: string; message?: string } | null | undefined, fallback: string): string {
  if (!error) return fallback;
  const code = error.code ?? '';
  const raw = error.message ?? '';
  if (code === '40001' || raw.includes('membership version changed') || raw.includes('Household participants changed')) {
    return 'Household membership changed on another device. Refresh and try again.';
  }
  if (code === 'P0001' && raw.toLowerCase().includes('rate limit')) {
    return 'Invitation limit reached for this hour. Share your existing invite link or try again later.';
  }
  if (code === 'P0001' && raw.toLowerCase().includes('capacity')) {
    return 'This household already has the maximum of 3 active members and pending invitations.';
  }
  if (code === '23505' && raw.toLowerCase().includes('active member')) {
    return 'That email already belongs to an active household member.';
  }
  if (code === '23505' && raw.toLowerCase().includes('already a household member')) {
    return 'Your account is already an active member of that household.';
  }
  if (code === '23505') {
    return 'A pending invitation already exists for that email address.';
  }
  if (raw.toLowerCase().includes('confirmed email required')) {
    return 'Please confirm your account email address before accepting a household invitation.';
  }
  if (raw.toLowerCase().includes('invitation unavailable')) {
    return 'This invitation is expired, revoked, already used, or issued for a different email address.';
  }
  if (code === '42501') {
    return raw || 'You do not have permission to perform this household action.';
  }
  return raw || fallback;
}

export function buildHouseholdInviteUrl(rawToken: string): string {
  const token = rawToken.trim();
  if (token.length < 32 || token.length > 128 || /\s/.test(token)) {
    throw new Error('Invalid invite token.');
  }
  return `${HOUSEHOLD_INVITE_SCHEME}://invite?token=${encodeURIComponent(token)}`;
}

export function buildHouseholdInviteWebUrl(rawToken: string, baseUrl?: string): string {
  const token = rawToken.trim();
  if (token.length < 32 || token.length > 128 || /\s/.test(token)) {
    throw new Error('Invalid invite token.');
  }
  void baseUrl;
  return 'https://bitless-household-invite.ensong608.chatgpt.site/#token=' + encodeURIComponent(token);
}

export function parseHouseholdInviteInput(input: string, options?: { allowedHosts?: string[] }): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    const protocol = parsed.protocol.replace(/:$/, '').toLowerCase();
    const candidate = (parsed.searchParams.get('token') ?? parsed.searchParams.get('code') ?? new URLSearchParams(parsed.hash.slice(1)).get('token') ?? '').trim();
    const isValidToken = candidate.length >= 32 && candidate.length <= 128 && !/\s/.test(candidate);

    if (protocol === HOUSEHOLD_INVITE_SCHEME) {
      const hostAndPath = `${parsed.hostname}${parsed.pathname}`.replace(/^\/+|\/+$/g, '').toLowerCase();
      if (hostAndPath !== 'invite') return null;
      return isValidToken ? candidate : null;
    }

    if (protocol === 'https' || protocol === 'http') {
      const hostname = parsed.hostname.toLowerCase();
      const isAllowedHost = hostname === 'bitless-household-invite.ensong608.chatgpt.site'
        || hostname.endsWith('.supabase.co')
        || hostname === 'supabase.co'
        || hostname === 'debtfree.app'
        || hostname.endsWith('.debtfree.app')
        || hostname === 'debtfree.com'
        || hostname.endsWith('.debtfree.com')
        || hostname === 'bitless.app'
        || hostname.endsWith('.bitless.app')
        || hostname === 'localhost'
        || (options?.allowedHosts && options.allowedHosts.includes(hostname));
      if (!isAllowedHost) return null;
      return isValidToken ? candidate : null;
    }

    return null;
  }

  if (trimmed.length < 32 || trimmed.length > 128 || /\s/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function assertSignedInContext(session: Session, context: HouseholdContext): HouseholdContext {
  const userId = session?.user?.id;
  if (!userId) throw new Error('Sign in before managing households.');
  return parseHouseholdContext(userId, context);
}

async function deliverInvitationEmail(
  supabase: SupabaseClient,
  householdId: string,
  invitationId: string,
  rawToken: string,
): Promise<{ deliveryState: 'prepared' | 'sent' | 'uncertain'; delivery: InviteDeliveryStatus }> {
  try {
    const { data, error } = await supabase.functions.invoke('send-household-invitation', {
      body: { householdId, invitationId, rawToken },
    });
    const record = asRecord(data);
    if (!error && record?.success === true) {
      return {
        deliveryState: 'sent',
        delivery: { status: 'sent', message: 'Invitation email sent.' },
      };
    }

    const errorStatus = (error as { context?: { status?: number } } | null)?.context?.status;
    const providerError = typeof record?.providerError === 'string' && record.providerError.trim() ? record.providerError.trim() : '';
    const errorMessage = (record?.error && typeof record.error === 'string' ? record.error : '') || error?.message || '';
    const isUnconfigured = errorStatus === 503
      || errorMessage.toLowerCase().includes('not configured')
      || errorMessage.toLowerCase().includes('404');

    let failureMessage = isUnconfigured
      ? 'Email delivery is not configured yet, but your invite link and code are ready to share.'
      : 'Invite created, though email delivery could not be confirmed. Copy and share the invite link or code below.';
    if (providerError) {
      failureMessage = `Email provider note: ${providerError}. Copy and share the invite link or code below.`;
    }

    return {
      deliveryState: normalizeDeliveryState(record?.deliveryState ?? 'prepared'),
      delivery: {
        status: isUnconfigured ? 'unconfigured' : 'failed',
        message: failureMessage,
      },
    };
  } catch {
    return {
      deliveryState: 'uncertain',
      delivery: {
        status: 'failed',
        message: 'Invite created, though email delivery could not be reached. Copy and share the invite link or code below.',
      },
    };
  }
}

export async function listHouseholdInvitations(
  session: Session,
  context: HouseholdContext,
): Promise<{ householdId: string; membershipVersion: string; invitations: HouseholdInvitationSummary[] }> {
  const verified = assertSignedInContext(session, context);
  if (verified.role !== 'owner') {
    throw new Error('Only the household owner can manage invitations.');
  }
  const supabase = await resolveClient();
  const { data, error } = await supabase.rpc('debtfree_list_household_invitations', {
    p_household_id: verified.householdId,
    p_expected_membership_version: verified.membershipVersion,
  });
  const record = asRecord(data);
  if (error || !record || record.status !== 'ok' || !Array.isArray(record.invitations)) {
    throw new Error(formatRpcError(error, 'Could not load pending invitations.'));
  }

  return {
    householdId: String(record.householdId ?? verified.householdId),
    membershipVersion: requirePositiveVersionString(record.membershipVersion),
    invitations: record.invitations.map(item => {
      const row = asRecord(item) ?? {};
      return {
        invitationId: String(row.invitationId ?? ''),
        emailHint: String(row.emailHint ?? ''),
        role: normalizeInviteRole(row.role),
        expiresAt: String(row.expiresAt ?? ''),
        expired: Boolean(row.expired),
        deliveryState: normalizeDeliveryState(row.deliveryState),
      };
    }),
  };
}

export async function createHouseholdInvitation(
  session: Session,
  context: HouseholdContext,
  params: { inviteeEmail: string; role: HouseholdInvitationRole },
): Promise<CreatedOrRotatedInviteResult> {
  const verified = assertSignedInContext(session, context);
  if (verified.role !== 'owner') {
    throw new Error('Only the household owner can invite members.');
  }
  const email = params.inviteeEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address for the invitee.');
  }

  const supabase = await resolveClient();
  const rawToken = await resolveRandomToken();
  const tokenHash = await resolveSha256Hex(rawToken);
  const rpcRole = params.role === 'member' ? 'admin' : 'viewer';

  let expectedVersion = verified.membershipVersion;
  let resultRecord: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.rpc('debtfree_create_household_invitation', {
      p_household_id: verified.householdId,
      p_expected_membership_version: expectedVersion,
      p_invitee_email: email,
      p_role: rpcRole,
      p_token_hash: tokenHash,
    });
    const record = asRecord(data);
    if (error || !record) {
      throw new Error(formatRpcError(error, 'Could not create household invitation.'));
    }
    if (record.status === 'membership_version_conflict' && attempt === 0) {
      expectedVersion = requirePositiveVersionString(record.membershipVersion);
      continue;
    }
    if (record.status !== 'created') {
      throw new Error('Household membership changed while creating the invitation. Refresh and try again.');
    }
    resultRecord = record;
    break;
  }

  if (!resultRecord || typeof resultRecord.invitationId !== 'string') {
    throw new Error('Could not confirm the new household invitation.');
  }

  const invitationId = resultRecord.invitationId;
  const deliveryResult = await deliverInvitationEmail(supabase, verified.householdId, invitationId, rawToken);

  return {
    invitationId,
    householdId: String(resultRecord.householdId ?? verified.householdId),
    role: normalizeInviteRole(resultRecord.role),
    expiresAt: String(resultRecord.expiresAt ?? ''),
    membershipVersion: requirePositiveVersionString(resultRecord.membershipVersion),
    rawToken,
    inviteUrl: buildHouseholdInviteUrl(rawToken),
    inviteWebUrl: buildHouseholdInviteWebUrl(rawToken),
    deliveryState: deliveryResult.deliveryState,
    delivery: deliveryResult.delivery,
  };
}

export async function rotateHouseholdInvitation(
  session: Session,
  context: HouseholdContext,
  invitationId: string,
): Promise<CreatedOrRotatedInviteResult> {
  const verified = assertSignedInContext(session, context);
  if (verified.role !== 'owner') {
    throw new Error('Only the household owner can resend or rotate invitations.');
  }
  const supabase = await resolveClient();
  const rawToken = await resolveRandomToken();
  const tokenHash = await resolveSha256Hex(rawToken);

  const { data, error } = await supabase.rpc('debtfree_rotate_household_invitation', {
    p_household_id: verified.householdId,
    p_invitation_id: invitationId,
    p_expected_membership_version: verified.membershipVersion,
    p_token_hash: tokenHash,
  });
  const record = asRecord(data);
  if (error || !record || record.status !== 'rotated' || typeof record.invitationId !== 'string') {
    throw new Error(formatRpcError(error, 'Could not refresh household invitation.'));
  }

  const deliveryResult = await deliverInvitationEmail(supabase, verified.householdId, record.invitationId, rawToken);

  return {
    invitationId: record.invitationId,
    householdId: String(record.householdId ?? verified.householdId),
    role: normalizeInviteRole(record.role),
    expiresAt: String(record.expiresAt ?? ''),
    membershipVersion: requirePositiveVersionString(record.membershipVersion),
    rawToken,
    inviteUrl: buildHouseholdInviteUrl(rawToken),
    inviteWebUrl: buildHouseholdInviteWebUrl(rawToken),
    deliveryState: deliveryResult.deliveryState,
    delivery: deliveryResult.delivery,
  };
}

export async function cancelHouseholdInvitation(
  session: Session,
  context: HouseholdContext,
  invitationId: string,
): Promise<{ membershipVersion: string }> {
  const verified = assertSignedInContext(session, context);
  if (verified.role !== 'owner') {
    throw new Error('Only the household owner can revoke invitations.');
  }
  const supabase = await resolveClient();
  const { data, error } = await supabase.rpc('debtfree_cancel_household_invitation', {
    p_household_id: verified.householdId,
    p_invitation_id: invitationId,
    p_expected_membership_version: verified.membershipVersion,
  });
  const record = asRecord(data);
  if (error || !record || record.status !== 'revoked') {
    throw new Error(formatRpcError(error, 'Could not revoke invitation.'));
  }
  return {
    membershipVersion: requirePositiveVersionString(record.membershipVersion),
  };
}

export async function acceptHouseholdInvitation(
  session: Session,
  rawTokenOrUrl: string,
): Promise<AcceptHouseholdInviteResult> {
  if (!session?.user?.id) {
    throw new Error('Sign in before accepting a household invitation.');
  }
  const rawToken = parseHouseholdInviteInput(rawTokenOrUrl);
  if (!rawToken) {
    throw new Error('Enter a valid DebtFree invite link or invite code.');
  }
  const supabase = await resolveClient();
  const tokenHash = await resolveSha256Hex(rawToken);
  const { data, error } = await supabase.rpc('debtfree_accept_household_invitation', {
    p_token_hash: tokenHash,
  });
  const record = asRecord(data);
  if (error || !record || record.status !== 'accepted' || typeof record.householdId !== 'string') {
    throw new Error(formatRpcError(error, 'Could not accept household invitation.'));
  }
  if (record.userId !== session.user.id) {
    throw new Error('Invitation acceptance did not match the signed-in account.');
  }
  return {
    userId: session.user.id,
    householdId: record.householdId,
    role: normalizeHouseholdRole(record.role),
    membershipVersion: requirePositiveVersionString(record.membershipVersion),
  };
}

export async function listHouseholdMembers(
  session: Session,
  context: HouseholdContext,
): Promise<{ householdId: string; membershipVersion: string; members: HouseholdMemberSummary[] }> {
  const verified = assertSignedInContext(session, context);
  const supabase = await resolveClient();
  const { data, error } = await supabase.rpc('debtfree_list_household_members', {
    p_household_id: verified.householdId,
    p_expected_membership_version: verified.membershipVersion,
  });
  const record = asRecord(data);
  if (error || !record || record.status !== 'ok' || !Array.isArray(record.members)) {
    throw new Error(formatRpcError(error, 'Could not load household members.'));
  }
  return {
    householdId: String(record.householdId ?? verified.householdId),
    membershipVersion: requirePositiveVersionString(record.membershipVersion),
    members: record.members.map(item => {
      const row = asRecord(item) ?? {};
      return {
        userId: String(row.userId ?? ''),
        role: normalizeHouseholdRole(row.role),
        emailHint: typeof row.emailHint === 'string' && row.emailHint.trim() ? row.emailHint : null,
        isSelf: Boolean(row.isSelf),
        joinedAt: String(row.joinedAt ?? ''),
      };
    }),
  };
}

export async function updateHouseholdMemberRole(
  session: Session,
  context: HouseholdContext,
  params: { memberUserId: string; role: HouseholdInvitationRole },
): Promise<{ userId: string; role: HouseholdInvitationRole; membershipVersion: string }> {
  const verified = assertSignedInContext(session, context);
  if (verified.role !== 'owner') {
    throw new Error('Only the household owner can change member roles.');
  }
  const supabase = await resolveClient();
  const { data, error } = await supabase.rpc('debtfree_update_household_member_role', {
    p_household_id: verified.householdId,
    p_expected_membership_version: verified.membershipVersion,
    p_member_user_id: params.memberUserId,
    p_role: params.role === 'member' ? 'admin' : 'viewer',
  });
  const record = asRecord(data);
  if (error || !record || record.status !== 'updated') {
    throw new Error(formatRpcError(error, 'Could not update member role.'));
  }
  return {
    userId: String(record.userId ?? params.memberUserId),
    role: normalizeInviteRole(record.role),
    membershipVersion: requirePositiveVersionString(record.membershipVersion),
  };
}

export async function removeHouseholdMember(
  session: Session,
  context: HouseholdContext,
  memberUserId: string,
): Promise<{ userId: string; membershipVersion: string }> {
  const verified = assertSignedInContext(session, context);
  if (verified.role !== 'owner') {
    throw new Error('Only the household owner can remove members.');
  }
  const supabase = await resolveClient();
  const { data, error } = await supabase.rpc('debtfree_remove_household_member', {
    p_household_id: verified.householdId,
    p_expected_membership_version: verified.membershipVersion,
    p_member_user_id: memberUserId,
  });
  const record = asRecord(data);
  if (error || !record || record.status !== 'removed') {
    throw new Error(formatRpcError(error, 'Could not remove member.'));
  }
  return {
    userId: String(record.userId ?? memberUserId),
    membershipVersion: requirePositiveVersionString(record.membershipVersion),
  };
}

export async function leaveHousehold(
  session: Session,
  context: HouseholdContext,
): Promise<{ householdId: string; userId: string; membershipVersion: string }> {
  const verified = assertSignedInContext(session, context);
  if (verified.role === 'owner') {
    throw new Error('Transfer ownership to another member before leaving this household.');
  }
  const pending = await resolvePendingFinanceSummary(verified);
  if (pending.total > 0) {
    throw new Error('Resolve or sync pending offline finance writes in this household before leaving.');
  }
  const supabase = await resolveClient();
  const { data, error } = await supabase.rpc('debtfree_leave_household', {
    p_household_id: verified.householdId,
    p_expected_membership_version: verified.membershipVersion,
  });
  const record = asRecord(data);
  if (error || !record || record.status !== 'left') {
    throw new Error(formatRpcError(error, 'Could not leave household.'));
  }
  return {
    householdId: String(record.householdId ?? verified.householdId),
    userId: String(record.userId ?? verified.userId),
    membershipVersion: requirePositiveVersionString(record.membershipVersion),
  };
}

export async function transferHouseholdOwnership(
  session: Session,
  context: HouseholdContext,
  newOwnerUserId: string,
): Promise<{ householdId: string; previousOwnerUserId: string; newOwnerUserId: string; membershipVersion: string }> {
  const verified = assertSignedInContext(session, context);
  if (verified.role !== 'owner') {
    throw new Error('Only the current owner can transfer ownership.');
  }
  const supabase = await resolveClient();
  const { data, error } = await supabase.rpc('debtfree_transfer_household_ownership', {
    p_household_id: verified.householdId,
    p_expected_membership_version: verified.membershipVersion,
    p_new_owner_user_id: newOwnerUserId,
  });
  const record = asRecord(data);
  if (error || !record || record.status !== 'transferred') {
    throw new Error(formatRpcError(error, 'Could not transfer household ownership.'));
  }
  return {
    householdId: String(record.householdId ?? verified.householdId),
    previousOwnerUserId: String(record.previousOwnerUserId ?? verified.userId),
    newOwnerUserId: String(record.newOwnerUserId ?? newOwnerUserId),
    membershipVersion: requirePositiveVersionString(record.membershipVersion),
  };
}

export async function switchVerifiedHousehold(
  session: Session,
  targetHouseholdId: string,
  currentContext?: HouseholdContext | null,
): Promise<SwitchHouseholdResult> {
  const userId = session?.user?.id;
  if (!userId) throw new Error('Sign in before switching households.');
  if (currentContext) {
    const verifiedCurrent = parseHouseholdContext(userId, currentContext);
    if (verifiedCurrent.householdId !== targetHouseholdId) {
      const pending = await resolvePendingFinanceSummary(verifiedCurrent);
      if (pending.total > 0) {
        throw new Error('Resolve or sync pending offline finance changes in the current household before switching households.');
      }
    }
  }

  const summaries = await resolveListVerifiedHouseholdContexts(session);
  const selected = summaries.find(summary => summary.householdId === targetHouseholdId);
  if (!selected) {
    throw new Error('That household is no longer an active membership for your account.');
  }

  const onboardingData = await resolveLoadUserOnboardingData(session, { householdId: selected.householdId });
  return {
    selected,
    summaries,
    onboardingData,
  };
}

function isConclusiveRestoreRejection(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  const msg = error.message ?? '';
  if (code === '55P03' || code === '40001' || msg.includes('RESTORE_BUSY')) {
    return false;
  }
  if (['22023', '23503', '23505', '23514', '42501', '0A000', 'P0001', 'P0002'].includes(code)) {
    return true;
  }
  return msg.includes('RESTORE_');
}

export function createSupabaseBackupRestoreAdapter(options: {
  session: Session;
  getHouseholdContext: () => HouseholdContext | null;
  checkpoints: RestoreAdapter['checkpoints'];
}): RestoreAdapter {
  return {
    async getAuthenticatedOwner(): Promise<BackupOwner | null> {
      const userId = options.session?.user?.id;
      const context = options.getHouseholdContext();
      if (!userId || !context) return null;
      const verified = parseHouseholdContext(userId, context);
      return {
        userId: verified.userId,
        householdId: verified.householdId,
        membershipVersion: verified.membershipVersion,
        role: verified.role,
      };
    },
    async readCurrentSnapshot(owner: BackupOwner): Promise<SnapshotBaseline> {
      const supabase = await resolveClient();
      const { data, error } = await supabase.rpc('debtfree_read_restore_baseline', {
        p_household_id: owner.householdId,
        p_expected_membership_version: owner.membershipVersion ?? null,
      });
      const record = asRecord(data);
      if (error || !record || !record.snapshot || typeof record.baselineToken !== 'string') {
        throw new Error(formatRpcError(error, 'Could not load current household snapshot for restore.'));
      }
      return {
        snapshot: record.snapshot as NativeBackup,
        token: record.baselineToken,
      };
    },
    async findRestoreReceipt(operationId: string, owner?: BackupOwner): Promise<RestoreReceipt | null> {
      const context = owner ?? options.getHouseholdContext();
      if (!context) return null;
      const supabase = await resolveClient();
      const { data, error } = await supabase.rpc('debtfree_find_restore_receipt', {
        p_household_id: context.householdId,
        p_operation_id: operationId,
      });
      if (error) {
        throw new Error(formatRpcError(error, 'Could not verify restore receipt.'));
      }
      if (!data) return null;
      const record = asRecord(data);
      if (!record || typeof record.operationId !== 'string' || typeof record.payloadFingerprint !== 'string' || !record.restoredSnapshot) {
        return null;
      }
      return {
        operationId: record.operationId,
        payloadFingerprint: record.payloadFingerprint,
        restoredSnapshot: record.restoredSnapshot as NativeBackup,
      };
    },
    async restoreSnapshot(request: RestoreRpcRequest): Promise<RestoreReceipt> {
      const supabase = await resolveClient();
      const { data, error } = await supabase.rpc('debtfree_apply_snapshot_restore', {
        p_household_id: request.householdId,
        p_expected_membership_version: request.expectedMembershipVersion ?? null,
        p_operation_id: request.operationId,
        p_expected_baseline_token: request.expectedBaselineToken,
        p_payload_fingerprint: request.payloadFingerprint,
        p_mode: request.mode,
        p_accepted_conflict_ids: request.acceptedConflictIds,
        p_kept_current_conflict_ids: request.keptCurrentConflictIds,
        p_snapshot: request.snapshot,
        p_confirm_full_replacement: request.confirmFullReplacement,
      });
      if (error) {
        const message = formatRpcError(error, 'Household restore failed.');
        if (isConclusiveRestoreRejection(error)) {
          throw new RestoreRejectedError(message);
        }
        throw new Error(message);
      }
      const record = asRecord(data);
      if (!record || typeof record.operationId !== 'string' || typeof record.payloadFingerprint !== 'string' || !record.restoredSnapshot) {
        throw new Error('Restore response did not contain a valid server receipt.');
      }
      return {
        operationId: record.operationId,
        payloadFingerprint: record.payloadFingerprint,
        restoredSnapshot: record.restoredSnapshot as NativeBackup,
      };
    },
    checkpoints: options.checkpoints,
  };
}
