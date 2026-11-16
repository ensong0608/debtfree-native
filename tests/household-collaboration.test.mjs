import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOUSEHOLD_INVITE_SCHEME,
  __configureHouseholdCollaborationForTests,
  __resetHouseholdCollaborationForTests,
  acceptHouseholdInvitation,
  buildHouseholdInviteUrl,
  buildHouseholdInviteWebUrl,
  cancelHouseholdInvitation,
  createHouseholdInvitation,
  createSupabaseBackupRestoreAdapter,
  leaveHousehold,
  listHouseholdInvitations,
  listHouseholdMembers,
  parseHouseholdInviteInput,
  removeHouseholdMember,
  rotateHouseholdInvitation,
  switchVerifiedHousehold,
  transferHouseholdOwnership,
  updateHouseholdMemberRole,
} from '../src/household-collaboration.ts';
import { RestoreRejectedError } from '../src/finance/backup-recovery.ts';

const OWNER_SESSION = { user: { id: 'user-owner', email: 'owner@example.com' } };
const MEMBER_SESSION = { user: { id: 'user-member', email: 'member@example.com' } };
const OWNER_CONTEXT = {
  userId: 'user-owner',
  householdId: 'hh-1',
  role: 'owner',
  membershipVersion: '5',
};
const MEMBER_CONTEXT = {
  userId: 'user-member',
  householdId: 'hh-1',
  role: 'member',
  membershipVersion: '5',
};
const VIEWER_CONTEXT = {
  userId: 'user-member',
  householdId: 'hh-1',
  role: 'viewer',
  membershipVersion: '5',
};
const VALID_TOKEN = 'a'.repeat(64);

afterEach(() => {
  __resetHouseholdCollaborationForTests();
});

test('invite URL building and parsing round-trips links and raw tokens cleanly', () => {
  const url = buildHouseholdInviteUrl(VALID_TOKEN);
  assert.equal(url, `${HOUSEHOLD_INVITE_SCHEME}://invite?token=${VALID_TOKEN}`);
  assert.equal(parseHouseholdInviteInput(url), VALID_TOKEN);
  assert.equal(parseHouseholdInviteInput(`${HOUSEHOLD_INVITE_SCHEME}://invite?code=${VALID_TOKEN}`), VALID_TOKEN);
  assert.equal(parseHouseholdInviteInput(`  ${VALID_TOKEN}  `), VALID_TOKEN);

  const webUrl = buildHouseholdInviteWebUrl(VALID_TOKEN);
  assert.equal(
    webUrl,
    `https://bitless-household-invite.ensong608.chatgpt.site/#token=${VALID_TOKEN}`
  );
  assert.equal(parseHouseholdInviteInput(webUrl), VALID_TOKEN);
  assert.equal(
    parseHouseholdInviteInput(`https://bitepxsdujceoszbldhd.supabase.co/functions/v1/send-household-invitation?code=${VALID_TOKEN}`),
    VALID_TOKEN
  );
  assert.equal(
    parseHouseholdInviteInput(`https://app.debtfree.com/invite?token=${VALID_TOKEN}`),
    VALID_TOKEN
  );

  assert.equal(parseHouseholdInviteInput(''), null);
  assert.equal(parseHouseholdInviteInput('short-token'), null);
  assert.equal(parseHouseholdInviteInput('https://evil.example/invite?token=' + VALID_TOKEN), null);
  assert.equal(parseHouseholdInviteInput(`${HOUSEHOLD_INVITE_SCHEME}://other?token=${VALID_TOKEN}`), null);
  assert.throws(() => buildHouseholdInviteUrl('too-short'), /Invalid invite token/);
  assert.throws(() => buildHouseholdInviteWebUrl('too-short'), /Invalid invite token/);
});

test('createHouseholdInvitation retries once on membership_version_conflict and maps roles cleanly', async () => {
  const rpcCalls = [];
  let createCalls = 0;

  __configureHouseholdCollaborationForTests({
    randomToken: async () => VALID_TOKEN,
    sha256Hex: async raw => `sha256:${raw}`,
    getClient: () => ({
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        createCalls += 1;
        if (createCalls === 1) {
          return { data: { status: 'membership_version_conflict', membershipVersion: 6 }, error: null };
        }
        return {
          data: {
            status: 'created',
            invitationId: 'inv-1',
            householdId: 'hh-1',
            role: 'admin',
            expiresAt: '2026-12-01T00:00:00Z',
            membershipVersion: 7,
          },
          error: null,
        };
      },
      functions: {
        invoke: async () => ({ data: { success: true }, error: null }),
      },
    }),
  });

  const result = await createHouseholdInvitation(OWNER_SESSION, OWNER_CONTEXT, {
    inviteeEmail: '  Partner@Example.com ',
    role: 'member',
  });

  assert.equal(rpcCalls.length, 2);
  assert.equal(rpcCalls[0].args.p_expected_membership_version, '5');
  assert.equal(rpcCalls[1].args.p_expected_membership_version, '6');
  assert.equal(rpcCalls[1].args.p_invitee_email, 'partner@example.com');
  assert.equal(rpcCalls[1].args.p_role, 'admin');
  assert.equal(rpcCalls[1].args.p_token_hash, `sha256:${VALID_TOKEN}`);
  assert.equal(result.role, 'member');
  assert.equal(result.membershipVersion, '7');
  assert.equal(result.rawToken, VALID_TOKEN);
  assert.equal(result.deliveryState, 'sent');
  assert.equal(result.delivery.status, 'sent');
});

test('createHouseholdInvitation returns shareable link even when email delivery is unconfigured (503)', async () => {
  __configureHouseholdCollaborationForTests({
    randomToken: async () => VALID_TOKEN,
    sha256Hex: async () => 'hash-1',
    getClient: () => ({
      rpc: async () => ({
        data: {
          status: 'created',
          invitationId: 'inv-2',
          householdId: 'hh-1',
          role: 'viewer',
          expiresAt: '2026-12-01T00:00:00Z',
          membershipVersion: 6,
        },
        error: null,
      }),
      functions: {
        invoke: async () => ({
          data: { error: 'Resend not configured', deliveryState: 'prepared' },
          error: { message: 'FunctionsHttpError', context: { status: 503 } },
        }),
      },
    }),
  });

  const result = await createHouseholdInvitation(OWNER_SESSION, OWNER_CONTEXT, {
    inviteeEmail: 'advisor@example.com',
    role: 'viewer',
  });

  assert.equal(result.role, 'viewer');
  assert.equal(result.deliveryState, 'prepared');
  assert.equal(result.delivery.status, 'unconfigured');
  assert.equal(result.inviteUrl, `${HOUSEHOLD_INVITE_SCHEME}://invite?token=${VALID_TOKEN}`);
});

test('non-owners cannot create, list, rotate, or cancel invitations', async () => {
  await assert.rejects(
    () => createHouseholdInvitation(MEMBER_SESSION, MEMBER_CONTEXT, { inviteeEmail: 'x@y.com', role: 'viewer' }),
    /Only the household owner/,
  );
  await assert.rejects(() => listHouseholdInvitations(MEMBER_SESSION, MEMBER_CONTEXT), /Only the household owner/);
  await assert.rejects(() => rotateHouseholdInvitation(MEMBER_SESSION, VIEWER_CONTEXT, 'inv-1'), /Only the household owner/);
  await assert.rejects(() => cancelHouseholdInvitation(MEMBER_SESSION, MEMBER_CONTEXT, 'inv-1'), /Only the household owner/);
});

test('rotate, list, cancel, and accept invitation handle RPC payloads and error mapping', async () => {
  __configureHouseholdCollaborationForTests({
    randomToken: async () => VALID_TOKEN,
    sha256Hex: async raw => `h:${raw}`,
    getClient: () => ({
      rpc: async (fn, args) => {
        if (fn === 'debtfree_list_household_invitations') {
          return {
            data: {
              status: 'ok',
              householdId: 'hh-1',
              membershipVersion: 5,
              invitations: [
                {
                  invitationId: 'inv-1',
                  emailHint: 'p***@example.com',
                  role: 'admin',
                  expiresAt: '2026-12-01T00:00:00Z',
                  expired: false,
                  deliveryState: 'sent',
                },
              ],
            },
            error: null,
          };
        }
        if (fn === 'debtfree_rotate_household_invitation') {
          return {
            data: {
              status: 'rotated',
              invitationId: args.p_invitation_id,
              householdId: 'hh-1',
              role: 'viewer',
              expiresAt: '2026-12-02T00:00:00Z',
              membershipVersion: 6,
            },
            error: null,
          };
        }
        if (fn === 'debtfree_cancel_household_invitation') {
          return { data: { status: 'revoked', membershipVersion: 7 }, error: null };
        }
        if (fn === 'debtfree_accept_household_invitation') {
          assert.equal(args.p_token_hash, `h:${VALID_TOKEN}`);
          return {
            data: {
              status: 'accepted',
              userId: MEMBER_SESSION.user.id,
              householdId: 'hh-1',
              role: 'admin',
              membershipVersion: 8,
            },
            error: null,
          };
        }
        return { data: null, error: { message: 'unexpected rpc' } };
      },
      functions: {
        invoke: async () => {
          throw new Error('network down');
        },
      },
    }),
  });

  const listed = await listHouseholdInvitations(OWNER_SESSION, OWNER_CONTEXT);
  assert.equal(listed.invitations.length, 1);
  assert.equal(listed.invitations[0].role, 'member');

  const rotated = await rotateHouseholdInvitation(OWNER_SESSION, OWNER_CONTEXT, 'inv-1');
  assert.equal(rotated.deliveryState, 'uncertain');
  assert.equal(rotated.delivery.status, 'failed');

  const canceled = await cancelHouseholdInvitation(OWNER_SESSION, OWNER_CONTEXT, 'inv-1');
  assert.equal(canceled.membershipVersion, '7');

  const accepted = await acceptHouseholdInvitation(MEMBER_SESSION, buildHouseholdInviteUrl(VALID_TOKEN));
  assert.equal(accepted.role, 'member');
  assert.equal(accepted.membershipVersion, '8');

  await assert.rejects(() => acceptHouseholdInvitation(MEMBER_SESSION, 'not-a-valid-link'), /valid DebtFree invite/);
});

test('member roster, role update, removal, ownership transfer, and leaving enforce safety rules', async () => {
  const calls = [];
  __configureHouseholdCollaborationForTests({
    getPendingFinanceSummary: async () => ({ total: 0, conflict: 0, needs_review: 0, rejected: 0 }),
    getClient: () => ({
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        if (fn === 'debtfree_list_household_members') {
          return {
            data: {
              status: 'ok',
              householdId: 'hh-1',
              membershipVersion: 5,
              members: [
                { userId: 'user-owner', role: 'owner', emailHint: 'o***@example.com', isSelf: true, joinedAt: '2026-01-01' },
                { userId: 'user-member', role: 'admin', emailHint: 'm***@example.com', isSelf: false, joinedAt: '2026-02-01' },
              ],
            },
            error: null,
          };
        }
        if (fn === 'debtfree_update_household_member_role') {
          return { data: { status: 'updated', userId: args.p_member_user_id, role: args.p_role, membershipVersion: 6 }, error: null };
        }
        if (fn === 'debtfree_remove_household_member') {
          return { data: { status: 'removed', userId: args.p_member_user_id, membershipVersion: 7 }, error: null };
        }
        if (fn === 'debtfree_transfer_household_ownership') {
          return {
            data: {
              status: 'transferred',
              householdId: 'hh-1',
              previousOwnerUserId: 'user-owner',
              newOwnerUserId: args.p_new_owner_user_id,
              membershipVersion: 8,
            },
            error: null,
          };
        }
        if (fn === 'debtfree_leave_household') {
          return { data: { status: 'left', householdId: 'hh-1', userId: 'user-member', membershipVersion: 9 }, error: null };
        }
        return { data: null, error: { message: 'unexpected rpc' } };
      },
    }),
  });

  const members = await listHouseholdMembers(OWNER_SESSION, OWNER_CONTEXT);
  assert.equal(members.members[1].role, 'member');

  const updated = await updateHouseholdMemberRole(OWNER_SESSION, OWNER_CONTEXT, { memberUserId: 'user-member', role: 'viewer' });
  assert.equal(updated.role, 'viewer');

  const removed = await removeHouseholdMember(OWNER_SESSION, OWNER_CONTEXT, 'user-member');
  assert.equal(removed.membershipVersion, '7');

  const transferred = await transferHouseholdOwnership(OWNER_SESSION, OWNER_CONTEXT, 'user-member');
  assert.equal(transferred.newOwnerUserId, 'user-member');

  await assert.rejects(() => leaveHousehold(OWNER_SESSION, OWNER_CONTEXT), /Transfer ownership/);
  const left = await leaveHousehold(MEMBER_SESSION, MEMBER_CONTEXT);
  assert.equal(left.membershipVersion, '9');
  assert.equal(calls.length, 5);
});

test('leaveHousehold and switchVerifiedHousehold block when current household has unresolved pending finance writes', async () => {
  __configureHouseholdCollaborationForTests({
    getPendingFinanceSummary: async () => ({ total: 2, conflict: 1, needs_review: 1, rejected: 0 }),
  });

  await assert.rejects(() => leaveHousehold(MEMBER_SESSION, MEMBER_CONTEXT), /Resolve or sync pending offline finance writes/);
  await assert.rejects(() => switchVerifiedHousehold(MEMBER_SESSION, 'hh-2', MEMBER_CONTEXT), /Resolve or sync pending offline finance changes/);
});

test('switchVerifiedHousehold verifies memberships and prepares a loaded switch without persisting a selection', async () => {
  const savedHints = [];
  const hh1Summary = { userId: 'user-member', householdId: 'hh-1', role: 'member', membershipVersion: '5', householdName: 'Home', currencyCode: 'USD' };
  const hh2Summary = { userId: 'user-member', householdId: 'hh-2', role: 'viewer', membershipVersion: '2', householdName: 'Shared', currencyCode: 'CAD' };

  __configureHouseholdCollaborationForTests({
    getPendingFinanceSummary: async () => ({ total: 0, conflict: 0, needs_review: 0, rejected: 0 }),
    listVerifiedHouseholdContexts: async () => [hh1Summary, hh2Summary],
    saveHouseholdSelectionHint: async (userId, householdId) => {
      savedHints.push({ userId, householdId });
    },
    loadUserOnboardingData: async (_session, options) => ({
      userId: 'user-member',
      householdId: options?.householdId ?? 'hh-2',
      householdName: 'Shared',
      householdContext: hh2Summary,
    }),
  });

  const result = await switchVerifiedHousehold(MEMBER_SESSION, 'hh-2', MEMBER_CONTEXT);
  assert.equal(result.selected.householdId, 'hh-2');
  assert.equal(result.onboardingData.householdId, 'hh-2');
  assert.deepEqual(savedHints, []);

  await assert.rejects(() => switchVerifiedHousehold(MEMBER_SESSION, 'hh-missing', MEMBER_CONTEXT), /no longer an active membership/);
});

test('failed target load cannot persist a household selection', async () => {
  const savedHints = [];
  __configureHouseholdCollaborationForTests({
    getPendingFinanceSummary: async () => ({ total: 0 }),
    listVerifiedHouseholdContexts: async () => [{ ...MEMBER_CONTEXT, householdId: 'hh-2', householdName: 'Shared', currencyCode: 'USD' }],
    saveHouseholdSelectionHint: async (...args) => { savedHints.push(args); },
    loadUserOnboardingData: async () => { throw new Error('target load failed'); },
  });
  await assert.rejects(switchVerifiedHousehold(MEMBER_SESSION, 'hh-2', MEMBER_CONTEXT), /target load failed/);
  assert.deepEqual(savedHints, []);
});

test('createSupabaseBackupRestoreAdapter distinguishes conclusive rejections from retryable restore failures', async () => {
  let nextError = null;
  __configureHouseholdCollaborationForTests({
    getClient: () => ({
      rpc: async () => {
        if (nextError) return { data: null, error: nextError };
        return {
          data: {
            operationId: 'op-1',
            payloadFingerprint: 'fp-1',
            restoredSnapshot: { schemaVersion: 1 },
          },
          error: null,
        };
      },
    }),
  });

  const adapter = createSupabaseBackupRestoreAdapter({
    session: OWNER_SESSION,
    getHouseholdContext: () => OWNER_CONTEXT,
    checkpoints: {
      load: async () => null,
      save: async () => {},
      clear: async () => {},
    },
  });

  const request = {
    householdId: 'hh-1',
    expectedMembershipVersion: '5',
    operationId: 'op-1',
    expectedBaselineToken: 'base-1',
    payloadFingerprint: 'fp-1',
    mode: 'merge',
    acceptedConflictIds: [],
    keptCurrentConflictIds: [],
    snapshot: { schemaVersion: 1 },
    confirmFullReplacement: false,
  };

  nextError = { code: '42501', message: 'Only owner can restore' };
  await assert.rejects(() => adapter.restoreSnapshot(request), RestoreRejectedError);

  nextError = { code: '55P03', message: 'RESTORE_BUSY' };
  await assert.rejects(
    () => adapter.restoreSnapshot(request),
    err => err instanceof Error && !(err instanceof RestoreRejectedError),
  );

  nextError = null;
  const receipt = await adapter.restoreSnapshot(request);
  assert.equal(receipt.operationId, 'op-1');
});
