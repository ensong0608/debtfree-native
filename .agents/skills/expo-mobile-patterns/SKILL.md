# Expo Mobile Patterns Skill

## Description
Design, interaction, and mobile architecture patterns for `debtfree-native` using Expo 58, React Native 0.88, and React 19. All agents building screens, modals, cards, or mobile flows must adhere to these directives and prototype blueprints.

---

## 1. Prototype Blueprint vs. Mobile Refinement

Consult [`references/PROTOTYPE_INTERACTION_PATTERNS.md`](file:///C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/references/PROTOTYPE_INTERACTION_PATTERNS.md) and [`APP_PLAN.md`](file:///C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/APP_PLAN.md):
- **Behavioral model, not a carbon copy**: Match interaction hierarchies, tabs, modal behaviors, and data flows, but refine styling and ergonomics for iOS and Android native devices.
- **Copy & Typography**: Keep copy clean, concise, and modern. Never display bulky boilerplate disclaimers or repetitive snapshot explanations.

---

## 2. Core Screen Invariants & Layouts

### A. FiveTabShell (`src/FiveTabShell.tsx`)
1. **Home**:
   - **Debt Snapshot Card Deck**: Category pills (`Cards & Loans | Home | Auto`) instead of web-style arrows.
   - **Upcoming Recurring Bills Card**: **Hidden by default**. It ONLY appears if a recurring bill or credit card minimum is nearing its due date (within 14 days) and has NOT been settled yet. Tap routes to `Budget -> Upcoming`.
   - **Payoff Strategy Card**: Tapping the card or "See all" routes directly to `Budget -> Strategy`.
2. **Debt Tab (`src/screens/DebtScreen.tsx`)**:
   - Displays debt cards categorized by type.
   - Tapping an account card opens a dedicated **3-tab detail view/modal**:
     - `Overview`: Key numbers, APR, minimum payment, progress ring/sparkline.
     - `Transactions`: Filtered list of transactions affecting this account.
     - `Manage / Details`: APR editing, terms, balance reconciliation modal, and account deletion.
3. **Budget Tab (`src/screens/BudgetScreen.tsx`)**:
   - Subtabs: `Upcoming Bills`, `Cash Flow`, `Strategy`.
   - On the `Strategy` subtab: shows ranked debt accounts according to the chosen strategy (Snowball vs. Avalanche). Tapping any debt row toggles an expandable inline monthly schedule table (`Month`, `Payment`, `Interest`, `Balance`).
4. **Transactions Tab (`src/screens/TransactionsScreen.tsx`)**:
   - Fast entry form with allocation split inputs (principal, interest, escrow, fee) dynamically displayed when Mortgage or Auto loan is selected.
5. **Progress Tab (`src/screens/ProgressScreen.tsx`)**:
   - Leads with an overall payoff circular gauge and the next milestone target upfront.
   - Credit utilization breakdown with status badges (`Good`, `Watch`, `High`) and paydown targets to 30%.
   - Achievement cards for debt-free milestones.

---

## 3. React Native 0.88 & Expo 58 Guardrails

- **Safe Area Insets**: Always use `useSafeAreaInsets()` from `react-native-safe-area-context` to pad top headers and bottom tab bars. Never hardcode pixel values like `paddingTop: 44` or `paddingBottom: 34`.
- **Styling**:
  - Use `StyleSheet.create({ ... })`.
  - Avoid web-only CSS properties: do NOT use `gap` without polyfill/version safety, `boxShadow` (use `elevation` on Android and `shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius` on iOS), or `cursor: pointer`.
- **Keyboard Handling**:
  - Wrap editable forms with `KeyboardAvoidingView` (with `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`) and `ScrollView` with `keyboardShouldPersistTaps="handled"`.
- **Iconography**:
  - Use the native SVG icon system in [`src/components/AppIcon.tsx`](file:///C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/src/components/AppIcon.tsx).

---

## 4. Double-Submission & Touch Responsiveness

- All form submission buttons must include active loading spinners and disable touch events during asynchronous storage/RPC calls (`disabled={isSubmitting}`).
- Alert/feedback modals must cleanly dismiss without locking the underlying screen gesture responder.
