# Independent palette and density review — Luna

**Task:** T-103  
**Reviewer:** GPT-6 Luna Max  
**Date:** 2026-11-08  
**Verdict:** No palette reaches the requested subjective 8/10 bar yet. Cobalt is the strongest first choice for refinement at 7.9/10; Indigo is close at 7.8/10.

## Rendered examples reviewed

I independently rendered the supplied HTML with `html_preview` at 430 CSS pixels wide. For the four Debt samples, the rendered comparison contains both Light and Dark phone frames for Indigo, Cobalt, Copper, and Orchid. For Income, I rendered Previous + Refined in both Light and Dark. I also inspected paired Light/Dark samples for Home, Budget, Recurring bill, Add debt, Upcoming, Scheduled, Debt Strategy, and Progress Utilization. These were source-generated design mockups with synthetic data; I did not use a browser, device, backend, or app runtime.

All reviewed previews reported no console messages. Home and longer lists are shown at their initial scroll positions, so their lower content is outside this review.

## Scores by palette

Subjective scores are based on the rendered examples, not a color-contrast audit or an objective quality certification.

| Palette | Hierarchy | Density | Brand identity | Light/Dark legibility | Consistency | Premium feel | Overall |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Cobalt · Ice** | 7.8 | 7.7 | 8.2 | 8.2 | 7.9 | 7.9 | **7.9** |
| **Indigo · Porcelain** | 7.8 | 7.7 | 8.0 | 8.1 | 7.8 | 7.8 | **7.8** |
| **Orchid · Graphite** | 7.7 | 7.6 | 7.9 | 7.9 | 7.5 | 7.5 | **7.7** |
| **Copper · Ink** | 7.7 | 7.6 | 7.8 | 8.0 | 7.5 | 7.6 | **7.7** |

## Palette-specific findings

- **Cobalt · Ice — 7.9/10.** The clearest, most immediately legible brand signal across the pair: crisp blue controls against restrained blue-gray surfaces, with a confident navy Debt balance panel. The pale background/cards remain distinguishable in Light and the Dark version reads neutral rather than green. It is the strongest option to refine. Its main color-system risk is the shared blue family with Housing; category blue and brand blue need consistent shade or shape separation in places where they sit together.
- **Indigo · Porcelain — 7.8/10.** The most tailored and editorial pairing, with the darkest hero and a restrained light surface. Dark remains neutral, and the light purple accent reads well. Indigo can blur with the Subscriptions violet when both category and brand cues appear close together. The palette feels premium, but the very light canvas and repeated white cards make the overall Light screen slightly flatter than its hero suggests.
- **Orchid · Graphite — 7.7/10.** A distinctive, expressive identity with a coherent plum hero in both modes. Light and Dark stay legible. The more saturated magenta accent is less restrained than the screens’ otherwise quiet financial hierarchy and sits close to the existing violet category color; repeated purple cues may make it harder to tell brand emphasis from a category marker.
- **Copper · Ink — 7.7/10.** A warm, composed alternative that is clearly not green-tinted. The dark brown hero and warm light canvas hang together, and body text remains readable. The copper accent is closest to the Transportation/amber family, so brand controls and risk/category cues need careful separation. The combination also reads more rustic than tailored against the cooler category palette.

## Whole-flow observations

### What is working

- **Debt hierarchy and density:** The total balance panel, Accounts/Strategy switch, single category filter, search/sort row, grouped totals, and account amounts scan in a sensible order. The grouped account cards use tighter vertical spacing than the previous-direction sample implied, without making the rows feel cramped. Separate Home & Auto totals and account amounts remain apparent.
- **Light and Dark:** All four palettes keep text, fields, and panels legible in the rendered Debt pairs. Dark surfaces are neutral or palette-tinted rather than green. The Light samples use deliberate tinted page backgrounds, white cards, and a dark hero, though the surrounding screen still relies heavily on a single white-card pattern.
- **Income form density:** Refined removes the oversized source icon and large empty area, tightens the form into a bottom sheet, and keeps 44-ish-pixel fields and a prominent full-width save action. Required markers remain visible on name, amount per pay period, and pay frequency. The Previous sample wastes substantial vertical space; Refined is materially better. In Dark, the lavender save control is legible but draws more attention than the neutral field and monthly-equivalent surfaces.
- **Budget semantics and category colors:** Monthly Income, Budget, Remaining, and Income sources are grouped clearly. The allocation bar uses distinct category colors; Debt payments is labeled “Card minimums + extra,” and Auto loan appears in Transportation, consistent with current owner rules. Remaining is green as a status cue rather than as a category identity.
- **Form requirements:** The bill form visibly marks name, amount, due day, category, and payment method required; its category choices are single-choice rows and begin unselected. The disabled Save bill state makes that selection requirement visible. Add debt marks account name, account type, balance, APR, and minimum payment required while leaving due day and credit limit unstarred. Income uses explicit required markers. Those markers appear consistent with the mockup’s intended validation.
- **Upcoming and Scheduled distinction:** Upcoming groups unpaid items by month and date, labels “due in 4 days,” and exposes Pay actions. Scheduled shows the month calendar, Paid/Unpaid/Pending legend, and Record payment action for an unpaid bill. This is a useful separation of attention list and calendar. The sample shows an unpaid scheduled bill, but not an actual Pending or empty-state row.
- **Utilization target:** Used credit is prominent, with the 30% target marked on the bar, “43.8% used,” and a Watch cue. The card-level “$2,250.00 to 30%” text makes the target actionable. The target tick looks quite dark against the amber track in Dark and could be given a higher-contrast outline or light marker. The “Watch” threshold itself has no visible definition in this sample.

### Specific blockers to 8/10

1. **The supporting benchmark is unclear.** Debt and Home use “22% below reference” and “27% below reference.” “Reference” does not explain whether this is utilization, a goal, or another comparison. Give the metric a meaningful target name and label; otherwise remove the comparison. The primary balance and payoff date already carry the hierarchy.
2. **The layout still depends on repeated cards.** Debt, Home, and Budget repeat rounded bordered cards with similar elevation. The Income sheet improves density, but not the overall visual rhythm. Use fewer high-emphasis containers and more clear spacing/section dividers, particularly around account groups and Budget rows.
3. **The typography has small low-priority captions.** Labels such as category subtitles, “below reference,” interest/APR, and date qualifiers are noticeably small at phone width. Raise the smallest useful labels slightly or increase their contrast, while preserving the primary amount hierarchy.
4. **Color families are not fully independent.** Cobalt shares hue with Housing, Indigo and Orchid with violet Subscriptions, and Copper with amber Transportation/risk. The mockups generally preserve separate category colors, but brand/category proximity can still cause semantic ambiguity. Keep category colors fixed and distinguish the brand with shape, placement, weight, or a consistently darker/lighter brand tone.
5. **Some meaningful status states remain unproven in this static set.** Scheduled’s legend includes Pending but only an Unpaid item is shown; no empty Upcoming, empty Scheduled, overdue, or confirmed-pending example was visible in the inspected frames. The screen direction should show one of those states without relying on color alone before approval.

## Recommendation

Take **Cobalt · Ice** forward as the lead for another design pass, with Indigo retained as the closest alternate. Cobalt offers the strongest concise identity and clean separation between cool neutrals and status colors in these samples. Keep the existing category and risk colors fixed, differentiate Cobalt brand blue from Housing blue when they are adjacent, clarify or remove “below reference,” and reduce repeated card framing. Re-render the target-label and pending/empty states before asking the owner to approve a palette. Current best score is **7.9/10**, so this is not an 8/10 pass.

## Verification limits

This review covers the generated HTML’s static synthetic examples only. `html_preview` showed no console messages, but that does not establish native component behavior, runtime accessibility, real device contrast, keyboard behavior, scroll behavior beyond the initial frames, persistence, financial calculations, or backend state. No app source, HTML, generator, backend, or test files were changed, and no tests or builds were run.
