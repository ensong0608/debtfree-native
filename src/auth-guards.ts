export const CALLBACK = 'com.debtfree.native.test://auth/callback';
/** Project reference of the DebtFree web production project. It must never be used by this client. */
export const PRODUCTION_PROJECT_REF = 'acpderotiyoecmwwyfsu';

/**
 * Returns a human-readable reason why the public sandbox configuration is unusable, or null when it is valid.
 * Reasons name variables and rules only; they never echo configured values.
 */
export function sandboxConfigProblem(projectUrl: string, projectRef: string, publishableKey: string): string | null {
  if (!projectUrl || !projectRef || !publishableKey) {
    const missing = [
      !projectUrl && 'EXPO_PUBLIC_SANDBOX_SUPABASE_URL',
      !projectRef && 'EXPO_PUBLIC_SANDBOX_PROJECT_REF',
      !publishableKey && 'EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY',
    ].filter(Boolean);
    return `Missing ${missing.join(', ')}.`;
  }
  if (!/^[a-z0-9-]+$/.test(projectRef)) return 'EXPO_PUBLIC_SANDBOX_PROJECT_REF is not a valid project reference.';
  if (projectRef === PRODUCTION_PROJECT_REF) return 'The production project is not allowed in this test app.';
  let url: URL;
  try { url = new URL(projectUrl); } catch { return 'EXPO_PUBLIC_SANDBOX_SUPABASE_URL is not a valid URL.'; }
  if (url.protocol !== 'https:' || url.hostname !== `${projectRef}.supabase.co` || url.port !== '' ||
      url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search || url.hash) {
    return 'EXPO_PUBLIC_SANDBOX_SUPABASE_URL must be exactly https://<project-ref>.supabase.co for the configured project reference.';
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    return 'EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY must be a publishable (sb_publishable_) key. Secret and legacy keys are rejected.';
  }
  return null;
}

export function isAllowedSandbox(projectUrl: string, projectRef: string, publishableKey: string): boolean {
  return sandboxConfigProblem(projectUrl, projectRef, publishableKey) === null;
}

export type CallbackResult =
  | { kind: 'code'; code: string }
  | { kind: 'error'; reason: 'access_denied' | 'provider' }
  | { kind: 'invalid' };

/** Parses the OAuth redirect. Only the exact app callback carrying exactly one code and no error is accepted. */
export function parseCallback(value: string): CallbackResult {
  let url: URL;
  try { url = new URL(value); } catch { return { kind: 'invalid' }; }
  if (`${url.protocol}//${url.host}${url.pathname}` !== CALLBACK) return { kind: 'invalid' };
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const error = url.searchParams.get('error') ?? fragment.get('error');
  if (error) return { kind: 'error', reason: error === 'access_denied' ? 'access_denied' : 'provider' };
  if (url.hash || url.searchParams.getAll('code').length !== 1) return { kind: 'invalid' };
  const code = url.searchParams.get('code');
  return code ? { kind: 'code', code } : { kind: 'invalid' };
}

export function callbackCode(value: string): string | null {
  const result = parseCallback(value);
  return result.kind === 'code' ? result.code : null;
}

export type AuthFailure = 'network' | 'invalid' | 'unknown';

/**
 * Classifies an auth error without depending on the SDK: network/retryable failures must not delete a stored
 * session, while definitive rejections (revoked, expired, unknown user, malformed token) must.
 */
export function classifyAuthError(error: unknown): AuthFailure {
  if (!error || typeof error !== 'object') return 'unknown';
  const { name, status, code } = error as { name?: string; status?: number; code?: string };
  if (name === 'AuthRetryableFetchError' || name === 'TypeError' || status === 0 || status === 429 ||
      (typeof status === 'number' && status >= 500)) return 'network';
  if (name === 'AuthSessionMissingError' || name === 'AuthInvalidJwtError' || name === 'AuthInvalidTokenResponseError' ||
      code === 'session_not_found' || code === 'user_not_found' || code === 'refresh_token_not_found' ||
      code === 'refresh_token_already_used' || code === 'bad_jwt' ||
      (typeof status === 'number' && status >= 400 && status < 500)) return 'invalid';
  return 'unknown';
}
