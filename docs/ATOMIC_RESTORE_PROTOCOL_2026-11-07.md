# Atomic Native Restore Protocol — 2026-11-07

**Design status:** Complete for review. This is an implementation specification, not SQL ready to apply and not evidence of database execution. The restore UI remains disabled until the functions, schema additions, adapter, and isolated database acceptance below are complete.

## 1. Existing client contract

`src/finance/backup.ts` defines a validated `NativeBackup` v1, owner-scoped local checkpoint, deterministic merge plan, and two user choices. Merge adds missing rows and requires an explicit incoming/current choice for every conflict; omissions keep current rows. Replace requires explicit confirmation and treats omissions in every domain as deletes. The plan covers onboarding settings, debts, recurring bills, transactions, and reconciliation anchors. Backup validation checks household/user identity, currency, IDs, categories, dates, money, schedules, and row cross-references.

`src/finance/backup-recovery.ts` is prepared for one server transaction: `readCurrentSnapshot(owner) -> {snapshot, token}`, `restoreSnapshot({operationId, expectedBaselineToken, payloadFingerprint, mode, acceptedConflictIds, keptCurrentConflictIds, snapshot}) -> {operationId, payloadFingerprint, restoredSnapshot}`, and owner-scoped `findRestoreReceipt(operationId)`. It checkpoints the baseline and request before sending. On a lost response it looks up the same operation ID, and if still uncertain asks the caller to retry that same ID. Do not wire a sequence of per-row writes into this adapter.

The client fingerprint is SHA-256 over the JS canonical serializer (sorted object keys, preserved array order). PostgreSQL `jsonb::text` has different canonicalization. The database therefore **must not** treat the client fingerprint as a trusted digest or compute its own digest and compare the two. It stores and echoes the supplied fingerprint for adapter receipt consistency, while binding idempotency to the exact normalized JSONB request identity too.

## 2. Current database facts and consequences

These observations are from the local migrations; the migrations themselves are marked sandbox review only / unapplied and are not proof that a remote database has this schema.

| Area | Current contract | Restore consequence |
|---|---|---|
| Owner and household | `auth.users.raw_user_meta_data.debtfree_native_v1` stores onboarding settings; `auth.uid()` is the authenticated owner. Settings RPC forbids changing a saved `householdId`. Rows have `user_id`; debts, transactions and bills also have household identifiers. | Every RPC derives UID exclusively from `auth.uid()`. Never use `user_metadata` as authentication. Preserve the caller's existing household; verify active household membership/ownership against `households` and `household_members` before accepting the backup's matching household ID. Assign every row's `user_id` from UID and household ID from validated server state. Do not import a foreign row owner. |
| Settings CAS | `debtfree_save_settings(bigint,jsonb)` locks the `auth.users` row, compares `settingsRevision`, strips `debts`, writes `debts: []`, increments the revision, and sets transaction-local `debtfree.settings_rpc_cas=on`. The `auth.users` trigger rejects settings changes unless that flag is on and the revision advances exactly one. | Restore locks and updates the same auth row, strips debts from metadata, increments its current revision once, and sets the same transaction-local flag. It must not import the backup's `settingsRevision`; the returned settings revision and `updatedAt` are server-authoritative. Preserve unrelated metadata keys. |
| Debts | `debts` has UUID ID, `user_id`, household, numeric(12,2) balance fields, APR, due day, timestamps, and `version bigint >= 1`. Every UPDATE trigger forbids identity/owner changes and replaces `version` with `OLD.version + 1`. Delete trigger writes `debtfree_deleted_debt_ids(id, deleted_user_id, deleted_at)`; BEFORE and AFTER INSERT guards forbid reuse, including the concurrent-delete race. | New rows use DB version default 1. Existing changed rows update once and trigger exactly one revision increment. Never accept client `serverVersion` as a revision to write. Never clear tombstones or reset versions. A debt ID present in tombstones is a hard rejection even if the payload would otherwise be valid. |
| Financial write guards | Later migrations revoke authenticated `INSERT/UPDATE/DELETE` on transactions and reconciliation anchors and `UPDATE/DELETE` on debts; direct-write triggers reject authenticated/anon writes. Authenticated clients use SECURITY DEFINER RPCs. Recurring bill policies are owner-scoped; current local migrations do not show equivalent RPC-only guards for bills. | The new SECURITY DEFINER restore function is the only all-domain write boundary. Do not disable/drop triggers. It must be owned by the trusted migration role, use `SET search_path = ''`, qualify every object, verify `auth.uid()`, and validate every row before DML. Revoke direct access to its receipt table. |
| Ledger | `transactions` stores text ID, user/household, nullable debt account (`ON DELETE SET NULL`), date and applies-to date, amount numeric(18,4), category/payee/memo/source/reconciled, created/updated/deleted timestamps, and principal/interest/escrow/fee numeric(18,4) allocations. Its authenticated writes are RPC-only. | Preserve historical transaction date, applies-to date, signed category semantics, and allocation breakdown exactly. Set owner from auth, server updated timestamp on changed rows, and clear client-only pending state. Insert restored ledger rows directly inside the authorized restore transaction. Do **not** replay transaction deltas or call per-transaction balance RPCs: restore each debt's final balance once from the resolved snapshot. |
| Bills and anchors | `recurring_bills.amount` numeric(18,4), due day 1–31, payment method and optional credit debt FK (`ON DELETE SET NULL`). `reconciliation_anchors` has account FK (`ON DELETE CASCADE`), date, signed verified balance, note, `created_adjustment_id` added later, and created timestamp. | Preserve bill categories, payment methods, active/auto-post values, and debt cross-reference. Preserve anchor-to-adjustment transaction reference. Explicitly delete/update dependents before deleting omitted debts. |
| Anchor coverage gap | The native anchor type and validator permit `coveredTransactionIds`; the current table and `encodeReconciliationAnchorRow` do not persist it. The current encoder also only maps the database-backed anchor fields. | Before full restore is enabled, choose and implement an explicit compatibility solution. Recommended: add a nullable-safe `covered_transaction_ids text[] NOT NULL DEFAULT '{}'` (or JSONB with equivalent validation), update storage encode/decode and canonical snapshot projection, then validate every ID belongs to the same account/owner. If this is not done, reject backups containing non-empty coverage IDs; never report successful full restore after dropping them. |
| Pending marker | Native ledger rows may carry `isPending`, but there is no corresponding DB column in these migrations; it describes local journal state, not committed ledger history. | Exclude it from server writes and return `false` in the canonical restored snapshot. The native checkpoint/pending journal remains separate from server receipt data. |

Related definitions: migrations `20261106054618_onboarding_and_households.sql`, `20261106054648_secure_household_debts.sql`, `20261106054656_debt_revisions_and_tombstones.sql`, `20261106054705_settings_cas_and_tombstone_hardening.sql`, `20261106054714_transactions_bills_reconciliation.sql`, `20261106054719_strict_financial_rls_and_atomic_transactions.sql`, `20261106100000_transaction_due_cycle.sql`, `20261106120000_phase1_financial_integrity_mutations.sql`, and `20261106130000_phase1_rpc_only_financial_writes.sql`.

### Manager review clarifications

- Migration `20261105065959_debt_currency_precision.sql` upgrades debt money columns to `numeric(18,4)`. Validate the final migration chain rather than the older base table's `numeric(12,2)` declaration.
- The opaque baseline token excludes the backup envelope's volatile `exportedAt` value. Include persisted settings and all owned financial rows/revisions; two reads without intervening writes must have the same token even when their export timestamps differ.
- Version 1 restore rejects non-empty `coveredTransactionIds` until a separately verified coverage-column migration exists. It must still preserve the already-supported `created_adjustment_id` relationship. This is an explicit payload compatibility limit, not silent data loss.

## 3. SQL/API contracts to implement

Keep these three authenticated RPCs in a new forward-only migration after the listed schema/guard migrations. Their JSON shape maps directly to the prepared adapter; a small adapter mapping may add the explicit replace acknowledgment bit described below.

```text
public.debtfree_read_restore_baseline()
  RETURNS jsonb
  -- { snapshot: NativeBackup, baselineToken: string }

public.debtfree_apply_snapshot_restore(
  p_operation_id text,
  p_expected_baseline_token text,
  p_payload_fingerprint text,
  p_mode text,                         -- 'merge' | 'replace'
  p_accepted_conflict_ids text[],
  p_kept_current_conflict_ids text[],
  p_snapshot jsonb,                    -- resolved NativeBackup from adapter
  p_confirm_full_replacement boolean   -- true only for explicit replace confirmation
)
  RETURNS jsonb
  -- { operationId, payloadFingerprint, restoredSnapshot }

public.debtfree_find_restore_receipt(p_operation_id text)
  RETURNS jsonb
  -- NULL, or { operationId, payloadFingerprint, restoredSnapshot }
```

`p_confirm_full_replacement` is a deliberate narrow adapter extension: the recovery service already requires `confirmFullReplacement === true`, but the prepared `RestoreRpcRequest` does not currently carry that bit. Pass it through when `mode='replace'`; the database rejects replace without it and rejects it for merge. Limit ID length to the existing 512-character client contract and reject blank/trimmed IDs and malformed 64-hex client fingerprints. Keep the original operation ID stable across all retries.

Receipt table proposal:

```text
public.debtfree_restore_receipts
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_id text NOT NULL,
  request_identity jsonb NOT NULL,
  client_payload_fingerprint text NOT NULL,
  restored_snapshot jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, operation_id)
```

Enable RLS with no client policies; revoke all table privileges from `PUBLIC`, `anon`, and `authenticated`. Only the SECURITY DEFINER RPCs read/write receipts. The receipt lookup filters by `(auth.uid(), p_operation_id)` and returns no other user's existence or data. Revoke `PUBLIC`/`anon` execute on all three functions; grant execute only to `authenticated`. All functions use `SECURITY DEFINER SET search_path = ''`, fully qualified objects, and reject null `auth.uid()` before access. Do not accept owner UID as an RPC argument.

The canonical baseline token is generated and checked by the server from the canonical snapshot plus UID/household identity and all DB-owned revisions/timestamps. It can be a URL-safe encoding of SHA-256 over PostgreSQL's normalized representation; equality/optimistic concurrency is its purpose, not authentication. `read_restore_baseline` builds snapshot and token from one SQL statement/MVCC snapshot. `apply` recomputes the canonical token after taking write exclusion locks and rejects mismatch before mutation (`RESTORE_BASELINE_STALE`).

`request_identity` is a server-created JSONB object containing authenticated UID, expected baseline token, mode, sorted accepted/kept keys, explicit replacement acknowledgment, and the complete resolved snapshot. Compare JSONB identity directly for retries. The client fingerprint is saved and echoed, and must match the stored string for a same-operation retry because the prepared adapter checks it; it is only a receipt consistency label. It is **not** authorization, a signature, or proof of payload equivalence.

## 4. Concurrency and transaction protocol

Existing RPCs do not share an advisory restore lock. A per-user advisory lock alone would therefore fail to exclude them. For the rare full-restore transaction, use a global, fail-fast table-lock gate after the operation-ID advisory lock and receipt check:

1. Take `pg_advisory_xact_lock` on a deterministic 64-bit hash of `(auth.uid(), operation_id)`. This serializes only duplicate attempts for the same owner/operation. Then check the receipt before checking the baseline: exact identity and fingerprint returns the original receipt; any mismatch raises `RESTORE_OPERATION_ID_REUSED`.
2. Acquire `LOCK TABLE ... IN EXCLUSIVE MODE NOWAIT` in one fixed documented order: `auth.users`, `public.debts`, `public.debtfree_deleted_debt_ids`, `public.reconciliation_anchors`, `public.recurring_bills`, `public.transactions`, `public.debtfree_restore_receipts`. EXCLUSIVE conflicts with row-locking and write table locks but permits ordinary SELECT readers. It makes existing RPC/direct bill writers that do not know about a restore lock fail-fast instead of slipping through the snapshot/apply window. Do not wait while holding a partial set: NOWAIT failure aborts/rolls back and returns a retryable `RESTORE_BUSY`.
3. Select the caller's `auth.users` row `FOR UPDATE NOWAIT`; validate profile/household/currency, re-read the canonical snapshot and baseline token under the write gate, then reject stale baseline before any mutation. Keep transaction-local lock timeout finite as a final bound.
4. Validate the whole payload and resolution metadata before the first DML. Confirm same UID/household/currency, full snapshot shape, max rows, unique IDs, enum/category values, date-only validity, decimal bounds/scale for each table's numeric type, debt APR 0–100 and due days, nonnegative transaction allocations, required bill amount > 0, FK references, schedule keys, anchor adjustment/coverage references, and all cross-domain ownership. Reject unknown schema/version and unsupported anchor coverage.
5. Check all requested debt IDs against tombstones **before** any DML. No restore path deletes tombstones or reuses an ID. A replacement that omits current debts may delete them and thereby tombstone them; it must not also reinsert such IDs. Return a specific `RESTORE_TOMBSTONED_DEBT_ID` error so the client can explain that a newly generated debt ID is required.
6. For merge, preserve all current rows absent from `p_snapshot`; accepted conflict IDs must be unique, disjoint from kept IDs, domain-qualified (`domain:id`), and refer to rows in the current/resolved snapshots. Kept-current rows must equal the baseline row. Client performs the stronger original-backup plan check before RPC. Merge never infers deletes from omission.
7. For replace, require the acknowledgment bit, treat omitted onboarding settings and omitted rows in **all four** table domains as explicit deletion, and upsert only rows in resolved snapshot. Delete/update dependents in this order: transactions, anchors, bills, then debts; insert/upsert debts, then bills, transactions, anchors. One ordering handles FKs and leaves exact account references. Existing account IDs update in place; do not delete/reinsert a live debt just to reset it.
8. Update profile `debtfree_native_v1` once with debts stripped, server `settingsRevision + 1`, server `updatedAt`, preserving unrelated auth metadata; set the existing CAS GUC locally before this write. Assign UID/household values from server to rows. Preserve imported historical business dates and immutable original `created_at` on updates; use server `now()` for changed rows' `updated_at`. Debt updates naturally increment current revision once via trigger; inserts use version 1. Do not set version in payload. No `SET session_replication_role`, trigger disable, or exception path that suppresses tombstone/revision/ledger guards.
9. Apply each debt's final balance exactly once from the resolved snapshot. Insert transaction history as ledger records directly inside this authorized transaction—do not call `debtfree_record_transaction_atomic`, reconcile, or replay balance deltas. Validate allocation amounts and category/date semantics, but do not invent allocations or recalculate balances from an incomplete historical ledger.
10. Read the final canonical snapshot while still holding the gate, insert exactly one durable receipt with the normalized request identity, supplied client fingerprint, and that authoritative snapshot, then return the receipt. Any exception rolls back settings, all domains, trigger effects, and receipt together. Unique `(owner_user_id, operation_id)` is the final idempotency constraint.

The table-lock approach intentionally makes an isolated restore briefly serialize writes across users for these shared tables. It allows normal non-locking reads and returns promptly when any conflicting writer is active. This is a concrete compatibility tradeoff: if global write serialization is unacceptable, the alternative is to update every existing write RPC and direct bill path to acquire the same per-owner lock, which is a broader change and must be complete before replacing this gate. Do not silently replace this gate with only a per-user advisory lock.

## 5. Lost response and retry rules

- The first request either commits all domain changes and the receipt together, or commits nothing.
- If the response is lost after commit, `find_restore_receipt(operationId)` returns the exact saved `restoredSnapshot` and client fingerprint. It does not rebuild from today's live tables and does not reapply.
- If lookup itself is unavailable, retry the same operation ID with identical baseline, choice arrays, fingerprint, and snapshot. The operation advisory lock waits only for that same ID; after the first transaction commits, it finds and returns the receipt. Never mint a new ID for an uncertain outcome.
- Same operation ID with changed snapshot, baseline, mode, choices, acknowledgment, or fingerprint is rejected as `RESTORE_OPERATION_ID_REUSED`; never overwrite the receipt.
- Different operation ID with old baseline is rejected as stale. Receipt lookup authenticates UID before checking receipt existence, so it cannot be used to probe another user's operation IDs.
- Receipt is immutable; no receipt update/delete RPC is exposed. Retention/purge policy must not remove receipts while a client may retry. If retention is eventually introduced, publish its bound and ensure older IDs are permanently rejected rather than re-applied after receipt expiry.

## 6. Concrete isolated acceptance scenarios

Run only against a disposable isolated Supabase/Postgres project with synthetic users and rows. Verify migration apply first, then the following targeted scenarios; do not use prototype/production data.

1. **Complete baseline:** owner A obtains snapshot+opaque token; server projection contains settings with empty metadata debts plus debt table rows, bills, live and soft-deleted transactions, allocations, dates, anchors, revision, household and currency. Two back-to-back reads without writes return equivalent snapshot/token. Another user's ID/data never appears.
2. **Atomic replace success:** seed synthetic data in all domains; replace with a different validated snapshot; assert omissions are deleted across settings/debts/bills/transactions/anchors, references/allocations/categories/dates survive, each debt final balance is exactly input value once, changed existing debt version increments once, new debt begins at 1, settings revision increments once, and receipt snapshot equals fresh canonical server readback. Assert client supplied `user_id`, `household_id`, settings revision, debt version, `isPending`, or auth metadata cannot override server values.
3. **Merge choices:** incoming-only rows are added; omitted current rows remain; each conflicting `domain:id` selected incoming or current yields the correct complete snapshot; absent, duplicate, overlapping, wrong-domain, or non-conflict choice keys reject without writes. Replace without explicit acknowledgment rejects.
4. **Rollback:** induce a late FK/constraint/guard failure (for example invalid account or deliberately invalid covered-transaction reference). Confirm settings revision and all rows remain byte-for-byte at baseline and no receipt exists. Trigger-created tombstones from rolled-back deletes must also be absent.
5. **Idempotent lost response:** commit operation X, discard its simulated response, lookup X and compare its snapshot to the original receipt; retry identical X and verify no row versions/settings revisions/timestamps change and no second ledger effect occurs. Reuse X with one changed value or fingerprint and expect rejection.
6. **Stale baseline and write race:** use baseline A, commit a normal settings/debt/ledger/bill write, then attempt restore A and assert stale rejection with no mutation. Hold a conflicting writer open and assert restore returns retryable busy (NOWAIT); start restore first and assert a new writer cannot overlap the snapshot/apply/receipt window. Verify ordinary SELECT readers still work.
7. **Tombstone safety:** delete a synthetic debt through existing atomic path, then attempt restore/create with that same ID and assert specific tombstone rejection with tombstone unchanged. Restore a different new debt ID successfully. Replace omission may tombstone a live omitted debt, but subsequent use of its old ID must remain refused.
8. **Ownership/RLS/grants:** unauthenticated calls fail; owner A cannot get owner B's baseline, receipt, or rows; fabricated backup `userId`, household, or row IDs owned by B cannot transfer/update B's data. Direct receipt table reads/writes and function execution by `anon`/`PUBLIC` fail. Execute as authenticated only through the hardened RPCs.

These are acceptance cases, not claims that any test has run. No backend or local DB execution was performed for this design.

## 7. Implementation sequence and enablement checklist

1. Confirm the deployed isolated schema matches the listed prerequisites; current files are marked unapplied/sandbox-only. Add the covered-transaction-ID column and adapter mapping (or reject nonempty coverage) before claiming complete anchor restoration.
2. Implement the receipt table, three authenticated SECURITY DEFINER functions, validation helpers, deterministic lock gate, tombstone rejection, and exact rollback behavior in a new forward-only migration. Review owner privileges and function grants in the actual target project.
3. Implement server-row ↔ `NativeBackup` projection/mapping. Make decimal conversion exact at NUMERIC boundaries; do not use JS floating-point to round server amounts. Canonical reads must include all owned rows (including soft-deleted transactions), server debt versions, settings revision, timestamps and relationship fields. Do not include local `isPending` state.
4. Implement the native `RestoreAdapter`: derive user ID from verified `supabase.auth.getUser()`/verified session; never use editable `user_metadata` for auth. `readCurrentSnapshot` calls the baseline RPC and validates owner. `restoreSnapshot` sends one RPC with the same operation ID and all request fields plus the replace confirmation bit. `findRestoreReceipt` calls only the owner-scoped lookup RPC. Map documented definitive SQL rejections to `RestoreRejectedError`; timeouts/network errors remain uncertain.
5. Keep the existing checkpoint written before RPC. Only return confirmed after validating the returned receipt and full server snapshot; replace all cached settings/debt/finance state from that receipt. Lost-response recovery uses receipt readback and the exact same snapshot/fingerprint. Never mark partial per-row progress.
6. Enable native restore in Settings only after the isolated acceptance cases pass and adapter is present. Replace the disabled placeholder with explicit modes: merge with every conflict choice; replace with clear all-domain deletion warning and confirmation. Display stale/busy/tombstone errors distinctly. Ensure backup is read from a complete authoritative server snapshot and that unresolved local pending writes block restore until reviewed.
7. Record actual migration target/version, isolated run evidence, and remaining platform/device checks in the tracker/current acceptance ledger. Do not describe this spec itself as backend acceptance or enable production behavior from it.

## 8. Remaining gate

No further product or owner decision is required to complete this design. The design chooses fail-fast global EXCLUSIVE table locks for restore, permanent debt tombstone refusal, server-owned settings/debt revisions, and historical transaction insertion without balance-delta replay. The one material schema prerequisite is preserving `coveredTransactionIds`; implementation should use the recommended column+mapping or reject nonempty coverage before restore. Database migration review/deployment authorization and disposable isolated acceptance are later owner/environment gates; they are not blockers to this design and no credentials are requested here.
