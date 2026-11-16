BEGIN;

-- Shared per-user transaction mutex; all callers derive identity from verified auth context.
CREATE OR REPLACE FUNCTION public.debtfree_lock_financial_user() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('debtfree.financial:' || v_uid::text, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_lock_financial_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.debtfree_lock_financial_statement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  -- Auth service cascades may have no end-user JWT. RLS blocks anonymous
  -- writes; privileged account deletion must still be able to cascade.
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  PERFORM public.debtfree_lock_financial_user();
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_lock_financial_statement() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER debtfree_financial_mutex BEFORE INSERT OR UPDATE OR DELETE ON public.debts FOR EACH STATEMENT EXECUTE FUNCTION public.debtfree_lock_financial_statement();
CREATE TRIGGER debtfree_financial_mutex BEFORE INSERT OR UPDATE OR DELETE ON public.recurring_bills FOR EACH STATEMENT EXECUTE FUNCTION public.debtfree_lock_financial_statement();

-- Current definition from 20261106054705_settings_cas_and_tombstone_hardening.sql
CREATE OR REPLACE FUNCTION public.debtfree_save_settings(
  p_expected_revision bigint, p_settings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid;
  previous_revision bigint;
  previous_profile jsonb;
  normalized jsonb;
BEGIN
  PERFORM public.debtfree_lock_financial_user();
  current_user_id := (SELECT auth.uid());
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_expected_revision >= 9223372036854775806
     OR p_settings IS NULL OR pg_catalog.jsonb_typeof(p_settings) <> 'object'
     OR p_settings ->> 'userId' IS DISTINCT FROM current_user_id::text
     OR p_settings ->> 'version' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Invalid DebtFree settings payload' USING ERRCODE = '22023';
  END IF;
  SELECT raw_user_meta_data -> 'debtfree_native_v1',
         public.debtfree_settings_revision(raw_user_meta_data -> 'debtfree_native_v1')
    INTO previous_profile, previous_revision FROM auth.users
    WHERE id = current_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF previous_profile ? 'householdId' AND
     previous_profile ->> 'householdId' IS DISTINCT FROM p_settings ->> 'householdId' THEN
    RAISE EXCEPTION 'Saved household ownership cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF previous_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'DEBTFREE_SETTINGS_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  normalized := pg_catalog.jsonb_set(
    (p_settings - 'settingsRevision' - 'debts') || '{"debts":[]}'::jsonb,
    '{settingsRevision}', pg_catalog.to_jsonb(previous_revision + 1), true
  );
  PERFORM pg_catalog.set_config('debtfree.settings_rpc_cas', 'on', true);
  UPDATE auth.users SET raw_user_meta_data = pg_catalog.jsonb_set(
    COALESCE(raw_user_meta_data, '{}'::jsonb), '{debtfree_native_v1}', normalized, true
  ) WHERE id = current_user_id;
  PERFORM pg_catalog.set_config('debtfree.settings_rpc_cas', 'off', true);
  RETURN normalized;
END;
$$;

-- Current definition from 20261106054705_settings_cas_and_tombstone_hardening.sql
CREATE OR REPLACE FUNCTION public.debtfree_guard_settings_revision()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_profile jsonb;
  new_profile jsonb;
  before_revision bigint;
  after_revision bigint;
BEGIN
  old_profile := OLD.raw_user_meta_data -> 'debtfree_native_v1';
  new_profile := NEW.raw_user_meta_data -> 'debtfree_native_v1';
  IF new_profile IS NOT DISTINCT FROM old_profile THEN RETURN NEW; END IF;
  IF new_profile IS NULL OR jsonb_typeof(new_profile) <> 'object' THEN
    RAISE EXCEPTION 'DEBTFREE_SETTINGS_PROTECTED' USING ERRCODE = '23514';
  END IF;
  before_revision := public.debtfree_settings_revision(old_profile);
  after_revision := public.debtfree_settings_revision(new_profile);
  IF before_revision >= 9223372036854775806 THEN
    RAISE EXCEPTION 'Settings revision exhausted' USING ERRCODE = '22003';
  END IF;
  IF pg_catalog.current_setting('debtfree.settings_rpc_cas', true) = 'on' THEN
    IF after_revision <> before_revision + 1 THEN
      RAISE EXCEPTION 'DEBTFREE_SETTINGS_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'DEBTFREE_SETTINGS_PROTECTED: use atomic settings RPC' USING ERRCODE = '23514';
END;
$$;

-- Current definition from 20261111194422_security_and_performance_hardening.sql
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
  PERFORM public.debtfree_lock_financial_user();
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

-- Current definition from 20261111194422_security_and_performance_hardening.sql
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
  PERFORM public.debtfree_lock_financial_user();
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

-- Current definition from 20261111194422_security_and_performance_hardening.sql
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
  PERFORM public.debtfree_lock_financial_user();
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

-- Current definition from 20261111194422_security_and_performance_hardening.sql
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
  PERFORM public.debtfree_lock_financial_user();
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

-- Current definition from 20261111194453_annual_card_fee_support.sql
CREATE OR REPLACE FUNCTION public.debtfree_update_debt_atomic(
  p_debt jsonb,
  p_expected_version bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_row public.debts%ROWTYPE;
  v_new public.debts%ROWTYPE;
  v_name text;
  v_category text;
  v_balance numeric;
  v_apr numeric;
  v_minimum numeric;
  v_original numeric;
  v_limit numeric;
  v_due integer;
  v_annual_fee numeric;
  v_annual_fee_next_due date;
BEGIN
  PERFORM public.debtfree_lock_financial_user();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_expected_version IS NULL THEN
    RAISE EXCEPTION 'MISSING_REVISION: Expected debt version is required' USING ERRCODE = 'P0002';
  END IF;
  v_id := (p_debt->>'id')::uuid;
  IF v_id IS NULL OR (p_debt->>'user_id')::uuid IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Debt owner or ID is invalid' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.debts
  WHERE id = v_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debt not found or access denied' USING ERRCODE = '23503';
  END IF;
  IF v_row.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale debt revision' USING ERRCODE = 'P0001';
  END IF;
  v_name := trim(COALESCE(p_debt->>'name', ''));
  v_category := trim(COALESCE(p_debt->>'category', ''));
  v_balance := (p_debt->>'balance')::numeric;
  v_apr := (p_debt->>'apr')::numeric;
  v_minimum := (p_debt->>'minimum_payment')::numeric;
  v_original := NULLIF(p_debt->>'original_balance', '')::numeric;
  v_limit := NULLIF(p_debt->>'credit_limit', '')::numeric;
  v_due := NULLIF(p_debt->>'due_day', '')::integer;
  v_annual_fee := NULLIF(p_debt->>'annual_fee_amount', '')::numeric(18, 4);
  v_annual_fee_next_due := NULLIF(p_debt->>'annual_fee_next_due_date', '')::date;
  IF v_name = '' OR v_category NOT IN ('Mortgage', 'Auto loan', 'Credit card', 'Personal loan', 'Student loan', 'Medical debt', 'Other loan')
    OR v_balance IS NULL OR v_apr IS NULL OR NOT (v_apr BETWEEN 0 AND 100)
    OR v_minimum IS NULL OR v_minimum < 0 OR (v_balance > 0 AND v_minimum = 0) OR (v_original IS NOT NULL AND v_original < 0)
    OR (v_limit IS NOT NULL AND v_limit < 0) OR (v_due IS NOT NULL AND NOT (v_due BETWEEN 1 AND 31))
    OR ((v_annual_fee IS NULL) AND (v_annual_fee_next_due IS NOT NULL))
    OR ((v_annual_fee IS NOT NULL) AND (v_annual_fee_next_due IS NULL OR v_annual_fee <= 0 OR v_category <> 'Credit card')) THEN
    RAISE EXCEPTION 'Debt edit contains invalid financial fields' USING ERRCODE = '23514';
  END IF;
  UPDATE public.debts SET
    name = v_name, category = v_category, balance = v_balance, apr = v_apr,
    minimum_payment = v_minimum, original_balance = v_original,
    credit_limit = v_limit, due_day = v_due, annual_fee_amount = v_annual_fee,
    annual_fee_next_due_date = v_annual_fee_next_due, updated_at = now()
  WHERE id = v_id AND user_id = v_uid
  RETURNING * INTO v_new;
  RETURN to_jsonb(v_new);
END;
$$;

-- Current definition from 20261106225938_phase1_rpc_only_financial_writes.sql
CREATE OR REPLACE FUNCTION public.debtfree_delete_debt_atomic(
  p_debt_id uuid,
  p_expected_version bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_version bigint;
BEGIN
  PERFORM public.debtfree_lock_financial_user();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF p_expected_version IS NULL THEN
    RAISE EXCEPTION 'MISSING_REVISION: Expected debt version is required' USING ERRCODE = 'P0002';
  END IF;
  SELECT version INTO v_version FROM public.debts
    WHERE id = p_debt_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Debt not found or access denied' USING ERRCODE = '23503'; END IF;
  IF v_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale debt revision' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.debts WHERE id = p_debt_id AND user_id = v_uid;
  RETURN jsonb_build_object('success', true, 'id', p_debt_id);
END;
$$;

-- Current definition from 20261111214957_restore_rekey_bill_split_plans.sql
CREATE OR REPLACE FUNCTION public.debtfree_apply_snapshot_restore(
  p_operation_id text,
  p_expected_baseline_token text,
  p_payload_fingerprint text,
  p_mode text,
  p_accepted_conflict_ids text[],
  p_kept_current_conflict_ids text[],
  p_snapshot jsonb,
  p_confirm_full_replacement boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_lock_key bigint;
  v_rec record;
  v_current_request_identity jsonb;

  -- Server verified state
  v_household record;
  v_household_id text;
  v_currency text;
  v_scale integer;
  v_factor numeric;
  v_current_snapshot record;

  -- Settings CAS
  v_current_profile jsonb;
  v_current_settings_revision bigint;
  v_next_settings_revision bigint;
  v_normalized_settings jsonb;
  v_remapped_split_plans jsonb;

  -- Iterators & elements
  v_elem jsonb;
  v_id text;
  v_uuid uuid;
  v_item_currency text;
  v_minor_units bigint;
  v_amount numeric(18, 4);

  -- Debt variables
  v_debt_name text;
  v_debt_category text;
  v_debt_balance numeric(18, 4);
  v_debt_original numeric(18, 4);
  v_debt_apr numeric(6, 3);
  v_debt_min numeric(18, 4);
  v_debt_due integer;
  v_debt_limit numeric(18, 4);
  v_debt_created timestamptz;
  v_debt_exists boolean;

  -- Bill variables
  v_bill_name text;
  v_bill_cat text;
  v_bill_amount numeric(18, 4);
  v_bill_due integer;
  v_bill_method text;
  v_bill_credit_acct uuid;
  v_bill_autopost boolean;
  v_bill_active boolean;
  v_bill_created timestamptz;

  -- Transaction variables
  v_tx_acct uuid;
  v_tx_date date;
  v_tx_applies date;
  v_tx_amount numeric(18, 4);
  v_tx_cat text;
  v_tx_payee text;
  v_tx_memo text;
  v_tx_source text;
  v_tx_reconciled boolean;
  v_tx_created timestamptz;
  v_tx_deleted timestamptz;
  v_tx_principal numeric(18, 4);
  v_tx_interest numeric(18, 4);
  v_tx_escrow numeric(18, 4);
  v_tx_fee numeric(18, 4);

  -- Anchor variables
  v_anchor_acct uuid;
  v_anchor_date date;
  v_anchor_balance numeric(18, 4);
  v_anchor_note text;
  v_anchor_adj text;
  v_anchor_created timestamptz;

  -- Sets for validation
  v_snapshot_debt_ids text[] := ARRAY[]::text[];
  v_snapshot_tx_ids text[] := ARRAY[]::text[];
  v_seen_ids text[] := ARRAY[]::text[];
  v_conflict_key text;
  v_domain text;
  v_old jsonb;

  -- Owner-scoped identity maps used to rekey imported rows without probing other users' IDs.
  v_debt_id_map jsonb;
  v_bill_id_map jsonb;
  v_tx_id_map jsonb;
  v_remapped_array jsonb;

  -- Result
  v_final_snapshot record;
BEGIN
  PERFORM public.debtfree_lock_financial_user();
  -- --------------------------------------------------------------------------
  -- 1. Authentication & Argument Sanity
  -- --------------------------------------------------------------------------
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_operation_id IS NULL OR trim(p_operation_id) = '' OR length(p_operation_id) > 512 OR p_operation_id <> trim(p_operation_id) THEN
    RAISE EXCEPTION 'RESTORE_INVALID_OPERATION_ID: Operation ID is malformed or exceeds length limit'
      USING ERRCODE = '22023';
  END IF;

  IF p_payload_fingerprint IS NULL OR p_payload_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'RESTORE_INVALID_FINGERPRINT: Payload fingerprint must be a 64-character lowercase hex string'
      USING ERRCODE = '22023';
  END IF;

  IF p_expected_baseline_token IS NULL OR trim(p_expected_baseline_token) = '' OR length(p_expected_baseline_token) > 512 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_BASELINE_TOKEN: Baseline token is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_mode NOT IN ('merge', 'replace') THEN
    RAISE EXCEPTION 'RESTORE_INVALID_MODE: Mode must be merge or replace'
      USING ERRCODE = '22023';
  END IF;

  IF p_mode = 'replace' THEN
    IF p_confirm_full_replacement IS NOT TRUE THEN
      RAISE EXCEPTION 'RESTORE_CONFIRMATION_REQUIRED: Full replacement and omission deletion requires explicit confirmation'
        USING ERRCODE = '22023';
    END IF;
    IF COALESCE(cardinality(p_accepted_conflict_ids), 0) > 0 OR COALESCE(cardinality(p_kept_current_conflict_ids), 0) > 0 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFLICTS: Replacement mode uses full confirmation, not per-conflict choices'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    -- Mode = 'merge'
    IF p_confirm_full_replacement IS TRUE THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFIRMATION: Merge mode does not permit full replacement confirmation'
        USING ERRCODE = '22023';
    END IF;
    -- Validate conflict key sets
    IF p_accepted_conflict_ids IS NULL OR p_kept_current_conflict_ids IS NULL THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFLICTS: Conflict choice arrays are required' USING ERRCODE = '22023';
    END IF;
    IF cardinality(p_accepted_conflict_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_accepted_conflict_ids) AS u(x))
       OR cardinality(p_kept_current_conflict_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_kept_current_conflict_ids) AS u(x)) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFLICTS: Conflict keys must be unique' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_accepted_conflict_ids || p_kept_current_conflict_ids) AS c(key)
      WHERE key !~ '^(onboardingData|debts|recurringBills|transactions|reconciliationAnchors):.+$' OR key <> trim(key) OR length(key)>1024) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFLICTS: Conflict keys must be domain-qualified IDs' USING ERRCODE = '22023';
    END IF;
    IF p_accepted_conflict_ids IS NOT NULL AND p_kept_current_conflict_ids IS NOT NULL THEN
      IF p_accepted_conflict_ids && p_kept_current_conflict_ids THEN
        RAISE EXCEPTION 'RESTORE_CONFLICT_OVERLAP: A conflict key cannot be both accepted and kept'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  IF p_snapshot IS NULL OR pg_catalog.jsonb_typeof(p_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'RESTORE_INVALID_PAYLOAD: Snapshot object is required'
      USING ERRCODE = '22023';
  END IF;

  -- --------------------------------------------------------------------------
  -- 2. Build Canonical Request Identity & Acquire Same-Op Advisory Lock
  -- --------------------------------------------------------------------------
  v_current_request_identity := pg_catalog.jsonb_build_object(
    'userId', v_uid::text,
    'expectedBaselineToken', p_expected_baseline_token,
    'mode', p_mode,
    'acceptedConflictIds', to_jsonb(COALESCE((SELECT array_agg(x ORDER BY x) FROM unnest(p_accepted_conflict_ids) AS x), ARRAY[]::text[])),
    'keptCurrentConflictIds', to_jsonb(COALESCE((SELECT array_agg(x ORDER BY x) FROM unnest(p_kept_current_conflict_ids) AS x), ARRAY[]::text[])),
    'confirmFullReplacement', COALESCE(p_confirm_full_replacement, false),
    'snapshot', p_snapshot
  );

  v_lock_key := ('x' || substr(md5(v_uid::text || ':' || p_operation_id), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Check existing receipt for this operation ID immediately after advisory lock
  SELECT operation_id, client_payload_fingerprint, request_identity, restored_snapshot
  INTO v_rec
  FROM public.debtfree_restore_receipts
  WHERE owner_user_id = v_uid AND operation_id = p_operation_id;

  IF FOUND THEN
    IF v_rec.request_identity = v_current_request_identity AND v_rec.client_payload_fingerprint = p_payload_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object(
        'operationId', p_operation_id,
        'payloadFingerprint', v_rec.client_payload_fingerprint,
        'restoredSnapshot', v_rec.restored_snapshot
      );
    ELSE
      RAISE EXCEPTION 'RESTORE_OPERATION_ID_REUSED: Operation ID is already bound to a different payload'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- --------------------------------------------------------------------------
  -- 3. Acquire Deterministic Global EXCLUSIVE NOWAIT Table Locks
  -- --------------------------------------------------------------------------
  BEGIN
    LOCK TABLE auth.users IN EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.debts IN EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.debtfree_deleted_debt_ids IN EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.reconciliation_anchors IN EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.recurring_bills IN EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.transactions IN EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.debtfree_restore_receipts IN EXCLUSIVE MODE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RAISE EXCEPTION 'RESTORE_BUSY: Conflicting write transaction in progress; retry shortly'
        USING ERRCODE = '55P03';
  END;

  -- Lock caller's auth row
  SELECT raw_user_meta_data INTO v_current_profile
  FROM auth.users
  WHERE id = v_uid FOR UPDATE NOWAIT;

  -- --------------------------------------------------------------------------
  -- 4. Server Household & Currency Verification + Stale Baseline Gate
  -- --------------------------------------------------------------------------
  SELECT * INTO v_household FROM public.debtfree_internal_verify_user_household(v_uid);
  v_household_id := v_household.r_household_id;
  v_currency := v_household.r_currency;
  v_scale := public.debtfree_internal_currency_scale(v_currency);
  v_factor := (10 ^ v_scale)::numeric;

  -- Re-read server snapshot & compute baseline token under the write gate
  SELECT * INTO v_current_snapshot FROM public.debtfree_internal_build_snapshot(v_uid, v_household_id, v_currency);

  IF v_current_snapshot.r_baseline_token IS DISTINCT FROM p_expected_baseline_token THEN
    RAISE EXCEPTION 'RESTORE_BASELINE_STALE: Current database state does not match expected baseline'
      USING ERRCODE = 'P0001';
  END IF;

  -- --------------------------------------------------------------------------
  -- 5. Deep Snapshot Payload Validation
  -- --------------------------------------------------------------------------
  IF p_snapshot ->> 'schema' IS DISTINCT FROM 'debtfree-native-backup'
     OR (p_snapshot ->> 'version')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_PAYLOAD: Unsupported backup schema or version' USING ERRCODE = '22023';
  END IF;

  IF p_snapshot ->> 'userId' IS DISTINCT FROM v_uid::text THEN
    RAISE EXCEPTION 'RESTORE_FOREIGN_OWNER: Backup belongs to a different user' USING ERRCODE = '42501';
  END IF;

  IF p_snapshot ->> 'householdId' IS DISTINCT FROM v_household_id THEN
    RAISE EXCEPTION 'RESTORE_HOUSEHOLD_MISMATCH: Backup belongs to a different household' USING ERRCODE = '42501';
  END IF;

  IF p_snapshot ->> 'currency' IS DISTINCT FROM v_currency THEN
    RAISE EXCEPTION 'RESTORE_CURRENCY_MISMATCH: Backup currency does not match household currency' USING ERRCODE = '22023';
  END IF;

  IF p_snapshot ->> 'exportedAt' IS NULL OR p_snapshot ->> 'exportedAt' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d' THEN
    RAISE EXCEPTION 'RESTORE_INVALID_TIMESTAMP: exportedAt timestamp is malformed' USING ERRCODE = '22023';
  END IF;

  -- Validate onboardingData
  v_elem := p_snapshot -> 'onboardingData';
  IF v_elem IS NULL OR pg_catalog.jsonb_typeof(v_elem) <> 'object'
     OR (v_elem ->> 'version')::integer IS DISTINCT FROM 1
     OR v_elem ->> 'userId' IS DISTINCT FROM v_uid::text
     OR v_elem ->> 'householdId' IS DISTINCT FROM v_household_id THEN
    RAISE EXCEPTION 'RESTORE_INVALID_ONBOARDING: Onboarding profile is missing or invalid' USING ERRCODE = '22023';
  END IF;

  IF v_elem ->> 'currentStage' NOT IN ('welcome','signup_1','signup_2','signup_3','signup_4','onboard_1','onboard_2','onboard_3','onboard_4','onboard_5','home')
     OR v_elem ->> 'countryCode' NOT IN ('US','CA','GB','AU')
     OR v_elem ->> 'primaryPayFrequency' NOT IN ('biweekly','monthly','weekly','twice_monthly')
     OR v_elem ->> 'selectedPlan' NOT IN ('premium','premium_bank_sync')
     OR v_elem ->> 'homeStatus' NOT IN ('Own','Rent','Other')
     OR v_elem ->> 'vehicleStatus' NOT IN ('Finance','Lease','Own','None')
     OR v_elem ->> 'strategy' NOT IN ('snowball','avalanche') THEN
    RAISE EXCEPTION 'RESTORE_INVALID_ONBOARDING_FIELD: Onboarding contains invalid enumeration values' USING ERRCODE = '22023';
  END IF;

  -- Validate Debts Array
  IF p_snapshot -> 'onboardingData' -> 'debts' IS NULL
     OR pg_catalog.jsonb_typeof(p_snapshot -> 'onboardingData' -> 'debts') <> 'array'
     OR pg_catalog.jsonb_array_length(p_snapshot -> 'onboardingData' -> 'debts') > 100000 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_DEBTS: Missing or oversize debts domain' USING ERRCODE = '22023';
  END IF;

  v_seen_ids := ARRAY[]::text[];
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'onboardingData' -> 'debts')
  LOOP
    v_id := v_elem ->> 'id';
    IF v_id IS NULL OR v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'RESTORE_INVALID_DEBT_ID: Debt ID % is not a valid UUID', v_id USING ERRCODE = '22023';
    END IF;
    IF v_id = ANY(v_seen_ids) THEN
      RAISE EXCEPTION 'RESTORE_DUPLICATE_DEBT_ID: Duplicate debt ID % in payload', v_id USING ERRCODE = '22023';
    END IF;
    v_seen_ids := array_append(v_seen_ids, v_id);

    -- Validate Category, APR, Minimum, Balance
    IF v_elem ->> 'category' NOT IN ('Mortgage','Auto loan','Credit card','Personal loan','Student loan','Medical debt','Other loan') THEN
      RAISE EXCEPTION 'RESTORE_INVALID_DEBT_CATEGORY: Debt category % is unsupported', v_elem ->> 'category' USING ERRCODE = '22023';
    END IF;
    IF (v_elem ->> 'apr')::numeric < 0 OR (v_elem ->> 'apr')::numeric > 100 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_APR: APR % out of valid range 0..100', v_elem ->> 'apr' USING ERRCODE = '22023';
    END IF;
    IF (v_elem ->> 'minimumPayment')::numeric < 0 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_MINIMUM: Negative minimum payment on debt %', v_id USING ERRCODE = '22023';
    END IF;
    IF v_elem ? 'dueDay' AND v_elem ->> 'dueDay' IS NOT NULL THEN
      IF (v_elem ->> 'dueDay')::integer < 1 OR (v_elem ->> 'dueDay')::integer > 31 THEN
        RAISE EXCEPTION 'RESTORE_INVALID_DUE_DAY: Invalid due day on debt %', v_id USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
  v_snapshot_debt_ids := v_seen_ids;

  -- Validate Recurring Bills Array
  IF p_snapshot -> 'recurringBills' IS NULL
     OR pg_catalog.jsonb_typeof(p_snapshot -> 'recurringBills') <> 'array'
     OR pg_catalog.jsonb_array_length(p_snapshot -> 'recurringBills') > 100000 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_BILLS: Missing or oversize recurringBills domain' USING ERRCODE = '22023';
  END IF;

  v_seen_ids := ARRAY[]::text[];
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'recurringBills')
  LOOP
    v_id := v_elem ->> 'id';
    IF v_id IS NULL OR trim(v_id) = '' OR length(v_id) > 512 OR v_id <> trim(v_id) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_BILL_ID: Bill ID % is malformed', v_id USING ERRCODE = '22023';
    END IF;
    IF v_id = ANY(v_seen_ids) THEN
      RAISE EXCEPTION 'RESTORE_DUPLICATE_BILL_ID: Duplicate bill ID % in payload', v_id USING ERRCODE = '22023';
    END IF;
    v_seen_ids := array_append(v_seen_ids, v_id);

    IF v_elem ->> 'category' NOT IN ('utilities','subscription','housing','insurance','other_bill') THEN
      RAISE EXCEPTION 'RESTORE_INVALID_BILL_CATEGORY: Recurring bill category % is unsupported', v_elem ->> 'category' USING ERRCODE = '22023';
    END IF;
    IF v_elem ->> 'paymentMethod' NOT IN ('debit','credit') THEN
      RAISE EXCEPTION 'RESTORE_INVALID_BILL_METHOD: Payment method must be debit or credit' USING ERRCODE = '22023';
    END IF;

    v_minor_units := (v_elem -> 'amount' ->> 'minorUnits')::bigint;
    IF v_minor_units IS NULL OR v_minor_units <= 0 OR abs(v_minor_units) > 9007199254740991 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_BILL_AMOUNT: Recurring bill % amount must be positive safe integer', v_id USING ERRCODE = '22023';
    END IF;
    IF v_elem -> 'amount' ->> 'currency' IS DISTINCT FROM v_currency THEN
      RAISE EXCEPTION 'RESTORE_CURRENCY_MISMATCH: Bill % currency differs from %', v_id, v_currency USING ERRCODE = '22023';
    END IF;

    IF (v_elem ->> 'dueDay')::integer < 1 OR (v_elem ->> 'dueDay')::integer > 31 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_BILL_DUEDAY: Bill % dueDay must be between 1 and 31', v_id USING ERRCODE = '22023';
    END IF;

    IF v_elem ->> 'paymentMethod' = 'credit' THEN
      v_id := v_elem ->> 'creditAccountId';
      IF v_id IS NULL OR NOT (v_id = ANY(v_snapshot_debt_ids)) THEN
        RAISE EXCEPTION 'RESTORE_ORPHAN_BILL_ACCOUNT: Credit bill references unknown debt account %', v_id USING ERRCODE = '23503';
      END IF;
    ELSE
      IF v_elem ->> 'creditAccountId' IS NOT NULL THEN
        RAISE EXCEPTION 'RESTORE_INVALID_DEBIT_BILL: Debit bill must not reference credit account' USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  -- Validate Transactions Array
  IF p_snapshot -> 'transactions' IS NULL
     OR pg_catalog.jsonb_typeof(p_snapshot -> 'transactions') <> 'array'
     OR pg_catalog.jsonb_array_length(p_snapshot -> 'transactions') > 100000 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_TRANSACTIONS: Missing or oversize transactions domain' USING ERRCODE = '22023';
  END IF;

  v_seen_ids := ARRAY[]::text[];
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'transactions')
  LOOP
    v_id := v_elem ->> 'id';
    IF v_id IS NULL OR trim(v_id) = '' OR length(v_id) > 512 OR v_id <> trim(v_id) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_TX_ID: Transaction ID % is malformed', v_id USING ERRCODE = '22023';
    END IF;
    IF v_id = ANY(v_seen_ids) THEN
      RAISE EXCEPTION 'RESTORE_DUPLICATE_TX_ID: Duplicate transaction ID % in payload', v_id USING ERRCODE = '22023';
    END IF;
    v_seen_ids := array_append(v_seen_ids, v_id);

    IF v_elem ->> 'accountId' IS NOT NULL AND NOT ((v_elem ->> 'accountId') = ANY(v_snapshot_debt_ids)) THEN
      RAISE EXCEPTION 'RESTORE_ORPHAN_TX_ACCOUNT: Transaction % references unknown debt account %', v_id, v_elem ->> 'accountId' USING ERRCODE = '23503';
    END IF;

    IF v_elem ->> 'category' NOT IN (
      'purchase','subscription','utilities','interest','fee','annual_fee',
      'interest_adjustment','balance_adjustment','payment','refund','credit_adjustment',
      'debit_bill','debit_spending'
    ) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_TX_CATEGORY: Transaction category % is invalid', v_elem ->> 'category' USING ERRCODE = '22023';
    END IF;

    v_minor_units := (v_elem -> 'amount' ->> 'minorUnits')::bigint;
    IF v_minor_units IS NULL OR v_minor_units < 0 OR abs(v_minor_units) > 9007199254740991 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_TX_AMOUNT: Transaction % amount must be non-negative safe integer', v_id USING ERRCODE = '22023';
    END IF;
    IF v_elem -> 'amount' ->> 'currency' IS DISTINCT FROM v_currency THEN
      RAISE EXCEPTION 'RESTORE_CURRENCY_MISMATCH: Transaction % currency differs from %', v_id, v_currency USING ERRCODE = '22023';
    END IF;

    -- Validate Optional Allocations
    FOR v_item_currency IN SELECT unnest(ARRAY['principalAmount','interestAmount','escrowAmount','feeAmount'])
    LOOP
      IF v_elem ? v_item_currency AND v_elem -> v_item_currency IS NOT NULL AND pg_catalog.jsonb_typeof(v_elem -> v_item_currency) = 'object' THEN
        v_minor_units := (v_elem -> v_item_currency ->> 'minorUnits')::bigint;
        IF v_minor_units IS NULL OR v_minor_units < 0 OR abs(v_minor_units) > 9007199254740991 THEN
          RAISE EXCEPTION 'RESTORE_INVALID_ALLOCATION: Allocation % on transaction % must be non-negative safe integer', v_item_currency, v_id USING ERRCODE = '22023';
        END IF;
        IF v_elem -> v_item_currency ->> 'currency' IS DISTINCT FROM v_currency THEN
          RAISE EXCEPTION 'RESTORE_CURRENCY_MISMATCH: Allocation currency on transaction % differs from %', v_id, v_currency USING ERRCODE = '22023';
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  v_snapshot_tx_ids := v_seen_ids;

  -- Validate Reconciliation Anchors Array
  IF p_snapshot -> 'reconciliationAnchors' IS NULL
     OR pg_catalog.jsonb_typeof(p_snapshot -> 'reconciliationAnchors') <> 'array'
     OR pg_catalog.jsonb_array_length(p_snapshot -> 'reconciliationAnchors') > 100000 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_ANCHORS: Missing or oversize reconciliationAnchors domain' USING ERRCODE = '22023';
  END IF;

  v_seen_ids := ARRAY[]::text[];
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'reconciliationAnchors')
  LOOP
    v_id := v_elem ->> 'id';
    IF v_id IS NULL OR trim(v_id) = '' OR length(v_id) > 512 OR v_id <> trim(v_id) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_ANCHOR_ID: Anchor ID % is malformed', v_id USING ERRCODE = '22023';
    END IF;
    IF v_id = ANY(v_seen_ids) THEN
      RAISE EXCEPTION 'RESTORE_DUPLICATE_ANCHOR_ID: Duplicate anchor ID % in payload', v_id USING ERRCODE = '22023';
    END IF;
    v_seen_ids := array_append(v_seen_ids, v_id);

    IF NOT ((v_elem ->> 'accountId') = ANY(v_snapshot_debt_ids)) THEN
      RAISE EXCEPTION 'RESTORE_ORPHAN_ANCHOR_ACCOUNT: Anchor % references unknown debt account %', v_id, v_elem ->> 'accountId' USING ERRCODE = '23503';
    END IF;

    v_minor_units := (v_elem -> 'verifiedBalance' ->> 'minorUnits')::bigint;
    IF v_minor_units IS NULL OR abs(v_minor_units) > 9007199254740991 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_ANCHOR_BALANCE: Anchor % verifiedBalance must be safe integer', v_id USING ERRCODE = '22023';
    END IF;
    IF v_elem -> 'verifiedBalance' ->> 'currency' IS DISTINCT FROM v_currency THEN
      RAISE EXCEPTION 'RESTORE_CURRENCY_MISMATCH: Anchor % currency differs from %', v_id, v_currency USING ERRCODE = '22023';
    END IF;

    -- Created Adjustment Relationship
    IF v_elem ? 'createdAdjustmentId' AND v_elem ->> 'createdAdjustmentId' IS NOT NULL THEN
      v_id := v_elem ->> 'createdAdjustmentId';
      IF NOT (v_id = ANY(v_snapshot_tx_ids)) THEN
        RAISE EXCEPTION 'RESTORE_ORPHAN_ANCHOR_ADJUSTMENT: Anchor references nonexistent adjustment transaction %', v_id USING ERRCODE = '23503';
      END IF;
    END IF;

    -- Explicit Reject of Non-Empty coveredTransactionIds (Protocol v1 limitation)
    IF v_elem ? 'coveredTransactionIds' AND v_elem -> 'coveredTransactionIds' IS NOT NULL THEN
      IF pg_catalog.jsonb_array_length(v_elem -> 'coveredTransactionIds') > 0 THEN
        RAISE EXCEPTION 'RESTORE_UNSUPPORTED_COVERAGE: Non-empty coveredTransactionIds is unsupported in restore v1'
          USING ERRCODE = '0A000';
      END IF;
    END IF;
  END LOOP;

  -- Rekey imported identities that are not already owned by this caller.
  -- This preserves IDs for merge/update of the caller's rows, while new rows,
  -- foreign-ID collisions and IDs retired by another account all receive fresh
  -- IDs. References are rewritten before conflict resolution and any writes.
  -- A caller-owned tombstone remains a hard rejection; the lookup is owner-scoped.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'onboardingData' -> 'debts') AS item(value)
    JOIN public.debtfree_deleted_debt_ids AS tombstone
      ON tombstone.id = (item.value ->> 'id')::uuid
    WHERE tombstone.deleted_user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'RESTORE_TOMBSTONED_DEBT_ID: A deleted debt identity cannot be restored'
      USING ERRCODE = '23505';
  END IF;

  WITH incoming AS MATERIALIZED (
    SELECT item.value,
           item.ordinality,
           item.value ->> 'id' AS old_id,
           CASE WHEN EXISTS (
             SELECT 1 FROM public.debts AS owned
             WHERE owned.id = (item.value ->> 'id')::uuid AND owned.user_id = v_uid
           ) THEN item.value ->> 'id' ELSE pg_catalog.gen_random_uuid()::text END AS new_id
    FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'onboardingData' -> 'debts')
      WITH ORDINALITY AS item(value, ordinality)
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_set(value, ARRAY['id'], pg_catalog.to_jsonb(new_id), false)
           ORDER BY ordinality), '[]'::jsonb),
         COALESCE(pg_catalog.jsonb_object_agg(old_id, new_id), '{}'::jsonb),
         COALESCE(pg_catalog.array_agg(new_id ORDER BY ordinality), ARRAY[]::text[])
  INTO v_remapped_array, v_debt_id_map, v_snapshot_debt_ids
  FROM incoming;
  p_snapshot := pg_catalog.jsonb_set(p_snapshot, ARRAY['onboardingData','debts'], v_remapped_array, false);

  WITH incoming AS MATERIALIZED (
    SELECT item.value,
           item.ordinality,
           item.value ->> 'id' AS old_id,
           CASE WHEN EXISTS (
             SELECT 1 FROM public.recurring_bills AS owned
             WHERE owned.id::text = (item.value ->> 'id') AND owned.user_id = v_uid
           ) THEN item.value ->> 'id' ELSE pg_catalog.gen_random_uuid()::text END AS new_id
    FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'recurringBills')
      WITH ORDINALITY AS item(value, ordinality)
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(
           CASE WHEN value ->> 'creditAccountId' IS NULL THEN
             pg_catalog.jsonb_set(value, ARRAY['id'], pg_catalog.to_jsonb(new_id), false)
           ELSE
             pg_catalog.jsonb_set(
               pg_catalog.jsonb_set(value, ARRAY['id'], pg_catalog.to_jsonb(new_id), false),
               ARRAY['creditAccountId'],
               pg_catalog.to_jsonb(v_debt_id_map ->> (value ->> 'creditAccountId')),
               false
             )
           END
           ORDER BY ordinality), '[]'::jsonb),
         COALESCE(pg_catalog.jsonb_object_agg(old_id, new_id), '{}'::jsonb)
  INTO v_remapped_array, v_bill_id_map
  FROM incoming;
  p_snapshot := pg_catalog.jsonb_set(p_snapshot, ARRAY['recurringBills'], v_remapped_array, false);

  WITH incoming AS MATERIALIZED (
    SELECT item.value,
           item.ordinality,
           item.value ->> 'id' AS old_id,
           CASE WHEN EXISTS (
             SELECT 1 FROM public.transactions AS owned
             WHERE owned.id::text = (item.value ->> 'id') AND owned.user_id = v_uid
           ) THEN item.value ->> 'id' ELSE pg_catalog.gen_random_uuid()::text END AS new_id
    FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'transactions')
      WITH ORDINALITY AS item(value, ordinality)
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(
           CASE WHEN value ->> 'accountId' IS NULL THEN
             pg_catalog.jsonb_set(value, ARRAY['id'], pg_catalog.to_jsonb(new_id), false)
           ELSE
             pg_catalog.jsonb_set(
               pg_catalog.jsonb_set(value, ARRAY['id'], pg_catalog.to_jsonb(new_id), false),
               ARRAY['accountId'],
               pg_catalog.to_jsonb(v_debt_id_map ->> (value ->> 'accountId')),
               false
             )
           END
           ORDER BY ordinality), '[]'::jsonb),
         COALESCE(pg_catalog.jsonb_object_agg(old_id, new_id), '{}'::jsonb),
         COALESCE(pg_catalog.array_agg(new_id ORDER BY ordinality), ARRAY[]::text[])
  INTO v_remapped_array, v_tx_id_map, v_snapshot_tx_ids
  FROM incoming;
  p_snapshot := pg_catalog.jsonb_set(p_snapshot, ARRAY['transactions'], v_remapped_array, false);

  WITH incoming AS MATERIALIZED (
    SELECT item.value,
           item.ordinality,
           CASE WHEN EXISTS (
             SELECT 1 FROM public.reconciliation_anchors AS owned
             WHERE owned.id::text = (item.value ->> 'id') AND owned.user_id = v_uid
           ) THEN item.value ->> 'id' ELSE pg_catalog.gen_random_uuid()::text END AS new_id
    FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'reconciliationAnchors')
      WITH ORDINALITY AS item(value, ordinality)
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(
           CASE WHEN value ->> 'createdAdjustmentId' IS NULL THEN
             pg_catalog.jsonb_set(
               pg_catalog.jsonb_set(value, ARRAY['id'], pg_catalog.to_jsonb(new_id), false),
               ARRAY['accountId'],
               pg_catalog.to_jsonb(v_debt_id_map ->> (value ->> 'accountId')),
               false
             )
           ELSE
             pg_catalog.jsonb_set(
               pg_catalog.jsonb_set(
                 pg_catalog.jsonb_set(value, ARRAY['id'], pg_catalog.to_jsonb(new_id), false),
                 ARRAY['accountId'],
                 pg_catalog.to_jsonb(v_debt_id_map ->> (value ->> 'accountId')),
                 false
               ),
               ARRAY['createdAdjustmentId'],
               pg_catalog.to_jsonb(v_tx_id_map ->> (value ->> 'createdAdjustmentId')),
               false
             )
           END
           ORDER BY ordinality), '[]'::jsonb)
  INTO v_remapped_array
  FROM incoming;
  p_snapshot := pg_catalog.jsonb_set(p_snapshot, ARRAY['reconciliationAnchors'], v_remapped_array, false);
  -- Merge choices are checked against the server baseline before any write.
  -- The resolved payload contains the chosen row, so a changed extant row must
  -- be named accepted; a kept key must resolve byte-for-byte to its baseline row.
  IF p_mode='merge' THEN
    v_conflict_key := 'onboardingData:' || v_uid::text;
    IF ((v_current_snapshot.r_snapshot->'onboardingData') - 'debts'::text - 'settingsRevision'::text - 'updatedAt'::text)
       IS DISTINCT FROM ((p_snapshot->'onboardingData') - 'debts'::text - 'settingsRevision'::text - 'updatedAt'::text) THEN
      IF NOT (v_conflict_key=ANY(p_accepted_conflict_ids)) THEN
        RAISE EXCEPTION 'RESTORE_CONFLICT_CHOICE_REQUIRED: %', v_conflict_key USING ERRCODE='22023';
      END IF;
    ELSIF v_conflict_key=ANY(p_accepted_conflict_ids) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Accepted settings key is not a changed conflict' USING ERRCODE='22023';
    END IF;

    FOREACH v_domain IN ARRAY ARRAY['debts','recurringBills','transactions','reconciliationAnchors'] LOOP
      FOR v_elem IN SELECT value FROM pg_catalog.jsonb_array_elements(
        CASE v_domain WHEN 'debts' THEN v_current_snapshot.r_snapshot->'onboardingData'->'debts'
        ELSE v_current_snapshot.r_snapshot->v_domain END
      ) value
      LOOP
        v_conflict_key := v_domain || ':' || (v_elem->>'id');
        v_old := NULL;
        SELECT value INTO v_old FROM pg_catalog.jsonb_array_elements(
          CASE v_domain WHEN 'debts' THEN p_snapshot->'onboardingData'->'debts'
          ELSE p_snapshot->v_domain END
        ) value WHERE value->>'id'=v_elem->>'id';
        IF v_old IS NOT NULL AND v_old IS DISTINCT FROM v_elem THEN
          IF NOT (v_conflict_key=ANY(p_accepted_conflict_ids)) THEN
            RAISE EXCEPTION 'RESTORE_CONFLICT_CHOICE_REQUIRED: %', v_conflict_key USING ERRCODE='22023';
          END IF;
        ELSIF v_conflict_key=ANY(p_accepted_conflict_ids) THEN
          RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Accepted key is not a changed conflict: %', v_conflict_key USING ERRCODE='22023';
        END IF;
        IF v_conflict_key=ANY(p_kept_current_conflict_ids) AND v_old IS DISTINCT FROM v_elem THEN
          RAISE EXCEPTION 'RESTORE_INVALID_KEPT_ROW: Kept row differs from baseline: %', v_conflict_key USING ERRCODE='22023';
        END IF;
      END LOOP;
    END LOOP;
    FOREACH v_conflict_key IN ARRAY p_accepted_conflict_ids || p_kept_current_conflict_ids LOOP
      IF split_part(v_conflict_key,':',1)='onboardingData' THEN
        IF split_part(v_conflict_key,':',2) IS DISTINCT FROM v_uid::text THEN
          RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Settings conflict key has wrong owner' USING ERRCODE='22023';
        END IF;
      ELSE
        v_domain:=split_part(v_conflict_key,':',1);
        v_id:=substring(v_conflict_key FROM position(':' IN v_conflict_key)+1);
        IF v_domain='debts' THEN
          SELECT value INTO v_elem FROM pg_catalog.jsonb_array_elements(v_current_snapshot.r_snapshot->'onboardingData'->'debts') value WHERE value->>'id'=v_id;
          IF v_elem IS NULL THEN RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Unknown debt conflict key' USING ERRCODE='22023'; END IF;
          SELECT value INTO v_old FROM pg_catalog.jsonb_array_elements(p_snapshot->'onboardingData'->'debts') value WHERE value->>'id'=v_id;
        ELSIF v_domain IN ('recurringBills','transactions','reconciliationAnchors') THEN
          SELECT value INTO v_elem FROM pg_catalog.jsonb_array_elements(v_current_snapshot.r_snapshot->v_domain) value WHERE value->>'id'=v_id;
          IF v_elem IS NULL THEN RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Unknown financial conflict key' USING ERRCODE='22023'; END IF;
          SELECT value INTO v_old FROM pg_catalog.jsonb_array_elements(p_snapshot->v_domain) value WHERE value->>'id'=v_id;
        ELSE
          RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Unknown conflict domain' USING ERRCODE='22023';
        END IF;
        IF v_old IS NULL OR (v_conflict_key=ANY(p_kept_current_conflict_ids) AND v_old IS DISTINCT FROM v_elem) THEN
          RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Conflict key does not resolve to the baseline row' USING ERRCODE='22023';
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- --------------------------------------------------------------------------
  -- 6. Execute Atomic Mutations
  -- --------------------------------------------------------------------------

  -- 6a. Deletion Phase (Replace Mode Only) - Dependents First Order
  IF p_mode = 'replace' THEN
    -- 1. Transactions
    DELETE FROM public.transactions
    WHERE user_id = v_uid AND id NOT IN (
      SELECT elem ->> 'id' FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'transactions') elem
    );

    -- 2. Reconciliation Anchors
    DELETE FROM public.reconciliation_anchors
    WHERE user_id = v_uid AND id NOT IN (
      SELECT elem ->> 'id' FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'reconciliationAnchors') elem
    );

    -- 3. Recurring Bills
    DELETE FROM public.recurring_bills
    WHERE user_id = v_uid AND id NOT IN (
      SELECT elem ->> 'id' FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'recurringBills') elem
    );

    -- 4. Debts (Omitted live debts get deleted & tombstoned by debtfree_debt_tombstone trigger)
    DELETE FROM public.debts
    WHERE user_id = v_uid AND id NOT IN (
      SELECT (elem ->> 'id')::uuid FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'onboardingData' -> 'debts') elem
    );
  END IF;

  -- 6b. Settings Profile CAS Update
  v_current_settings_revision := public.debtfree_settings_revision(v_current_profile -> 'debtfree_native_v1');
  v_next_settings_revision := v_current_settings_revision + 1;

  v_normalized_settings := pg_catalog.jsonb_set(
    ((p_snapshot -> 'onboardingData') - 'settingsRevision'::text - 'debts'::text) || '{"debts":[]}'::jsonb,
    '{settingsRevision}',
    pg_catalog.to_jsonb(v_next_settings_revision),
    true
  );
  -- Split-plan IDs follow the server-generated restore maps. If a plan points
  -- to an omitted/orphaned ID, drop that optional entry; never fail an otherwise
  -- valid restore because optional planning metadata is stale.
  IF pg_catalog.jsonb_typeof(v_normalized_settings -> 'debtPaymentSplitPlansByDebtId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(
      v_debt_id_map ->> plan.key, plan.value
    ) FILTER (WHERE v_debt_id_map ? plan.key), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_normalized_settings -> 'debtPaymentSplitPlansByDebtId') AS plan(key, value);
    v_normalized_settings := pg_catalog.jsonb_set(
      v_normalized_settings,
      '{debtPaymentSplitPlansByDebtId}',
      v_remapped_split_plans,
      true
    );
  END IF;
  IF pg_catalog.jsonb_typeof(v_normalized_settings -> 'billPaymentSplitPlansByBillId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(
      v_bill_id_map ->> plan.key, plan.value
    ) FILTER (WHERE v_bill_id_map ? plan.key), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_normalized_settings -> 'billPaymentSplitPlansByBillId') AS plan(key, value);
    v_normalized_settings := pg_catalog.jsonb_set(
      v_normalized_settings,
      '{billPaymentSplitPlansByBillId}',
      v_remapped_split_plans,
      true
    );
  END IF;
  v_normalized_settings := pg_catalog.jsonb_set(
    v_normalized_settings,
    '{updatedAt}',
    pg_catalog.to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    true
  );

  PERFORM pg_catalog.set_config('debtfree.settings_rpc_cas', 'on', true);

  UPDATE auth.users
  SET raw_user_meta_data = pg_catalog.jsonb_set(
    COALESCE(raw_user_meta_data, '{}'::jsonb),
    '{debtfree_native_v1}',
    v_normalized_settings,
    true
  )
  WHERE id = v_uid;

  -- 6c. Upsert Debts (Existing debts updated in-place to fire version increment; new start at version 1)
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'onboardingData' -> 'debts')
  LOOP
    v_uuid := (v_elem ->> 'id')::uuid;
    v_debt_name := trim(v_elem ->> 'name');
    v_debt_category := v_elem ->> 'category';
    v_debt_balance := (v_elem ->> 'balance')::numeric(18, 4);
    v_debt_original := NULLIF(v_elem ->> 'originalBalance', '')::numeric(18, 4);
    v_debt_apr := (v_elem ->> 'apr')::numeric(6, 3);
    v_debt_min := (v_elem ->> 'minimumPayment')::numeric(18, 4);
    v_debt_due := NULLIF(v_elem ->> 'dueDay', '')::integer;
    v_debt_limit := NULLIF(v_elem ->> 'creditLimit', '')::numeric(18, 4);
    v_debt_created := (v_elem ->> 'createdAt')::timestamptz;

    SELECT EXISTS (SELECT 1 FROM public.debts WHERE id = v_uuid AND user_id = v_uid) INTO v_debt_exists;

    IF v_debt_exists THEN
      -- In-place update triggers debtfree_debt_revision (NEW.version := OLD.version + 1)
      UPDATE public.debts SET
        household_id = v_household_id,
        name = v_debt_name,
        category = v_debt_category,
        balance = v_debt_balance,
        original_balance = v_debt_original,
        apr = v_debt_apr,
        minimum_payment = v_debt_min,
        due_day = v_debt_due,
        credit_limit = v_debt_limit,
        updated_at = now()
      WHERE id = v_uuid AND user_id = v_uid;
    ELSE
      -- New debt inserted with initial version = 1
      INSERT INTO public.debts (
        id, user_id, household_id, name, category, balance,
        original_balance, apr, minimum_payment, due_day, credit_limit,
        created_at, updated_at, version
      ) VALUES (
        v_uuid, v_uid, v_household_id, v_debt_name, v_debt_category, v_debt_balance,
        v_debt_original, v_debt_apr, v_debt_min, v_debt_due, v_debt_limit,
        v_debt_created, now(), 1
      );
    END IF;
  END LOOP;

  -- 6d. Upsert Recurring Bills
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'recurringBills')
  LOOP
    v_id := v_elem ->> 'id';
    v_bill_name := trim(v_elem ->> 'name');
    v_bill_cat := v_elem ->> 'category';
    v_minor_units := (v_elem -> 'amount' ->> 'minorUnits')::bigint;
    v_bill_amount := (v_minor_units::numeric / v_factor)::numeric(18, 4);
    v_bill_due := (v_elem ->> 'dueDay')::integer;
    v_bill_method := v_elem ->> 'paymentMethod';
    v_bill_credit_acct := NULLIF(v_elem ->> 'creditAccountId', '')::uuid;
    v_bill_autopost := COALESCE((v_elem ->> 'autoPost')::boolean, true);
    v_bill_active := COALESCE((v_elem ->> 'active')::boolean, true);
    v_bill_created := (v_elem ->> 'createdAt')::timestamptz;

    INSERT INTO public.recurring_bills (
      id, user_id, household_id, name, category, amount, due_day,
      payment_method, credit_account_id, auto_post, active, created_at, updated_at
    ) VALUES (
      v_id, v_uid, v_household_id, v_bill_name, v_bill_cat, v_bill_amount, v_bill_due,
      v_bill_method, v_bill_credit_acct, v_bill_autopost, v_bill_active, v_bill_created, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      household_id = v_household_id,
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      amount = EXCLUDED.amount,
      due_day = EXCLUDED.due_day,
      payment_method = EXCLUDED.payment_method,
      credit_account_id = EXCLUDED.credit_account_id,
      auto_post = EXCLUDED.auto_post,
      active = EXCLUDED.active,
      updated_at = now()
    WHERE recurring_bills.user_id = v_uid;
  END LOOP;

  -- 6e. Upsert Transactions Ledger (Historical insertion without balance-delta replay)
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'transactions')
  LOOP
    v_id := v_elem ->> 'id';
    v_tx_acct := NULLIF(v_elem ->> 'accountId', '')::uuid;
    v_tx_date := (v_elem ->> 'date')::date;
    v_tx_applies := NULLIF(v_elem ->> 'appliesToDate', '')::date;
    v_minor_units := (v_elem -> 'amount' ->> 'minorUnits')::bigint;
    v_tx_amount := (v_minor_units::numeric / v_factor)::numeric(18, 4);
    v_tx_cat := v_elem ->> 'category';
    v_tx_payee := trim(v_elem ->> 'payee');
    v_tx_memo := NULLIF(trim(v_elem ->> 'memo'), '');
    v_tx_source := COALESCE(v_elem ->> 'source', 'manual');
    v_tx_reconciled := COALESCE((v_elem ->> 'reconciled')::boolean, false);
    v_tx_created := (v_elem ->> 'createdAt')::timestamptz;
    v_tx_deleted := NULLIF(v_elem ->> 'deletedAt', '')::timestamptz;

    IF v_elem ? 'principalAmount' AND v_elem -> 'principalAmount' IS NOT NULL AND pg_catalog.jsonb_typeof(v_elem -> 'principalAmount') = 'object' THEN
      v_tx_principal := ((v_elem -> 'principalAmount' ->> 'minorUnits')::bigint::numeric / v_factor)::numeric(18, 4);
    ELSE
      v_tx_principal := NULL;
    END IF;

    IF v_elem ? 'interestAmount' AND v_elem -> 'interestAmount' IS NOT NULL AND pg_catalog.jsonb_typeof(v_elem -> 'interestAmount') = 'object' THEN
      v_tx_interest := ((v_elem -> 'interestAmount' ->> 'minorUnits')::bigint::numeric / v_factor)::numeric(18, 4);
    ELSE
      v_tx_interest := NULL;
    END IF;

    IF v_elem ? 'escrowAmount' AND v_elem -> 'escrowAmount' IS NOT NULL AND pg_catalog.jsonb_typeof(v_elem -> 'escrowAmount') = 'object' THEN
      v_tx_escrow := ((v_elem -> 'escrowAmount' ->> 'minorUnits')::bigint::numeric / v_factor)::numeric(18, 4);
    ELSE
      v_tx_escrow := NULL;
    END IF;

    IF v_elem ? 'feeAmount' AND v_elem -> 'feeAmount' IS NOT NULL AND pg_catalog.jsonb_typeof(v_elem -> 'feeAmount') = 'object' THEN
      v_tx_fee := ((v_elem -> 'feeAmount' ->> 'minorUnits')::bigint::numeric / v_factor)::numeric(18, 4);
    ELSE
      v_tx_fee := NULL;
    END IF;

    INSERT INTO public.transactions (
      id, user_id, household_id, account_id, date, applies_to_date,
      amount, category, payee, memo, source, reconciled,
      created_at, updated_at, deleted_at, principal_amount,
      interest_amount, escrow_amount, fee_amount
    ) VALUES (
      v_id, v_uid, v_household_id, v_tx_acct, v_tx_date, v_tx_applies,
      v_tx_amount, v_tx_cat, v_tx_payee, v_tx_memo, v_tx_source, v_tx_reconciled,
      v_tx_created, now(), v_tx_deleted, v_tx_principal,
      v_tx_interest, v_tx_escrow, v_tx_fee
    )
    ON CONFLICT (id) DO UPDATE SET
      household_id = v_household_id,
      account_id = EXCLUDED.account_id,
      date = EXCLUDED.date,
      applies_to_date = EXCLUDED.applies_to_date,
      amount = EXCLUDED.amount,
      category = EXCLUDED.category,
      payee = EXCLUDED.payee,
      memo = EXCLUDED.memo,
      source = EXCLUDED.source,
      reconciled = EXCLUDED.reconciled,
      updated_at = now(),
      deleted_at = EXCLUDED.deleted_at,
      principal_amount = EXCLUDED.principal_amount,
      interest_amount = EXCLUDED.interest_amount,
      escrow_amount = EXCLUDED.escrow_amount,
      fee_amount = EXCLUDED.fee_amount
    WHERE transactions.user_id = v_uid;
  END LOOP;

  -- 6f. Upsert Reconciliation Anchors
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'reconciliationAnchors')
  LOOP
    v_id := v_elem ->> 'id';
    v_anchor_acct := (v_elem ->> 'accountId')::uuid;
    v_anchor_date := (v_elem ->> 'asOfDate')::date;
    v_minor_units := (v_elem -> 'verifiedBalance' ->> 'minorUnits')::bigint;
    v_anchor_balance := (v_minor_units::numeric / v_factor)::numeric(18, 4);
    v_anchor_note := NULLIF(trim(v_elem ->> 'note'), '');
    v_anchor_adj := NULLIF(v_elem ->> 'createdAdjustmentId', '');
    v_anchor_created := (v_elem ->> 'createdAt')::timestamptz;

    INSERT INTO public.reconciliation_anchors (
      id, user_id, account_id, as_of_date, verified_balance, note,
      created_at, created_adjustment_id
    ) VALUES (
      v_id, v_uid, v_anchor_acct, v_anchor_date, v_anchor_balance, v_anchor_note,
      v_anchor_created, v_anchor_adj
    )
    ON CONFLICT (id) DO UPDATE SET
      account_id = EXCLUDED.account_id,
      as_of_date = EXCLUDED.as_of_date,
      verified_balance = EXCLUDED.verified_balance,
      note = EXCLUDED.note,
      created_adjustment_id = EXCLUDED.created_adjustment_id
    WHERE reconciliation_anchors.user_id = v_uid;
  END LOOP;

  -- --------------------------------------------------------------------------
  -- 7. Read Authoritative Restored Snapshot & Insert Durable Receipt
  -- --------------------------------------------------------------------------
  SELECT * INTO v_final_snapshot
  FROM public.debtfree_internal_build_snapshot(v_uid, v_household_id, v_currency);

  INSERT INTO public.debtfree_restore_receipts (
    owner_user_id,
    operation_id,
    request_identity,
    client_payload_fingerprint,
    restored_snapshot,
    completed_at
  ) VALUES (
    v_uid,
    p_operation_id,
    v_current_request_identity,
    p_payload_fingerprint,
    v_final_snapshot.r_snapshot,
    now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'operationId', p_operation_id,
    'payloadFingerprint', p_payload_fingerprint,
    'restoredSnapshot', v_final_snapshot.r_snapshot
  );
END;
$$;

-- Current definition from 20261111194327_reset_financial_data_atomic.sql
CREATE OR REPLACE FUNCTION public.debtfree_reset_financial_data_atomic()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_txs_count integer := 0;
  v_bills_count integer := 0;
  v_anchors_count integer := 0;
  v_debts_count integer := 0;
BEGIN
  PERFORM public.debtfree_lock_financial_user();
  -- Strict authentication check: caller must be authenticated
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  -- 1. Transactions Ledger (scoped strictly to auth.uid())
  DELETE FROM public.transactions WHERE user_id = v_uid;
  GET DIAGNOSTICS v_txs_count = ROW_COUNT;

  -- 2. Statement Reconciliation Anchors (scoped strictly to auth.uid())
  DELETE FROM public.reconciliation_anchors WHERE user_id = v_uid;
  GET DIAGNOSTICS v_anchors_count = ROW_COUNT;

  -- 3. Recurring Bills (scoped strictly to auth.uid())
  DELETE FROM public.recurring_bills WHERE user_id = v_uid;
  GET DIAGNOSTICS v_bills_count = ROW_COUNT;

  -- 4. Debts / Accounts (scoped strictly to auth.uid())
  DELETE FROM public.debts WHERE user_id = v_uid;
  GET DIAGNOSTICS v_debts_count = ROW_COUNT;

  -- Return atomic confirmation breakdown
  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_uid,
    'deleted_transactions', v_txs_count,
    'deleted_reconciliation_anchors', v_anchors_count,
    'deleted_recurring_bills', v_bills_count,
    'deleted_debts', v_debts_count,
    'reset_at', now()
  );
EXCEPTION
  WHEN OTHERS THEN
    -- Transactional rollback is automatic in PL/pgSQL on unhandled exception
    RAISE;
END;
$$;

COMMIT;

