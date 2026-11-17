## Final delivery status - 2026-11-16

The scoped recovery work is complete. Standalone sandbox APK dist/BitLess-Android-Recovery-2026-11-15-T287.apk version 0.1.4 (5) contains the recovery screen and deployed category-repair client. It is dual ABI (arm64-v8a and x86_64), signature-verified, non-debuggable and has its embedded bundle validated. SHA-256: 8f16fe3aba4176b06af3ef7cf7ee060834173ce3aa690163434c165d0c83121a. The APK was uploaded to Drive, privately shared with enidualceel@gmail.com, and the download email was sent.

Installed and opened on local emulator-5554, preserving app data. Claudine signed-in session opened the actionable recovery workspace. Missing-category diagnostics and explicit unselected category choices were visible; after scrolling, the current household, invitation link/code field, Join, Refresh and Sign out controls were visible. No category was selected or saved, and Join was not submitted. Dummy rows remain unchanged. This verifies the recovery route and visible controls, not successful repair or invitation acceptance.

Verification: 46 focused Node tests passed, npx.cmd tsc --noEmit passed, and the previously recorded rollback SQL checks passed. APK validation and signature checks passed. The APK download email was sent to enidualceel@gmail.com. Invitation-email provider setup remains deferred because there is no sending domain.

# T-287 authenticated recovery and category repair

> **Owner Standing Directives & Live State - 2026-11-15:** The owner authorized the scoped recovery source work, reviewed category-repair migration deployment to `bitepxsdujceoszbldhd`, focused tests and typecheck. Do not automatically change dummy rows. No actual financial row is to be repaired during tests. APK/build/device/email/domain and unrelated source are out of scope.

Status: DONE. Authenticated recovery now lets an owner or member choose and save a canonical category for a diagnosed account. The picker has no default selection; no category is inferred. A viewer sees the diagnostic and cannot edit. Current household switching, invite join and refresh remain guarded against concurrent recovery actions. Successful repair refreshes through the existing `loadUserOnboardingData` account loader; it does not fabricate a model from the RPC receipt.

## Server and service behavior

Migration `20261116010627_repair_debt_category.sql` adds `debtfree_repair_debt_category(text,bigint,uuid,bigint,text)`. It follows the existing `debtfree_internal_finance_authorize` write gate with `ARRAY['owner','admin']`, locks the exact debt row under the requested household, permits only missing/unsupported saved categories, checks the debt revision, accepts the canonical category set including Mortgage, and rejects a non-card category when an annual fee exists. Its update is category/version/updated_at only. The existing debt revision trigger produced exactly one increment in rollback verification. EXECUTE is granted to `authenticated`; `anon` and `PUBLIC` are revoked.

The TypeScript service checks the server-authenticated user, re-fetches verified household membership and requires the same user/household/role/membership version, verifies the diagnosed row is still invalid and at the exact diagnostic version, and checks pending writes for the source household before dispatch. It sends only `p_household_id`, `p_expected_membership_version`, `p_debt_id`, `p_expected_debt_version`, and `p_category`. It never retries. If the RPC response is missing or uncertain, one exact row readback confirms success only when the desired category and expected version+1 are present; otherwise it reports an uncertain result.

## Verification

- `node --experimental-strip-types --test tests/debt-category-repair.test.mjs tests/account-recovery.test.mjs tests/shared-settings-recovery.test.mjs` — 21 passed.
- `npx.cmd tsc --noEmit` — passed.
- Live rollback-only SQL used synthetic rows and temporary membership roles inside a transaction, then rolled back. It verified owner and admin success, one revision increment, preservation of every other debt field, stale-version conflict, viewer and foreign-household denial, and authenticated-only execution. A follow-up query found zero remaining synthetic rows.
- Live privilege query: authenticated EXECUTE true; anon and PUBLIC EXECUTE false.
- Supabase Advisors showed the existing public SECURITY DEFINER inventory and flags this RPC as callable by authenticated users. This is intended for the exposed client RPC and constrained by the auth helper and execute ACL.
- No real/dummy debt row was read-modify-written by the verification transaction. No APK/build/device/email/domain work was done.

Files: `App.tsx`, `src/screens/AccountRecoveryScreen.tsx`, `src/debt-category-repair.ts`, `src/onboarding-storage.ts`, `tests/debt-category-repair.test.mjs`, `tests/shared-settings-recovery.test.mjs`, `supabase/migrations/20261116010627_repair_debt_category.sql`, and `scratch/authenticated-recovery-2026-11-15/t287-category-repair-rollback.sql`.


