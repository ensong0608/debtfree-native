# Project Tracker (`debtfree-native`)

> **Single Source of Truth for Manager & Worker Agents**
> - **ðŸ§­ Managers** (`gpt-6.1-sol` High / `claude-opus-5-5` High): Create tasks below, assign a Worker (`gpt-6.1-terra` High or `gemini-4-argon` High), and review completion.
> - **ðŸ› ï¸ Workers** (`gpt-6.1-terra` High / `gemini-4-argon` High): Follow the instructions for your assigned Task ID, update Status (`IN_PROGRESS` -> `DONE` or `BLOCKED`), log touched files & notes, and stop immediately when finished or blocked.

---

## Active & Recent Tasks

### T-018: Connect prototype repo and document calculation architecture

- **Status**: `DONE`.
- **Manager / Worker**: Gemini 3.8 Flash (direct execution).
- **Request (2026-11-04)**: Connect to `https://github.com/ensong0608/debtfree-dashboard` (the web prototype repo), analyze how its calculations, amortization engine, priority ordering, ledger, and progress work, and document them in the project for future agent reference.
- **Actions taken**:
  - Cloned `https://github.com/ensong0608/debtfree-dashboard` into `references/prototype-repo/`.
  - Added `references/prototype-repo/` and `metro.log` to `.gitignore` so external files do not pollute the native git working tree.
  - Inspected core calculation files: `app/payoff-engine.ts`, `app/debts-screen.ts`, `app/payoff-calculator.ts`, `app/quick-payoff-calculator.tsx`, `app/progress-balances.ts`, `app/progress-report.ts`, `app/budget-view.ts`, and `app/dashboard-data.ts`.
  - Authored comprehensive architectural reference document at `references/PROTOTYPE_CALCULATIONS.md` outlining the exact mathematical formulas (interest rates, promo APR mechanics, auto-estimated minimum payments, amortization simulation loop, tiebreakers, ledger reconciliation, and milestone thresholds).
  - Updated `AGENTS.md` and `APP_PLAN.md` with links and guidance for future agents.
- **Targets / touched files**: `references/PROTOTYPE_CALCULATIONS.md` (new), `.gitignore`, `AGENTS.md`, `APP_PLAN.md`, `TRACKER.md`.


### T-017: Merge prototype styles and screen layouts into native five-tab app

- **Status**: `DONE`.
- **Manager**: Gemini 4 Argon High.
- **Assigned worker**: GPT-6.1 Terra High via `delegate_task` (with manager completion pass).
- **Request (2026-11-04)**: Merge the prototype's structural layouts, component styles, sub-navigation, rings/bars, search/sort controls, and card hierarchies from `references/prototype/2026-11-04/` into our native five-tab app while preserving our dark teal/terracotta native palette, Option B vector icons, existing auth/onboarding/persistence, and honest data-availability boundaries.
- **Targets / permitted writes**: `src/components/AppIcon.tsx`, `src/components/FinancialScreen.tsx`, `src/FiveTabShell.tsx`, `src/OnboardingAndHome.tsx`, `src/screens/DebtScreen.tsx`, `src/screens/TransactionsScreen.tsx`, `src/screens/BudgetScreen.tsx`, `src/screens/ProgressScreen.tsx`, `APP_PLAN.md`, and this `T-017` entry in `TRACKER.md`.
- **What to do**:
  1. **AppIcon & Shared Layout (`src/components/AppIcon.tsx`, `src/components/FinancialScreen.tsx`, `src/FiveTabShell.tsx`)**:
     - Add needed Option B vector icons (`search`, `sort`, `chevronRight`, `chevronLeft`, `user`, `calendar`, `flag`, `info`, `filter`) matching the existing Option B style.
     - Upgrade `FinancialScreen` to provide a fixed prototype-style top header bar (screen title at left, optional right action/settings control, optional segmented sub-navigation pill bar below the title), scrolling content container, and optional floating `+` action button positioned cleanly above the bottom tab bar and sandbox Reset button.
     - Allow `FiveTabShell` to support programmatic tab navigation (e.g., `See all â€º` on Home navigating to Debt or Transactions, or Budget `Strategy` sub-tab).
  2. **Home (`src/OnboardingAndHome.tsx`)**:
     - Fixed top header with DebtFree brand at left and profile/setup & sign-out controls at right.
     - Personalized greeting (`Hi, [name]` derived from `session.user` metadata/email or `"Hi, there"` + `"Your debt-free journey"` subtitle).
     - **"Your debt-free date" card**: heading + `ESTIMATE` badge, category scope subtitle (`Cards & Loans Â· includes auto` or active categories), large projected month/year at left + vertically divided `months to go` count at right, segmented horizontal progress bar, and `"Keep building your freedom."` caption.
     - **Category summary ring card**: `<` and `>` category selector (`All Debts`, `Cards & Loans`, `Home & Auto`), circular SVG progress ring showing reduction % (labeled as balance snapshot), and stacked `Paid:` (from `originalBalance - balance` snapshot) and `Balance:` amounts on the right.
     - **Payoff strategy card**: heading + `See all â€º` link (switches to Debt or Budget Strategy), subtitle (`Avalanche` or `Snowball` + active scope) with inline strategy toggle pills (`Avalanche` / `Snowball`) and `+ Add debt` action, followed by divided ranked rows (`#1`, `#2`, ... badge, category icon badge, account name + APR & planned monthly payment on left, estimated payoff month/year pill + Edit/Remove actions on right).
     - **Recent activity** and **Upcoming bills** cards matching the prototype's card header (`Recent activity` / `Upcoming bills` + `See all â€º`), retaining honest unavailable states inside the structured card layout.
  3. **Debt (`src/screens/DebtScreen.tsx`)**:
     - Fixed top header (`Debt` + settings/setup gear) and 3-part segmented control (`Cards & Loans`, `Home & Auto`, `All Debts`), plus quick filter or inclusion of all stored accounts (including zero-balance accounts).
     - **Category total card**: selected segment label and large total balance at left; downward-arrow reduction-percentage badge (`[X]% snapshot`) at right.
     - **Search & Sort row**: working `Search debts` text input with search icon, and working sort selector pill (`Name`, `Balance`, `APR`, `Payoff`) with sort icon and chevron.
     - **Stacked account cards**: category icon badge at left; account name and `[Category] Â· [APR]% APR` in center; balance and chevron/actions at right; full-width horizontal reduction progress bar underneath; `[percentage]% reduced (snapshot)` + `Min: $X/mo Â· Plan: $Y/mo` at bottom left and projected payoff month/year pill at bottom right, plus accessible `Edit` and `Remove` controls.
     - Floating circular `+` button at lower right (and accessible add button) that opens the shared inline debt editor.
  4. **Transactions (`src/screens/TransactionsScreen.tsx`)**:
     - Fixed top header (`Transactions` + setup gear) and centered `History` / `Scheduled` segmented control.
     - On `History`: side-by-side period selector pill and account selector pill (`All accounts` + user's stored debt account names + household checking/savings coverage note), explanatory line (`Totals for selected period and account Â· before search and type filters`), 3-column totals strip (`Payments`, `Interest & fees`, `Adjustments` showing `â€”` / `Unavailable`), `Net balance change` card with info icon and `Unavailable`, search/type/sort filter bar, and a structured empty/unavailable activity card explaining that household transaction records (checking/savings, everyday purchases, transfers, and debt payments) are not connected yet.
     - On `Scheduled`: prototype-style scheduled empty/unavailable state card (`No scheduled payments recorded yet`).
  5. **Budget (`src/screens/BudgetScreen.tsx` & `src/OnboardingAndHome.tsx` callback if needed)**:
     - Fixed top header (title updates to `Budget`, `Upcoming`, or `Payoff strategy` based on selected segment) and 3-part segmented control (`Budget`, `Upcoming`, `Strategy`).
     - **`Budget` sub-tab**: Month selector card (`< [Current Month Year] >`), **Income & allocation card** (`Income` + large monthly equivalent at upper left, `Edit` button at upper right, horizontal allocation bar showing strategy debt payments vs. income, 2-column `Budget (Debt Plan)` and `Remaining` separated by vertical rule with explicit note that recurring/one-time spending is unavailable so remaining reflects income minus planned debt payments only, and bottom line `"Includes [amount] planned for debt payments"`), entered income sources list, and **Budget Summary** card with divided category rows (`Housing`, `Insurance`, `Subscriptions`, `Transportation`, `One-time spending` showing `Unavailable`, and `Debt payments` showing the live `plan.monthlyTotalPayment` with progress bar).
     - **`Upcoming` sub-tab**: Prototype-style vertically divided bill list layout; if debt accounts have `dueDay`, show them as user-entered due-day reminders (`Due day [X] Â· Minimum [amount]`, explicitly labeled as manual due-day reminder rather than a verified dated bill), plus an honest unavailable notice for full dated bill schedules.
     - **`Strategy` sub-tab**: Prototype's `Cards & Loans` / household strategy view with working **Extra payment** input + save button, side-by-side **Avalanche â€” Highest interest first** and **Snowball â€” Smallest balance first** selector cards (persisting via `saveUserOnboardingData` callback), and **Extra-payment priority** divided list card (`#1`, `#2` rank badge, category icon, account name + APR, planned monthly payment at upper right, and payoff month/year badge beneath).
  6. **Progress (`src/screens/ProgressScreen.tsx`)**:
     - Fixed top header (`Progress`, `Credit utilization`, or `Milestones`) and 3-part segmented control (`Overview`, `Utilization`, `Milestones`).
     - **`Overview` sub-tab**: Category summary ring card (`Cards & Loans` / `Home & Auto` / `All Debts` with `< >` chevrons, SVG ring, `Paid (snapshot):` and `Balance:`), and main **[Period] progress** card with internal period segmented control (`Current month`, `Previous month`, `Lifetime`), status panel + semicircular SVG gauge on right, the three approved leading metrics (`Debt paid down`, `Payments made`, `Accounts paid off` showing `Unavailable` â€” no recorded history yet), 2-column stat cards (`Interest & fees recorded`, `Recorded balance change` showing `Unavailable`), and **Activity by account** card listing the user's stored accounts with initials badge and `No recorded activity` status.
     - **`Utilization` sub-tab**: Prototype's Credit utilization card (left column stacked metrics: `Total limit`, `Used credit`, `Available credit`, `Target utilization (30%)`, `To reach 30%` computed honestly from stored `Credit card` accounts that have `creditLimit` entered, or `Add credit limits on Debt tab` when `creditLimit` is null; right column SVG donut ring), 2 side-by-side cards (`Available credit`, `Cards tracked`), and **Cards to review** list showing stored credit cards with horizontal utilization bar and `30% target` marker.
     - **`Milestones` sub-tab**: Prototype's Milestones header (`Small wins add up to a debt-free you.`), category filter pill, 3-column count strip (`Completed`, `In Progress`, `Up Next`), `NEXT UNLOCK` card with flag icon and progress bar, and milestone cards (`First payment recorded`, `First $1,000 eliminated`, `First debt paid off`, `25% complete`, `50% complete`) clearly distinguishing snapshot-observed state vs. unrecorded payment history.
- **Checks**: Run `npm.cmd run typecheck` once after implementation and confirm exit code `0`. Do NOT run tests, linters, builds, or emulators.

- **Worker handback & Manager completion (2026-11-04)**: Worker implemented fixed segmented headers, debt search/sort and editing (with optional `originalBalance` and `creditLimit` fields), snapshot rings and bars, Home cross-tab navigation and plan cards, Budget strategy/extra payment persistence, and structured unavailable states. Manager completed the Option B utility icons (`chevronRight`, `chevronLeft`, `search`, `sort`, `user`, `calendar`, `flag`, `info`, `filter`) in `src/components/AppIcon.tsx` and finished the prototype card layouts, badges, dividers, and floating `+` action notices across `src/components/FinancialScreen.tsx`, `src/OnboardingAndHome.tsx`, `src/screens/DebtScreen.tsx`, `src/screens/TransactionsScreen.tsx`, `src/screens/BudgetScreen.tsx`, and `src/screens/ProgressScreen.tsx`. `npm.cmd run typecheck` passed with exit code `0`. Native runtime rendering remains tracked under `T-014`.
- **Changed files**: `src/components/AppIcon.tsx`, `src/components/FinancialScreen.tsx`, `src/FiveTabShell.tsx`, `src/OnboardingAndHome.tsx`, `src/screens/DebtScreen.tsx`, `src/screens/TransactionsScreen.tsx`, `src/screens/BudgetScreen.tsx`, `src/screens/ProgressScreen.tsx`, `APP_PLAN.md`, `TRACKER.md`.
### T-016: Inspect 16 prototype screenshots and map layout differences

- **Status**: `DONE`.
- **Manager**: Gemini 4 Argon High.
- **Assigned worker**: GPT-6.1 Terra High via `delegate_task`.
- **Completion (2026-11-04)**: Inspected all 16 prototype JPEGs in `references/prototype/2026-11-04/` and produced a complete screen-by-screen structural comparison against `src/FiveTabShell.tsx`, `src/OnboardingAndHome.tsx`, `src/components/FinancialScreen.tsx`, and `src/screens/*.tsx`. No files modified.

### T-015: Save prototype screenshots for future agents

- **Status**: `DONE`.
- **Manager / owner**: GPT-6.1 Sol High (reference capture only).
- **Request (2026-11-04)**: Save screenshots of the prototype into a local project folder for future agents.
- **Targets**: references/prototype/ screenshots and README.md; reference pointers in AGENTS.md and APP_PLAN.md; this tracker entry.
- **Acceptance**: Actual signed-in prototype screenshots covering all five main tabs, readable filenames, capture/source notes, and explicit reminder that colors/icons are not the native design specification. Save additional read-only subviews if readily available.
- **Boundaries**: Browse and capture only; do not add/edit/delete household data, change settings, commit/publish files, run tests/builds/emulators, or modify app code. Stop on a login/blocker and record the reason.
- **Completion (2026-11-04)**: Saved 16 original JPEG window screenshots at `references/prototype/2026-11-04/`, plus `manifest.json`; added `references/prototype/README.md` with source, capture limits, design precedence, and a linked screenshot index. Added pointers in AGENTS.md and APP_PLAN.md so future agents discover the reference. Covered all five main tabs plus available secondary views, two Home scroll positions, and Progress month/lifetime/utilization/milestone views. Returned Brave to Home. No household data/settings or app code changed; no tests/builds/emulators, commits, or publication.

### T-014: Set up the T3 Code Android Device panel after app implementation

- **Status**: `BLOCKED` (simulator setup/build/launch working; five-tab runtime check awaits user completion of saved onboarding).
- **Successful setup (2026-11-04, GPT-6.1 Sol High)**: Local DebtFree_Pixel_API_36 opened in T3 Device panel as emulator-5554. Built x86_64 development APK with .\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --max-workers=2 --console=plain; BUILD SUCCESSFUL (2m54s). Installed app-debug.apk with adb -s emulator-5554 install -r (Success), preserving data. Metro is running with npx.cmd expo start --dev-client --localhost --port 8081 (watch mode enabled). Launched com.debtfree.nativetest and opened exp+debtfree-native-test://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081 using this Device panel session's agent-device command. Android bundle succeeded (917 modules).
- **Observed / needs user**: device_screenshot confirms the updated app renders Setup 3 of 5, including Option B mortgage/auto/card/action icons, without an error screen. Saved sandbox session restored; no login requested. No financial data was added/edited/reset. User must complete saved Setup 3â€“5 using sandbox test data before Home and the five tabs can be verified. Leave emulator and Metro running for user interaction; resume navigation-only checks after user reaches Home. Prior device-access/ffmpeg blockers are resolved.
- **Current retry (2026-11-04)**: device_list reports local Android ready; device_open successfully booted DebtFree_Pixel_API_36 as emulator-5554. Initial screenshot hub request failed during boot; the advised device_list check followed by one screenshot retry succeeded. Existing APK predates the new native SVG dependency; targeted development-client rebuild/install is required.
- **Retry (2026-11-04, Claude Opus 5.5 manager)**: Device access is now enabled. device_list shows host `local` ready (Android available) and AVD `DebtFree_Pixel_API_36` (not booted). device_open failed: "Android emulator video needs working ffmpeg with the libx264 encoder... restart the local environment server." Installed ffmpeg 9.0.2 via `winget install Gyan.FFmpeg` (libx264 confirmed) and set user env var `SERVE_EMU_FFMPEG` to its `ffmpeg.exe`. A retry before restarting still failed because the running server keeps its old environment. **Next**: user fully quits and reopens T3 Code, then asks to resume T-014.
- **Manager**: GPT-6.1 Sol High. Worker assignment and exact setup file boundaries deferred until execution; no worker dispatched.
- **Request (2026-11-04)**: After the current app work, set up T3 Code's Android/mobile simulator so the user can preview the application on demand. This explicitly authorizes the necessary emulator launch and development-client build/install for setup, overriding the default prohibition for this task only.
- **Discovery**: T3 provides device_list/device_open for the integrated Device panel. Local AVD DebtFree_Pixel_API_36 is verified available and booted; updated development-client launch is verified.
- **Exact blocker**: device_list returned: "Agent device access is turned off for this environment. Ask the user to turn on Agent device access in Settings > Integrations > Devices; it applies when the agent session next starts, such as in a new thread."
- **Rechecked after T-010 (2026-11-04)**: device_list returned the same disabled-access error. T-014 remains BLOCKED; no simulator launch or build attempted. Resume in a newly started agent session after enabling access.
- **Needs user (current)**: Finish existing onboarding in the Device panel using sandbox/test data and report when Home appears. Old Settings/ffmpeg requirements below are historical and resolved.
- **What to do when unblocked**: Discover devices, open the Android emulator in T3's Device panel, build/install the sandbox development client if required (including new native SVG dependency), connect Metro, verify app launch and navigation without modifying household data, and document concise reopen instructions. Retain sandbox configuration and existing user data. No production services or unrelated tests/builds. Pause for user sign-in if needed.
- **Acceptance**: App visibly runs in T3's Device panel and README.md has repeatable reopen steps. Build/install/launch and initial icon rendering are verified; navigation remains pending saved onboarding completion. Modified files for this retry: TRACKER.md, README.md. No application source changes, tests, production access or data edits.

### T-013: Read prototype reference thread before starting

- **Status**: `DONE`.
- **Manager / owner**: GPT-6.1 Sol High (reference review only; no worker assigned).
- **Request (2026-11-04)**: Read the decisions and latest handoff from the user-referenced prototype inspection thread before starting work.
- **Resolution (2026-11-04)**: Read the full reference message history and latest handoff using the raw thread UUID and supplied environment ID. Earlier prefixed reference lookup failed; access is now resolved.
- **Acceptance**: Read the source decisions and latest handoff before beginning implementation. No application changes or tests performed.

### Five-tab plan for the next working session

Canonical scope and worker briefs: [APP_PLAN.md](./APP_PLAN.md). User resumed execution on 2026-11-04 and selected Option B (Confident Solid / Sculpted Silhouette) for native-app icons. Prototype colors remain unapproved. User confirmed all household transactions with proper categories, Budget amounts as entered by the user, and Progress metrics of debt paid down, payments made, and accounts paid off. Coverage/metrics questions are resolved; missing sources remain implementation limitations.

| Task ID | Task | Manager | Worker / Owner | Status | Dependency |
| --- | --- | --- | --- | --- | --- |
| `T-002` | Record five-tab scope and worker plan | GPT-6.1 Sol High | Manager (documentation only) | `DONE` | None |
| `T-003` | Map implementation and shared data needs | GPT-6.1 Sol High | GPT-6.1 Terra High | `DONE` | Reference read; user resumed execution |
| `T-004` | Five-tab app shell | GPT-6.1 Sol High | GPT-6.1 Terra High | `DONE` | T-003 and T-011 complete |
| `T-005` | Debt screen | GPT-6.1 Sol High | GPT-6.1 Terra High | `DONE` | T-003, T-004 complete |
| `T-006` | Household Transactions screen | GPT-6.1 Sol High | GPT-6.1 Terra High | `DONE` | Same sequential assignment; unavailable source acknowledged |
| `T-007` | Budget screen | GPT-6.1 Sol High | GPT-6.1 Terra High | `DONE` | Same sequential assignment; spending source unavailable |
| `T-008` | Progress screen | GPT-6.1 Sol High | GPT-6.1 Terra High | `DONE` | Same sequential assignment; history unavailable |
| `T-009` | Home summaries | GPT-6.1 Sol High | GPT-6.1 Terra High | `DONE` | Same sequential assignment; shared plan and availability |
| `T-010` | Review and close out | GPT-6.1 Sol High | Manager | `DONE` | Initial screen foundation reviewed; native verification remains T-014 |

T-002 handback (2026-11-03): Created APP_PLAN.md with the five-tab requirements, deferred visual direction, worker sequence, acceptance criteria, and open decisions. Updated TRACKER.md only; no application changes, tests, builds, emulator launches, or worker dispatches. Finalize future assignments and exact file boundaries before delegation.

### T-010 review and closeout (2026-11-04)

- **Status**: `DONE` for the initial five-tab screen foundation, not for the missing data integrations or native runtime verification.
- **Manager / owner**: GPT-6.1 Sol High.
- **Reviewed**: Shell tab ordering, Option B selected/inactive icons and accessibility; parent-owned onboarding snapshot and shared payoff plan; all stored debt records/category filters and existing save/delete error handling; entered income/frequency display; Progress period selectors and honest historical unavailable states; Home strategy failure reporting, balance snapshot label, recent activity and bill availability. Existing sign-in/onboarding wiring was preserved by source review; no runtime claim.
- **Small fixes / modified files**: src/screens/DebtScreen.tsx now uses the approved AppIcon for the new Add control; README.md documents the five-tab foundation, data limitations, native SVG rebuild requirement and Device access prerequisite; APP_PLAN.md completion range typo corrected; TRACKER.md updated.
- **Verification**: Manager ran npm.cmd run typecheck after the icon reference fix; passed (exit code 0). Worker checks also passed for T-011, T-004 and T-005â€“T-009. No tests, linter, builds, emulators, browser or live data access were run during this implementation/review.
- **Remaining work / limits**: No transaction ledger or bank sync, recurring/one-time spending records, dated bills, historical payment/closure events, or commercial content. User-approved coverage and metric choices remain recorded for those future sources. Existing storage freshness/household completeness limitations remain as documented in T-003. Native layout and behavior await T-014, currently blocked by Agent device access. Current colors remain provisional.

### T-005â€“T-009 sequential implementation brief (2026-11-04)

- **Manager**: GPT-6.1 Sol High. **Assigned worker**: GPT-6.1 Terra High, one sequential delegate covering this group. Update each task status as its implementation completes; stop when the assigned group is complete.
- **Permitted writes**: src/FiveTabShell.tsx, src/OnboardingAndHome.tsx, new src/screens/DebtScreen.tsx, TransactionsScreen.tsx, BudgetScreen.tsx, ProgressScreen.tsx; optional src/components/DebtEditor.tsx and src/components/FinancialScreen.tsx for directly needed shared UI; optional src/financial-data.ts for minimal shared availability contracts; APP_PLAN.md current implementation/limits and this group's tracker entries. Home may remain in OnboardingAndHome.tsx to preserve controls; a separate HomeScreen.tsx is optional only if needed. No other files.
- **T-005 / acceptance**: Render all stored debt accounts (including zero balances) with clear cards/personal/other loans, home, auto categories and useful category filtering. Show balances, APR, minimums and existing strategy projections with honest labels. Reuse existing add/edit/remove handlers and editor on Debt; keep Home actions connected, never duplicate stores or financial formulas. Include clear manual-source/empty limitations without claiming complete household sync. A completed/zero balance is a current snapshot, not evidence of a recorded payoff event.
- **T-006 / acceptance**: Replace temporary description with a dedicated Transactions screen for the approved all-household coverage, explain missing records/source clearly. No invented activity, balances, totals, dates or account inventory. Represent checking/savings, purchases, transfers and debt-payment distinctions in concise user-facing category/coverage copy; do not create fake filter results. No transaction entry/bank sync is authorized by this plan.
- **T-007 / acceptance**: Dedicated Budget screen distinguishes income (existing user-entered amounts, frequencies and normalized monthly equivalent), recurring spending, one-time spending, and strategy-based debt payments (same plan as Home/Debt). Show entered income sources and a working route to existing income setup. Spending records are absent: show unavailable amounts rather than zero and do not calculate remaining money using missing spending. No planned/actual split beyond identifying debt projections. No new spending workflow/storage in this initial pass.
- **T-008 / acceptance**: Dedicated encouraging Progress view with selectable current month, previous month and lifetime and the three approved metric labels (debt paid down, payments made, accounts paid off). All history is unavailable: display explicit unavailable values and explanatory copy, never use the snapshot percentage as period/lifetime statistics. Selected period state and accessible labels work. Do not use zero balances or createdAt as payment/closure history.
- **T-009 / acceptance**: Preserve existing Home payoff summary, strategy switcher, edits and estimated debt-free date from the one shared plan. Add Recent activity and Upcoming bills sections with explicit missing-source states consistent with Transactions/Progress. Debt dueDay alone is not a dated bill; show no invented bill or promotion. Commercial content stays an accommodation in APP_PLAN only. Avoid unqualified claims that a snapshot percentage is verified historical progress; label it appropriately. Catch/report errors for changed async callbacks so no newly introduced unhandled rejections.
- **Shared requirements**: Pass one current onboarding snapshot/derived plan and callbacks from the parent; preserve session isolation and navigation reset. Current palette is provisional; use existing colors and Option B icons. Reasonable touch targets, accessible labels/states, small-screen scrolling and safe areas. Avoid unnecessary abstractions for sources that do not exist.
- **Checks**: Read/review relevant source as needed. Run npm.cmd run typecheck once after the group is complete; no tests, linters, full builds, emulators, browser/preview. Runtime confirmation remains T-014. Do not claim live financial data or native behavior was verified.
- **Do NOT do**: No auth/storage/backend or schema changes, production-data access, new dependencies, invented finance/history rules, new entry/import/payment workflows, unrelated refactors, commits or subagents. Preserve all modified/untracked work. Existing missing-source limitations are known scope, not unexpected blockers; record them explicitly in handback and plan. Unexpected blockers: mark BLOCKED and stop.

- **Worker completion (2026-11-04)**: T-005â€“T-009 initial screen implementation is `DONE`. Debt lists all stored accounts with filters and shared editor/actions; Transactions describes unavailable household activity; Budget displays entered income and the shared projected debt payment; Progress offers the three periods and unavailable historical metrics; Home retains its plan and controls, labels the balance snapshot and shows unavailable activity and bills. Strategy-save failures are reported.
- **Changed files**: `src/FiveTabShell.tsx`, `src/OnboardingAndHome.tsx`, `src/components/FinancialScreen.tsx`, `src/screens/DebtScreen.tsx`, `src/screens/TransactionsScreen.tsx`, `src/screens/BudgetScreen.tsx`, `src/screens/ProgressScreen.tsx`, `APP_PLAN.md`, and this group's `TRACKER.md` statuses/handback.
- **Check**: `npm.cmd run typecheck` passed (exit code 0), once after the group. Native runtime and layout remain unverified until T-014; T3 device access setting was blocked.
- **Source limits**: Debt records and income are entered data and may not cover the household. Transaction records, recurring and one-time spending, dated bills and historical payment/account events are unavailable; no integrations for those sources were implemented. The snapshot is not verified historical progress. Commercial content remains future scope.

### T-004 execution brief (2026-11-04)

- **Manager**: GPT-6.1 Sol High. **Assigned worker**: GPT-6.1 Terra High via delegate_task.
- **Targets / permitted writes**: src/OnboardingAndHome.tsx; new src/FiveTabShell.tsx; new src/screens/TabPlaceholder.tsx if useful; T-004 tracker status/handback only. App.tsx may be changed only if essential for session-keyed shell wiring. AppIcon.tsx and dependencies remain read-only.
- **What to do**: Add bottom navigation in exact order Home, Debt, Transactions, Budget, Progress after the existing authenticated/onboarded flow. Use the approved AppIcon navigation selected/inactive variants. Keep existing Home content and all its strategy/edit/add/remove/setup/sign-out actions functional as shell content. Other tabs may have clearly worded temporary empty/unavailable states, pending T-005â€“T-009. Preserve existing flow state and user isolation; reset tab state on a new user or leaving/reentering the completed app. Avoid nesting multiple bottom safe-area paddings; keep content scrollable above the tab bar and labels readable on narrow screens. Accessible tab roles, names, and selected state; useful touch targets.
- **Acceptance / check**: All five tabs reachable through explicit state/render branches; Home retains all existing controls; navigation appears only after completed entry flow and uses correct Option B variants; no new data claims or financial rules. Run npm.cmd run typecheck once after changes. Runtime verification deferred to T-014; report that limit.
- **Do NOT do**: No detailed screen implementation, backend/storage/auth changes, dependency installation, unrelated refactoring, tests, linters, builds, emulators, browser/preview, commits, or subagents. Preserve all existing edits. On unexpected blocker record BLOCKED and stop. At completion record DONE, exact files and check results, then stop.

- **Completion (2026-11-04)**: `DONE`. Added the safe-area-aware five-tab shell using Option B selected/inactive icons, preserving the existing Home dashboard and its actions. Other tabs show temporary descriptions; tab state resets on shell exit/reentry or user change. Moved the existing floating Reset control above the tab bar.
- **Changed files**: `src/FiveTabShell.tsx`, `src/OnboardingAndHome.tsx`, `App.tsx`, `TRACKER.md` (T-004 status/handback only).
- **Check**: `npm.cmd run typecheck` passed (exit code 0). Runtime behavior and native layout remain unverified until T-014.

### T-003 execution brief (2026-11-04)

- **Assigned worker**: GPT-6.1 Terra High via delegate_task.
- **What to do**: Read AGENTS.md, APP_PLAN.md, App.tsx and relevant src code. Map data already available for each tab, reusable logic, missing contracts, and implementation dependencies. Document concrete proposed file boundaries for T-004 through T-009 and Option B integration. Distinguish supported current behavior from missing household/history capabilities; do not invent financial rules.
- **Targets / permitted writes**: APP_PLAN.md and this T-003 tracker entry/table status only. Application files are read-only for this task.
- **Acceptance**: Each tab mapped to existing/missing data and specific target files; shared contracts proposed; known open decisions identified; concise handback lists changes. Mark T-003 DONE when mapping is complete, even if downstream decisions remain pending.
- **Do NOT do**: No application changes, unrelated refactoring, backend/dashboard or production-data access, dependency installs, tests, linters, builds, emulators, browser use, commits, or subagents. Preserve all existing working-tree changes. Stop and record BLOCKED for unexpected blockers.


- **Completion (2026-11-04)**: `DONE`. Mapped each tab's existing and missing data, storage/projection limits, shared contracts, proposed T-004â€“T-009 files/dependencies and Option B integration in `APP_PLAN.md`. Transaction coverage/sources, planned versus actual budget, Progress metrics/history and palette remain downstream decisions, not mapping blockers.
- **Modified files**: `APP_PLAN.md`, `TRACKER.md` (T-003 entry and table status only). Source inspected read-only; no tests, builds, emulators, browser or backend access.

### T-011: Rework the app icon system

- **Status**: `DONE` (Option B native integration complete; ready for T-004).
- **Manager**: GPT-6.1 Sol High.
- **Assigned worker**: Gemini 4 Argon High via Antigravity.
- **User request (2026-11-04)**: Recommend a model and rework all icons to improve on the prototype's icons.
- **Decision (2026-11-04)**: User resumed the native-app plan and selected Option B from design/icon-directions.html. Apply its Confident Solid / Sculpted Silhouette family to the native app. Palette remains undecided.
- **Initial finding**: App.tsx and src/OnboardingAndHome.tsx mix text glyphs and hand-built icon shapes. A coordinated vector set is proposed; rounded outlines are a suggestion, not an approved preference.
- **Boundaries**: Inventory and replace generic interface icons consistently; include the five navigation icons in the design brief. Preserve third-party brand identities, behavior, calculations, and existing edits. Do not choose a new app palette. No unnecessary tests, builds, or emulator launches.
- **Targets / permitted writes**: App.tsx, src/OnboardingAndHome.tsx, new src/components/AppIcon.tsx, package.json, package-lock.json, and T-011 tracker status/handback only. Read design/icon-directions.html as the approved reference.
- **What to do**: Port Option B shapes into a reusable native icon component with size/color/selected props; include the five navigation pairs for T-004. Replace generic UI glyphs/hand-built icons in current source with this family, matching additional action shapes as needed. Use react-native-svg 15.16.0 (the installed Expo SDK bundled version); dependency installation is authorized for this task. Retain current colors and accessible labels; decorative SVGs should not become extra focus targets.
- **Acceptance / check**: Approved navigation shapes and inactive variants are exported; existing generic icons use the family; third-party marks and working flows preserved. Run npm run typecheck once after implementation to confirm the SVG port and references compile; no tests, linters, builds, or emulators. Record any dependency-install failure as BLOCKED and stop. Do not commit or spawn subagents.
- **Acceptance**: Consistent icon family, clear meaning at small sizes, consistent stroke weight/alignment, accessible controls, and reusable active/inactive styling where relevant.
- **Worker completion (2026-11-04)**:
  - **Changed files**: `package.json`, `package-lock.json`, `src/components/AppIcon.tsx` (new), `App.tsx`, `src/OnboardingAndHome.tsx`, `TRACKER.md`.
  - **Check performed**: `npm.cmd run typecheck` (`tsc --noEmit`) passed with exit code `0`.
  - **Summary**: Installed `react-native-svg@15.16.0` and created `src/components/AppIcon.tsx` exporting `AppIcon`, `NavigationTabIconName`, `AppIconName`, `NAVIGATION_TAB_ICONS`, and `AppIconProps` (`size`, `color`, `selected`, `style`) with decorative accessibility hiding (`accessible={false}`, `accessibilityElementsHidden`, `importantForAccessibility="no-hide-descendants"`, `pointerEvents="none"`). Ported the exact approved Option B 24Ã—24 selected/inactive navigation silhouettes (`home`, `debt`, `transactions`, `budget`, `progress`) and utility/liability shapes (`settings`, `bell`, `add`, `homeLoan`, `auto`) from `design/icon-directions.html`, plus matching Option B action/category icons (`creditCard`, `snowball`, `avalanche`, `plus`, `check`, `back`, `chevronDown`, `reset`, `brandRise`, `trendDown`). Replaced generic text glyphs and `BellOutlineIcon` across `App.tsx` and `src/OnboardingAndHome.tsx` while preserving Google/Apple authentication marks, existing colors, accessible labels, and all flows.

Manager review (T-011): Reviewed reusable Option B paths, navigation exports, decorative accessibility behavior, current control references and pinned SVG dependency. Worker typecheck passed. No additional test/build/emulator run; native rendering remains for T-014.

### Earlier tasks

### T-012: Icon direction samples for user comparison

- **Status**: `DONE`.
- **Manager**: GPT-6.1 Sol High.
- **Assigned worker**: Gemini 4 Argon High via Antigravity.
- **Request (2026-11-04)**: Create sample icons and show an inline comparison before selecting a design direction. Concept work can proceed independently of T-011's implementation-scope question.
- **What to do**: Create three distinct, coordinated vector icon families for Home, Debt, Transactions, Budget, and Progress. Show actual-size navigation samples, enlarged icons, and selected/unselected states in one self-contained HTML comparison. Add matching settings, notification, add, home-loan, and auto icons if space permits.
- **Targets**: design/icon-directions.html, design/icon-directions.md, and this T-012 entry only.
- **Acceptance**: Three clearly differentiated families; neutral theme-aware styling; readable small-size icons; no external dependencies; responsive layout; complete HTML suitable for html_preview/html_render in the manager thread; short recommendation with tradeoffs.
- **Do NOT do**: No application/prototype changes, production data access, bank or authentication brands, palette decisions, package installation, tests, builds, emulators, browser automation, or subagents. Preserve all existing work. Use inline SVG/code-native icons, not raster generation.
- **Handback**: Record changed files and DONE (or BLOCKED with exact reason) here, report the absolute HTML path and concise design rationale, then stop. The manager will render the artifact for the user.
- **Worker completion (2026-11-04)**:
  - **Changed files**: `design/icon-directions.html`, `design/icon-directions.md`, `TRACKER.md`.
  - **Summary**: Created a self-contained, theme-aware, responsive HTML concept board (`360px` to `728px`, transparent outer wrapper, no external dependencies) and companion Markdown rationale showcasing three distinct `24x24` inline-SVG icon families (**Option A: Rounded Outline â€” Tactile Monoline**, **Option B: Confident Solid â€” Sculpted Silhouette**, **Option C: Geometric Duotone â€” Layered Depth**) across the five ordered bottom tabs (`Home`, `Debt`, `Transactions`, `Budget`, `Progress`) with enlarged active/inactive pairs, interactive `24px` 5-column bottom navigation bars, and a 5-icon utility/liability strip (`Settings`, `Bell`, `Add`, `Home Loan`, `Auto`). Recommended **Option C (Geometric Duotone)** for its ability to separate multi-plane financial concepts cleanly at `24px`.

### Earlier task records

Manager review (T-012): Reviewed all three icon families and rendered the board at 728px dark and 390px light widths. Both previews rendered without console errors. Simplified visible captions, used neutral foreground colors, and added focus/pressed-state semantics to the navigation buttons. No application code changed; no tests/builds/emulators were run. Ready for the user's direction choice.

| Task ID | Title | ðŸ§­ Manager | ðŸ› ï¸ Assigned Worker | Status | Needs User / Blocker | Updated |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `T-001` | Setup Manager/Worker rules & local tracker | `gemini-4-argon` | `gemini-4-argon (high)` | `DONE` | None | 2026-11-03 |

---

## Task Details & Instructions

### `T-001` â€” Setup Manager/Worker rules & local tracker
- **Status**: `DONE`
- **ðŸ§­ Manager**: `gemini-4-argon`
- **ðŸ› ï¸ Assigned Worker**: `gemini-4-argon (high)`
- **Manager Instructions**:
  - Create `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `TRACKER.md` establishing Manager/Worker roles, visual identification badges, and the no-unnecessary-testing guardrail.
- **Do NOT Do**:
  - Do not run any unnecessary tests or modify application code.
- **Worker Notes / Handback**:
  - Created `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `TRACKER.md` with `ðŸ§­ [MANAGER]` and `ðŸ› ï¸ [WORKER]` visual badges and sidebar thread naming rules.

