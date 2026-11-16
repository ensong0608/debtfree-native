CREATE OR REPLACE FUNCTION public.debtfree_save_settings(p_expected_revision bigint, p_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  current_user_id uuid := (SELECT auth.uid());
  previous_revision bigint;
  previous_profile jsonb;
  normalized jsonb;
BEGIN
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

  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[current_user_id], 'share', false);

  SELECT raw_user_meta_data -> 'debtfree_native_v1',
         public.debtfree_settings_revision(raw_user_meta_data -> 'debtfree_native_v1')
    INTO previous_profile, previous_revision
  FROM auth.users
  WHERE id = current_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;

  IF previous_profile ? 'householdId'
     AND previous_profile ->> 'householdId' IS DISTINCT FROM p_settings ->> 'householdId' THEN
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
  UPDATE auth.users
  SET raw_user_meta_data = pg_catalog.jsonb_set(
    COALESCE(raw_user_meta_data, '{}'::jsonb), '{debtfree_native_v1}', normalized, true
  )
  WHERE id = current_user_id;
  PERFORM pg_catalog.set_config('debtfree.settings_rpc_cas', 'off', true);

  RETURN normalized;
END;
$function$
