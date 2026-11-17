# Focused palette and density recheck — Luna

**Task:** T-105  
**Reviewer:** GPT-6 Luna Max  
**Date:** 2026-11-08  
**Verdict:** The revised static visual direction narrowly clears the subjective 8/10 target for both lead palettes. Cobalt remains first at **8.1/10**; Indigo is a close alternate at **8.0/10**. These scores apply to the reviewed proposal, not to the native app. The mockup still needs its Progress activity figures reconciled before owner approval; native behavior and accessibility remain unverified.

## Rendered samples reviewed

I loaded `design/premium-palette-round2-2026-11-08.html` through `html_preview`, changing only its in-memory JavaScript initializer to select each sample. Debt was rendered as paired Light/Dark views for Indigo and Cobalt. I also rendered the Income Previous/Refined density comparison, Budget Light/Dark, Progress Overview Light/Dark, the edge-state sheet, and paired Light/Dark examples for Upcoming empty, Upcoming overdue, Scheduled empty-date, and Scheduled pending. All previews were 920 CSS pixels wide and reported no console messages.

These are static proposal screens with synthetic content. I did not inspect or change app code or data, and did not run tests, builds, devices, or backend operations. Lower scroll content is outside the captured viewport unless visible in the sample. I did not read another reviewer’s report.

## Updated lead palette ratings

Subjective visual scores for this focused sample, not an objective certification or runtime evaluation:

| Palette | Hierarchy | Density | Brand identity | Light/Dark legibility | Consistency | Premium feel | Overall |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Cobalt · Ice** | 8.2 | 8.1 | 8.2 | 8.2 | 8.0 | 8.1 | **8.1** |
| **Indigo · Porcelain** | 8.1 | 8.1 | 8.0 | 8.2 | 8.0 | 8.0 | **8.0** |

Cobalt retains a slight lead: its blue identity is crisp, and the active navigation underline and fixed-color category markers use different shapes and placements. Indigo has a more tailored feel but remains close to the violet Subscriptions category. Cobalt also sits near Housing blue. Both need the same consistent separation when brand and category colors appear together; the current navigation line, category badges, and row context make that distinction clearer than before.

## What changed for the better

- **Debt hierarchy and density:** The balance hero, Accounts/Strategy navigation, category filter, search/sort controls, group totals, and account rows scan in sequence. Flat account groups and separators remove repeated card frames. Dark and Light retain clear grouping; neither depends on repeated raised white cards.
- **Type and controls:** Account names and amounts read clearly at phone width, useful captions have more weight and size, and the field outlines are visible. Some tertiary captions and 10px navigation text remain small, but the primary account, amount, and action hierarchy holds in both themes.
- **Income density:** The Refined income sheet removes the large source-icon gap and fits its fields, monthly equivalent, and save action into a content-sized sheet. Required markers are visible; the name, amount, and frequency fields remain comfortably tappable at roughly 50px in the rendered sample. The Previous version is materially looser.
- **Budget meaning and category colors:** Debt payments is labeled “Card minimums + extra.” Auto loan remains under Transportation, separately from that debt-payment total. The same category hues carry through the allocation bar and breakdown; the Light and Dark samples preserve the existing category/status distinction.
- **Progress reference:** The Overview names “Current balance” and shows the explicit “Reference $35,192.31” beside the balance-comparison ring. The reference produces a 22% difference from the displayed $27,450 current balance. Its HTML information marker carries this exact method: “Reference is the sum of the higher of current and entered starting balance for each account. It is not recorded payment history.” This is materially clearer than an unlabeled “below reference” metric.
- **State context:** Upcoming empty shows $0.00, “No unpaid items,” and a Scheduled path. The overdue sample separates October 2026 from November and December and labels the $1,170 / 4 unpaid summary “Includes overdue”; its displayed items total $1,170. Scheduled’s selected November 13 empty date is explicit while the calendar keeps Paid/Unpaid/Pending markers. The pending November 12 sample labels the bill “pending confirmation” and says “Do not record it again.” Text and color both distinguish the states.

## Remaining issues before design approval

1. **Progress activity amounts need reconciliation.** The visible figures show Payments $1,140, Balance reduction $450, Interest & fees $42, and Net balance change −$393. If the reduction and interest/fees are the visible components of net change, they imply a $408 decrease, leaving $15 unexplained. If other activity accounts for that amount, it is not shown. Reconcile the synthetic figures or add the missing activity label before the proposal is approved; this review does not infer a different calculation rule.
2. **Make the methodology marker discoverable on touch.** The method text is present in an HTML `abbr` title, but a captured frame cannot show the tooltip and a hover title is not a reliable native touch interaction. Preserve the exact wording behind a visible, accessible info action in the native design.
3. **Keep the comparison direction explicit.** “Balance comparison,” “Current balance,” the reference amount, and the −22% ring are much clearer together. The sign alone can still be read as negative performance; a concise indication that the current balance is lower than the reference would remove the last ambiguity without restoring the vague Home/Debt metric.
4. **Palette/category proximity remains.** Indigo is close to the violet Subscriptions cue and Cobalt to Housing blue. The present shape and placement distinction helps, but should remain consistent in adjacent brand/category treatments.

## Decision

**Yes, the revised static visual design narrowly crosses 8/10:** Cobalt at 8.1 and Indigo at 8.0. Cobalt is the lead palette; Indigo is a viable close alternate. This is a design-only judgment based on the selected rendered frames. Resolve the synthetic Progress amount mismatch and make the methodology action usable on touch before seeking owner approval. It does not establish an 8/10 score for the app or prove native rendering, financial calculations, runtime accessibility, keyboard behavior, persistence, or backend state.

**Files changed:** `docs/PALETTE_RECHECK_LUNA_2026-11-08.md`, `TRACKER.md` only. No tests or builds were run.
