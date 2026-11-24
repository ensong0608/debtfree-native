import type { ConfigContext, ExpoConfig } from 'expo/config';

const WEB_PRODUCTION_PROJECT_REF = 'acpderotiyoecmwwyfsu';
const SANDBOX_PROJECT_REF = 'bitepxsdujceoszbldhd';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Production app configuration requires ${name}.`);
  return value;
};

function requireHttpsPage(name: string, officialDomain: string): string {
  const value = required(name);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid HTTPS URL.`); }
  const onOfficialDomain = url.hostname === officialDomain || url.hostname.endsWith(`.${officialDomain}`);
  if (url.protocol !== 'https:' || !onOfficialDomain || url.port || url.hostname.endsWith('.workers.dev') || url.hostname === 'workers.dev' ||
      url.username || url.password || url.hash) {
    throw new Error(`${name} must be an HTTPS page on DFN_OFFICIAL_DOMAIN.`);
  }
  return value;
}

function requireAsset(name: string): string {
  const value = required(name);
  const segments = value.split('/');
  if (value.startsWith('/') || value.includes('\\') || segments.includes('..') ||
      !/^[A-Za-z0-9_.\-/]+$/.test(value)) {
    throw new Error(`${name} must be a project-relative image path with no parent-directory segments.`);
  }
  return value;
}

function productionSupabaseProblem(projectUrl: string, projectRef: string, publishableKey: string): string | null {
  if (!/^[a-z0-9-]+$/.test(projectRef)) return 'EXPO_PUBLIC_MOBILE_PRODUCTION_PROJECT_REF is not a valid project reference.';
  if (projectRef === WEB_PRODUCTION_PROJECT_REF) return 'The web production project is not allowed in the mobile app.';
  if (projectRef === SANDBOX_PROJECT_REF || projectRef === process.env.EXPO_PUBLIC_SANDBOX_PROJECT_REF?.trim()) return 'The sandbox project is not allowed in production.';
  let parsedUrl: URL;
  try { parsedUrl = new URL(projectUrl); } catch { return 'EXPO_PUBLIC_MOBILE_PRODUCTION_SUPABASE_URL is not a valid URL.'; }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== `${projectRef}.supabase.co` || parsedUrl.port !== '' ||
      parsedUrl.username !== '' || parsedUrl.password !== '' || parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
    return 'EXPO_PUBLIC_MOBILE_PRODUCTION_SUPABASE_URL must match the configured mobile project reference.';
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    return 'EXPO_PUBLIC_MOBILE_PRODUCTION_SUPABASE_PUBLISHABLE_KEY must be a publishable key. Secret and legacy keys are rejected.';
  }
  return null;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV ?? 'sandbox';
  if (appEnvironment !== 'sandbox' && appEnvironment !== 'production') {
    throw new Error('EXPO_PUBLIC_APP_ENV must be sandbox or production.');
  }
  if (appEnvironment === 'sandbox') {
    return {
      ...config,
      plugins: [...(config.plugins ?? []), 'expo-splash-screen', 'expo-notifications', '@sentry/react-native'],
    } as ExpoConfig;
  }

  const appName = required('DFN_APP_NAME');
  const appSlug = required('DFN_APP_SLUG');
  const appScheme = required('EXPO_PUBLIC_APP_SCHEME');
  const iosBundleIdentifier = required('DFN_IOS_BUNDLE_ID');
  const androidPackage = required('DFN_ANDROID_PACKAGE');
  if (!/^[A-Za-z][A-Za-z0-9+.-]*$/.test(appScheme) || appScheme === 'com.debtfree.native.test') {
    throw new Error('EXPO_PUBLIC_APP_SCHEME must be a valid production-only scheme.');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(appSlug)) throw new Error('DFN_APP_SLUG is invalid.');
  if (!/^[A-Za-z0-9]+(?:\.[A-Za-z0-9_]+)+$/.test(androidPackage) || androidPackage === 'com.debtfree.nativetest') {
    throw new Error('DFN_ANDROID_PACKAGE must be a valid production reverse-DNS identifier.');
  }
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(iosBundleIdentifier) ||
      iosBundleIdentifier === 'com.debtfree.nativetest') {
    throw new Error('DFN_IOS_BUNDLE_ID must be a valid production reverse-DNS identifier.');
  }

  // Google sign-in is currently always offered by the app.
  if (process.env.EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED !== 'true') {
    throw new Error('Production builds with Google sign-in require EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED=true.');
  }

  const productionConfigError = productionSupabaseProblem(
    required('EXPO_PUBLIC_MOBILE_PRODUCTION_SUPABASE_URL'),
    required('EXPO_PUBLIC_MOBILE_PRODUCTION_PROJECT_REF'),
    required('EXPO_PUBLIC_MOBILE_PRODUCTION_SUPABASE_PUBLISHABLE_KEY'),
  );
  if (productionConfigError) throw new Error(productionConfigError);
  if (process.env.EXPO_PUBLIC_ACCOUNT_DELETION_ENABLED !== 'true') {
    throw new Error('Production builds require EXPO_PUBLIC_ACCOUNT_DELETION_ENABLED=true after the deletion function is deployed.');
  }
  const officialDomain = required('DFN_OFFICIAL_DOMAIN').toLowerCase();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(officialDomain)) {
    throw new Error('DFN_OFFICIAL_DOMAIN must be a valid domain name.');
  }
  const helpUrl = requireHttpsPage('EXPO_PUBLIC_HELP_URL', officialDomain);
  const privacyUrl = requireHttpsPage('EXPO_PUBLIC_PRIVACY_URL', officialDomain);
  const termsUrl = requireHttpsPage('EXPO_PUBLIC_TERMS_URL', officialDomain);
  const accountDeletionUrl = requireHttpsPage('EXPO_PUBLIC_ACCOUNT_DELETION_URL', officialDomain);
  const appIcon = requireAsset('DFN_APP_ICON_PATH');
  const adaptiveIcon = requireAsset('DFN_ANDROID_ADAPTIVE_ICON_PATH');
  const splashImage = requireAsset('DFN_SPLASH_IMAGE_PATH');
  const iosConfig = { ...config.ios, bundleIdentifier: iosBundleIdentifier,
    infoPlist: { ...config.ios?.infoPlist, ITSAppUsesNonExemptEncryption: false } };

  return {
    ...config,
    name: appName,
    slug: appSlug,
    scheme: appScheme,
    icon: appIcon,
    ios: iosConfig,
    android: {
      ...config.android,
      package: androidPackage,
      adaptiveIcon: { ...config.android?.adaptiveIcon, foregroundImage: adaptiveIcon, backgroundColor: '#141318' },
    },
    extra: {
      ...config.extra,
      environment: 'production',
      legalUrls: { help: helpUrl, privacy: privacyUrl, terms: termsUrl, accountDeletion: accountDeletionUrl },
    },
    plugins: [
      ...(config.plugins ?? []),
      ['expo-splash-screen', { image: splashImage, resizeMode: 'contain', backgroundColor: '#141318' }],
      'expo-notifications',
      '@sentry/react-native',
    ],
  } as ExpoConfig;
};
