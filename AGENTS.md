# Project Agent Rules & Guardrails (`debtfree-native`)

All agents (Gemini, Codex, and delegated subagents) operating in this repository MUST follow these rules.

## Product capabilities inventory

- Read [APP_CAPABILITIES.md](APP_CAPABILITIES.md) when assessing what BitLess supports or planning a user-facing feature.
- In the same change, update the relevant entry when you add or materially improve a user-facing capability. Revise affected limits and remove stale entries when behavior is removed. Keep routine fixes, visual polish, implementation details, task status, and planned work out of the inventory.

## External Persistent Memory & Code Retrieval (Mandatory)

- **Project ID:** `debtfree-native` | **CBM Graph Project:** `C-Users-lawre-OneDrive-Desktop-DF_App_Development-debtfree-native`
- **Persistent Memory Dir:** `C:\Development\AI-Infrastructure\memory\debtfree-native\` (`PROJECT_OVERVIEW.md`, `CURRENT_TASK.md`, `HANDOFF.md`, `KNOWN_ISSUES.md`, `DECISIONS.md`, `ARCHITECTURE.md`, `BUSINESS_RULES.md`).
- **HARD RULE — Session Start (Memory Before Code):** Read `PROJECT_OVERVIEW.md`, `CURRENT_TASK.md`, `HANDOFF.md`, and `KNOWN_ISSUES.md` (`Recurring Pitfalls`) first (via `Get-Content` if file-read tools block external paths), reconcile with `git status -sb`, and load only task-relevant rules.
- **HARD RULE — Strict Token & Read Budget (Code, HTML Mockups & Subagents):**
  1. **FORBIDDEN:** Do **NOT** read entire files >200 lines (`DebtScreen.tsx`, `TransactionsScreen.tsx`, `HomeScreen.tsx`, `ProgressScreen.tsx`, `BudgetScreen.tsx`, `FinancialScreen.tsx`, or large `design/*.html` mockups), do **NOT** sequentially chunk-read (`0..800`, `800..1600`, ...), do **NOT** read giant embedded `data:`/base64 lines (e.g. line 96 in `fresh-light-dark-full-app-*.html`), and do **NOT** run repo-wide `Get-ChildItem -Recurse` or broad `Select-String` sweeps.
  2. **MANDATORY FUNNEL — CBM First, Bounded Slices Only:**
     - **Locate:** Run `search_graph`, `get_file_outline` (also indexes `<script>` functions inside `design/*.html`), or `trace_path` scoped to `C-Users-lawre-OneDrive-Desktop-DF_App_Development-debtfree-native`.
     - **Inspect:** Use `get_code_snippet` (`--source-mode outline` first, then `--start-line <n> --max-lines 100` for 200+ line components) or single-file `Select-String` for inline JSX/CSS/HTML selectors.
     - **Verify & Edit:** Only `Read` a **bounded <=120-line range** around the exact target lines.
  3. **Subagent Budget (Parent & Child):** Pass exact target paths, changed line ranges (or diff summary), and `<cbm_project>` in every subagent prompt, and enforce **<=120-line bounded reads** (never re-read whole >200-line files or run `Get-ChildItem -Recurse`).
  4. **CLI Shortcut (`cbm` is on PATH) / Fallback:** `cbm <search_graph|get_file_outline|get_code_snippet|trace_path> --project "C-Users-lawre-OneDrive-Desktop-DF_App_Development-debtfree-native" ...` (fallback: `$env:CBM_CACHE_DIR='C:\Development\AI-Infrastructure\indexes'; C:\Development\AI-Infrastructure\bin\codebase-memory-mcp.exe cli ...`).
- **Before Compaction / Session End (+ Honest Self-Check):** Update `CURRENT_TASK.md` and `HANDOFF.md` including the 3-line `End-of-Session Self-Check` (`CBM / Select-String first?`, `Reads <=120 lines?`, `Missed rule / mistake`). If a real mistake/slip occurred, add 1 concise line to `KNOWN_ISSUES.md` -> `Recurring Pitfalls` (keep `<=10` bullets).

## Compaction & Handoff Guardrail (Mandatory)

- **Persist Owner Authorizations Immediately:** Record granted/revoked permissions in `Owner Standing Directives & Live State` below and remove stale hold text; re-read live CLI/DB state (`npx.cmd supabase ...`) before claiming something is missing/unauthorized.
- **No Micro-Task Churn:** Keep `TRACKER.md` concise; design coupled client/SQL contracts together.

## Owner Standing Directives & Live State (Active 2026-11-16 to 2026-11-17)

*(Historical 2026-11-09 to 2026-11-13 UI directives are archived in `C:\Development\AI-Infrastructure\memory\debtfree-native\DECISIONS.md` and `references/UI_PREFERENCES.md`.)*

- **Authorization & Safety:** Local UI implementation and sandbox APK install on `DebtFree_Pixel_API_36` are authorized; **no** hosted schema changes, production deployment, live financial record mutations, APK upload, or email delivery without separate authorization.
- **Multi-Segment Horizontal Swipe & Pull-to-Refresh (T-298, 2026-11-17):** `Accounts <-> Strategy`, `History <-> Scheduled`, and `Overview <-> Utilization <-> Milestones` use a continuous side-by-side horizontal pager (`renderSegment` + `trackTranslateX` + 1:1 underline sync; finger swipe left advances next, right returns previous). Drags on the `Accounts` category chip row scroll categories only with left/right overflow gradient fades. Pull-to-refresh on `Home` & `FinancialScreen` physically pulls content (`~50dp` threshold) and shows `Pull down to refresh` -> `Release to refresh` -> `Refreshing data...` -> `Data updated`.
- **Accounts Categories, Search & Sort (2026-11-16 to 2026-11-17):** Fixed search icon left of horizontal category row (`All`, active non-empty categories, `Home` active Mortgages only, `Paid Off` archived accounts only); preserve selections across bottom tabs. In `All`, hide group balances on headings and put `Sort` right of the first non-empty group heading; in individual categories / `Paid Off`, put `Sort` right of that heading. An editor can explicitly mark a `$0` account Paid (`debtfree_mark_household_debt_paid`); reopening above `$0` restores active status; historical Paid original balances stay included in Home's historical Paid/reference snapshot only.
- **Transactions History & Filters (T-298, 2026-11-17):** Keep inline `Lifetime / Year / Month` selector beside collapsed search/Filters/Sort and keep date chevron far right. `Filters` puts `All` at top of Account Type, groups `Credit Card`, `Home`, `Auto`, `Subscriptions`, `Utilities`, `Insurance`, `Others` (hiding empty groups; preserving stored identities and Mortgage/Auto links; no synthetic checking), uses toggleable `Payments`, `Purchase`, `Fees`, `Others`, and uses a single full-width centered `Apply` button (`X` / backdrop dismiss preserved).
- **Progress Overview (2026-11-17):** Omit archived Paid Off accounts from `Activity by account` while keeping archived transaction history and household-wide totals. Paid due-cycle links do not imply principal reduction; Mortgage/Auto balance change follows structured principal allocation only.

## Current owner decisions (read first)

Read [UI_PREFERENCES.md](./references/UI_PREFERENCES.md) before any UI work. It records the owner's current likes/dislikes, category colors, concise wording, income accordion, navigation and chronological Upcoming requirements. It supersedes conflicting historical task reports and prototype layouts. Update it when the owner changes a preference; never restore older behavior just because a screenshot or tracker entry shows it.

## Saved Prototype References

Before screen/UI work, read [the local prototype screenshot index](./references/prototype/README.md), [the prototype calculation and architectural reference](./references/PROTOTYPE_CALCULATIONS.md), [the prototype mobile interaction blueprint](./references/PROTOTYPE_INTERACTION_PATTERNS.md), and [APP_PLAN.md](./APP_PLAN.md). 

The reference materials include:
- `references/prototype/README.md`: Index of initial signed-in prototype captures (2026-11-04) and the 24 interactive mobile captures in `references/prototype/interactions/` (2026-11-06).
- `references/PROTOTYPE_INTERACTION_PATTERNS.md`: Screen-by-screen interactive behavior guide (modals, accordions, click targets, redirection paths).
- `references/PROTOTYPE_CALCULATIONS.md`: Authoritative math and data models from [github.com/ensong0608/debtfree-dashboard](https://github.com/ensong0608/debtfree-dashboard). The prototype repo is cloned locally at `references/prototype-repo/` (git-ignored).

### Key User Directives for UI & Interaction (Mandatory)
1. **Behavioral Model, Not a Carbon Copy**: Use the prototype for interaction mechanics, hierarchies, and flows, but refine styling and layout for mobile.
2. **Upcoming Recurring Bills Card (Home Tab)**: Hidden by default on the Home tab. It ONLY appears if a recurring bill or credit card minimum is nearing its due date and has NOT been settled yet. The full list lives under **Transactions → Upcoming**, grouped by month and due date.
3. **Home Card Carousel**: Keep the category cycling concept (Cards & Loans, Home, Auto), but refine the visual design (the user dislikes the current web design).
4. **Payoff Strategy Redirection**: Clicking the Payoff strategy card or its "See all" on Home must redirect to **Debt → Strategy**.
5. **Debt Detail Popups**: Clicking an account card on the Debt tab opens a 3-tab popup modal (**Overview**, **Transactions**, **Detail**).
6. **Strategy Monthly Schedule Expansion**: On **Debt → Strategy**, clicking any account row toggles an inline monthly payoff projection table (`Month`, `Payment`, `Interest`, `Balance`).
7. **Current Sections (2026-11-08)**: Debt retains horizontal Accounts and Strategy only. Scheduled lives only in Transactions (2026-11-09 correction). Transactions contains horizontal History, Upcoming, Scheduled. Budget has no standalone Upcoming or Scheduled section (focuses purely on Monthly Income and category budgets). Strategy belongs only under Debt. Home Upcoming shortcuts open Transactions → Upcoming. Keep current placement/orientation.
8. **Strict Backend Data Safety**: NEVER add, edit, delete, or submit mutations against live prototype or production data. Explicit user decisions override screenshot images. Do not hardcode household data from screenshots.
9. **Transaction account identity and filters (2026-11-12)**: Stored account and recurring-item IDs define identity; names are display-only, so renaming preserves history and creating a new item creates a new identity. An active mortgage/auto recurring payment link is one debt account identity. Transactions filters open one popup showing all Period, Account, and Transaction type choices as radio buttons; Apply commits staged selections and Cancel discards them. Scheduled planned installments group by obligation into collapsed expandable cards; split plans support 2, 3, or 4 informational installments, preserve legacy two-installment plans, and never alter the underlying obligation or ledger rules.


---

## Visual Identification Rule (How the User Distinguishes Manager vs. Worker)

To make it immediately obvious who is speaking and which thread is which:

1. **First-Line Role Badge in Every Message**:
   - **Managers** MUST begin every message to the user with:
     `> 🧭 **[MANAGER — <Model Name>]**`
     *(e.g., `> 🧭 **[MANAGER — Gemini 4 Hydrogen Extra]**` or `> 🧭 **[MANAGER — GPT-6 Luna Max]**`)*
   - **Workers** MUST begin every message / handback report with:
     `> 🛠️ **[WORKER — <Model Name> | Task <T-XXX>]**`
     *(e.g., `> 🛠️ **[WORKER — GPT-6 Luna Max | Task T-002]**`, `> 🛠️ **[WORKER — Gemini 3.8 Flash High | Task T-002]**`, `> 🛠️ **[WORKER — GPT-6.1 Terra High | Task T-002]**`, or `> 🛠️ **[WORKER — Gemini 4 Hydrogen High | Task T-002]**`)*

2. **Thread Naming in T3 Code Sidebar**:
   - When the Manager calls `delegate_task`, it MUST set the `title` parameter to:
     `🛠️ [WORKER • <ShortModel>] <T-XXX>: <Short Title>` *(e.g., `🛠️ [WORKER • Luna] T-002: ...`, `🛠️ [WORKER • Flash] T-002: ...`, `🛠️ [WORKER • Terra] T-002: ...`, `🛠️ [WORKER • Hydrogen] T-002: ...`)*
   - When the Manager starts a main planning thread, it should title the thread (via `t3_thread_update` when available) with a `🧭 [MANAGER]` prefix.

---

## Global Rule: Minimal Scope & No Unnecessary Testing (All Agents)

1. **Do Only What Is Required**: Execute only the code changes and steps directly needed to complete the assigned task. Do not refactor unrelated code, add unrequested features, or run broad exploratory checks.
2. **No Unnecessary Tests**:
   - Do **not** write new unit/integration tests, run full test suites (`npm test`), launch Android emulators, or run full builds unless the task explicitly asks for it or a targeted check is strictly necessary to confirm the task works.
   - Never spin up redundant verification loops once a task is confirmed complete.
3. **Human-in-the-Loop / Stop on Blockers**:
   - If you hit an unexpected blocker, ambiguity, or need the user to sign in (e.g., Google OAuth, Apple ID, Supabase dashboard, device login) or provide credentials/approvals, **STOP immediately**, update `TRACKER.md` with status `BLOCKED`, and clearly tell the user what is needed.

---

## Rule Set 1: Project Manager Rules

**Designated Manager Models:**
- **Default — Gemini 4 Hydrogen (Extra)** *(via Antigravity)*: `providerInstanceId: "antigravity"`, `model: "gemini-4-hydrogen"`, `options: { "thinking_level": "xhigh" }`
- **Backup (only if Gemini 4 Hydrogen Extra is unavailable) — GPT-6 Luna (Max)**: `providerInstanceId: "codex"`, `model: "gpt-6-luna"`, `options: { "reasoningEffort": "max" }`
- **Disallowed unless explicitly requested by the owner:** Do **not** use `GPT-6.1 Sol` (`gpt-6.1-sol`) as Manager or Worker unless the owner explicitly instructs otherwise.

**Manager Responsibilities:**
1. **Maintain [`TRACKER.md`](./TRACKER.md)**:
   - Before delegating work, add or update the task entry in `TRACKER.md` with a unique Task ID (`T-XXX`), clear instructions, target files, acceptance criteria, Manager model name, and assigned Worker model.
   - Keep `TRACKER.md` concise and up to date as the single source of truth.
2. **Delegate to Workers via `delegate_task` (by Task Complexity):**
   - Dispatch implementation tasks to one of the designated Worker models using T3 Code's `delegate_task` tool:
     - **Easy tasks:**
       - **GPT-6 Luna (Max)**:
         ```json
         {
           "title": "🛠️ [WORKER • Luna] T-XXX: <Task Title>",
           "target": {
             "providerInstanceId": "codex",
             "model": "gpt-6-luna",
             "options": { "reasoningEffort": "max" }
           }
         }
         ```
       - **Gemini 3.8 Flash (High)**:
         ```json
         {
           "title": "🛠️ [WORKER • Flash] T-XXX: <Task Title>",
           "target": {
             "providerInstanceId": "antigravity",
             "model": "gemini-3.8-flash",
             "options": { "thinking_level": "high" }
           }
         }
         ```
     - **Medium tasks:**
       - **GPT-6.1 Terra (High or Medium)**:
         ```json
         {
           "title": "🛠️ [WORKER • Terra] T-XXX: <Task Title>",
           "target": {
             "providerInstanceId": "codex",
             "model": "gpt-6.1-terra",
             "options": { "reasoningEffort": "high" }
           }
         }
         ```
         *(or `"reasoningEffort": "medium"`)*
     - **Hard tasks:**
       - **Gemini 4 Hydrogen (Extra or High)** *(via Antigravity)*:
         ```json
         {
           "title": "🛠️ [WORKER • Hydrogen] T-XXX: <Task Title>",
           "target": {
             "providerInstanceId": "antigravity",
             "model": "gemini-4-hydrogen",
             "options": { "thinking_level": "xhigh" }
           }
         }
         ```
         *(or `"thinking_level": "high"`)*
   - Include the Task ID from `TRACKER.md` and explicit boundaries ("What to do" and "What NOT to do, including no unnecessary tests") in every `delegate_task` prompt.
3. **Review & Close Out**:
   - When a Worker finishes, verify `TRACKER.md` is updated, confirm the task is complete (or surface any blocker/sign-in request to the user), and stop once all requested tasks are done.

---

## Rule Set 2: Worker Rules

**Designated Worker Models (by task complexity):**
- **Easy tasks:**
  - **GPT-6 Luna (Max)**: `providerInstanceId: "codex"`, `model: "gpt-6-luna"`, `options: { "reasoningEffort": "max" }`
  - **Gemini 3.8 Flash (High)**: `providerInstanceId: "antigravity"`, `model: "gemini-3.8-flash"`, `options: { "thinking_level": "high" }`
- **Medium tasks:**
  - **GPT-6.1 Terra (High or Medium)**: `providerInstanceId: "codex"`, `model: "gpt-6.1-terra"`, `options: { "reasoningEffort": "high" }` or `{ "reasoningEffort": "medium" }`
- **Hard tasks:**
  - **Gemini 4 Hydrogen (Extra or High)**: `providerInstanceId: "antigravity"`, `model: "gemini-4-hydrogen"`, `options: { "thinking_level": "xhigh" }` or `{ "thinking_level": "high" }`
- Do **not** use `GPT-6.1 Sol` unless explicitly requested by the owner.

**Worker Responsibilities:**
1. **Follow Manager Instructions Strictly**:
   - Read your assigned Task ID in [`TRACKER.md`](./TRACKER.md) and the Manager's prompt.
   - Always start your response with `> 🛠️ **[WORKER — <Model Name> | Task <T-XXX>]**`.
   - Do not spawn subagents unless explicitly instructed by the Manager.
2. **Execute Until Done, Then Stop**:
   - Work through the assigned steps until the task is complete.
   - As soon as the task is finished, update your task's status (`DONE`), summary of changes, and modified files in [`TRACKER.md`](./TRACKER.md), then **stop immediately**.
3. **Stop on Issues or Sign-In Requests**:
   - If an error occurs that blocks progress, or if the user needs to sign into an account/service or approve something, **do not guess or loop**.
   - Update the task status in [`TRACKER.md`](./TRACKER.md) to `BLOCKED`, record the exact reason or sign-in needed, and stop so the user can be notified.
4. **No Unnecessary Testing**:
   - Do not run extra tests, linters, or builds unless specifically instructed in the task's acceptance criteria.
