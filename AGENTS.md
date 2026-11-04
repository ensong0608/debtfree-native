# Project Agent Rules & Guardrails (`debtfree-native`)

All agents operating in this repository MUST follow these rules.

## Saved Prototype References

Before screen/UI work, read [the local prototype screenshot index](./references/prototype/README.md), [the prototype calculation and architectural reference](./references/PROTOTYPE_CALCULATIONS.md), and [APP_PLAN.md](./APP_PLAN.md). The screenshot index links to 16 signed-in prototype screenshots captured on 2026-11-04, and `references/PROTOTYPE_CALCULATIONS.md` documents the authoritative math and data models from [github.com/ensong0608/debtfree-dashboard](https://github.com/ensong0608/debtfree-dashboard). The prototype repo is cloned locally at `references/prototype-repo/` (git-ignored). Use them for functional structure and context. Explicit user decisions override the images: the prototype palette is not approved for the native app, and the selected native icon direction is Option B in `design/icon-directions.html`. Do not hardcode household data from screenshots.


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
