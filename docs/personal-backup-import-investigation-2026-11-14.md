# Personal dashboard backup import investigation

## Owner Standing Directives & Live State

2026-11-14 UPDATE: Owner confirms destination records are test data and the source is real months-long history, and authorizes completing the real replacement migration. Preserve all historical records and transactions; balance discrepancies may be corrected later. This supersedes the investigation-only authorization below in historical findings. Preserve login/membership and other households, back up destination and account for all source domains. Execution progress is tracked under T-274 in TRACKER.md. The findings below describe the preceding read-only investigation, not the current execution state.

Owner mapping clarification: prototype balance updates were reconciliation actions and should map to native Reconcile. Do not classify reductions as payments merely from their sign. Ask the owner about specific unmatched or conflicting records before assigning uncertain semantics; preserve original fields.

## Conclusion

A one-time migration of the financial state and supported history is feasible. A complete, lossless conversion of every source feature into working native features is not currently supported. The file is `debtfree-dashboard-backup`, version 6; the app requires `debtfree-native-backup`, version 1 and explicitly refuses prototype/dashboard payloads. Renaming the format/version or changing an email would be incorrect.

The full requirement needs a record-by-record conversion manifest, a native payload for supported records, and a deliberate preservation mechanism for source-only records and metadata. Keeping the original file protects information, but does not make that information available as usable native history. If every detail must be accessible inside the app, additional storage and potentially UI support would be needed; this is not a simple one-off insert.

## Verified destination (read-only)

- Project: `debtfree-native-auth` (`bitepxsdujceoszbldhd`). The separate `DebtApp` project was not modified or queried for financial records.
- Login: `lawrenceirvin.lee@gmail.com`, user ID `389bae99-23db-41f4-bfc1-ce833448035a`.
- Household: `hh-389bae99-23d`; one membership, active owner. No other member currently shares this destination household.
- Current records: 3 debts, 3 recurring bills, 1 transaction (not deleted), 0 reconciliation anchors.
- Shared settings revision 2, USD, monthly income 5,200, avalanche strategy, extra monthly payment 0. No `household_profiles` row for the target user; do not infer that personal information is absent from authentication or local storage.
- Latest deployed migration: `20261114003911`. Native household-aware restore RPC exists. Live function inspection confirmed ownership and stale-baseline guards and rejection of nonempty reconciliation coverage lists.

The correct replacement boundary is this household's financial data. Retain the existing authentication user, sign-in identity and membership. Deleting the authentication user is unnecessary and could break access and ownership relationships. Recheck membership and data immediately before any future execution, since this is a point-in-time inspection.

## Source inventory

File: `debtfree-household-backup-2026-11-14.json`, 439,020 bytes, exported `2026-11-14T22:42:08.521Z`. Currency is USD in `monthlyPlan.currency`.

| Source domain | Inventory | Native treatment and limitations |
| --- | --- | --- |
| Accounts | 13 credit cards; 4 have explicit archived timestamps | Native debt records with new UUIDs and a complete identity map. Stored `balance` is not necessarily the displayed balance. Preserve archive evidence; validate against native lifecycle rules. |
| Separate loan trackers | 2: House and Honda HR-V; 9 history rows in total | Mortgage and Auto loan debt records, history mapped to verified anchors/payments where supported. House balance is principal; auto balance is labeled payoff. Estimated auto payment allocations must remain explicitly estimated, not asserted as verified principal. |
| Transactions | 96, including 23 soft-deleted; 70 payment, 21 charge, 5 fee by source type | Map amounts, dates, account identity, category and deletion state. One deleted zero-amount replaced interest estimate fails the native positive-amount validator and requires non-ledger preservation. |
| Balance adjustments | 76, including 14 soft-deleted; 58 embedded revision records | Classify increases, credits, reconciliation and confirmed payments without treating every decrease as a payment. Four contain confirmed-payment metadata. Full adjustment audit/revision structures have no direct native equivalent. |
| Payees | 24 | Native transaction payee text can retain names. The standalone directory, unused entries and payee IDs lack a direct native domain. |
| Monthly budgets | 61 income/expense rows across July–December 2026 | Current income and recurring expenses can be mapped. Month-specific historical budgets are not equivalent to the native current shared income/bill settings. Preserve history separately if no schema expansion is chosen. |
| Snapshots | 6, plus 1 embedded revision | No native snapshot collection in the current backup contract. Preserve separately; never manufacture transactions from snapshot balances. Three account identities appear only inside historical snapshots. |
| Monthly plans | 4 month entries, 17 settlements, 62 due-payment associations | Separate planned payments from real payments, debit settlements from credit charges, and obligation fulfillment from duplicate money movement. Source planning and settlement structures need explicit transformation or preservation. |
| Other settings | Strategies, extra-payment values, custom account order/groups, minimum cycles, notes, interest automation, recurring-source exclusions and other metadata | Some native counterparts exist; others do not. Source has differing strategy/amount fields: root strategy avalanche versus payoff-plan strategy snowball; `extra`, calculator amount, payoff-plan amount and payoff extra are distinct concepts. Do not choose by field-name similarity. |

All source transaction and balance-adjustment account references resolve to the 13 source card identities; IDs are unique within each of those domains. This is a useful consistency check, not proof that all history is complete. The top-level `planning` object is largely empty/incomplete; current financial information also lives in monthly budgets and monthly plans.

## Material issues

1. **Balances can be counted twice.** The prototype calculates balances using an opening balance, offsets, reconciliation state, covered transaction IDs and transactions not already represented. Nine card accounts have reconciliation state; eight have nonempty coverage lists. Importing a current balance and replaying all historical payments/charges changes it again. Conversion must establish a justified native opening/anchor state and reconcile every account to the source calculation.

2. **Reconciliation semantics differ.** The deployed restore function rejects nonempty `coveredTransactionIds` with `RESTORE_UNSUPPORTED_COVERAGE`. Native ledger same-day timestamp filtering also differs from the prototype's explicit-coverage behavior. Removing coverage lists just to pass validation is unsafe. Determine whether an exact supported representation can be produced; otherwise a scoped reviewed backend change or preservation approach is required. Exact conversion has not yet been implemented or proven.

3. **History contains records that intentionally do not move money.** The file includes an `includedIn` payment relationship, deleted/replaced records, recurring-charge metadata and settlements marked `included`. Preserve their meaning without posting them again. The zero-value deleted estimate cannot simply become a native transaction or be changed to one cent.

4. **Recurring identities span months.** Multiple monthly rows represent the same recurring source, while other sources are explicitly disabled. Converting every monthly row into an active bill would multiply obligations. Use stable source IDs/recurring-source IDs, not names, and deduplicate settlements against actual charges and loan payments. Pair Mortgage/Auto bills with the correct loan identity so budget and Upcoming do not duplicate them.

5. **Archives and original balances require care.** Four card accounts are explicitly archived, but native archive status is tied to a confirmed payoff and zero balance. Do not infer a fresh payoff milestone from restored historical rows or simply copy raw nonzero opening balances into archived current debt rows. Preserve proven source archive evidence and determine a compatible representation. Prototype baselines and historical snapshot balances also do not automatically establish the native entered-original reference.

6. **Visible results may differ even with correct balances.** Native progress and payoff formulas, category rules, reference requirements and historical completeness disclosures still apply. Source snapshots and projected debt-free dates must not overwrite native calculations. Loan payoff quotes and estimated allocations are not interchangeable with verified principal. Missing financial details must remain unknown rather than invented.

7. **Attribution is not authentication.** Source records include creator names/emails belonging to multiple people. Preserve them as historical provenance where supported or in the preservation bundle. Do not create memberships, change the target login, impersonate creators or misrepresent all imported actions as newly performed by the target user.

8. **Replacement is destructive and devices can race it.** Existing target financial rows and selected shared settings would be replaced. A separate export of the entire affected destination state is required, including relevant lifecycle/tombstone/receipt state if an administrative route is used. Stop writes and resolve pending device journals/drafts/checkpoints before execution; refresh clients afterward. Automatic recurring posting needs special attention to avoid historical reposting.

## Recommended execution design, if subsequently approved

1. Preserve the original source file and hash it. Export the destination financial state and the metadata required for rollback. Keep these sensitive artifacts private and outside version-controlled source files.
2. Produce a conversion package locally: deterministic source-to-native identity maps, native-format candidate payload, source-only preservation bundle, and a manifest accounting for every source row and embedded history record. Mark estimates, missing data and unresolved mappings explicitly. Local validation is a safety step for a real migration, not a test-account import.
3. Resolve the reconciliation coverage, zero-value audit row, source archive representation, and unsupported historical domains before treating the package as executable. If all details must be accessible inside the native app, scope the necessary storage/UI work explicitly.
4. Produce a concrete replacement review: exact target household, current rows removed, incoming supported rows, source-only preserved records, expected per-account balances, active obligations, and rollback package. Do not delete target data before this package exists.
5. Prefer the existing guarded atomic restore path after validating its applicability. It enforces authenticated actor/household/currency, expected membership version and expected server baseline, records an operation receipt, and remaps identities. A service credential alone is not a substitute for its actor context. If an administrative transaction is required, review the full household security/lifecycle contract rather than bypassing it with ad hoc inserts.
6. After separate execution approval, perform replacement atomically with an abort on any mismatch. Do not use a reset-then-import sequence that can leave the household empty after failure. Preserve the login and unrelated households.
7. Read back and reconcile counts, every account balance, payment/charge/adjustment classification, deleted-record handling, active recurring obligations and paired loans; reload the app without stale pending writes. Roll back on material discrepancies, using the destination export. No broad build/test suite is required for this investigation.

## Evidence and limits

Reviewed the complete attached JSON structure and counts, prototype balance and payment-overlap implementations, native backup/ledger/debt contracts, integrated SQL migration, and live native destination aggregates/function guards. Key source files: `src/finance/backup.ts`, `src/finance/ledger.ts`, `src/onboarding-domain.ts`, `references/prototype-repo/app/progress-balances.ts`, `references/prototype-repo/app/payment-overlap.ts`, and `supabase/migrations/20261114003911_household_finance_cutover_and_membership.sql`.

No converted payload, destination rollback export, exact account-balance reconciliation or executable migration has been created. No source or destination financial data was changed; no credentials were retrieved; no application code, schema, backend function or device state was changed. The immediate deliverable is this feasibility assessment, not a claim that a lossless import is ready.
