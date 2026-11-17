# App reliability fixes - 2026-11-14

Implementation and source verification are complete. The Windows build-access problem was repaired under T-270 and an isolated native QA APK built successfully. Android runtime acceptance remains open after a failed device-automation retry; this is not a phone-ready certification or a new delivery APK.

## Changes

- Invited members complete personal signup and enter the verified existing household without household financial onboarding. The live signup transition uses the same routing rule as startup. A member can reopen before their first personal save without a server-read shared debt cache being misclassified as local-only onboarding.
- Incoming invitations are stored in device-only encrypted storage. Receiving the same token atomically preserves its user binding and acceptance receipt. A confirmed join is recorded before loading its exact household; retry revalidates membership instead of repeating acceptance. If the acceptance response itself is lost, the user can explicitly open a currently verified household from the recovery screen. The client never guesses which household an unknown token joined.
- Cold-start invitation handling precedes personal-household bootstrap. Invitations arriving during account actions are presented when those actions finish. Explicitly continuing separately retains the invitation for a later app open.
- Startup reuses server identity verification within one load operation and obtains membership summaries from that load rather than repeating discovery. Every membership/settings/debt authorization still comes from the server. Requests have bounded waits and a retry screen; temporary failures preserve stored sessions and recovery data.
- Shared-setting patches do not write the personal profile. Personal-only saves retain their original profile household binding and use their own expected revision. Combined-save errors expose confirmed shared state and authoritative personal fields separately.
- Shared conflicts are rebased only if the requested fields did not change. Lost responses are read back before declaring an outcome. An unresolved outcome produces a persistent last-verified-settings warning and an in-app authoritative check; it does not present either value as confirmed. Further shared-setting changes wait for that check.
- Loading a household never changes the stored selection. Only a complete switch accepted by the current root operation queues a serialized selection commit. Superseded queued commits are skipped. Late screen snapshots cannot replace another active household or user.
- The dock, attached action tier, sheets and pickers consume system bottom insets. Native modal windows use a consistent full-screen coordinate space; nested transaction pickers use the existing overlay layer. Duplicate filter-footer inset padding and scroll-end Add controls are removed.
- The approved attached action tier is rendered for Accounts, Transactions and Budget with a centered content-sized button. Selected dock capsules have a consistent size; compact mode uses an icon capsule and an accessible label below. Transactions has a deliberate compact line break, with bounded label scaling and minimum font scaling. Inner section selectors retain only the selected underline.
- The private Android workflow defaults to a bundled, nondebuggable sandbox preview. An Expo config plugin preserves its build type after prebuild, enforces the actual sandbox application ID, and keeps development APKs explicitly separate. Artifact validation requires an embedded bundle, normal launcher and no development launcher; provenance records the source commit, variant and SHA-256.

## Verification evidence

- TypeScript: `npm.cmd run typecheck` passed after integration and review corrections.
- Focused JavaScript/TypeScript tests: 45 passing across invitation recovery, shared-settings persistence/reconciliation, household context/collaboration, auth guards and the preview Gradle plugin. This includes the final 33-test recovery review run and the subsequent focused packaging/switch checks.
- APK tooling: six Python fixture tests passed.
- Targeted ESLint: no errors. Two existing unused-variable warnings remain in `onboarding-storage.ts`; the final dock and Transactions corrections passed lint without warnings.
- Whitespace and plugin syntax checks passed.
- Independent recovery review: T-267 initially held four P1 issues. The manager corrected them and added regression coverage. T-269 returned PASS with 33 focused tests passing.
- Independent UI/tooling review: T-268 held nested raw modals, insufficient preview identity enforcement and compact-label clipping. The manager corrected all three and reran the affected type/lint/tooling checks. No independent native-runtime signoff is claimed.
- Read-only hosted inspection: `debtfree-native-auth` records migration `20261114003911_household_finance_cutover_and_membership`; the household-finance gate is enabled, the expected settings/invitation/context RPC signatures exist, and invitation/delete Edge Functions are active. No live financial records, memberships, invitations or settings were mutated during verification.

## Native QA blocker

The already running Android emulator contained an older signed-in app. It was opened only for inspection and was not changed or used for financial testing. A separate synthetic QA build was attempted with application ID `com.debtfree.nativetest.verification`, leaving the installed app's data isolated.

JavaScript bundling succeeded, but Gradle resource packaging failed with `java.nio.file.AccessDeniedException` in generated incremental `merged.dir` directories for `expo-manifests`, `expo-dev-menu`, `expo-json-utils`, `expo-dev-menu-interface` and `expo-modules-core` beneath the OneDrive workspace. No QA APK was installed. The build was not retried after that environment failure.

Before native acceptance can be closed, those generated paths must be writable, preferably using a build workspace outside OneDrive. Then verify three-button and gesture navigation, nested transaction pickers, pinned form footers, compact navigation with large text, cold-start/reopen behavior, and synthetic strategy changes. Real two-account invitation testing still requires a controlled test household; no live-data mutations were performed here.

The standalone delivery procedure is documented in `docs/ANDROID_APK_DELIVERY.md`. A user delivery APK has not been built, published or installed as part of this work.

## Access repair and native build follow-up

The owner explicitly authorized repairing project build access. Original permissions were backed up under `scratch/build-access-repair-2026-11-14/`. Repair was limited to generated Android build trees. The source-root permissions, other Desktop folders, ownership and unrelated security entries were preserved. Matching generated-root deny entries and stale generated-file/directory read-only attributes were repaired. All 16 generated build roots in the final pass passed create/rename/delete probes.

The isolated x86_64 QA build then completed successfully in 2m18s. APK Analyzer verified application ID `com.debtfree.nativetest.verification`. This internal debug QA artifact enables synthetic local data and is not the standalone preview deliverable. Its hash/path are recorded in `scratch/build-access-repair-2026-11-14/qa-build-evidence.json`.

While preparing Android navigation-mode settings, device automation returned `Android fill verification failed`; the prescribed diagnostic retry failed with an expired UI-reference error. Device work stopped under the device-tool retry rule. No QA APK was installed, and the existing signed-in app and live household data were not modified. The Windows build-access blocker is resolved; remaining three-button, gesture and large-text acceptance needs device runtime evidence.
