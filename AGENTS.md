# Project Agent Rules & Guardrails (`debtfree-native`)

All agents operating in this repository MUST follow these rules.

## Saved Prototype References

Before screen/UI work, read [the local prototype screenshot index](./references/prototype/README.md), [the prototype calculation and architectural reference](./references/PROTOTYPE_CALCULATIONS.md), [the prototype mobile interaction blueprint](./references/PROTOTYPE_INTERACTION_PATTERNS.md), and [APP_PLAN.md](./APP_PLAN.md). 

The reference materials include:
- `references/prototype/README.md`: Index of initial signed-in prototype captures (2026-11-04) and the 24 interactive mobile captures in `references/prototype/interactions/` (2026-11-06).
- `references/PROTOTYPE_INTERACTION_PATTERNS.md`: Screen-by-screen interactive behavior guide (modals, accordions, click targets, redirection paths).
- `references/PROTOTYPE_CALCULATIONS.md`: Authoritative math and data models from [github.com/ensong0608/debtfree-dashboard](https://github.com/ensong0608/debtfree-dashboard). The prototype repo is cloned locally at `references/prototype-repo/` (git-ignored).

### Key User Directives for UI & Interaction (Mandatory)
1. **Behavioral Model, Not a Carbon Copy**: Use the prototype for interaction mechanics, hierarchies, and flows, but refine styling and layout for mobile.
2. **Upcoming Recurring Bills Card (Home Tab)**: Hidden by default on the Home tab. It ONLY appears if a recurring bill or credit card minimum is nearing its due date and has NOT been settled yet. The full list lives under **Budget → Upcoming**.
3. **Home Card Carousel**: Keep the category cycling concept (Cards & Loans, Home, Auto), but refine the visual design (the user dislikes the current web design).
4. **Payoff Strategy Redirection**: Clicking the Payoff strategy card or its "See all" on Home must redirect to **Budget → Strategy**.
5. **Debt Detail Popups**: Clicking an account card on the Debt tab opens a 3-tab popup modal (**Overview**, **Transactions**, **Detail**).
6. **Strategy Monthly Schedule Expansion**: On **Budget → Strategy**, clicking any account row toggles an inline monthly payoff projection table (`Month`, `Payment`, `Interest`, `Balance`).
7. **Strict Backend Data Safety**: NEVER add, edit, delete, or submit mutations against live prototype or production data. Explicit user decisions override screenshot images. Do not hardcode household data from screenshots.


---

## Visual Identification Rule (How the User Distinguishes Manager vs. Worker)

To make it immediately obvious who is speaking and which thread is which:

1. **First-Line Role Badge in Every Message**:
   - **Managers** MUST begin every message to the user with:
     `> 🧭 **[MANAGER — <Model Name>]**`
     *(e.g., `> 🧭 **[MANAGER — GPT-6.1 Sol High]**` or `> 🧭 **[MANAGER — Claude Opus 5.5 High]**`)*
   - **Workers** MUST begin every message / handback report with:
     `> 🛠️ **[WORKER — <Model Name> | Task <T-XXX>]**`
     *(e.g., `> 🛠️ **[WORKER — GPT-6.1 Terra High | Task T-002]**` or `> 🛠️ **[WORKER — Gemini 4 Argon High | Task T-002]**`)*

2. **Thread Naming in T3 Code Sidebar**:
   - When the Manager calls `delegate_task`, it MUST set the `title` parameter to:
     `🛠️ [WORKER • Terra] <T-XXX>: <Short Title>` or `🛠️ [WORKER • Argon] <T-XXX>: <Short Title>`
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
- **GPT-6.1 Sol (High)**: `providerInstanceId: "codex"`, `model: "gpt-6.1-sol"`, `options: { "reasoningEffort": "high" }`
- **Claude Opus 5.5 (High)** *(via Antigravity)*: `providerInstanceId: "antigravity"`, `model: "claude-opus-5-5"`, `options: { "thinking_level": "high" }`

**Manager Responsibilities:**
1. **Maintain [`TRACKER.md`](./TRACKER.md)**:
   - Before delegating work, add or update the task entry in `TRACKER.md` with a unique Task ID (`T-XXX`), clear instructions, target files, acceptance criteria, Manager model name, and assigned Worker model.
   - Keep `TRACKER.md` concise and up to date as the single source of truth.
2. **Delegate to Workers via `delegate_task`**:
   - Dispatch implementation tasks to one of the designated Worker models using T3 Code's `delegate_task` tool:
     - **GPT-6.1 Terra (High)**:
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
     - **Gemini 4 Argon (High)**:
       ```json
       {
         "title": "🛠️ [WORKER • Argon] T-XXX: <Task Title>",
         "target": {
           "providerInstanceId": "antigravity",
           "model": "gemini-4-argon",
           "options": { "thinking_level": "high" }
         }
       }
       ```
   - Include the Task ID from `TRACKER.md` and explicit boundaries ("What to do" and "What NOT to do, including no unnecessary tests") in every `delegate_task` prompt.
3. **Review & Close Out**:
   - When a Worker finishes, verify `TRACKER.md` is updated, confirm the task is complete (or surface any blocker/sign-in request to the user), and stop once all requested tasks are done.

---

## Rule Set 2: Worker Rules

**Designated Worker Models:**
- **GPT-6.1 Terra (High)**: `providerInstanceId: "codex"`, `model: "gpt-6.1-terra"`, `options: { "reasoningEffort": "high" }`
- **Gemini 4 Argon (High)**: `providerInstanceId: "antigravity"`, `model: "gemini-4-argon"`, `options: { "thinking_level": "high" }`

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
