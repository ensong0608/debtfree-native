# T-078 Android local acceptance — blocked before UI launch

**Date:** 2026-11-07  
**Target:** Current workspace source, Android emulator-5554  
**Runtime result:** The harness and storage adapter were added and typechecked. The app was not launched because this thread's device session was denied while another session held the emulator. No UI scenario or screenshot was captured.

## Local harness safety and fixture

- Entry requires both `__DEV__` and `EXPO_PUBLIC_ENABLE_LOCAL_ACCEPTANCE=true`.
- The entry bypasses `RootApp`, so it does not verify or restore an auth session. While the flag is enabled, `src/auth.ts` does not create the Supabase client, even when `.env.local` contains sandbox values.
- The only accepted owner is `local-acceptance-owner-v1` with household `hh-local-acceptance-owner-v1`. Onboarding settings use a dedicated SecureStore key; financial records use that same reserved owner in the existing local finance cache namespace. Production owner IDs cannot enter the adapter branch.
- The synthetic fixture contains a card (`$1,600`), auto loan (`$12,400`, `$385` minimum), `$4,800` monthly income, and one `$385` synthetic debit vehicle bill. It contains no transactions or reconciliation anchors. Those values were authored for this fixture and are not copied from prototype captures or household data.
- Local debt changes persist to the reserved SecureStore snapshot. Sessionless finance operations use the existing local finance cache/pending journal, which is not automatically replayed. No app-side service request was made by this acceptance attempt. Backend behavior remains untested.

## Setup completed

- `npm.cmd run typecheck` passed after the harness and auth isolation guard were added.
- Started the workspace Metro dev client on port `8082`, with `EXPO_PUBLIC_ENABLE_LOCAL_ACCEPTANCE=true` and sandbox variables blank, then stopped it after device launch was denied.
- Called `device_list`, then `device_open` for `local/emulator-5554`; this created this thread's command at `C:\Users\lawre\.t3\userdata\device\targets\t3-fba0a2110a6bce99319ebec8\agent-device.cmd`.
- Launch returned: `Error (DEVICE_IN_USE): Device is already in use by session "t3-ae234456014d9d9b8a5ad3bd".` Followed the tool's permitted `--wait 5000` advice once; it again returned `DEVICE_IN_USE` for the same session. The other session was neither reused nor closed.
- There are no T-078 screenshots. The installed dev client package and Metro source were not attached because the launch command did not acquire the device.

## Acceptance checklist

| Scenario | Status | Evidence / boundary |
|---|---|---|
| Current source launches through dev client | **Blocked** | Device contention prevented app launch. |
| Home card hierarchy and hidden upcoming-bill behavior | Not executed | No UI opened. |
| Empty budget categories and income in Budget | Not executed | No UI opened. |
| Income add/edit and persistence after relaunch | Not executed | Harness local settings adapter is present; runtime persistence not exercised. |
| Debt detail popup, close/reopen, light and dark | Not executed | No UI opened or screenshots captured. |
| Explicit pair/unpair and duplicate prevention | Not executed | Synthetic auto loan and debit bill are prepared; interactions not exercised. |
| Pairing leaves debt balance and transaction history unchanged | Not executed | No before/after runtime evidence. |
| Backend auth, reads, or writes | Not executed | Adapter intentionally supplies no session and auth client creation is disabled in local mode; no backend result is claimed. |
| Owner-reference screenshot comparison | Not executed | No T-078 runtime screenshots; T-073 owner image assets were not present in the prior acceptance inventory. |

## Files added/changed for T-078

- `App.tsx`
- `src/auth.ts`
- `src/dev/local-acceptance.ts`
- `src/finance-storage.ts`
- `src/onboarding-storage.ts`
- `TRACKER.md`
- `docs/acceptance/T-078-android.md`
