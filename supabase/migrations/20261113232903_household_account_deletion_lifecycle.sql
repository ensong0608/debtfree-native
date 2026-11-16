-- Account deletion remains unavailable until the coordinated finance, RLS,
-- trigger, attribution and recovery cutover has been reviewed and verified.
BEGIN;

ALTER TABLE public.debtfree_account_lifecycle ADD COLUMN deletion_request jsonb;
ALTER TABLE public.debtfree_account_lifecycle ADD COLUMN deletion_membership_snapshot jsonb;
ALTER TABLE public.debtfree_account_lifecycle ADD CONSTRAINT debtfree_account_lifecycle_request_check CHECK (
  (deletion_state='active' AND deletion_request IS NULL AND deletion_membership_snapshot IS NULL)
  OR (deletion_state<>'active' AND deletion_request IS NOT NULL AND deletion_membership_snapshot IS NOT NULL
      AND pg_catalog.jsonb_typeof(deletion_request)='object' AND pg_catalog.jsonb_typeof(deletion_membership_snapshot)='array')
);

CREATE TABLE public.debtfree_household_cutover_gate (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.debtfree_household_cutover_gate(singleton, enabled) VALUES (true, false);
ALTER TABLE public.debtfree_household_cutover_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.debtfree_household_cutover_gate FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.debtfree_household_cutover_gate IS
  'Disabled until a separately reviewed integrated shared-finance cutover enables it; never enable merely to bypass deletion preflight.';

CREATE FUNCTION public.debtfree_internal_require_deletion_cutover()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE r record;
BEGIN
  IF NOT COALESCE((SELECT enabled FROM public.debtfree_household_cutover_gate WHERE singleton), false) THEN
    RAISE EXCEPTION 'Shared household deletion cutover is not ready' USING ERRCODE = '55000';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('debts','user_id'), ('transactions','user_id'), ('recurring_bills','user_id'),
    ('reconciliation_anchors','user_id'), ('debtfree_deleted_debt_ids','deleted_user_id'),
    ('debtfree_deleted_bill_ids','user_id')
  ) AS expected(tbl, actor_col) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = pg_catalog.to_regclass('public.' || r.tbl) AND a.attname = 'household_id'
        AND a.atttypid = 'text'::regtype AND a.attnotnull AND NOT a.attisdropped)
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = pg_catalog.to_regclass('public.' || r.tbl) AND a.attname = r.actor_col
        AND a.atttypid = 'uuid'::regtype AND NOT a.attnotnull AND NOT a.attisdropped)
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
         JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attname = r.actor_col
         JOIN pg_catalog.pg_attribute target ON target.attrelid = c.confrelid AND target.attname = 'id'
         WHERE c.conrelid = pg_catalog.to_regclass('public.' || r.tbl) AND c.contype = 'f'
           AND c.confrelid = 'auth.users'::regclass AND c.confdeltype = 'n'
           AND c.conkey = ARRAY[a.attnum]::smallint[] AND c.confkey = ARRAY[target.attnum]::smallint[]) THEN
      RAISE EXCEPTION 'Unsafe Auth actor attribution or nullable household ID in %', r.tbl USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = pg_catalog.to_regclass('public.' || r.tbl) AND c.contype = 'f'
        AND c.confrelid = 'auth.users'::regclass AND c.confdeltype = 'c') THEN
      RAISE EXCEPTION 'Cascading Auth reference remains in %', r.tbl USING ERRCODE = '55000';
    END IF;
    IF pg_catalog.has_table_privilege('authenticated',pg_catalog.to_regclass('public.' || r.tbl),'INSERT')
       OR pg_catalog.has_table_privilege('authenticated',pg_catalog.to_regclass('public.' || r.tbl),'UPDATE')
       OR pg_catalog.has_table_privilege('authenticated',pg_catalog.to_regclass('public.' || r.tbl),'DELETE')
       OR pg_catalog.has_any_column_privilege('authenticated',pg_catalog.to_regclass('public.' || r.tbl),'INSERT')
       OR pg_catalog.has_any_column_privilege('authenticated',pg_catalog.to_regclass('public.' || r.tbl),'UPDATE')
       OR pg_catalog.has_table_privilege('anon',pg_catalog.to_regclass('public.' || r.tbl),'INSERT')
       OR pg_catalog.has_table_privilege('anon',pg_catalog.to_regclass('public.' || r.tbl),'UPDATE')
       OR pg_catalog.has_table_privilege('anon',pg_catalog.to_regclass('public.' || r.tbl),'DELETE')
       OR pg_catalog.has_any_column_privilege('anon',pg_catalog.to_regclass('public.' || r.tbl),'INSERT')
       OR pg_catalog.has_any_column_privilege('anon',pg_catalog.to_regclass('public.' || r.tbl),'UPDATE') THEN
      RAISE EXCEPTION 'Direct client finance mutation remains in %', r.tbl USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid='public.households'::regclass AND a.attname='created_by' AND NOT a.attnotnull AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
       JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attname='created_by'
       JOIN pg_catalog.pg_attribute target ON target.attrelid=c.confrelid AND target.attname='id'
       WHERE c.conrelid='public.households'::regclass AND c.contype='f' AND c.confrelid='auth.users'::regclass
         AND c.confdeltype='n' AND c.conkey=ARRAY[a.attnum]::smallint[] AND c.confkey=ARRAY[target.attnum]::smallint[]) THEN
    RAISE EXCEPTION 'Household creator attribution is not safe for Auth deletion' USING ERRCODE='55000';
  END IF;
  IF pg_catalog.has_table_privilege('authenticated','public.household_profiles','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.household_profiles','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.household_profiles','DELETE')
     OR pg_catalog.has_any_column_privilege('authenticated','public.household_profiles','INSERT')
     OR pg_catalog.has_any_column_privilege('authenticated','public.household_profiles','UPDATE')
     OR pg_catalog.has_table_privilege('anon','public.household_profiles','INSERT')
     OR pg_catalog.has_table_privilege('anon','public.household_profiles','UPDATE')
     OR pg_catalog.has_table_privilege('anon','public.household_profiles','DELETE')
     OR pg_catalog.has_any_column_privilege('anon','public.household_profiles','INSERT')
     OR pg_catalog.has_any_column_privilege('anon','public.household_profiles','UPDATE') THEN
    RAISE EXCEPTION 'Legacy financial profile still permits direct client mutation' USING ERRCODE='55000';
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION public.debtfree_internal_require_deletion_cutover() FROM PUBLIC, anon, authenticated, service_role;

-- A settings document is empty only when every known financial field is absent
-- or has its exact empty/default representation. Unknown or malformed values
-- remain financial state, including nonempty names and nondefault pay frequency.
CREATE FUNCTION public.debtfree_internal_empty_household_settings(p_settings jsonb, p_household_id text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE k text; v jsonb;
BEGIN
  IF p_settings IS NULL OR pg_catalog.jsonb_typeof(p_settings) <> 'object' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_settings) AS x(key) WHERE x.key <> ALL (ARRAY[
    'householdId','householdName','countryCode','currencyCode','householdTimeZone',
    'primaryIncomeName','primaryIncomeAmount','primaryGrossIncomeAmount','primaryPayFrequency',
    'primaryMonthlyIncome','additionalIncomes','strategy','extraMonthlyPayment','obligationSchedules',
    'debtPaymentSplitPlansByDebtId','billPaymentSplitPlansByBillId','mortgageEscrowByDebtId',
    'mortgageExtraPaymentByDebtId','loanBillPairingByDebtId','recurringBillCategoryLabelByBillId','archivedPaidOffDebtIds'
  ]::text[])) THEN RETURN false; END IF;
  IF p_settings ? 'householdId' AND (pg_catalog.jsonb_typeof(p_settings->'householdId') <> 'string' OR p_settings->>'householdId' <> p_household_id) THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['householdName','countryCode','currencyCode','householdTimeZone'] LOOP
    IF p_settings ? k AND (pg_catalog.jsonb_typeof(p_settings->k) <> 'string' OR pg_catalog.btrim(p_settings->>k) = '') THEN RETURN false; END IF;
  END LOOP;
  IF p_settings ? 'householdName' AND pg_catalog.length(p_settings->>'householdName') > 120 THEN RETURN false; END IF;
  IF p_settings ? 'countryCode' AND p_settings->>'countryCode' NOT IN ('US','CA','GB','AU') THEN RETURN false; END IF;
  IF p_settings ? 'currencyCode' AND p_settings->>'currencyCode' !~ '^[A-Za-z]{3}$' THEN RETURN false; END IF;
  IF p_settings ? 'householdTimeZone' AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names t WHERE t.name=p_settings->>'householdTimeZone') THEN RETURN false; END IF;
  IF p_settings ? 'primaryIncomeName' AND (pg_catalog.jsonb_typeof(p_settings->'primaryIncomeName') <> 'string' OR pg_catalog.btrim(p_settings->>'primaryIncomeName') <> '') THEN RETURN false; END IF;
  IF p_settings ? 'primaryPayFrequency' AND (pg_catalog.jsonb_typeof(p_settings->'primaryPayFrequency') <> 'string' OR p_settings->>'primaryPayFrequency' <> 'biweekly') THEN RETURN false; END IF;
  IF p_settings ? 'strategy' AND (pg_catalog.jsonb_typeof(p_settings->'strategy') <> 'string' OR p_settings->>'strategy' <> 'snowball') THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['primaryIncomeAmount','primaryGrossIncomeAmount','primaryMonthlyIncome','extraMonthlyPayment'] LOOP
    IF p_settings ? k THEN
      v := p_settings->k;
      IF k='primaryGrossIncomeAmount' AND v='null'::jsonb THEN CONTINUE; END IF;
      IF pg_catalog.jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric <> 0 THEN RETURN false; END IF;
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['additionalIncomes','archivedPaidOffDebtIds'] LOOP
    IF p_settings ? k AND (pg_catalog.jsonb_typeof(p_settings->k) <> 'array' OR p_settings->k <> '[]'::jsonb) THEN RETURN false; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['obligationSchedules','debtPaymentSplitPlansByDebtId','billPaymentSplitPlansByBillId',
    'mortgageEscrowByDebtId','mortgageExtraPaymentByDebtId','loanBillPairingByDebtId','recurringBillCategoryLabelByBillId'] LOOP
    IF p_settings ? k AND (pg_catalog.jsonb_typeof(p_settings->k) <> 'object' OR p_settings->k <> '{}'::jsonb) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN data_exception THEN RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION public.debtfree_internal_empty_household_settings(jsonb,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.debtfree_internal_assert_empty_legacy_profile(p_account_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_profile public.household_profiles%ROWTYPE; v_extra jsonb;
BEGIN
  SELECT * INTO v_profile FROM public.household_profiles WHERE user_id=p_account_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  v_extra := pg_catalog.to_jsonb(v_profile) - ARRAY['user_id','email','full_name','household_name',
    'monthly_income','monthly_extra_payment','payoff_strategy','onboarding_completed',
    'estimated_debt_free_date','updated_at','created_at']::text[];
  IF v_extra <> '{}'::jsonb OR v_profile.monthly_income IS DISTINCT FROM 0::numeric
     OR v_profile.monthly_extra_payment IS DISTINCT FROM 0::numeric
     OR v_profile.payoff_strategy IS DISTINCT FROM 'snowball'
     OR v_profile.estimated_debt_free_date IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy profile contains financial state or uncertain fields' USING ERRCODE='42501';
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION public.debtfree_internal_assert_empty_legacy_profile(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Caller holds the household finance mutex and the household/membership locks.
CREATE FUNCTION public.debtfree_internal_assert_empty_household(p_household_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_settings jsonb;
BEGIN
  -- Unassigned rows can belong to any household and block destructive deletion.
  IF EXISTS (SELECT 1 FROM public.debts WHERE household_id IS NULL OR household_id = p_household_id)
     OR EXISTS (SELECT 1 FROM public.debtfree_deleted_debt_ids WHERE household_id IS NULL OR household_id = p_household_id)
     OR EXISTS (SELECT 1 FROM public.reconciliation_anchors WHERE household_id IS NULL OR household_id = p_household_id)
     OR EXISTS (SELECT 1 FROM public.recurring_bills WHERE household_id IS NULL OR household_id = p_household_id)
     OR EXISTS (SELECT 1 FROM public.debtfree_deleted_bill_ids WHERE household_id IS NULL OR household_id = p_household_id)
     OR EXISTS (SELECT 1 FROM public.transactions WHERE household_id IS NULL OR household_id = p_household_id)
     OR EXISTS (SELECT 1 FROM public.debtfree_household_invitations WHERE household_id = p_household_id AND status = 'pending' AND expires_at > pg_catalog.clock_timestamp()) THEN
    RAISE EXCEPTION 'Household contains data or unresolved attribution' USING ERRCODE = '42501';
  END IF;
  SELECT settings INTO v_settings FROM public.household_settings WHERE household_id = p_household_id FOR UPDATE;
  IF NOT FOUND OR NOT public.debtfree_internal_empty_household_settings(v_settings, p_household_id) THEN
    RAISE EXCEPTION 'Household contains financial settings or uncertain state' USING ERRCODE = '42501';
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION public.debtfree_internal_assert_empty_household(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.debtfree_get_account_deletion_state(p_account_id uuid, p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v public.debtfree_account_lifecycle%ROWTYPE;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_account_id IS NULL OR p_operation_id IS NULL THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
  SELECT * INTO v FROM public.debtfree_account_lifecycle WHERE account_id=p_account_id;
  IF NOT FOUND OR v.deletion_operation_id IS DISTINCT FROM p_operation_id THEN
    RETURN pg_catalog.jsonb_build_object('status','not_found','operationId',p_operation_id);
  END IF;
  RETURN pg_catalog.jsonb_build_object('status',v.deletion_state,'operationId',p_operation_id,'fenceVersion',v.fence_version::text);
END
$function$;

CREATE FUNCTION public.debtfree_prepare_account_deletion(
  p_account_id uuid, p_operation_id uuid, p_delete_empty_household_ids text[],
  p_expected_membership_versions jsonb, p_pending_commands_clear boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_guard public.debtfree_account_lifecycle%ROWTYPE; v_houses text[]; v_selected text[];
  v_before jsonb; v_after jsonb; v_request jsonb; v_snapshot jsonb; v_house text; v_role text; v_version bigint; v_count integer;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_account_id IS NULL OR p_operation_id IS NULL OR p_pending_commands_clear IS DISTINCT FROM true
     OR p_delete_empty_household_ids IS NULL OR pg_catalog.cardinality(p_delete_empty_household_ids) > 50
     OR pg_catalog.array_position(p_delete_empty_household_ids,NULL) IS NOT NULL
     OR p_expected_membership_versions IS NULL OR pg_catalog.jsonb_typeof(p_expected_membership_versions) <> 'object'
     OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_expected_membership_versions)) > 100
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_delete_empty_household_ids) AS x(id) WHERE x.id='' OR x.id<>pg_catalog.btrim(x.id) OR pg_catalog.length(x.id)>120)
     OR (SELECT count(DISTINCT x.id) FROM pg_catalog.unnest(p_delete_empty_household_ids) AS x(id)) <> pg_catalog.cardinality(p_delete_empty_household_ids)
     OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_expected_membership_versions) AS x(key,value)
       WHERE x.key='' OR x.key<>pg_catalog.btrim(x.key) OR pg_catalog.length(x.key)>120
          OR pg_catalog.jsonb_typeof(x.value)<>'string' OR (x.value #>> '{}') !~ '^[1-9][0-9]*$') THEN
    RAISE EXCEPTION 'Invalid deletion preflight' USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(pg_catalog.array_agg(x.id ORDER BY x.id COLLATE "C"), ARRAY[]::text[]) INTO v_selected
    FROM pg_catalog.unnest(p_delete_empty_household_ids) AS x(id);
  v_request := pg_catalog.jsonb_build_object('selectedHouseholds',pg_catalog.to_jsonb(v_selected),'expectedVersions',p_expected_membership_versions);

  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[p_account_id], 'update', true);
  SELECT * INTO v_guard FROM public.debtfree_account_lifecycle WHERE account_id=p_account_id;
  IF v_guard.deletion_state <> 'active' THEN
    IF v_guard.deletion_operation_id IS DISTINCT FROM p_operation_id OR v_guard.deletion_request IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'Different account deletion operation is outstanding' USING ERRCODE='42501';
    END IF;
    IF v_guard.deletion_state = 'fenced' THEN PERFORM public.debtfree_internal_require_deletion_cutover(); END IF;
    RETURN pg_catalog.jsonb_build_object('status',v_guard.deletion_state,'operationId',p_operation_id,'fenceVersion',v_guard.fence_version::text);
  END IF;
  PERFORM public.debtfree_internal_require_deletion_cutover();
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_account_id) THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;

  SELECT COALESCE(pg_catalog.array_agg(hm.household_id ORDER BY hm.household_id COLLATE "C"), ARRAY[]::text[])
    INTO v_houses FROM public.household_members hm WHERE hm.user_id=p_account_id AND hm.status='active';
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(hm.household_id,hm.user_id,hm.role,hm.status)
    ORDER BY hm.household_id COLLATE "C",hm.user_id),'[]'::jsonb) INTO v_before
    FROM public.household_members hm WHERE hm.household_id = ANY(v_houses);
  IF pg_catalog.cardinality(v_houses)>0 THEN PERFORM public.debtfree_internal_lock_households(v_houses,'update'); END IF;
  PERFORM hm.user_id FROM public.household_members hm WHERE hm.household_id=ANY(v_houses)
    ORDER BY hm.household_id COLLATE "C",hm.user_id FOR UPDATE;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(hm.household_id,hm.user_id,hm.role,hm.status)
    ORDER BY hm.household_id COLLATE "C",hm.user_id),'[]'::jsonb) INTO v_after
    FROM public.household_members hm WHERE hm.household_id = ANY(v_houses);
  IF v_before IS DISTINCT FROM v_after OR v_houses IS DISTINCT FROM
    (SELECT COALESCE(pg_catalog.array_agg(hm.household_id ORDER BY hm.household_id COLLATE "C"), ARRAY[]::text[])
     FROM public.household_members hm WHERE hm.user_id=p_account_id AND hm.status='active') THEN
    RAISE EXCEPTION 'Household participants changed; retry' USING ERRCODE='40001';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_expected_membership_versions)) <> pg_catalog.cardinality(v_houses)
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(v_houses) AS x(id) JOIN public.households h ON h.id=x.id
       WHERE h.lifecycle_state <> 'active' OR p_expected_membership_versions->>x.id IS DISTINCT FROM h.membership_version::text
          OR h.membership_version >= 9223372036854775807)
     OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_expected_membership_versions) AS x(id) WHERE NOT (x.id=ANY(v_houses))) THEN
    RAISE EXCEPTION 'Household membership version changed' USING ERRCODE='40001';
  END IF;
  -- Retained households must keep exactly one active owner. The selected set
  -- must be exactly the caller's owner households and each must be sole-member.
  FOREACH v_house IN ARRAY v_houses LOOP
    SELECT hm.role INTO v_role FROM public.household_members hm WHERE hm.household_id=v_house AND hm.user_id=p_account_id AND hm.status='active';
    SELECT count(*) INTO v_count FROM public.household_members hm WHERE hm.household_id=v_house AND hm.status='active' AND hm.role='owner';
    IF v_count <> 1 THEN RAISE EXCEPTION 'Household ownership is uncertain' USING ERRCODE='42501'; END IF;
    IF v_role='owner' THEN
      IF NOT (v_house=ANY(v_selected)) OR (SELECT count(*) FROM public.household_members hm WHERE hm.household_id=v_house AND hm.status='active') <> 1 THEN
        RAISE EXCEPTION 'Transfer ownership or explicitly delete a sole-member empty household' USING ERRCODE='42501';
      END IF;
    ELSIF v_house=ANY(v_selected) THEN RAISE EXCEPTION 'Only an owner may delete a household' USING ERRCODE='42501'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(v_selected) AS x(id) WHERE NOT (x.id=ANY(v_houses)))
     OR EXISTS (SELECT 1 FROM public.households h WHERE h.created_by=p_account_id
       AND NOT EXISTS (SELECT 1 FROM public.household_members hm WHERE hm.household_id=h.id AND hm.status='active' AND hm.role='owner')) THEN
    RAISE EXCEPTION 'Household ownership is uncertain' USING ERRCODE='42501';
  END IF;
  FOREACH v_house IN ARRAY v_selected LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('debtfree.finance:' || v_house,0));
  END LOOP;
  IF pg_catalog.cardinality(v_selected)>0 THEN PERFORM public.debtfree_internal_assert_empty_legacy_profile(p_account_id); END IF;
  FOREACH v_house IN ARRAY v_selected LOOP
    PERFORM public.debtfree_internal_assert_empty_household(v_house);
  END LOOP;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'householdId',hm.household_id,'role',hm.role,'membershipVersion',h.membership_version::text)
    ORDER BY hm.household_id COLLATE "C"),'[]'::jsonb) INTO v_snapshot
  FROM public.household_members hm JOIN public.households h ON h.id=hm.household_id
  WHERE hm.user_id=p_account_id AND hm.status='active';
  UPDATE public.household_members SET status='revoked' WHERE user_id=p_account_id AND household_id=ANY(v_houses) AND status='active';
  UPDATE public.households h SET membership_version=h.membership_version+1,
    lifecycle_state=CASE WHEN h.id=ANY(v_selected) THEN 'pending_delete' ELSE h.lifecycle_state END,
    pending_delete_operation_id=CASE WHEN h.id=ANY(v_selected) THEN p_operation_id ELSE NULL END,
    pending_delete_version=CASE WHEN h.id=ANY(v_selected) THEN h.membership_version+1 ELSE NULL END
    WHERE h.id=ANY(v_houses);
  UPDATE public.debtfree_account_lifecycle SET deletion_state='fenced', deletion_operation_id=p_operation_id,
    deletion_household_ids=v_selected, deletion_request=v_request, deletion_membership_snapshot=v_snapshot, fence_version=fence_version+1,
    fenced_at=pg_catalog.clock_timestamp(), dispatch_started_at=NULL, updated_at=pg_catalog.clock_timestamp()
    WHERE account_id=p_account_id RETURNING * INTO v_guard;
  RETURN pg_catalog.jsonb_build_object('status','prepared','operationId',p_operation_id,'fenceVersion',v_guard.fence_version::text);
END
$function$;

-- Only a transaction that provably never dispatched Auth may roll back. Any
-- intervening household change makes the saved membership version stale.
CREATE FUNCTION public.debtfree_rollback_undispatched_account_deletion(p_account_id uuid,p_operation_id uuid,p_expected_fence_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v public.debtfree_account_lifecycle%ROWTYPE; v_houses text[]; v_item jsonb; v_house text; v_old_version bigint; v_role text;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_account_id IS NULL OR p_operation_id IS NULL OR p_expected_fence_version IS NULL OR p_expected_fence_version<1 THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[p_account_id],'update',true);
  SELECT * INTO v FROM public.debtfree_account_lifecycle WHERE account_id=p_account_id;
  IF v.deletion_operation_id IS DISTINCT FROM p_operation_id OR v.deletion_state <> 'fenced'
     OR v.dispatch_started_at IS NOT NULL OR v.fence_version <> p_expected_fence_version
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_account_id)
     OR pg_catalog.jsonb_typeof(v.deletion_membership_snapshot) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Undispatched deletion rollback is unavailable' USING ERRCODE='40001';
  END IF;
  SELECT COALESCE(pg_catalog.array_agg(x.item->>'householdId' ORDER BY (x.item->>'householdId') COLLATE "C"),ARRAY[]::text[])
    INTO v_houses FROM pg_catalog.jsonb_array_elements(v.deletion_membership_snapshot) AS x(item);
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v.deletion_membership_snapshot) AS x(item)
      WHERE pg_catalog.jsonb_typeof(x.item)<>'object' OR x.item->>'householdId' IS NULL
        OR x.item->>'role' NOT IN ('owner','admin','viewer') OR x.item->>'membershipVersion' !~ '^[1-9][0-9]{0,18}$')
     OR (SELECT count(DISTINCT x.item->>'householdId') FROM pg_catalog.jsonb_array_elements(v.deletion_membership_snapshot) AS x(item)) <> pg_catalog.cardinality(v_houses)
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(v.deletion_household_ids) AS x(id) WHERE NOT (x.id=ANY(v_houses))) THEN
    RAISE EXCEPTION 'Deletion rollback snapshot is malformed' USING ERRCODE='40001';
  END IF;
  IF pg_catalog.cardinality(v_houses)>0 THEN PERFORM public.debtfree_internal_lock_households(v_houses,'update'); END IF;
  PERFORM hm.user_id FROM public.household_members hm WHERE hm.household_id=ANY(v_houses)
    ORDER BY hm.household_id COLLATE "C",hm.user_id FOR UPDATE;
  FOR v_item IN SELECT item FROM pg_catalog.jsonb_array_elements(v.deletion_membership_snapshot) AS x(item) ORDER BY (item->>'householdId') COLLATE "C" LOOP
    v_house := v_item->>'householdId'; v_role := v_item->>'role'; v_old_version := (v_item->>'membershipVersion')::bigint;
    IF v_old_version >= 9223372036854775806 OR NOT EXISTS (
      SELECT 1 FROM public.households h JOIN public.household_members hm ON hm.household_id=h.id AND hm.user_id=p_account_id
      WHERE h.id=v_house AND h.membership_version=v_old_version+1 AND hm.status='revoked' AND hm.role=v_role
        AND ((v_house=ANY(v.deletion_household_ids) AND v_role='owner' AND h.lifecycle_state='pending_delete'
              AND h.pending_delete_operation_id=p_operation_id AND h.pending_delete_version=h.membership_version)
          OR (NOT (v_house=ANY(v.deletion_household_ids)) AND h.lifecycle_state='active'
              AND h.pending_delete_operation_id IS NULL AND h.pending_delete_version IS NULL))
    ) THEN RAISE EXCEPTION 'Household changed; deletion rollback requires review' USING ERRCODE='40001'; END IF;
  END LOOP;
  UPDATE public.household_members SET status='active' WHERE user_id=p_account_id AND household_id=ANY(v_houses) AND status='revoked';
  UPDATE public.households SET membership_version=membership_version+1,lifecycle_state='active',
    pending_delete_operation_id=NULL,pending_delete_version=NULL WHERE id=ANY(v_houses);
  UPDATE public.debtfree_account_lifecycle SET deletion_state='active',deletion_operation_id=NULL,
    deletion_household_ids=ARRAY[]::text[],deletion_request=NULL,deletion_membership_snapshot=NULL,
    fenced_at=NULL,dispatch_started_at=NULL,fence_version=fence_version+1,updated_at=pg_catalog.clock_timestamp()
    WHERE account_id=p_account_id RETURNING * INTO v;
  RETURN pg_catalog.jsonb_build_object('status','active','operationId',p_operation_id,'fenceVersion',v.fence_version::text);
END
$function$;

CREATE FUNCTION public.debtfree_mark_account_deletion_dispatched(p_account_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v public.debtfree_account_lifecycle%ROWTYPE; v_houses text[]; v_item jsonb; v_house text; v_role text;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_account_id IS NULL OR p_operation_id IS NULL THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[p_account_id],'update',true);
  SELECT * INTO v FROM public.debtfree_account_lifecycle WHERE account_id=p_account_id;
  IF v.deletion_operation_id IS DISTINCT FROM p_operation_id OR v.deletion_state='active' THEN RAISE EXCEPTION 'Deletion operation mismatch' USING ERRCODE='42501'; END IF;
  IF v.deletion_state='fenced' THEN
    PERFORM public.debtfree_internal_require_deletion_cutover();
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_account_id)
       OR pg_catalog.jsonb_typeof(v.deletion_membership_snapshot) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Deletion fence requires reconciliation' USING ERRCODE='40001';
    END IF;
    SELECT COALESCE(pg_catalog.array_agg(x.item->>'householdId' ORDER BY (x.item->>'householdId') COLLATE "C"),ARRAY[]::text[])
      INTO v_houses FROM pg_catalog.jsonb_array_elements(v.deletion_membership_snapshot) AS x(item);
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v.deletion_membership_snapshot) AS x(item)
        WHERE pg_catalog.jsonb_typeof(x.item)<>'object' OR x.item->>'householdId' IS NULL
          OR x.item->>'role' NOT IN ('owner','admin','viewer') OR x.item->>'membershipVersion' !~ '^[1-9][0-9]{0,18}$')
       OR (SELECT count(DISTINCT x.item->>'householdId') FROM pg_catalog.jsonb_array_elements(v.deletion_membership_snapshot) AS x(item)) <> pg_catalog.cardinality(v_houses)
       OR EXISTS (SELECT 1 FROM pg_catalog.unnest(v.deletion_household_ids) AS x(id) WHERE NOT (x.id=ANY(v_houses))) THEN
      RAISE EXCEPTION 'Deletion fence snapshot is malformed' USING ERRCODE='40001';
    END IF;
    IF pg_catalog.cardinality(v_houses)>0 THEN PERFORM public.debtfree_internal_lock_households(v_houses,'update'); END IF;
    PERFORM hm.user_id FROM public.household_members hm WHERE hm.household_id=ANY(v_houses)
      ORDER BY hm.household_id COLLATE "C",hm.user_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.household_members hm WHERE hm.user_id=p_account_id AND hm.status='active') THEN
      RAISE EXCEPTION 'Deletion membership fence changed' USING ERRCODE='40001';
    END IF;
    FOR v_item IN SELECT item FROM pg_catalog.jsonb_array_elements(v.deletion_membership_snapshot) AS x(item) ORDER BY (item->>'householdId') COLLATE "C" LOOP
      v_house := v_item->>'householdId'; v_role := v_item->>'role';
      IF NOT EXISTS (SELECT 1 FROM public.households h JOIN public.household_members hm
          ON hm.household_id=h.id AND hm.user_id=p_account_id
          WHERE h.id=v_house AND hm.status='revoked' AND hm.role=v_role
            AND ((v_house=ANY(v.deletion_household_ids) AND v_role='owner' AND h.lifecycle_state='pending_delete'
                  AND h.pending_delete_operation_id=p_operation_id AND h.pending_delete_version=h.membership_version
                  AND (h.membership_version-1)::text=v_item->>'membershipVersion')
              OR (NOT (v_house=ANY(v.deletion_household_ids)) AND h.lifecycle_state='active'
                  AND (SELECT count(*) FROM public.household_members owner_member
                       WHERE owner_member.household_id=h.id AND owner_member.status='active' AND owner_member.role='owner')=1)))
         OR (v_house=ANY(v.deletion_household_ids) AND EXISTS (SELECT 1 FROM public.household_members hm
               WHERE hm.household_id=v_house AND hm.status='active')) THEN
        RAISE EXCEPTION 'Deletion household fence changed' USING ERRCODE='40001';
      END IF;
    END LOOP;
    FOREACH v_house IN ARRAY v.deletion_household_ids LOOP
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('debtfree.finance:' || v_house,0));
    END LOOP;
    IF pg_catalog.cardinality(v.deletion_household_ids)>0 THEN PERFORM public.debtfree_internal_assert_empty_legacy_profile(p_account_id); END IF;
    FOREACH v_house IN ARRAY v.deletion_household_ids LOOP PERFORM public.debtfree_internal_assert_empty_household(v_house); END LOOP;
    UPDATE public.debtfree_account_lifecycle SET deletion_state='dispatched',dispatch_started_at=pg_catalog.clock_timestamp(),
      fence_version=fence_version+1,updated_at=pg_catalog.clock_timestamp() WHERE account_id=p_account_id RETURNING * INTO v;
    RETURN pg_catalog.jsonb_build_object('status','dispatched','operationId',p_operation_id,'shouldDispatch',true,'fenceVersion',v.fence_version::text);
  END IF;
  RETURN pg_catalog.jsonb_build_object('status',v.deletion_state,'operationId',p_operation_id,'shouldDispatch',false,'fenceVersion',v.fence_version::text);
END
$function$;

CREATE FUNCTION public.debtfree_mark_account_deletion_uncertain(p_account_id uuid,p_operation_id uuid,p_reason_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v public.debtfree_account_lifecycle%ROWTYPE;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_account_id IS NULL OR p_operation_id IS NULL OR p_reason_code IS NULL OR pg_catalog.length(p_reason_code)>100 OR p_reason_code !~ '^[a-z0-9_]+$' THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[p_account_id],'update',true);
  SELECT * INTO v FROM public.debtfree_account_lifecycle WHERE account_id=p_account_id;
  IF v.deletion_operation_id IS DISTINCT FROM p_operation_id OR v.deletion_state NOT IN ('dispatched','uncertain','deleted') THEN RAISE EXCEPTION 'Deletion operation mismatch' USING ERRCODE='42501'; END IF;
  IF v.deletion_state='dispatched' THEN
    UPDATE public.debtfree_account_lifecycle SET deletion_state='uncertain',fence_version=fence_version+1,updated_at=pg_catalog.clock_timestamp()
      WHERE account_id=p_account_id RETURNING * INTO v;
  END IF;
  RETURN pg_catalog.jsonb_build_object('status',v.deletion_state,'operationId',p_operation_id,'fenceVersion',v.fence_version::text);
END
$function$;

CREATE FUNCTION public.debtfree_finalize_account_deletion(p_account_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v public.debtfree_account_lifecycle%ROWTYPE; v_house text;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_account_id IS NULL OR p_operation_id IS NULL THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[p_account_id],'update',true);
  SELECT * INTO v FROM public.debtfree_account_lifecycle WHERE account_id=p_account_id;
  IF v.deletion_operation_id IS DISTINCT FROM p_operation_id THEN RAISE EXCEPTION 'Deletion operation mismatch' USING ERRCODE='42501'; END IF;
  IF v.deletion_state='deleted' THEN RETURN pg_catalog.jsonb_build_object('status','deleted','operationId',p_operation_id,'success',true); END IF;
  IF v.deletion_state NOT IN ('dispatched','uncertain') OR EXISTS (SELECT 1 FROM auth.users WHERE id=p_account_id) THEN
    RAISE EXCEPTION 'Auth deletion is not confirmed' USING ERRCODE='40001';
  END IF;
  IF pg_catalog.cardinality(v.deletion_household_ids)>0 THEN
    PERFORM public.debtfree_internal_lock_households(v.deletion_household_ids,'update');
  END IF;
  PERFORM hm.user_id FROM public.household_members hm WHERE hm.household_id=ANY(v.deletion_household_ids)
    ORDER BY hm.household_id COLLATE "C",hm.user_id FOR UPDATE;
  FOREACH v_house IN ARRAY v.deletion_household_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.households h WHERE h.id=v_house AND h.lifecycle_state='pending_delete'
        AND h.pending_delete_operation_id=p_operation_id AND h.pending_delete_version=h.membership_version)
       OR EXISTS (SELECT 1 FROM public.household_members hm WHERE hm.household_id=v_house AND hm.status='active') THEN
      RAISE EXCEPTION 'Pending household deletion changed; reconciliation required' USING ERRCODE='40001';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('debtfree.finance:' || v_house,0));
  END LOOP;
  FOREACH v_house IN ARRAY v.deletion_household_ids LOOP
    PERFORM public.debtfree_internal_assert_empty_household(v_house);
    DELETE FROM public.households WHERE id=v_house AND lifecycle_state='pending_delete' AND pending_delete_operation_id=p_operation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pending household deletion changed' USING ERRCODE='40001'; END IF;
  END LOOP;
  UPDATE public.debtfree_account_lifecycle SET deletion_state='deleted',fence_version=fence_version+1,updated_at=pg_catalog.clock_timestamp()
    WHERE account_id=p_account_id;
  RETURN pg_catalog.jsonb_build_object('status','deleted','operationId',p_operation_id,'success',true);
END
$function$;

REVOKE ALL ON FUNCTION public.debtfree_get_account_deletion_state(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.debtfree_prepare_account_deletion(uuid,uuid,text[],jsonb,boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.debtfree_mark_account_deletion_dispatched(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.debtfree_mark_account_deletion_uncertain(uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.debtfree_finalize_account_deletion(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.debtfree_rollback_undispatched_account_deletion(uuid,uuid,bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.debtfree_get_account_deletion_state(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.debtfree_prepare_account_deletion(uuid,uuid,text[],jsonb,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.debtfree_mark_account_deletion_dispatched(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.debtfree_mark_account_deletion_uncertain(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.debtfree_finalize_account_deletion(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.debtfree_rollback_undispatched_account_deletion(uuid,uuid,bigint) TO service_role;

COMMIT;
