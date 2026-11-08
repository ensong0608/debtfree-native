# Atomic Native Restore SQL Review Notes \u2014 2026-11-07

**Status:** Implementation Complete for Review (Forward-only migration authored; UNAPPLIED).  
**Task:** T-058-SQL  
**Author:** Worker Gemini 3.8 Flash High  
**Migration File:** [`supabase/migrations/20261107231432_atomic_native_restore.sql`](file:///C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/supabase/migrations/20261107231432_atomic_native_restore.sql)  

---

## 1. Prerequisites and Schema Dependencies

The migration [`20261107231432_atomic_native_restore.sql`](file:///C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/supabase/migrations/20261107231432_atomic_native_restore.sql) depends upon the following migration chain (in order):

1. `20261105065959_debt_currency_precision.sql`: `numeric(18, 4)` precision on `balance`, `minimum_payment`, `original_balance`, and `credit_limit`.
2. `20261106054618_onboarding_and_households.sql`: `households`, `household_members`, and initial `debts` table with RLS.
3. `20261106054648_secure_household_debts.sql`: Hardened debt ownership RLS policies.
4. `20261106054656_debt_revisions_and_tombstones.sql`: Monotonic debt `version`, `debtfree_debt_revision` trigger, and `debtfree_deleted_debt_ids` tombstone table with `debtfree_debt_tombstone` guard.
5. `20261106054705_settings_cas_and_tombstone_hardening.sql`: Atomic settings CAS GUC `debtfree.settings_rpc_cas`, `debtfree_settings_revision`, `auth.users` trigger guard `debtfree_settings_revision_guard`, and post-insert tombstone race guard.
6. `20261106054714_transactions_bills_reconciliation.sql`: `transactions`, `recurring_bills`, and `reconciliation_anchors` tables with numeric(18, 4) precision and indexes.
7. `20261106054719_strict_financial_rls_and_atomic_transactions.sql`: Granular user-isolated RLS on ledger, bills, and anchors.
8. `20261106100000_transaction_due_cycle.sql`: `applies_to_date` cycle-fulfillment column on `transactions`.
9. `20261106120000_phase1_financial_integrity_mutations.sql`: Payment allocation breakdown columns (`principal_amount`, `interest_amount`, `escrow_amount`, `fee_amount`), `updated_at`, and `reconciliation_anchors.created_adjustment_id`.
10. `20261106130000_phase1_rpc_only_financial_writes.sql`: Triggers rejecting direct ledger and debt modifications by `authenticated` and `anon` roles.

---

## 2. Implemented Database Objects and Signatures

### Receipt Table
- **Table:** `public.debtfree_restore_receipts`
- **Columns:**
  - `owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
  - `operation_id text NOT NULL`
  - `request_identity jsonb NOT NULL`
  - `client_payload_fingerprint text NOT NULL`
  - `restored_snapshot jsonb NOT NULL`
  - `completed_at timestamptz NOT NULL DEFAULT now()`
  - `PRIMARY KEY (owner_user_id, operation_id)`
- **Security:** RLS enabled; `REVOKE ALL ON TABLE public.debtfree_restore_receipts FROM PUBLIC, anon, authenticated;`. Only accessed via definer RPCs.

### Internal Helpers
- **Scale Resolver:** `public.debtfree_internal_currency_scale(p_currency text) RETURNS integer`
  - Resolves minor-unit decimal scaling (0 for JPY/KRW/etc., 3 for KWD/BHD/etc., 4 for CLF/UYW, 2 for USD/EUR/GBP/etc.).
  - `REVOKE ALL FROM PUBLIC, anon, authenticated;`
- **Household Resolver:** `public.debtfree_internal_verify_user_household(p_uid uuid) RETURNS (r_household_id text, r_currency text)`
  - Authenticates immutable server household membership and currency from `public.households` and `public.household_members`.
  - `REVOKE ALL FROM PUBLIC, anon, authenticated;`
- **Snapshot & Baseline Builder:** `public.debtfree_internal_build_snapshot(p_uid uuid, p_household_id text, p_currency text) RETURNS (r_snapshot jsonb, r_baseline_token text)`
  - Canonical projection covering settings profile, debts (with server versions), bills, transactions (including soft-deleted rows and allocations), and reconciliation anchors.
  - Computes `r_baseline_token` via SHA-256 over deterministic, ordered persisted data (strictly excludes volatile `exportedAt`).
  - `REVOKE ALL FROM PUBLIC, anon, authenticated;`

### Public RPCs (Granted to `authenticated` only; `REVOKE ALL FROM PUBLIC, anon;`)

1. **`public.debtfree_read_restore_baseline()`**
   ```sql
   RETURNS jsonb
   -- Returns: { "snapshot": NativeBackup, "baselineToken": string }
   ```
2. **`public.debtfree_find_restore_receipt(p_operation_id text)`**
   ```sql
   RETURNS jsonb
   -- Returns: NULL, or { "operationId": text, "payloadFingerprint": text, "restoredSnapshot": NativeBackup }
   ```
3. **`public.debtfree_apply_snapshot_restore(...)`**
   ```sql
   p_operation_id text,
   p_expected_baseline_token text,
   p_payload_fingerprint text,
   p_mode text,                         -- 'merge' | 'replace'
   p_accepted_conflict_ids text[],
   p_kept_current_conflict_ids text[],
   p_snapshot jsonb,                    -- validated NativeBackup
   p_confirm_full_replacement boolean DEFAULT false
   RETURNS jsonb
   -- Returns: { "operationId": text, "payloadFingerprint": text, "restoredSnapshot": NativeBackup }
   ```

---

## 3. Protocol Implementation Guarantees

1. **Owner & Household Integrity:**
   - `auth.uid()` is the sole source of authentication; no client-provided `userId` or metadata authentication accepted.
   - Household is verified against server `households` and `household_members`.
   - Cross-owner row ID collisions are checked across `debts`, `recurring_bills`, `transactions`, and `reconciliation_anchors` and rejected with `RESTORE_ROW_COLLISION` (`42501`).
2. **Deterministic Locking & Serialized Gate:**
   - Advisory transaction lock taken on 64-bit hash of `(auth.uid(), operation_id)`.
   - Same-operation idempotent receipt check executed immediately before table locks or baseline evaluations.
   - EXCLUSIVE NOWAIT table lock gate acquired in documented order:
     `auth.users`, `public.debts`, `public.debtfree_deleted_debt_ids`, `public.reconciliation_anchors`, `public.recurring_bills`, `public.transactions`, `public.debtfree_restore_receipts`.
   - Returns retryable `RESTORE_BUSY` (`55P03`) on conflicting lock.
3. **Settings CAS Compliance:**
   - Sets transaction-local `debtfree.settings_rpc_cas = 'on'`.
   - Increments `settingsRevision` by exactly 1, setting server-side `updatedAt`.
   - Strips debts from metadata before storing.
4. **Tombstone & Debt Revision Hardening:**
   - Checks all payload debt IDs against `public.debtfree_deleted_debt_ids` before DML; rejects revival with `RESTORE_TOMBSTONED_DEBT_ID` (`23505`).
   - Updates existing debt accounts in-place, firing the `debtfree_debt_revision` trigger (`version := OLD.version + 1`).
   - Inserts new debt accounts with initial default `version = 1`.
   - Never clears tombstones or suppresses revision guards.
5. **Ledger History Without Balance Delta Replay:**
   - Ledger transactions are inserted directly into `public.transactions` as historical records.
   - Preserves historical dates, cycle fulfillment (`applies_to_date`), soft-deletion marks (`deleted_at`), and allocation amounts.
   - Clears client-only `isPending` state (`false`).
   - Final debt balances are applied directly from snapshot debt records without replaying ledger deltas.
6. **Replace vs. Merge Semantics:**
   - `replace`: requires `p_confirm_full_replacement = true`. Deletes omitted rows in strict dependents-first order: transactions -> reconciliation anchors -> recurring bills -> debts.
   - `merge`: preserves omitted rows, validates that `accepted` and `kept` conflict ID sets are disjoint.

---

## 4. Limitations (Version 1 Scope)

1. **Reconciliation Anchor Coverage Gap:**
   - In accordance with manager clarifications, v1 explicitly rejects backups containing non-empty `coveredTransactionIds` with `RESTORE_UNSUPPORTED_COVERAGE` (`0A000`).
   - Supported relationship `created_adjustment_id` is fully validated and preserved.
2. **Brief Shared Table Serialization:**
   - The EXCLUSIVE NOWAIT table lock gate briefly serializes concurrent writers on these shared tables during restore execution to guarantee atomicity without disabling existing triggers. Ordinary non-locking SELECT queries remain unaffected.
3. **Restore UI Gated:**
   - Native restore UI must remain disabled until this migration is reviewed and executed in an isolated sandbox database.

---

## 5. Isolated Sandbox Acceptance Queries

*The following queries are for evaluation in a designated sandbox PostgreSQL environment (e.g., `bitepxsdujceoszbldhd`). Do not run on production.*

```sql
-- Scenario 1: Verify Baseline Readback and Token Stability
SELECT public.debtfree_read_restore_baseline();
-- Execute twice back-to-back; assert snapshot and baselineToken are identical.

-- Scenario 2: Test Stale Baseline Rejection
-- 1. Read baseline A:
SELECT public.debtfree_read_restore_baseline();
-- 2. Modify a debt record via normal RPC:
-- SELECT public.debtfree_update_debt_atomic(...);
-- 3. Attempt restore with baseline token A; expect RESTORE_BASELINE_STALE (P0001).

-- Scenario 3: Test Tombstoned Debt ID Rejection
-- 1. Delete a debt account via normal RPC (which records tombstone in debtfree_deleted_debt_ids).
-- 2. Attempt restore with payload containing that deleted debt ID; expect RESTORE_TOMBSTONED_DEBT_ID (23505).

-- Scenario 4: Test Idempotent Same-Op Lost Response Recovery
-- 1. Call public.debtfree_apply_snapshot_restore with operation ID 'op-test-1'.
-- 2. Simulate network loss; call public.debtfree_find_restore_receipt('op-test-1').
-- 3. Verify returned restoredSnapshot and client fingerprint match original output.
-- 4. Retry public.debtfree_apply_snapshot_restore with same operation ID and payload; expect original receipt without double mutation.
-- 5. Retry public.debtfree_apply_snapshot_restore with same operation ID but different payload; expect RESTORE_OPERATION_ID_REUSED (23505).
```
