-- T-275: approved forward migration; applied to mobile sandbox as 20261115230945.
-- Compose the existing household authority/CAS contracts in one transaction.
CREATE OR REPLACE FUNCTION public.debtfree_upsert_household_loan_atomic(
  p_household_id text,
  p_expected_membership_version bigint,
  p_debt jsonb,
  p_expected_version bigint,
  p_idempotency_key text,
  p_expected_settings_revision bigint,
  p_settings jsonb,
  p_legacy_bill_proof jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_auth record;
  v_saved_settings jsonb;
  v_saved_debt jsonb;
  v_settings jsonb;
  v_revision bigint;
  v_id text;
  v_schedule jsonb;
  v_last jsonb;
  v_term jsonb;
  v_previous text := '';
  v_scale integer;
  v_escrow numeric;
  v_old_relation jsonb;
  v_new_relation jsonb;
  v_bill record;
  v_first date;
  v_first_term jsonb;
BEGIN
  SELECT * INTO v_auth FROM public.debtfree_internal_finance_authorize(
    p_household_id, p_expected_membership_version, ARRAY['owner', 'admin']
  );
  IF p_debt IS NULL OR p_settings IS NULL OR
     p_debt ->> 'category' NOT IN ('Mortgage', 'Auto loan') THEN
    RAISE EXCEPTION 'Unified save requires a mortgage or auto loan' USING ERRCODE = '22023';
  END IF;
  v_id := (p_debt ->> 'id')::uuid::text;
  SELECT settings, revision INTO v_settings, v_revision
  FROM public.household_settings WHERE household_id = p_household_id FOR UPDATE;
  IF NOT FOUND OR v_revision IS DISTINCT FROM p_expected_settings_revision THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale loan settings revision' USING ERRCODE = '40001';
  END IF;
  -- This endpoint edits only the target loan's schedule, escrow and canonical marker.
  IF (p_settings - ARRAY['obligationSchedules','mortgageEscrowByDebtId','mortgageExtraPaymentByDebtId','loanBillPairingByDebtId','debtPaymentSplitPlansByDebtId','billPaymentSplitPlansByBillId'])
     IS DISTINCT FROM
     (v_settings - ARRAY['obligationSchedules','mortgageEscrowByDebtId','mortgageExtraPaymentByDebtId','loanBillPairingByDebtId','debtPaymentSplitPlansByDebtId','billPaymentSplitPlansByBillId']) THEN
    RAISE EXCEPTION 'Unrelated household settings changed in loan save' USING ERRCODE = '22023';
  END IF;
  IF (COALESCE(p_settings->'obligationSchedules','{}') - ('debt:' || v_id)) IS DISTINCT FROM
     (COALESCE(v_settings->'obligationSchedules','{}') - ('debt:' || v_id))
     OR (COALESCE(p_settings->'mortgageEscrowByDebtId','{}') - v_id) IS DISTINCT FROM
        (COALESCE(v_settings->'mortgageEscrowByDebtId','{}') - v_id)
     OR (COALESCE(p_settings->'mortgageExtraPaymentByDebtId','{}') - v_id) IS DISTINCT FROM
        (COALESCE(v_settings->'mortgageExtraPaymentByDebtId','{}') - v_id)
     OR (COALESCE(p_settings->'loanBillPairingByDebtId','{}') - v_id) IS DISTINCT FROM
        (COALESCE(v_settings->'loanBillPairingByDebtId','{}') - v_id) THEN
    RAISE EXCEPTION 'Unrelated loan settings changed' USING ERRCODE = '22023';
  END IF;
  IF (COALESCE(p_settings->'debtPaymentSplitPlansByDebtId','{}') - v_id) IS DISTINCT FROM
     (COALESCE(v_settings->'debtPaymentSplitPlansByDebtId','{}') - v_id) THEN
    RAISE EXCEPTION 'Unrelated loan split plan changed' USING ERRCODE = '22023';
  END IF;
  v_old_relation := v_settings->'loanBillPairingByDebtId'->v_id;
  v_new_relation := p_settings->'loanBillPairingByDebtId'->v_id;
  IF (v_old_relation - 'canonical') IS DISTINCT FROM (v_new_relation - 'canonical')
     OR (v_new_relation ? 'canonical' AND (pg_catalog.jsonb_typeof(v_new_relation->'canonical') IS DISTINCT FROM 'boolean' OR v_new_relation->>'canonical' <> 'true')) THEN
    RAISE EXCEPTION 'Historical loan identity cannot be detached or reassigned' USING ERRCODE = '22023';
  END IF;
  IF (COALESCE(p_settings->'billPaymentSplitPlansByBillId','{}') - COALESCE(v_old_relation->>'billId','')) IS DISTINCT FROM
     (COALESCE(v_settings->'billPaymentSplitPlansByBillId','{}') - COALESCE(v_old_relation->>'billId','')) THEN
    RAISE EXCEPTION 'Unrelated bill split plan changed' USING ERRCODE = '22023';
  END IF;
  IF v_old_relation->>'status' = 'linked' AND COALESCE((v_old_relation->>'canonical')::boolean,false) = false THEN
    SELECT * INTO v_bill FROM public.recurring_bills
      WHERE id = v_old_relation->>'billId' AND household_id = p_household_id FOR UPDATE;
    IF NOT FOUND OR p_legacy_bill_proof IS NULL THEN
      RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Legacy bill proof is unavailable' USING ERRCODE = '40001';
    END IF;
    IF p_legacy_bill_proof->>'id' IS DISTINCT FROM v_bill.id
       OR (p_legacy_bill_proof->>'updatedAt')::timestamptz IS DISTINCT FROM v_bill.updated_at
       OR p_legacy_bill_proof->>'currency' IS DISTINCT FROM v_auth.r_currency
       OR (p_legacy_bill_proof->>'amountMinor')::numeric IS DISTINCT FROM v_bill.amount * pg_catalog.power(10::numeric, public.debtfree_internal_currency_scale(v_auth.r_currency))
       OR (p_legacy_bill_proof->>'dueDay')::integer IS DISTINCT FROM v_bill.due_day
       OR p_legacy_bill_proof->>'category' IS DISTINCT FROM v_bill.category
       OR p_legacy_bill_proof->>'paymentMethod' IS DISTINCT FROM v_bill.payment_method
       OR (p_legacy_bill_proof->>'active')::boolean IS DISTINCT FROM v_bill.active
       OR v_bill.active IS DISTINCT FROM true OR v_bill.payment_method <> 'debit'
       OR (p_debt->>'category' = 'Auto loan' AND v_bill.category <> 'other_bill')
       OR (p_debt->>'category' = 'Mortgage' AND v_bill.category NOT IN ('housing','other_bill'))
       OR (SELECT count(*) FROM pg_catalog.jsonb_each(COALESCE(v_settings->'loanBillPairingByDebtId','{}')) pair WHERE pair.value->>'status'='linked' AND pair.value->>'billId'=v_bill.id) <> 1 THEN
      RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Legacy bill changed or ownership is ambiguous' USING ERRCODE = '40001';
    END IF;
  END IF;
  v_schedule := p_settings->'obligationSchedules'->('debt:' || v_id);
  IF (p_debt->>'balance')::numeric > 0 AND
     ((p_debt->>'minimum_payment')::numeric <= 0 OR NULLIF(p_debt->>'due_day','') IS NULL OR (p_debt->>'due_day')::integer NOT BETWEEN 1 AND 31
       OR v_schedule IS NULL) THEN
    RAISE EXCEPTION 'Positive loans require a due day and schedule' USING ERRCODE = '23514';
  END IF;
  v_scale := public.debtfree_internal_currency_scale(v_auth.r_currency);
  IF v_schedule IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(v_schedule->'terms') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(v_schedule->'terms') NOT BETWEEN 1 AND 1200
       OR pg_catalog.jsonb_typeof(v_schedule->'acknowledgedPaidCycles') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid loan schedule' USING ERRCODE = '23514';
    END IF;
    IF pg_catalog.jsonb_array_length(v_schedule->'acknowledgedPaidCycles') > 1200 THEN
      RAISE EXCEPTION 'Invalid acknowledgement history' USING ERRCODE='23514';
    END IF;
    v_first := (v_schedule->>'firstDueDate')::date;
    v_first_term := v_schedule->'terms'->0;
    IF v_first IS NULL OR v_first_term->>'effectiveMonth' IS DISTINCT FROM pg_catalog.to_char(v_first,'YYYY-MM')
       OR EXTRACT(DAY FROM v_first)::integer IS DISTINCT FROM LEAST(
         (v_first_term->>'dueDay')::integer,
         EXTRACT(DAY FROM (pg_catalog.date_trunc('month',v_first) + interval '1 month - 1 day'))::integer)
       OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(v_schedule->'acknowledgedPaidCycles') cycle
          WHERE cycle !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR cycle < pg_catalog.to_char(v_first,'YYYY-MM'))
       OR (SELECT count(*) FROM pg_catalog.jsonb_array_elements_text(v_schedule->'acknowledgedPaidCycles'))
          <> (SELECT count(DISTINCT value) FROM pg_catalog.jsonb_array_elements_text(v_schedule->'acknowledgedPaidCycles')) THEN
      RAISE EXCEPTION 'Invalid first due date or acknowledgements' USING ERRCODE='23514';
    END IF;
    FOR v_term IN SELECT value FROM pg_catalog.jsonb_array_elements(v_schedule->'terms') LOOP
      IF NOT (v_term ?& ARRAY['effectiveMonth','dueDay','amount'])
         OR NOT ((v_term->'amount') ?& ARRAY['currency','minorUnits'])
         OR v_term->>'effectiveMonth' !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
         OR v_term->>'effectiveMonth' <= v_previous
         OR (v_term->>'dueDay')::integer NOT BETWEEN 1 AND 31
         OR v_term->'amount'->>'currency' IS DISTINCT FROM v_auth.r_currency
         OR (v_term->'amount'->>'minorUnits')::numeric < 0
         OR (v_term->'amount'->>'minorUnits')::numeric <> pg_catalog.trunc((v_term->'amount'->>'minorUnits')::numeric) THEN
        RAISE EXCEPTION 'Invalid loan schedule terms' USING ERRCODE = '23514';
      END IF;
      v_previous := v_term->>'effectiveMonth';
      v_last := v_term;
    END LOOP;
    IF (p_debt->>'balance')::numeric > 0 AND (
       (v_last->>'dueDay')::integer IS DISTINCT FROM (p_debt->>'due_day')::integer
       OR (v_last->'amount'->>'minorUnits')::numeric IS DISTINCT FROM
          ((p_debt->>'minimum_payment')::numeric * pg_catalog.power(10::numeric, v_scale))) THEN
      RAISE EXCEPTION 'Loan and latest schedule terms must agree' USING ERRCODE = '23514';
    END IF;
  END IF;
  v_escrow := (p_settings->'mortgageEscrowByDebtId'->>v_id)::numeric;
  IF v_escrow IS NOT NULL AND (p_debt->>'category' <> 'Mortgage'
      OR v_escrow < 0 OR v_escrow > (p_debt->>'minimum_payment')::numeric) THEN
    RAISE EXCEPTION 'Mortgage escrow exceeds the payment' USING ERRCODE = '23514';
  END IF;
  v_saved_settings := public.debtfree_save_household_settings(
    p_household_id, p_expected_settings_revision, p_expected_membership_version, p_settings
  );
  IF v_saved_settings->>'status' IS DISTINCT FROM 'saved' THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Loan settings save rejected' USING ERRCODE = '40001';
  END IF;
  v_saved_debt := public.debtfree_upsert_household_debt_atomic(
    p_household_id, p_expected_membership_version, p_debt, p_expected_version, p_idempotency_key
  );
  IF v_saved_debt->>'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Loan save rejected' USING ERRCODE = 'P0001';
  END IF;
  SELECT settings, revision INTO v_settings, v_revision
  FROM public.household_settings WHERE household_id = p_household_id;
  RETURN v_saved_debt || pg_catalog.jsonb_build_object('settings',v_settings,'revision',v_revision);
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_upsert_household_loan_atomic(text,bigint,jsonb,bigint,text,bigint,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_upsert_household_loan_atomic(text,bigint,jsonb,bigint,text,bigint,jsonb,jsonb) TO authenticated;
