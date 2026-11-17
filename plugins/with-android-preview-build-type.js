const { withAppBuildGradle } = require('@expo/config-plugins');

const PREVIEW_BLOCK = `preview {
            initWith release
            matchingFallbacks = ['release']
            signingConfig signingConfigs.debug
            debuggable false
        }`;

const PREVIEW_GUARD = `

// DFN_STANDALONE_PREVIEW_GUARD: sandbox-only, non-production signing lane.
gradle.taskGraph.whenReady { taskGraph ->
    if (taskGraph.allTasks.any { it.name == 'assemblePreview' }) {
        def previewEnvironment = System.getenv('EXPO_PUBLIC_APP_ENV')
        def previewScheme = System.getenv('EXPO_PUBLIC_APP_SCHEME')
        def previewPackage = System.getenv('DFN_ANDROID_PACKAGE')
        if (previewEnvironment != 'sandbox') {
            throw new GradleException('The preview APK is sandbox-only; set EXPO_PUBLIC_APP_ENV=sandbox.')
        }
        if (previewScheme != 'com.debtfree.native.test' || previewPackage != 'com.debtfree.nativetest' || android.defaultConfig.applicationId != 'com.debtfree.nativetest') {
            throw new GradleException('The preview APK requires the sandbox app scheme and package.')
        }
        def previewProjectRef = System.getenv('EXPO_PUBLIC_SANDBOX_PROJECT_REF')
        def previewSupabaseUrl = System.getenv('EXPO_PUBLIC_SANDBOX_SUPABASE_URL')
        def previewPublishableKey = System.getenv('EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY')
        if (!previewProjectRef || !(previewProjectRef ==~ /[a-z0-9-]+/) || previewProjectRef == 'acpderotiyoecmwwyfsu') {
            throw new GradleException('The preview APK requires a sandbox mobile project reference, separate from the web production project.')
        }
        if (previewSupabaseUrl != "https://\${previewProjectRef}.supabase.co") {
            throw new GradleException('The preview Supabase URL must match the configured sandbox mobile project reference.')
        }
        if (!previewPublishableKey || !(previewPublishableKey ==~ /sb_publishable_[A-Za-z0-9_-]+/)) {
            throw new GradleException('The preview APK requires a sandbox publishable key; secret and legacy keys are rejected.')
        }
        if (!file('src/main/AndroidManifest.xml').text.contains('android:scheme="com.debtfree.native.test"')) {
            throw new GradleException('The Android manifest does not contain the sandbox scheme. Run Expo prebuild with the sandbox environment.')
        }
    }
}
`;

function findClosingBrace(text, openingBrace) {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = openingBrace; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (char === '\\') { i += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('Unable to find matching Gradle block brace.');
}

function findBlock(text, expression) {
  const match = expression.exec(text);
  if (!match) return null;
  const openingBrace = text.indexOf('{', match.index);
  return { start: match.index, openingBrace, closingBrace: findClosingBrace(text, openingBrace) };
}

function ensurePreviewGradle(contents) {
  const buildTypes = findBlock(contents, /\bbuildTypes\s*\{/g);
  if (!buildTypes) throw new Error('Generated Android app Gradle file has no buildTypes block.');

  const buildTypesContents = contents.slice(buildTypes.openingBrace + 1, buildTypes.closingBrace);
  const preview = findBlock(buildTypesContents, /\bpreview\s*\{/g);
  let updated;
  if (preview) {
    const start = buildTypes.openingBrace + 1 + preview.start;
    const end = buildTypes.openingBrace + 1 + preview.closingBrace + 1;
    updated = `${contents.slice(0, start)}${PREVIEW_BLOCK}${contents.slice(end)}`;
  } else {
    updated = `${contents.slice(0, buildTypes.closingBrace)}\n        ${PREVIEW_BLOCK}\n    ${contents.slice(buildTypes.closingBrace)}`;
  }

  if (!updated.includes('DFN_STANDALONE_PREVIEW_GUARD')) updated += PREVIEW_GUARD;
  return updated;
}

function withAndroidPreviewBuildType(config) {
  return withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = ensurePreviewGradle(modConfig.modResults.contents);
    return modConfig;
  });
}

withAndroidPreviewBuildType.ensurePreviewGradle = ensurePreviewGradle;
module.exports = withAndroidPreviewBuildType;
