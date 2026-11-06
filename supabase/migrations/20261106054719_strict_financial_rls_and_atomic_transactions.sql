-- DebtFree Native Migration: Strict Financial RLS Isolation and Atomic Financial Transactions
-- FOR SANDBOX REVIEW ONLY. Forward-only migration. Do not apply automatically.
-- Prerequisites: 20261105081000_secure_household_debts.sql and 20261105110000_transactions_bills_reconciliation.sql

BEGIN;

-- ============================================================================
-- 1. Tighten RLS on public.transactions
-- ============================================================================
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transactions_owner_isolation ON public.transactions;
DROP POLICY IF EXISTS transactions_user_select ON public.transactions;
DROP POLICY IF EXISTS transactions_user_insert ON public.transactions;
DROP POLICY IF EXISTS transactions_user_update ON public.transactions;
DROP POLICY IF EXISTS transactions_user_delete ON public.transactions;

CREATE POLICY transactions_user_select ON public.transactions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY transactions_user_insert ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid()) AND (
      account_id IS NULL OR EXISTS (
        SELECT 1 FROM public.debts d
        WHERE d.id = transactions.account_id AND d.user_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY transactions_user_update ON public.transactions
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid()) AND (
      account_id IS NULL OR EXISTS (
        SELECT 1 FROM public.debts d
        WHERE d.id = transactions.account_id AND d.user_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY transactions_user_delete ON public.transactions
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));


-- ============================================================================
-- 2. Tighten RLS on public.recurring_bills
-- ============================================================================
ALTER TABLE public.recurring_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recurring_bills_owner_isolation ON public.recurring_bills;
DROP POLICY IF EXISTS recurring_bills_user_select ON public.recurring_bills;
DROP POLICY IF EXISTS recurring_bills_user_insert ON public.recurring_bills;
DROP POLICY IF EXISTS recurring_bills_user_update ON public.recurring_bills;
DROP POLICY IF EXISTS recurring_bills_user_delete ON public.recurring_bills;

CREATE POLICY recurring_bills_user_select ON public.recurring_bills
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY recurring_bills_user_insert ON public.recurring_bills
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid()) AND (
      credit_account_id IS NULL OR EXISTS (
        SELECT 1 FROM public.debts d
        WHERE d.id = recurring_bills.credit_account_id AND d.user_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY recurring_bills_user_update ON public.recurring_bills
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid()) AND (
      credit_account_id IS NULL OR EXISTS (
        SELECT 1 FROM public.debts d
        WHERE d.id = recurring_bills.credit_account_id AND d.user_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY recurring_bills_user_delete ON public.recurring_bills
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));


-- ============================================================================
-- 3. Tighten RLS on public.reconciliation_anchors
-- ============================================================================
ALTER TABLE public.reconciliation_anchors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reconciliation_anchors_owner_isolation ON public.reconciliation_anchors;
DROP POLICY IF EXISTS reconciliation_anchors_user_select ON public.reconciliation_anchors;
DROP POLICY IF EXISTS reconciliation_anchors_user_insert ON public.reconciliation_anchors;
DROP POLICY IF EXISTS reconciliation_anchors_user_update ON public.reconciliation_anchors;
DROP POLICY IF EXISTS reconciliation_anchors_user_delete ON public.reconciliation_anchors;

CREATE POLICY reconciliation_anchors_user_select ON public.reconciliation_anchors
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY reconciliation_anchors_user_insert ON public.reconciliation_anchors
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.debts d
      WHERE d.id = reconciliation_anchors.account_id AND d.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY reconciliation_anchors_user_update ON public.reconciliation_anchors
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.debts d
      WHERE d.id = reconciliation_anchors.account_id AND d.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY reconciliation_anchors_user_delete ON public.reconciliation_anchors
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));


-- ============================================================================
-- 4. Atomic Financial Transaction Recording & Debt Adjustment RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.debtfree_record_transaction_atomic(
  p_tx jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_tx_id text;
  v_account_id uuid;
  v_amount numeric(18, 4);
  v_category text;
  v_payee text;
  v_memo text;
  v_date date;
  v_source text;
  v_reconciled boolean;
  v_current_balance numeric(18, 4);
  v_new_balance numeric(18, 4);
  v_existing_id text;
BEGIN
  -- 1. Ensure authenticated caller
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  -- 2. Extract transaction fields
  v_tx_id := COALESCE(p_idempotency_key, p_tx->>'id');
  IF v_tx_id IS NULL OR trim(v_tx_id) = '' THEN
    RAISE EXCEPTION 'Transaction ID or idempotency key is required' USING ERRCODE = '23502';
  END IF;

  -- Check if already processed (Idempotency check)
  SELECT id INTO v_existing_id
  FROM public.transactions
  WHERE id = v_tx_id AND user_id = v_uid;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'idempotent_duplicate',
      'transaction_id', v_existing_id
    );
  END IF;

  v_category := p_tx->>'category';
  v_amount := (p_tx->>'amount')::numeric;
  v_payee := trim(COALESCE(p_tx->>'payee', ''));
  v_memo := p_tx->>'memo';
  v_date := (p_tx->>'date')::date;
  v_source := COALESCE(p_tx->>'source', 'manual');
  v_reconciled := COALESCE((p_tx->>'reconciled')::boolean, false);

  IF p_tx->>'account_id' IS NOT NULL AND trim(p_tx->>'account_id') <> '' THEN
    v_account_id := (p_tx->>'account_id')::uuid;
  ELSE
    v_account_id := NULL;
  END IF;

  -- Invariant checks
  IF v_amount < 0 THEN
    RAISE EXCEPTION 'Transaction amount must be non-negative' USING ERRCODE = '23514';
  END IF;

  IF v_category IN ('debit_bill', 'debit_spending') AND v_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cashflow categories cannot target a debt account' USING ERRCODE = '23514';
  END IF;

  IF v_category NOT IN ('debit_bill', 'debit_spending') AND v_account_id IS NULL THEN
    RAISE EXCEPTION 'Debt transaction requires an account_id' USING ERRCODE = '23514';
  END IF;

  -- 3. If targeting a debt account, lock and update atomically
  IF v_account_id IS NOT NULL THEN
    SELECT balance INTO v_current_balance
    FROM public.debts
    WHERE id = v_account_id AND user_id = v_uid
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Debt account not found or access denied' USING ERRCODE = '23503';
    END IF;

    IF v_category IN (
      'purchase', 'subscription', 'utilities', 'interest',
      'fee', 'annual_fee', 'interest_adjustment', 'balance_adjustment'
    ) THEN
      v_new_balance := v_current_balance + v_amount;
    ELSIF v_category IN ('payment', 'refund', 'credit_adjustment') THEN
      v_new_balance := v_current_balance - v_amount;
    ELSE
      v_new_balance := v_current_balance;
    END IF;

    UPDATE public.debts
    SET balance = v_new_balance,
        updated_at = now()
    WHERE id = v_account_id AND user_id = v_uid;
  END IF;

  -- 4. Insert transaction ledger entry
  INSERT INTO public.transactions (
    id,
    user_id,
    account_id,
    date,
    amount,
    category,
    payee,
    memo,
    source,
    reconciled,
    created_at
  ) VALUES (
    v_tx_id,
    v_uid,
    v_account_id,
    v_date,
    v_amount,
    v_category,
    v_payee,
    v_memo,
    v_source,
    v_reconciled,
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'recorded',
    'transaction_id', v_tx_id,
    'account_id', v_account_id,
    'new_balance', v_new_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_record_transaction_atomic(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_record_transaction_atomic(jsonb, text) TO authenticated;

COMMIT;
