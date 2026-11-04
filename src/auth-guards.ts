export const CALLBACK = 'com.debtfree.native.test://auth/callback';
export function isAllowedSandbox(projectUrl: string, projectRef: string, publishableKey: string): boolean {
  try {
    const url = new URL(projectUrl);
    return /^[a-z0-9-]+$/.test(projectRef) && projectRef !== 'acpderotiyoecmwwyfsu' &&
      url.protocol === 'https:' && url.hostname === `${projectRef}.supabase.co` &&
      url.port === '' && url.username === '' && url.password === '' &&
      url.pathname === '/' && !url.search && !url.hash && /^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey);
  } catch { return false; }
}
export function callbackCode(value: string): string | null {
  try {
    const url = new URL(value);
    if (`${url.protocol}//${url.host}${url.pathname}` !== CALLBACK || url.hash ||
        url.searchParams.getAll('code').length !== 1 || url.searchParams.has('error')) return null;
    return url.searchParams.get('code') || null;
  } catch { return null; }
}
