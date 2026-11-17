# T-275: Unified mortgage and auto loans
Date: 2026-11-15
Status: Local implementation verified; approved backend migration deployed. APK delivered; phone runtime acceptance pending.

## Result
Mortgage and Auto loan use one DebtItem displayed in Accounts > Home & Auto and Budget > Housing & Rent / Transportation. Creation from either view uses the shared loan editor and creates no companion recurring bill. The loan supplies one monthly Budget commitment and scheduled obligation. Rent, HOA, fuel and insurance remain ordinary expenses. Budget Debt payments intentionally remains credit-card minimums plus extra, as specified in UI_PREFERENCES.

## Corrections to the initial implementation
- Historical bill IDs are retained as explicit identity aliases. Renames and canonical conversion preserve bill-tagged payment history, settlement, split-plan terms and backup data. Names never establish identity.
- Removed unsafe unlink, Keep separate and independent linked-bill edit/delete paths. Ambiguous ownership prevents deletion rather than discarding history.
- One atomic RPC saves the loan and its schedule/settings under existing household role, membership, settings-revision and debt-version checks. Legacy conversion also locks and verifies the reviewed recurring-bill revision. No sequential companion-bill synchronization remains for these loans.
- Transport uncertainty requires matching authoritative debt AND settings readback. A row-only match or missing RPC cannot report success.
- Existing divergent terms require explicit validated Use loan terms / Use recurring bill terms. Currency and mortgage escrow checks apply before saving.
- Invalid/duplicate links make affected Budget aggregates unavailable and suppress ambiguous obligations. The app does not infer a repair from names.
- New positive-balance loans require due day. Older incomplete schedules show an actionable warning.
- Schedule history and acknowledgements are retained. New terms take effect according to the existing future-cycle editor rules. Both manual-payment forms resolve the effective cycle date rather than using the latest raw due day.
- Legacy split history moves into the canonical debt settings together, preventing a removed split from reappearing through an old bill plan.
- Archive exclusion and existing exact-ownership deletion safeguards remain in force. The migration composes existing save authority; it does not replace the delete RPC.

## Implementation
Domain: src/finance/unified-loan.ts, loan-bill-pairing.ts, payment-matching.ts, debt-payment-split.ts, budget.ts, backup.ts; src/onboarding-domain.ts.
Persistence: src/onboarding-storage.ts and supabase/migrations/20261115230945_unified_loan_atomic_save.sql.
Flows: OnboardingAndHome, FiveTabShell, HomeScreen, BudgetScreen, DebtScreen, TransactionsScreen, ObligationPaySheet and UpcomingObligations.
Focused regressions: tests/finance-unified-loans.test.mjs and tests/unified-loan-persistence.test.mjs.

The earlier unfinished 20261115052713_unified_loan_atomic_save_and_delete.sql draft was moved out of the migration directory to 20261115052713_superseded_draft.sql beside this report. It is preserved for reference and must not be deployed. The sole proposed rollout migration for this work is 20261115230945_unified_loan_atomic_save.sql.

## Verification
- npm run typecheck: PASS.
- 73 focused Node tests: PASS; final output in final-tests.txt. Covers unified loans, real client persistence with synthetic network/native mocks, pairing, Budget, schedule, backup, deletion, ledger and shared-settings recovery.
- DebtScreen and TransactionsScreen ESLint: PASS after the final manual-cycle fix.
- Earlier targeted domain/persistence/onboarding/component lint: no new errors; existing unused import warning in onboarding-storage. Home has six pre-existing react-hooks/refs diagnostics; Budget has an existing unused eslint-disable warning. These unrelated issues were not refactored.
- Actual new SQL executed in isolated PGlite: 13 rollback/validation checks PASS with synthetic nested interfaces.
- New SQL composed with actual checked-in settings CAS, debt upsert and archive-reopen functions: 5 checks PASS, including archive revision changes and rollback. Authority/auth infrastructure and currency helper were stubbed. This is not hosted RLS or device acceptance testing.
- Workspace-wide git diff --check still reports unrelated pre-existing whitespace findings in prototype references, pending-journal and old tests. Scoped implementation source checks passed.
- Local correction checks used no emulator or live financial mutation. Subsequently approved deployment and APK work is recorded below.

## Approved rollout
Owner approved migration application and APK build/Drive/email delivery on 2026-11-15.
Target verified through connector: bitepxsdujceoszbldhd (debtfree-native-auth), ACTIVE_HEALTHY.
Applied unified_loan_atomic_save as remote version 20261115230945; local filename aligned.
Deployed function body MD5 c54d5dc8f75558bb7a56afe6b50bbd89 matches the local body.
Verified empty search_path, anonymous EXECUTE denied, authenticated EXECUTE allowed with existing owner/admin authority. Invocation without authentication rejected with SQLSTATE 28000 before writes. Currency-scale dependency verified.
Complete-table row fingerprints before/after match for debts (25), bills (15), settings (4); no bulk financial record changes. See deployment-evidence.json.
Security advisors include expected authenticated SECURITY DEFINER RPC notice alongside existing notices. No unrelated security settings altered.
CLI link remains unavailable; connected project/history readback resolved live state. No unrelated local migrations applied.

## APK delivery
Standalone preview 0.1.1 (version code 2), ARM64/ARMv7, existing test package and signing identity. Metro not required by delivered artifact.
Initial build failed on ReadOnly generated BuildConfig directories. Saved attributes/ACL state in buildconfig-access-before.json; cleared ReadOnly on four directories under android/app/build/generated/source/buildConfig/preview only; no ACL changes. A second build reached ArtProfile packaging but hit the same ReadOnly restriction. Saved and cleared attributes on 1,122 generated entries within android/app/build only (generated-readonly-before.json); no ACL/security changes. Final rebuild in progress.
Destination: Google Drive and download-link email to enidualceel@gmail.com. Completion evidence to follow.

## Earlier access issue
Source-write backup and ACL evidence are in source-write-repair/. A normal Node same-bytes write subsequently passed with identical SHA-256; .NET and Node probes passed. No ACL, security or process changes were made. The earlier UNKNOWN -4094 cause remains unproven.

## Delivery completed
Standalone build passed in 1m16s after scoped generated-attribute repair. APK 0.1.1 (2), 41,577,716 bytes; validated embedded 3,057,120-byte bundle, non-debuggable normal launcher, ARM64/ARMv7, sandbox project and new atomic RPC in bundle. Signature verified with v2; certificate matches T-272.
SHA-256: 88a8ece38fbc9da22855488b52c127187a4ee849517c4ea27a119eca3e20d7cb
Drive: https://drive.google.com/file/d/1_Nxko4Sbp0DpqsiXnwfmfKR5Nqvn1qiH/view?usp=drivesdk
Drive metadata readback confirmed name/size; connector did not supply remote checksum. Sharing left unchanged. Email sent to enidualceel@gmail.com; SENT message 1a1e180dcfbdccae.
Local APK/provenance: dist/BitLess-Android-Test-2026-11-15-T275.apk and matching .json. Evidence: delivery-evidence.json and apk-signature.txt. No emulator or real-phone install/runtime test performed. Earlier progress notes above are superseded by this completion.
