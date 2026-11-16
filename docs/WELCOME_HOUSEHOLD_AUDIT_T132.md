# T132 independent source audit

Source and five owner-provided before images reviewed; these images show the prior header, household page and pagination, not the implemented result. No runtime, device, backend, browser or test verification was performed. Manager reports integrated typecheck passed.

## Findings

1. **High — data completeness is not supplied to the welcome.** `src/OnboardingAndHome.tsx:319` tracks `financeRecordsVerified`, but the Home props at `:3018` do not pass it; `src/screens/HomeScreen.tsx:1016` supplies only reload/local feedback as status. `src/components/WelcomeSheet.tsx:30` can therefore announce no known items while the underlying finance scope is unverified and no error is present. Pass an explicit completeness/loading state and suppress encouragement until supported.
2. **High — welcome can overlap another Home sheet.** `HomeScreen.tsx:1009` gates Settings and the debt form but not the shared information sheets opened from Home (`:1069` and `src/components/FinancialScreen.tsx:208`). A background return while information is open sets welcome pending, so two native modals can compete. Coordinate modal ownership and defer until the existing sheet closes.
3. **Medium — pairing Review is a dead end.** `HomeScreen.tsx:1019` merely dismisses the welcome. It neither opens the pairing review nor directs the user to it. A labelled review action must navigate to a useful destination or provide clear next steps.
4. **Medium — missing encouragement and inaccurate loading copy.** The no-items branch in `WelcomeSheet.tsx:30` provides only a neutral status, with no requested encouragement. `HomeScreen.tsx:1016` literally supplies `Loading data?`, an unintended question mark. WelcomeSheet's punctuation characters in the current UTF-8 source are normal `›` and `·`, not replacement glyphs; rendering was not checked.
5. **Medium — partial settlement is omitted.** `WelcomeSheet.tsx:28` labels pending but not `partially_paid`; the Home upcoming list explicitly distinguishes Partial at `HomeScreen.tsx:1198`. Show the real status to avoid implying an untouched obligation.
6. **Medium — Android back bypasses editor cancellation.** `FiveTabShell.tsx:47` handles hardware back by closing Settings directly. While the household editor is open, this bypasses its own cancel/back handling (`SettingsScreen.tsx:721`) and discards its draft. During save it can also close Settings despite disabled visible controls. Route hardware back through editor state and block it during save.
7. **Lifecycle risk — unknown initial app state.** `HomeScreen.tsx:184` initializes active only when `AppState.currentState === 'active'`; an initial null/unknown state relies on a later event to show the initial welcome. Confirm on native startup or explicitly handle unknown. The background flag otherwise survives inactive and triggers once on subsequent active; tab switches and editor dismissal do not independently set pending.

## Requirement matrix

| Requirement | Source assessment |
| --- | --- |
| Header real name, no date/time; remove Home setup/reload | `HomeScreen.tsx:1046` uses first full_name with 'there' fallback; controls absent. A profile without full_name cannot display a real name. |
| Welcome once at open/return, Home only | Pending flag and shell visibility callback implement intended path; unknown initial state and modal collision above remain. No native certification. |
| Real attention, dedup, honest states/actions | Overdue precedes upcoming and exact IDs deduplicate (`WelcomeSheet.tsx:15`); future list excludes past dates (`HomeScreen.tsx:276,337`), so their usual cycles do not overlap. Pending count excludes deleted. Completeness, partial status and pairing action have gaps above. |
| Household editor and persistence | Dedicated name editor trims and validates 1–120 characters, retains draft on error and disables visible actions during save (`SettingsScreen.tsx:479,901`); hardware back exception above. Session guard exists. Narrow patch preserves other settings; `onboarding-storage.ts:213,250,285` serializes profile, checks authenticated user and CAS revision, rebases only unchanged target and restores debts. Migration `20261106054705_settings_cas_and_tombstone_hardening.sql:170` retains settings keys. Storage and backup validate optional name (`debt-storage-domain.ts:30`, `finance/backup.ts:55`). These are static observations, not proof of deployed RPC or reload. |
| Currency lock, stage, onboarding | Name patch does not modify stage or currency; existing currency guard remains in settings. No onboarding handoff in household editor observed. |
| Compact dots and access | `FinancialScreen.tsx:204,213,230` retains paging, reposition on content resize and a 44-point adjustable control with increment/decrement. Actual touch, rotation, focus and screen-reader behavior unverified. |
| Navigation and Progress | `FiveTabShell.tsx:57` redirects Debt Scheduled to Transactions; `ProgressScreen.tsx:197,204,322` retains compact always-visible net activity and expanded milestones. Detailed visual alignment unverified. |
| Collaboration | Deferred; no multi-member implementation assessed or requested. |


## Manager corrections after independent audit

The findings above describe the independently audited source snapshot. Subsequent local corrections:

1. OnboardingAndHome now passes its explicit financeRecordsVerified flag to Home. Welcome suppresses all-clear encouragement unless verified, no error/status, no known due/overdue/pending items and no pairing reviews. Unverified state explicitly warns that attention items may be incomplete. No new backend calls or freshness certification.
2. Both Home information controls report visibility; a foreground welcome remains pending while help is open and during a short dismissal grace period. Initial unknown AppState supports the first-open welcome; background-to-active logic remains unchanged. Native modal dismissal timing/focus still requires verification.
3. Pairing Review dismisses welcome and scrolls the Home content to the existing loan-link review section, measured from its layout. No automatic linking or payment.
4. Welcome loading wording is corrected, actions use AppIcon chevrons, partial and pending settlement statuses are shown, and supported no-known-items state includes encouragement. Greeting uses real profile name/username/email fallback consistently with Hi header.
5. Hardware Back handling moved from the shell to Settings: during a save it is consumed; from household editing it cancels back to Household; from a subpage it returns to Settings; root closes. Visible close/save protections remain.

Manager integrated npm.cmd run typecheck passed after these corrections. Existing optional householdName uses settings CAS and validators; no runtime save or live backend mutation performed. Original owner screenshots are before references, not new native evidence. No fresh independent re-audit, builds, device/gesture/focus/persistence verification or collaboration implementation.
