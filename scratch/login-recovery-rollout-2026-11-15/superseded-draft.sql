-- Fix leave household and personal household bootstrap
-- Ensures members who leave a household or who have zero active memberships
-- can always safely create or restore their personal household, preventing login lockouts.
BEGIN;

CREATE OR REPLACE FUNCTION public.debtfree_leave_household(
  p_household_id text,
  p_expected_membership_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_lifecycle_state text;
  v_version bigint;
  v_actor_role text;
  v_owner_count bigint;
  v_remaining_active bigint;
  v_fallback_hh text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_household_id IS NULL OR p_household_id = ''
     OR p_household_id <> pg_catalog.btrim(p_household_id)
     OR pg_catalog.length(p_household_id) > 120 THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;
  IF p_expected_membership_version IS NULL OR p_expected_membership_version < 1 THEN
    RAISE EXCEPTION 'Invalid membership version' USING ERRCODE = '22023';
  END IF;

  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[v_actor], 'update', false);
  PERFORM public.debtfree_internal_lock_households(ARRAY[p_household_id], 'update');

  SELECT h.lifecycle_state, h.membership_version
    INTO v_lifecycle_state, v_version
  FROM public.households AS h
  WHERE h.id = p_household_id;
  IF NOT FOUND OR v_lifecycle_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  PERFORM hm.user_id
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id
  ORDER BY hm.user_id
  FOR UPDATE;

  SELECT hm.role INTO v_actor_role
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id AND hm.user_id = v_actor AND hm.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Household membership not active' USING ERRCODE = '42501';
  END IF;
  IF v_actor_role = 'owner' THEN
    RAISE EXCEPTION 'Household owner cannot leave without transferring ownership first' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_owner_count
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id AND hm.status = 'active' AND hm.role = 'owner';
  IF v_owner_count <> 1 THEN
    RAISE EXCEPTION 'Household ownership invariant violation' USING ERRCODE = 'P0001';
  END IF;
  IF v_version IS DISTINCT FROM p_expected_membership_version THEN
    RAISE EXCEPTION 'Household membership version changed' USING ERRCODE = '40001';
  END IF;

  UPDATE public.household_members
  SET status = 'revoked'
  WHERE household_id = p_household_id AND user_id = v_actor AND status = 'active';

  UPDATE public.households
  SET membership_version = membership_version + 1
  WHERE id = p_household_id
  RETURNING membership_version INTO v_version;

  -- Ensure the actor is never left stranded without an active household
  SELECT count(*) INTO v_remaining_active
  FROM public.household_members AS hm
  WHERE hm.user_id = v_actor AND hm.status = 'active' AND hm.household_id <> p_household_id;

  IF v_remaining_active = 0 THEN
    SELECT h.id INTO v_fallback_hh
    FROM public.households AS h
    WHERE h.created_by = v_actor AND h.lifecycle_state = 'active' AND h.id <> p_household_id
    ORDER BY h.created_at ASC
    LIMIT 1;

    IF v_fallback_hh IS NOT NULL THEN
      INSERT INTO public.household_members (household_id, user_id, role, status)
      VALUES (v_fallback_hh, v_actor, 'owner', 'active')
      ON CONFLICT (household_id, user_id) DO UPDATE SET role = 'owner', status = 'active';
    ELSE
      v_fallback_hh := 'hh-' || pg_catalog.gen_random_uuid()::text;
      INSERT INTO public.households (id, name, currency, created_by)
      VALUES (v_fallback_hh, 'My Household', 'USD', v_actor);
      INSERT INTO public.household_members (household_id, user_id, role, status)
      VALUES (v_fallback_hh, v_actor, 'owner', 'active')
      ON CONFLICT (household_id, user_id) DO UPDATE SET role = 'owner', status = 'active';

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('debtfree.finance:' || v_fallback_hh, 0)
      );
      INSERT INTO public.household_settings (household_id, revision, settings)
      VALUES (
        v_fallback_hh,
        0,
        pg_catalog.jsonb_build_object(
          'householdId', v_fallback_hh,
          'householdName', 'My Household',
          'currencyCode', 'USD'
        )
      )
      ON CONFLICT (household_id) DO NOTHING;
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'left',
    'householdId', p_household_id,
    'userId', v_actor::text,
    'membershipVersion', v_version::text,
    'fallbackHouseholdId', v_fallback_hh
  );
END;
$$;

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

  -- User has 0 active households. Check if user already owns an active household to restore:
  SELECT h.id INTO v_household_id
  FROM public.households AS h
  WHERE h.created_by = v_actor AND h.lifecycle_state = 'active'
  ORDER BY h.created_at ASC
  LIMIT 1;

  IF v_household_id IS NOT NULL THEN
    PERFORM public.debtfree_internal_lock_households(ARRAY[v_household_id], 'update');
    INSERT INTO public.household_members (household_id, user_id, role, status)
    VALUES (v_household_id, v_actor, 'owner', 'active')
    ON CONFLICT (household_id, user_id) DO UPDATE SET role = 'owner', status = 'active';

    SELECT pg_catalog.jsonb_build_object(
      'userId', v_actor::text,
      'householdId', h.id,
      'householdName', h.name,
      'currencyCode', pg_catalog.upper(h.currency),
      'role', 'owner',
      'membershipVersion', h.membership_version::text
    ) INTO v_context
    FROM public.households AS h
    WHERE h.id = v_household_id AND h.lifecycle_state = 'active';

    IF v_context IS NOT NULL THEN
      RETURN v_context;
    END IF;
  END IF;

  -- Only block if unassigned legacy rows exist without a household_id:
  IF EXISTS (SELECT 1 FROM public.debts AS r WHERE r.user_id = v_actor AND r.household_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.transactions AS r WHERE r.user_id = v_actor AND r.household_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.recurring_bills AS r WHERE r.user_id = v_actor AND r.household_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.reconciliation_anchors AS r WHERE r.user_id = v_actor AND r.household_id IS NULL) THEN
    RAISE EXCEPTION 'Legacy financial data requires migration before continuing' USING ERRCODE = '42501';
  END IF;

  -- Safely create a fresh personal household:
  v_household_id := 'hh-' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public.households (id, name, currency, created_by)
  VALUES (v_household_id, v_name, v_currency, v_actor);
  INSERT INTO public.household_members (household_id, user_id, role, status)
  VALUES (v_household_id, v_actor, 'owner', 'active')
  ON CONFLICT (household_id, user_id) DO UPDATE SET role = 'owner', status = 'active';

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

REVOKE ALL ON FUNCTION public.debtfree_leave_household(text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_leave_household(text, bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_ensure_personal_household(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_ensure_personal_household(text, text) TO authenticated;

-- Immediately recover any existing users stranded with 0 active memberships (e.g. claudine.masilongan@gmail.com, bodindina0829@gmail.com)
DO $$
DECLARE
  r RECORD;
  v_new_hh text;
BEGIN
  FOR r IN (
    SELECT u.id, u.email
    FROM auth.users u
    WHERE NOT EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.user_id = u.id AND hm.status = 'active'
    )
  ) LOOP
    IF EXISTS (
      SELECT 1 FROM public.households h
      WHERE h.created_by = r.id AND h.lifecycle_state = 'active'
    ) THEN
      INSERT INTO public.household_members (household_id, user_id, role, status)
      SELECT h.id, r.id, 'owner', 'active'
      FROM public.households h
      WHERE h.created_by = r.id AND h.lifecycle_state = 'active'
      ORDER BY h.created_at ASC
      LIMIT 1
      ON CONFLICT (household_id, user_id) DO UPDATE SET role = 'owner', status = 'active';
    ELSE
      v_new_hh := 'hh-' || pg_catalog.gen_random_uuid()::text;
      INSERT INTO public.households (id, name, currency, created_by)
      VALUES (v_new_hh, 'My Household', 'USD', r.id);
      INSERT INTO public.household_members (household_id, user_id, role, status)
      VALUES (v_new_hh, r.id, 'owner', 'active')
      ON CONFLICT (household_id, user_id) DO UPDATE SET role = 'owner', status = 'active';
      INSERT INTO public.household_settings (household_id, revision, settings)
      VALUES (
        v_new_hh,
        0,
        pg_catalog.jsonb_build_object(
          'householdId', v_new_hh,
          'householdName', 'My Household',
          'currencyCode', 'USD'
        )
      )
      ON CONFLICT (household_id) DO NOTHING;
    END IF;
  END LOOP;
END $$;

COMMIT;
