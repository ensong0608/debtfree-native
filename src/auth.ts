import { SessionVerification } from './identity-verification';
import { createBoundedFetch } from './network-timeout';
import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { CALLBACK, classifyAuthError, isEmailPasswordAuthEnabled, parseCallback, productionConfigProblem, sandboxConfigProblem, validateEmailPasswordInput } from './auth-guards';
import { createChunkedStorage, type KeyValueStore } from './secure-chunks';
export { isEmailPasswordAuthEnabled, validateEmailPasswordInput } from './auth-guards';

// React Native's Hermes runtime does not provide WebCrypto's subtle.digest by default; without it,
// @supabase/auth-js downgrades PKCE from S256 to plain. Wire expo-crypto into globalThis.crypto first.
const runtimeCrypto = (globalThis.crypto ?? {}) as Crypto;
if (typeof runtimeCrypto.getRandomValues !== 'function') {
  runtimeCrypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
    if (array) Crypto.getRandomValues(array as unknown as Uint8Array);
    return array;
  }) as Crypto['getRandomValues'];
}
if (!runtimeCrypto.subtle || typeof runtimeCrypto.subtle.digest !== 'function') {
  (runtimeCrypto as { subtle: SubtleCrypto }).subtle = {
    ...runtimeCrypto.subtle,
    digest: async (algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
      if (name.toUpperCase() !== 'SHA-256') throw new Error(`Unsupported digest algorithm: ${name}`);
      const bytes = ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data);
      return Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
    },
  } as SubtleCrypto;
}
globalThis.crypto = runtimeCrypto;

WebBrowser.maybeCompleteAuthSession();
const callback = CALLBACK;
const productionBuild = process.env.EXPO_PUBLIC_APP_ENV === 'production';
const projectUrl = productionBuild
  ? process.env.EXPO_PUBLIC_MOBILE_PRODUCTION_SUPABASE_URL ?? ''
  : process.env.EXPO_PUBLIC_SANDBOX_SUPABASE_URL ?? '';
const publicKey = productionBuild
  ? process.env.EXPO_PUBLIC_MOBILE_PRODUCTION_SUPABASE_PUBLISHABLE_KEY ?? ''
  : process.env.EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY ?? '';
const allowedRef = productionBuild
  ? process.env.EXPO_PUBLIC_MOBILE_PRODUCTION_PROJECT_REF ?? ''
  : process.env.EXPO_PUBLIC_SANDBOX_PROJECT_REF ?? '';
const configProblem = productionBuild
  ? productionConfigProblem(projectUrl, allowedRef, publicKey)
  : sandboxConfigProblem(projectUrl, allowedRef, publicKey);
const localAcceptanceRequested = __DEV__ && process.env.EXPO_PUBLIC_ENABLE_LOCAL_ACCEPTANCE === 'true';
const configured = configProblem === null && !localAcceptanceRequested;
const signedOutKey = 'debtfree-signed-out';
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const MESSAGES = {
  notConfigured: 'The sign-in service has not been configured yet.',
  offline: 'DebtFree could not reach the sign-in service. Check your connection and try again.',
  storage: "This device's secure storage is unavailable, so DebtFree cannot keep you signed in. Restart the app and try again.",
  unverified: 'The sign-in response could not be verified. Please try again.',
  denied: 'Google sign-in was cancelled or this account is not authorized for DebtFree.',
  providerFailed: 'Google could not complete sign-in. Please try again.',
  exchangeFailed: 'Sign-in could not be completed. Please try again.',
  startFailed: 'Unable to start Google sign-in. Please try again.',
  appleFailed: 'Apple sign-in could not be completed. Please try again.',
} as const;

/** Raised when a stored session could not be verified for a temporary reason; the session is kept, but not shown. */
export class AuthUnavailableError extends Error {}

// Records whether secure storage failed during the current operation so errors can be reported accurately.
let storageFailed = false;
async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { storageFailed = true; throw error; }
}
const secureStore: KeyValueStore = {
  getItem: key => guarded(() => SecureStore.getItemAsync(key)),
  setItem: (key, value) => guarded(() => SecureStore.setItemAsync(key, value, secureOptions)),
  removeItem: key => guarded(() => SecureStore.deleteItemAsync(key)),
};
const storage = createChunkedStorage(secureStore, () => Crypto.randomUUID());

const client: SupabaseClient | null = configured ? createClient(projectUrl, publicKey, {
  global: { fetch: createBoundedFetch(globalThis.fetch.bind(globalThis)) },
  auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'pkce' },
}) : null;
export function isConfigured() { return configured; }
/** Safe, value-free description of what is wrong with the public sandbox configuration. */
export function configurationProblem() { return configProblem; }
export function getSupabaseClient(): SupabaseClient {
  if (!client) throw new Error(MESSAGES.notConfigured);
  return client;
}
function getClient(): SupabaseClient {
  return getSupabaseClient();
}
function failure(error: unknown, fallback: string): Error {
  if (storageFailed) return new Error(MESSAGES.storage);
  return new Error(classifyAuthError(error) === 'network' ? MESSAGES.offline : fallback);
}
const verifiedIdentities = new WeakMap<Session, { user: Session['user']; verifiedAt: number }>();

/** Consume a fresh server verification only within the next load operation. */
export function createSessionVerification(session: Session): SessionVerification {
  const evidence = verifiedIdentities.get(session);
  verifiedIdentities.delete(session);
  return new SessionVerification(session, async () => {
    if (evidence && Date.now() - evidence.verifiedAt < 5000) return evidence.user;
    const { data, error } = await getSupabaseClient().auth.getUser();
    if (error || !data.user) throw new AuthUnavailableError(MESSAGES.offline);
    return data.user;
  });
}

async function clearLocalSession() {
  try { await client?.auth.signOut({ scope: 'local' }); } catch { /* the sign-out lock or next check still protects the UI */ }
}
async function signedOutLockSet(): Promise<boolean> {
  try { return await SecureStore.getItemAsync(signedOutKey) === 'yes'; }
  catch { throw new AuthUnavailableError(MESSAGES.storage); }
}
async function releaseSignedOutLock() {
  try { await SecureStore.deleteItemAsync(signedOutKey); }
  catch {
    // Without releasing the lock the new session would be hidden on the next launch; do not keep it half-active.
    await clearLocalSession();
    throw new Error(MESSAGES.storage);
  }
}

/**
 * Returns the stored session only after the auth server confirms it. Definitive rejections clear the local
 * session; temporary failures throw AuthUnavailableError and keep it so a later retry can succeed.
 */
export async function verifiedSession(): Promise<Session | null> {
  if (!client || await signedOutLockSet()) return null;
  storageFailed = false;
  const { data, error } = await client.auth.getSession();
  if (error) {
    if (classifyAuthError(error) === 'invalid') { await clearLocalSession(); return null; }
    throw new AuthUnavailableError(storageFailed ? MESSAGES.storage : MESSAGES.offline);
  }
  if (!data.session) return null;
  // getUser calls the auth server rather than trusting the stored access token alone.
  const { data: identity, error: identityError } = await client.auth.getUser();
  if (identityError) {
    if (classifyAuthError(identityError) === 'invalid') { await clearLocalSession(); return null; }
    throw new AuthUnavailableError(MESSAGES.offline);
  }
  if (!identity.user || identity.user.id !== data.session.user.id) {
    await clearLocalSession();
    return null;
  }
  const confirmed = { ...data.session, user: identity.user };
  verifiedIdentities.set(confirmed, { user: identity.user, verifiedAt: Date.now() });
  return confirmed;
}

const emailErrors: Partial<Record<ReturnType<typeof classifyAuthError>, string>> = {
  invalid_credentials: 'Incorrect email or password.',
  email_not_confirmed: 'Confirm your email address before signing in.',
  user_already_registered: 'An account with this email already exists. Try signing in.',
  weak_password: 'Choose a stronger password.',
  rate_limit: 'Too many attempts. Please wait and try again.',
};

async function emailAuth(email: string, password: string, signUp: boolean): Promise<{ session: Session | null; needsEmailConfirmation: boolean }> {
  if (!isEmailPasswordAuthEnabled()) throw new Error('Email sign-in is not available.');
  const validation = validateEmailPasswordInput(email, password);
  if (validation) throw new Error(validation);
  const supabase = getClient();
  storageFailed = false;
  let result: Awaited<ReturnType<typeof supabase.auth.signUp>>;
  try {
    result = signUp
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
  } catch (error) { throw failure(error, 'Email sign-in could not be completed. Please try again.'); }
  if (result.error) {
    const category = classifyAuthError(result.error);
    if (result.error.status === 429 && !storageFailed) throw new Error(emailErrors.rate_limit);
    const message = emailErrors[category];
    throw failure(result.error, message ?? 'Email sign-in could not be completed. Please try again.');
  }
  if (!result.data.session) {
    if (signUp) return { session: null, needsEmailConfirmation: true };
    throw new Error(MESSAGES.unverified);
  }
  await releaseSignedOutLock();
  const session = await verifiedSession();
  if (!session) throw new Error(MESSAGES.unverified);
  return { session, needsEmailConfirmation: false };
}

export function signUpWithEmail(email: string, password: string) { return emailAuth(email, password, true); }
export async function signInWithEmail(email: string, password: string): Promise<Session | null> {
  return (await emailAuth(email, password, false)).session;
}

// Authorization codes already submitted in this process; a replayed callback is rejected before reaching the server.
const consumedCodes = new Set<string>();

export async function signInWithGoogle(): Promise<Session | null> {
  const supabase = getClient();
  storageFailed = false;
  let url: string;
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // select_account lets testers switch Google accounts instead of silently reusing the browser's last account.
      options: { redirectTo: callback, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
    });
    if (error || !data.url) throw error ?? new Error('missing url');
    url = data.url;
  } catch (error) { throw failure(error, MESSAGES.startFailed); }
  if (new URL(url).host !== new URL(projectUrl).host) throw new Error(MESSAGES.startFailed);

  const result = await WebBrowser.openAuthSessionAsync(url, callback);
  if (result.type === 'cancel' || result.type === 'dismiss') return null;
  if (result.type !== 'success') throw new Error(MESSAGES.providerFailed);
  const parsed = parseCallback(result.url);
  if (parsed.kind === 'error') throw new Error(parsed.reason === 'access_denied' ? MESSAGES.denied : MESSAGES.providerFailed);
  if (parsed.kind !== 'code' || consumedCodes.has(parsed.code)) throw new Error(MESSAGES.unverified);
  consumedCodes.add(parsed.code);

  storageFailed = false;
  let exchangeError: unknown = null;
  try { exchangeError = (await supabase.auth.exchangeCodeForSession(parsed.code)).error; }
  catch (error) { exchangeError = error; }
  if (exchangeError) throw failure(exchangeError, MESSAGES.exchangeFailed);
  await releaseSignedOutLock();
  return verifiedSession();
}

export async function signInWithApple(): Promise<Session | null> {
  const supabase = getClient();
  if (Platform.OS !== 'ios') return null;
  const nonce = Crypto.randomUUID() + Crypto.randomUUID();
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  try {
    // Apple receives the SHA-256 digest; Supabase receives the raw nonce and checks it against the token claim.
    const result = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL], nonce: digest });
    if (!result.identityToken) throw new Error('Apple sign-in did not return an identity token.');
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: result.identityToken, nonce });
    if (error) throw error;
    // Apple only returns the name on first authorization and never in the identity token (Supabase Apple guide).
    if (result.fullName?.givenName || result.fullName?.familyName) {
      const fullName = [result.fullName.givenName, result.fullName.givenName && result.fullName.familyName ? ' ' : '', result.fullName.familyName].filter(Boolean).join('');
      await supabase.auth.updateUser({ data: { full_name: fullName, given_name: result.fullName.givenName, family_name: result.fullName.familyName } }).catch(() => undefined);
    }
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
    throw new Error(MESSAGES.appleFailed);
  }
  await releaseSignedOutLock();
  return verifiedSession();
}

export async function signOut(): Promise<void> {
  if (!client) return;
  // Attempt both the durable lock and cleanup, including when device storage is unavailable.
  let lockError = false;
  try { await SecureStore.setItemAsync(signedOutKey, 'yes', secureOptions); }
  catch { lockError = true; }
  let remoteError = false;
  try { const result = await client.auth.signOut({ scope: 'global' }); remoteError = Boolean(result.error); }
  catch { remoteError = true; }
  let localError = false;
  try { localError = Boolean((await client.auth.signOut({ scope: 'local' })).error); }
  catch { localError = true; }
  if (lockError || localError || remoteError) throw new Error('Sign-out could not be fully confirmed.');
}
export function listenAppState(onForeground: () => void) {
  return AppState.addEventListener('change', state => {
    if (state === 'active') { client?.auth.startAutoRefresh(); onForeground(); }
    else client?.auth.stopAutoRefresh();
  });
}
export function onAuthInvalidated(onInvalid: () => void) {
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') onInvalid();
  });
  return () => data.subscription.unsubscribe();
}
