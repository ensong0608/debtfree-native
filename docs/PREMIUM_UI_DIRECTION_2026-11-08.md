# Premium UI direction - 2026-11-08

> **Owner approval:** The owner likes this direction and authorized native implementation after correcting the crooked dropdown arrow. The text glyphs are now symmetric SVG chevrons. Earlier open-review notes below are historical; T-097/T-098 implement the approved design while preserving financial rules.

> **Implementation completed:** T-097/T-098 are integrated, typechecked and checked in the native Android app. Current screenshots and the exact verification boundary are in [the acceptance record](acceptance/2026-11-08/premium-debt-progress/ACCEPTANCE.md). The original proposal notes below document the design process, not outstanding requests for approval.

T-093 is a design proposal, not an implementation or a statement of production behavior. The companion HTML compares the supplied Debt screenshot and source reconstructions of Progress with proposed compositions. Proposed account names and figures are illustrative; source reconstructions are not runtime screenshots. The bill-category screenshot informed the desire for a less prominent selector; it does not change the bill form here.

## Direction

Keep the dark native mint, blue, violet, amber and coral family. Use larger numerical anchors, quieter separators, deliberate whitespace and fewer repeated surfaces. Debt retains Accounts / Strategy. The concept proposes grouped accounts and one category affordance in place of the second segmented strip, with search and sort subordinate. Category scopes must remain available, and account selection must still open Overview / Transactions / Detail. Confirm grouping, empty groups and filter behavior before implementation. The explicit authorization for this exploration supersedes the prior preference to preserve the current category controls for this proposal only.

Overview separates the balance snapshot from confirmed period activity. The snapshot compares current balances with the higher of each current and entered original balance; it can include corrections or credits. Recorded payments, payment balance reduction, interest and net change are distinct; incomplete history and unallocated loan principal must remain clear. Preserve period options and unavailable states. The illustrated figures are not a calculation specification.

Utilization leads with used credit and shows tracked limits, coverage, a textual status, and the existing 30% target. Risk should progress continuously from mint through amber to coral, while the percentage, target marker and status text communicate without color alone. Current source bands are good at or below 30%, watch above 30% through 50%, high above 50%; a continuous visual gradient is a proposal, not a change to those thresholds. Provide accessible labels for each bar with used percentage and target, and handle missing limits, over-limit values and pending balances explicitly. The HTML is a static visual study, not an accessibility implementation.

Milestones use medallions and a path to make status legible without suggesting invented dates or achievements. The actual calculation supports confirmed first payment and first 1,000 in payment balance reduction; the utilization goal reflects current state and can change. First payoff and 25/50/75/100% debt-free milestones are locked pending recorded payoff events and complete history coverage. Pending or reconciliation payments do not award payment milestones; pending balance writes or missing limits lock the utilization goal. Next unlock should follow the existing selection logic, not imply a chronological history. Show precise locked reasons on demand.

## Boundaries and open decisions

- The HTML selector switches screen pairs; controls inside phones illustrate layout and are not functional app controls. Full viewport compositions summarize content and are not runtime screenshots. Account details, empty/error/pending states, text scaling, contrast, focus order and screen-reader behavior require implementation design and verification.
- Upcoming is unpaid attention and Scheduled is the full paid/future calendar, both only in Transactions. Their precise inclusion and existing payment safeguards need source review before implementation; this task changes neither.
- Confirm whether grouping should show empty categories and which category affordance best preserves scope discovery. Confirm how much snapshot methodology belongs behind an information control. Do not infer payoff events, historic achievements or policies from mock data.
- No app code, financial data, backend or production settings were changed. No tests, builds, device sessions or rendering were performed; manager renders the HTML.

## Reference notes

Owner decisions and prototype references: references/UI_PREFERENCES.md, references/prototype/README.md, references/PROTOTYPE_CALCULATIONS.md, references/PROTOTYPE_INTERACTION_PATTERNS.md and APP_PLAN.md. Source inspected: src/screens/ProgressScreen.tsx and src/finance/progress.ts, especially calculateMilestones. The manager supplied these research starting points; they are references, not verified claims or mandatory implementation rules: [Apple segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls), [Apple charts](https://developer.apple.com/design/human-interface-guidelines/charts), [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [Copilot dashboard overview](https://help.copilot.money/en/articles/6045480-dashboard-tab-overview).

## Manager design review

Reviewed all four compositions visually. Corrected the snapshot bar to match 18%, aligned utilization target labels with their 30% markers, reconciled illustrative Debt group totals, and matched 72% / 18% card status text and colors to existing bands. Used amounts are prominent per card; earned milestone hero uses a restrained trophy seal and path. The current Debt reference now embeds the actual supplied image. No broader Debt/Progress source implementation has been applied; these are reviewable proposals.
