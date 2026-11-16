-- T-287: Explicitly repair only missing or unsupported debt category metadata.
CREATE OR REPLACE FUNCTION public.debtfree_repair_debt_category(
  p_household_id text,
  p_expected_membership_version bigint,
  p_debt_id uuid,
  p_expected_debt_version bigint,
  p_category text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth record;
  v_debt record;
  v_saved_version bigint;
BEGIN
  SELECT * INTO v_auth
  FROM public.debtfree_internal_finance_authorize(
    p_household_id,
    p_expected_membership_version,
    ARRAY['owner', 'admin']
  );

  IF p_debt_id IS NULL OR p_expected_debt_version IS NULL
     OR p_expected_debt_version < 1 OR p_category IS NULL
     OR p_category NOT IN (
       'Credit card', 'Personal loan', 'Auto loan', 'Student loan',
       'Medical debt', 'Other loan', 'Mortgage'
     ) THEN
    RAISE EXCEPTION 'Invalid debt category repair request' USING ERRCODE = '22023';
  END IF;

  SELECT d.id, d.category, d.version, d.annual_fee_amount
    INTO v_debt
  FROM public.debts AS d
  WHERE d.id = p_debt_id
    AND d.household_id = p_household_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debt account not found in this household' USING ERRCODE = '42501';
  END IF;
  IF v_debt.version IS DISTINCT FROM p_expected_debt_version THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Debt account changed before category repair' USING ERRCODE = '40001';
  END IF;
  IF v_debt.category IN (
    'Credit card', 'Personal loan', 'Auto loan', 'Student loan',
    'Medical debt', 'Other loan', 'Mortgage'
  ) THEN
    RAISE EXCEPTION 'Debt category is already supported' USING ERRCODE = '22023';
  END IF;
  IF v_debt.annual_fee_amount IS NOT NULL AND p_category <> 'Credit card' THEN
    RAISE EXCEPTION 'Annual fees can only be attached to a credit card' USING ERRCODE = '23514';
  END IF;

  UPDATE public.debts AS d
  SET category = p_category,
      version = d.version + 1,
      updated_at = pg_catalog.now()
  WHERE d.id = p_debt_id
    AND d.household_id = p_household_id
    AND d.version = p_expected_debt_version
  RETURNING d.version INTO v_saved_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Debt account changed before category repair' USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'householdId', p_household_id,
    'membershipVersion', v_auth.r_membership_version,
    'debtId', p_debt_id,
    'category', p_category,
    'version', v_saved_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_repair_debt_category(text, bigint, uuid, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_repair_debt_category(text, bigint, uuid, bigint, text)
  TO authenticated;
