import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { CALLBACK, callbackCode, isAllowedSandbox } from './auth-guards';

WebBrowser.maybeCompleteAuthSession();
const callback = CALLBACK;
const projectUrl = process.env.EXPO_PUBLIC_SANDBOX_SUPABASE_URL ?? '';
const publicKey = process.env.EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY ?? '';
const allowedRef = process.env.EXPO_PUBLIC_SANDBOX_PROJECT_REF ?? '';
const configured = isAllowedSandbox(projectUrl, allowedRef, publicKey);
const signedOutKey = 'debtfree-signed-out';
const storage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};
const client: SupabaseClient | null = configured ? createClient(projectUrl, publicKey, {
  auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'pkce' },
}) : null;
export function isConfigured() { return configured; }
function getClient(): SupabaseClient {
  if (!client) throw new Error('A separate test sign-in service has not been configured yet.');
  return client;
}
export async function verifiedSession(): Promise<Session | null> {
  if (!client || await SecureStore.getItemAsync(signedOutKey) === 'yes') return null;
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) return null;
  // getUser calls the auth server rather than trusting the stored access token alone.
  const { data: identity, error: identityError } = await client.auth.getUser();
  if (identityError || !identity.user || identity.user.id !== data.session.user.id) {
    await client.auth.signOut({ scope: 'local' });
    return null;
  }
  return data.session;
}
export async function signInWithGoogle(): Promise<Session | null> {
  const supabase = getClient();
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callback, skipBrowserRedirect: true } });
  if (error || !data.url) throw new Error('Unable to start Google sign-in. Please try again.');
  const result = await WebBrowser.openAuthSessionAsync(data.url, callback);
  if (result.type === 'cancel' || result.type === 'dismiss') return null;
  if (result.type !== 'success') throw new Error('Google sign-in did not finish. Please try again.');
  const code = callbackCode(result.url);
  if (!code) throw new Error('The sign-in response could not be verified.');
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw new Error('Sign-in could not be completed. Please try again.');
  await SecureStore.deleteItemAsync(signedOutKey);
  return verifiedSession();
}
export async function signInWithApple(): Promise<Session | null> {
  const supabase = getClient();
  if (Platform.OS !== 'ios') return null;
  const nonce = Crypto.randomUUID() + Crypto.randomUUID();
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  try {
    const result = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL], nonce: digest });
    if (!result.identityToken) throw new Error('Apple sign-in did not return an identity token.');
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: result.identityToken, nonce });
    if (error) throw error;
    await SecureStore.deleteItemAsync(signedOutKey);
    return verifiedSession();
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
    throw new Error('Apple sign-in could not be completed. Please try again.');
  }
}
export async function signOut(): Promise<void> {
  if (!client) return;
  // Persist the locked state before revocation so an offline logout cannot restore old content.
  await SecureStore.setItemAsync(signedOutKey, 'yes', { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  let remoteError = false;
  try { const result = await client.auth.signOut({ scope: 'global' }); remoteError = Boolean(result.error); }
  catch { remoteError = true; }
  const local = await client.auth.signOut({ scope: 'local' });
  if (local.error || remoteError) throw new Error('Sign-out could not be fully confirmed.');
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
