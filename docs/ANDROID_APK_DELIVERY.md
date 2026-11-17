# Android APK delivery

## Private standalone test APK

The default **Android private APK build** workflow variant is `preview`. It runs Expo prebuild and builds `assemblePreview`, which inherits release behavior, is non-debuggable, and embeds the JavaScript bundle. It is signed with the Android debug key for private sandbox installation, so it is an installable test candidate rather than a store artifact. The preview Gradle configuration is restored by `plugins/with-android-preview-build-type.js` every time prebuild regenerates the ignored `android/` project.

To request the next APK:

1. Push the reviewed source to the GitHub branch to build.
2. In **Actions → Android private APK build → Run workflow**, leave `preview` selected.
3. Download the `DebtFree-Native-Android-Standalone-Preview-APK` artifact.
4. Keep `app-preview.apk` together with `apk-delivery-metadata.json`. The metadata records the APK SHA-256, source commit, variant, environment, and successful bundle/manifest validation.

The workflow requires the existing repository variables for the sandbox mobile project URL, project reference, and publishable key. The workflow explicitly sets the sandbox package; the Gradle guard requires that value and checks the generated application ID. The guard rejects a production app environment, production app identity, a missing/mismatched sandbox project, a non-publishable key, or the web production project reference. The workflow sets `EXPO_PUBLIC_APP_ENV=sandbox` explicitly. Do not repoint these variables at production to build a private APK.

Before upload, `scripts/android_apk_delivery.py` checks that the APK contains a nonempty `assets/index.android.bundle`, that the compiled manifest is not debuggable, that the normal `MainActivity` launcher exists, and that Expo development-launcher activities are absent. It uses Android APK Analyzer when available and `aapt` as a fallback; validation fails if neither can inspect the manifest.

## Deliberate development client

Choose `debug` in the same workflow only when a Metro development client is intended. That APK is uploaded separately as `DebtFree-Native-Android-Development-APK` and is not validated or labeled as a standalone delivery.

## Production candidate

The separate **Android production release candidate** workflow continues to produce a signed AAB under the `production-mobile` environment. It is gated by the existing production configuration and release-signing checks and does not publish to a store. This private preview lane does not bypass or change those release safeguards.

No APK was built as part of T-264.
