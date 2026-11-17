-- Server-authoritative household discovery and a one-time personal household
-- bootstrap for newly authenticated accounts. This does not authorize finance
-- reads or writes; all shared finance paths remain behind their own cutover.
BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure('public.debtfree_internal_lock_account_guards(uuid[],text,boolean)') IS NULL
     OR pg_catalog.to_regprocedure('public.debtfree_internal_lock_households(text[],text)') IS NULL
     OR pg_catalog.to_regclass('public.household_settings') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.households'::regclass AND attname='lifecycle_state' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.households'::regclass AND attname='membership_version' AND NOT attisdropped)
     OR pg_catalog.to_regclass('public.debts') IS NULL
     OR pg_catalog.to_regclass('public.transactions') IS NULL
     OR pg_catalog.to_regclass('public.recurring_bills') IS NULL
     OR pg_catalog.to_regclass('public.reconciliation_anchors') IS NULL
     OR pg_catalog.to_regclass('public.debtfree_deleted_debt_ids') IS NULL
     OR pg_catalog.to_regclass('public.debtfree_deleted_bill_ids') IS NULL THEN
    RAISE EXCEPTION 'Household context discovery prerequisites are missing; review the ordered migrations';
  END IF;
END
$preflight$;

CREATE FUNCTION public.debtfree_list_household_contexts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_discovered text[];
  v_locked text[];
  v_contexts jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Membership lifecycle operations take the exclusive account guard. Holding
  -- its shared form stabilizes discovery while household/member rows are locked.
  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[v_actor], 'share', false);
  SELECT COALESCE(pg_catalog.array_agg(hm.household_id ORDER BY hm.household_id COLLATE "C"), ARRAY[]::text[])
    INTO v_discovered
  FROM public.household_members AS hm
  WHERE hm.user_id = v_actor AND hm.status = 'active';

  IF pg_catalog.cardinality(v_discovered) > 0 THEN
    PERFORM public.debtfree_internal_lock_households(v_discovered, 'share');
    PERFORM hm.user_id
    FROM public.household_members AS hm
    WHERE hm.user_id = v_actor AND hm.status = 'active'
      AND hm.household_id = ANY(v_discovered)
    ORDER BY hm.household_id COLLATE "C", hm.user_id
    FOR SHARE;
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(hm.household_id ORDER BY hm.household_id COLLATE "C"), ARRAY[]::text[])
    INTO v_locked
  FROM public.household_members AS hm
  WHERE hm.user_id = v_actor AND hm.status = 'active';
  IF v_discovered IS DISTINCT FROM v_locked THEN
    RAISE EXCEPTION 'Household membership changed; refresh contexts and retry' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.household_members AS hm
    JOIN public.households AS h ON h.id = hm.household_id
    WHERE hm.user_id = v_actor AND hm.status = 'active'
      AND (h.lifecycle_state <> 'active'
        OR hm.role NOT IN ('owner', 'admin', 'viewer')
        OR h.membership_version < 1
        OR pg_catalog.btrim(h.name) = '' OR pg_catalog.length(h.name) > 120
        OR h.currency !~ '^[A-Za-z]{3}$')
  ) THEN
    RAISE EXCEPTION 'An active household context is unavailable or invalid' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'userId', v_actor::text,
        'householdId', h.id,
        'householdName', h.name,
        'currencyCode', pg_catalog.upper(h.currency),
        'role', CASE WHEN hm.role = 'admin' THEN 'member' ELSE hm.role END,
        'membershipVersion', h.membership_version::text
      ) ORDER BY hm.household_id COLLATE "C"
    ), '[]'::jsonb
  ) INTO v_contexts
  FROM public.household_members AS hm
  JOIN public.households AS h ON h.id = hm.household_id
  WHERE hm.user_id = v_actor AND hm.status = 'active' AND h.lifecycle_state = 'active';

  RETURN v_contexts;
END
$function$;

CREATE FUNCTION public.debtfree_ensure_personal_household(
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

  -- Exclusive account guard makes the empty-membership check and first
  -- household creation idempotent against invitations/deletion/membership work.
  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[v_actor], 'update', false);
  SELECT COALESCE(pg_catalog.array_agg(hm.household_id ORDER BY hm.household_id COLLATE "C"), ARRAY[]::text[])
    INTO v_discovered
  FROM public.household_members AS hm
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

  -- No-membership recovery is safe only for a genuinely new account. Never
  -- strand an older household profile or financial row behind a new blank
  -- household; these legacy cases require the owner mapping/cutover path.
  IF EXISTS (SELECT 1 FROM public.household_members AS hm WHERE hm.user_id = v_actor)
     OR EXISTS (SELECT 1 FROM public.households AS h WHERE h.created_by = v_actor)
     OR EXISTS (
       SELECT 1 FROM auth.users AS u
       WHERE u.id = v_actor AND u.raw_user_meta_data ? 'debtfree_native_v1'
     )
     OR EXISTS (SELECT 1 FROM public.debts AS r WHERE r.user_id = v_actor)
     OR EXISTS (SELECT 1 FROM public.transactions AS r WHERE r.user_id = v_actor)
     OR EXISTS (SELECT 1 FROM public.recurring_bills AS r WHERE r.user_id = v_actor)
     OR EXISTS (SELECT 1 FROM public.reconciliation_anchors AS r WHERE r.user_id = v_actor)
     OR EXISTS (SELECT 1 FROM public.debtfree_deleted_debt_ids AS r WHERE r.deleted_user_id = v_actor)
     OR EXISTS (SELECT 1 FROM public.debtfree_deleted_bill_ids AS r WHERE r.user_id = v_actor) THEN
    RAISE EXCEPTION 'Existing household or financial data has no active household membership; recover its original household before continuing' USING ERRCODE = '42501';
  END IF;

  v_household_id := 'hh-' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public.households (id, name, currency, created_by)
  VALUES (v_household_id, v_name, v_currency, v_actor);
  INSERT INTO public.household_members (household_id, user_id, role, status)
  VALUES (v_household_id, v_actor, 'owner', 'active');

  -- Lock order is account guard -> newly created household row -> membership
  -- row -> household finance mutex -> canonical settings row.
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
  );

  RETURN pg_catalog.jsonb_build_object(
    'userId', v_actor::text,
    'householdId', v_household_id,
    'householdName', v_name,
    'currencyCode', v_currency,
    'role', 'owner',
    'membershipVersion', '1'
  );
END
$function$;

REVOKE ALL ON FUNCTION public.debtfree_list_household_contexts() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.debtfree_ensure_personal_household(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.debtfree_list_household_contexts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_ensure_personal_household(text, text) TO authenticated;

COMMIT;
