# T-102 independent visual review — Terra High

Recommendation: **Indigo / Porcelain**, provisionally 7.7/10 overall. It feels composed and distinctive in both themes without making the dark canvas green; its violet accents remain restrained. This is a subjective assessment, not approval or a contrast certification. None reaches 8 overall yet.

| Palette | Hierarchy | Density | Color identity | Light / Dark legibility | Consistency | Premium feel | Overall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Indigo / Porcelain | 8 | 7.5 | 8 | 7 | 8 | 7.5 | 7.7 |
| Cobalt / Ice | 8 | 7.5 | 7 | 7.5 | 8 | 7 | 7.5 |
| Copper / Ink | 8 | 7.5 | 7.5 | 7 | 7 | 7.5 | 7.3 |
| Orchid / Graphite | 8 | 7.5 | 7.5 | 7 | 7 | 7 | 7.2 |

Scores reflect the same layout, with color judgments informed by each Debt pair; other pages were viewed in Indigo. Cobalt is crisp and readable but more conventional and its blue is close to Housing identity. Copper has a warm editorial quality, but its brand and amber/coral risk cues can feel related; Orchid's pink accents compete with Insurance rose and can feel decorative. Maintain category and risk hues independently and use words/icons as well as color. Indigo also needs careful separation from the violet subscription identity.

The refined income sheet is a substantial improvement: it retains three clearly marked fields and a monthly equivalent while removing the oversized emblem and empty vertical space. The 44px controls appear plausible, but labels and secondary text look very small at the rendered phone size. Increase small text and muted contrast, preserve generous hit areas, and check long names, error text, keyboard and scrolling before adopting the compact sheet. The prior form spends much more height on ornament and whitespace.

Debt has a clear balance-first hierarchy and compact grouping, but category captions, APR/estimate lines, group totals, and bottom-navigation labels are small. Raise secondary type size/contrast, especially in dark mode, and use the remaining space below the account list for readability rather than further compression. Home's estimate is strong, but “27% below reference” needs a meaningful, accessible definition of reference; don't suggest a recorded achievement without an actual baseline. On utilization, “30% target” and “$2,250.00 to 30%” are more useful than an unlabeled marker; describe the latter as the amount needed to reach the target, and preserve numeric risk status alongside color. Budget's allocation colors and matching rows communicate categories; ensure values reflect the same commitments and do not rely on tint alone.

The transaction form explicitly marks date, amount, category and target debt; its balance preview needs a clear before/after label and must remain a preview until a recorded transaction exists. Bill's unselected category and disabled save express required choice; ensure any error says what is missing, and markers follow real conditional validation. The empty Upcoming state directs to Scheduled and the pending banner distinguishes unconfirmed activity; make the Scheduled destination an obvious actionable control and retain the pending qualifier in any subsequent payment flow. Missing-limit state correctly avoids invented utilization. These examples do not establish implementation behavior.

To approach 8/10: improve small text hierarchy and contrast on both themes; give the financial baseline and target amounts explicit meanings; distinguish brand from category and warning colors; and verify compact form behavior with keyboard, validation, large text, and scrolling. Maintain the cleaner income proportions, not reduced touch targets.

Verification: inspected HTML preview renders of all four Debt Light/Dark pairs, Indigo income previous/refined in both themes, Home, Budget, transaction and bill forms, utilization and edge-state examples. The preview is a static synthetic design, not native behavior, a measured accessibility audit, or validation of calculations. The file passed through the shell for preview displayed some mojibake in punctuation/status glyphs; this is a transport limitation, not a finding about the source file. One initially guessed form identifier failed and was replaced with the actual transaction-form identifier. No browser, device, backend, app changes, tests, or builds used.
