# Project Agent Rules & Guardrails (`debtfree-native`)

All agents (Gemini, Codex, Claude, and delegated subagents) operating in this repository MUST follow these rules alongside the global memory, CBM, Scout (`!scout`), and `relay` rules.

## Project Memory & Code Retrieval Scope

- **Project ID:** `debtfree-native` | **CBM Graph Project:** `C-Users-lawre-OneDrive-Desktop-DF_App_Development-debtfree-native`
- **Memory Dir:** `C:\Development\AI-Infrastructure\memory\debtfree-native\` (also read `KNOWN_ISSUES.md` → `Recurring Pitfalls` at session start).
- **Large-File Warning:** Never full-read `DebtScreen.tsx`, `TransactionsScreen.tsx`, `HomeScreen.tsx`, `ProgressScreen.tsx`, `BudgetScreen.tsx`, `FinancialScreen.tsx`, or `design/*.html` (especially embedded `data:`/base64 lines like line 96). Always use CBM + bounded `<=120`-line slices.
- **Capabilities Inventory:** Read [APP_CAPABILITIES.md](APP_CAPABILITIES.md) when assessing BitLess capabilities or planning user-facing features; update it in the same change when adding, changing, or removing a user-facing capability (skip routine fixes/polish/status).

## Authorization, Safety & UI References

- **Authorized:** Local UI/code work, sandbox Supabase **`bitepxsdujceoszbldhd`**, and local APK install on emulator `DebtFree_Pixel_API_36`.
- **Strict Hold (Never Without Explicit Owner Authorization):** Production deployment, production DB/schema changes, live financial record mutations, APK store upload, and email delivery. Always verify live CLI/DB state before claiming something is missing.
- **UI & Calculation Specs:** Before UI or math work, read [references/UI_PREFERENCES.md](./references/UI_PREFERENCES.md) (supersedes older screenshots/reports), [references/PROTOTYPE_CALCULATIONS.md](./references/PROTOTYPE_CALCULATIONS.md), and [APP_PLAN.md](./APP_PLAN.md). Historical UI directives live in `DECISIONS.md`.

## Mandatory Regression Guardrails (`T-321..T-327`)

1. **Migrations before client RPC calls:** Verify required migrations exist on sandbox `bitepxsdujceoszbldhd` first (or keep a tested fallback) and keep local migration timestamps aligned with remote `schema_migrations`.
2. **Pending-journal, cache durability & `Add -> Delete -> Delete Account`:** Keep `assertHouseholdFinanceContextReady` / `recoverPendingFinanceWrites` respecting resolved commands (`Boolean(command.resolution)`), scanning all membership versions, and gating `isLocalAcceptanceFinanceOwner` to `__DEV__`. Preserve soft-delete `desiredDeletedRow`, `cache-delta` durability before `finishPendingCommand`, and `assertAccountDeletionReady`. Never hold `withFinanceLock` across remote network requests (`loadFinanceRecords` 3-phase lock-free fetch), and keep `MAX_CHUNKS = 9999` / `runBatched(8)` in `src/secure-chunks.ts`.
3. **UI render isolation & pull-to-refresh:** Keep `AppearanceContext` memoized + style-ID caching in `src/components/NativeAppearance.tsx`, stabilized `HomeScreen` → `FiveTabShell` props, split `TabShellContext` hooks, `useMemo` in `BudgetScreen`/`ProgressScreen`/`DebtScreen`, and `PullToRefreshScrollView` `'settling'` / timeout guards.
4. **Bills & payment labels:** Prompt before setting `cycleDueDayOverrides[month] = null` and restore suppressed cycles on revert; reserve `"Auto-Bill"` strictly for `Auto-recorded recurring bill...` rows (`"Bill Payment"` for confirmed payments); exclude foreign `[bill:...]` tags in payment matching.
5. **Standalone APK validation:** Validate phone APKs with `scripts/android_apk_delivery.py` (embedded bundle, `debuggable: false`, matching V2 signer, subpath Montserrat weights only).

## Visual Identification & Scope Rules (All Agents)

- **Message Role Badges:** Managers start every message with `> 🧭 **[MANAGER — <Model Name>]**`; Workers start every message/handback with `> 🛠️ **[WORKER — <Model Name> | Task <T-XXX>]**`.
- **Sidebar Titles:** `🧭 [MANAGER] <Title>` (planning threads), `🛠️ [WORKER • <ShortModel>] <T-XXX>: <Title>` (workers), `🔍 [SCOUT • <ShortModel>] <Topic>` (scouts).
- **Minimal Scope & No Unnecessary Tests:** Do only what is required. Do not write new tests, run full `npm test`, launch emulators, or run full builds unless explicitly requested or strictly required to verify the task.
- **Keep Logs Lean:** Pipe verbose shell/test/build output (`| Select-Object -Last 40`) or delegate noisy build/test loops to `GPT-6 Luna`.
- **Stop on Blockers:** On unexpected blockers, ambiguity, or required user sign-in/approval, stop immediately, mark `BLOCKED` in [TRACKER.md](./TRACKER.md), and report clearly.

## Manager & Worker Model Routing

- **Manager Default:** `Gemini 4 Hydrogen` (`antigravity` / `gemini-4-hydrogen`, `thinking_level: "medium"` or `"high"`; reserve `"xhigh"` for hard architecture/debugging). Backup: `GPT-6 Luna (Max)`.
- **Disallowed Unless Owner Explicitly Requests:** `GPT-6.1 Sol` (`gpt-6.1-sol`) and `GPT-6.2 Sol` (`gpt-6.2-sol`).

| Tier / Role | Provider | Model | Default Options |
| :--- | :--- | :--- | :--- |
| **Scout (Read-Only)** | `codex` (primary) / `antigravity` | `gpt-6-luna` / `gemini-3.8-flash` | `reasoningEffort: "medium"` / `thinking_level: "medium"` |
| **Easy Worker** | `codex` / `antigravity` | `gpt-6-luna` / `gemini-3.8-flash` | `reasoningEffort: "medium"` (or `"max"`) / `thinking_level: "medium"` |
| **Medium Worker** | `codex` | `gpt-6.1-terra` | `reasoningEffort: "medium"` or `"high"` |
| **Hard Worker** | `antigravity` | `gemini-4-hydrogen` | `thinking_level: "high"` (or `"xhigh"` if needed) |

- **Manager Responsibilities:** Keep [TRACKER.md](./TRACKER.md) **under 100 lines** (archive completed milestones to `C:\Development\AI-Infrastructure\memory\debtfree-native\`; design coupled client/SQL contracts together); before delegating, log Task ID (`T-XXX`), target files, acceptance criteria, and explicit "What NOT to do" boundaries; review & close out when Workers finish.
- **Worker Responsibilities:** Follow your assigned Task ID in `TRACKER.md` and Manager prompt strictly; do not spawn subagents unless instructed; update `TRACKER.md` (`DONE` + summary + modified files, or `BLOCKED` + exact reason) and stop immediately.
