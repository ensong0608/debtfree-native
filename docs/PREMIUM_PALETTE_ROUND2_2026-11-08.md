# Palette and density refinement — round two

2026-11-08. T-101. **Design only; owner approval required before application implementation.**

## Owner feedback addressed

Keep the whole-app direction, reduce oversized elements and accumulated gaps (particularly income entry/editing), and explore several stronger identities rather than mostly green dark surfaces. Target an independently reviewed 8/10 visual standard while treating scores as subjective judgments, not certification.

## Color studies

| Identity | Light | Dark | Character |
| --- | --- | --- | --- |
| Indigo / Porcelain | Warm porcelain, white, deep indigo focal panels | Neutral graphite, subtle indigo panels, lavender controls | Tailored, quiet, editorial |
| Cobalt / Ice | Cool off-white, white, deep blue focal panels | Slate/ink, selective blue, pale cobalt controls | Precise, crisp, confident |
| Copper / Ink | Warm ivory, white, espresso focal panels | Warm charcoal, restrained copper, soft copper controls | Warm, composed, distinctive |
| Orchid / Graphite | Neutral pale canvas, white, plum focal panels | Graphite, selective plum, pale orchid controls | Expressive, modern, balanced |

Brand accents are independent of category and risk semantics. Changing identity does not recolor the Budget allocation/category mapping or turn risk statuses into brand colors. Green remains useful for recorded positive changes and low utilization, rather than tinting every dark surface.

## Density changes

- Income becomes a content-sized bottom sheet over Budget rather than a near-full-screen editor. Remove decorative emblem, reduce title and gaps, replace the large monthly conversion card with a single aligned row, and keep a reserved primary action.
- Add and Edit use the same structure. The Add example starts blank and cannot save; Edit retains the same editable name/amount/frequency fields.
- Fields retain a 44px minimum height; primary actions retain at least 46px. Compactness comes from removing excess composition and repeated surfaces, not eliminating required fields or reducing financial explanations indiscriminately.
- Reduce excessive hero sizes, section gaps, row padding and decorative prominence across the other proposals. Retain account group totals, per-account estimated dates, separate snapshot/history, 30% target markers, and honest milestone states.
- Strategy proposal restores the explicit Debt strategy / Mortgage strategy affordance alongside the existing Accounts / Strategy orientation.

## Artifact and evidence

`design/premium-palette-round2-2026-11-08.html` includes 26 studies: the existing 21, an Add income variant, and four full-page Upcoming/Scheduled state variants. Palette controls apply the same synthetic content across all four identities. Light + Dark mode compares themes; Previous + Refined mode compares round-one proportions with the denser revision in the selected palette. The previous panel is the earlier proposal, not a native screenshot.

The generator is `design/build-premium-palette-round2.cjs`; it consumes the prior design HTML and does not modify application files. Palette tokens/page inventory are in `design/premium-palette-round2-review-data.json`.

Numerical token contrast checks are recorded in `docs/PALETTE_CONTRAST_2026-11-08.json`. Selected brand/surface, muted/canvas and CTA label/background combinations all exceed 4.5:1. This is not a complete accessibility audit: category states, focus, input boundaries, disabled controls, scaling and native hit targets still require implementation verification.

Manager additionally strengthened input borders: Light mixes 75% muted ink with the field surface; Dark mixes 60%. The resulting solid field-border/surface pairs measure 3.19–3.71:1 across these palettes. Dark validation labels/borders use the existing coral error hue rather than the low-contrast fixed dark red. These checks cover chosen token pairs, not every rendered state.

## Independent initial reviews and response

The first proposed round-two set did **not** meet the requested bar. Terra High preferred Indigo at 7.7/10; Luna Max preferred Cobalt at 7.9/10 (Indigo 7.8). Preserve these initial findings rather than rewriting them as approvals:

- `docs/PALETTE_REVIEW_TERRA_2026-11-08.md`
- `docs/PALETTE_REVIEW_LUNA_2026-11-08.md`

Both reviewers identified useful supporting text as too small, vague reference comparisons, repeated card framing, and possible brand/category hue confusion. Luna also requested actual pending/empty page context. The manager addressed those findings:

- Useful secondary labels are now 11px; names/amounts 13px; form labels 12px and entry text 15px. Bottom navigation is 10px. This preserves a compact rhythm while increasing legibility. Native text scaling remains unverified.
- Debt now shows account count beneath its main balance; Home shows category account count. Their unexplained reference percentages are removed. Progress explicitly shows current balance 27,450, comparison reference 35,192.31 and -22%, with methodology available on the information control. Reference still means sum of per-account higher current/entered starting balance; it does not establish payment history.
- Debt account groups, Home strategy and Budget category lists use separators rather than repeated raised cards. Hero and principal summary surfaces retain emphasis. Utilization review rows use a quieter frame.
- Navigation uses brand-colored underlines; category icons use round fixed-color badges and risk uses labeled statuses. Calendar selection uses the brand color rather than borrowing the Paid green.
- Target-reduction amounts and transaction Current / After saving labels are explicit. Target markers have a surface outline for visibility across colored bars.
- Full-page Upcoming empty/overdue and Scheduled empty/pending examples are available. Empty Scheduled selects November 13, a day with no obligation, instead of claiming an occupied date is empty. Pending remains clearly labeled and has no duplicate Record payment action.

Focused rechecks T-104/T-105 assess the revised lead palettes. Their scores concern rendered synthetic design samples, not production usability, financial behavior, native accessibility or an objective comparison with commercial apps. Copper/Orchid remain color alternatives; do not silently assign them updated lead scores.

### Terra focused recheck

`docs/PALETTE_RECHECK_TERRA_2026-11-08.md` rates revised Indigo 8.1/10 and Cobalt 8.0/10 for static visual design. Terra prefers Indigo. Native runtime limitations remain open. Manager corrected its two state findings: overdue summary now says Includes overdue, and the selected pending date uses the pending marker with a contrasting outline. Both corrections were rendered and inspected in Light/Dark; these small manager corrections have not received a separate delegated recheck.

### Luna focused recheck and final manager corrections

`docs/PALETTE_RECHECK_LUNA_2026-11-08.md` rates revised Cobalt 8.1/10 and Indigo 8.0/10 for static visual design. Luna prefers Cobalt. It accepted the hierarchy, compact income form, category semantics and contextual states, while identifying two remaining approval issues:

- The Progress summary omitted the $15 credit-card subscription charge that explains the difference between -450 reduction +42 interest/fees and -393 net change. Manager added an explicit Other debt charges row of $15. The underlying illustrative figures were already consistent with the History sample; the summary was incomplete.
- The methodology was a hover-only title. Manager replaced it with a labeled 44px info button that opens a dismissible dialog. The comparison ring now says 22% lower, making direction explicit. Removed the redundant decorative header info icon.

These small manager corrections are rendered/source-checked and were not sent through another delegated scoring round. Native touch, screen-reader behavior, text scaling and keyboard verification remain separate. No score is claimed for the native app.

| Final reviewed lead | Terra High | Luna Max |
| --- | ---: | ---: |
| Indigo / Porcelain | 8.1 | 8.0 |
| Cobalt / Ice | 8.0 | 8.1 |

The review requirement is complete and both leads narrowly meet the requested subjective design benchmark. **Owner palette/page approval remains pending.** Copper and Orchid are available alternatives but were not rescored after the final shared refinements.

No backend, financial inputs, application UI, devices, tests or builds changed in this round.
