-- Keyset-paginated household transaction history read RPC and supporting index.
-- Preserves SECURITY INVOKER RLS enforcement and membership-version fail-closed guards.

BEGIN;

CREATE INDEX IF NOT EXISTS transactions_household_date_id_desc_idx
  ON public.transactions (household_id, date DESC, id DESC);

CREATE OR REPLACE FUNCTION public.debtfree_get_household_transaction_page(
  p_household_id text,
  p_expected_membership_version bigint,
  p_before_date date DEFAULT NULL,
  p_before_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_lifecycle_state text;
  v_membership_version bigint;
  v_fetched public.transactions[];
  v_rows jsonb;
  v_next_cursor jsonb := NULL;
BEGIN
  v_actor := (SELECT auth.uid());
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_household_id IS NULL
     OR p_household_id = ''
     OR p_household_id <> pg_catalog.btrim(p_household_id)
     OR pg_catalog.length(p_household_id) > 120 THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  IF p_expected_membership_version IS NULL OR p_expected_membership_version < 1 THEN
    RAISE EXCEPTION 'Invalid household membership version' USING ERRCODE = '22023';
  END IF;

  IF (p_before_date IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'Cursor requires both p_before_date and p_before_id' USING ERRCODE = '22023';
  END IF;

  IF p_before_id IS NOT NULL AND p_before_id = '' THEN
    RAISE EXCEPTION 'Invalid transaction cursor id' USING ERRCODE = '22023';
  END IF;

  -- Fail closed under caller RLS (households_active_member_select) and verify
  -- active household lifecycle + exact membership version before reading rows.
  SELECT h.lifecycle_state, h.membership_version
    INTO v_lifecycle_state, v_membership_version
  FROM public.households AS h
  WHERE h.id = p_household_id;

  IF NOT FOUND OR v_lifecycle_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  IF v_membership_version IS DISTINCT FROM p_expected_membership_version THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Household membership version changed (expected %, current %)',
      p_expected_membership_version, v_membership_version
      USING ERRCODE = 'P0001';
  END IF;

  -- Separate first and continuation plans so the cursor stays in the index condition.
  -- Include tombstones for reconciliation and pending-write recovery.
  IF p_before_date IS NULL THEN
    v_fetched := ARRAY(
      SELECT t FROM public.transactions AS t
      WHERE t.household_id = p_household_id
      ORDER BY t.date DESC, t.id DESC
      LIMIT 501
    );
  ELSE
    v_fetched := ARRAY(
      SELECT t FROM public.transactions AS t
      WHERE t.household_id = p_household_id
        AND (t.date, t.id) < (p_before_date, p_before_id)
      ORDER BY t.date DESC, t.id DESC
      LIMIT 501
    );
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', r.id, 'user_id', r.user_id, 'household_id', r.household_id, 'account_id', r.account_id,
    'date', r.date, 'applies_to_date', r.applies_to_date, 'amount', r.amount, 'category', r.category,
    'payee', r.payee, 'memo', r.memo, 'source', r.source, 'reconciled', r.reconciled,
    'created_at', r.created_at, 'updated_at', r.updated_at, 'deleted_at', r.deleted_at,
    'principal_amount', r.principal_amount, 'interest_amount', r.interest_amount,
    'escrow_amount', r.escrow_amount, 'fee_amount', r.fee_amount
  ) ORDER BY r.ordinality), '[]'::jsonb)
    INTO v_rows
  FROM ROWS FROM (pg_catalog.unnest(v_fetched)) WITH ORDINALITY AS r
  WHERE r.ordinality <= 500;

  IF pg_catalog.cardinality(v_fetched) > 500 THEN
    v_next_cursor := pg_catalog.jsonb_build_object('date', (v_fetched[500]).date, 'id', (v_fetched[500]).id);
  END IF;

  RETURN pg_catalog.jsonb_build_object('rows', v_rows, 'nextCursor', v_next_cursor);
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_get_household_transaction_page(text, bigint, date, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.debtfree_get_household_transaction_page(text, bigint, date, text)
  TO authenticated;

COMMENT ON FUNCTION public.debtfree_get_household_transaction_page(text, bigint, date, text) IS
  'Keyset-paginated household transaction history under caller RLS and membership-version guard.';

COMMIT;
