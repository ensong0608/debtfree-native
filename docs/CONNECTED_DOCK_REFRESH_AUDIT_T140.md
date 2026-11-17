# T-140: Connected dock and refresh independent source audit

Scope: current source and approved `design/navigation-connected-dock-2026-11-09.html`; no runtime, device, browser, service or build verification. Read project decisions, plan, prototype references and T-137?T-140. Supabase skill consulted for storage-path review; no service was queried.

## Prioritized findings

1. **P1 ? Refresh can commit results for an obsolete account/scope.** `src/OnboardingAndHome.tsx:363-414` captures `session` and `onboardingData`, compares the returned user only with that captured data, then calls `onUpdateOnboardingData` and sets records after awaits without checking the *current* session/user or invalidating an in-flight refresh. An account change during the request can therefore apply the previous account's settings and records to the current UI. The existing initial-load effect has a cancellation flag (`:323-360`), but the new gesture makes this unguarded reload readily callable. Guard every commit against current session/user and currency or invalidate on scope change; preserve current records on stale completion.
2. **P2 ? Approved visual mismatch.** `src/FiveTabShell.tsx:115-116` uses `palette.brand`/`palette.onBrand` for the selected tab; the approved design `.dock button.active` uses `var(--text)`/`var(--canvas)`. `FiveTabShell.tsx:131` uses radius 28 for every dock corner; the approved `.menu` uses 40, and `.menu.has-action` uses 28 top / 40 bottom. These are concrete source differences across themes, not a runtime appearance assessment. Correct to approved inverse colors and conditional corner geometry.

## Owner requirement matrix

| Requirement | Source assessment |
|---|---|
| Stable registration and stale callbacks | `FinancialScreen.tsx:35-45` stores inline callbacks in a ref; effect depends on stable registration, tab and boolean availability, not callback identity. `FiveTabShell.tsx:47-53` token-checks cleanup and checks selected tab before invoking. No source-evident effect loop or cross-tab callback invocation. Runtime scheduling remains unverified. |
| Contextual actions and sections | `DebtScreen.tsx:298`, `TransactionsScreen.tsx:480-490`, `BudgetScreen.tsx:458-474` register existing form openers regardless of child section and disable while the respective editor is open; labels are correct, including singular Transaction. Home/Progress have no action labels. Opening does not set a section. `FinancialScreen.tsx:46` keeps legacy add only outside the shell. |
| Refresh all five below header | Home has `RefreshControl` on its main scroll at `HomeScreen.tsx:1071`; Debt, Transactions, Budget and Progress use shared `FinancialScreen` scroll and control at `FinancialScreen.tsx:64-66`, below header. `HomeScreen.tsx:185-199` coalesces concurrent calls and invokes existing reload; it does not set welcome state or route. Source does not establish gesture behavior on actual platforms. |
| Drafts, routes and data | Reload does not explicitly reset tab, section, forms or welcome; in-place updates retain mounted component state provided its scope remains stable. See P1 for account transition. Offline/error paths retain on-screen finance records (`OnboardingAndHome.tsx:384-412`); partial settings failure is reported. |
| Pending writes | `finance-storage.ts:317-445` reads journal/cache, evaluates readback, merges unresolved writes into server rows and saves merged cache; load is serialized per user at `:1294-1295`. Pending snapshot is warned and not marked verified. Readback may update journal confirmation; no replay of writes is in this load path. No backend behavior was tested. |
| Icons, sizing and accessibility | `NavigationIcon.tsx:5-12` reproduces approved house, wallet-cards, receipt-text, panels-top-left and gauge paths at 28 with stroke 2; selected width 160 when noncompact, compact icon-only labels with accessibility labels and minimum 44-wide/60-high controls (`FiveTabShell.tsx:100-125`). Actual fit at extreme widths/font scaling requires native verification. |
| Safe areas and final content | Shell uses safe-area edges and places dock after flex content, rather than overlaying scroll (`FiveTabShell.tsx:83-94`); shared scroll has bottom padding (`FinancialScreen.tsx:252`). This is source evidence only, not proof of layout or touch visibility on devices. |
| Scope | No collaboration implementation or backend deployment was performed in this audit. No claim of full financial-system review. |

No tests, typecheck, build, device, browser, backend or authentication actions were performed. Fresh native certification is unavailable; manager's integrated typecheck was not rerun.


## Manager corrections after audit

- Added account/household/currency scope identity and per-request ownership to the manual refresh in OnboardingAndHome. Scope changes invalidate old requests, cleanup prevents unmounted commits, and checks after asynchronous settings/finance reads and in catch/finally prevent stale results, errors or completion from modifying a later scope. An obsolete request cannot clear a newer request's spinner. Home coalescing is also released on owner/scope change and captures the intended callback before its microtask.
- Selected tab now uses palette.text for its background and palette.canvas for icon/label, matching the approved inverse pill. Dock defaults to40px corners; tabs with attached actions use28px top corners and40px bottom corners. Selected capsule remains160px and60px high at regular width; compact fallback retained. Decorative navigation SVGs are hidden from accessibility.
- Final npm.cmd run typecheck passed after these corrections. No new tests, build, device, browser or backend access. These are manager source corrections, not a fresh independent re-audit or runtime certification. Native size/font/safe-area fit, all Add form actions, pull gestures and account-transition network behavior still require runtime verification.

Application integration is complete in local source. No financial formulas, live records, remote writes, collaboration or schema deployment were changed in this work.
