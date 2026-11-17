# T115 independent design parity recheck — 2026-11-08

**Verdict: CHANGES REQUIRED; review incomplete.** Captures present at review time cover only Indigo Dark Debt/Progress. Home, Budget, Transactions, income and secondary flows have no same-page native captures available; no Cobalt Light images were present. Do not treat this as approval of four combinations or of unobserved behavior.

| Page | Evidence and finding |
|---|---|
| Home | Approved bounded HTML rendered in both Indigo themes. No native capture available; parity not assessed. |
| Budget / income | Approved Budget HTML rendered in both themes. Source contains Monthly Income and expandable Income sources; expanded state and add/edit sheets not visually assessed. No native capture available. |
| Transactions / Upcoming / Scheduled | Upcoming HTML rendered in both themes. No native capture available; date rails, payment actions, scheduled and secondary states not visually assessed. |
| Debt Accounts | Indigo Dark native capture inspected. Grouped accounts, filter, search and hero are visible. Full reference comparison not rendered; no pass claimed. |
| Debt Strategy | Both Indigo reference themes rendered; Indigo Dark native inspected and source checked (`src/screens/DebtScreen.tsx`, strategy branch). **Change required:** approved extra-payment area is a bordered surface with value hierarchy and full-width Save; native/source render a transparent section with conventional input and side-by-side Save. Hero also lacks the reference's concentric motif and method badge. Keep validation and save behavior intact. |
| Debt detail overview | Both Indigo reference themes rendered; Indigo Dark native and source inspected. **Change required:** current balance hero lacks the reference's concentric motif and reference-comparison cue; balance history empty state lacks the framed dashed container, icon and secondary instruction. Preserve honest reference/history availability and existing actions. Other detail tabs unverified. |
| Progress Overview | Both Indigo reference themes rendered; Indigo Dark native and source inspected. **Change required:** recorded-activity rows are unframed in source and capture, while the approved composition groups them in a bordered surface. Keep actual financial labels and values. Native screenshot lacks the ring's “lower” text, but current source includes it, so a fresh capture is needed before calling this a remaining defect. |
| Utilization | Indigo Dark native inspected; source includes target marker, usage status, and split statistics. Reference not rendered in this review; no parity pass. |
| Milestones, History, settings, forms, mortgage and other secondary states | No same-page native evidence or rendered reference in this review. Not assessed. |

The six reference files were read in full with a 40,000-token output limit each; no truncation indicator appeared. `html_preview` returned complete 1542px captures and no console messages for home, budget, upcoming, overview, strategy and detail. These previews display the bounded Indigo Light and Dark examples. Native captures can predate current source: the source cross-check above controls findings where they disagree. Screen images alone do not verify actions, accessibility, overflow at other sizes, or runtime data. Synthetic values and font differences were not treated as defects. No build, tests, device interaction, backend or financial mutation was performed.

**Remaining gate:** obtain final same-page native images (including Cobalt Light and income/secondary flows), compare against their own rendered references, and check the corrected screens at runtime. No assertion is made about unrendered reference variants or unobserved states.
