# T-127 independent source and owner-image audit

Verdict: **Changes needed**. The carousel and shared sheet exist, and several rails are corrected, but the visible Home comparison conceals clamping and several layouts still miss the specified common rail. This is source analysis, not native runtime certification. The six supplied owner PNGs are pre-change concern evidence, not proof of current appearance.

## Prioritized findings

1. **Home comparison can mislead (high).** `src/components/FinancialScreen.tsx:210-221` labels the result ?Balance change vs entered reference?, but the help alone says each reference is floored at current balance. A category with one account above its entered reference and another below can show a green lower amount that excludes the increase; zero says ?No decrease? even when an increase occurred. The displayed reference is therefore not simply the entered reference. Make the clamped basis visible alongside the value and avoid presenting it as actual net change. Missing references correctly yield unavailable.
2. **Rails remain inconsistent (medium).** `FinancialScreen.tsx:232,259` gives page 16 and default Card 14, so default card text starts approximately 30 points from the page edge (plus border), while explicit 16-point card or unboxed inset starts approximately 32. Home `HomeScreen.tsx:1292` quiet sections use 18, producing 34 versus the carousel's 32 (`FinancialScreen.tsx:206`). The Debt empty-state heading has no inset (`DebtScreen.tsx:317`), hence 16, not 32. In History, filters have outer margin 16 (`TransactionsScreen.tsx:820`) and their controls retain their own internal padding, moving their text further inward than the summary value at page 16 + card 16 (`:804-818`); container alignment alone does not establish text alignment. Inspect actual control inset before adjusting. Borders add approximately one point where present.
3. **Help presentation still needs polish (medium).** `InformationSheet.tsx:13-16` renders a font-dependent ? rather than the existing `AppIcon` close used in Debt (`DebtScreen.tsx:443`), and all detail is one Text paragraph. The long Recorded activity explanation (`ProgressScreen.tsx:137`) reproduces the screenshot's dense multi-sentence reading problem in a themed shell. Support structured paragraphs or concise grouped content without dropping financial caveats. The backdrop is labelled ?Close form? even for information (`SheetModal.tsx:38`), an inaccurate accessibility label.
4. **Reference availability on other screens (medium).** Progress shows a reference and percent whenever any debts exist (`ProgressScreen.tsx:116-118`), and Debt detail displays a percent unconditionally (`DebtScreen.tsx:447`); neither checks missing original balances as Home does. Their help describes an entered original even when unavailable. Explicitly represent unavailable or partial references rather than implying an entered baseline.

## Owner concern matrix

| Concern | Source assessment |
| --- | --- |
| Progress screenshot rails | `ProgressScreen.tsx:99,125-142`: page 16 + section 16 = 32; nested card margin -16 and padding +16 cancel, so card text also 32, not 48. |
| Debt screenshot rails | `DebtScreen.tsx:311,321-338`: page 16 + section 16 = 32; group amount margin 26 matches row gap 10 + chevron width 16. Icon-led account names are a secondary column. Empty state exception above. |
| Transactions screenshot rails | Date headings and rows at `TransactionsScreen.tsx:909,924` use page 16 + inset 16 = 32; row icon creates secondary name column. Filters require text-level correction above. |
| Home dropdown and pagination | `FinancialScreen.tsx:202-225` uses horizontal native `ScrollView`, paging, momentum index, visible dots and labelled selected-state buttons; no dropdown. Width layout repositions current page on resize. Initial width is zero and swipe/resize behavior requires native verification. |
| Home balance change | Direct numeric/directional cue and no lifetime payment claim; clamped basis and no-data issues described above. Empty category yields reference unavailable rather than fabricated comparison. |
| Alert screenshot | Home/Progress/Debt information controls use shared theme-aware sheet. Remaining inspected alerts include consequential confirmations, conflicts and operational outcomes; retain safeguards. Shared sheet has close button, back handler, scroll and modal accessibility (`SheetModal.tsx:35-44`); actual focus and back behavior require native verification. |
| Nested Debt help | `DebtScreen.tsx:434-447,643-645` mounts the shared information modal inside the selected account Modal, rather than as its sibling; this is a deliberate stacking path, not proof that both platforms present and dismiss correctly. Verify open, close/back and return focus in native runtime. |
| Navigation / other decisions | Debt segments Accounts/Strategy (`DebtScreen.tsx:298`); Transactions History/Upcoming/Scheduled (`TransactionsScreen.tsx:482,699,703`); Budget Edit expands sources (`BudgetScreen.tsx:660,717`); Progress activity and metrics render without expansion (`ProgressScreen.tsx:197-235`). Upcoming month heading starts at page 16 + 16; date column starts there, while row cards sit after the 34-point date column and 11-point gap (`UpcomingObligations.tsx:300-334`), a distinct timeline column rather than the common label rail. |

No tests, builds, devices, browser, backend or financial mutations were performed. Screenshots cannot establish current layout, gesture, accessibility, theme contrast or modal stacking behavior.


## Manager corrections after independent audit

- Fixed carousel ref typing using the component instance type, preserving native scrolling.
- Home now compares current total with entered original total directly, including higher balances; all category references must exist. Lower/higher/unchanged use numeric directional/status cues. No lifetime-payment claim and no payoff/ledger/domain formula changes. This supersedes the clamped Home presentation audited above.
- Shared Card inset is 16, Home quiet sections 16, Debt empty state 16; Transactions filters/search no longer double the section inset. Icon and control padding define intentional secondary columns.
- Help uses AppIcon close, the correct Close information backdrop label, and structured paragraphs with optional subsection headings. Recorded activity is grouped into History coverage, Payment amounts and Balance changes without removing financial caveats.
- Debt detail and Progress suppress comparison percentages when entered references are missing. Their existing reduction measure is explicitly labeled adjusted reference, with clamping explained.

The original independent findings remain above as the audited snapshot. Manager source corrections are not a fresh independent re-audit or native visual/gesture/accessibility certification.
