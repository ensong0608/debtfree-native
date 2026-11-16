import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

// Supabase's Edge gateway verifies this JWT because verify_jwt is enabled for the function.
// Its subject remains available for an idempotent retry if the account was deleted but the response was lost.
function verifiedSubject(token: string): string | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;
  try {
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { sub?: unknown };
    return typeof payload.sub === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.sub)
      ? payload.sub : null;
  } catch {
    return null;
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });

  const authorization = request.headers.get('Authorization') ?? '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const userId = token ? verifiedSubject(token) : null;
  if (!token || !userId) return json(401, { error: 'A valid signed-in session is required.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const adminKey = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !adminKey) return json(503, { error: 'Account deletion is not configured.' });

  const admin = createClient(supabaseUrl, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  // Confirm that the signed-in caller identifies the same account before any destructive operation.
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  const { data: existing, error: lookupError } = await admin.auth.admin.getUserById(userId);
  if (lookupError && lookupError.status !== 404) return json(503, { error: 'The account could not be checked. Retry later.' });

  if (existing.user) {
    if (callerError || caller.user?.id !== userId) return json(401, { error: 'The signed-in account could not be verified.' });
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      // A response can be lost after deletion. Read back Auth state before reporting uncertainty.
      const { data: afterDelete, error: readbackError } = await admin.auth.admin.getUserById(userId);
      if (readbackError && readbackError.status !== 404) return json(503, { error: 'Deletion could not be confirmed. Retry later.' });
      if (afterDelete.user) return json(503, { error: 'Deletion could not be completed. Your account remains available; retry later.' });
    }
  }

  // Auth deletion cascades debt tombstones atomically; keep this idempotent cleanup as defense in depth.
  const { error: cleanupError } = await admin.from('debtfree_deleted_debt_ids').delete().eq('deleted_user_id', userId);
  if (cleanupError) return json(503, { error: 'The account was deleted, but final data cleanup could not be confirmed. Retry this request.' });

  return json(200, { success: true, deletedUserId: userId });
});
