# UI Preferences

> Historical decisions and superseded directions: [UI_PREFERENCES_ARCHIVE.md](UI_PREFERENCES_ARCHIVE.md).

## Theme, Visual Reference & Colors

- Current reference: **Fresh Refined + 10 Colors**. Support System/Light/Dark with local per-user accent; Indigo/Cobalt approved, Copper/Orchid not.
- Brand: Fresh Light `#49CC68` / `#F7F9F8`; After Dark `#090D14` / `#84FB7F`. Green=positive/reduction; red=increase/negative. Keep category/risk colors distinct; no pink brand surfaces.
- Budget colors: Debt Plan `#76DCB9`, Housing `#60A5FA`, Transportation `#F5C563`, Utilities `#2DD4BF`, Subscriptions `#A78BFA`, Insurance `#EC4899`, Recorded Purchases `#F08B78`, Other Bills `#94A3B8`. Known-category custom groups inherit color; others slate. No partial-name guessing or threshold recoloring.
- BitLess mark has no white canvas; green mark/neutral text; name on Home only.

## Typography & Buttons

- Montserrat; previews may call it a Proxima Nova stand-in, never licensed Proxima Nova. Match reference sizing/spacing, compact hierarchy, heavier headings/rails, smaller spaced currency symbols and prominent decimals.
- Keep copy concise but retain estimate/status/unavailable/action context. Use accessible help for secondary detail; mark validation-required fields `*`, including conditional ones.
- Pay uses brand fill with centered black text; Light Meadow Green `#22C55E`. Unpaid red; `Paid` bold.

## Navigation & Swipe Pager

- Tabs: Home, Accounts, Transactions, Budget, Progress; preserve approved icons/page presence; no selected-tab background. Context Add: Accounts—Add Debt Account; Transactions—Add Transaction; Budget—Add Monthly Expense; none Home/Progress. FAB `#49CC68` light / `#84FB7F` dark on those three only.
- Sections: Accounts/Strategy; History/Upcoming/Scheduled; Budget/Expense; Overview/Utilization/Milestones. Strategy only under Accounts; Upcoming/Scheduled only under Transactions.
- Continuous side-by-side pager: left advances, right returns, adjacent page follows drag, underline tracks 1:1. Category drags scroll only; section selector underline only/no baseline. Preserve filter/sort/date/search/query across tabs. Pull-to-refresh below fixed header with normal pull and pull/release/refresh/updated feedback.

## Home

- Preserve composition/payoff hero. Greet `Hi, [name]` without date/time at initial open/background return only; no Edit Setup/Reload. Your accounts: accessible Cards & Loans / Home / Auto swipe carousel with pagination, not a dropdown.
- Conditional Upcoming precedes Payoff Strategy; show unsettled obligations within 14 days only. Full list: Transactions > Upcoming.
- Current Balance=active debt. Historical comparison includes paid-off accounts and entered originals. Show signed current-minus-reference change (including increases) as `Balance change` + direction; handle missing references; never call lifetime performance.

## Debt / Accounts / Strategy

- Filters: All, Credit Cards, Personal Loans, Auto, Home, Paid Off; always All, hide empty. All=active; Home=active mortgages; Paid Off=archived. Search fixed left/expands on tap; fade overflow. Sort beside first nonempty group in All (hide group balances), selected heading, or Archived · Paid Off; active total in hero.
- Stored IDs define account/bill identity; names display only. Mortgage/Auto and linked bills share identity/history; no synthetic checking. Cards open Overview/Transactions/Detail; no duplicate Accounts heading.
- Archive keeps history; existing $0 may be marked Paid, but new-zero/imported-history accounts are not auto-archived. Confirmed principal payment to zero may archive; reopening above zero restores active. Archived accounts stay out of active balances, utilization, payoff, budget debt, scheduled obligations.
- Detail terms edit inline; reconciliation stays in Account terms. Delete requires item-specific confirmation of permanent history loss and linked-bill/archive safeguards. Never infer principal from notes/totals or guess mortgage escrow.
- Add Debt Account groups Debt details + Payment & Terms; optional originals, limit, annual fee/renewal, escrow under More details; accessible type/due-day pickers and validation.
- Strategy: one extra amount (Monthly/One time). What-if starts applied; X restores/closes. No slider helper; center preview actions. Monthly changes only on explicit save; one-time applies once before minimums/rollover resume. Show allocation/rollover.
- Compact Payoff order: rank/mark/name/APR/balance/payoff date; one scenario list. Expand for first allocation and Month/Payment/Interest/Balance. Collapsible comparison below; monthly/one-time share a card. APR green `<15%`, red `>=15%`; labels neutral.

## Transactions / History / Upcoming / Scheduled

- History Lifetime/Year/Month beside collapsed search, Filters, Sort; date chevron far right. Filters: multi-select type and Accounts & bills quick-group chips (each All), searchable account, removable chips; apply current values together. Separate 4-way Sort: newest/oldest/highest/lowest amount.
- IDs define identity; Mortgage/Auto bills share debt identity; credit-funded items appear under both. Debit-only is a type; no synthetic checking.
- Upcoming: unpaid attention list, overdue/due priority, grouped by actual month/year then due date, inline Pay. Preserve first-due dates, paid-cycle acknowledgements, pending/confirmed states, matching and loan deduplication; never fabricate cycles/payments/balance changes.
- Scheduled: full recurring calendar, month-paged over 12 months, separate from Upcoming. Installments collapsed by obligation; expand for ordered dates/amounts/statuses. Support 2–4, exact minor-unit totals, abbreviated months, `Due date`.
- Add Transaction: category/debt account/date/amount first; Payee/Note/payment cycle/breakdown under More details. Save above keyboard/dock; preserve validation/previews; offer one recent purchase shortcut.

## Budget / Expense

- Budget/Expense share month state and horizontal paging. Budget=income/commitments; Expense=actual selected-month activity. Keep one category list, breakdown/accordions/month controls; use stored values, no fabricated plans or linked-loan double counts.
- Monthly Income summary opens sources; Edit/Done expands. Expanded sources have editable rows + inline Add income; dedicated modal, not onboarding. Preserve names/values; no take-home copy/collapsed Income sources row.
- Allocation bar/rows use category colors above for recurring/debt-plan commitments; purchases separate. Cashflow/remaining may use mint/amber/coral without changing category identity.
- Debt payments=entered card minimums + extra only; show extra once and reconcile rows/summary/bar. Auto Loan stays in its category; omit sync/escrow copy. Credit-funded bills/purchases show card name; purchase tap opens details.
- **Option K:** cash-only semicircle/arc Cash Outflow gauge + expandable cash categories; separate Debt Tug-of-War (debt payments vs new card charges). Unpaid charges stay separate from cash; drilldowns show account/date/amount.
- Cash Outflow includes debt payments/debit activity; charges increase debt, only applied loan principal reduces balance. Early-paid items show due-date cue but count in month paid. Confirmed/acknowledged cycles show bold Paid.
- Recurring-bill picker: new requires explicit category; edit preserves it. Add Monthly Expense groups name/amount/category/due day/Paid with; conditional custom category/card/loan/end date. Compact grouped sheet, accessible pickers, pinned Save, validation/scheduling.

## Progress

- Overview Lifetime/Year/Month in hero; compact date sheet shared with History. Neutral hero, prominent gauge/amounts, pace comparison, honest adjusted-reference/unavailable states. Positive reduction=down arrow; zero=none; Current balance below.
- Focus on Balance activity: omit Recorded activity, What changed, separate House & Auto block. Show Payments/Budgeted/Charges below hero, then signed net balance change. Paid-off accounts remain in recorded totals/Milestones; Balance activity lists active only.
- Utilization: one Available credit summary, eligible card count, target on bar, numeric/status cues; preserve math/risk colors. Milestones expanded with honest locked/history states; never invent achievements. Align period/category selectors to card edges.