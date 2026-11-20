BEGIN;

-- A deliberate account action may archive an existing zero-balance debt.
-- Keep the internal sync routine private; this wrapper checks current household
-- authority and the authoritative account balance before calling it.
CREATE OR REPLACE FUNCTION public.debtfree_mark_household_debt_paid(
  p_household_id text,
  p_expected_membership_version bigint,
  p_debt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth record;
  v_balance numeric(18,4);
  v_settings jsonb;
  v_revision bigint;
BEGIN
  IF p_debt_id IS NULL THEN
    RAISE EXCEPTION 'A debt account ID is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_auth
  FROM public.debtfree_internal_finance_authorize(
    p_household_id,
    p_expected_membership_version,
    ARRAY['owner', 'admin']
  );

  SELECT d.balance INTO v_balance
  FROM public.debts AS d
  WHERE d.id = p_debt_id AND d.household_id = p_household_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This account is no longer available in the selected household' USING ERRCODE = 'P0002';
  END IF;
  IF v_balance <> 0 THEN
    RAISE EXCEPTION 'Only a zero-balance account can be marked paid' USING ERRCODE = '23514';
  END IF;

  PERFORM public.debtfree_internal_sync_household_paid_off_archive(
    p_household_id, p_debt_id, true
  );

  SELECT hs.settings, hs.revision INTO v_settings, v_revision
  FROM public.household_settings AS hs
  WHERE hs.household_id = p_household_id
  FOR UPDATE;
  IF NOT FOUND OR pg_catalog.jsonb_typeof(v_settings -> 'archivedPaidOffDebtIds') IS DISTINCT FROM 'array'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_array_elements_text(v_settings -> 'archivedPaidOffDebtIds') AS archived(value)
       WHERE archived.value = p_debt_id::text
     ) THEN
    RAISE EXCEPTION 'Paid-off archive state could not be confirmed' USING ERRCODE = 'P0001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'saved',
    'householdId', p_household_id,
    'membershipVersion', v_auth.r_membership_version::text,
    'revision', v_revision,
    'settings', v_settings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_mark_household_debt_paid(text, bigint, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_mark_household_debt_paid(text, bigint, uuid)
  TO authenticated;

COMMIT;
