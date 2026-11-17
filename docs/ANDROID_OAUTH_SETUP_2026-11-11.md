# Android OAuth setup for the first release

**Status:** App-side Google OAuth flow exists. Cloud provider configuration and native sign-in acceptance have not been verified.

## What is already in the app

- Android uses Supabase Auth with the Google provider through `signInWithOAuth` and an authorization-code/PKCE exchange.
- The app's return URL is `<app-scheme>://auth/callback`. The production scheme is still unselected; the current sandbox scheme is `com.debtfree.native.test`.
- The selected mobile Supabase project is `debtfree-native-auth`, ref `bitepxsdujceoszbldhd`, and its project state is `ACTIVE_HEALTHY`.
- The connected Supabase project view reports project metadata but does not expose the Auth provider toggle or configured Google client ID. The existing provider state is therefore **unknown**, not assumed missing.

## Exact provider callback for Google Cloud

In the Google OAuth client, the authorized redirect URI for this Supabase project is:

```text
https://bitepxsdujceoszbldhd.supabase.co/auth/v1/callback
```

This is the Google-to-Supabase callback. It is separate from the app deep link below.

## App redirect to allow in Supabase Auth

After the production URL scheme is selected, add this exact URI under Supabase Auth's allowed redirect URLs:

```text
<chosen-scheme>://auth/callback
```

For example, if the owner approves the suggested scheme `debtfree`, the value is:

```text
debtfree://auth/callback
```

Do not add the example until that scheme is selected and installed in the production Android manifest.

## Setup sequence

1. In Google Cloud Console, create or select the OAuth consent configuration and create a **Web application** OAuth client.
2. Add the Supabase callback URL above as an authorized redirect URI in that OAuth client.
3. In the selected Supabase project's Auth provider settings, enable Google and enter the Google client ID and client secret. Keep the secret in Supabase; never place it in the app or repository.
4. In Supabase Auth URL configuration, add the exact app deep link to the redirect allow list. Keep the official website as the Site URL if one is set; the app's `redirectTo` uses the deep link directly.
5. Once the Android package and URL scheme are final, build the Android candidate, install it on a working emulator/device, and test Google sign-in, account selection, cancellation, redirect return, and sign-out with a synthetic account.
6. Configure Apple sign-in only in the later iOS release lane, after the Apple bundle ID and developer account setup are selected.

Supabase's Google provider guide specifies a Web application OAuth client and that the project's callback be added as its authorized redirect URI. Supabase's mobile deep-link guide says to register the URL scheme in app config and add the corresponding redirect to Auth URL configuration. Sources: [Supabase Google sign-in setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Supabase native mobile deep linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking), and [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## Owner inputs and access needed

- Approve a production URL scheme (`debtfree` is a proposal only) and Android application ID.
- Confirm access to the Google Cloud project that owns the app's OAuth consent screen/client.
- Once logged into Supabase Dashboard, verify the existing Google provider setting. If it is enabled, confirm that its callback is the URI above and that the new app deep link is in the allow list. If it is not enabled, enter the provider credentials in that dashboard.
- Do not paste the Google client secret into chat. It is entered directly in the Supabase Dashboard.

No project setting was changed by preparing this checklist.
