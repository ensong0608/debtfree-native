-- Seed only validated legacy envelopes; legacy JSON and household finance remain untouched.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE raw_user_meta_data ? 'debtfree_native_v1'
    AND (jsonb_typeof(raw_user_meta_data->'debtfree_native_v1') IS DISTINCT FROM 'object'
      OR raw_user_meta_data->'debtfree_native_v1'->>'userId' IS DISTINCT FROM id::text
      OR raw_user_meta_data->'debtfree_native_v1'->>'version' IS DISTINCT FROM '1')) THEN
    RAISE EXCEPTION 'Invalid legacy personal envelope';
  END IF;
END $$;

UPDATE auth.users u SET raw_user_meta_data = jsonb_set(u.raw_user_meta_data, '{debtfree_profile_v2}',
  (SELECT COALESCE(jsonb_object_agg(e.key,e.value), '{}'::jsonb)
   FROM jsonb_each(u.raw_user_meta_data->'debtfree_native_v1') e
   WHERE e.key = ANY(ARRAY['userId','version','householdId','settingsRevision','updatedAt','createdAt',
     'currentStage','signupCompleted','onboardingCompleted','goals','referralSource','consideredBeforeAi',
     'managesWithPartner','worksWithProfessional','selectedPlan','notifications','completedAt']))
    || '{"debts":[]}'::jsonb, true)
WHERE u.raw_user_meta_data ? 'debtfree_native_v1' AND NOT (u.raw_user_meta_data ? 'debtfree_profile_v2');

CREATE OR REPLACE FUNCTION public.debtfree_guard_settings_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE old_profile jsonb; new_profile jsonb; before_revision bigint; after_revision bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.raw_user_meta_data ? 'debtfree_profile_v2' THEN
      RAISE EXCEPTION 'DEBTFREE_SETTINGS_PROTECTED' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.raw_user_meta_data->'debtfree_native_v1' IS DISTINCT FROM OLD.raw_user_meta_data->'debtfree_native_v1' THEN
    RAISE EXCEPTION 'DEBTFREE_SETTINGS_PROTECTED: legacy backup is frozen' USING ERRCODE = '23514';
  END IF;
  old_profile := OLD.raw_user_meta_data->'debtfree_profile_v2';
  new_profile := NEW.raw_user_meta_data->'debtfree_profile_v2';
  IF new_profile IS NOT DISTINCT FROM old_profile THEN RETURN NEW; END IF;
  IF new_profile IS NULL OR jsonb_typeof(new_profile) <> 'object' OR
    pg_catalog.current_setting('debtfree.settings_rpc_cas', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'DEBTFREE_SETTINGS_PROTECTED: use atomic settings RPC' USING ERRCODE = '23514';
  END IF;
  before_revision := public.debtfree_settings_revision(old_profile);
  after_revision := public.debtfree_settings_revision(new_profile);
  IF before_revision >= 9223372036854775806 THEN RAISE EXCEPTION 'Settings revision exhausted' USING ERRCODE = '22003'; END IF;
  IF after_revision <> before_revision + 1 THEN RAISE EXCEPTION 'DEBTFREE_SETTINGS_CONFLICT' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER debtfree_profile_insert_guard BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.debtfree_guard_settings_revision();

CREATE OR REPLACE FUNCTION public.debtfree_save_settings(p_expected_revision bigint, p_settings jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE current_user_id uuid := (SELECT auth.uid()); previous_revision bigint; previous_profile jsonb;
  legacy_profile jsonb; normalized jsonb;
BEGIN
  IF current_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision >= 9223372036854775806
    OR p_settings IS NULL OR pg_catalog.jsonb_typeof(p_settings) <> 'object'
    OR p_settings->>'userId' IS DISTINCT FROM current_user_id::text OR p_settings->>'version' IS DISTINCT FROM '1'
    OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_settings) k WHERE NOT (k = ANY(ARRAY[
      'userId','version','householdId','settingsRevision','updatedAt','createdAt','debts',
      'currentStage','signupCompleted','onboardingCompleted','goals','referralSource','consideredBeforeAi',
      'managesWithPartner','worksWithProfessional','selectedPlan','notifications','completedAt'])))
    OR (p_settings ? 'debts' AND p_settings->'debts' IS DISTINCT FROM '[]'::jsonb)
  THEN RAISE EXCEPTION 'Invalid DebtFree settings payload' USING ERRCODE = '22023'; END IF;
  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[current_user_id], 'share', false);
  SELECT raw_user_meta_data->'debtfree_profile_v2', raw_user_meta_data->'debtfree_native_v1',
    public.debtfree_settings_revision(raw_user_meta_data->'debtfree_profile_v2')
    INTO previous_profile, legacy_profile, previous_revision FROM auth.users WHERE id=current_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF COALESCE(legacy_profile, previous_profile) ? 'householdId'
    AND COALESCE(legacy_profile, previous_profile)->>'householdId' IS DISTINCT FROM p_settings->>'householdId'
    THEN RAISE EXCEPTION 'Saved household ownership cannot be changed' USING ERRCODE = '23514'; END IF;
  IF previous_revision <> p_expected_revision THEN RAISE EXCEPTION 'DEBTFREE_SETTINGS_CONFLICT' USING ERRCODE = 'P0001'; END IF;
  normalized := pg_catalog.jsonb_set((p_settings - 'settingsRevision' - 'debts') || '{"debts":[]}'::jsonb,
    '{settingsRevision}', pg_catalog.to_jsonb(previous_revision + 1), true);
  PERFORM pg_catalog.set_config('debtfree.settings_rpc_cas','on',true);
  UPDATE auth.users SET raw_user_meta_data=pg_catalog.jsonb_set(COALESCE(raw_user_meta_data,'{}'::jsonb),
    '{debtfree_profile_v2}',normalized,true) WHERE id=current_user_id;
  PERFORM pg_catalog.set_config('debtfree.settings_rpc_cas','off',true);
  RETURN normalized;
END $$;
CREATE OR REPLACE FUNCTION public.debtfree_internal_build_snapshot(p_actor_id uuid, p_household_id text, p_household_name text, p_currency text, OUT r_snapshot jsonb, OUT r_baseline_token text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_scale integer;
  v_factor numeric;
  v_hs_revision bigint;
  v_hs jsonb;
  v_hs_clean jsonb;
  v_profile jsonb;
  v_envelope jsonb;
  v_debts_json jsonb;
  v_bills_json jsonb;
  v_transactions_json jsonb;
  v_anchors_json jsonb;
  v_onboarding_data jsonb;
  v_state_for_token jsonb;
  v_now_iso text := pg_catalog.to_char(pg_catalog.now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_k text;
BEGIN
  v_scale := public.debtfree_internal_currency_scale(p_currency);
  v_factor := (10 ^ v_scale)::numeric;

  SELECT revision, settings INTO v_hs_revision, v_hs
  FROM public.household_settings
  WHERE household_id = p_household_id;
  IF NOT FOUND OR v_hs IS NULL OR pg_catalog.jsonb_typeof(v_hs) <> 'object' THEN
    RAISE EXCEPTION 'RESTORE_PRECONDITION_FAILED: Household settings not found' USING ERRCODE = '22023';
  END IF;

  SELECT raw_user_meta_data -> 'debtfree_profile_v2' INTO v_profile
  FROM auth.users WHERE id = p_actor_id;
  IF v_profile IS NULL OR pg_catalog.jsonb_typeof(v_profile) <> 'object' THEN
    v_profile := '{}'::jsonb;
  END IF;

  -- Strip optional empty primaryIncomeName so validateNativeBackup never sees "".
  v_hs_clean := v_hs;
  IF (v_hs_clean ? 'primaryIncomeName')
     AND NULLIF(pg_catalog.btrim(COALESCE(v_hs_clean ->> 'primaryIncomeName', '')), '') IS NULL THEN
    v_hs_clean := v_hs_clean - 'primaryIncomeName';
  END IF;
  v_hs_clean := v_hs_clean || pg_catalog.jsonb_build_object(
    'householdId', p_household_id,
    'householdName', p_household_name,
    'currencyCode', p_currency
  );
  IF NOT (v_hs_clean ? 'countryCode') THEN
    v_hs_clean := v_hs_clean || '{"countryCode":"US"}'::jsonb;
  END IF;
  IF NOT (v_hs_clean ? 'primaryPayFrequency') THEN
    v_hs_clean := v_hs_clean || '{"primaryPayFrequency":"monthly"}'::jsonb;
  END IF;
  IF NOT (v_hs_clean ? 'strategy') THEN
    v_hs_clean := v_hs_clean || '{"strategy":"avalanche"}'::jsonb;
  END IF;
  IF NOT (v_hs_clean ? 'primaryMonthlyIncome') THEN
    v_hs_clean := v_hs_clean || '{"primaryMonthlyIncome":0}'::jsonb;
  END IF;
  IF NOT (v_hs_clean ? 'extraMonthlyPayment') THEN
    v_hs_clean := v_hs_clean || '{"extraMonthlyPayment":0}'::jsonb;
  END IF;
  IF NOT (v_hs_clean ? 'additionalIncomes') THEN
    v_hs_clean := v_hs_clean || '{"additionalIncomes":[]}'::jsonb;
  END IF;

  v_envelope := pg_catalog.jsonb_build_object(
    'version', 1,
    'userId', p_actor_id::text,
    'settingsRevision', v_hs_revision,
    'currentStage', CASE
      WHEN v_profile ->> 'currentStage' IN ('welcome','signup_1','signup_2','signup_3','signup_4','onboard_1','onboard_2','onboard_3','onboard_4','onboard_5','home')
      THEN v_profile ->> 'currentStage' ELSE 'home' END,
    'selectedPlan', CASE
      WHEN v_profile ->> 'selectedPlan' IN ('premium','premium_bank_sync')
      THEN v_profile ->> 'selectedPlan' ELSE 'premium' END,
    'homeStatus', CASE
      WHEN v_profile ->> 'homeStatus' IN ('Own','Rent','Other')
      THEN v_profile ->> 'homeStatus' ELSE 'Rent' END,
    'vehicleStatus', CASE
      WHEN v_profile ->> 'vehicleStatus' IN ('Finance','Lease','Own','None')
      THEN v_profile ->> 'vehicleStatus' ELSE 'None' END,
    'createdAt', COALESCE(NULLIF(v_profile ->> 'createdAt', ''), v_now_iso),
    'updatedAt', COALESCE(NULLIF(v_profile ->> 'updatedAt', ''), v_now_iso)
  );
  FOREACH v_k IN ARRAY ARRAY[
    'consideredBeforeAi', 'signupCompleted', 'onboardingCompleted',
    'managesWithPartner', 'worksWithProfessional', 'referralSource',
    'goals', 'notifications', 'completedAt'
  ] LOOP
    IF v_profile ? v_k AND v_profile -> v_k IS NOT NULL THEN
      v_envelope := v_envelope || pg_catalog.jsonb_build_object(v_k, v_profile -> v_k);
    END IF;
  END LOOP;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', d.id::text,
      'name', d.name,
      'category', d.category,
      'balance', d.balance,
      'originalBalance', d.original_balance,
      'apr', d.apr,
      'minimumPayment', d.minimum_payment,
      'dueDay', d.due_day,
      'creditLimit', d.credit_limit,
      'annualFeeAmount', d.annual_fee_amount,
      'annualFeeNextDueDate', d.annual_fee_next_due_date,
      'createdAt', pg_catalog.to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', pg_catalog.to_char(d.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'serverVersion', d.version
    ) ORDER BY d.id::text
  ), '[]'::jsonb)
  INTO v_debts_json
  FROM public.debts d
  WHERE d.household_id = p_household_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'category', b.category,
      'amount', pg_catalog.jsonb_build_object(
        'currency', p_currency,
        'minorUnits', pg_catalog.round(b.amount * v_factor)::bigint
      ),
      'dueDay', b.due_day,
      'paymentMethod', b.payment_method,
      'creditAccountId', b.credit_account_id::text,
      'autoPost', b.auto_post,
      'active', b.active,
      'createdAt', pg_catalog.to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', pg_catalog.to_char(b.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY b.id
  ), '[]'::jsonb)
  INTO v_bills_json
  FROM public.recurring_bills b
  WHERE b.household_id = p_household_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', t.id,
      'accountId', t.account_id::text,
      'date', pg_catalog.to_char(t.date, 'YYYY-MM-DD'),
      'appliesToDate', CASE WHEN t.applies_to_date IS NOT NULL THEN pg_catalog.to_char(t.applies_to_date, 'YYYY-MM-DD') ELSE NULL END,
      'amount', pg_catalog.jsonb_build_object(
        'currency', p_currency,
        'minorUnits', pg_catalog.round(t.amount * v_factor)::bigint
      ),
      'category', t.category,
      'payee', t.payee,
      'memo', t.memo,
      'source', t.source,
      'reconciled', t.reconciled,
      'createdAt', pg_catalog.to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', pg_catalog.to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deletedAt', CASE WHEN t.deleted_at IS NOT NULL THEN pg_catalog.to_char(t.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
      'isPending', false,
      'principalAmount', CASE WHEN t.principal_amount IS NOT NULL THEN pg_catalog.jsonb_build_object('currency', p_currency, 'minorUnits', pg_catalog.round(t.principal_amount * v_factor)::bigint) ELSE NULL END,
      'interestAmount', CASE WHEN t.interest_amount IS NOT NULL THEN pg_catalog.jsonb_build_object('currency', p_currency, 'minorUnits', pg_catalog.round(t.interest_amount * v_factor)::bigint) ELSE NULL END,
      'escrowAmount', CASE WHEN t.escrow_amount IS NOT NULL THEN pg_catalog.jsonb_build_object('currency', p_currency, 'minorUnits', pg_catalog.round(t.escrow_amount * v_factor)::bigint) ELSE NULL END,
      'feeAmount', CASE WHEN t.fee_amount IS NOT NULL THEN pg_catalog.jsonb_build_object('currency', p_currency, 'minorUnits', pg_catalog.round(t.fee_amount * v_factor)::bigint) ELSE NULL END
    ) ORDER BY t.id
  ), '[]'::jsonb)
  INTO v_transactions_json
  FROM public.transactions t
  WHERE t.household_id = p_household_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', a.id,
      'accountId', a.account_id::text,
      'asOfDate', pg_catalog.to_char(a.as_of_date, 'YYYY-MM-DD'),
      'verifiedBalance', pg_catalog.jsonb_build_object(
        'currency', p_currency,
        'minorUnits', pg_catalog.round(a.verified_balance * v_factor)::bigint
      ),
      'createdAt', pg_catalog.to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'note', a.note,
      'createdAdjustmentId', a.created_adjustment_id
    ) ORDER BY a.id
  ), '[]'::jsonb)
  INTO v_anchors_json
  FROM public.reconciliation_anchors a
  WHERE a.household_id = p_household_id;

  v_onboarding_data := pg_catalog.jsonb_set(v_envelope || v_hs_clean, '{debts}', v_debts_json, true);

  r_snapshot := pg_catalog.jsonb_build_object(
    'schema', 'debtfree-native-backup',
    'version', 1,
    'userId', p_actor_id::text,
    'householdId', p_household_id,
    'currency', p_currency,
    'exportedAt', v_now_iso,
    'onboardingData', v_onboarding_data,
    'transactions', v_transactions_json,
    'recurringBills', v_bills_json,
    'reconciliationAnchors', v_anchors_json
  );

  v_state_for_token := pg_catalog.jsonb_build_object(
    'householdId', p_household_id,
    'currency', p_currency,
    'settingsRevision', v_hs_revision,
    'householdSettings', v_hs_clean,
    'debts', v_debts_json,
    'recurringBills', v_bills_json,
    'transactions', v_transactions_json,
    'reconciliationAnchors', v_anchors_json
  );
  r_baseline_token := pg_catalog.md5(v_state_for_token::text);
END;
$function$

