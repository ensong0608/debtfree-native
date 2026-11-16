-- Server-only access to durable household settings. Membership is checked from
-- current database rows on every call; user metadata and JWT role claims are
-- not authorization sources.
BEGIN;

CREATE OR REPLACE FUNCTION public.debtfree_get_household_settings(
  p_household_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_role text;
  v_revision bigint;
  v_settings jsonb;
BEGIN
  v_actor := (SELECT auth.uid());
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_household_id IS NULL OR p_household_id = ''
     OR p_household_id <> pg_catalog.btrim(p_household_id)
     OR pg_catalog.length(p_household_id) > 120 THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  -- Lock order: household, active membership, household settings.
  PERFORM h.id
  FROM public.households AS h
  WHERE h.id = p_household_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  SELECT hm.role INTO v_role
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id
    AND hm.user_id = v_actor
    AND hm.status = 'active'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  SELECT hs.revision, hs.settings INTO v_revision, v_settings
  FROM public.household_settings AS hs
  WHERE hs.household_id = p_household_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Household settings unavailable' USING ERRCODE = 'P0002';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'ok',
    'householdId', p_household_id,
    'role', CASE WHEN v_role = 'admin' THEN 'member' ELSE v_role END,
    'revision', v_revision,
    'settings', v_settings
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.debtfree_save_household_settings(
  p_household_id text,
  p_expected_revision bigint,
  p_settings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_role text;
  v_revision bigint;
  v_current_settings jsonb;
  v_next_settings jsonb;
  v_allowed_keys text[] := ARRAY[
    'householdId',
    'householdName',
    'countryCode',
    'currencyCode',
    'householdTimeZone',
    'primaryIncomeName',
    'primaryIncomeAmount',
    'primaryGrossIncomeAmount',
    'primaryPayFrequency',
    'primaryMonthlyIncome',
    'additionalIncomes',
    'strategy',
    'extraMonthlyPayment',
    'obligationSchedules',
    'debtPaymentSplitPlansByDebtId',
    'billPaymentSplitPlansByBillId',
    'mortgageEscrowByDebtId',
    'mortgageExtraPaymentByDebtId',
    'loanBillPairingByDebtId',
    'recurringBillCategoryLabelByBillId',
    'archivedPaidOffDebtIds'
  ];
BEGIN
  v_actor := (SELECT auth.uid());
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_household_id IS NULL OR p_household_id = ''
     OR p_household_id <> pg_catalog.btrim(p_household_id)
     OR pg_catalog.length(p_household_id) > 120
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_expected_revision >= 9223372036854775806
     OR p_settings IS NULL
     OR pg_catalog.jsonb_typeof(p_settings) <> 'object'
     OR NOT (p_settings ? 'householdName')
     OR NOT (p_settings ? 'currencyCode')
     OR (p_settings ? 'householdId'
         AND p_settings ->> 'householdId' IS DISTINCT FROM p_household_id)
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_object_keys(p_settings) AS supplied(key)
       WHERE supplied.key <> ALL (v_allowed_keys)
     ) THEN
    RAISE EXCEPTION 'Invalid household settings payload' USING ERRCODE = '22023';
  END IF;
  IF p_settings ? 'householdName'
     AND (pg_catalog.jsonb_typeof(p_settings -> 'householdName') <> 'string'
          OR pg_catalog.btrim(p_settings ->> 'householdName') = ''
          OR pg_catalog.length(p_settings ->> 'householdName') > 120) THEN
    RAISE EXCEPTION 'Invalid household name' USING ERRCODE = '22023';
  END IF;
  IF p_settings ? 'currencyCode'
     AND (pg_catalog.jsonb_typeof(p_settings -> 'currencyCode') <> 'string'
          OR p_settings ->> 'currencyCode' !~ '^[A-Za-z]{3}$') THEN
    RAISE EXCEPTION 'Invalid household currency' USING ERRCODE = '22023';
  END IF;

  -- The current role is read and locked after the household lock, so a
  -- concurrent removal or downgrade cannot race this settings write.
  PERFORM h.id
  FROM public.households AS h
  WHERE h.id = p_household_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  SELECT hm.role INTO v_role
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id
    AND hm.user_id = v_actor
    AND hm.status = 'active'
  FOR SHARE;
  IF NOT FOUND OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Household settings write denied' USING ERRCODE = '42501';
  END IF;

  SELECT hs.revision, hs.settings INTO v_revision, v_current_settings
  FROM public.household_settings AS hs
  WHERE hs.household_id = p_household_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Household settings unavailable' USING ERRCODE = 'P0002';
  END IF;

  IF v_revision <> p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'conflict',
      'householdId', p_household_id,
      'revision', v_revision,
      'settings', v_current_settings
    );
  END IF;
  IF v_revision >= 9223372036854775806 THEN
    RAISE EXCEPTION 'Household settings revision exhausted' USING ERRCODE = '22003';
  END IF;

  -- The existing database role `admin` is the editable-member role. Only the
  -- owner may change household identity and currency. Full household settings
  -- snapshots must include both canonical fields.
  IF v_role <> 'owner' AND (
    (p_settings ? 'householdName'
      AND p_settings -> 'householdName' IS DISTINCT FROM v_current_settings -> 'householdName')
    OR (p_settings ? 'currencyCode'
      AND p_settings -> 'currencyCode' IS DISTINCT FROM v_current_settings -> 'currencyCode')
  ) THEN
    RAISE EXCEPTION 'Only the household owner may change its name or currency' USING ERRCODE = '42501';
  END IF;
  IF p_settings ? 'archivedPaidOffDebtIds'
     AND p_settings -> 'archivedPaidOffDebtIds'
         IS DISTINCT FROM v_current_settings -> 'archivedPaidOffDebtIds' THEN
    RAISE EXCEPTION 'Paid-off archive state is server managed' USING ERRCODE = '42501';
  END IF;

  v_next_settings := p_settings || pg_catalog.jsonb_build_object('householdId', p_household_id);
  IF NOT (p_settings ? 'archivedPaidOffDebtIds')
     AND v_current_settings ? 'archivedPaidOffDebtIds' THEN
    v_next_settings := v_next_settings || pg_catalog.jsonb_build_object('archivedPaidOffDebtIds', v_current_settings -> 'archivedPaidOffDebtIds');
  END IF;
  IF v_next_settings ? 'householdName' THEN
    v_next_settings := pg_catalog.jsonb_set(
      v_next_settings, '{householdName}',
      pg_catalog.to_jsonb(pg_catalog.btrim(v_next_settings ->> 'householdName')), true
    );
  END IF;
  IF v_next_settings ? 'currencyCode' THEN
    v_next_settings := pg_catalog.jsonb_set(
      v_next_settings, '{currencyCode}',
      pg_catalog.to_jsonb(pg_catalog.upper(v_next_settings ->> 'currencyCode')), true
    );
  END IF;

  UPDATE public.households AS h
  SET name = CASE WHEN v_role = 'owner' AND v_next_settings ? 'householdName'
                  THEN v_next_settings ->> 'householdName' ELSE h.name END,
      currency = CASE WHEN v_role = 'owner' AND v_next_settings ? 'currencyCode'
                      THEN pg_catalog.upper(v_next_settings ->> 'currencyCode') ELSE h.currency END,
      updated_at = pg_catalog.now()
  WHERE h.id = p_household_id;

  UPDATE public.household_settings AS hs
  SET settings = v_next_settings,
      revision = v_revision + 1,
      updated_at = pg_catalog.now()
  WHERE hs.household_id = p_household_id;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'saved',
    'householdId', p_household_id,
    'revision', v_revision + 1,
    'settings', v_next_settings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_get_household_settings(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debtfree_save_household_settings(text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.household_settings FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_get_household_settings(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_save_household_settings(text, bigint, jsonb) TO authenticated;

COMMIT;
