# Prototype screenshot reference

Captured locally on **2026-11-04** from the existing signed-in **Brave** session at https://debtfree-dashboard.ensong0608.workers.dev/.

These 16 screenshots preserve the prototype's screen structure and visible content for future agents. They are original JPEG window captures, **503 x 906 pixels**, including the browser chrome and fixed bottom navigation. They show individual viewport positions, not full-page exports. The filenames group images in bottom-tab order. [Capture manifest](./2026-11-04/manifest.json) records each image's description and dimensions.

## How agents should use these references

- Read [APP_PLAN.md](../../APP_PLAN.md) for the current product requirements and [TRACKER.md](../../TRACKER.md) for task status. Explicit user decisions take priority over screenshot details.
- Keep the five tabs in this order: **Home, Debt, Transactions, Budget, Progress**.
- Use screenshots to understand the functional grouping, hierarchy, and prototype interactions. They do not approve every visible feature for implementation.
- **Do not copy the prototype palette as the native app's final design.** The palette remains undecided. The native icon direction is **Option B** from [the icon comparison](../../design/icon-directions.html), not the prototype icons shown here.
- Balances, names, dates, totals, selected periods, and empty states reflect the signed-in household at capture time. They are reference content, not seed data, test fixtures, or authoritative calculation rules.
- These captures do not cover every account detail, form, modal, setting, category, or full scroll range. No records or settings were changed during capture.

## Screenshot index

| Tab / view | Screenshot |
| --- | --- |
| Home: greeting, debt-free estimate, debt summary, strategy | [01-home-01-overview.jpg](./2026-11-04/01-home-01-overview.jpg) |
| Home: strategy and recent activity, lower position | [01-home-02-recent-activity.jpg](./2026-11-04/01-home-02-recent-activity.jpg) |
| Debt: Cards & Loans, search/sort, account cards | [02-debt-01-cards-and-loans.jpg](./2026-11-04/02-debt-01-cards-and-loans.jpg) |
| Debt: Home & Auto accounts | [02-debt-02-home-and-auto.jpg](./2026-11-04/02-debt-02-home-and-auto.jpg) |
| Transactions: History, filters, totals, activity | [03-transactions-01-history.jpg](./2026-11-04/03-transactions-01-history.jpg) |
| Transactions: Scheduled empty state | [03-transactions-02-scheduled-empty.jpg](./2026-11-04/03-transactions-02-scheduled-empty.jpg) |
| Budget: income, allocation, remaining, categories | [04-budget-01-overview.jpg](./2026-11-04/04-budget-01-overview.jpg) |
| Budget: Upcoming bills | [04-budget-02-upcoming-bills.jpg](./2026-11-04/04-budget-02-upcoming-bills.jpg) |
| Budget: Strategy controls and payoff priority | [04-budget-03-payoff-strategy.jpg](./2026-11-04/04-budget-03-payoff-strategy.jpg) |
| Progress: current-month overview | [05-progress-01-current-month.jpg](./2026-11-04/05-progress-01-current-month.jpg) |
| Progress: current-month activity, lower position | [05-progress-02-current-activity.jpg](./2026-11-04/05-progress-02-current-activity.jpg) |
| Progress: previous-month overview | [05-progress-03-previous-month.jpg](./2026-11-04/05-progress-03-previous-month.jpg) |
| Progress: lifetime overview | [05-progress-04-lifetime.jpg](./2026-11-04/05-progress-04-lifetime.jpg) |
| Progress: credit utilization | [05-progress-05-utilization.jpg](./2026-11-04/05-progress-05-utilization.jpg) |
| Progress: milestone overview and next unlock | [05-progress-06-milestones.jpg](./2026-11-04/05-progress-06-milestones.jpg) |
## Interaction Patterns & Interactive Blueprint (2026-11-06)

For screen-by-screen modal flows, sheet actions, accordion expansions, and explicit user behavioral preferences, read:
👉 **[`references/PROTOTYPE_INTERACTION_PATTERNS.md`](../PROTOTYPE_INTERACTION_PATTERNS.md)**

Captured on **2026-11-06** in mobile viewport (**iPhone 14 Pro Max**, 430 × 932 px), stored in [`references/prototype/interactions/`](./interactions/):

| View / Flow | Screenshot | Interaction Highlights |
| :--- | :--- | :--- |
| Home: Overview | [01-home-01-overview.png](./interactions/01-home-01-overview.png) | Cards & Loans summary, Payoff strategy preview (clickable), Recent activity |
| Home: Carousel (Home) | [01-home-02-carousel-home.png](./interactions/01-home-02-carousel-home.png) | Home mortgage carousel slide (user wants visual redesign) |
| Home: Carousel (Auto) | [01-home-03-carousel-auto.png](./interactions/01-home-03-carousel-auto.png) | Auto loan carousel slide |
| Debt: Cards & Loans | [02-debt-01-cards-and-loans.png](./interactions/02-debt-01-cards-and-loans.png) | Filters, search, sort, account cards (click opens detail sheet) |
| Debt: Account Modal (Overview) | [02-debt-02-debt-modal-overview.png](./interactions/02-debt-02-debt-modal-overview.png) | Detail sheet Tab 1: APR, minimums, payoff estimate, sparkline history |
| Debt: Account Modal (Transactions) | [02-debt-03-debt-modal-transactions.png](./interactions/02-debt-03-debt-modal-transactions.png) | Detail sheet Tab 2: account-filtered transactions & totals |
| Debt: Account Modal (Detail) | [02-debt-04-debt-modal-detail.png](./interactions/02-debt-04-debt-modal-detail.png) | Detail sheet Tab 3: terms, APR, minimums, delete button |
| Debt: Home & Auto | [02-debt-05-home-and-auto.png](./interactions/02-debt-05-home-and-auto.png) | Filter pill switched to Home & Auto accounts |
| Debt: Add Debt Modal | [02-debt-06-add-debt-modal.png](./interactions/02-debt-06-add-debt-modal.png) | Add debt account modal |
| Transactions: History | [03-transactions-01-history.png](./interactions/03-transactions-01-history.png) | Period dropdown, Account filter, monthly metric cards |
| Transactions: Edit Modal | [03-transactions-02-edit-transaction-modal.png](./interactions/03-transactions-02-edit-transaction-modal.png) | Edit transaction sheet with real-time balance calculator |
| Transactions: Scheduled | [03-transactions-03-scheduled-empty.png](./interactions/03-transactions-03-scheduled-empty.png) | Scheduled toggle state |
| Budget: Overview | [04-budget-01-overview.png](./interactions/04-budget-01-overview.png) | Month picker, income card, segmented progress bar, category totals |
| Budget: Category Expanded | [04-budget-02-category-expanded.png](./interactions/04-budget-02-category-expanded.png) | Accordion expansion into line items |
| Budget: Edit Spending Sheet | [04-budget-03-edit-spending-sheet.png](./interactions/04-budget-03-edit-spending-sheet.png) | Modal for editing line items |
| Budget: Upcoming Bills | [04-budget-04-upcoming-bills.png](./interactions/04-budget-04-upcoming-bills.png) | Chronological bills with Pay Now buttons |
| Budget: Pay Now Match Modal | [04-budget-05-pay-now-match-modal.png](./interactions/04-budget-05-pay-now-match-modal.png) | Pay Now sheet with unassigned payment matching |
| Budget: Strategy Overview | [04-budget-06-strategy-overview.png](./interactions/04-budget-06-strategy-overview.png) | Extra payment input, Avalanche/Snowball, ranked list |
| Budget: Strategy Table Expanded | [04-budget-07-strategy-penfed-expanded.png](./interactions/04-budget-07-strategy-penfed-expanded.png) | Expanded inline monthly payoff projection table |
| Progress: Overview | [05-progress-01-overview.png](./interactions/05-progress-01-overview.png) | Period toggle, target gauge, activity by account |
| Progress: Utilization | [05-progress-02-utilization.png](./interactions/05-progress-02-utilization.png) | Utilization gauge, cards to review, paydown targets |
| Progress: Milestones | [05-progress-03-milestones.png](./interactions/05-progress-03-milestones.png) | Counters, Next unlock, timeline |
| Settings: Overview | [06-settings-01-overview.png](./interactions/06-settings-01-overview.png) | Preferences, Household, Data & Security |
| Settings: Backup & Recovery | [06-settings-02-backup-sheet.png](./interactions/06-settings-02-backup-sheet.png) | Export full backup, restore checkpoint |
