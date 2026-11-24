import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

type JsonRecord = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseRequestBody(value: unknown): {
  householdId: string;
  invitationId: string;
  rawToken: string;
} | null {
  if (!isRecord(value)) return null;
  const allowed = new Set(['householdId', 'invitationId', 'rawToken']);
  if (Object.keys(value).some(key => !allowed.has(key))) return null;
  const { householdId, invitationId, rawToken } = value;
  if (typeof householdId !== 'string' || householdId.length === 0 || householdId !== householdId.trim() || householdId.length > 120) {
    return null;
  }
  if (typeof invitationId !== 'string' || !uuidPattern.test(invitationId)) return null;
  if (typeof rawToken !== 'string' || rawToken.length < 32 || rawToken !== rawToken.trim() || rawToken.length > 128) {
    return null;
  }
  return { householdId, invitationId: invitationId.toLowerCase(), rawToken };
}

async function sha256Hex(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: jsonHeaders });

  // Legacy links redirect to the configured landing page; GET never accepts an invite.
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const token = (url.searchParams.get('token') ?? url.searchParams.get('code') ?? '').trim();
    const valid = token.length >= 32 && token.length <= 128 && !/\s/.test(token);
    const officialDomain = (Deno.env.get('DFN_OFFICIAL_DOMAIN')?.trim() || 'https://ensong0608.github.io/debtfree-native').replace(/\/+$/, '');
    const target = officialDomain + '/invite/' + (valid ? '#token=' + encodeURIComponent(token) : '');
    return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }

  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });

  const authorization = request.headers.get('Authorization') ?? '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(401, { error: 'A valid signed-in session is required.' });

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return json(400, { error: 'A valid JSON invitation delivery request is required.' });
  }
  const body = parseRequestBody(rawBody);
  if (!body) return json(400, { error: 'The invitation delivery request is invalid.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const adminKey = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') ?? Deno.env.get('INVITATION_FROM_EMAIL');
  if (!supabaseUrl || !anonKey || !adminKey || !resendApiKey || !fromEmail) {
    return json(503, { error: 'Invitation email delivery is not configured.' });
  }

  const admin = createClient(supabaseUrl, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerData.user) {
    return json(401, { error: 'Your signed-in session could not be verified.' });
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: membership, error: memberError } = await callerClient
    .from('household_members')
    .select('role')
    .eq('household_id', body.householdId)
    .eq('user_id', callerData.user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (memberError || membership?.role !== 'owner') {
    return json(403, { error: 'Only the household owner may send household invitations.' });
  }

  const { data: householdRow } = await callerClient
    .from('households')
    .select('name')
    .eq('id', body.householdId)
    .maybeSingle();
  const householdName = typeof householdRow?.name === 'string' && householdRow.name.trim()
    ? householdRow.name.trim()
    : 'Shared Household';

  const tokenHash = await sha256Hex(body.rawToken);
  const { data: deliveryData, error: deliveryError } = await admin.rpc('debtfree_get_household_invitation_delivery', {
    p_invitation_id: body.invitationId,
    p_token_hash: tokenHash,
  });
  if (deliveryError || !isRecord(deliveryData) || deliveryData.householdId !== body.householdId
      || typeof deliveryData.email !== 'string' || !deliveryData.email) {
    return json(409, { error: 'This invitation link is no longer active or was rotated. Create or rotate a fresh invite.' });
  }

  const officialDomain = (Deno.env.get('DFN_OFFICIAL_DOMAIN')?.trim() || 'https://ensong0608.github.io/debtfree-native').replace(/\/+$/, '');
  const webLink = officialDomain + '/invite/#token=' + encodeURIComponent(body.rawToken);
  const deepLink = `com.debtfree.native.test://invite?token=${encodeURIComponent(body.rawToken)}`;
  const roleLabel = deliveryData.role === 'viewer' ? 'Viewer (read-only)' : 'Member (can edit shared finances)';
  const safeHouse = escapeHtml(householdName);
  const safeWebLink = escapeHtml(webLink);
  const safeDeepLink = escapeHtml(deepLink);
  const safeCode = escapeHtml(body.rawToken);

  let deliveryState: 'sent' | 'uncertain' = 'uncertain';
  let providerRejected = false;
  let providerError = '';
  try {
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [deliveryData.email],
        subject: `You are invited to join "${householdName}" on DebtFree`,
        html: [
          `<p>You have been invited to join <strong>${safeHouse}</strong> on DebtFree as a <strong>${escapeHtml(roleLabel)}</strong>.</p>`,
          `<p><a href="${safeWebLink}" style="display:inline-block;background:#22C55E;color:#000;font-weight:bold;padding:12px 20px;text-decoration:none;border-radius:8px;">Accept Household Invitation</a></p>`,
          `<p>Or open the app with this direct link: <a href="${safeDeepLink}">${safeDeepLink}</a></p>`,
          `<p>Or paste this invite code in DebtFree Settings &rarr; Household &rarr; Join a household:</p>`,
          `<p><code style="font-size:14px;background:#f3f4f6;padding:4px 8px;border-radius:4px;">${safeCode}</code></p>`,
          `<p>Note: Joining a shared household switches your active view to that household; your existing household data stays separate and is never merged automatically.</p>`,
        ].join(''),
        text: [
          `You have been invited to join "${householdName}" on DebtFree as ${roleLabel}.`,
          ``,
          `Open in DebtFree: ${webLink}`,
          `Invite code: ${body.rawToken}`,
          ``,
          `Note: Joining a shared household switches your active view to that household; your existing household data stays separate and is never merged automatically.`,
        ].join('\n'),
      }),
    });
    if (emailResponse.ok) {
      deliveryState = 'sent';
    } else {
      if (emailResponse.status >= 400 && emailResponse.status < 500) {
        providerRejected = true;
      }
      try {
        const errorJson = await emailResponse.json();
        providerError = errorJson.message || errorJson.error || JSON.stringify(errorJson);
      } catch {
        providerError = await emailResponse.text();
      }
      console.error(`Resend API rejection [${emailResponse.status}]:`, providerError);
    }
  } catch (fetchErr) {
    providerError = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    deliveryState = 'uncertain';
  }

  const { data: proofData, error: proofError } = await callerClient.rpc('debtfree_set_household_invitation_delivery', {
    p_household_id: body.householdId,
    p_invitation_id: body.invitationId,
    p_delivery_proof: `${tokenHash}:${deliveryState}`,
  });
  if (proofError || !isRecord(proofData)) {
    return json(503, { error: 'Invitation delivery could not be recorded cleanly. Refresh invitations before retrying.' });
  }

  if (deliveryState !== 'sent') {
    return json(providerRejected ? 502 : 503, {
      success: false,
      deliveryState,
      invitationId: body.invitationId,
      householdId: body.householdId,
      providerError: providerError || undefined,
      error: providerError
        ? `Email provider error: ${providerError}`
        : 'Email delivery could not be confirmed. You can copy the invite link/code or rotate the invitation.',
    });
  }

  return json(200, {
    success: true,
    deliveryState: 'sent',
    invitationId: body.invitationId,
    householdId: body.householdId,
    expiresAt: deliveryData.expiresAt ?? null,
  });
});
