# Publishing Readiness Plan

**Status:** Local source remediation is complete (2026-11-11). Owner's launch order is Android first, iOS second. Production deployment and store submission remain blocked by the final app-name decision, domain/contact/legal details, artwork, credentials, native acceptance, and platform release setup.

## Recommendation

Proceed Android first, with an Android test-track candidate as the first distribution step; complete public Android release gates after that candidate passes acceptance. Keep iOS as a second release lane until the Android release is stable and iOS identity, signing, sign-in, account-deletion, and device checks pass. If the app is distributed through Google Play, complete the applicable account-deletion requirements before upload.

This plan uses the current owner decisions in `AGENTS.md` and `references/UI_PREFERENCES.md`, and the later acceptance notes in `TRACKER.md`. Older audit figures (including lint/test counts) are historical and must be rechecked against the current working tree before they are treated as current.

## Current implementation status — 2026-11-11

Owner launch order (2026-11-11): Android first, iOS second. No public app name has been selected. A quick store search found multiple apps using `DebtFree` or near-identical wording, so the existing code label should not be treated as a cleared public name. See [`docs/APP_NAME_REVIEW_2026-11-11.md`](APP_NAME_REVIEW_2026-11-11.md) for a preliminary candidate and the limits of the search. No production package ID, bundle ID, or URL scheme has been selected.

Completed locally: removed the Premium/Bank Sync onboarding page and notification-permission prompt; made onboarding links use configured Terms and Privacy URLs; removed prototype-hosted legal URLs and false unavailable Restore/Reset/Biometrics/Archive surfaces; added an in-app account-deletion confirmation, authenticated server-function source, idempotent retry path, and strict user-scoped device cleanup; added production-only identity/Supabase/legal/assets guards; prohibited debug signing and sandbox identity for Android release variants; changed the private Android workflow to a manually dispatched debug build; and added a manually dispatched signed Android candidate workflow that uploads an artifact only. It does not publish to a store.

Static checks: `npm run typecheck` passes; the full lint command now exits successfully with zero warnings (the 25 earlier warnings were cleaned up). Expo public-config loading succeeds. Source review found the account-deletion retry bound to the authenticated JWT subject and local cleanup gated on a matching server receipt. The Edge Function was served against the isolated local Supabase stack and exercised with a synthetic signed-in user: the initial deletion and same-token idempotent retry returned matching success receipts, and Auth plus all seeded household/financial rows were absent afterward. This does not prove Cloud deployment, expired-token recovery, or native UI behavior. The Edge Function has not been type-checked with Deno because the Deno CLI is not installed. No full test suite, native build, backend deployment, or live financial-data operation was performed. A Device-panel session was opened on the available Android emulator, but the Expo development client showed “System UI isn’t responding”; the tool’s advised debug tap retry returned `COMMAND_FAILED: Touch injection was refused`. Native acceptance remains blocked until the emulator is restarted or repaired.

The production dependency audit reports five moderate findings across `glob` and `minimatch`, pulled through Expo CLI/fingerprint tooling. The current Expo 58.0.23 is the latest 58.0 release, and its CLI requires `glob ^13.0.0`; the advisories list patched versions only at `glob 14.0.2` and `minimatch 11.0.1`. Overriding those major versions inside Expo's SDK toolchain is not a safe compatible fix without an upstream release and candidate build. `npm audit fix --force` would downgrade Expo to SDK 52, so no forced dependency change was applied.

The owner chose to keep using the active `debtfree-native-auth` project (ref `bitepxsdujceoszbldhd`) for mobile until it can no longer support the app. Do not create another project or upgrade the organization unless the owner changes this decision. The paused `debtfree-mobile-test` project is an unused failed household-sharing experiment and is not required. `.env.example` now contains the chosen mobile project ref; its production URL and publishable key remain unset. Sandbox and release app configurations may point to the same chosen mobile project; use synthetic accounts for app acceptance and the isolated local Docker stack for destructive database verification. Local replay does not establish the current Cloud schema or migration ledger, and no Cloud deployment occurred during this follow-up. Do not require a second paid or free Cloud staging project. Android release configuration no longer requires a separate sandbox ref or the later iOS bundle ID. Remaining gates include GitHub production environment values and signing secrets; public app-name approval, Android package and scheme; official domain and support/legal contact; Google OAuth redirect verification; completed and hosted Help/Privacy/Terms/deletion pages; approved app/adaptive/splash artwork; separately authorized deployment of the reviewed schema and deletion function; store setup; and native acceptance. iOS bundle ID, Apple sign-in setup and iOS signing/device acceptance belong to the second release lane.

## Gate 0 — Establish the release scope and current baseline

1. First target is Android; stage a test-track candidate before public Google Play release. iOS follows as a separate release lane. Record the exact first Android track when Play Console setup is available.
2. Lock V1 scope. Recommended initial scope is manual financial tracking. Defer premium billing, bank sync, multi-member invites, background notifications, and biometrics unless their full flows are implemented and accepted. Preserve the owner’s current single-user household model; collaboration remains deferred.
3. Decide whether V1 includes financial reset and backup restore. Until their full flows pass acceptance, keep them unavailable and remove dead-end controls from the V1 surface. Export-only can ship only with accurate wording and a validated export.
4. Inventory the current dirty working tree and identify the exact candidate commit. Preserve unreviewed user changes and exclude stale APKs, scratch files, and generated artifacts from release inputs.
5. Re-run the project’s existing lint, typecheck, and test commands on that candidate and save the results. Do not use the earlier audit’s 23 lint errors or 212 passing tests as current evidence.

**Exit gate:** Written V1 scope and distribution target; a reproducible source revision; current baseline results; no unresolved ambiguity about features exposed to beta users.

## Gate 1 — Make the V1 experience complete and honest

1. Remove or finish the Premium / Bank Sync plan-selection step. For a free manual-entry V1, remove the nonfunctional plan choices and billing claims.
2. Make authentication options match the shipped flow. Remove disabled email/password dead-end copy if OAuth is the only supported method, or implement and verify email authentication.
3. Keep notification settings accurate. Either implement and verify scheduled notifications or retain only a clear saved-preferences setting without suggesting alerts will be delivered.
4. Hide unavailable biometric unlock and archived-debt controls from V1 unless implemented and verified.
5. Keep the owner-approved single-household editor for household settings. Do not add partner/advisor invites or multi-member collaboration to this release.
6. Remove or resolve disabled Restore and Reset controls according to the scope decision. A disabled destructive control should not imply the operation is available.

**Exit gate:** Every visible control has a working, verified outcome or has been removed from the V1 path; copy makes no unsupported billing, bank-sync, notification, or collaboration claims.

## Gate 2 — Close account and financial-data lifecycle gaps

Account deletion, financial-data reset, and backup restore are separate operations and must not share an ambiguous “reset” action.

1. The in-app account-deletion path, authenticated Edge Function source, server-side ownership checks, and local user-data cleanup are implemented. A synthetic local test confirmed first-call deletion and retry, including Auth, household, financial, tombstone, and restore-receipt cleanup. Still needed: host the external deletion resource, finalize retention/contact wording, and deploy the reviewed function/schema only after explicit owner authorization. Account deletion must remove the account and associated data except data that must legally be retained. Google Play requires an in-app path and a functional external deletion resource; Apple requires an in-app initiation path for apps supporting account creation. [Google Play deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-en) · [Apple deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
2. The local server-side authorization and deletion mechanism has been reviewed and exercised against synthetic users. Cloud behavior, expired-token recovery, and native UI acceptance remain unverified. Never use live household data for acceptance.
3. The reset RPC and migration have been reviewed and exercised in isolated local scratch, but the V1 surface and full user-facing acceptance still need a scope decision. Keep reset out of V1 unless it is explicitly included and accepted; do not treat the reset migration as account deletion.
4. The atomic server restore protocol and forward migration now exist and pass a synthetic two-user local check. The client adapter and end-to-end recovery UI remain incomplete, and the migration has not been deployed to the chosen mobile project. Keep restore unavailable until those pieces are implemented and accepted; do not treat older notes about a missing server protocol as current.
5. If restore is out of V1, present only the backup/export behavior that is actually complete. Current notes describe JSON text sharing and paste-based validation, not native file import and named-file export.

**Exit gate:** The release scope either excludes the incomplete reset/restore features cleanly, or the complete flows pass security review and synthetic isolated-database acceptance. Account deletion is implemented and verified before public store submission.

## Gate 3 — Prepare production identity and release infrastructure

1. Select the public app name, slug, Android package, and URL scheme for the first Android release. Select the iOS bundle ID in the later iOS lane. Replace test branding and sandbox-only identifiers only in a clearly separated production configuration.
2. Require a release-time guard that prevents sandbox credentials, sandbox redirects, and developer preview paths from entering a production artifact. Keep public client keys public/publishable; never place service-role secrets in the app.
3. Configure the chosen existing mobile Supabase project, Google provider, and redirect allowlist after the Android app scheme is selected. The exact provider callback and dashboard steps are in [`docs/ANDROID_OAUTH_SETUP_2026-11-11.md`](ANDROID_OAUTH_SETUP_2026-11-11.md). The connected project view confirms the project is active but cannot read its Auth provider settings, so Google configuration remains unverified. Verify migrations on the isolated local Docker stack, then compare the live schema and migration history before any deployment. Do not create another Cloud project or upgrade. **Cloud access and production deployment remain separately gated by owner authorization; this plan does not authorize either.**
4. Replace prototype-hosted Help, Privacy, and Terms URLs with stable support and legal destinations on the chosen official app/developer domain. Review the actual policies for consistency with shipped data collection, retention, deletion, and backup behavior.
5. Review the three icon/splash directions in [`design/app-artwork-candidates-2026-11-11.html`](../design/app-artwork-candidates-2026-11-11.html), select or refine one, then export approved store icon, Android adaptive icon, and splash assets. Store screenshots, version metadata, and required listing text are also still needed.
6. Choose a release-build method (EAS or native Gradle/Xcode). EAS is optional; a secure, repeatable alternative is acceptable. Configure proper Android upload/release signing and iOS signing if in scope. Remove debug signing from release builds, confirm the package and version codes, and make the local CMake staging workaround safe for CI/build hosts.
7. Update CI/release automation so pull requests run required checks and release builds produce the intended signed artifact from the selected revision. Do not publish automatically from ordinary branches.

**Exit gate:** A repeatable signed artifact builds from the locked source revision with production identity and no sandbox-only configuration; support and policy destinations work and match the product.

## Gate 4 — Complete platform and release-candidate acceptance

1. Fix lint errors that fail CI and address warnings that obscure actual defects. Require lint, typecheck, and the existing relevant test suite to pass on the release candidate.
2. Verify the latest connected dock and pull-to-refresh natively. T-141 remains blocked: the available Android emulator opens, but the Expo development client displays “System UI isn’t responding” and the Device-panel touch helper refuses input, including after its advised debug retry. Do not claim runtime acceptance from source review or typecheck. Once the emulator is repaired, test standard/narrow width, text scaling, themes, all five tabs, Add open/cancel, refresh errors, pending writes, and route/section/draft retention.
3. Run focused release-candidate scenarios for sign-in/out, session restoration, offline/pending write recovery, financial entry/editing, account deletion, and any reset/restore flow included in V1. Use synthetic accounts and the isolated test backend for destructive flows.
4. For Android, test the signed release candidate on supported device sizes and ensure the exact artifact installs and runs. If uploading to Google Play, complete the Data safety and external deletion-link details.
5. For iOS, if included in the launch, provision the bundle ID and capabilities, build on the Apple toolchain, test sign-in and account deletion on simulator and physical device, and verify any additional login-service requirements under Apple guideline 4.8. [Apple login services guideline](https://developer.apple.com/app-store/review/guidelines/#login-services)
6. Complete store listing, privacy/data disclosures, age/content ratings, support contact, screenshots, and review credentials/instructions. Confirm all claims correspond to the shipped build.

**Exit gate:** Platform-specific acceptance is complete on the exact signed candidate; all release disclosures and links match the implemented behavior; no known P0/P1 issue or blocked release gate remains.

## Order and dependencies

1. Scope and baseline (Gate 0).
2. V1 feature decisions and UI cleanup (Gate 1).
3. Account/data lifecycle design and isolated verification (Gate 2). This can proceed in parallel with legal-page drafting, but destructive backend work must remain isolated until separately approved.
4. Production identity, hosting, signing, and release automation (Gate 3). Production Supabase deployment requires a separate owner authorization after staging acceptance.
5. Device acceptance and store submission preparation (Gate 4).

No estimate is assigned yet: the current audit lacks a verified baseline and the database, device, platform-account, and production-environment prerequisites remain unresolved.
