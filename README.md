# DebtFree Native

Native Android and iOS app. The first section is sign-in. This repository is independent from the DebtFree web application.

## Status

**Draft and not yet authenticated on a real device.** A separate sandbox Supabase Auth project and Google/Apple OAuth configuration are required. Do not use the existing web production project or any real household data. No app store deployment is configured.

## Development

1. Use Node 24 and run `npm ci`.
2. Copy `.env.example` to `.env` and fill in the **separate test project's** public URL, reference and publishable key. Do not use a secret or service-role key. This client rejects the known production project and secret/legacy keys. Values in `EXPO_PUBLIC_` are included in the app, so never put secrets there.
3. Register `com.debtfree.native.test://auth/callback` on the test Supabase project's redirect allowlist; configure the Google provider with separate test OAuth credentials. For iOS, configure Sign in with Apple separately, including the app identifier and required capability. Never change web production provider settings.
4. Build a development client for a test Android/iOS device. Expo Go is not sufficient for the custom redirect. Run `npx expo start --dev-client`; follow the normal SDK instructions for a development build. Device signing and iOS hardware access are separate prerequisites.
5. Run `npm run lint`, `npm run typecheck`, and `npm test`. Tests do not exercise a real provider, secure storage, or device session lifecycle.

Authentication uses the system browser and Supabase PKCE for Google; native Sign in with Apple is iOS-only. Session restoration calls the auth service before protected content appears. Stored credentials use Expo SecureStore. The logout lock prevents an offline sign-out from silently reopening an old session, though remote revocation may remain unconfirmed. Validate large SecureStore values, reinstall behavior, callbacks, account switching and refresh failures on both platforms before acceptance.

Only the signed-in placeholder is included; financial data and household APIs are intentionally absent. Configuration, security, accessibility and provider flows require independent review before a pilot.
