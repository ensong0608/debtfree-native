# Approved Debt and Progress implementation

2026-11-08. T-097 and T-098 completed by the manager after the Debt worker handback and partial Progress handback. The owner approved the design with the centered dropdown-chevron correction.

## Result

- Debt: unboxed balance hero; one compact category filter; populated Cards & Loans and Home & Auto groups; quieter account rows and search/sort. Existing SVG chevrons replace font-dependent arrows. Add action occupies a reserved footer so it cannot cover a group total.
- Progress Overview: prominent snapshot and confirmed payments; compact activity period; account activity and methodology on demand. Payment balance reduction remains distinct from payments and net balance change.
- Utilization: prominent aggregate and per-card used amounts; fixed 30% marker and aligned label; continuous green/amber/coral presentation with numeric and domain status cues. Missing limits stay unavailable. Over-limit values remain visible above 100%, while the visual bar is capped.
- Milestones: theme-aware trophy seal, supported recorded achievement count, path and next unlock. Current utilization is a separate current-state goal. Unsupported payoff/history milestones stay locked with explanations on demand.

Financial calculation functions, stored inputs, status thresholds and persistence contracts were not changed by these two visual tasks.

## Verification

- Integrated `npm.cmd run typecheck`: passed, including final native text-clipping corrections.
- Existing focused `tests/finance-progress.test.mjs`: 7 checks passed before the final layout-only corrections. No broad suite or new tests.
- Read-only Android check on the already-running DebtFree Pixel API 36 emulator, current Metro source: category picker and Cards & Loans scope; exact group totals; account modal Overview, Transactions and Detail; Strategy and schedule expansion; all three Progress sections; activity-period change (current to previous and back); activity-by-account expansion; locked payoff milestone expansion and information dialog.
- Visually inspected the four saved native captures. Corrected large-number clipping caused by mixed-size nested Text and moved the Debt add action out of the content overlay. Dropdown chevrons are centered symmetric SVGs.
- No builds, commits, financial edits, saves, backend queries or mutations were performed for this verification.

## Evidence and limits

- `debt-accounts.png`, `progress-overview.png`, `utilization.png`, `milestones.png` are current native Android dark-appearance captures, not proposal mockups. Additional accounts/content remain scrollable below each viewport. The translucent gear overlay at the upper left is also present in the owner's original native capture and was not introduced by this redesign.
- Source review covers empty, missing-limit, pending and over-limit presentation. The current account supplied actual over-limit runtime evidence. Other edge cases were not forced by editing stored financial data.
- iOS, light appearance, larger accessibility text settings and full screen-reader traversal were not runtime-certified. Theme mapping and accessibility labels are implemented, but source inspection does not prove those runtime conditions.
- These tasks close the approved Debt/Progress implementation; they do not certify every unrelated app flow or historical task.
