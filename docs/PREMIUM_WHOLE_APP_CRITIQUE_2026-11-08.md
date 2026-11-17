# Whole-app premium critique — 2026-11-08

Design review only; obtain owner approval before implementation. Findings use current source and historical native captures, not runtime verification. Reviewed `docs/acceptance/2026-11-08/09-home-light-final.png`, `premium-debt-progress/debt-accounts.png`, `premium-forms/budget-overview.png`, and `12-add-debt-light-fixed.png`; other screens below are source-based. Captured household values are not design content. Label proposed examples synthetic.

## Priorities

1. **Recover Debt space.** `src/screens/DebtScreen.tsx:280–303` stacks a 20px-padded hero, heading/filter, search/sort, 22px group gap and 16px row padding. The native capture shows only two accounts before the add action. Reduce hero padding to roughly 12–14px, group gaps and row padding to 10–12px; keep 44px touch targets and footer clearance. Keep filter, search and sort accessible. Aim to expose another meaningful row, not a fixed device-specific count.
2. **Design Light deliberately.** `src/components/NativeAppearance.tsx` maps dark colors to light, while `src/components/FinancialScreen.tsx:215–247` repeats card borders, padding and gaps. Captured Light Home reads as pale stacked boxes; add debt nests gray fields in a white box within a gray sheet. Propose a warm neutral canvas, white surfaces, dark ink, restrained green accents and subtle separators, using contrast-checked semantic tokens. Dark needs layered charcoal and selective mint. Preserve established palette and category identity.
3. **Use composition for hierarchy.** One financial focal point per screen; compact section labels, aligned amounts and grouped rows. Reserve tinted surfaces for actionable summaries and states. Avoid repeated badges, gratuitous gradients, faux bank branding and invented charts.

## Screen proposals

- **Home** (`src/screens/HomeScreen.tsx:1038–1140`): compact the estimate into an editorial hero with date, months and estimate label; make the category carousel a distinctive horizontal balance panel with clear switching. Place strategy as a compact linked row and activity as a short dated list. Preserve offline/pending alerts and conditional 14-day unsettled upcoming card.
- **Debt Accounts** (`DebtScreen.tsx:278–310`): retain one category filter, grouping, scoped totals, search and sort. Use a compact balance header and two-line rows with name/category/APR left, balance and estimated date right. Keep reference percentage interpretable and distinguish group totals. Account rows still open the three-tab sheet.
- **Debt Strategy** (`DebtScreen.tsx:314–378, 594`): replace three similarly weighted cards with a concise plan header, editable extra payment, compact Snowball/Avalanche choices and numbered priority rows. Expansion still reveals Month / Payment / Interest / Balance inline. Mortgage remains separate, with escrow and independent extra-payment limitations visible when relevant; retain save and error states.
- **Transactions History** (`TransactionsScreen.tsx:776–913`): compress the three summary tiles into a quiet strip, then use a filter row and date-grouped ledger with aligned signed amounts and transaction type. Preserve edit, matching, pending and empty states; do not imply complete history.
- **Transactions Upcoming** (`TransactionsScreen.tsx:681–685`, `src/components/UpcomingObligations.tsx`): month/year headers and due-date clusters, with overdue/status cues and remaining amount visible. Make payment an explicit contextual action, preserving matching and confirmation safeguards.
- **Transactions Scheduled** (`TransactionsScreen.tsx:686–760`): compact month pager and calendar with selected-day agenda below. Distinguish settled, pending and future cycles with labels as well as color. This complete recurring calendar is distinct from the unpaid attention list; keep pagination and safeguards.
- **Budget** (`BudgetScreen.tsx:627–805`): compact Monthly Income and remaining summary, retain collapsed Income sources directly beneath, then month controls and denser accordion rows. Keep the category-colored bar and matching rows, expansion chevrons and separate recorded purchases. The captured two large cards compete; category colors express identity, not risk.
- **Progress Overview** (`ProgressScreen.tsx:112–148`): separate balance snapshot from recorded activity with typography and a divider; keep period picker adjacent to activity. Align payments, balance reduction, interest/fees and net change as a ledger. Keep target and expandable account activity; no invented trend graph.
- **Progress Utilization** (`ProgressScreen.tsx:149–179`): lead with used amount and percent, 30% target marker and numeric/status cues. Align available credit and target below; compact per-card rows without concealing missing limits or over-limit values. Preserve thresholds and aggregate exclusions.
- **Progress Milestones** (`ProgressScreen.tsx:181–211`): use a restrained path with earned seals and clear next step. Differentiate recorded achievements, current-state utilization and locked payoff milestones; retain accessible evidence controls and do not depict missing history as completed.
- **Settings** (`SettingsScreen.tsx:674, 1234 onward`): grouped compact navigation rows, consistent icons, disclosure and short state labels. Surface disabled/deferred features and recovery states honestly; retain consequential confirmations and explanations.
- **Add/edit sheets** (`SheetModal.tsx:12–34`, `DebtScreen.tsx:382–390`, `BudgetScreen.tsx:510–514`, `TransactionsScreen.tsx:953`): use one sheet surface, with readable title/close, scrollable fields and clear bottom actions. Pair numeric fields only when labels fit. Include focus, invalid and keyboard states. Mark required fields from validation; recurring categories remain visible radio rows with no new-bill default. Show edit, error, long-name and conditional-field examples.

## Financial and behavioral guardrails

- Balance below reference is a snapshot, not payment history; estimates are projections. Keep unknown loan principal unknown, pending distinct from confirmed, and unavailable history explicit.
- Budget Debt payments are entered card minimums plus extra once; Auto belongs in its own category. Match allocation and category colors; keep purchases separate from commitments. Do not invent amounts.
- Preserve bottom navigation and horizontal Debt and Transactions segments. Strategy belongs only in Debt; Upcoming and Scheduled only in Transactions. Preserve Home redirects, detail tabs, inline projection expansion and payment safeguards.
- Never reproduce household names, values or dates from captures as real design data. Label synthetic examples; do not create decorative history, payoff events or payment states.

## Manager visual-review checklist

- [ ] Present full-screen current/proposed comparisons for every named page and representative add/edit sheets in Light and Dark; identify source reconstructions and synthetic content. Include material expanded, empty, pending, error and long-text states.
- [ ] Compare Debt viewport and scroll depth: less wasted space, readable values, intact controls, no add-button overlap, accessible labels and 44px targets.
- [ ] Check each theme separately for contrast of text, dividers, selected controls, input boundaries, status cues and category colors; no color-only meaning.
- [ ] Check consistent type, spacing and amount alignment without suppressing conditional alerts or consequential explanations.
- [ ] Review navigation, modal, calendar, accordion and save/confirmation states against current owner preferences; mockups do not prove runtime behavior.
- [ ] Verify estimates, snapshot, utilization target and missing limits, milestone evidence, Budget reconciliation and unpaid versus scheduled semantics against source. Obtain owner approval before implementation.
