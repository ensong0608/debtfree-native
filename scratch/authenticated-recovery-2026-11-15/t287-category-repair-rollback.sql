-- T-287 live rollback verification. Uses two synthetic rows inside this explicit
-- transaction; ROLLBACK removes both row writes and the temporary role changes.
BEGIN;
DO $t287$
DECLARE
  v_actor uuid;
  v_household_id text;
  v_membership_version bigint;
  v_foreign_household_id text;
  v_foreign_membership_version bigint;
  v_debt_id uuid := gen_random_uuid();
  v_admin_debt_id uuid := gen_random_uuid();
  v_before public.debts%ROWTYPE;
  v_after public.debts%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT hm.user_id, hm.household_id, h.membership_version
    INTO v_actor, v_household_id, v_membership_version
  FROM public.household_members hm
  JOIN public.households h ON h.id = hm.household_id
  WHERE h.lifecycle_state = 'active' AND hm.status = 'active' AND hm.role = 'owner'
  ORDER BY h.created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'T287 owner rollback fixture unavailable'; END IF;

  SELECT h.id, h.membership_version
    INTO v_foreign_household_id, v_foreign_membership_version
  FROM public.households h
  JOIN public.household_members hm ON hm.household_id = h.id AND hm.status = 'active' AND hm.role = 'owner'
  WHERE h.lifecycle_state = 'active' AND h.id <> v_household_id AND hm.user_id <> v_actor
  ORDER BY h.created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'T287 foreign-household rollback fixture unavailable'; END IF;

  INSERT INTO public.debts (
    id,user_id,name,balance,apr,minimum_payment,priority_order,updated_at,created_at,
    original_balance,credit_limit,household_id,category,due_day,version,
    annual_fee_amount,annual_fee_next_due_date
  ) VALUES (
    v_debt_id,v_actor,'T287 rollback category repair test',1234.56,17.25,45.67,3,
    '2026-02-03T04:05:06Z','2025-12-01T02:03:04Z',1500.00,5000.00,
    v_household_id,NULL,14,3,NULL,NULL
  ) RETURNING * INTO v_before;

  INSERT INTO public.debts (
    id,user_id,name,balance,apr,minimum_payment,priority_order,updated_at,created_at,
    original_balance,credit_limit,household_id,category,due_day,version,
    annual_fee_amount,annual_fee_next_due_date
  ) VALUES (
    v_admin_debt_id,v_actor,'T287 rollback admin repair test',2345.67,19.50,56.78,4,
    '2026-02-03T04:05:06Z','2025-11-01T02:03:04Z',2700.00,6000.00,
    v_household_id,'unsupported-legacy-category',14,1,NULL,NULL
  );

  PERFORM pg_catalog.set_config('request.jwt.claim.sub',v_actor::text,true);
  PERFORM pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);

  v_result := public.debtfree_repair_debt_category(v_household_id,v_membership_version,v_debt_id,3,'Credit card');
  IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->>'category' IS DISTINCT FROM 'Credit card'
     OR (v_result->>'version')::bigint <> 4 THEN
    RAISE EXCEPTION 'T287 owner repair receipt incorrect: %',v_result;
  END IF;
  SELECT * INTO v_after FROM public.debts WHERE id=v_debt_id AND household_id=v_household_id;
  IF v_after.category IS DISTINCT FROM 'Credit card' OR v_after.version <> 4
     OR v_after.updated_at = v_before.updated_at
     OR (pg_catalog.to_jsonb(v_after)-'category'-'version'-'updated_at') IS DISTINCT FROM
        (pg_catalog.to_jsonb(v_before)-'category'-'version'-'updated_at') THEN
    RAISE EXCEPTION 'T287 owner repair changed unexpected debt fields';
  END IF;

  BEGIN
    PERFORM public.debtfree_repair_debt_category(v_household_id,v_membership_version,v_debt_id,3,'Credit card');
    RAISE EXCEPTION 'T287 expected stale debt version rejection';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;

  BEGIN
    PERFORM public.debtfree_repair_debt_category(v_foreign_household_id,v_foreign_membership_version,v_debt_id,3,'Credit card');
    RAISE EXCEPTION 'T287 expected foreign household rejection';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  UPDATE public.household_members SET role='admin'
    WHERE household_id=v_household_id AND user_id=v_actor AND status='active' AND role='owner';
  IF NOT FOUND THEN RAISE EXCEPTION 'T287 could not set transaction-local admin fixture'; END IF;
  v_result := public.debtfree_repair_debt_category(v_household_id,v_membership_version,v_admin_debt_id,1,'Mortgage');
  IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->>'category' IS DISTINCT FROM 'Mortgage'
     OR (v_result->>'version')::bigint <> 2 THEN
    RAISE EXCEPTION 'T287 admin repair receipt incorrect: %',v_result;
  END IF;

  UPDATE public.household_members SET role='viewer'
    WHERE household_id=v_household_id AND user_id=v_actor AND status='active' AND role='admin';
  IF NOT FOUND THEN RAISE EXCEPTION 'T287 could not set transaction-local viewer fixture'; END IF;
  BEGIN
    PERFORM public.debtfree_repair_debt_category(v_household_id,v_membership_version,v_admin_debt_id,2,'Mortgage');
    RAISE EXCEPTION 'T287 expected viewer rejection';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  IF NOT pg_catalog.has_function_privilege('authenticated','public.debtfree_repair_debt_category(text,bigint,uuid,bigint,text)','EXECUTE')
     OR pg_catalog.has_function_privilege('anon','public.debtfree_repair_debt_category(text,bigint,uuid,bigint,text)','EXECUTE')
     OR pg_catalog.has_function_privilege('public','public.debtfree_repair_debt_category(text,bigint,uuid,bigint,text)','EXECUTE') THEN
    RAISE EXCEPTION 'T287 function execute grants are not restricted to authenticated';
  END IF;
END;
$t287$;
ROLLBACK;
