# BitLess app capabilities

BitLess (DebtFree Native) is an Android and iOS app for individuals and households managing debt and monthly cash flow. Users enter balances, income, bills, and transactions, then use that information to plan payoff, track upcoming obligations, and see progress.

This inventory reflects the native app source. Availability can depend on the platform, build configuration, household role, and backend setup. Use the limits below when comparing BitLess with another app.

## Home

- See debt balance snapshots and estimated payoff dates across cards and loans, mortgages, and auto debt, along with next-payment principal, interest, and escrow estimates for active mortgages (once monthly escrow is entered) and daily-interest principal, interest, and daily cost estimates for active auto loans. The balance snapshot and recorded payment activity answer different questions.
- See a conditional **Safe Extra** amount when monthly cash flow leaves surplus after 14-day obligations and spending-cap pace, with a one-tap **Boost #1** shortcut into Strategy.
- Review the active payoff strategy and jump directly to **Accounts → Strategy**.
- See unpaid and partly paid obligations that need attention, including overdue items, when there are applicable entries. Open an obligation to record a payment, with an editable principal, interest, and escrow breakdown for mortgage and auto loan payments (auto loans estimate Actual/365 daily interest from the prior payment date with a Daily/Monthly switch and monthly fallback). Review recent ledger activity and open transaction details from Home.

## Accounts and debt payoff

- Track credit cards, personal loans, auto loans, and mortgages. Browse active accounts by category, search and sort them, and open each account's **Overview**, **Transactions**, and **Detail**, including next-payment principal, interest, and escrow or daily-interest estimates on active mortgage and auto loan overviews.
- See institution marks in account lists and Strategy, with offline support for recognized names such as U.S. Bank, USBconnect, and PenFed.
- Maintain balances, rates, credit limits, minimum payments, due dates, and account-specific terms. Reconcile an account to a verified statement balance. On **Credit card** accounts, **Detail** also supports optional **Promotional APR** terms (promo APR, end date, and post-promo APR) and expected annual fees tracked separately from recorded fees.
- Mark a zero-balance account as paid off and browse it in **Paid Off**. History stays available. A balance above zero returns the account to active tracking.
- Compare Snowball (lowest balance first), Avalanche (highest active APR first), and **Custom** (user-ordered) payoff plans by projected payoff time and interest. Expand account rows to see month-by-month payment, interest, and remaining balance, along with active promo rate badges.
- Enter an **Extra monthly payment** and an optional **One-time extra payment** in Strategy with live months/interest-saved delta feedback. The one-time date selects a projected monthly cycle. Use **Save monthly plan** to save the recurring amount. The one-time amount remains part of the local estimate. Expand **Plan comparison** to see Snowball vs. Avalanche dates and interest, or use **Compare 0% transfer / consolidation** to check net savings and break-even months. **Payoff order** shows current balances and lets you reorder in Custom mode or expand each account's allocation and monthly schedule. Mortgage extra payments have their own input.

## Transactions and obligations

- Manually add, edit, and delete ledger entries for payments, purchases, fees, interest, cash/debit spending, and other activity, or **Import CSV** from pasted bank/card statements with sign-convention toggles and duplicate detection. History supports search, lifetime/year/month views, multi-select transaction-type and account/group filters with active filter chips, sorting by date or amount (including paid-off accounts), smart recurring-bill suggestions from repeated purchases, and due-cycle cues when an entry is applied to a different month's cycle.
- When adding a transaction, expand **More details** for an optional payee and note, inline **+ Split** allocation across 2–4 categories, or the applicable payment breakdown. A purchase can reuse an account from recent confirmed purchase history with one tap.
- Keep history attached to the same account or recurring bill when its name changes. Link a mortgage or auto loan to its matching recurring bill so the same obligation can be tracked together. Record loan payments from Transactions, Accounts, or payment sheets with editable estimated principal, interest, and applicable escrow (once mortgage escrow is entered; auto loans estimate Actual/365 daily simple interest from the prior payment date with a Daily/Monthly switch on the payment sheet and monthly fallback when no prior payment exists), or clear the split to record cashflow only. The principal allocation determines the loan balance reduction.
- Browse bills, debt minimums, and annual card fees in **Transactions → Scheduled** using a monthly calendar or due-date list. Record full, partial, or advance payments against the applicable cycle while preserving the actual transaction date.
- Change the due day for account minimums and recurring bills. The next unpaid reminder can move to the new date, and future reminders follow the new day. Moving an overdue reminder requires confirmation.
- Plan an obligation in two, three, or four installments. The plan shows intended amounts and dates. The obligation keeps its original due date and payment requirement.

## Budget

- Manage primary and additional income sources on different pay schedules. View normalized monthly take-home income and enter optional gross income separately.
- Create, edit, or end recurring bills (including monthly, quarterly, 6-month, or annual frequencies with monthly reserve calculation). Use built-in or custom category labels and record the payment method, including the specific credit card used.
- Review monthly cash flow by category, including recurring bills, mortgage and auto commitments, the card debt payment plan, and money available or a shortfall. Find the monthly reserve estimate for annual card fees.
- Expand Budget categories to see commitments, payment cycle status, and the card used when applicable. **Budget → Expense** has one month switcher, a cash outflow semi-circle with expandable cash category rows (with optional per-category spending caps), a separate Debt Tug-of-War comparison for payments to debt and new card charges, and a non-counted summary of obligations paid earlier for the selected month. Expand a cash category or card charges to see recorded entries (with cross-month due-cycle cues), and tap one to open its transaction details.

## Progress

- Review credit card and personal loan payments, charges, and net balance changes for a selected month, year, or all recorded history. Compare recorded payments with the current plan and review individual active accounts in **Balance activity**. Archived accounts remain in the applicable totals and history.
- Check overall and individual card utilization from tracked balances and limits, plus a **30% Target Advisor** showing the paydown needed to bring the highest-impact card below 30% with a one-tap **Simulate** shortcut.
- Track milestones supported by confirmed history and a current credit-utilization goal. Pending payments and reconciliation adjustments do not count as recorded payment achievements.

## Sign-in, household access, and settings

- Create an account or sign in with email and password where enabled; email confirmation may be required. Sign in with Google and complete guided household setup, including income and debts. The app also has an iOS Apple sign-in flow, with physical-device verification still pending.
- Use household-scoped financial data. Where collaboration is enabled, users can join by invitation link or code and switch households. Owners can manage invitations and roles. Members can edit finances and Viewers have read-only access.
- Choose **Fresh** or **Inspire**, follow system brightness or select **Light** or **Dark**, and choose among ten colors in either style. Appearance is saved per signed-in user on the device. Settings also offers haptics and applicable household preferences such as currency and time zone. Account recovery can help eligible users fix missing or invalid debt categories without restarting setup.
- In **Settings → Data & security**, export a validated native JSON backup, **Export transactions CSV**, review a pasted backup, and inspect financial changes that are awaiting confirmation or need review. In-app account deletion depends on build configuration.

## Current limits for comparisons

| Area | Current app scope |
| --- | --- |
| Bank connections and payment execution | Manual entry and pasted CSV statement import into the ledger. Live bank aggregation and bank or lender payment initiation are unavailable. |
| Budget method | Monthly cash flow, category commitments, and optional monthly caps on variable expense categories. Rollover envelope balances across months are unavailable. |
| Reminders | In-app due dates, calendar, and obligation status. Local device reminders can be scheduled for upcoming, past-due, and milestone events when notification permission is granted. Remote push notifications remain unavailable. |
| Household collaboration | Invite-link and code flows are implemented in source. Availability depends on backend and build configuration. Automated invitation email delivery is unconfigured. |
| Data portability | Native JSON export, transactions CSV export, and backup review. Full backup restore is unavailable in the current app. |
| Billing | Sandbox plan selection only. Live subscription purchases are disabled. |

## Keeping this sheet current

Update the relevant section in the same change that adds a user-facing capability or materially improves one. Edit the existing entry when it describes the same workflow, and update any affected availability or limits. If a capability is removed, remove or revise its entry so the inventory stays accurate.

Write what a user can do today and call out platform, role, or build requirements that affect whether they can do it. Leave routine fixes that restore the documented behavior, visual polish, internal refactors, implementation history, task IDs, and roadmap ideas in their respective project records.
