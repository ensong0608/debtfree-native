> **Owner correction - 2026-11-12:** The visible bottom navigation label and shared title for the tab internally keyed as Debt are **Accounts**. Keep its internal Accounts / Strategy sections, route key, and Add Debt Account action unchanged. In Progress Overview, match the vertical gap before Recorded activity to the gap between its heading row and activity panel; vertically center its payments summary while keeping text left-aligned. The attached action tier remains full-width, with the active action button sized to its icon and label and centered. Home & Auto balance snapshots include Mortgage and Auto loan accounts only.

> **BitLess visual direction refresh - 2026-11-12:** The owner supplied the actual logo palette: blue `#0051FB`, pale sky blue `#ABDFFD`, turquoise `#27EEE9`, mint `#98EDC1`, navy `#070D5B`, and white. Do not use pink in BitLess brand surfaces. Keep financial category and risk colors separate. This palette is approved for design studies; do not change native theme code until the owner approves implementation.
>
> Show the BitLess name on Home only; other tabs use their tab title. On Progress, put the downward arrow and reduction percentage immediately to the right of the current balance amount. Omit the word “lower” and keep the adjusted-reference label and unavailable state clear.
>
> Navigation icon review: use the owner's selected symbols in one simple, clean, distinguishable family with shared scale, stroke weight, and rounded geometry: a card for Debt, calendar for Transactions, wallet for Budget, presentation chart for Progress, and dollar-house for Home. The current original SVG concept board, redrawn from the owner's references with consistent 24-unit geometry and rounded 1.8px outlines, is `design/bitless-navigation-icon-review-2026-11-12.html`. It supersedes the earlier icon proposal; native implementation still requires approval.

> **Connected dock IMPLEMENTATION APPROVED - 2026-11-09:** Owner approved design/navigation-connected-dock-2026-11-09.html with the label Add Transaction (singular). Implement its uniform icon family, equal selected capsules and attached action tier: Add Debt Account / Add Transaction / Add Monthly Expense; none on Home/Progress. Implement pull-to-refresh account/household data below the fixed main header through the existing safe reload path, preserving route/section/drafts/pending writes and honest errors. Remove duplicate scroll-end Add controls. Preserve all other approved layouts and financial rules. This explicitly supersedes earlier design-only holds for this dock and refresh scope only. Collaboration remains deferred; no live financial data mutations or backend deployment authorized.

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

> **Progress visual implementation refinement - 2026-11-11:** Replace visible “lower than adjusted reference” wording with a downward arrow when the adjusted-reference reduction is positive; show no downward arrow when the reduction is zero. Put Current balance immediately beneath the visual reduction indicator and keep the adjusted-reference label clear. Use a much larger, more polished circle graph and the approved stronger payment, metric, payoff-target, and account-activity surfaces. Preserve the two scopes and default, honest missing-reference states, household-wide activity and target, all financial calculations, and all account-activity rules. Do not change bottom tabs or navigation. This supersedes the preceding visible comparison wording.

> **Progress mockup fidelity correction - 2026-11-11:** Preserve the approved composition: a horizontal snapshot hero with the large circle on the right, reduction arrow/percentage on the left, and Current balance immediately below that cue; show adjusted reference as supporting information. Recorded activity uses the prominent payment total/count card followed by one grouped four-row metrics panel, with the compact target and account list below. Do not stack the circle above the balance or turn the metric rows into 2×2 tiles. Keep all approved scope, formula, data, unavailable-state, activity-list, and category-color rules. Bottom tabs stay untouched. This supersedes the prior native layout arrangement only.

# Project Agent Rules & Guardrails (`debtfree-native`)

All agents operating in this repository MUST follow these rules.

## Compaction & Handoff Guardrail (Mandatory)

- **Persist Owner Authorizations Immediately:** Whenever the owner grants, updates, or revokes execution permissions (such as authorizing Supabase migration application, Edge Function deployment, or UI implementation), immediately record that directive in a prominent **Owner Standing Directives & Live State** block at the top of the active plan/state doc (and remove any stale *"requires later explicit approval"* / *"local-only"* text that it supersedes). Never leave critical permissions only in chat history.
- **Re-Read Before Refusing or Repeating:** After any context compaction or thread handoff, re-read the active plan's **Owner Standing Directives & Live State** block and verify live CLI/database state (e.g., `npx.cmd supabase ...`) before claiming an action is unauthorized, unapplied, or missing.
- **No Micro-Task Churn:** Keep `TRACKER.md` concise; do not split tightly coupled client/SQL contracts into blocked micro-delegations when they must be designed together.

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


**Owner-approved T-190 refinement (2026-11-12):** Transactions account filters use a fixed-height two-column scrollable radio grid without the synthetic checking/debit account; debit-only remains a transaction type. Planned installment groups match scheduled cards, expose editing, and explain returning to one monthly payment. Progress payoff target opens Accounts / Strategy; Utilization uses the prototype summary, circular gauge, and individual card-review hierarchy with existing calculations and colors.

> **T-193 preference (2026-11-12):** Destructive removal actions require an item-specific Cancel / confirm prompt; cancellation makes no changes. Progress section tabs show only the selected underline, without a full-width baseline.


> **Owner correction (2026-11-13):** On shared inner-section selector rows (including Accounts / Strategy), remove the full-width baseline separator and keep only the selected section underline. Preserve labels, typography, row height, horizontal placement, and selection behavior.

> **Account history and paid-off archives (2026-11-12):** Confirm permanent account deletion before removing linked transactions and reconciliation records. Delete only the exact active Mortgage/Auto pairing and its bill-tagged history; abort with transaction details when history also belongs to another account or recurring identity. Retain paid-off accounts and history in an Archived · Paid Off section only after a confirmed principal-reducing payment changes a positive balance to exactly zero. New, manually zeroed, and restore-imported historical payment rows do not create archive state; reopening above zero removes it. Exclude archived accounts from active balance snapshots, utilization, payoff, budget-debt calculations, and scheduled obligations, including their exact paired Mortgage/Auto bill. Keep local records on uncertain deletion outcomes.
