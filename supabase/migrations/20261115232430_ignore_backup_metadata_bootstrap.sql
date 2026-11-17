CREATE OR REPLACE FUNCTION public.debtfree_ensure_personal_household(
  p_household_name text,
  p_currency_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_discovered text[];
  v_household_id text;
  v_name text;
  v_currency text;
  v_context jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_household_name IS NULL OR pg_catalog.btrim(p_household_name) = ''
     OR pg_catalog.length(pg_catalog.btrim(p_household_name)) > 120
     OR p_currency_code IS NULL OR p_currency_code !~ '^[A-Za-z]{3}$' THEN
    RAISE EXCEPTION 'Invalid initial household identity' USING ERRCODE = '22023';
  END IF;
  v_name := pg_catalog.btrim(p_household_name);
  v_currency := pg_catalog.upper(p_currency_code);

  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[v_actor], 'update', false);
  SELECT COALESCE(pg_catalog.array_agg(hm.household_id ORDER BY hm.household_id COLLATE "C"), ARRAY[]::text[])
    INTO v_discovered
  FROM public.household_members AS hm
  JOIN public.households AS h ON h.id = hm.household_id AND h.lifecycle_state = 'active'
  WHERE hm.user_id = v_actor AND hm.status = 'active';

  IF pg_catalog.cardinality(v_discovered) > 1 THEN
    RAISE EXCEPTION 'Multiple active household contexts exist; select one from the verified context list' USING ERRCODE = '21000';
  ELSIF pg_catalog.cardinality(v_discovered) = 1 THEN
    v_household_id := v_discovered[1];
    PERFORM public.debtfree_internal_lock_households(ARRAY[v_household_id], 'share');
    PERFORM hm.user_id
    FROM public.household_members AS hm
    WHERE hm.household_id = v_household_id AND hm.user_id = v_actor AND hm.status = 'active'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Household membership changed; refresh contexts and retry' USING ERRCODE = '40001';
    END IF;
    SELECT pg_catalog.jsonb_build_object(
      'userId', v_actor::text,
      'householdId', h.id,
      'householdName', h.name,
      'currencyCode', pg_catalog.upper(h.currency),
      'role', CASE WHEN hm.role = 'admin' THEN 'member' ELSE hm.role END,
      'membershipVersion', h.membership_version::text
    ) INTO v_context
    FROM public.household_members AS hm
    JOIN public.households AS h ON h.id = hm.household_id
    WHERE hm.household_id = v_household_id AND hm.user_id = v_actor AND hm.status = 'active'
      AND h.lifecycle_state = 'active'
      AND hm.role IN ('owner', 'admin', 'viewer')
      AND h.membership_version >= 1
      AND pg_catalog.btrim(h.name) <> '' AND pg_catalog.length(h.name) <= 120
      AND h.currency ~ '^[A-Za-z]{3}$';
    IF v_context IS NULL THEN
      RAISE EXCEPTION 'An active household context is unavailable or invalid' USING ERRCODE = 'P0002';
    END IF;
    RETURN v_context;
  END IF;

  -- Preserve backed-up auth metadata; guard unassigned financial rows and legacy profiles:
  IF EXISTS (SELECT 1 FROM public.debts AS r WHERE r.user_id = v_actor AND r.household_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.transactions AS r WHERE r.user_id = v_actor AND r.household_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.recurring_bills AS r WHERE r.user_id = v_actor AND r.household_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.reconciliation_anchors AS r WHERE r.user_id = v_actor AND r.household_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.debtfree_deleted_debt_ids AS r WHERE r.deleted_user_id = v_actor AND r.household_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.debtfree_deleted_bill_ids AS r WHERE r.user_id = v_actor AND r.household_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.household_profiles AS r WHERE r.user_id = v_actor) THEN
    RAISE EXCEPTION 'Legacy financial data requires migration before continuing' USING ERRCODE = '42501';
  END IF;

  -- Safely create a fresh personal household:
  v_household_id := 'hh-' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public.households (id, name, currency, created_by)
  VALUES (v_household_id, v_name, v_currency, v_actor);
  INSERT INTO public.household_members (household_id, user_id, role, status)
  VALUES (v_household_id, v_actor, 'owner', 'active');

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('debtfree.finance:' || v_household_id, 0)
  );
  INSERT INTO public.household_settings (household_id, revision, settings)
  VALUES (
    v_household_id,
    0,
    pg_catalog.jsonb_build_object(
      'householdId', v_household_id,
      'householdName', v_name,
      'currencyCode', v_currency
    )
  )
  ON CONFLICT (household_id) DO NOTHING;

  RETURN pg_catalog.jsonb_build_object(
    'userId', v_actor::text,
    'householdId', v_household_id,
    'householdName', v_name,
    'currencyCode', v_currency,
    'role', 'owner',
    'membershipVersion', '1'
  );
END;
$function$;


