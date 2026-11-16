> **Owner Standing Directives & Live State - T-287 final delivery (2026-11-16):** The owner authorized the signed-in recovery workspace, category-repair RPC deployment, focused verification, replacement emulator APK build/install and APK download email. APK 0.1.4 (5) is installed and observed on emulator-5554. It is privately shared from Drive with enidualceel@gmail.com; the download email was sent. Keep dummy rows unchanged until the owner explicitly chooses a repair. No category Save or household Join was submitted. Invitation acceptance and invitation-email provider setup remain unverified/deferred because no sending domain is available.

> **T-287 FINAL STATE - 2026-11-16:** Signed-in recovery keeps the verified Claudine session in an actionable screen when household data has missing categories. Explicit category repair, household switching, invitation entry, refresh and sign-out controls are present. RPC migration 20261116010627 is deployed and rollback checks passed. Standalone sandbox APK 0.1.4 (5), arm64-v8a + x86_64, validated and installed on emulator-5554. 46 focused tests and TypeScript check passed. Emulator restored the signed-in session; missing-category diagnostics and bottom Join controls were observed. No dummy row was changed and neither repair nor Join was submitted. APK download was shared privately in Drive and emailed to enidualceel@gmail.com. Invitation-email provider setup remains deferred; invitation acceptance is unverified.

> **T-287 category repair deployed and final client delivery verified:** Migration 20261116010627 is live with existing owner/admin finance authority, exact debt/version lock and category-only update. Owner authorized replacement APK build/install and emulator verification. APK 0.1.4 (5) restored the signed-in session to recovery; household invitation input and Join action are visible. Tests, typecheck, rollback verification and APK validation passed. Dummy rows remain unchanged; no repair or Join was submitted. APK download link is privately shared in Drive and was emailed to enidualceel@gmail.com. Invitation-email provider setup remains deferred.

> **Owner Standing Directives & Live State - 2026-11-15 AUTHENTICATED RECOVERY ACCESS APPROVED:** Owner reports same failure and directs that signed-in users must be allowed into the app to see and fix data issues themselves instead of being blocked from entry. Implement an authenticated in-app recovery workspace for household/account data failures, with visible diagnostics, self-service category repair, household switching and join-invitation access. Keep actual authentication/access/deletion safeguards and pending-write protections; never show failed financial reads as zero, silently infer categories, drop records, or grant access to unverified households. Necessary scoped client/backend recovery implementation and replacement emulator update are authorized. Existing dummy records remain unchanged unless owner acts through an explicit repair control; email stays deferred.

> **T-284 EMULATOR REFRESH COMPLETE - 2026-11-15:** Owner-powered shutdown released prior device ownership. Installed and launched standalone0.1.3(4) on local/emulator-5554 preserving storage (no clear/uninstall/signout). ARM64-only phone build was unsuitable for x86_64 React Native emulator; built validated arm64-v8a+x86_64 APK dist/BitLess-Android-Emulator-2026-11-15-T284.apk (47,693,262 bytes, SHA256 a0bcb870edaddbf6d696b59865306944d06a6dfd933d1bffc1b665eb9e633889), signature/standalone checks passed. Final build log scratch/t284-emulator-final-build.log; external outputs include composite-build tooling, preserve main-root autolinking path. Observed app session check then welcome; no signed-in session restored. Opened Sign in and observed Welcome back / Continue with Google. User can continue authentication. No dummy account category repair, data clearing, invitation or finance mutation performed. Actual authenticated login/join acceptance remains unverified.

> **T-284 emulator update - 2026-11-15:** Owner powered off emulator to release prior session and authorized reopening/refresh. Latest0.1.3(4) installed preserving app data; relaunch crashed with SoLoaderDSONotFoundError libreactnative.so because existing phone APK is ARM64-only while emulator React Native runtime selects x86_64. Building standalone preview with arm64-v8a,x86_64 using existing external Gradle output configuration; no source or financial-record changes. Device local/emulator-5554, current control session t3-e9cb7ffe921b3cc2de184e9e. Invitation acceptance not yet verified.

> **Owner Standing Directives & Live State - 2026-11-15 T-284 DUMMY ACCOUNTS / INVITE ACCEPTANCE:** Owner says Claudine accounts are dummy data and irrelevant, and will have the account join a household. Do not apply the proposed category corrections or delete/reset those records. Client App.tsx prioritizes saved/incoming invitations before personal-household loading and supports entering the invitation screen from unavailable state. Await device test using latest APK 0.1.3(4) and household owner shared invite link; successful shared-household opening still requires target household data validation. Missing-category personal-household error remains known and untouched.

> **T-284 device acceptance blocker - 2026-11-15:** Owner screenshot reports Saved debt category is missing or unsupported. Live read-only inspection found exactly two NULL public.debts categories in Claudine household hh-d1150a05-56b: account b5646d55-b2b4-4da5-9e07-ab7c434899ac (Auto Loan), account 9d237195-4ec7-4c93-9cea-625a9959af95 (Chase_Sapphire). Exact-ID legacy backup categories absent; no authority to infer from names. Proposed reviewable repair: Auto Loan -> Auto loan, Chase_Sapphire -> Credit card, category-only preserving financial amounts/history/IDs. Await owner confirmation before live financial-record category repair. Reload alone cannot repair NULL categories. No live records changed during diagnosis.

> **T-284 CURRENT DELIVERY STATE - 2026-11-15:** Login/household recovery and separate personal-profile backend migrations 20261115232430 / 20261115234316 are deployed; client uses v2 personal profile and verified household settings while legacy metadata stays frozen backup. Invitation function v3 and public share-link landing are live. Final standalone ARM64 APK dist/BitLess-Android-2026-11-15-T284.apk version 0.1.3 (4), 28,913,056 bytes, SHA256 f7380f16c177bafd24c89a3b52db39eab02bfe8fa46dfbce423eec35d9ce20ab built successfully using external output directories; original locked files untouched. Validator, v2 APK signature, nondebuggable/no-devlauncher, embedded profile-v2 and invite URL checks passed. 25 focused client tests and typecheck passed. Ready for owner device acceptance: physical sign-in, deep-link opening and invitation acceptance are not claimed verified. Invitation email deferred by owner (no domain); not a blocker for these delivered fixes.

> **Owner Standing Directives & Live State - 2026-11-15 T-284 EMAIL DEFERRED:** Owner has no domain and explicitly says invitation email can be last; fix the other login/household/invitation-link flows first. Do not block login/share-link delivery on Resend access, a sending domain, or email setup. Preserve email as deferred, not verified.

> **T-284 authoritative live state - 2026-11-15:** Recovery migration 20261115232430 and durable personal-profile migration 20261115234316 are deployed. Current household settings remain authoritative; legacy debtfree_native_v1 is frozen backup; personal CAS saves and snapshots use debtfree_profile_v2. Client v2 load/save/readback and verified currency guard are implemented; 25 focused tests and typecheck passed. Invitation function v3 and public landing https://bitless-household-invite.ensong608.chatgpt.site/ are deployed. Final APK packaging is in progress outside the OneDrive source tree after Windows generated-directory access failures; no rejected deletion retried. Interim APK is not for delivery. Email configuration/delivery and actual device sign-in/acceptance remain unverified. Older incomplete checkpoints below are historical.

> **T-284 live update 2026-11-15:** Migration 20261115232430 and invitation function v3 deployed; public landing https://bitless-household-invite.ensong608.chatgpt.site/ version 1. Rollback simulations passed owner contexts, fresh bootstrap, owner leave rejection, nonowner leave/version/revocation. Client metadata-save path and login trace still require correction; provider configuration and real sign-in/acceptance remain unverified. Installed APK lacks client changes. See scratch/login-recovery-rollout-2026-11-15/report.md.

> **Owner Standing Directives & Live State - 2026-11-15 T-284 RESOLUTION AND END-TO-END FIX APPROVED:** Owner confirms current household settings are authoritative; old metadata is retained only as backup. Owner explicitly requests fixing login and the invitation procedure. This resolves the stale-versus-unmigrated settings ambiguity and supersedes T-284 blocked statements based on metadata differences. Implement and deploy safe forward recovery correction, preserve legacy metadata without using it to overwrite current settings, preserve real unassigned financial data/account lifecycle safeguards, and complete usable invitation links and delivery. Necessary invitation landing hosting/client/backend corrections are within scope; no financial merges/deletes, domain purchases or unrelated changes. Retain honest credential/domain/device verification limits.

> **T-284 prior investigation resolved by owner - 2026-11-15:** Current household settings are authoritative; legacy metadata retained as backup. Continue corrective rollout under the standing directive above.

> **T-275 DELIVERY COMPLETE - 2026-11-15:** Approved backend migration 20261115230945 deployed and verified; standalone APK 0.1.1 (2) built, validated, uploaded to Drive and download link emailed to enidualceel@gmail.com (SENT 1a1e180dcfbdccae). No bulk financial mutation. Physical-device acceptance remains for owner. See scratch/unified-loans-2026-11-14/report.md.

> **T-275 LIVE STATE - 2026-11-15:** Approved unified-loan migration APPLIED through Supabase connector to bitepxsdujceoszbldhd as remote version 20261115230945. Local filename aligned to that recorded version. Debts/bills/settings fingerprints unchanged. Anonymous EXECUTE denied; authenticated EXECUTE granted with existing internal owner/admin authority; unauthenticated invocation rejected before writes. APK build/delivery complete. This supersedes older local-only/unapplied/pending-approval statements for T-275 rollout.

> **Owner Standing Directives & Live State ? T-284 PARTIAL 2026-11-15:** Approved corrective rollout applied to bitepxsdujceoszbldhd as migration 20261115231628_safe_login_recovery_and_leave; invitation function v2 deployed verify_jwt=false. No bulk membership DML or financial mutations. Existing owner context rollback simulation passed. Zero-membership rollback simulation for Claudine stopped at legacy metadata safeguard; leave/fresh bootstrap is not fully verified and may be blocked for legacy metadata users. Hosted GET is text/plain with sandbox CSP, so landing page does not render as HTML. Physical sign-in remains unverified. Superseded draft and pre-change function definitions are in scratch/login-recovery-rollout-2026-11-15.

> **Owner Standing Directives & Live State - 2026-11-15 LOGIN RECOVERY / INVITATION DEPLOYMENT APPROVED:** Owner explicitly authorized: "Apply the login recovery migration and deploy the invitation function." Review live project bitepxsdujceoszbldhd and prepared migration 20261115061500_fix_leave_household_and_personal_bootstrap.sql, apply the scoped reviewed recovery migration, deploy send-household-invitation, and verify live results. This supersedes separate-approval/local-only holds for this recovery and invitation deployment only. Preserve financial records and unrelated migrations; no APK delivery or Resend/domain changes implied.

> **Owner Standing Directives & Live State - 2026-11-15 T-275 ROLLOUT APPROVED:** Owner explicitly approves applying the prepared unified-loan backend migration, building and validating a replacement standalone APK, backing it up to Google Drive, and emailing its download link to enidualceel@gmail.com. This supersedes local-only / separate-approval holds for these steps. Verify target project and deployed history first; apply only the reviewed unified-loan migration. Preserve financial records and unrelated migration work.

> **T-275 local completion - 2026-11-15:** Unified loan integration and corrective atomic-save contract implemented locally; typecheck, 73 focused tests and isolated SQL rollback checks passed. Hosted migration applied under owner approval; replacement APK delivery complete. See scratch/unified-loans-2026-11-14/report.md. Superseded partial SQL draft removed from migration discovery and preserved in scratch.

## Unified loan corrective contract â€” T-275
Canonical Mortgage/Auto DebtItem supplies Budget and one debt-kind scheduled obligation. Stored legacy bill IDs remain immutable historical aliases; no new companion recurring bill and no sequential mutable bill synchronization. Canonical conversion must preserve schedule history, acknowledgements, split plans and bill-tagged settlement exactly once. Unsafe Keep separate/unlink/removal controls are removed; historical ownership ambiguity fails closed. Existing divergent terms require validated explicit resolution; currency and mortgage escrow constraints apply. New positive loans require due day; legacy incomplete schedules are visible and editable. Unresolved identity makes Budget aggregates unavailable. Debt payments remains owner-defined card minimums plus extra.

Save contract: prepare schedule and optional escrow/legacy-resolution settings before dispatch, then persist debt + shared settings atomically under household role/membership/revision and debt-version checks. Existing authority RPCs can be composed transactionally by a scoped forward wrapper; any settings conflict raises to roll back debt write. Lost responses require exact row AND settings readback, never row-only success. Missing new RPC fails closed until separately approved deployment. Owner approved hosted apply on 2026-11-15; applied as migration 20261115230945. Do not stop solely because unrelated concurrent migration-script typecheck fails; report separate diagnostics while completing scoped work.
> **Owner model preference â€” 2026-11-14:** Do not use Gemini Hydrogen for these implementation/review tasks; owner finds it too slow. Prefer GPT-6.1 Terra for substantial work and GPT-6 Luna for small tasks. This supersedes the older complexity-based Hydrogen assignment for this work. Running Hydrogen correction task was cancelled; preserve its partial edits and continue the authorized unified-loan work.
> **Owner Standing Directives & Live State â€” 2026-11-14 unified Mortgage/Auto model:** Owner requests implementing mortgage/home-loan and auto/car-loan accounts as one obligation shown in Accounts > Home & Auto and Budget > Housing & Rent / Transportation respectively. Creating a loan from either location must automatically expose the same identity in both; edits/history/payments must not diverge or double-count. This supersedes user-managed pairing as the product model for these two loan categories. Preserve existing data/history; only validated stored pairings qualify for existing-record conversion, never names alone. Rent and non-loan housing/transport expenses remain expenses. Owner subsequently approved the reviewed hosted migration and replacement APK/Drive/email delivery on 2026-11-15. The migration is applied; no bulk financial merges/deletes are authorized.
>
> **Implemented locally (T-273, 2026-11-14):** `Mortgage` and `Auto loan` accounts use canonical `DebtItem` identity across Accounts (`Home & Auto`), Budget (`Housing & Rent` / `Transportation`), Upcoming/Scheduled, and Transactions without creating duplicate `RecurringBill` records. Non-loan housing/transportation items remain recurring bills. Validated consistent legacy pairs automatically route through the canonical loan in Budget while preserving `identityLoanBillPairs` for legacy bill-tagged transactions and atomic account deletion; divergent (`amount`/`dueDay` differs) or invalid legacy pairings remain unmerged for explicit user resolution on Home and Budget.
> **Connected dock IMPLEMENTATION APPROVED - 2026-11-09:** Owner approved design/navigation-connected-dock-2026-11-09.html with the label Add Transaction (singular). Implement its uniform icon family, equal selected capsules and attached action tier: Add Debt Account / Add Transaction / Add Monthly Expense; none on Home/Progress. Implement pull-to-refresh account/household data below the fixed main header through the existing safe reload path, preserving route/section/drafts/pending writes and honest errors. Remove duplicate scroll-end Add controls. Preserve all other approved layouts and financial rules. This explicitly supersedes earlier design-only holds for this dock and refresh scope only. Collaboration remains deferred; no live financial data mutations or backend deployment authorized.

## BitLess visual direction refresh (2026-11-12)

**BitLess visual direction refresh - 2026-11-12:** The owner supplied the actual logo palette: blue `#0051FB`, pale sky blue `#ABDFFD`, turquoise `#27EEE9`, mint `#98EDC1`, navy `#070D5B`, and white. Do not use pink in BitLess brand surfaces. Keep financial category and risk colors separate. This supersedes Indigo and Cobalt as the brand palette in visual studies. Existing native theme code remains unchanged until the owner approves implementation.

Show the BitLess name on Home only; other tabs use their tab title. On Progress, put the downward arrow and reduction percentage immediately to the right of the current balance amount. Omit the word â€œlowerâ€ and keep the adjusted-reference label and unavailable state clear.

Navigation icon review: redraw Home, Debt, Transactions, Budget, and Progress as one simple, clean, distinguishable family with shared scale, stroke weight, and rounded geometry. Keep the Debt card direction as a starting point; explore a ledger with opposing movement arrows for Transactions, a segmented allocation ring for Budget, and a light debt-decline trend for Progress. The concept board is `design/assets/bitless-navigation-icon-family-five-tabs-blue-20261112.png`. These remain proposals until the owner approves the icon set for implementation.


Design study only: the color and icon concepts do not change app code or financial rules. Update the native theme and navigation icons only after owner approval.

> **Connected dock study - 2026-11-09:** Owner requests every selected-tab capsule have the same size as Transactions and wants to see the Debt/Transactions/Budget action row attached to the navigation menu. Revise DESIGN ONLY, preserve uniform icon family and roomy controls; no application implementation until explicit approval.

> **Navigation study refinement - 2026-11-09:** Owner finds draft dock icons inconsistent, dislikes Home/Transactions/Progress symbols and finds buttons cramped. Revise DESIGN ONLY with one uniform icon family, replacement symbols and more generous icon/label/button spacing. This is not approval of the first draft and does not authorize app implementation.

> **Design-only request - 2026-11-09 (refresh/navigation/actions):** Owner wants pull-to-refresh household/account data from page content below the fixed main header, retaining page state rather than restarting the app. Propose a rounded floating bottom dock with larger icons and an expanded selected tab, plus a persistent single contextual action above it: Debt / Add Debt Account, Transactions / Add Transactions, Budget / Add Monthly Expense; no action on Home or Progress. Preserve five-tab order and current inner sections. This request authorizes DESIGN ONLY; no native app, refresh or navigation implementation before explicit approval. Collaboration remains deferred.

> **Home welcome and household editing - 2026-11-09:** Home header shows Hi, [real name] with no date or time-of-day greeting. Show a styled welcome greeting once on initial signed-in app open and each background-to-active return, with existing attention items/status; tab switches and dismissing child sheets must not retrigger it. Encourage only when no known attention items and data status supports that statement; loading/error/pending remain honest. Tighten carousel pagination visually while preserving accessible touch targets. Remove Home Edit Setup and Reload controls; existing users edit in dedicated app settings, never onboarding. Household gets its own editor with safe persisted settings and existing currency/data safeguards. Onboarding remains for new/reset households. Multi-member collaboration is a deferred next phase, maximum three people per household, after this UI work is accepted; do not begin implementation now.

> **Progress refinement - 2026-11-09:** Activity by account is a compact always-visible list: account identity, selected-period signed recorded net balance change, and entry count only. No starting/current balance, payment/interest breakdown or per-account expansion. Current month starts at zero recorded change; positive means net debt increase, negative means net decrease, zero neutral. Use existing ledger delta/period rules, exclude pending/deleted records as already defined; do not infer a payment allocation or complete history. Keep Payoff milestones permanently expanded with honest locked/history statuses. Headings retain approved inner text alignment, but Progress period and Debt category selector OUTER right edges align with card outer edges. This supersedes the earlier detailed account-metrics requirement; preserve other approved alignment.

> **Balance comparison clarification - 2026-11-09:** Home shows signed current-minus-entered-original balance change for the selected category, including increases; require all category references or show unavailable. This is a snapshot, not lifetime payments. Debt/Progress retain their adjusted-reference reduction measure, explicitly labeled and unavailable when originals are missing. No payoff or ledger formulas change.

> **Owner refinement - 2026-11-09 (alignment/carousel/help):** Align major text to consistent inner content rails: use the shared page gutter plus a consistent card/section inset; unboxed headings, totals and date headers must not drift to the outer card edge. Icon-led names may use a documented secondary column. Home Your accounts has no dropdown: swipe left/right between Cards & Loans, Home and Auto, with visible pagination and accessible alternatives. Show balance change directly with an honest entered-reference label and numeric/directional cue; never call snapshot comparison lifetime payment performance. Informational help uses a polished shared theme-aware sheet rather than generic system alerts. Preserve consequential confirmations and financial safeguards.

> **Latest owner correction - 2026-11-09:** Debt has Accounts / Strategy only; Scheduled belongs only in Transactions. This explicitly supersedes the 2026-11-08 both-tabs decision. Align page/section gutters, labels and right-hand amount columns throughout screens and forms; use readable Home countdown text and smaller decimal digits for prominent currency amounts. Budget summary Edit expands Income sources (individual rows open editors). Progress Activity by account is always visible, including its metrics; no expansion required. Preserve financial rules, category/risk colors, existing work and live-data safety.

> **Progress scope and wording refinement - 2026-11-11:** The balance comparison has exactly two scopes: Cards & Loans (selected by default; credit cards and personal loans) and Home & Auto (combined). Keep this category snapshot distinct from the overall selected-period ledger activity. Put the percentage and qualifier inline (for example, "20% lower") and identify the comparison as against the adjusted reference in the adjacent label. Do not change the underlying comparison, ledger, or payoff calculations. Continue the light/dark design review; obtain explicit approval before native implementation.

> **Progress visual bridge approved - 2026-11-11:** Owner approved the revised Light/Dark Progress concept in `design/progress-visual-bridge-2026-11-11.html` and authorizes native implementation. Use two balance snapshot scopes, Cards & Loans selected by default and Home & Auto combined. Scope selection changes the balance snapshot only; recorded activity and payoff target remain household-wide. Keep the percentage inline with its qualifier, preserve honest unavailable states, existing ledger/account-activity rules, and all financial calculations. This supersedes the preceding design-only hold for the Progress visual bridge.

> **Progress visual implementation refinement - 2026-11-11:** Replace visible â€œlower than adjusted referenceâ€ wording with a downward arrow when the adjusted-reference reduction is positive; show no downward arrow when the reduction is zero. Put Current balance immediately beneath the visual reduction indicator and keep the adjusted-reference label clear. Use a much larger, more polished circle graph and the approved stronger payment, metric, payoff-target, and account-activity surfaces. Preserve the two scopes and default, honest missing-reference states, household-wide activity and target, all financial calculations, and all account-activity rules. Do not change bottom tabs or navigation. This supersedes the preceding visible comparison wording.

> **Progress mockup fidelity correction - 2026-11-11:** Preserve the approved composition: a horizontal snapshot hero with the large circle on the right, reduction arrow/percentage on the left, and Current balance immediately below that cue; show adjusted reference as supporting information. Recorded activity uses the prominent payment total/count card followed by one grouped four-row metrics panel, with the compact target and account list below. Do not stack the circle above the balance or turn the metric rows into 2Ã—2 tiles. Keep all approved scope, formula, data, unavailable-state, activity-list, and category-color rules. Bottom tabs stay untouched. This supersedes the prior native layout arrangement only.


> **Current navigation decision:** Debt contains Accounts and Strategy only. Scheduled lives only in Transactions. Transactions contains History, Upcoming, and Scheduled. Budget has no standalone Upcoming or Scheduled section. The latest owner decision ledger supersedes historical layouts below.
# DebtFree: five-tab scope and worker plan

## Current owner decisions â€” 2026-11-08

Account lifecycle correction (2026-11-12): Confirm account deletion and permanently remove its exact account history; remove a recurring bill and bill-tagged history only when it is the active validated Mortgage/Auto pairing. Abort before mutation if any linked transaction or reconciliation reference also belongs to a different account or recurring identity. A paid-off account remains stored with its history in an Archived Â· Paid Off section only when a confirmed principal-reducing payment moves a positive balance to exactly zero; new or manually adjusted zero-balance accounts stay active, and restore of historical payments does not create archive state. Reopening an archived debt above zero removes its archived state. Exclude archived accounts from active balance snapshots, utilization, payoff, budget debt, and debt-obligation calculations; their exact uniquely paired recurring bill stops generating scheduled obligations. Uncertain deletion outcomes retain local records for review or authoritative reload.

Owner authorizes refined round-two implementation with Indigo and Cobalt under Accent color. Theme stays System / Light / Dark; accent persists separately per-user locally. Preserve category/risk colors, math and navigation; verify compact income and both accents/themes. No financial/backend mutations.

Round-two review: keep the proposed layout direction, reduce oversized form elements/spacing (especially income), and show several distinct brand identities in Light and Dark instead of predominantly green dark surfaces. Separate brand identity from category/risk colors. Independent model reviews and explicit owner approval precede any implementation.

Latest design review: owner requests a more distinctive whole-app premium overhaul, citing Monarch and Rocket Money, with tighter Debt spacing and equal Light/Dark quality. Prepare page-by-page before/after samples for approval before changing application UI. This is design authorization, not implementation approval; preserve existing behaviors and financial rules.

The owner approved the premium Debt/Progress direction in `design/premium-direction-2026-11-08.html`, subject to replacing the crooked text dropdown arrow with an aligned SVG chevron. Implement grouped Debt accounts and a single category filter, quieter Progress Overview, prominent used credit with existing target/risk cues, and the honest visual milestone path. Preserve financial definitions, navigation destinations and data limitations. This supersedes prior design-review hold language for those layouts.

Latest correction (2026-11-09): **Scheduled is present only in Transactions**; the earlier both-tabs instruction is superseded. Debt contains Accounts and Strategy only. Scheduled lives only in Transactions. Transactions contains History, Upcoming, and Scheduled. Budget Debt payments means entered credit-card minimums plus extra, shown once; Auto stays in its recurring category. First projected payoff allocations are not monthly minimums. Older broader Budget commitments and single-tab Scheduled placements are superseded.

## Owner-approved Transactions identity and filter behavior (2026-11-12)

- Stored debt-account and recurring-item IDs define transaction filter identity. Names are display-only; renaming preserves history, while a newly created item receives a new identity. Active mortgage/auto recurring-payment links share the debt account identity, and explicitly bill-marked activity appears in that account's transaction history. Standalone recurring items keep their own filter identity; credit-charged recurring activity remains discoverable under both the debt account and recurring item.
- The Transactions Filters icon opens one popup containing all Period, Account, and Transaction type radio choices. Users can stage selections for multiple groups, then Apply or Cancel; no filter choice opens a nested popup.
- Scheduled planned installments group by obligation in collapsed expandable cards. The informational split planner supports 2, 3, or 4 ordered dates on or before the actual due date, preserves saved two-installment plans, and keeps exact minor-unit totals. Ledger, obligation, budget, and payment rules do not change.

## Implemented locally: gross-income ratios and annual credit-card fees (2026-11-11)

T-161 authorizes the additive app implementation. TypeScript typecheck and focused checks pass; two independent source-only reviews are complete, and the restore-ID finding was fixed. The annual-fee migration was applied only to the owner-selected sandbox after authorization; remote schema and Android recovery are verified under T-168. Production deployment remains out of scope.

### Implemented decisions

- Gross income is optional per income source and uses that source's existing pay frequency. It is stored separately; existing amount fields and take-home totals are unchanged. The complete gross monthly total is unavailable until every active income source has a positive gross amount.
- Tracked debt-to-income is a separate Budget metric: listed minimum payments for positive-balance debt accounts divided by complete entered gross monthly income. It excludes payoff extra and is labeled as tracked accounts only. Existing category shares, including Housing & Rent, remain percentages of take-home income; this work does not imply complete lender underwriting or household coverage.
- Annual card fees are optional yearly schedules on credit-card accounts, visible in Transactions â†’ Upcoming and Scheduled. A reminder alone does not create a ledger entry. After the user confirms the charge posted, a stable account-plus-renewal identity records one fee transaction; the renewal advances only after the write is confirmed and can be safely retried after a partial failure.
- Optional gross income is preserved in settings and backup validation. Annual-fee fields are carried through debt persistence, backup/restore, and debt ID remapping. The forward SQL migration is `supabase/migrations/20261111194453_annual_card_fee_support.sql`; it received source review and was applied to the selected sandbox after owner authorization on 2026-11-11; production deployment remains out of scope.
- Calendar integrations, OS notification scheduling, automatic payments, bank connections, live data mutations, and backend deployment remain out of scope.

### Pre-implementation baseline and compatibility boundaries

- Primary and additional income sources already have editable names, amounts, and pay frequencies; the shared total is normalized to monthly take-home income. Budget category rows already display each entered category's amount as a percentage of that income.
- That Budget percentage is a cash-flow share, not lender-style debt-to-income (DTI). DTI requires gross monthly income. Do not relabel the existing metric or change its denominator. Do not derive DTI from `calculateMonthlyCashflow`, the Budget debt-payment commitment, payoff projections, or recorded ledger totals.
- Debt-plan Budget grouping is owner-defined as credit-card minimums plus entered extra, with auto and mortgage arrangements handled separately. Keep that grouping and all payoff, cash-flow, balance, and ledger calculations unchanged. Any DTI or housing measure must be a separate derived display with explicit inputs and definitions.
- Before T-161, actual card fees could be recorded in Transactions, but a card did not store an expected annual fee or renewal date. Current recurring bills are monthly; they are not an annual-fee schedule. Notification settings save preferences only; background scheduled notifications remain deferred.
- Debt account terms and recurring bills have database encoders, while income and household preferences use revision-checked settings persistence. Backups validate income, debt, bill, and transaction fields; any new optional fields or schedule records must be included in backup/restore validation and lifecycle cleanup. Do not infer a fee, date, payment, or notification from existing history.

### Implementation approach and boundaries

The original staged outline below guided T-161; the concrete choices and status above supersede its earlier open questions.

1. **Lock definitions before coding.** Keep existing take-home income as the budget denominator. Add optional gross income as a separate, clearly labeled input; do not overwrite or reinterpret existing amounts. Decide whether gross is entered per income source or as a household total, what counts as complete, which required monthly debt payments feed DTI, and whether the housing figure is a housing-cost share, a housing debt ratio, or both. Show DTI as unavailable until the required gross inputs and obligation coverage are known; never silently fall back to take-home income. Label the existing Housing & Rent share accurately.
2. **Add isolated domain calculations and optional data.** Implement a pure DTI/category-ratio selector with explicit inputs, completeness, currency, and period assumptions. Preserve existing income normalization and payoff/cash-flow functions. Keep missing optional gross values missing (not zero) and preserve old profiles/backups. The DTI must use the approved required-payment definition, not accelerated payoff amounts or confirmed payment transactions.
3. **Plan the annual fee as a separate yearly obligation.** Store an optional annual fee amount and next renewal date tied to a credit-card ID. Derive one yearly item for Transactions â†’ Upcoming/Scheduled, keeping the five-tab order and Scheduled only in Transactions. Do not represent it as a monthly bill, auto-post it, change a balance, or count a fee as paid when a reminder arrives. On user confirmation that it was charged, record one linked fee transaction and advance the next renewal date without duplicating a cycle. Use a stable card-plus-renewal-cycle identity and idempotent confirmation/recovery so a pending write, retry, or partial failure cannot create duplicate fees or lose the due date. A monthly-equivalent set-aside is a separate optional budget display and must not be added to the existing debt commitment without an explicit product decision.
4. **Wire safe persistence and recovery.** Reuse revision-checked settings persistence where suitable; assess whether the annual schedule belongs in optional debt metadata or needs a dedicated record before choosing storage. Update account deletion/edit cleanup, backup validation/export/restore, stable-ID remapping, and pending-write/error behavior together. Treat absent fields in old settings and backups as unavailable. Any required database schema/RPC work needs a reviewed forward migration and separate explicit authorization; no live deployment is implied.
5. **Integrate screens after contracts are stable.** Add gross input and ratio labels to the existing Budget income flow, preserving its collapsed Income sources accordion and individual editors. Add annual-fee fields in credit-card details, not onboarding. Reuse Transactions chronological Upcoming/Scheduled patterns and existing confirmation safeguards. Do not add a Debt Scheduled section or alter navigation.
6. **Notifications are a separate capability gate.** First make the annual cycle visible in Upcoming/Scheduled. Existing notification preferences do not schedule OS notifications. Background reminders require platform scheduler support, permission/state handling, time-zone and date-change behavior, and explicit scope before implementation; do not claim notifications work from the preference toggle alone.

### T-161 acceptance criteria

- Existing net/take-home income, monthly category percentages, debt-plan grouping, payoff estimates, account balances, transaction history, and scheduled payment matching retain their prior meanings and results for existing records.
- New ratios are separate, correctly labeled, unavailable when required inputs/coverage are missing, and use only the owner-approved formula. Annual fees appear at most once per renewal cycle; a due reminder alone creates no ledger mutation or balance change.
- Existing profiles and backups load with the new optional data absent. Add/edit/delete, pending writes, account-ID references, backup/restore, and schedule edits preserve safe recovery semantics.
- UI continues to follow the current decision ledger. No live financial data changes, backend deployment, bank connection, or automatic payment initiation.

Read [the current UI decision ledger](./references/UI_PREFERENCES.md) before screen changes. It supersedes conflicting historical statements below. Preserve the current native palette/style and horizontal tab placement. Budget shows Monthly Income with a concise Edit button, category-colored allocation bar, and collapsed Income sources; editing is available directly or from source rows. Remove redundant explanatory prose; retain essential financial/status/safety information. Upcoming lives only under Transactions, grouped by month/year then due date; reuse the working Budget flow and remove its obsolete Budget view and competing Transactions implementation. Scheduled lives only in Transactions; Strategy remains only in Debt. Home shortcuts follow those destinations. Do not add a standalone Upcoming shortcut to Budget. Do not restore prototype navigation or older task routing.

## Owner-approved Budget and pairing corrections (2026-11-07)

- Restore the Home debt-free estimate hierarchy (title, subtitle, estimate badge, date, months remaining, divider, and progress) and remove only the unwanted entered-debts wording.
- Remove the standalone spending card. Keep month navigation with the Monthly Budget Breakdown; place recorded single purchases in that breakdown as a separate actual-spending row. Hide categories with no source records, even if their computed amount is zero.
- Edit primary and additional income from a dedicated Budget popup; do not route to onboarding. Add/edit debt from a real modal. Use one shared, theme-aware bottom-sheet frame for Budget income, recurring-bill, and debt forms.
- Mortgage/auto loan to debit recurring-bill links are explicit, persistent, user-confirmed settings. Suggestions never auto-link. Support manual link/unlink, mark-separate, and dismiss choices; surface unresolved reviews on Home. A link changes only commitment/reminder grouping: it does not create ledger rows, alter a payment, or change a balance. One bill reminder represents the shared monthly cycle; an existing linked account payment can satisfy that cycle by month. For auto loans, the recurring bill replaces the minimum inside the shared payoff-plan commitment total; mortgage projections remain standalone and the linked recurring bill is their budget commitment. Account terms stay unchanged, and escrow/principal components are never inferred.
- Persist link and income edits through the existing revision-checked settings save path. This local change does not authorize live prototype or production mutation, app builds, or device work.

## Owner-approved remediation update (2026-11-07)

The owner authorized local implementation of the reviewed audit plan in `docs/APP_AUDIT_AND_COMPLETION_PLAN_2026-11-07.md`, with these overriding decisions:

- New debt and bill tracking starts today or later. A due day already passed in the household's current month starts next month. A new obligation due today asks whether this cycle was already paid; Yes records a cycle acknowledgement without inventing a ledger transaction or changing the debt balance. The acknowledged cycle does not generate an upcoming reminder.
- Persist first-due dates and effective monthly terms; edits must not rewrite prior obligations. Home, Budget Upcoming, Budget Scheduled and payment matching must consume the same schedule.
- Separate one-time budget entries are no longer required. Single purchases belong in Transactions and can be summarized by category/month in Budget as recorded spending, separately from recurring and debt-plan commitments, without double counting.
- GPT-6.1 Terra Medium and GPT-6 Luna Max are approved workers for this work. Every handback needs manager review and corrective follow-up before acceptance.

Current assignments and evidence are in `TRACKER.md`. Historical completion labels below remain historical. A server-side atomic backup-restore protocol and forward migration now exist and pass a synthetic two-user check on local scratch, but they have not been deployed to the chosen Supabase project and the app client adapter remains unwired. Keep restore unavailable; do not simulate success through state-only imports. Live prototype/production mutations and public publication are outside this local implementation work. Existing iOS, signing, production-service and store gates remain explicit.

## Financial foundation planning update (2026-11-04)

Read [NATIVE_FINANCIAL_PLAN.md](./NATIVE_FINANCIAL_PLAN.md) before assigning financial implementation. The user clarified that the prototype is a reference, not a rule; its calculations and the existing calculation guide require independent evaluation. The new plan records observed risks, decisions, shared contracts, proposed task dependencies and targeted acceptance scenarios. It supersedes earlier recommendations to copy prototype formulas automatically. This update authorizes no implementation, worker dispatch, bank integration or schema change.

Recorded: 2026-11-03. Execution: next working session (tomorrow, as requested).
Resumed: 2026-11-04 at the user's request. Icon choice: **Option B â€” Confident Solid / Sculpted Silhouette**, as shown in design/icon-directions.html. Apply this family to the native app; the palette is still undecided.
Manager: GPT-6.1 Sol High. Status and assignments: [TRACKER.md](./TRACKER.md).

## Confirmed product direction

Local visual reference: [prototype screenshot index](./references/prototype/README.md), containing 16 signed-in Brave screenshots captured on 2026-11-04.
Mathematical & architectural reference: [prototype calculations guide](./references/PROTOTYPE_CALCULATIONS.md), detailing the amortization engine, priority ordering, minimum payment formulas, and ledger/milestone logic from [github.com/ensong0608/debtfree-dashboard](https://github.com/ensong0608/debtfree-dashboard). Cloned locally at `references/prototype-repo/` (git-ignored). Use these alongside the requirements below; the prototype colors and icons do not override the user's native design decisions.


Bottom navigation, in this exact order: **Home -> Accounts -> Transactions -> Budget -> Progress**. The Accounts tab retains the internal debt route and Accounts / Strategy sections; its contextual action remains Add Debt Account.

The prototype at https://debtfree-dashboard.ensong0608.workers.dev/ is a functional reference. Its color scheme is not an approved native-app design. The user will specify visual preferences and dislikes later. This scope is a foundation, not an exhaustive specification. Other prototype features are not automatically requirements.

| Tab | User-confirmed purpose and content |
| --- | --- |
| Home | Payoff strategy summary, recent activity, upcoming bills, and estimated debt-free date based on the strategy. Also intended to accommodate promotions, brand partnerships, offerings, and other future content. |
| Debt | All debt accounts: cards and personal loans, home, and auto. |
| Transactions | All household account activity, including checking/savings, everyday purchases, and debt accounts, with appropriate labels/categories. Sources remain to be established. |
| Budget | Income, recurring spending, one-time spending, and strategy-based debt-payment totals. Display amounts entered by the user; do not invent an additional planned/actual split. |
| Progress | Debt paid down, payments made, and accounts paid off for the current month, previous month, and lifetime. Historical sources remain to be established. |

## Existing starting point

README.md describes existing sign-in, sign-up, onboarding, and Home functionality. Relevant files include App.tsx, src/OnboardingAndHome.tsx, src/onboarding-domain.ts, and src/onboarding-storage.ts. Existing working-tree edits must be preserved. This is a documentation/file-inventory baseline, not a fresh verification of app behavior.

## Worker sequence

Proposed implementation worker: GPT-6.1 Terra High. Assignments and exact file boundaries must be finalized before dispatch; no workers are started by this plan.

### T-003: Map existing behavior and shared data needs

- Read existing implementation and map reuse/gaps for debts, household transactions, income, spending, bills, payoff strategy, and historical statistics.
- Propose shared data contracts and identify missing capabilities and product decisions before dependent implementation. Do not invent financial rules.
- Targets: APP_PLAN.md and TRACKER.md; read App.tsx and relevant src files.
- Acceptance: each tab maps to existing or missing data; dependencies, proposed target files, and decisions are documented.

### T-004: Five-tab app shell

- Depends on T-003. Add the five tabs in the confirmed order after the existing authenticated/onboarded entry flow.
- Use current styling provisionally, with visual choices easy to revise later.
- Proposed targets: App.tsx, src/OnboardingAndHome.tsx, and a dedicated navigation/screen module if needed; confirm after T-003.
- Acceptance: all five tabs are reachable and the existing entry flows remain connected.

### T-005: Debt

- Depends on T-003 and T-004. Present debt accounts covering cards/personal loans, home, and auto; reuse existing account and payoff logic where applicable.
- Targets: Debt screen and shared account modules identified in T-003.
- Acceptance: the agreed categories and account information render from the agreed source, with honest empty/unavailable states.

### T-006: Transactions

- Depends on T-003 and T-004, plus agreement on household account coverage and sources.
- Present household transactions using the agreed data contract and scope.
- Targets: Transactions screen and shared transaction modules identified in T-003.
- Acceptance: supported household transactions appear consistently; unavailable sources/history are explicit. Bank integration and transaction-entry workflows require separate scope.

### T-007: Budget

- Depends on T-003 and T-004, plus agreed spending and strategy data.
- Show income, recurring spending, one-time spending, and strategy-based debt-payment totals.
- Targets: Budget screen and shared calculation modules identified in T-003.
- Acceptance: all four components are distinct, totals reconcile to source records, and debt payments agree with the selected strategy. Settle planned versus actual treatment before dependent calculations.

### T-008: Progress

- Depends on T-003 and T-004, plus agreed metrics and historical data.
- Create an encouraging household statistics view for current month, previous month, and lifetime.
- Targets: Progress screen and shared historical summary modules identified in T-003.
- Acceptance: all three periods are available, approved statistics use consistent period definitions, and missing history is not replaced with invented progress.

### T-009: Home

- Depends on the shared data from T-003 and relevant Debt, Transactions, and Budget work.
- Compose strategy summary, recent activity, upcoming bills, and the strategy-derived debt-free date from the same sources used by the detailed screens.
- Accommodate future promotions/partnerships/offerings in the layout plan. Commercial content must be supplied and scoped before implementation; do not invent brands or offers.
- Targets: Home screen and shared summary modules identified in T-003.
- Acceptance: the four core summaries agree with the underlying screens and strategy; unavailable data/estimates have honest states.

### T-010: Manager review and closeout

- Owner: GPT-6.1 Sol High. Depends on T-004 through T-009.
- Review the agreed scope, cross-screen consistency, and financial definitions.
- Acceptance: TRACKER.md records completed work, modified files, checks actually performed, and outstanding decisions without claiming unverified behavior.


## T-003 implementation map (2026-11-04)

Source inspection only; no runtime or backend verification. `App.tsx:35` owns session, onboarding data and stage, passing them to `src/OnboardingAndHome.tsx:179` at `App.tsx:336`. Completed onboarding resolves to `home` (`src/onboarding-domain.ts:258`), the final flow branch (`src/OnboardingAndHome.tsx:2261`); no tab navigator exists. Preserve entry, revalidation, sign-out and Edit Setup when adding navigation.

| Tab | Available and reusable | Missing or limited |
| --- | --- | --- |
| Home | Dashboard presents active debt, income, strategy, target, payoff order and estimated date; strategy can be changed (`src/OnboardingAndHome.tsx:2261`). Reuse `calculatePayoffPlan` and `calculateTotalMonthlyIncome` (`src/onboarding-domain.ts:496`, `:207`). | No recent transaction activity or upcoming bill collection. A debt due day is not a dated bill or proof of payment. No promotion content. |
| Debt | `DebtItem` covers card, personal, mortgage, auto and other categories, balance, APR, minimum, optional original balance, due day and credit limit (`src/onboarding-domain.ts:74`, `:93`); editor and storage support add/edit/delete (`src/OnboardingAndHome.tsx:282`, `:326`, `:371`; `src/onboarding-storage.ts:181`, `:242`). | Home uses positive-balance payoff order, not all debt records. Need an all-accounts view and honest empty states. Manual data is not a verified complete household inventory. |
| Transactions | No transaction records or source in inspected `src` modules. | Coverage, source, ownership, history, sign convention, dates, categorization and transfer/debt-payment treatment need decisions and a contract. Bank sync and transaction entry are not authorized by this plan. |
| Budget | Onboarding stores primary and additional incomes and frequencies; normalization is a monthly equivalent (`src/onboarding-domain.ts:61`, `:117`, `:192`). The payoff plan exposes minimums, extra and monthly plan (`:465`, `:496`). | No recurring or one-time spending records or actual income/payment ledger. Planned payment is not actual payment. Planned/actual treatment and period reconciliation remain undecided. |
| Progress | A snapshot `progressPercent` uses active balances and optional original balances (`src/onboarding-domain.ts:502`); Home displays it (`src/OnboardingAndHome.tsx:2343`). | No month/lifetime history, payment events or approved metrics. The percentage excludes zero-balance debts and may use current balance as starting balance; it cannot establish historical household progress. |

Storage caveats: `src/onboarding-storage.ts:84` chooses newer local or user metadata and attempts to merge debt rows; an empty response retains cached debts, and failure falls back silently. Database fields are limited; missing category can be inferred from name and missing original balance defaults to current balance (`:42`, `:52`, `:122`). The loader does not expose freshness, completeness or reliable empty/error status. `householdId` is generated from the user ID (`src/onboarding-domain.ts:221`), not evidence of shared household access. No backend changes are approved by this mapping.

### Shared contract recommendations

- Keep `UserOnboardingData`, `DebtItem`, validation and persistence as existing sources. Share one derived `PayoffPlanResult` from `calculatePayoffPlan` across Home, Debt and Budget. Its monthly budget is minimums plus extra; it applies monthly APR/12 interest, minimums and strategy-priority allocation, stopping on stalled payoff or 600 months. `monthlyTotalPayment` is a planned budget; summed `firstMonthPayment` can be lower when balances are exhausted. Empty debt returns â€œDebt-free nowâ€ and an extra-only monthly total, so distinguish truly known empty from unavailable.
- Propose `src/financial-data.ts` for screen-facing availability: loading, available (including genuinely empty), unavailable/error and partial/stale, with source, as-of and coverage when known. The current loader cannot supply every distinction without separately scoped changes; do not assert them. Pass shared data and update callbacks through the shell rather than create competing stores.
- After source and coverage decisions, define account and transaction records with stable IDs, household/account association, currency, amount/sign, transaction and posting dates, status, category and source/coverage. Model transfers and debt payments explicitly to prevent double counting; distinguish recorded activity from projections.
- Budget needs period, planned versus actual, income, recurring and one-time expenses, strategy payments, source links and an overlap policy. A bill needs due date, amount, source/account and payment status; `dueDay` is only an optional hint. Progress requires approved metrics, period boundaries/time zone, historical source and completeness; never infer history from snapshots. Use the existing country currency and `formatCurrency` (`src/onboarding-domain.ts:43`, `:180`) consistently; decide cross-currency policy before aggregation.

### Proposed sequence and ownership

Paths are proposals for manager-finalized briefs, not existing files. Work sequentially where ownership overlaps.

1. **T-004 shell:** `src/OnboardingAndHome.tsx` retains entry flow and supplies state/actions; new `src/FiveTabShell.tsx` owns the ordered tabs and safe-area navigation; new `src/screens/` modules provide honest placeholders. Touch `App.tsx` only if wiring requires it. Establish `src/financial-data.ts` only for agreed contracts; avoid persistence changes.
2. **T-005 Debt:** `src/screens/DebtScreen.tsx`; reuse domain and existing editor/save/delete handlers. Extract `src/components/DebtEditor.tsx` only if needed; coordinate `src/OnboardingAndHome.tsx` and shell callback wiring. Depends on T-004 and manual-source limitations.
3. **T-006 Transactions:** `src/screens/TransactionsScreen.tsx` and, after agreement, `src/transactions-domain.ts` for contracts/selectors. Depends on T-004 and coverage/source decisions. Without an authorized source show unavailable; integration and entry need separate scope.
4. **T-007 Budget:** `src/screens/BudgetScreen.tsx` and, after definitions, `src/budget-domain.ts` for aggregation. Depends on T-004, shared income/payoff and spending and planned/actual decisions; coordinate transaction contract for actuals.
5. **T-008 Progress:** `src/screens/ProgressScreen.tsx` and, after agreement, `src/progress-domain.ts` for period selectors. Depends on T-004, metrics, historical source and period definitions; no substitute snapshot history.
6. **T-009 Home:** `src/screens/HomeScreen.tsx` and optional `src/home-summary.ts` compose shared plan, activity and dated bills; wire through `src/FiveTabShell.tsx` and migrate Home UI from `src/OnboardingAndHome.tsx` without losing strategy/edit actions. Depends on T-005â€“T-007 and availability of activity/bill contracts; commercial content is unprovided.

### Option B icon integration

Option B is implemented in `src/components/AppIcon.tsx` with selected solid silhouettes and inactive outlines, reusable color/size props and decorative accessibility treatment. `react-native-svg` 15.16.0 is installed. T-004 uses these shapes for the ordered five-tab shell. TypeScript checks passed for both tasks; native rendering awaits T-014. The 2026-11-12 owner direction establishes the brand palette for design studies; native theme implementation still requires approval.

### Initial screen implementation boundaries (2026-11-04)

T-005â€“T-009 now proceed sequentially under the finalized TRACKER.md brief. Render the stored debts, entered income and shared strategy projection; implement dedicated unavailable states for transaction records, recurring/one-time spending, history, recent activity and dated bills. Do not infer zero spending, empty verified history, a real bill schedule or complete household coverage from absent sources. New entry/import workflows and backend changes remain outside this initial screen pass. Record these limitations at closeout rather than presenting the initial screens as complete data integrations.

### Initial screen pass completed (2026-11-04)

T-005â€“T-009 implement dedicated screens using the existing onboarding snapshot and shared payoff plan. Debt includes zero-balance records and existing editing; Budget normalizes entered income and displays the strategy payment; Progress exposes the approved periods and metrics with unavailable history; Home retains its controls and shows unavailable activity and bills. Transactions covers the intended household categories in its unavailable state. These screens do not supply transaction, spending, dated-bill or historical-event sources, and manual records are not a verified complete household inventory. The Home percentage is a balance snapshot, not verified historical progress. Future commercial content remains an accommodation only. Typecheck passed; native runtime and layout remain unverified until T-014 (T3 device access setting blocked).

### Prototype layout & style merge completed (T-016 & T-017, 2026-11-04)

Inspected the 16 prototype screenshots in `references/prototype/2026-11-04/` (`T-016`) and merged the prototype's structural layouts, fixed headers, sub-navigation segmented pills (`History`/`Scheduled`, `Budget`/`Upcoming`/`Strategy`, `Overview`/`Utilization`/`Milestones`, `Cards & Loans`/`Home & Auto`/`All Debts`), SVG donut rings and semicircular gauges, horizontal progress bars, search/sort controls, floating `+` action buttons, and card hierarchies into the five native tabs (`T-017`). Preserved the native dark charcoal/teal/terracotta palette, extended the Option B vector icon set (`chevronRight`, `chevronLeft`, `search`, `sort`, `user`, `calendar`, `flag`, `info`, `filter`), exposed optional `originalBalance` and `creditLimit` inputs in the shared debt editor, and maintained honest `Unavailable` states where transaction, spending, dated bill, and historical event sources are not connected yet. `npm.cmd run typecheck` passed (`0` errors).

## Decisions confirmed on 2026-11-04

1. Transactions include checking/savings, everyday purchases, and debt-account activity; label and categorize them appropriately. Coverage is approved, but bank sync and transaction-entry workflows still require separate scope under this plan.
2. Budget shows whatever amounts the user entered. Preserve entered amounts and existing income-frequency normalization; distinguish strategy-based debt payment estimates from recorded payments. No inferred planned/actual duplication or automatic purchase imports.
3. Progress leads with debt paid down, payments made, and accounts paid off across all three agreed periods. Use recorded history; do not infer monthly/lifetime performance from debt snapshots.
4. Option B native renderer: use react-native-svg at the installed Expo SDK's bundled version (15.16.0 in node_modules/expo/bundledNativeModules.json). T-011 may add this dependency and port the approved paths. This is an implementation choice within the approved icon work.
5. Mortgage set aside (updated 2026-11-04): Do not include or display Mortgage in the active payoff strategy, onboarding debt entry, or Debt/Home/Budget/Progress category views for now (it may receive its own dedicated page later). Consumer debts and Auto loans remain active and accelerated; category segments use `Cards & Loans`, `Auto`, and `All Debts`.

Color palette, typography, detailed layouts, commercial content, and additional features await user direction. These choices do not block this plan or the initial implementation mapping.

## Boundaries for every worker

- Read AGENTS.md, this plan, and the assigned TRACKER.md task. Manager finalizes exact target files, acceptance criteria, and assignment before dispatch.
- Work only within the task. Preserve existing edits. No unrelated refactoring, production-data access, or prototype-data imports.
- Do not infer approval for backend migrations, live bank sync, billing, promotion services, or extra workflows from this plan.
- No new tests, full test suites, emulator launches, or builds unless explicitly included in the finalized task or strictly necessary as a targeted check. This planning-only update needs no tests.
- Work sequentially until shared file ownership is clear. Parallel tasks require disjoint files and agreed data contracts.
- On a blocker, record BLOCKED with the exact reason in TRACKER.md, stop, and notify the manager. On completion, record DONE, modified files, and a concise handback, then stop.
- This document neither launches workers nor schedules automatic execution. Resume and dispatch in the next requested working session.

### T-079 owner correction and implementation (2026-11-07)

The owner's latest instructions supersede the 2026-11-04 Mortgage exclusion decision for onboarding. First-time or reset onboarding now includes a Home / Mortgage account entry; completed-account Setup edits do not acquire new onboarding routes or auto-create linked bills. An Auto loan or Mortgage entered during initial onboarding creates one debit recurring spending item with a stable ID shared with the debt, a preserved due-date schedule, and an explicit linked relationship. Retries reuse IDs and skip unchanged debt writes. An existing bill row is reused only after authoritative confirmation; unresolved rows block another bill write until Finance Recovery confirms the server state. The recurring record does not create a payment transaction or mutate the debt balance. Linked Auto minimums are offset once from the payoff-plan commitment, and a linked bill provides the single reminder.

Loan payment review now lives on Home. Confirmed links do not appear as a Needs attention notice. Debt Detail and the recurring spending editor show the relationship and provide unlink controls. Custom names entered for the Other recurring spending category remain metadata keyed by recurring bill ID through the existing settings CAS, reload, backup, and restore paths; Budget groups same-label bills while the stored recurring bill category remains `other_bill`.

Focused source tests passed (23 checks across loan pairing and retry recovery, budget grouping, backup recovery, and onboarding domain) and `npm.cmd run typecheck` passed. No live services, device, build, or dependency changes were used. Runtime visual behavior was not exercised. The owner prohibited subagents, so no independent delegated review was run; implementation was self-reviewed against this plan and the required prototype references.


**Owner-approved T-190 refinement (2026-11-12):** Transactions account filters use a fixed-height two-column scrollable radio grid without the synthetic checking/debit account; debit-only remains a transaction type. Planned installment groups match scheduled cards, expose editing, and explain returning to one monthly payment. Progress payoff target opens Accounts / Strategy; Utilization uses the prototype summary, circular gauge, and individual card-review hierarchy with existing calculations and colors.

> **T-193 preference (2026-11-12):** Destructive removal actions require an item-specific Cancel / confirm prompt; cancellation makes no changes. Progress section tabs show only the selected underline, without a full-width baseline. Account-history deletion and archiving remain blocked under T-192.


> **Owner correction (2026-11-13):** On shared inner-section selector rows (including Accounts / Strategy), remove the full-width baseline separator and keep only the selected section underline. Preserve labels, typography, row height, horizontal placement, and selection behavior.

> **Owner Standing Directives & Live State — T-284 2026-11-15:** Implement and deploy a durable personal-only profile v2, seeded only from validated whitelisted legacy personal fields; retain v1 unchanged as backup. Verified household settings alone govern financial settings and currency. Owner authorizes scoped backend migration and a final verified standalone replacement APK after targeted verification. No live financial mutations or email sends. Invitation landing and function v3 remain deployed. Email configuration requires a management token; do not repeat the timed-out secure card unless asked. Implementation and end-to-end verification remain incomplete.

> **T-284 backend slice live 2026-11-15:** Migration 20261115234316 deployed durable personal profile v2; v1 remains frozen backup and household settings remain authoritative. Four legacy envelopes seeded; focused rollback checks passed. Overall T-284 remains in progress pending client integration and end-to-end verification.




