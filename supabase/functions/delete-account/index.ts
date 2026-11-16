import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

type JsonRecord = Record<string, unknown>;
type AuthReadback = { state: 'present' | 'absent' | 'unknown' };

// The Edge gateway verifies this JWT because verify_jwt remains enabled for
// the function. We decode only its subject; current-user verification uses
// Auth Admin before any fence or dispatch state can be mutated.
function verifiedSubject(token: string): string | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;
  try {
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { sub?: unknown };
    return typeof payload.sub === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.sub)
      ? payload.sub.toLowerCase() : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rpcRecord(value: unknown): JsonRecord | null {
  if (isRecord(value)) return value;
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0])) return value[0];
  return null;
}

function recordOperationId(value: JsonRecord): string | null {
  const operationId = value.operationId ?? value.operation_id ?? value.deletionOperationId ?? value.deletion_operation_id;
  return typeof operationId === 'string' ? operationId.toLowerCase() : null;
}

function recordState(value: JsonRecord): string | null {
  const state = value.state ?? value.status ?? value.deletionState ?? value.deletion_state;
  return typeof state === 'string' ? state.toLowerCase() : null;
}

function operationMatches(value: unknown, operationId: string): JsonRecord | null {
  const record = rpcRecord(value);
  return record && recordOperationId(record) === operationId ? record : null;
}

function parseRequestBody(value: unknown): {
  operationId: string;
  deleteEmptyHouseholdIds: string[];
  expectedMembershipVersions: Record<string, string>;
} | null {
  if (!isRecord(value)) return null;
  const allowed = new Set([
    'operationId',
    'deleteEmptyHouseholdIds',
    'expectedMembershipVersions',
    'pendingCommandsClear',
  ]);
  if (Object.keys(value).some(key => !allowed.has(key))) return null;

  const operationId = value.operationId;
  if (typeof operationId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) return null;
  if (value.pendingCommandsClear !== true) return null;

  const rawHouseholds = value.deleteEmptyHouseholdIds;
  if (!Array.isArray(rawHouseholds) || rawHouseholds.length > 50) return null;
  const deleteEmptyHouseholdIds: string[] = [];
  const seen = new Set<string>();
  for (const householdId of rawHouseholds) {
    if (typeof householdId !== 'string' || householdId.length === 0
        || householdId !== householdId.trim() || householdId.length > 120
        || seen.has(householdId)) return null;
    seen.add(householdId);
    deleteEmptyHouseholdIds.push(householdId);
  }

  const rawVersions = value.expectedMembershipVersions;
  if (!isRecord(rawVersions) || Object.keys(rawVersions).length > 100) return null;
  const expectedMembershipVersions = Object.create(null) as Record<string, string>;
  for (const [householdId, version] of Object.entries(rawVersions)) {
    if (householdId.length === 0 || householdId !== householdId.trim() || householdId.length > 120
        || typeof version !== 'string' || !/^[1-9][0-9]*$/.test(version)) return null;
    expectedMembershipVersions[householdId] = version;
  }
  if (deleteEmptyHouseholdIds.some(id => !Object.hasOwn(expectedMembershipVersions, id))) return null;

  return { operationId: operationId.toLowerCase(), deleteEmptyHouseholdIds, expectedMembershipVersions };
}

async function readAuthUser(admin: ReturnType<typeof createClient>, userId: string): Promise<AuthReadback> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error?.status === 404 || (!error && !data.user)) return { state: 'absent' };
    if (error || !data.user) return { state: 'unknown' };
    return { state: 'present' };
  } catch {
    return { state: 'unknown' };
  }
}

async function markUncertain(admin: ReturnType<typeof createClient>, userId: string, operationId: string, reasonCode: string): Promise<void> {
  try {
    await admin.rpc('debtfree_mark_account_deletion_uncertain', {
      p_account_id: userId,
      p_operation_id: operationId,
      p_reason_code: reasonCode,
    });
  } catch {
    // The durable dispatched state remains fenced if this refinement fails.
  }
}

async function finalize(admin: ReturnType<typeof createClient>, userId: string, operationId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc('debtfree_finalize_account_deletion', {
      p_account_id: userId,
      p_operation_id: operationId,
    });
    if (error) return false;
    const result = operationMatches(data, operationId);
    return !!result && (recordState(result) === 'deleted' || result.success === true);
  } catch {
    return false;
  }
}

function completed(userId: string, operationId: string) {
  return json(200, { success: true, status: 'deleted', operationId, deletedUserId: userId });
}

function pending(operationId: string) {
  return json(202, {
    success: false,
    status: 'pending',
    operationId,
    message: 'Deletion has a dispatched or uncertain Auth outcome. The fence remains in place while it is reconciled.',
  });
}

async function reconcileDispatched(admin: ReturnType<typeof createClient>, userId: string, operationId: string) {
  const readback = await readAuthUser(admin, userId);
  if (readback.state === 'absent' && await finalize(admin, userId, operationId)) {
    return completed(userId, operationId);
  }
  await markUncertain(admin, userId, operationId,
    readback.state === 'present' ? 'auth_user_still_present_after_dispatch' : 'auth_readback_unavailable');
  return pending(operationId);
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: jsonHeaders });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });

  const authorization = request.headers.get('Authorization') ?? '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const userId = token ? verifiedSubject(token) : null;
  if (!token || !userId) return json(401, { error: 'A valid signed-in session is required.' });

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return json(400, { error: 'A valid JSON deletion request is required.' });
  }
  const body = parseRequestBody(rawBody);
  if (!body) return json(400, { error: 'The deletion request is invalid or pending client commands are unresolved.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const adminKey = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !adminKey) return json(503, { error: 'Account deletion is not configured.' });

  const admin = createClient(supabaseUrl, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  // The first attempt requires a live verified Auth user before creating a
  // fence. A deleted-user retry may proceed only through the matching durable
  // dispatched operation below.
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || caller.user?.id?.toLowerCase() !== userId) {
    const readback = await readAuthUser(admin, userId);
    if (readback.state !== 'absent') return json(401, { error: 'The signed-in account could not be verified.' });

    let stateData: unknown;
    let stateError: { message?: string } | null = null;
    try {
      const response = await admin.rpc('debtfree_get_account_deletion_state', {
        p_account_id: userId,
        p_operation_id: body.operationId,
      });
      stateData = response.data;
      stateError = response.error;
    } catch {
      return json(503, { error: 'The deletion operation could not be checked. Retry with the same operation ID.' });
    }
    if (stateError) return json(503, { error: 'The deletion operation could not be checked. Retry with the same operation ID.' });
    const state = operationMatches(stateData, body.operationId);
    if (!state) return json(409, { error: 'No matching account deletion operation was found.' });
    const stateName = recordState(state);
    if (stateName === 'deleted') return completed(userId, body.operationId);
    if (stateName !== 'dispatched' && stateName !== 'uncertain') {
      return json(409, { error: 'The account is absent without a matching dispatched deletion attempt.' });
    }
    if (await finalize(admin, userId, body.operationId)) return completed(userId, body.operationId);
    return pending(body.operationId);
  }

  let preparedData: unknown;
  let prepareError: { code?: string; message?: string } | null = null;
  try {
    const response = await admin.rpc('debtfree_prepare_account_deletion', {
      p_account_id: userId,
      p_operation_id: body.operationId,
      p_delete_empty_household_ids: body.deleteEmptyHouseholdIds,
      p_expected_membership_versions: body.expectedMembershipVersions,
      p_pending_commands_clear: true,
    });
    preparedData = response.data;
    prepareError = response.error;
  } catch {
    return json(503, { error: 'Account deletion could not be prepared. Retry with the same operation ID.' });
  }
  if (prepareError) {
    const status = prepareError.code === '42501' || prepareError.code === '40001' ? 409 : 503;
    return json(status, { error: status === 409
      ? 'Account deletion is not permitted for the current household state.'
      : 'Account deletion could not be prepared. Retry with the same operation ID.' });
  }
  const prepared = operationMatches(preparedData, body.operationId);
  if (!prepared) return json(503, { error: 'The deletion fence could not be confirmed. Retry with the same operation ID.' });
  const preparedState = recordState(prepared);
  if (preparedState === 'deleted') return completed(userId, body.operationId);
  if (preparedState === 'dispatched' || preparedState === 'uncertain') {
    return await reconcileDispatched(admin, userId, body.operationId);
  }
  if (preparedState !== 'prepared' && preparedState !== 'fenced') {
    return json(503, { error: 'The deletion fence returned an unexpected state. Retry with the same operation ID.' });
  }

  // This transaction is the single-dispatch gate. Only the caller that changes
  // fenced -> dispatched receives shouldDispatch=true and may call Auth Admin.
  let dispatchData: unknown;
  let dispatchError: unknown;
  try {
    const response = await admin.rpc('debtfree_mark_account_deletion_dispatched', {
      p_account_id: userId,
      p_operation_id: body.operationId,
    });
    dispatchData = response.data;
    dispatchError = response.error;
  } catch {
    return json(503, { error: 'The Auth deletion attempt could not be confirmed. Retry with the same operation ID.' });
  }
  if (dispatchError) return json(503, { error: 'The Auth deletion attempt could not be recorded. Retry with the same operation ID.' });
  const dispatch = operationMatches(dispatchData, body.operationId);
  if (!dispatch || typeof dispatch.shouldDispatch !== 'boolean') {
    return json(503, { error: 'The Auth deletion dispatch state could not be confirmed. Retry with the same operation ID.' });
  }
  if (!dispatch.shouldDispatch) return await reconcileDispatched(admin, userId, body.operationId);

  // Exactly one Auth Admin dispatch follows the persisted state transition.
  // Never call deleteUser again after this point, regardless of the response.
  let deleteError: unknown;
  try {
    const response = await admin.auth.admin.deleteUser(userId);
    deleteError = response.error;
  } catch {
    deleteError = new Error('Auth deletion response was not received.');
  }
  if (!deleteError) {
    if (await finalize(admin, userId, body.operationId)) return completed(userId, body.operationId);
    return pending(body.operationId);
  }

  const readback = await readAuthUser(admin, userId);
  if (readback.state === 'absent' && await finalize(admin, userId, body.operationId)) {
    return completed(userId, body.operationId);
  }
  await markUncertain(admin, userId, body.operationId,
    readback.state === 'present' ? 'auth_delete_error_user_still_present' : 'auth_delete_error_readback_unavailable');
  return pending(body.operationId);
});
