# Android acceptance — November 8, 2026

Manager: GPT-6.1 Sol Medium. Device: local/emulator-5554. Current workspace source served by Expo dev client on Metro 8083 with `EXPO_PUBLIC_ENABLE_LOCAL_ACCEPTANCE=true`. All edit/save actions used reserved synthetic owner `local-acceptance-owner-v1`; no prototype or real household mutations were submitted. This is local UI/storage acceptance, not deployed backend acceptance.

## Executed results

| Scenario | Result and evidence |
| --- | --- |
| Original reported warning | Reproduced in original household view (read-only) and fresh synthetic Home. Expanded LogBox stack pointed to Home ScrollView. A same-line run of spaces between `</Card>` and a comment at HomeScreen was a JSX text child. Splitting onto separate lines removed the warning after full reload. Debt Strategy also opened without warning. |
| Estimate card | Restored title, subtitle, ESTIMATE badge, date, months remaining, divider and progress. Qualifier absent on Home. Viewed in dark and light. Screenshots 01 and 09; 09 is final light rendering. |
| Budget layout/categories | No standalone top purchases card. Month/purchases context in breakdown. Empty Utilities/Insurance/Housing absent for this fixture. Category count 2 matches debt commitment and vehicle spending. |
| Edit primary income | Opened modal from Budget; changed $4,800 to $5,000, saved in place. Free cash updated. No onboarding navigation. |
| Add income | Added Synthetic side income $200 monthly from Budget. Total became $5,200 and free cash $4,610 while linked. |
| Pair on Home | Confirmed auto loan / vehicle bill. Home Needs attention disappeared. Before pairing (income $5,000): debt plan $590 + bills $385 = free cash $4,025. After: debt plan $205 + bills $385 = free cash $4,410. Exactly $385 duplicate commitment removed; payoff extra remains in plan. |
| Linked details | Debt Detail shows linked bill name/amount/due day and unlink; recurring editor shows loan name/type/minimum and unlink. Loan balance remained $12,400. Screenshots 02 and 05. |
| Custom category | Entered Transportation on linked recurring bill under Other and saved. Budget grouped one bill at $385 under Transportation, count 2 categories. Screenshot 03. |
| Relaunch persistence | Full relaunch retained $5,000 primary income, Transportation, Light preference and confirmed link (no Needs attention). Added side income afterward. |
| History invariance | Transactions History still showed no transactions after pair/save actions. No payment was recorded. Loan/card balances observed unchanged ($12,400/$1,600). |
| Reminder deduplication | Upcoming November showed card minimum $55 and vehicle bill $385, no second auto-loan minimum. Scheduled showed the same two obligations; Next moved dates and month heading to December. Screenshot 08. No Pay/Record action used. |
| Unlink | Unlinked in Debt Detail. Details changed to link selector; Home Needs attention returned. Loan balance still $12,400. |
| Popups | Debt add, recurring add/edit and income editor opened as sheets with visible header X and dismiss/reopen. Viewed income/debt in both themes, recurring editor in dark and add form in light. Screenshots 04, 07, 10, 12. No new debt was saved. |
| Settings | Grouped index opened, Theme row opened Appearance subpage, Light applied immediately and persisted after relaunch. Reset remained unavailable; no reset attempted. |

## Corrections discovered by actual device checks

1. Removed raw same-line JSX spaces from Home ScrollView, fixing the Text-rendering warning.
2. Corrected synthetic bill amount from 385 minor units ($3.85) to 38500 ($385). Bumped isolated fixture key to v2 and reran pairing/totals checks. Earlier v1 observations are not accepted money evidence.
3. Home logo used white text on white in Light mode; switched it and development pill surfaces to existing mapped palette tokens. Signed-in theme provider now sets status-bar icon appearance. Screenshot 09 confirms final result.
4. Debt popup inner card used unmapped #252926; switched it to mapped #242926 and a mapped border. Screenshot 11 records failure; screenshot 12 confirms correction.
5. Shared screen settings gear was incorrectly labelled Edit setup for accessibility; changed to Open settings.

## Automated checks

Manager ran six affected suites: home-estimate, finance-loan-bill-pairing, finance-budget, finance-backup, finance-obligation-schedule and finance-recurring-deletion. Result: 32 passed, 0 failed, 0 skipped. `npm.cmd run typecheck` passed after runtime fixes. Node emitted informational module-type warnings.

## Explicit limits

- Initial authenticated onboarding auto-creation, lost-response recovery, server CAS/concurrent-device writes, destructive deletion and server backup/restore were not exercised against a backend. Their source and focused checks are separate evidence; local screens do not certify them.
- The fixture contains no mortgage, overdue obligation, zero-amount bill or purchase history. Those specific scenarios are covered only by bounded source/tests, not this runtime pass.
- Release-only gates, iOS, larger accessibility fonts, OS keyboard overlap and every dropdown option were not certified by this pass. Input automation uses the emulator test IME.
- This pass does not make the entire audit/release scope complete. Atomic full restore remains a separate unfinished feature.

Screenshots 06 and 11 are intermediate failure evidence; 09 and 12 supersede them. Device screenshots contain synthetic data except the initial read-only observation, which was not saved into this artifact set.

After testing, reopened the original dev-client URL on Metro 8081 and observed the original household Home view without the rendering warning. Stopped only the acceptance Metro on 8083 and released this manager's device panel/session without shutting down the emulator. Original household records were not edited.
