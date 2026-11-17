-- DebtFree Native Forward-only Migration: Security & Performance Advisor Hardening + T-143 Review Fixes
-- Status: UNAPPLIED (Pending explicit database deployment authorization)
-- Purpose:
--   1. Pin `search_path = ''` on `public.debtfree_calculate_tx_delta` (resolves Supabase security lint `0011_function_search_path_mutable`).
--   2. Add an explicit deny-all RLS policy on `public.debtfree_restore_receipts` alongside its existing `REVOKE ALL` (resolves Supabase security lint `0008_rls_enabled_no_policy` while preserving RPC-only access).
--   3. Add covering indexes for the 5 unindexed foreign keys flagged by Supabase performance lint `0001_unindexed_foreign_keys`:
--      - `public.debts(user_id)` (`debts_user_id_fkey`)
--      - `public.household_members(user_id)` (`household_members_user_id_fkey`)
--      - `public.households(created_by)` (`households_created_by_fkey`)
--      - `public.reconciliation_anchors(user_id)` (`reconciliation_anchors_user_id_fkey`)
--      - `public.recurring_bills(credit_account_id)` (`recurring_bills_credit_account_id_fkey`)
--   4. Rewrite the 3 `public.household_profiles` RLS policies to use `(SELECT auth.uid())` so `auth.uid()` is evaluated once per statement rather than per row (resolves Supabase performance lint `0003_auth_rls_initplan`).
--   5. Re-assert least-privilege `REVOKE ALL ... FROM PUBLIC, anon` on `public.debtfree_increment_debt_version()` and drop the retired `public.debtfree_reset_debts_atomic()` function.
--   6. Ensure atomic tombstone cleanup on `auth.users` account deletion by skipping tombstone insertion when the owning `auth.users` row is already being deleted and adding an indexed `ON DELETE CASCADE` foreign key on `public.debtfree_deleted_debt_ids(deleted_user_id)`.
--   7. Scope all `public.transactions` and `public.reconciliation_anchors` pre-checks and `FOR UPDATE` row locks by `user_id = v_uid` in `debtfree_record_transaction_atomic`, `debtfree_update_transaction_atomic`, `debtfree_delete_transaction_atomic`, and `debtfree_reconcile_debt_atomic` so callers cannot lock another user's rows or probe cross-owner record existence.

BEGIN;

-- ============================================================================
-- 1. Pin immutable search_path on debtfree_calculate_tx_delta
-- ============================================================================
CREATE OR REPLACE FUNCTION public.debtfree_calculate_tx_delta(
  p_category text,
  p_debt_category text,
  p_amount numeric(18, 4),
  p_principal_amount numeric(18, 4) DEFAULT NULL
)
RETURNS numeric(18, 4)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_category IN (
    'purchase', 'subscription', 'utilities', 'interest', 'fee',
    'annual_fee', 'interest_adjustment', 'balance_adjustment'
  ) THEN
    RETURN p_amount;
  ELSIF p_category IN ('refund', 'credit_adjustment') THEN
    RETURN - p_amount;
  ELSIF p_category = 'payment' THEN
    IF p_debt_category IN ('Mortgage', 'Auto loan') THEN
      IF p_principal_amount IS NOT NULL THEN
        RETURN - p_principal_amount;
      ELSE
        -- Payment breakdown is unknown. Preserve the payment record without inventing principal reductions.
        RETURN 0;
      END IF;
    ELSE
      -- Revolving card or general loan
      IF p_principal_amount IS NOT NULL THEN
        RETURN - p_principal_amount;
      ELSE
        RETURN - p_amount;
      END IF;
    END IF;
  ELSE
    RETURN 0;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_calculate_tx_delta(text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_calculate_tx_delta(text, text, numeric, numeric) TO authenticated;


-- ============================================================================
-- 2. Explicit deny-all client RLS policy on debtfree_restore_receipts
-- ============================================================================
ALTER TABLE public.debtfree_restore_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.debtfree_restore_receipts FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS debtfree_restore_receipts_no_direct_client_access ON public.debtfree_restore_receipts;
CREATE POLICY debtfree_restore_receipts_no_direct_client_access
  ON public.debtfree_restore_receipts
  AS RESTRICTIVE
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);


-- ============================================================================
-- 3. Covering indexes for unindexed foreign keys (0001_unindexed_foreign_keys)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_debts_user_id
  ON public.debts (user_id);

CREATE INDEX IF NOT EXISTS idx_household_members_user_id
  ON public.household_members (user_id);

CREATE INDEX IF NOT EXISTS idx_households_created_by
  ON public.households (created_by);

CREATE INDEX IF NOT EXISTS idx_reconciliation_anchors_user_id
  ON public.reconciliation_anchors (user_id);

CREATE INDEX IF NOT EXISTS idx_recurring_bills_credit_account_id
  ON public.recurring_bills (credit_account_id);


-- ============================================================================
-- 4. Fix auth_rls_initplan on public.household_profiles policies
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.household_profiles') IS NOT NULL THEN
    ALTER TABLE public.household_profiles ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view their own household profile" ON public.household_profiles;
    CREATE POLICY "Users can view their own household profile"
      ON public.household_profiles
      FOR SELECT
      TO authenticated
      USING (user_id = (SELECT auth.uid()));

    DROP POLICY IF EXISTS "Users can insert their own household profile" ON public.household_profiles;
    CREATE POLICY "Users can insert their own household profile"
      ON public.household_profiles
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = (SELECT auth.uid()));

    DROP POLICY IF EXISTS "Users can update their own household profile" ON public.household_profiles;
    CREATE POLICY "Users can update their own household profile"
      ON public.household_profiles
      FOR UPDATE
      TO authenticated
      USING (user_id = (SELECT auth.uid()))
      WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;
END $$;


-- ============================================================================
-- 5. Least-privilege function grants & retired reset removal
-- ============================================================================
REVOKE ALL ON FUNCTION public.debtfree_increment_debt_version() FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.debtfree_reset_debts_atomic();


-- ============================================================================
-- 6. Atomic tombstone cleanup on auth.users account deletion
-- ============================================================================
-- Remove any orphan tombstones for already-deleted users before adding FK.
DELETE FROM public.debtfree_deleted_debt_ids d
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users u WHERE u.id = d.deleted_user_id
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'debtfree_deleted_debt_ids_deleted_user_id_fkey'
      AND conrelid = 'public.debtfree_deleted_debt_ids'::regclass
  ) THEN
    ALTER TABLE public.debtfree_deleted_debt_ids
      ADD CONSTRAINT debtfree_deleted_debt_ids_deleted_user_id_fkey
      FOREIGN KEY (deleted_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_debtfree_deleted_debt_ids_deleted_user_id
  ON public.debtfree_deleted_debt_ids (deleted_user_id);

-- Only record a deletion tombstone while the owning auth.users account still exists.
-- When auth.users deletes a user, the parent row is removed before ON DELETE CASCADE
-- runs on public.debts, so skipping the tombstone insert allows the cascade on both
-- public.debts and public.debtfree_deleted_debt_ids to complete atomically.
CREATE OR REPLACE FUNCTION public.debtfree_debt_tombstone_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
      INSERT INTO public.debtfree_deleted_debt_ids (id, deleted_user_id)
      VALUES (OLD.id, OLD.user_id)
      ON CONFLICT (id) DO NOTHING;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.debtfree_deleted_debt_ids WHERE id = NEW.id) THEN
      RAISE EXCEPTION 'Deleted debt identity cannot be reused' USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_debt_tombstone_guard() FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 7. Owner-scoped lookups & row locks in financial mutation RPCs (T-143 #1)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.debtfree_record_transaction_atomic(
  p_tx jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_expected_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_tx_id text;
  v_account_id uuid;
  v_amount numeric(18, 4);
  v_principal_amount numeric(18, 4);
  v_interest_amount numeric(18, 4);
  v_escrow_amount numeric(18, 4);
  v_fee_amount numeric(18, 4);
  v_category text;
  v_payee text;
  v_memo text;
  v_date date;
  v_applies_to_date date;
  v_source text;
  v_reconciled boolean;

  v_current_balance numeric(18, 4);
  v_debt_category text;
  v_current_version bigint;
  v_delta numeric(18, 4);
  v_new_balance numeric(18, 4);
  v_new_version bigint;
  v_existing public.transactions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  v_tx_id := COALESCE(p_idempotency_key, p_tx->>'id');
  IF v_tx_id IS NULL OR trim(v_tx_id) = '' THEN
    RAISE EXCEPTION 'Transaction ID or idempotency key is required' USING ERRCODE = '23502';
  END IF;
  IF p_tx->>'id' IS DISTINCT FROM v_tx_id THEN
    RAISE EXCEPTION 'Transaction ID must match the idempotency key' USING ERRCODE = '23514';
  END IF;

  v_category := p_tx->>'category';
  v_amount := (p_tx->>'amount')::numeric;
  v_principal_amount := NULLIF(p_tx->>'principal_amount', '')::numeric;
  v_interest_amount := NULLIF(p_tx->>'interest_amount', '')::numeric;
  v_escrow_amount := NULLIF(p_tx->>'escrow_amount', '')::numeric;
  v_fee_amount := NULLIF(p_tx->>'fee_amount', '')::numeric;
  v_payee := trim(COALESCE(p_tx->>'payee', ''));
  v_memo := p_tx->>'memo';
  v_date := (p_tx->>'date')::date;
  v_applies_to_date := NULLIF(p_tx->>'applies_to_date', '')::date;
  v_source := COALESCE(p_tx->>'source', 'manual');
  v_reconciled := COALESCE((p_tx->>'reconciled')::boolean, false);

  IF NULLIF(trim(COALESCE(p_tx->>'account_id', '')), '') IS NOT NULL THEN
    v_account_id := (p_tx->>'account_id')::uuid;
  END IF;

  IF v_date IS NULL OR v_amount IS NULL OR v_category IS NULL OR v_payee = '' THEN
    RAISE EXCEPTION 'Transaction date, amount, category, and payee are required' USING ERRCODE = '23502';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Transaction amount must be strictly positive' USING ERRCODE = '23514';
  END IF;

  IF (COALESCE(v_principal_amount, 0) < 0 OR COALESCE(v_interest_amount, 0) < 0 OR
      COALESCE(v_escrow_amount, 0) < 0 OR COALESCE(v_fee_amount, 0) < 0) THEN
    RAISE EXCEPTION 'Payment allocation components cannot be negative' USING ERRCODE = '23514';
  END IF;

  IF (COALESCE(v_principal_amount, 0) + COALESCE(v_interest_amount, 0) + COALESCE(v_escrow_amount, 0) + COALESCE(v_fee_amount, 0)) > v_amount THEN
    RAISE EXCEPTION 'Sum of payment allocations exceeds total transaction amount' USING ERRCODE = '23514';
  END IF;

  IF v_category <> 'payment' AND (v_principal_amount IS NOT NULL OR v_interest_amount IS NOT NULL OR v_escrow_amount IS NOT NULL OR v_fee_amount IS NOT NULL) THEN
    RAISE EXCEPTION 'Payment allocations are only permitted on payment transactions' USING ERRCODE = '23514';
  END IF;

  IF v_source NOT IN ('manual', 'recurring_bill', 'reconciliation', 'system') THEN
    RAISE EXCEPTION 'Invalid transaction source' USING ERRCODE = '23514';
  END IF;

  IF v_category NOT IN (
    'purchase', 'subscription', 'utilities', 'interest', 'fee', 'annual_fee',
    'interest_adjustment', 'balance_adjustment', 'payment', 'refund',
    'credit_adjustment', 'debit_bill', 'debit_spending'
  ) THEN
    RAISE EXCEPTION 'Invalid transaction category' USING ERRCODE = '23514';
  END IF;

  IF v_category IN ('debit_bill', 'debit_spending') AND v_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cashflow categories cannot target a debt account' USING ERRCODE = '23514';
  END IF;

  IF v_category NOT IN ('debit_bill', 'debit_spending') AND v_account_id IS NULL THEN
    RAISE EXCEPTION 'Debt transaction requires an account_id' USING ERRCODE = '23502';
  END IF;

  -- Owner-scoped pre-insert idempotency check (never reads another user's rows)
  SELECT * INTO v_existing FROM public.transactions WHERE id = v_tx_id AND user_id = v_uid;
  IF FOUND THEN
    IF v_existing.account_id IS DISTINCT FROM v_account_id OR
       v_existing.date IS DISTINCT FROM v_date OR
       v_existing.applies_to_date IS DISTINCT FROM v_applies_to_date OR
       v_existing.amount IS DISTINCT FROM v_amount OR
       v_existing.category IS DISTINCT FROM v_category OR
       v_existing.payee IS DISTINCT FROM v_payee OR
       v_existing.memo IS DISTINCT FROM v_memo OR
       v_existing.source IS DISTINCT FROM v_source OR
       v_existing.reconciled IS DISTINCT FROM v_reconciled OR
       v_existing.principal_amount IS DISTINCT FROM v_principal_amount OR
       v_existing.interest_amount IS DISTINCT FROM v_interest_amount OR
       v_existing.escrow_amount IS DISTINCT FROM v_escrow_amount OR
       v_existing.fee_amount IS DISTINCT FROM v_fee_amount THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Idempotency key reused with different transaction data' USING ERRCODE = '23505';
    END IF;

    IF v_account_id IS NOT NULL THEN
      SELECT balance, version INTO v_new_balance, v_new_version FROM public.debts WHERE id = v_account_id AND user_id = v_uid;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'idempotent_duplicate',
      'transaction_id', v_tx_id,
      'account_id', v_account_id,
      'new_balance', v_new_balance,
      'new_version', v_new_version,
      'updated_at', v_existing.updated_at
    );
  END IF;

  BEGIN
    IF v_account_id IS NOT NULL THEN
      SELECT balance, category, version INTO v_current_balance, v_debt_category, v_current_version
      FROM public.debts
      WHERE id = v_account_id AND user_id = v_uid FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Debt account not found or access denied' USING ERRCODE = '23503';
      END IF;

      IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'MISSING_REVISION: Expected account revision is required for debt transaction' USING ERRCODE = 'P0002';
      END IF;
      IF v_current_version <> p_expected_version THEN
        RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale debt revision (expected %, current %)', p_expected_version, v_current_version USING ERRCODE = 'P0001';
      END IF;

      v_delta := public.debtfree_calculate_tx_delta(v_category, v_debt_category, v_amount, v_principal_amount);
      v_new_balance := v_current_balance + v_delta;

      UPDATE public.debts
      SET balance = v_new_balance, updated_at = now()
      WHERE id = v_account_id AND user_id = v_uid
      RETURNING version INTO v_new_version;
    END IF;

    INSERT INTO public.transactions (
      id, user_id, account_id, date, applies_to_date, amount, category,
      payee, memo, source, reconciled, created_at, updated_at,
      principal_amount, interest_amount, escrow_amount, fee_amount
    ) VALUES (
      v_tx_id, v_uid, v_account_id, v_date, v_applies_to_date, v_amount,
      v_category, v_payee, v_memo, v_source, v_reconciled, now(), now(),
      v_principal_amount, v_interest_amount, v_escrow_amount, v_fee_amount
    );

  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.transactions WHERE id = v_tx_id AND user_id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Idempotency key conflict or access denied' USING ERRCODE = '23505';
    END IF;

    IF v_existing.account_id IS DISTINCT FROM v_account_id OR
       v_existing.date IS DISTINCT FROM v_date OR
       v_existing.applies_to_date IS DISTINCT FROM v_applies_to_date OR
       v_existing.amount IS DISTINCT FROM v_amount OR
       v_existing.category IS DISTINCT FROM v_category OR
       v_existing.payee IS DISTINCT FROM v_payee OR
       v_existing.memo IS DISTINCT FROM v_memo OR
       v_existing.source IS DISTINCT FROM v_source OR
       v_existing.reconciled IS DISTINCT FROM v_reconciled OR
       v_existing.principal_amount IS DISTINCT FROM v_principal_amount OR
       v_existing.interest_amount IS DISTINCT FROM v_interest_amount OR
       v_existing.escrow_amount IS DISTINCT FROM v_escrow_amount OR
       v_existing.fee_amount IS DISTINCT FROM v_fee_amount THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Concurrent duplicate with conflicting payload' USING ERRCODE = '23505';
    END IF;

    IF v_account_id IS NOT NULL THEN
      SELECT balance, version INTO v_new_balance, v_new_version FROM public.debts WHERE id = v_account_id AND user_id = v_uid;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'idempotent_duplicate',
      'transaction_id', v_tx_id,
      'account_id', v_account_id,
      'new_balance', v_new_balance,
      'new_version', v_new_version,
      'updated_at', v_existing.updated_at
    );
  END;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'recorded',
    'transaction_id', v_tx_id,
    'account_id', v_account_id,
    'new_balance', v_new_balance,
    'new_version', v_new_version,
    'updated_at', timezone('utc', now())
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.debtfree_update_transaction_atomic(
  p_tx jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_expected_version bigint DEFAULT NULL,
  p_expected_old_account_version bigint DEFAULT NULL,
  p_expected_tx_version timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_tx_id text;
  v_old_tx public.transactions%ROWTYPE;
  v_new_account_id uuid;
  v_new_amount numeric(18, 4);
  v_new_principal_amount numeric(18, 4);
  v_new_interest_amount numeric(18, 4);
  v_new_escrow_amount numeric(18, 4);
  v_new_fee_amount numeric(18, 4);
  v_new_category text;
  v_new_payee text;
  v_new_memo text;
  v_new_date date;
  v_new_applies_to_date date;
  v_new_source text;
  v_new_reconciled boolean;
  v_new_deleted_at timestamptz;

  v_first_acc uuid;
  v_second_acc uuid;

  v_old_debt_bal numeric(18, 4);
  v_old_debt_cat text;
  v_old_debt_ver bigint;
  v_old_delta numeric(18, 4) := 0;

  v_new_debt_bal numeric(18, 4);
  v_new_debt_cat text;
  v_new_debt_ver bigint;
  v_new_delta numeric(18, 4) := 0;
  v_updated_at timestamptz := timezone('utc', now());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  v_tx_id := COALESCE(p_idempotency_key, p_tx->>'id');
  IF v_tx_id IS NULL OR trim(v_tx_id) = '' THEN
    RAISE EXCEPTION 'Transaction ID is required' USING ERRCODE = '23502';
  END IF;

  -- Owner-scoped row lock (never locks another user's transaction row)
  SELECT * INTO v_old_tx FROM public.transactions
  WHERE id = v_tx_id AND user_id = v_uid FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found or access denied' USING ERRCODE = '23503';
  END IF;

  IF v_old_tx.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot edit an already deleted or reversed transaction' USING ERRCODE = '23514';
  END IF;

  IF p_expected_tx_version IS NULL THEN
    RAISE EXCEPTION 'MISSING_REVISION: Expected transaction revision is required for transaction update' USING ERRCODE = 'P0002';
  END IF;
  IF v_old_tx.updated_at IS DISTINCT FROM p_expected_tx_version THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale transaction revision (expected %, current %)', p_expected_tx_version, v_old_tx.updated_at USING ERRCODE = 'P0001';
  END IF;

  v_new_category := p_tx->>'category';
  v_new_amount := (p_tx->>'amount')::numeric;
  v_new_principal_amount := NULLIF(p_tx->>'principal_amount', '')::numeric;
  v_new_interest_amount := NULLIF(p_tx->>'interest_amount', '')::numeric;
  v_new_escrow_amount := NULLIF(p_tx->>'escrow_amount', '')::numeric;
  v_new_fee_amount := NULLIF(p_tx->>'fee_amount', '')::numeric;
  v_new_payee := trim(COALESCE(p_tx->>'payee', ''));
  v_new_memo := p_tx->>'memo';
  v_new_date := (p_tx->>'date')::date;
  v_new_applies_to_date := NULLIF(p_tx->>'applies_to_date', '')::date;
  v_new_source := COALESCE(p_tx->>'source', v_old_tx.source);
  v_new_reconciled := COALESCE((p_tx->>'reconciled')::boolean, v_old_tx.reconciled);
  v_new_deleted_at := NULLIF(p_tx->>'deleted_at', '')::timestamptz;

  IF NULLIF(trim(COALESCE(p_tx->>'account_id', '')), '') IS NOT NULL THEN
    v_new_account_id := (p_tx->>'account_id')::uuid;
  END IF;

  IF v_new_date IS NULL OR v_new_amount IS NULL OR v_new_category IS NULL OR v_new_payee = '' THEN
    RAISE EXCEPTION 'Transaction date, amount, category, and payee are required' USING ERRCODE = '23502';
  END IF;

  IF v_new_amount <= 0 THEN
    RAISE EXCEPTION 'Transaction amount must be strictly positive' USING ERRCODE = '23514';
  END IF;

  IF (COALESCE(v_new_principal_amount, 0) < 0 OR COALESCE(v_new_interest_amount, 0) < 0 OR
      COALESCE(v_new_escrow_amount, 0) < 0 OR COALESCE(v_new_fee_amount, 0) < 0) THEN
    RAISE EXCEPTION 'Payment allocation components cannot be negative' USING ERRCODE = '23514';
  END IF;

  IF (COALESCE(v_new_principal_amount, 0) + COALESCE(v_new_interest_amount, 0) + COALESCE(v_new_escrow_amount, 0) + COALESCE(v_new_fee_amount, 0)) > v_new_amount THEN
    RAISE EXCEPTION 'Sum of payment allocations exceeds total transaction amount' USING ERRCODE = '23514';
  END IF;

  IF v_new_category <> 'payment' AND (v_new_principal_amount IS NOT NULL OR v_new_interest_amount IS NOT NULL OR v_new_escrow_amount IS NOT NULL OR v_new_fee_amount IS NOT NULL) THEN
    RAISE EXCEPTION 'Payment allocations are only permitted on payment transactions' USING ERRCODE = '23514';
  END IF;

  IF v_new_source NOT IN ('manual', 'recurring_bill', 'reconciliation', 'system') THEN
    RAISE EXCEPTION 'Invalid transaction source' USING ERRCODE = '23514';
  END IF;

  IF v_new_category NOT IN (
    'purchase', 'subscription', 'utilities', 'interest', 'fee', 'annual_fee',
    'interest_adjustment', 'balance_adjustment', 'payment', 'refund',
    'credit_adjustment', 'debit_bill', 'debit_spending'
  ) THEN
    RAISE EXCEPTION 'Invalid transaction category' USING ERRCODE = '23514';
  END IF;

  IF v_new_category IN ('debit_bill', 'debit_spending') AND v_new_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cashflow categories cannot target a debt account' USING ERRCODE = '23514';
  END IF;

  IF v_new_category NOT IN ('debit_bill', 'debit_spending') AND v_new_account_id IS NULL THEN
    RAISE EXCEPTION 'Debt transaction requires an account_id' USING ERRCODE = '23502';
  END IF;

  IF v_old_tx.account_id IS NOT NULL AND v_new_account_id IS NOT NULL THEN
    IF v_old_tx.account_id = v_new_account_id THEN
      SELECT balance, category, version INTO v_old_debt_bal, v_old_debt_cat, v_old_debt_ver
      FROM public.debts WHERE id = v_old_tx.account_id AND user_id = v_uid FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Debt account not found or access denied' USING ERRCODE = '23503';
      END IF;

      IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'MISSING_REVISION: Expected account revision is required for transaction update' USING ERRCODE = 'P0002';
      END IF;
      IF v_old_debt_ver <> p_expected_version THEN
        RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale debt revision (expected %, current %)', p_expected_version, v_old_debt_ver USING ERRCODE = 'P0001';
      END IF;

      v_new_debt_bal := v_old_debt_bal;
      v_new_debt_cat := v_old_debt_cat;
      v_new_debt_ver := v_old_debt_ver;
    ELSE
      v_first_acc := LEAST(v_old_tx.account_id, v_new_account_id);
      v_second_acc := GREATEST(v_old_tx.account_id, v_new_account_id);

      PERFORM 1 FROM public.debts WHERE id = v_first_acc AND user_id = v_uid FOR UPDATE;
      PERFORM 1 FROM public.debts WHERE id = v_second_acc AND user_id = v_uid FOR UPDATE;

      SELECT balance, category, version INTO v_old_debt_bal, v_old_debt_cat, v_old_debt_ver
      FROM public.debts WHERE id = v_old_tx.account_id AND user_id = v_uid;
      IF NOT FOUND THEN RAISE EXCEPTION 'Original debt account not found or access denied' USING ERRCODE = '23503'; END IF;

      SELECT balance, category, version INTO v_new_debt_bal, v_new_debt_cat, v_new_debt_ver
      FROM public.debts WHERE id = v_new_account_id AND user_id = v_uid;
      IF NOT FOUND THEN RAISE EXCEPTION 'Destination debt account not found or access denied' USING ERRCODE = '23503'; END IF;

      IF p_expected_old_account_version IS NULL THEN
        RAISE EXCEPTION 'MISSING_REVISION: Expected original account revision is required' USING ERRCODE = 'P0002';
      END IF;
      IF v_old_debt_ver <> p_expected_old_account_version THEN
        RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale original debt revision (expected %, current %)', p_expected_old_account_version, v_old_debt_ver USING ERRCODE = 'P0001';
      END IF;

      IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'MISSING_REVISION: Expected destination account revision is required' USING ERRCODE = 'P0002';
      END IF;
      IF v_new_debt_ver <> p_expected_version THEN
        RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale destination debt revision (expected %, current %)', p_expected_version, v_new_debt_ver USING ERRCODE = 'P0001';
      END IF;
    END IF;
  ELSIF v_old_tx.account_id IS NOT NULL THEN
    SELECT balance, category, version INTO v_old_debt_bal, v_old_debt_cat, v_old_debt_ver
    FROM public.debts WHERE id = v_old_tx.account_id AND user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Original debt account not found or access denied' USING ERRCODE = '23503'; END IF;

    IF p_expected_old_account_version IS NULL THEN
      RAISE EXCEPTION 'MISSING_REVISION: Expected original account revision is required' USING ERRCODE = 'P0002';
    END IF;
    IF v_old_debt_ver <> p_expected_old_account_version THEN
      RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale debt revision (expected %, current %)', p_expected_old_account_version, v_old_debt_ver USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_new_account_id IS NOT NULL THEN
    SELECT balance, category, version INTO v_new_debt_bal, v_new_debt_cat, v_new_debt_ver
    FROM public.debts WHERE id = v_new_account_id AND user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Destination debt account not found or access denied' USING ERRCODE = '23503'; END IF;

    IF p_expected_version IS NULL THEN
      RAISE EXCEPTION 'MISSING_REVISION: Expected destination account revision is required' USING ERRCODE = 'P0002';
    END IF;
    IF v_new_debt_ver <> p_expected_version THEN
      RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale debt revision (expected %, current %)', p_expected_version, v_new_debt_ver USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_old_tx.deleted_at IS NULL AND v_old_tx.account_id IS NOT NULL THEN
    v_old_delta := public.debtfree_calculate_tx_delta(v_old_tx.category, v_old_debt_cat, v_old_tx.amount, v_old_tx.principal_amount);
  END IF;

  IF v_new_deleted_at IS NULL AND v_new_account_id IS NOT NULL THEN
    v_new_delta := public.debtfree_calculate_tx_delta(v_new_category, v_new_debt_cat, v_new_amount, v_new_principal_amount);
  END IF;

  IF v_old_tx.account_id IS NOT NULL AND v_new_account_id IS NOT NULL AND v_old_tx.account_id = v_new_account_id THEN
    v_new_debt_bal := v_old_debt_bal - v_old_delta + v_new_delta;
    UPDATE public.debts SET balance = v_new_debt_bal, updated_at = now()
    WHERE id = v_new_account_id AND user_id = v_uid RETURNING version INTO v_new_debt_ver;
    v_old_debt_bal := v_new_debt_bal;
    v_old_debt_ver := v_new_debt_ver;
  ELSE
    IF v_old_tx.account_id IS NOT NULL AND v_old_delta <> 0 THEN
      v_old_debt_bal := v_old_debt_bal - v_old_delta;
      UPDATE public.debts SET balance = v_old_debt_bal, updated_at = now()
      WHERE id = v_old_tx.account_id AND user_id = v_uid RETURNING version INTO v_old_debt_ver;
    END IF;
    IF v_new_account_id IS NOT NULL AND v_new_delta <> 0 THEN
      v_new_debt_bal := v_new_debt_bal + v_new_delta;
      UPDATE public.debts SET balance = v_new_debt_bal, updated_at = now()
      WHERE id = v_new_account_id AND user_id = v_uid RETURNING version INTO v_new_debt_ver;
    END IF;
  END IF;

  UPDATE public.transactions SET
    account_id = v_new_account_id,
    date = v_new_date,
    applies_to_date = v_new_applies_to_date,
    amount = v_new_amount,
    category = v_new_category,
    payee = v_new_payee,
    memo = v_new_memo,
    source = v_new_source,
    reconciled = v_new_reconciled,
    deleted_at = v_new_deleted_at,
    updated_at = v_updated_at,
    principal_amount = v_new_principal_amount,
    interest_amount = v_new_interest_amount,
    escrow_amount = v_new_escrow_amount,
    fee_amount = v_new_fee_amount
  WHERE id = v_tx_id AND user_id = v_uid;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'updated',
    'transaction_id', v_tx_id,
    'account_id', v_new_account_id,
    'new_balance', v_new_debt_bal,
    'new_version', v_new_debt_ver,
    'old_account_id', v_old_tx.account_id,
    'old_balance', v_old_debt_bal,
    'old_version', v_old_debt_ver,
    'updated_at', v_updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.debtfree_delete_transaction_atomic(
  p_tx_id text,
  p_idempotency_key text DEFAULT NULL,
  p_expected_version bigint DEFAULT NULL,
  p_expected_tx_version timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_tx public.transactions%ROWTYPE;
  v_debt_bal numeric(18, 4);
  v_debt_cat text;
  v_debt_ver bigint;
  v_delta numeric(18, 4) := 0;
  v_updated_at timestamptz := timezone('utc', now());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_tx_id IS NULL OR trim(p_tx_id) = '' THEN
    RAISE EXCEPTION 'Transaction ID is required' USING ERRCODE = '23502';
  END IF;

  -- Owner-scoped row lock (never locks another user's transaction row)
  SELECT * INTO v_tx FROM public.transactions
  WHERE id = p_tx_id AND user_id = v_uid FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found or access denied' USING ERRCODE = '23503';
  END IF;

  IF v_tx.deleted_at IS NOT NULL THEN
    IF v_tx.account_id IS NOT NULL THEN
      SELECT balance, version INTO v_debt_bal, v_debt_ver FROM public.debts WHERE id = v_tx.account_id AND user_id = v_uid;
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'status', 'already_deleted',
      'transaction_id', p_tx_id,
      'account_id', v_tx.account_id,
      'new_balance', v_debt_bal,
      'new_version', v_debt_ver
    );
  END IF;

  IF p_expected_tx_version IS NULL THEN
    RAISE EXCEPTION 'MISSING_REVISION: Expected transaction revision is required for transaction deletion' USING ERRCODE = 'P0002';
  END IF;
  IF v_tx.updated_at IS DISTINCT FROM p_expected_tx_version THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale transaction revision (expected %, current %)', p_expected_tx_version, v_tx.updated_at USING ERRCODE = 'P0001';
  END IF;

  IF v_tx.account_id IS NOT NULL THEN
    SELECT balance, category, version INTO v_debt_bal, v_debt_cat, v_debt_ver
    FROM public.debts WHERE id = v_tx.account_id AND user_id = v_uid FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Debt account not found or access denied' USING ERRCODE = '23503';
    END IF;

    IF p_expected_version IS NULL THEN
      RAISE EXCEPTION 'MISSING_REVISION: Expected account revision is required for debt transaction deletion' USING ERRCODE = 'P0002';
    END IF;
    IF v_debt_ver <> p_expected_version THEN
      RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale debt revision (expected %, current %)', p_expected_version, v_debt_ver USING ERRCODE = 'P0001';
    END IF;

    v_delta := public.debtfree_calculate_tx_delta(v_tx.category, v_debt_cat, v_tx.amount, v_tx.principal_amount);
    v_debt_bal := v_debt_bal - v_delta;

    UPDATE public.debts SET balance = v_debt_bal, updated_at = now()
    WHERE id = v_tx.account_id AND user_id = v_uid RETURNING version INTO v_debt_ver;
  END IF;

  UPDATE public.transactions
  SET deleted_at = v_updated_at, updated_at = v_updated_at
  WHERE id = p_tx_id AND user_id = v_uid;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'deleted',
    'transaction_id', p_tx_id,
    'account_id', v_tx.account_id,
    'new_balance', v_debt_bal,
    'new_version', v_debt_ver,
    'updated_at', v_updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.debtfree_reconcile_debt_atomic(
  p_reconciliation jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_account_id uuid;
  v_verified_balance numeric(18, 4);
  v_as_of_date date;
  v_reason text;
  v_anchor_id text;
  v_adjustment_id text;
  v_expected_version bigint;

  v_current_balance numeric(18, 4);
  v_debt_category text;
  v_current_version bigint;
  v_new_version bigint;
  v_drift numeric(18, 4);
  v_adj_category text;
  v_adj_amount numeric(18, 4);
  v_adj_payee text;
  v_existing_anchor public.reconciliation_anchors%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  v_account_id := (p_reconciliation->>'account_id')::uuid;
  v_verified_balance := (p_reconciliation->>'verified_balance')::numeric;
  v_as_of_date := (p_reconciliation->>'as_of_date')::date;
  v_reason := COALESCE(p_reconciliation->>'reason', 'balance_adjustment');
  v_anchor_id := trim(COALESCE(p_reconciliation->>'anchor_id', ''));
  v_adjustment_id := NULLIF(trim(COALESCE(p_reconciliation->>'adjustment_id', '')), '');
  v_expected_version := NULLIF(p_reconciliation->>'expected_version', '')::bigint;

  IF v_account_id IS NULL OR v_verified_balance IS NULL OR v_as_of_date IS NULL OR v_anchor_id = '' THEN
    RAISE EXCEPTION 'Account ID, verified balance, date, and anchor ID are required' USING ERRCODE = '23502';
  END IF;

  IF v_verified_balance < 0 THEN
    RAISE EXCEPTION 'Verified balance cannot be negative' USING ERRCODE = '23514';
  END IF;

  -- Owner-scoped idempotency check (never reads another user's anchor row)
  SELECT * INTO v_existing_anchor FROM public.reconciliation_anchors
  WHERE id = v_anchor_id AND user_id = v_uid;

  IF FOUND THEN
    IF v_existing_anchor.account_id IS DISTINCT FROM v_account_id OR
       v_existing_anchor.verified_balance IS DISTINCT FROM v_verified_balance OR
       v_existing_anchor.as_of_date IS DISTINCT FROM v_as_of_date THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Anchor ID reused with different reconciliation data' USING ERRCODE = '23505';
    END IF;

    SELECT balance, version INTO v_current_balance, v_current_version FROM public.debts WHERE id = v_account_id AND user_id = v_uid;
    RETURN jsonb_build_object(
      'success', true,
      'status', 'idempotent_duplicate',
      'anchor_id', v_anchor_id,
      'new_balance', v_current_balance,
      'new_version', v_current_version
    );
  END IF;

  SELECT balance, category, version INTO v_current_balance, v_debt_category, v_current_version
  FROM public.debts WHERE id = v_account_id AND user_id = v_uid FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debt account not found or access denied' USING ERRCODE = '23503';
  END IF;

  IF v_expected_version IS NULL THEN
    RAISE EXCEPTION 'MISSING_REVISION: Expected account revision is required for reconciliation' USING ERRCODE = 'P0002';
  END IF;
  IF v_current_version <> v_expected_version THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale debt revision (expected %, current %)', v_expected_version, v_current_version USING ERRCODE = 'P0001';
  END IF;

  v_drift := v_verified_balance - v_current_balance;

  BEGIN
    IF v_drift <> 0 THEN
      IF v_adjustment_id IS NULL THEN
        v_adjustment_id := 'adj:' || gen_random_uuid()::text;
      END IF;

      IF v_drift > 0 THEN
        v_adj_category := CASE WHEN v_reason = 'interest_adjustment' THEN 'interest_adjustment' ELSE 'balance_adjustment' END;
        v_adj_amount := v_drift;
        v_adj_payee := CASE WHEN v_reason = 'interest_adjustment' THEN 'Interest reconciliation adjustment' ELSE 'Statement balance reconciliation' END;
      ELSE
        v_adj_category := 'credit_adjustment';
        v_adj_amount := ABS(v_drift);
        v_adj_payee := 'Reconciliation credit adjustment';
      END IF;

      INSERT INTO public.transactions (
        id, user_id, account_id, date, amount, category, payee, memo,
        source, reconciled, created_at, updated_at
      ) VALUES (
        v_adjustment_id, v_uid, v_account_id, v_as_of_date, v_adj_amount, v_adj_category,
        v_adj_payee, 'Reconciliation adjustment', 'reconciliation', true, now(), now()
      );
    END IF;

    INSERT INTO public.reconciliation_anchors (
      id, user_id, account_id, as_of_date, verified_balance, note, created_adjustment_id, created_at
    ) VALUES (
      v_anchor_id, v_uid, v_account_id, v_as_of_date, v_verified_balance, v_reason, v_adjustment_id, now()
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Anchor or adjustment ID conflict or access denied' USING ERRCODE = '23505';
  END;

  UPDATE public.debts
  SET balance = v_verified_balance, updated_at = now()
  WHERE id = v_account_id AND user_id = v_uid
  RETURNING version INTO v_new_version;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'reconciled',
    'anchor_id', v_anchor_id,
    'account_id', v_account_id,
    'adjustment_id', v_adjustment_id,
    'new_balance', v_verified_balance,
    'new_version', v_new_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_record_transaction_atomic(jsonb, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_record_transaction_atomic(jsonb, text, bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_update_transaction_atomic(jsonb, text, bigint, bigint, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_update_transaction_atomic(jsonb, text, bigint, bigint, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_delete_transaction_atomic(text, text, bigint, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_delete_transaction_atomic(text, text, bigint, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_reconcile_debt_atomic(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_reconcile_debt_atomic(jsonb) TO authenticated;

COMMIT;
