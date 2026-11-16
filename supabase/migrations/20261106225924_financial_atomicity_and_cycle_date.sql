-- Forward-only financial integrity correction. Reviewed locally; do not apply remotely.
BEGIN;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS applies_to_date date;

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
  v_uid uuid := (SELECT auth.uid());
  v_tx_id text;
  v_account_id uuid;
  v_amount numeric(18, 4);
  v_category text;
  v_payee text;
  v_memo text;
  v_date date;
  v_applies_to_date date;
  v_source text;
  v_reconciled boolean;
  v_current_balance numeric(18, 4);
  v_new_balance numeric(18, 4);
  v_new_version bigint;
  v_existing public.transactions%ROWTYPE;
  v_row_count integer;
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
  IF v_amount < 0 THEN
    RAISE EXCEPTION 'Transaction amount must be non-negative' USING ERRCODE = '23514';
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

  SELECT * INTO v_existing FROM public.transactions
  WHERE id = v_tx_id AND user_id = v_uid;
  IF FOUND THEN
    IF v_existing.account_id IS DISTINCT FROM v_account_id OR v_existing.date IS DISTINCT FROM v_date OR
       v_existing.applies_to_date IS DISTINCT FROM v_applies_to_date OR v_existing.amount IS DISTINCT FROM v_amount OR
       v_existing.category IS DISTINCT FROM v_category OR v_existing.payee IS DISTINCT FROM v_payee OR
       v_existing.memo IS DISTINCT FROM v_memo OR v_existing.source IS DISTINCT FROM v_source OR
       v_existing.reconciled IS DISTINCT FROM v_reconciled THEN
      RAISE EXCEPTION 'Idempotency key reused with different transaction data' USING ERRCODE = '23505';
    END IF;
    IF v_account_id IS NOT NULL THEN
      SELECT balance, version INTO v_new_balance, v_new_version FROM public.debts WHERE id = v_account_id AND user_id = v_uid;
    END IF;
    RETURN jsonb_build_object('success', true, 'status', 'idempotent_duplicate', 'transaction_id', v_tx_id, 'new_balance', v_new_balance, 'new_version', v_new_version);
  END IF;

  -- All balance mutation and ledger insertion is inside this block. A concurrent
  -- duplicate's unique violation rolls the block back before we acknowledge it.
  BEGIN
    IF v_account_id IS NOT NULL THEN
      SELECT balance INTO v_current_balance FROM public.debts
      WHERE id = v_account_id AND user_id = v_uid FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Debt account not found or access denied' USING ERRCODE = '23503';
      END IF;
      IF v_category IN ('purchase', 'subscription', 'utilities', 'interest', 'fee', 'annual_fee', 'interest_adjustment', 'balance_adjustment') THEN
        v_new_balance := v_current_balance + v_amount;
      ELSIF v_category IN ('payment', 'refund', 'credit_adjustment') THEN
        v_new_balance := v_current_balance - v_amount;
      ELSE
        v_new_balance := v_current_balance;
      END IF;
      UPDATE public.debts SET balance = v_new_balance, updated_at = now()
      WHERE id = v_account_id AND user_id = v_uid RETURNING version INTO v_new_version;
    END IF;

    INSERT INTO public.transactions (
      id, user_id, account_id, date, applies_to_date, amount, category,
      payee, memo, source, reconciled, created_at
    ) VALUES (
      v_tx_id, v_uid, v_account_id, v_date, v_applies_to_date, v_amount,
      v_category, v_payee, v_memo, v_source, v_reconciled, now()
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.transactions WHERE id = v_tx_id AND user_id = v_uid;
    IF NOT FOUND OR v_existing.account_id IS DISTINCT FROM v_account_id OR v_existing.date IS DISTINCT FROM v_date OR
       v_existing.applies_to_date IS DISTINCT FROM v_applies_to_date OR v_existing.amount IS DISTINCT FROM v_amount OR
       v_existing.category IS DISTINCT FROM v_category OR v_existing.payee IS DISTINCT FROM v_payee OR
       v_existing.memo IS DISTINCT FROM v_memo OR v_existing.source IS DISTINCT FROM v_source OR
       v_existing.reconciled IS DISTINCT FROM v_reconciled THEN
      RAISE EXCEPTION 'Idempotency key conflict' USING ERRCODE = '23505';
    END IF;
    IF v_account_id IS NOT NULL THEN
      SELECT balance, version INTO v_new_balance, v_new_version FROM public.debts WHERE id = v_account_id AND user_id = v_uid;
    END IF;
    RETURN jsonb_build_object('success', true, 'status', 'idempotent_duplicate', 'transaction_id', v_tx_id, 'new_balance', v_new_balance, 'new_version', v_new_version);
  END;

  RETURN jsonb_build_object(
    'success', true, 'status', 'recorded', 'transaction_id', v_tx_id,
    'account_id', v_account_id, 'new_balance', v_new_balance, 'new_version', v_new_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_record_transaction_atomic(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_record_transaction_atomic(jsonb, text) TO authenticated;
COMMIT;
