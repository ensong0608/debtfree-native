# UI Preferences

> Historical notes and superseded directions: [UI_PREFERENCES_ARCHIVE.md](UI_PREFERENCES_ARCHIVE.md).

## Theme, Visual Reference & Colors

- Current reference: owner-approved **Fresh Refined + 10 Colors**. Support System/Light/Dark; accent is local per-user. Indigo/Cobalt approved; Copper/Orchid not approved.
- Brand: Fresh Light `#49CC68` / `#F7F9F8`; After Dark `#090D14` / `#84FB7F`. Keep green-positive/reduction, red-negative/increase, category, and utilization-risk colors distinct. No pink on brand surfaces.
- Budget colors (stable across thresholds): Debt Plan `#76DCB9`; Housing `#60A5FA`; Transportation `#F5C563`; Utilities `#2DD4BF`; Subscriptions `#A78BFA`; Insurance `#EC4899`; Recorded Purchases `#F08B78`; Other Bills `#94A3B8`. Known-category custom groups inherit that color; other custom labels use slate. No partial-name guessing.
- Use the BitLess logo without white canvas; green mark/neutral text. “BitLess” only on Home; other tabs show their title. Settings use distinct semantic icons in rounded Option B geometry.

## Typography & Buttons

- Use Montserrat; previews may call it a Proxima Nova stand-in, never claim licensed Proxima Nova. Match reference sizing/spacing, compact hierarchy, heavier headings, and shared content rails. Use smaller spaced currency symbols and smaller prominent decimals.
- Keep labels concise; retain estimate, status, unavailable-state, and consequential-action context. Put useful secondary copy behind accessible help/details. Mark validated required fields `*`, including conditional fields.
- Pay: brand fill, black centered text; Light Meadow Green fill `#22C55E`. Unpaid is red; `Paid` is bold.

## Navigation & Swipe Pager

- Bottom order: Home, Accounts, Transactions, Budget, Progress. Keep approved icons/page presence. Context actions: Accounts—Add Debt Account; Transactions—Add Transaction; Budget—Add Monthly Expense; none on Home/Progress.
- Sections: Accounts/Strategy; History/Upcoming/Scheduled; Budget/Expense; Overview/Utilization/Milestones. Strategy only under Accounts; Upcoming/Scheduled only under Transactions.
- Use a continuous side-by-side pager: swipe left advances, right returns, adjacent page appears during drag, underline tracks 1:1. Category-row drags scroll only. Section rows have selected underline only, no baseline.
- Preserve filters, sort, date, search-open, and query across bottom tabs. Pull-to-refresh stays below fixed header, pulls content normally, and shows pull/release/refresh/updated feedback.

## Home

- Preserve established composition/payoff hero. Greet signed-in users `Hi, [name]` (no date/time) on initial open and background-to-active return, not tab/sheet changes. Remove Edit Setup/Reload.
- Your accounts is a swipeable Cards & Loans / Home / Auto carousel with pagination/accessibility, not a dropdown.
- Put conditional Upcoming before Payoff Strategy: unsettled obligations in the existing 14-day window only. Full list is Transactions > Upcoming.
- Current Balance is active debt only; historical comparison includes paid-off accounts and entered originals. Show signed current-minus-reference change, including increases, as `Balance change` plus direction; handle missing references honestly. It is not lifetime payment performance.

## Debt / Accounts / Strategy

- One filter row: All, Credit Cards, Personal Loans, Auto, Home, Paid Off. Always show All; hide empty categories. All=active, Home=active mortgages, Paid Off=archived only. Search icon fixed left, expands on tap; fade row edges when overflowing.
- All: Sort beside first nonempty group; hide group balances. Category: Sort beside heading. Paid Off: Sort beside Archived · Paid Off. Active total stays in hero.
- Stored IDs define account/bill identity; names are display-only. Mortgage/Auto and linked bills share identity/history. No synthetic checking. Account cards open Overview/Transactions/Detail; no duplicate Accounts list heading.
- Preserve history when archiving. Editors may mark existing $0 Paid; do not auto-archive new zero-balance/imported-history accounts. Confirmed principal payment from positive to zero may archive; reopening above zero restores active. Archived accounts are excluded from active balance, utilization, payoff, budget debt, and scheduled obligations.
- Detail edits terms inline; reconciliation stays in Account terms. Delete needs item-specific confirmation of permanent history removal plus linked-bill/archive safeguards. Never infer principal from notes/totals or guess mortgage escrow.
- Add Debt Account groups Debt details and Payment & Terms; optional original balance, credit limit, annual fee/renewal, escrow under More details. Use accessible type/due-day pickers and preserve validation.
- Strategy: one extra amount (Monthly/One time). What-if starts at applied amount; X restores it and closes preview. No slider helper copy; center preview actions. Monthly changes only on explicit save; one-time applies once before minimums/rollover resume. Show allocation/rollover.
- Compact Payoff order: rank, account mark, name/APR, balance, estimated payoff. One scenario list; expand for first-payment allocation and Month/Payment/Interest/Balance. Collapsible method comparison below list; monthly/one-time controls share a card. APR green `<15%`, red `>=15%`; labels neutral.

## Transactions / History / Upcoming / Scheduled

- History scope Lifetime/Year/Month beside collapsed search, Filters, Sort; date chevron at far right of calendar/date row.
- Filters: multi-select transaction-type and Accounts & bills quick-group chips (each has All), searchable account picker, removable active chips; apply groups together from current values. Separate four-way Sort sheet: newest/oldest/highest/lowest amount.
- IDs define identity; Mortgage/Auto bills share debt identity; credit-funded items appear under both identities. Debit-only is a type; no synthetic checking.
- Upcoming: unpaid attention list, overdue/due priority, grouped by actual month/year then due date, inline Pay. Preserve first-due dates, paid-cycle acknowledgements, pending/confirmed states, matching, loan deduplication; never fabricate cycles, payments, or balance changes.
- Scheduled: full recurring calendar, month paging, 12-month horizon; distinct from Upcoming. Installments collapsed by obligation, expandable for ordered dates/amounts/statuses; 2–4 installments, exact minor-unit totals, abbreviated months, `Due date`.
- Add Transaction sheet: category, applicable debt account, date, amount first; Payee/Note/payment cycle/breakdown under More details. Keep Save above keyboard/dock; preserve validation/previews; offer one recent purchase-account shortcut.

## Budget / Expense

- Budget/Expense share month state and horizontal paging. Budget holds income/commitments; Expense shows actual selected-month activity. Keep breakdown, category accordions, month controls; use stored values and avoid fabricated plans or linked-loan double counts.
- Monthly Income summary opens sources; Edit/Done expands them. Expanded sources have editable rows and inline Add income. Dedicated income modal, not onboarding; preserve names/values. No take-home copy or collapsed Income sources row.
- Allocation bar/rows use exact category colors above; show recurring/debt-plan commitments, with purchases separate. Cashflow/remaining may use mint/amber/coral without changing category identity.
- Debt payments are entered card minimums + entered extra only; show extra once and reconcile rows/summary/bar. Auto Loan stays in its matching category. Loan rows omit sync/escrow copy. Credit-funded bills/purchases show card name; purchase tap opens details.
- Approved **Option K**: cash-only semicircle/arc Cash Outflow gauge with matching expandable cash categories, plus separate Debt Tug-of-War for debt payments vs new card charges. Keep unpaid card charges separate from cash spending; preserve drilldowns. Debt/Charges details show account/date/amount.
- Cash Outflow includes debt payments and debit activity. Charges increase debt; only applied loan principal reduces balance. Early-paid items show due-date cue but count in month paid. Confirmed/acknowledged cycles in selected month show bold Paid.
- Recurring-bill forms use accessible category picker: new bills require explicit choice; edits preserve category. Add Monthly Expense fields: name, amount, category, due day, Paid with (Debit/Credit card); conditional custom category/card/loan/end date. Compact grouped sheets, pinned Save, accessible pickers, validation and scheduling preserved.

## Progress

- Overview scope Lifetime/Year/Month in hero; share compact date sheet with History. Neutral hero text, prominent gauge/amounts, pace comparison, clear adjusted-reference/unavailable states. Positive reduction has down arrow (zero none); Current balance below.
- Focus on Balance activity: omit Recorded activity, What changed, separate House & Auto block. Show Payments/Budgeted/Charges below hero, then signed net balance change. Paid-off accounts remain in recorded totals/Milestones; Balance activity lists active accounts only.
- Utilization: one Available credit summary, eligible card count, target on bar, numeric/status cues; keep existing math/risk colors. Keep milestones expanded with honest locked/history states; never invent achievements. Align period/category selectors to card edges.