const test = require('node:test');
const assert = require('node:assert/strict');
const { ensurePreviewGradle } = require('../plugins/with-android-preview-build-type');

test('persists a non-debuggable preview variant and sandbox-only guard idempotently', () => {
  const generated = `android {\n    buildTypes {\n        debug { signingConfig signingConfigs.debug }\n        release { signingConfig null }\n    }\n}`;
  const once = ensurePreviewGradle(generated);
  const twice = ensurePreviewGradle(once);

  assert.equal((twice.match(/preview\s*\{/g) || []).length, 1);
  assert.equal((twice.match(/DFN_STANDALONE_PREVIEW_GUARD/g) || []).length, 1);
  assert.match(twice, /initWith release/);
  assert.match(twice, /matchingFallbacks = \['release'\]/);
  assert.match(twice, /signingConfig signingConfigs\.debug/);
  assert.match(twice, /debuggable false/);
  assert.match(twice, /previewEnvironment != 'sandbox'/);
  assert.ok(twice.includes("previewPackage != 'com.debtfree.nativetest'"));
  assert.ok(twice.includes("android.defaultConfig.applicationId != 'com.debtfree.nativetest'"));
  assert.match(twice, /acpderotiyoecmwwyfsu/);
  assert.ok(twice.includes("contains('android:scheme=\"com.debtfree.native.test\"')"));
  assert.ok(!twice.includes("contains('android:scheme=\"${previewScheme}\"')"));
});

test('fails clearly when Expo changes the generated buildTypes structure', () => {
  assert.throws(() => ensurePreviewGradle('android { defaultConfig {} }'), /no buildTypes block/);
});
