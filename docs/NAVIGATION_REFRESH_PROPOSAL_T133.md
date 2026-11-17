# T133 navigation and refresh proposal

Design only; owner approval is pending. The HTML is a self-contained local study with synthetic data and no network or application mutations. The manager should render and review it before seeking approval.

- The floating dock retains Home, Debt, Transactions, Budget and Progress in order. A selected pill expands at ordinary widths; at phone widths of 380px or less, the dock uses five icon targets and a separate full selected-tab caption below it. This avoids squeezing Transactions or reducing the 44px targets. Supported study width is 320px and above; enlarged text still needs native verification. The contextual action sits above the dock for Debt, Transactions and Budget only. The long Debt list scrolls behind this fixed composition.
- Pulling vertically from the top of content below the header, or using the external review control, simulates refreshing. The offline control retains the displayed example. Route, section and demo draft remain in memory. These are visual simulations, not a connection or proof of native gesture behavior. Horizontal intent is excluded by the gesture threshold.
- A real implementation would refresh household and account data through existing safety rules, preserve pending writes and unsaved state, and report failures honestly without promising realtime synchronization. Collaboration remains deferred.
- The demo sheet does not submit. The mockup does not implement full existing screen interactions or production financial calculations. Native accessibility, actual device fit and gesture arbitration require review if implementation is approved. The manager will render the proposal; no device or browser verification was performed in this task.

## Manager revisions after T134

- Existing Progress Overview/Utilization/Milestones controls and Overview period selector restored. The study remains representative, not a full screen redesign.
- Offline simulation remains offline on repeated refresh until Reconnect demo is selected. Displayed content and draft stay intact. The simulated reconnect is explicit, not inferred from a timer.
- Demo sheet supports Escape, backdrop dismissal, keyboard focus containment and inert background; a local data-refresh preview keeps the draft text intact.
- Dock selected state uses an inverse high-contrast pill. Icon fallbacks are CSS shapes, so no network icon loading is needed.
- Manager rendered dark Debt at728 and all five selected tabs at320, with no console errors and940px content height. Standard-size geometry is reviewed; no native gesture, dynamic text, safe-area or accessibility certification.

Only design/docs were changed. Native src, data, refresh implementation and collaboration are untouched. Owner approval remains required.

## T135 icon and spacing refinement (design only)

Latest proposal: design/navigation-refresh-refined-2026-11-09.html; prior draft preserved. Uniform official Lucide0.468.0 SVG source assets: House, Wallet Cards, Receipt Text, Panels Top Left, Gauge. All share24-unit source grid,2-unit rounded strokes and28px display boxes, embedded as masks with no runtime network dependency. Asset notices/license kept under design/assets/navigation-round2.

Navigation targets increased from52 to60px tall, dock padding from5 to8px, selected icon/label gap to10px with16px side padding. Add action is54px tall with28px side padding and16px separation from dock. Phone study is414px wide at standard size;320px/narrow fallback retains large icon targets and selected caption below dock. Increased scroll clearance keeps final list items reachable.

Manager previews dark Debt and Transactions at728 and Budget at320 returned940px with no console errors. Native app icons, navigation and refresh behavior are unchanged. Owner approval still required.

## T136 connected dock study (design only)

Latest study: design/navigation-connected-dock-2026-11-09.html. All selected capsules use the same160px width and60px height at the standard414px phone study, sized for Transactions; inactive targets are48px. The contextual action is a58px full-width upper tier sharing one outline/surface with navigation. A subtle divider replaces the detached action pill and gap. Home and Progress omit the upper tier entirely.

Narrow screens retain the previously proposed equal icon-slot fallback and full selected caption below the dock, rather than compressing labels or overflowing five accessible targets. Standard and narrow variants therefore each maintain a consistent selected size within their layout. Owner still needs to approve that responsive compromise.

Manager HTML previews: dark Debt/Transactions/Home at728 have940px content height; narrow Budget at320 has964px after the review heading wraps. No console errors. Source reviewed all five action mappings and fixed-width selected rule. Native app/source/backend data unchanged; no builds/tests/device checks.
