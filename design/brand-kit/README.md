# BitLess Brand Kit

This kit packages the supplied `gemini-svg.svg` logo as reusable standalone SVGs. The original attachment is preserved at `assets/bitless-logo-supplied.svg`.

Open [index.html](index.html) for the visual reference board.

## Included

- Stacked, horizontal, mark-only, and wordmark-only transparent logo variants.
- Theme colors for the approved BitLess core blue, Cobalt Light/Dark, Indigo Light/Dark, and Inspire.
- Neutral slate, white, and black variants for utility placements.
- Square full-bleed app icon tiles for Core Blue, Cobalt, Indigo, and Inspire, in SVG source and 1024 ? 1024 PNG export.

The transparent SVGs can be used on any matching background. The app icon tile is square by design so platform launchers can apply their own corner mask. Use one fixed app icon; do not swap it automatically with system theme.

## App placement

- Home: pair mark-only with the title `BitLess`.
- Other tabs: pair mark-only with the tab title, and omit the BitLess wordmark in the header.
- Welcome/splash/document title: use stacked or horizontal logo.
- Favicon/avatar: use mark-only.

Keep category and financial risk colors separate from brand logo colors. All generated wordmarks are outlined paths derived from Ubuntu Bold, so generated logo SVGs render consistently without installed fonts. The supplied source SVG is preserved unchanged. The Ubuntu Bold font and its license are included for future edits; see `assets/Ubuntu-Bold.ttf` and `Ubuntu-Font-License.txt`.

This is a local design asset package; it does not change native theme code.

## Color references

Approved BitLess core palette: blue `#0051FB`, pale sky blue `#ABDFFD`, turquoise `#27EEE9`, mint `#98EDC1`, navy `#070D5B`, and white. The core logo uses blue for the mark and navy for the wordmark. The generated wordmark paths use Ubuntu Bold from [Google Fonts](https://github.com/google/fonts/tree/main/ufl/ubuntu), under the included Ubuntu Font License.

Theme-matched logo colors follow `src/components/appearance-theme.ts`: Cobalt Light uses `#0051FB` / `#0F1A2E`, Cobalt Dark uses `#4F90FF` / `#F5F5F7`; Indigo Light uses `#5147A8` / `#24232D`, Indigo Dark uses `#B9B1FF` / `#F5F5F7`; Inspire uses `#0A85A5` / `#102A3A`. In each pair, the first color is the mark and the second is the wordmark.
