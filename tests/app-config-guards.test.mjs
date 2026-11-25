import test from 'node:test';
import assert from 'node:assert/strict';
import appConfig from '../app.config.ts';
import { createTelemetry } from '../src/telemetry-core.ts';

const valid = {
  EXPO_PUBLIC_APP_ENV: 'production', DFN_APP_NAME: 'BitLess', DFN_APP_SLUG: 'bitless',
  EXPO_PUBLIC_APP_SCHEME: 'bitless', DFN_IOS_BUNDLE_ID: 'com.example.bitless',
  DFN_ANDROID_PACKAGE: 'com.example.bitless', EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED: 'true',
  EXPO_PUBLIC_MOBILE_PRODUCTION_PROJECT_REF: 'mobileproduction',
  EXPO_PUBLIC_MOBILE_PRODUCTION_SUPABASE_URL: 'https://mobileproduction.supabase.co',
  EXPO_PUBLIC_MOBILE_PRODUCTION_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
  EXPO_PUBLIC_ACCOUNT_DELETION_ENABLED: 'true', DFN_OFFICIAL_DOMAIN: 'example.com',
  EXPO_PUBLIC_HELP_URL: 'https://example.com/help', EXPO_PUBLIC_PRIVACY_URL: 'https://example.com/privacy',
  EXPO_PUBLIC_TERMS_URL: 'https://example.com/terms', EXPO_PUBLIC_ACCOUNT_DELETION_URL: 'https://example.com/delete',
  DFN_APP_ICON_PATH: 'assets/icon.png', DFN_ANDROID_ADAPTIVE_ICON_PATH: 'assets/adaptive.png',
  DFN_SPLASH_IMAGE_PATH: 'assets/splash.png', EXPO_PUBLIC_SANDBOX_PROJECT_REF: 'sandbox',
};

function configure(overrides = {}) {
  const original = { ...process.env };
  try {
    Object.assign(process.env, valid, overrides);
    for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete process.env[key];
    return appConfig({ config: { name: 'test', slug: 'test', ios: { infoPlist: { Existing: true } } } });
  } finally { process.env = original; }
}

test('production requires a valid iOS bundle ID and Apple sign-in', () => {
  assert.throws(() => configure({ DFN_IOS_BUNDLE_ID: undefined }), /DFN_IOS_BUNDLE_ID/);
  assert.throws(() => configure({ DFN_IOS_BUNDLE_ID: 'invalid' }), /DFN_IOS_BUNDLE_ID/);
  assert.throws(() => configure({ EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED: 'false' }), /EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED/);
});

test('production rejects both configured and known sandbox project references', () => {
  for (const ref of ['sandbox', 'bitepxsdujceoszbldhd']) {
    assert.throws(() => configure({ EXPO_PUBLIC_MOBILE_PRODUCTION_PROJECT_REF: ref }), /sandbox project/);
  }
});

test('production declares encryption and preserves other iOS settings', () => {
  const ios = configure().ios;
  assert.equal(ios.infoPlist.ITSAppUsesNonExemptEncryption, false);
  assert.equal(ios.infoPlist.Existing, true);
});

test('telemetry is a no-op without a DSN and scrubs event data when enabled', () => {
  let options; let captured = 0;
  const client = { init(value) { options = value; }, captureException() { captured++; } };
  createTelemetry(client, '  ')(new Error('private'), 'root_error_boundary');
  assert.equal(options, undefined);
  assert.equal(captured, 0);
  createTelemetry(client, ' https://example.test/1 ')(new Error('private'), 'root_error_boundary');
  assert.equal(captured, 1);
  assert.equal(options.sendDefaultPii, false);
  const sanitized = options.beforeSend({ user: { email: 'private' }, message: 'private', exception: { values: [{ value: 'private', stacktrace: { frames: [{ function: 'render', vars: { balance: 12 } }] } }] } });
  assert.doesNotMatch(JSON.stringify(sanitized), /private|balance/);
});
