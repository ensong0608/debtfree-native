# Prototype Interaction Patterns & User Experience Blueprint

> **Current native decisions (2026-11-08):** Read [UI_PREFERENCES.md](./UI_PREFERENCES.md). Upcoming lives only under Transactions, grouped by month/year then due date. Scheduled lives only under Transactions; Strategy lives only under Debt. Budget has no Upcoming or Scheduled section. Home shortcuts follow these destinations. Keep current colors/style and horizontal placement; use Monthly Income / Edit and collapsed Income sources. Prototype descriptions below are historical.

This document captures the screen-by-screen interactive behavior, navigational flows, modals, accordions, and user-specified design and functional directives from the live prototype at [debtfree-dashboard.ensong0608.workers.dev](https://debtfree-dashboard.ensong0608.workers.dev/).

> **Source Reference**: Captured on **2026-11-06** in mobile viewport (**iPhone 14 Pro Max**, 430 × 932 px).  
> **Location of Screenshots**: [`references/prototype/interactions/`](./prototype/interactions/)

---

## 1. Core User Directives & Design Decisions

All agents developing or reviewing screens for the native app MUST abide by the following user preferences:

1. **Behavioral Model, Not a Carbon Copy**:  
   We do not want to duplicate every single aesthetic detail or color palette of the web prototype, but the prototype defines the **exact interaction model, hierarchies, modal popups, accordion expansions, and redirection flows**.
2. **Upcoming Recurring Bills Card (Home Tab)**:  
   - **Behavior**: Hidden by default on the Home tab.  
   - **Trigger**: It **only appears on the Home tab** if a recurring bill or credit card is nearing its due date AND the minimum payment has **not been settled yet**.
   - **Source List (current owner decision)**: The full list lives under **Transactions → Upcoming**, grouped by month and due date.
3. **Home Card Carousel**:  
   - The user likes the carousel concept (cycling through Cards & Loans, Home, Auto) on the Home tab, but **does not love the current visual design**. Keep the functional grouping but refine the layout and styling in the native app.
4. **Payoff Strategy Redirection**:  
   - Clicking on the "Payoff strategy" card or its "See all" button on the Home tab redirects directly to **Debt → Strategy**.
5. **Debt Detail Popups (Debt Tab)**:  
   - Clicking any debt card on the Debt tab opens a **bottom sheet/modal** with three tabs: **Overview**, **Transactions**, and **Detail**.
6. **Payoff Strategy Monthly Schedule Expansion (Debt → Strategy)**:  
   - In the Payoff Strategy ranked list, **clicking an individual account row expands an inline monthly payoff projection table** (`Month`, `Payment`, `Interest`, `Balance`).
7. **Strict Backend Safety**:  
   - Never write scripts that edit, delete, or submit forms that alter live production/prototype data.

---

## 2. Screenshot Index

All screenshots are stored in [`references/prototype/interactions/`](./prototype/interactions/):

| View / Flow | Screenshot File | Key Interactions Shown |
| :--- | :--- | :--- |
| **Home: Overview** | [`01-home-01-overview.png`](./prototype/interactions/01-home-01-overview.png) | Greeting, countdown card, Cards & Loans summary, Payoff strategy preview, Recent activity. |
| **Home: Carousel (Home)** | [`01-home-02-carousel-home.png`](./prototype/interactions/01-home-02-carousel-home.png) | Carousel slide 2: Home mortgage paid vs balance and % reduced. |
| **Home: Carousel (Auto)** | [`01-home-03-carousel-auto.png`](./prototype/interactions/01-home-03-carousel-auto.png) | Carousel slide 3: Auto loan paid vs balance and % reduced. |
| **Debt: Cards & Loans** | [`02-debt-01-cards-and-loans.png`](./prototype/interactions/02-debt-01-cards-and-loans.png) | Filter pills, category summary, sort, search, account list with payoff dates. |
| **Debt: Account Modal (Overview)** | [`02-debt-02-debt-modal-overview.png`](./prototype/interactions/02-debt-02-debt-modal-overview.png) | Account popup modal: balances, APR, minimums, payoff estimate, balance history sparkline. |
| **Debt: Account Modal (Transactions)** | [`02-debt-03-debt-modal-transactions.png`](./prototype/interactions/02-debt-03-debt-modal-transactions.png) | Account popup modal: account-filtered transactions, period selector, summary totals, type filters. |
| **Debt: Account Modal (Detail)** | [`02-debt-04-debt-modal-detail.png`](./prototype/interactions/02-debt-04-debt-modal-detail.png) | Account popup modal: terms, APR, minimums, and "Delete debt" button. |
| **Debt: Home & Auto** | [`02-debt-05-home-and-auto.png`](./prototype/interactions/02-debt-05-home-and-auto.png) | Filter pill switched to Home & Auto accounts (House mortgage and Honda HR-V). |
| **Debt: Add Debt Modal** | [`02-debt-06-add-debt-modal.png`](./prototype/interactions/02-debt-06-add-debt-modal.png) | Floating action button opens Add Debt bottom sheet (Account name, terms, balance, APR). |
| **Transactions: History** | [`03-transactions-01-history.png`](./prototype/interactions/03-transactions-01-history.png) | Period dropdown, Account filter, Monthly metrics (Payments, Interest, Adjustments, Net Change), list. |
| **Transactions: Edit Modal** | [`03-transactions-02-edit-transaction-modal.png`](./prototype/interactions/03-transactions-02-edit-transaction-modal.png) | Edit transaction sheet: category, account, date, amount, note, live balance preview (`CURRENT → AFTER SAVING`). |
| **Transactions: Scheduled** | [`03-transactions-03-scheduled-empty.png`](./prototype/interactions/03-transactions-03-scheduled-empty.png) | Top toggle switched to "Scheduled" payments view. |
| **Budget: Overview** | [`04-budget-01-overview.png`](./prototype/interactions/04-budget-01-overview.png) | Plan month selector, Income card, segmented progress bar, Budget vs Remaining, categories summary. |
| **Budget: Category Expanded** | [`04-budget-02-category-expanded.png`](./prototype/interactions/04-budget-02-category-expanded.png) | Inline accordion expansion of budget categories (e.g. Housing expanding into House and HOA items). |
| **Budget: Edit Spending Sheet** | [`04-budget-03-edit-spending-sheet.png`](./prototype/interactions/04-budget-03-edit-spending-sheet.png) | Modal for editing line item (Name, Amount, Frequency recurring/one-time, Category, Due Date, Payment method). |
| **Budget: Upcoming Bills** | [`04-budget-04-upcoming-bills.png`](./prototype/interactions/04-budget-04-upcoming-bills.png) | Upcoming subtab: chronological list of upcoming bills with due dates, amounts, and Pay Now buttons. |
| **Budget: Pay Now Match Modal** | [`04-budget-05-pay-now-match-modal.png`](./prototype/interactions/04-budget-05-pay-now-match-modal.png) | Pay Now bottom sheet: required minimum, paid this cycle, match unassigned recorded payments, record payment. |
| **Budget: Strategy Overview** | [`04-budget-06-strategy-overview.png`](./prototype/interactions/04-budget-06-strategy-overview.png) | Strategy subtab: Extra payment input, Avalanche vs Snowball radios, ranked priority payoff list. |
| **Budget: Strategy Table Expanded** | [`04-budget-07-strategy-penfed-expanded.png`](./prototype/interactions/04-budget-07-strategy-penfed-expanded.png) | Clicking a debt in Strategy expands an inline monthly payoff projection schedule (`Month`, `Payment`, `Interest`, `Balance`). |
| **Progress: Overview** | [`05-progress-01-overview.png`](./prototype/interactions/05-progress-01-overview.png) | Category progress carousel, This Month / Previous / Lifetime toggle, gauge, activity by account, Next payoff. |
| **Progress: Utilization** | [`05-progress-02-utilization.png`](./prototype/interactions/05-progress-02-utilization.png) | Credit utilization gauge, total limit, used credit, cards to review list with utilization badges and paydown targets. |
| **Progress: Milestones** | [`05-progress-03-milestones.png`](./prototype/interactions/05-progress-03-milestones.png) | Completed, In Progress, Up Next counters, Next unlock card, milestone timeline with projected completion dates. |
| **Settings: Overview** | [`06-settings-01-overview.png`](./prototype/interactions/06-settings-01-overview.png) | Profile, Preferences (Theme, Accent, Font size, Notifications), Household, Data & Security, Help. |
| **Settings: Backup & Recovery** | [`06-settings-02-backup-sheet.png`](./prototype/interactions/06-settings-02-backup-sheet.png) | Full data transfer bottom sheet: Export full backup JSON, Restore recovery checkpoint, Import full backup. |

---

## 3. Detailed Screen-by-Screen Interaction Specifications

### 3.1 Home Tab
- **Header**:
  - Logo/title "DebtFree".
  - "Open Settings" gear button opens the full-screen Settings sheet.
  - "Saved" synchronization indicator.
- **Debt-Free Countdown Card**:
  - Displays estimate target date (e.g. `FEB 2028`), remaining months badge (`15 MONTHS TO GO`), and progress bar (`35.7% reduced`).
- **Debt Summary Carousel**:
  - Displays three slides: `Cards & Loans`, `Home`, and `Auto`.
  - Shows Paid amount, Total Balance, and % reduced with visual ring progress.
  - Left `<` and right `>` arrow controls for category switching.
  - *Note from user*: The user wants to improve the visual design of this carousel on mobile.
- **Upcoming Recurring Bills Card** *(Conditional)*:
  - **Does not show by default**.
  - Only renders when a recurring bill or credit card minimum is nearing its due date and remains unsettled.
  - Includes a "See all >" link pointing to **Transactions → Upcoming**.
- **Payoff Strategy Preview Card**:
  - Displays active method (e.g., `Avalanche · Cards & Loans`) and top priority payoff targets.
  - Clicking the card or "See all >" **redirects to Debt → Strategy**.
- **Recent Activity Section**:
  - Shows the 3 most recent transactions/adjustments.
  - "See all >" redirects to **Transactions → History**.

---

### 3.2 Debt Tab
- **Sub-filters (Top Nav Pills)**:
  - `Cards & Loans · 9`, `Home & Auto · 2`, `All Debts · 11`.
  - Switching pills filters the accounts list and updates the top summary card.
- **Controls**:
  - Search debts input field.
  - Sort dropdown: `Name`, `Highest APR`, `Highest Balance`.
- **Account Cards**:
  - Displays institution logo, account name, debt type, APR %, current balance, % reduced progress bar, and projected payoff month.
  - **Clicking any account card opens the Debt Detail Modal**.
- **Debt Detail Modal (Bottom Sheet)**:
  - Contains 3 tabs:
    1. **Overview**: Current balance, APR, minimum payment, due date, estimated payoff, starting balance, balance reduced amount and %, interactive sparkline balance history (`View balance records`).
    2. **Transactions**: Period selector, account totals (Payments, Interest & fees, Adjustments, Net balance change), type filter pills, sort dropdown, and transaction list items.
    3. **Detail**: Debt details row (Account name), Payment & Terms row (Balance, APR, Minimum payment), and `Delete debt` action button.
- **Add Debt Floating Action Button (FAB)**:
  - Clicking `+` opens the `Add Debt Account` bottom sheet with inputs for account details, current balance, APR, and estimated minimum.

---

### 3.3 Transactions Tab
- **View Toggle**:
  - `History` (recorded transactions) vs `Scheduled` (future recurring entries).
- **History View Filters**:
  - **Period selector**: `Lifetime`, `2026`, `Dec 2026`, `Nov 2026`, etc.
  - **Account selector**: `All accounts` or filter by a specific debt account.
- **Monthly Transaction Summary Cards**:
  - Four interactive metric tiles: `Payments`, `Interest & fees`, `Adjustments`, and `Net balance change`.
- **Search & Sort**:
  - Search transactions input.
  - Type filter combobox: `Type`, `Payments`, `Interest & Fees`, `Adjustments`.
  - Sort combobox: `Newest`, `Oldest`, `Largest`, `Smallest`.
- **Transaction Item Interaction**:
  - Clicking any transaction opens the **Edit transaction** sheet.
  - Includes Category selector (`Payment`, `Refund/Credit`, `Purchase`, `Interest`, `Annual Fee`), Debt account picker, Date picker, Amount input, Note field, and a **real-time balance calculator** showing `CURRENT BALANCE → AFTER SAVING`.
  - Action buttons: `Back`, `Save`, and `Delete transaction`.

---

### 3.4 Historical prototype Budget layout

The Upcoming and Strategy subsections below describe prototype interactions now hosted in Transactions and Debt. Do not recreate these as Budget subtabs.
- **Sub-Tabs**:
  - `Budget`, `Upcoming`, and `Strategy`.
- **Subtab 1: Budget (Monthly Plan)**:
  - Plan month picker (`‹ Nov 2026 ›`).
  - Income card with `Edit` button.
  - Segmented progress bar showing % of income allocated by category (Housing, Insurance, Subscriptions, Transportation, Debt payments).
  - Summary metrics: Total Budgeted vs Remaining Unallocated.
  - **Category Accordions**: Clicking a category row (e.g. `Housing $2,373.90`) expands inline to show individual line items (e.g., `House`, `HOA`) with due day and payment status.
  - Clicking any line item opens the **Edit spending** sheet (Name, Monthly amount, Frequency `Recurring`/`One Time`, Category, Due date, Paid with `Debit`/`Credit`, Back, Save, Remove).
- **Subtab 2: Upcoming (Upcoming Bills)**:
  - Chronological list of upcoming due dates.
  - Displays payee/account name, due date (e.g. `Due Nov 17`), amount remaining.
  - **"Pay Now" button on each row**: Opens the **Payment for <Payee>** modal:
    - Required minimum, paid this cycle, remaining, due date.
    - **Match a recorded payment**: Lists payments recorded in the system that haven't been assigned to this due date yet, allowing 1-tap matching!
    - "Record new payment" button.
- **Subtab 3: Strategy (Payoff Strategy)**:
  - Extra payment input with inline save.
  - "Edit minimums" button.
  - Payoff method radio buttons: **Avalanche** (*Highest interest first*) vs **Snowball** (*Smallest balance first*).
  - Ranked payoff list (1 through 10) showing payoff month and balance.
  - **Clicking any account card in the Strategy list toggles an inline monthly payoff projection schedule**:
    - Displays a 4-column scrollable projection table: `Month`, `Payment`, `Interest`, `Balance` through the payoff month.

---

### 3.5 Progress Tab
- **Sub-Tabs**:
  - `Overview`, `Utilization`, `Milestones`.
- **Subtab 1: Overview**:
  - Scope slider (Cards & Loans, Home, Auto).
  - Period toggle: `This Month`, `Previous`, `Lifetime`.
  - Plan target gauge (e.g. `36% of plan`, `Making progress`, `$2,863.81 remaining`).
  - Metrics: Recorded payments vs Planned payments, Interest & fees recorded, Recorded balance change.
  - Activity by account breakdown list.
  - "Next payoff" milestone preview (`Up next: Discover`, `Then: Citi Cash`).
  - "All-category comparison" and "Look how far you've come" paid-off list.
- **Subtab 2: Utilization**:
  - Credit utilization gauge (e.g., `23.3% Utilization`, `Healthy` status).
  - Total limit, Used credit, Available credit, Target utilization (30%), Amount needed to reach 30%.
  - Cards to review list with colored status badges (`High`, `Watch`, `Good`), utilization bar, Limit, Balance, Available, and expandable **Paydown targets**.
  - Clicking arrow navigates directly to the debt account modal.
- **Subtab 3: Milestones**:
  - Debt category dropdown.
  - Counters: Completed, In Progress, Up Next.
  - "NEXT UNLOCK" progress card (e.g., `50% complete`).
  - Completed milestones timeline with attainment/observed dates.
  - In-progress milestones with projected completion dates (e.g., `50% Apr 2027`, `75% Aug 2027`, `Debt-free Nov 2027`).

---

### 3.6 Settings
- Accessed via gear icon in the top header on any page.
- Profile header (Avatar, name, email, household role).
- **Preferences**: Theme (Light/Dark/System), Accent color, Text size, Notifications.
- **Household**: Members (member list & roles), Currency (USD).
- **Data & Security**: Security, Archived Debts, Reset Account, and **Backup & recovery**:
  - Opens bottom sheet for **Export full backup** (JSON download), **Restore recovery checkpoint**, and **Import full backup**.
