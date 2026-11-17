# T116 final captured-layout review — 2026-11-08

**Verdict: one material Detail composition change remains.** This is a scoped Cobalt Light visual review of the supplied captures, not certification of all states, accents, platforms or interactions.

## Change required

- **Debt detail Overview:** The approved `detail.html` groups due day, estimated payoff and credit limit in a bordered rounded surface and labels the following section “Balance history” with an information control. `cobalt-light-detail.png` instead has loose divider rows and jumps directly into the empty state without the section heading. Current `src/screens/DebtScreen.tsx` confirms the empty branch renders without that heading. Restore the grouped surface and a clear history heading/information cue while retaining the honest empty state, existing values and actions. Do not imply statements exist.

## Accepted captured portions

- **T115 corrections:** Strategy now shows the concentric hero motif and method badge, framed extra payment with prominent value and full-width Save. Detail shows its motif, reference comparison and dashed empty state with icon and secondary text. Progress Overview shows framed activity rows and the ring's “lower” label. These earlier specific findings are resolved in the current Cobalt Light captures; the Detail issue above is separate.
- **Home, Budget and Upcoming:** Captured hierarchy corresponds to the bounded references: estimate and account carousel with emblem/dots, flat budget breakdown and category meters, and month/date rails with unpaid cards. The larger native controls and differing data are acceptable in this scope.
- **Debt Accounts, Utilization, Milestones, History and Scheduled:** Captures show grouped accounts and filter; used-credit bar and target with status; achievement path; date-grouped history; and a distinct calendar with paid entries, respectively. No additional material omission is established in these samples.
- **Income, bill, settings and appearance:** Captured edit-income sheet has a handle, required fields, frequency control and footer; bill shows inline unselected category radios; settings and appearance show grouped preferences and selected Cobalt/Light. Source in `BudgetScreen.tsx` also shows the frequency placeholder and selection validation. These observations do not prove add, save, navigation, selection or persistence at runtime.

## Evidence and limits

Inspected all 15 current `docs/acceptance/2026-11-08/design-parity/cobalt-light-*.png` images. Rendered bounded `strategy`, `detail`, `overview`, `home`, `budget`, and `upcoming` HTML after changing `data-palette` to cobalt, with 40,000-token file reads; each preview returned 1542px and no console messages. Read T115 and relevant current source. Screenshots cover only visible viewport/state; lower content, add-income blank state, other tabs, other screen sizes, actual actions and accessibility are not runtime verified. Synthetic figures, platform font weight and touch-target differences are not defects. Dark correction verification is the manager's separate responsibility. No app edits, tests, builds, devices, backend or data mutations were performed.
