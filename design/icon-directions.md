# Icon System Concept Board (`T-012`)

Visual companion: [`design/icon-directions.html`](./icon-directions.html)

This document defines three visibly distinct, code-native (`viewBox="0 0 24 24"`) inline-SVG icon families for the five primary bottom tabs (**Home**, **Debt**, **Transactions**, **Budget**, **Progress**) plus five coordinated utility and liability category icons (**Settings**, **Bell**, **Add**, **Home Loan**, **Auto**).

All samples use `currentColor` and theme-neutral shades only so the icon language can be chosen independently of the final application color palette.

---

## 1. The Five Primary Navigation Metaphors

Rather than changing only stroke weight across options, each family interprets the five core tabs with distinct structural geometry tailored to its visual language:

| Tab Order | Tab Name | Option A: Rounded Outline (*Tactile Monoline*) | Option B: Confident Solid (*Sculpted Silhouette*) | Option C: Geometric Duotone (*Layered Depth*) |
| :---: | :--- | :--- | :--- | :--- |
| **1** | **Home** | Soft-pitched gable with continuous rounded walls, arched doorway, and active hearth dot (`14%` chamber fill). | Solid architectural gable block with a negative-space doorway cutout on active; crisp chiseled frame on inactive. | Shaded sanctuary interior plane (`30%` opacity) beneath a sharp overhanging roof ridge and solid threshold door. |
| **2** | **Debt** | Rounded credit/liability card with horizontal magnetic stripe and a balance payoff indicator dot. | Layered card silhouette with a bold carved checkmark badge cutting into the lower-right corner. | Tilted secondary card plane in the background (`32%` opacity) behind a foreground payoff card with a checkmark. |
| **3** | **Transactions** | Opposing horizontal rounded transfer arrows with open counters (`12%` soft pill halo when active). | Solid rounded container with carved negative-space bidirectional exchange arrows (`evenodd` cutout). | Shaded vertical ledger sheet backdrop (`28%` opacity) crossed by high-contrast bidirectional exchange arrows. |
| **4** | **Budget** | Segmented donut/ring gauge with an offset top-right allocation wedge. | Modular 3-tile bento grid (`50/30/20` envelope proportions) that switches from outlined tiles to solid blocks. | Split allocation frame with a shaded category chamber (`26%` opacity) and a foreground focal node. |
| **5** | **Progress** | Smooth ascending trajectory line with an upward arrowhead, milestone node, and subtle area wash on active. | Three ascending stepped columns topped by a rising trajectory vector on the active state. | Shaded mountain area-chart polygon (`30%` opacity) beneath a crisp multi-point trajectory line and peak beacon. |

---

## 2. Direction Comparison & Tradeoffs

### Option A — Rounded Outline (*Tactile Monoline*)
- **Grid & Construction**: `24×24` grid, `1.75px` inactive / `1.95px` active stroke width, `stroke-linecap="round"`, `stroke-linejoin="round"`. Active state adds a subtle `fill-opacity="0.14"` inner wash and focal dot.
- **Strengths**:
  - Airy, approachable, and effortless to extend across dozens of future utility or category icons.
  - Forgiving alongside dense numerical tables and small labels.
- **Tradeoffs**:
  - Lowest peripheral contrast between active and inactive states at `24px` when rendered in neutral monochrome.
  - Can feel generic if not paired with strong active pill/indicator styling in the tab bar.

### Option B — Confident Solid (*Sculpted Silhouette*)
- **Grid & Construction**: `24×24` grid. Active state uses `100%` solid `currentColor` silhouettes with negative-space cutouts (`fill-rule="evenodd"`); inactive state drops to a `1.8px` chiseled outline.
- **Strengths**:
  - Unmistakable active/inactive tab differentiation at a glance, even in low-contrast or outdoor viewing conditions.
  - Anchors the bottom bar with strong visual gravity.
- **Tradeoffs**:
  - Complex metaphors (such as **Transactions** and **Debt**) require carefully tuned cutout gaps so internal negative space does not plug up on lower-DPI screens at `24px`.
  - Solid fills carry heavier optical mass that may compete with bold financial KPI typography.

### Option C — Geometric Duotone (*Layered Depth*) — **Recommended**
- **Grid & Construction**: `24×24` grid combining a primary structural stroke/fill (`100% currentColor`, `1.75px` inactive / `1.95px–2.0px` active) with a secondary geometric plane (`fill="currentColor"` at `16%–20%` opacity when inactive, stepping up to `28%–32%` when active).
- **Strengths**:
  - **Best semantic clarity for financial concepts**: Financial workflows naturally involve overlapping layers (multiple debt accounts, transactions against a ledger, area under a payoff curve, budget envelopes). A second neutral plane communicates these concepts immediately at `24px` without cluttering the foreground stroke.
  - **Palette-ready**: Because the secondary layer uses `currentColor` with fractional opacity (or a single `--primary` / `--muted-foreground` CSS variable), it adapts automatically to light mode, dark mode, or any future brand palette without redoing SVG assets.
  - **Balanced active state**: Stepping up both stroke weight (`1.75px -> 2.0px`), secondary plane opacity (`16% -> 30%`), and a crisp solid focal element (doorway, card chip, peak beacon) creates clear state hierarchy without the visual heaviness of full solid blocks.
- **Tradeoffs**:
  - Slightly more disciplined SVG authoring than single-weight outlines (each icon requires a deliberate foreground path + background plane).

---

## 3. Plain Recommendation

**Choose Option C (Geometric Duotone — Layered Depth)** as the primary icon direction for `debtfree-native`, or **Option A (Rounded Outline)** if a strictly minimal single-stroke aesthetic is preferred.

- **Why Option C wins**: In a five-tab financial tool (**Home, Debt, Transactions, Budget, Progress**), three of the five tabs represent multi-layered data (**Debt** card stacks, **Transactions** against a ledger, and **Progress** trajectories). Option C's two-layer neutral structure makes each tab icon distinct in silhouette while maintaining uniform optical weight across the `24px` bottom navigation bar and `16px–20px` utility chips (**Settings, Bell, Add, Home Loan, Auto**).
