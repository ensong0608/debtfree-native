# Tracker Agent Protocol Skill

## Description
Operational protocol for multi-model Manager and Worker agents collaborating on `debtfree-native`. Defines message badges, `TRACKER.md` maintenance, delegation schemas, and scope containment rules.

---

## 1. Visual Identification & Badges

All agents participating in the project must include the designated badge on the very first line of their reply:

- **Managers**:
  ```markdown
  > 🧭 **[MANAGER — <Model Name>]**
  ```
  *(e.g., `> 🧭 **[MANAGER — GPT-6.1 Sol High]**` or `> 🧭 **[MANAGER — Claude Opus 5.5 High]**`)*

- **Workers**:
  ```markdown
  > 🛠️ **[WORKER — <Model Name> | Task <T-XXX>]**
  ```
  *(e.g., `> 🛠️ **[WORKER — GPT-6.1 Terra High | Task T-043]**` or `> 🛠️ **[WORKER — Gemini 4 Argon High | Task T-043]**`)*

---

## 2. Designated Model Roles

Per [`AGENTS.md`](file:///C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/AGENTS.md):

| Role | Designated Models | Responsibilities |
|---|---|---|
| **Manager** | `gpt-6.1-sol` (Codex), `claude-opus-5-5` (Antigravity) | Creates task IDs in `TRACKER.md`, coordinates architecture, delegates tasks, reviews completion, communicates with user. |
| **Worker** | `gpt-6.1-terra` (Codex), `gemini-4-argon` (Antigravity) | Executes assigned `T-XXX` task, strictly adheres to target files, updates status, runs minimal verification, and stops. |

---

## 3. Maintaining `TRACKER.md`

`TRACKER.md` is the **single source of truth** for all project activities.

### Lifecycle of a Task:
1. **Creation (Manager)**:
   Add entry under `Active & Recent Tasks`:
   ```markdown
   ### T-XXX: <Task Title> (<Priority P0/P1/P2>)
   - **Status**: `IN_PROGRESS`
   - **Manager**: `<Model Name>`
   - **Assigned Worker**: `<Model Name>`
   - **Target Files**: `src/...`, `tests/...`
   - **Scope & Requirements**:
     1. ...
   - **Acceptance Criteria**: ...
   ```
2. **Execution & Handback (Worker)**:
   - Worker implements the scope.
   - Worker updates status to `DONE` (or `BLOCKED` with detailed obstacle reason).
   - Worker logs touched files and concise verification output.
3. **Review & Closeout (Manager)**:
   - Manager reviews diff and verification results.
   - Manager updates the task entry and reports final summary to the user.

---

## 4. Minimal Scope & Anti-Sprawl Guardrails

1. **Strictly Confine Edits**: Only modify files explicitly listed in the task definition. Do not refactor adjacent files or "clean up" unrelated formatting.
2. **No Unnecessary Testing**: Do NOT execute full test suites (`npm test`), boot up Android emulators, or trigger full APK builds unless the task specifically requires it. Run only the targeted unit test or `npm run typecheck`.
3. **Fail-Closed on Blockers**: If authentication, OAuth credentials, or missing third-party keys block progress, immediately stop, mark `TRACKER.md` as `BLOCKED`, and request user intervention.

---

## 5. Memory, CBM & Strict Read Budget (Mandatory for All Managers & Workers)

1. Read `C:\Development\AI-Infrastructure\memory\debtfree-native\{PROJECT_OVERVIEW.md,CURRENT_TASK.md,HANDOFF.md,KNOWN_ISSUES.md}` before scanning code.
2. NEVER chunk-read files `>200` lines (`0..799`) or run `Get-ChildItem -Recurse`. Use `cbm <search_graph|get_file_outline|get_code_snippet|trace_path> --project "C-Users-lawre-OneDrive-Desktop-DF_App_Development-debtfree-native"` first, then `Read` `<=120`-line slices only.
3. Managers delegating to Workers MUST split module scope and include `cbm` + `<=120`-line limits in every `delegate_task` prompt.
4. Update `CURRENT_TASK.md`, `HANDOFF.md` (`End-of-Session Self-Check`), and `KNOWN_ISSUES.md` (`Recurring Pitfalls`, cap `<=10`) before closing.
