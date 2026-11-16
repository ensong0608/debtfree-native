-- ============================================================================
-- Atomic Unified Loan Save & Historical Alias Delete Hardening (T-275)
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.debtfree_save_unified_loan_atomic(
  p_household_id text,
  p_expected_membership_version bigint,
  p_debt jsonb,
  p_expected_version bigint DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_expected_settings_revision bigint DEFAULT NULL,
  p_settings_patch jsonb DEFAULT NULL,
  p_sync_linked_bill jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth record;
  v_id uuid;
  v_idem_uuid uuid;
  v_name text;
  v_category text;
  v_balance numeric(18, 4);
  v_apr numeric(6, 3);
  v_minimum numeric(18, 4);
  v_original numeric(18, 4);
  v_limit numeric(18, 4);
  v_due integer;
  v_annual_fee numeric(18, 4);
  v_annual_fee_next_due date;
  v_existing public.debts%ROWTYPE;
  v_saved public.debts%ROWTYPE;
  v_debt_exists boolean := false;
  v_debt_matched boolean := false;

  v_settings_revision bigint;
  v_settings jsonb;
  v_next_settings jsonb;
  v_pairings jsonb;
  v_pair_entry jsonb;
  v_pair_status text;
  v_linked_bill_id text := NULL;

  v_sched_key text;
  v_sched_val jsonb;
  v_rem_key text;
  v_escrow_obj jsonb;
  v_escrow_action text;
  v_escrow_amount numeric(18, 4);
  v_escrow_map jsonb;
  v_extra_map jsonb;
  v_existing_escrow_text text;

  v_sync_bill_id text;
  v_sync_bill_name text;
  v_sync_bill_amount numeric(18, 4);
  v_sync_bill_due integer;
  v_expected_bill_updated_at timestamptz;
  v_existing_bill public.recurring_bills%ROWTYPE;
  v_saved_bill public.recurring_bills%ROWTYPE;
  v_bill_matched boolean := true;
  v_bill_updated boolean := false;
BEGIN
  SELECT * INTO v_auth
  FROM public.debtfree_internal_finance_authorize(
    p_household_id, p_expected_membership_version, ARRAY['owner', 'admin']
  );

  IF p_debt IS NULL OR pg_catalog.jsonb_typeof(p_debt) <> 'object' THEN
    RAISE EXCEPTION 'Debt payload is required' USING ERRCODE = '22023';
  END IF;
  IF p_debt ? 'household_id'
     AND NULLIF(pg_catalog.btrim(p_debt ->> 'household_id'), '') IS NOT NULL
     AND (p_debt ->> 'household_id') IS DISTINCT FROM p_household_id THEN
    RAISE EXCEPTION 'Debt household mismatch' USING ERRCODE = '42501';
  END IF;

  v_id := NULLIF(pg_catalog.btrim(COALESCE(p_debt ->> 'id', '')), '')::uuid;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Debt ID is required' USING ERRCODE = '23502';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    v_idem_uuid := NULLIF(pg_catalog.btrim(p_idempotency_key), '')::uuid;
    IF v_idem_uuid IS DISTINCT FROM v_id THEN
      RAISE EXCEPTION 'Debt ID must match idempotency key' USING ERRCODE = '23514';
    END IF;
  END IF;

  v_name := pg_catalog.btrim(COALESCE(p_debt ->> 'name', ''));
  v_category := pg_catalog.btrim(COALESCE(p_debt ->> 'category', ''));
  v_balance := (p_debt ->> 'balance')::numeric(18, 4);
  v_apr := (p_debt ->> 'apr')::numeric(6, 3);
  v_minimum := (p_debt ->> 'minimum_payment')::numeric(18, 4);
  v_original := NULLIF(pg_catalog.btrim(COALESCE(p_debt ->> 'original_balance', '')), '')::numeric(18, 4);
  v_limit := NULLIF(pg_catalog.btrim(COALESCE(p_debt ->> 'credit_limit', '')), '')::numeric(18, 4);
  v_due := NULLIF(pg_catalog.btrim(COALESCE(p_debt ->> 'due_day', '')), '')::integer;
  v_annual_fee := NULLIF(pg_catalog.btrim(COALESCE(p_debt ->> 'annual_fee_amount', '')), '')::numeric(18, 4);
  v_annual_fee_next_due := NULLIF(pg_catalog.btrim(COALESCE(p_debt ->> 'annual_fee_next_due_date', '')), '')::date;

  IF v_name = '' OR pg_catalog.length(v_name) > 200
     OR v_category NOT IN ('Mortgage', 'Auto loan', 'Credit card', 'Personal loan', 'Student loan', 'Medical debt', 'Other loan')
     OR v_balance IS NULL OR v_apr IS NULL OR NOT (v_apr BETWEEN 0 AND 100)
     OR v_minimum IS NULL OR v_minimum < 0
     OR (v_original IS NOT NULL AND v_original < 0)
     OR (v_limit IS NOT NULL AND v_limit < 0)
     OR (v_due IS NOT NULL AND NOT (v_due BETWEEN 1 AND 31))
     OR ((v_annual_fee IS NULL) <> (v_annual_fee_next_due IS NULL))
     OR (v_annual_fee IS NOT NULL AND (v_annual_fee <= 0 OR v_category <> 'Credit card')) THEN
    RAISE EXCEPTION 'Debt contains invalid financial fields' USING ERRCODE = '23514';
  END IF;

  SELECT hs.revision, hs.settings
    INTO v_settings_revision, v_settings
  FROM public.household_settings AS hs
  WHERE hs.household_id = p_household_id
  FOR UPDATE;
  IF NOT FOUND OR v_settings IS NULL OR pg_catalog.jsonb_typeof(v_settings) <> 'object' THEN
    RAISE EXCEPTION 'Household settings unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing
  FROM public.debts
  WHERE id = v_id
  FOR UPDATE;
  v_debt_exists := FOUND;

  IF v_debt_exists THEN
    IF v_existing.household_id IS DISTINCT FROM p_household_id THEN
      RAISE EXCEPTION 'Debt identity belongs to another household' USING ERRCODE = '23505';
    END IF;
    v_debt_matched := (
      v_existing.name IS NOT DISTINCT FROM v_name
      AND v_existing.category IS NOT DISTINCT FROM v_category
      AND v_existing.balance IS NOT DISTINCT FROM v_balance
      AND v_existing.apr IS NOT DISTINCT FROM v_apr
      AND v_existing.minimum_payment IS NOT DISTINCT FROM v_minimum
      AND v_existing.original_balance IS NOT DISTINCT FROM v_original
      AND v_existing.credit_limit IS NOT DISTINCT FROM v_limit
      AND v_existing.due_day IS NOT DISTINCT FROM v_due
      AND v_existing.annual_fee_amount IS NOT DISTINCT FROM v_annual_fee
      AND v_existing.annual_fee_next_due_date IS NOT DISTINCT FROM v_annual_fee_next_due
    );
  END IF;

  -- Enforce settings optimistic concurrency before mutating debts.
  -- Allow +1 revision on INSERT idempotent retry so callers retrying after uncertain transport
  -- do not spuriously fail CAS if nothing further changes.
  IF p_expected_settings_revision IS NOT NULL
     AND v_settings_revision IS DISTINCT FROM p_expected_settings_revision
     AND NOT (p_expected_version IS NULL AND v_debt_matched AND v_settings_revision = p_expected_settings_revision + 1) THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Household settings changed concurrently'
      USING ERRCODE = 'P0001';
  END IF;

  -- Resolve historical bill alias (if uniquely linked) to guard category transitions cleanly.
  v_pairings := v_settings -> 'loanBillPairingByDebtId';
  IF pg_catalog.jsonb_typeof(v_pairings) = 'object' THEN
    v_pair_entry := v_pairings -> (v_id::text);
    v_pair_status := v_pair_entry ->> 'status';
    IF v_pair_status = 'linked'
       AND NULLIF(pg_catalog.btrim(COALESCE(v_pair_entry ->> 'billId', '')), '') IS NOT NULL THEN
      IF (
        SELECT count(*) = 1
        FROM pg_catalog.jsonb_each(v_pairings) AS pair(key, value)
        WHERE pair.value ->> 'status' = 'linked'
          AND pair.value ->> 'billId' = (v_pair_entry ->> 'billId')
      ) THEN
        v_linked_bill_id := v_pair_entry ->> 'billId';
      END IF;
    END IF;
  END IF;

  IF v_pair_status = 'linked' THEN
    IF v_category NOT IN ('Mortgage', 'Auto loan') THEN
      RAISE EXCEPTION 'Cannot change category of a debt with historical linked bill history'
        USING ERRCODE = '23514';
    END IF;
    IF v_linked_bill_id IS NOT NULL THEN
      SELECT * INTO v_existing_bill
      FROM public.recurring_bills AS bill
      WHERE bill.id = v_linked_bill_id
        AND bill.household_id = p_household_id;
      IF FOUND AND v_category = 'Auto loan' AND v_existing_bill.category <> 'other_bill' THEN
        RAISE EXCEPTION 'Auto loan cannot remain paired to a housing bill'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  -- Schedule completeness: new active Mortgage/Auto loan or active loan with existing due_day requires due_day 1..31.
  IF v_category IN ('Mortgage', 'Auto loan') AND v_balance > 0 AND v_due IS NULL THEN
    IF NOT v_debt_exists OR v_existing.due_day IS NOT NULL THEN
      RAISE EXCEPTION 'A due day between 1 and 31 is required for active Mortgage and Auto loans'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_debt_exists THEN
    IF p_expected_version IS NULL THEN
      IF NOT v_debt_matched THEN
        RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Debt already exists with different fields'
          USING ERRCODE = '23505';
      END IF;
      v_saved := v_existing;
    ELSE
      IF p_expected_version < 1 THEN
        RAISE EXCEPTION 'Invalid expected debt version' USING ERRCODE = '22023';
      END IF;
      IF v_existing.version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale debt revision' USING ERRCODE = 'P0001';
      END IF;
      IF v_debt_matched THEN
        v_saved := v_existing;
      ELSE
        UPDATE public.debts
        SET name = v_name,
            category = v_category,
            balance = v_balance,
            apr = v_apr,
            minimum_payment = v_minimum,
            original_balance = v_original,
            credit_limit = v_limit,
            due_day = v_due,
            annual_fee_amount = v_annual_fee,
            annual_fee_next_due_date = v_annual_fee_next_due,
            updated_at = pg_catalog.now()
        WHERE id = v_id AND household_id = p_household_id
        RETURNING * INTO v_saved;
      END IF;
    END IF;
  ELSE
    IF p_expected_version IS NOT NULL THEN
      RAISE EXCEPTION 'Debt not found or was deleted' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.debts (
      id, user_id, household_id, name, category, balance,
      original_balance, apr, minimum_payment, due_day, credit_limit,
      annual_fee_amount, annual_fee_next_due_date, created_at, updated_at, version
    ) VALUES (
      v_id, v_auth.r_actor, p_household_id, v_name, v_category, v_balance,
      v_original, v_apr, v_minimum, v_due, v_limit,
      v_annual_fee, v_annual_fee_next_due, pg_catalog.now(), pg_catalog.now(), 1
    )
    RETURNING * INTO v_saved;
  END IF;

  -- Re-read household_settings so AFTER UPDATE triggers (e.g., reopened debt unarchive) are preserved.
  SELECT hs.revision, hs.settings
    INTO v_settings_revision, v_settings
  FROM public.household_settings AS hs
  WHERE hs.household_id = p_household_id
  FOR UPDATE;

  v_next_settings := v_settings;

  IF p_settings_patch IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_settings_patch) <> 'object' THEN
      RAISE EXCEPTION 'Invalid settings patch payload' USING ERRCODE = '22023';
    END IF;

    IF p_settings_patch ? 'obligationSchedules' THEN
      IF pg_catalog.jsonb_typeof(p_settings_patch -> 'obligationSchedules') <> 'object' THEN
        RAISE EXCEPTION 'obligationSchedules patch must be an object' USING ERRCODE = '22023';
      END IF;
      IF pg_catalog.jsonb_typeof(v_next_settings -> 'obligationSchedules') IS DISTINCT FROM 'object' THEN
        v_next_settings := pg_catalog.jsonb_set(v_next_settings, ARRAY['obligationSchedules'], '{}'::jsonb, true);
      END IF;
      FOR v_sched_key, v_sched_val IN
        SELECT key, value FROM pg_catalog.jsonb_each(p_settings_patch -> 'obligationSchedules')
      LOOP
        IF v_sched_key IS DISTINCT FROM ('debt:' || v_id::text)
           AND (v_linked_bill_id IS NULL OR v_sched_key IS DISTINCT FROM ('bill:' || v_linked_bill_id)) THEN
          RAISE EXCEPTION 'Schedule patch key % is not scoped to debt %', v_sched_key, v_id
            USING ERRCODE = '23514';
        END IF;
        IF pg_catalog.jsonb_typeof(v_sched_val) <> 'object' THEN
          RAISE EXCEPTION 'Schedule entry for % must be an object', v_sched_key
            USING ERRCODE = '22023';
        END IF;
        v_next_settings := pg_catalog.jsonb_set(
          v_next_settings,
          ARRAY['obligationSchedules', v_sched_key],
          v_sched_val,
          true
        );
      END LOOP;
    END IF;

    IF p_settings_patch ? 'removeScheduleKeys' THEN
      IF pg_catalog.jsonb_typeof(p_settings_patch -> 'removeScheduleKeys') <> 'array' THEN
        RAISE EXCEPTION 'removeScheduleKeys patch must be an array' USING ERRCODE = '22023';
      END IF;
      IF pg_catalog.jsonb_typeof(v_next_settings -> 'obligationSchedules') = 'object' THEN
        FOR v_rem_key IN
          SELECT item.value #>> '{}'
          FROM pg_catalog.jsonb_array_elements(p_settings_patch -> 'removeScheduleKeys') AS item(value)
        LOOP
          IF v_rem_key IS DISTINCT FROM ('debt:' || v_id::text)
             AND (v_linked_bill_id IS NULL OR v_rem_key IS DISTINCT FROM ('bill:' || v_linked_bill_id)) THEN
            RAISE EXCEPTION 'Remove schedule key % is not scoped to debt %', v_rem_key, v_id
              USING ERRCODE = '23514';
          END IF;
          v_next_settings := pg_catalog.jsonb_set(
            v_next_settings,
            ARRAY['obligationSchedules'],
            (v_next_settings -> 'obligationSchedules') - v_rem_key,
            true
          );
        END LOOP;
      END IF;
    END IF;

    IF p_settings_patch ? 'mortgageEscrow' AND (p_settings_patch -> 'mortgageEscrow') IS NOT NULL THEN
      v_escrow_obj := p_settings_patch -> 'mortgageEscrow';
      IF pg_catalog.jsonb_typeof(v_escrow_obj) <> 'object' THEN
        RAISE EXCEPTION 'mortgageEscrow patch must be an object' USING ERRCODE = '22023';
      END IF;
      v_escrow_action := v_escrow_obj ->> 'action';
      v_escrow_map := COALESCE(v_next_settings -> 'mortgageEscrowByDebtId', '{}'::jsonb);
      IF pg_catalog.jsonb_typeof(v_escrow_map) <> 'object' THEN
        v_escrow_map := '{}'::jsonb;
      END IF;
      IF v_escrow_action = 'set' THEN
        IF v_category <> 'Mortgage' THEN
          RAISE EXCEPTION 'Escrow applies only to Mortgage loans' USING ERRCODE = '23514';
        END IF;
        v_escrow_amount := (v_escrow_obj ->> 'amount')::numeric(18, 4);
        IF v_escrow_amount IS NULL OR v_escrow_amount < 0 OR v_escrow_amount > v_minimum THEN
          RAISE EXCEPTION 'Escrow cannot exceed the monthly mortgage payment or be negative'
            USING ERRCODE = '23514';
        END IF;
        v_escrow_map := pg_catalog.jsonb_set(
          v_escrow_map,
          ARRAY[v_id::text],
          pg_catalog.to_jsonb(v_escrow_amount),
          true
        );
        v_next_settings := pg_catalog.jsonb_set(v_next_settings, ARRAY['mortgageEscrowByDebtId'], v_escrow_map, true);
      ELSIF v_escrow_action = 'remove' THEN
        v_next_settings := pg_catalog.jsonb_set(
          v_next_settings,
          ARRAY['mortgageEscrowByDebtId'],
          v_escrow_map - v_id::text,
          true
        );
      ELSE
        RAISE EXCEPTION 'Unsupported mortgageEscrow action' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF COALESCE((p_settings_patch ->> 'removeMortgageExtra')::boolean, false) IS TRUE THEN
      IF pg_catalog.jsonb_typeof(v_next_settings -> 'mortgageExtraPaymentByDebtId') = 'object' THEN
        v_next_settings := pg_catalog.jsonb_set(
          v_next_settings,
          ARRAY['mortgageExtraPaymentByDebtId'],
          (v_next_settings -> 'mortgageExtraPaymentByDebtId') - v_id::text,
          true
        );
      END IF;
    END IF;
  END IF;

  -- Clean up mortgage-only settings when category is not Mortgage, and enforce escrow <= minimum otherwise.
  IF v_category <> 'Mortgage' THEN
    IF pg_catalog.jsonb_typeof(v_next_settings -> 'mortgageEscrowByDebtId') = 'object' THEN
      v_next_settings := pg_catalog.jsonb_set(
        v_next_settings,
        ARRAY['mortgageEscrowByDebtId'],
        (v_next_settings -> 'mortgageEscrowByDebtId') - v_id::text,
        true
      );
    END IF;
    IF pg_catalog.jsonb_typeof(v_next_settings -> 'mortgageExtraPaymentByDebtId') = 'object' THEN
      v_next_settings := pg_catalog.jsonb_set(
        v_next_settings,
        ARRAY['mortgageExtraPaymentByDebtId'],
        (v_next_settings -> 'mortgageExtraPaymentByDebtId') - v_id::text,
        true
      );
    END IF;
  ELSE
    IF pg_catalog.jsonb_typeof(v_next_settings -> 'mortgageEscrowByDebtId') = 'object'
       AND (v_next_settings -> 'mortgageEscrowByDebtId') ? (v_id::text) THEN
      v_existing_escrow_text := (v_next_settings -> 'mortgageEscrowByDebtId') ->> (v_id::text);
      IF NULLIF(pg_catalog.btrim(COALESCE(v_existing_escrow_text, '')), '') IS NOT NULL THEN
        IF v_existing_escrow_text::numeric(18, 4) > v_minimum OR v_existing_escrow_text::numeric(18, 4) < 0 THEN
          RAISE EXCEPTION 'Escrow cannot exceed the monthly mortgage payment' USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  END IF;

  IF p_sync_linked_bill IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_sync_linked_bill) <> 'object' THEN
      RAISE EXCEPTION 'Invalid linked bill sync payload' USING ERRCODE = '22023';
    END IF;
    v_sync_bill_id := NULLIF(pg_catalog.btrim(COALESCE(p_sync_linked_bill ->> 'billId', '')), '');
    IF v_linked_bill_id IS NULL OR v_sync_bill_id IS DISTINCT FROM v_linked_bill_id THEN
      RAISE EXCEPTION 'Linked recurring bill ID does not match active loan pairing' USING ERRCODE = '23514';
    END IF;

    v_sync_bill_name := pg_catalog.btrim(COALESCE(p_sync_linked_bill ->> 'name', ''));
    v_sync_bill_amount := (p_sync_linked_bill ->> 'amount')::numeric(18, 4);
    v_sync_bill_due := (p_sync_linked_bill ->> 'dueDay')::integer;
    v_expected_bill_updated_at := NULLIF(pg_catalog.btrim(COALESCE(p_sync_linked_bill ->> 'expectedUpdatedAt', '')), '')::timestamptz;

    IF v_sync_bill_name = '' OR pg_catalog.length(v_sync_bill_name) > 200
       OR v_sync_bill_amount IS NULL OR v_sync_bill_amount <= 0
       OR v_sync_bill_due IS NULL OR NOT (v_sync_bill_due BETWEEN 1 AND 31) THEN
      RAISE EXCEPTION 'Linked recurring bill sync fields are invalid' USING ERRCODE = '23514';
    END IF;

    SELECT * INTO v_existing_bill
    FROM public.recurring_bills
    WHERE id = v_sync_bill_id
      AND household_id = p_household_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked recurring bill not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT v_existing_bill.active
       OR v_existing_bill.payment_method <> 'debit'
       OR NOT (
         (v_category = 'Mortgage' AND v_existing_bill.category IN ('housing', 'other_bill'))
         OR (v_category = 'Auto loan' AND v_existing_bill.category = 'other_bill')
       ) THEN
      RAISE EXCEPTION 'Linked recurring bill is incompatible with loan' USING ERRCODE = '23514';
    END IF;

    v_bill_matched := (
      v_existing_bill.name = v_sync_bill_name
      AND v_existing_bill.amount = v_sync_bill_amount
      AND v_existing_bill.due_day = v_sync_bill_due
    );

    IF v_bill_matched THEN
      v_saved_bill := v_existing_bill;
    ELSE
      IF v_expected_bill_updated_at IS NOT NULL AND v_existing_bill.updated_at IS DISTINCT FROM v_expected_bill_updated_at THEN
        RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Linked recurring bill changed concurrently'
          USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.recurring_bills
      SET name = v_sync_bill_name,
          amount = v_sync_bill_amount,
          due_day = v_sync_bill_due,
          updated_at = GREATEST(pg_catalog.now(), v_existing_bill.updated_at + interval '1 millisecond')
      WHERE id = v_sync_bill_id
        AND household_id = p_household_id
      RETURNING * INTO v_saved_bill;
      v_bill_updated := true;
    END IF;
  END IF;

  IF p_expected_version IS NULL AND v_debt_matched AND v_settings_revision IS DISTINCT FROM COALESCE(p_expected_settings_revision, v_settings_revision) THEN
    IF v_next_settings IS DISTINCT FROM v_settings OR v_bill_updated THEN
      RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Household settings changed concurrently'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_next_settings IS DISTINCT FROM v_settings THEN
    IF v_settings_revision >= 9223372036854775806 THEN
      RAISE EXCEPTION 'Settings revision cannot be advanced' USING ERRCODE = '22003';
    END IF;
    v_next_settings := v_next_settings || pg_catalog.jsonb_build_object('householdId', p_household_id);
    v_settings_revision := v_settings_revision + 1;
    UPDATE public.household_settings
    SET settings = v_next_settings,
        revision = v_settings_revision,
        updated_at = pg_catalog.now()
    WHERE household_id = p_household_id;
  ELSE
    v_next_settings := v_settings;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'householdId', p_household_id,
    'membershipVersion', v_auth.r_membership_version::text,
    'debtRow', pg_catalog.to_jsonb(v_saved),
    'billRow', CASE WHEN v_saved_bill.id IS NOT NULL THEN pg_catalog.to_jsonb(v_saved_bill) ELSE NULL END,
    'settingsRevision', v_settings_revision,
    'settings', v_next_settings
  );
END;
$$;

-- Preserve historical bill aliases when deleting a debt even if the paired recurring bill was
-- deactivated, category-drifted, or removed from recurring_bills.
CREATE OR REPLACE FUNCTION public.debtfree_delete_household_debt_atomic(
  p_household_id text,
  p_expected_membership_version bigint,
  p_debt_id uuid,
  p_expected_version bigint,
  p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth record;
  v_rec record;
  v_settings jsonb;
  v_settings_revision bigint;
  v_next_settings_revision bigint;
  v_debt_version bigint;
  v_debt_category text;
  v_pairings jsonb;
  v_pair_bill_id text;
  v_historical_bill_id text := NULL;
  v_bill_id text := NULL;
  v_bill_count integer := 0;
  v_transaction_count integer := 0;
  v_anchor_count integer := 0;
  v_debt_count integer := 0;
  v_updated_map jsonb;
  v_ambiguous_history jsonb;
  v_receipt jsonb;
BEGIN
  SELECT * INTO v_auth
  FROM public.debtfree_internal_finance_authorize(
    p_household_id, p_expected_membership_version, ARRAY['owner', 'admin']
  );

  IF p_debt_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 1 OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Account deletion requires a debt ID, expected version, and operation ID'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_rec
  FROM public.debtfree_household_debt_deletion_receipts
  WHERE household_id = p_household_id AND operation_id = p_operation_id;
  IF FOUND THEN
    IF v_rec.debt_id = p_debt_id AND v_rec.expected_version = p_expected_version THEN
      RETURN pg_catalog.jsonb_set(
        v_rec.receipt,
        ARRAY['membershipVersion'],
        pg_catalog.to_jsonb(v_auth.r_membership_version::text),
        true
      );
    END IF;
    RAISE EXCEPTION 'ACCOUNT_DELETE_OPERATION_REUSED: Operation ID is already bound to another debt deletion'
      USING ERRCODE = '23505';
  END IF;

  SELECT version, category INTO v_debt_version, v_debt_category
  FROM public.debts
  WHERE id = p_debt_id AND household_id = p_household_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_NO_CLEANUP_RECEIPT: Account is absent and no verifiable deletion receipt is available'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_debt_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale debt revision' USING ERRCODE = 'P0001';
  END IF;

  SELECT hs.revision, hs.settings
    INTO v_settings_revision, v_settings
  FROM public.household_settings AS hs
  WHERE hs.household_id = p_household_id
  FOR UPDATE;
  IF NOT FOUND OR v_settings IS NULL OR pg_catalog.jsonb_typeof(v_settings) <> 'object' THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_SETTINGS_UNAVAILABLE: Saved household settings could not be verified'
      USING ERRCODE = 'P0001';
  END IF;

  v_pairings := v_settings -> 'loanBillPairingByDebtId';
  IF pg_catalog.jsonb_typeof(v_pairings) = 'object' THEN
    v_pair_bill_id := NULLIF(pg_catalog.btrim(COALESCE(v_pairings -> (p_debt_id::text) ->> 'billId', '')), '');
    IF v_pairings -> (p_debt_id::text) ->> 'status' = 'linked'
       AND v_pair_bill_id IS NOT NULL
       AND (
         SELECT count(*) = 1
         FROM pg_catalog.jsonb_each(v_pairings) AS pair(key, value)
         WHERE pair.value ->> 'status' = 'linked'
           AND pair.value ->> 'billId' = v_pair_bill_id
       ) THEN
      v_historical_bill_id := v_pair_bill_id;
      SELECT bill.id INTO v_bill_id
      FROM public.recurring_bills AS bill
      WHERE bill.id = v_historical_bill_id
        AND bill.household_id = p_household_id;
    END IF;
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'transactionId', conflict.id,
      'date', conflict.transaction_date,
      'payee', conflict.payee,
      'conflictingAnchorIds', conflict.conflicting_anchor_ids
    ) ORDER BY conflict.id
  ), '[]'::jsonb)
  INTO v_ambiguous_history
  FROM (
    WITH candidates AS (
      SELECT tx.id, tx.account_id, tx.date::text AS transaction_date, tx.payee,
             public.debtfree_bill_ids_for_transaction(tx.id, tx.memo) AS bill_ids
      FROM public.transactions AS tx
      WHERE tx.household_id = p_household_id
        AND (
          tx.account_id = p_debt_id
          OR (v_historical_bill_id IS NOT NULL AND
              v_historical_bill_id = ANY(public.debtfree_bill_ids_for_transaction(tx.id, tx.memo)))
        )
    )
    SELECT candidate.id, candidate.transaction_date, candidate.payee,
      COALESCE((
        SELECT pg_catalog.jsonb_agg(anchor.id ORDER BY anchor.id)
        FROM public.reconciliation_anchors AS anchor
        WHERE anchor.household_id = p_household_id
          AND anchor.created_adjustment_id = candidate.id
          AND anchor.account_id <> p_debt_id
      ), '[]'::jsonb) AS conflicting_anchor_ids
    FROM candidates AS candidate
    WHERE (candidate.account_id IS NOT NULL AND candidate.account_id <> p_debt_id)
       OR EXISTS (
         SELECT 1 FROM public.reconciliation_anchors AS anchor
         WHERE anchor.household_id = p_household_id
           AND anchor.created_adjustment_id = candidate.id
           AND anchor.account_id <> p_debt_id
       )
       OR (
         pg_catalog.cardinality(candidate.bill_ids) > 0
         AND (
           v_historical_bill_id IS NULL
           OR EXISTS (
             SELECT 1 FROM pg_catalog.unnest(candidate.bill_ids) AS tag(bill_id)
             WHERE tag.bill_id <> v_historical_bill_id
           )
         )
       )
    ORDER BY candidate.id
    LIMIT 20
  ) AS conflict;
  IF pg_catalog.jsonb_array_length(v_ambiguous_history) > 0 THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_AMBIGUOUS_HISTORY: %', v_ambiguous_history::text
      USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.reconciliation_anchors AS anchor
  WHERE anchor.household_id = p_household_id
    AND (
      anchor.account_id = p_debt_id
      OR anchor.created_adjustment_id IN (
        SELECT tx.id
        FROM public.transactions AS tx
        WHERE tx.household_id = p_household_id
          AND (
            tx.account_id = p_debt_id
            OR (v_historical_bill_id IS NOT NULL AND
                v_historical_bill_id = ANY(public.debtfree_bill_ids_for_transaction(tx.id, tx.memo)))
          )
      )
    );
  GET DIAGNOSTICS v_anchor_count = ROW_COUNT;

  DELETE FROM public.transactions AS tx
  WHERE tx.household_id = p_household_id
    AND (
      tx.account_id = p_debt_id
      OR (v_historical_bill_id IS NOT NULL AND
          v_historical_bill_id = ANY(public.debtfree_bill_ids_for_transaction(tx.id, tx.memo)))
    );
  GET DIAGNOSTICS v_transaction_count = ROW_COUNT;

  IF v_bill_id IS NOT NULL THEN
    DELETE FROM public.recurring_bills AS bill
    WHERE bill.id = v_bill_id AND bill.household_id = p_household_id;
    GET DIAGNOSTICS v_bill_count = ROW_COUNT;
    IF v_bill_count <> 1 THEN
      RAISE EXCEPTION 'ACCOUNT_DELETE_BILL_CONFLICT: The linked recurring item changed before cleanup'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  DELETE FROM public.debts
  WHERE id = p_debt_id AND household_id = p_household_id;
  GET DIAGNOSTICS v_debt_count = ROW_COUNT;
  IF v_debt_count <> 1 THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_CONFLICT: The account changed before cleanup'
      USING ERRCODE = 'P0001';
  END IF;

  IF pg_catalog.jsonb_typeof(v_settings -> 'loanBillPairingByDebtId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(pair.key, pair.value), '{}'::jsonb)
    INTO v_updated_map
    FROM pg_catalog.jsonb_each(v_settings -> 'loanBillPairingByDebtId') AS pair(key, value)
    WHERE pair.key <> p_debt_id::text
      AND (v_historical_bill_id IS NULL OR pair.value ->> 'billId' IS DISTINCT FROM v_historical_bill_id);
    v_settings := pg_catalog.jsonb_set(v_settings, ARRAY['loanBillPairingByDebtId'], v_updated_map, true);
  END IF;

  IF pg_catalog.jsonb_typeof(v_settings -> 'mortgageEscrowByDebtId') = 'object' THEN
    v_settings := pg_catalog.jsonb_set(v_settings, ARRAY['mortgageEscrowByDebtId'],
      (v_settings -> 'mortgageEscrowByDebtId') - p_debt_id::text, true);
  END IF;
  IF pg_catalog.jsonb_typeof(v_settings -> 'mortgageExtraPaymentByDebtId') = 'object' THEN
    v_settings := pg_catalog.jsonb_set(v_settings, ARRAY['mortgageExtraPaymentByDebtId'],
      (v_settings -> 'mortgageExtraPaymentByDebtId') - p_debt_id::text, true);
  END IF;
  IF pg_catalog.jsonb_typeof(v_settings -> 'debtPaymentSplitPlansByDebtId') = 'object' THEN
    v_settings := pg_catalog.jsonb_set(v_settings, ARRAY['debtPaymentSplitPlansByDebtId'],
      (v_settings -> 'debtPaymentSplitPlansByDebtId') - p_debt_id::text, true);
  END IF;
  IF pg_catalog.jsonb_typeof(v_settings -> 'obligationSchedules') = 'object' THEN
    v_updated_map := (v_settings -> 'obligationSchedules') - ('debt:' || p_debt_id::text);
    IF v_historical_bill_id IS NOT NULL THEN v_updated_map := v_updated_map - ('bill:' || v_historical_bill_id); END IF;
    v_settings := pg_catalog.jsonb_set(v_settings, ARRAY['obligationSchedules'], v_updated_map, true);
  END IF;
  IF pg_catalog.jsonb_typeof(v_settings -> 'archivedPaidOffDebtIds') = 'array' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(item.value ORDER BY item.ordinality), '[]'::jsonb)
    INTO v_updated_map
    FROM pg_catalog.jsonb_array_elements(v_settings -> 'archivedPaidOffDebtIds') WITH ORDINALITY AS item(value, ordinality)
    WHERE item.value <> pg_catalog.to_jsonb(p_debt_id::text);
    v_settings := pg_catalog.jsonb_set(v_settings, ARRAY['archivedPaidOffDebtIds'], v_updated_map, true);
  END IF;
  IF v_historical_bill_id IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(v_settings -> 'billPaymentSplitPlansByBillId') = 'object' THEN
      v_settings := pg_catalog.jsonb_set(v_settings, ARRAY['billPaymentSplitPlansByBillId'],
        (v_settings -> 'billPaymentSplitPlansByBillId') - v_historical_bill_id, true);
    END IF;
    IF pg_catalog.jsonb_typeof(v_settings -> 'recurringBillCategoryLabelByBillId') = 'object' THEN
      v_settings := pg_catalog.jsonb_set(v_settings, ARRAY['recurringBillCategoryLabelByBillId'],
        (v_settings -> 'recurringBillCategoryLabelByBillId') - v_historical_bill_id, true);
    END IF;
  END IF;

  IF v_settings_revision >= 9223372036854775806 THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_SETTINGS_REVISION_EXHAUSTED: Settings revision cannot be advanced'
      USING ERRCODE = '22003';
  END IF;

  v_settings := v_settings || pg_catalog.jsonb_build_object('householdId', p_household_id);
  v_next_settings_revision := v_settings_revision + 1;

  UPDATE public.household_settings
  SET settings = v_settings,
      revision = v_next_settings_revision,
      updated_at = pg_catalog.now()
  WHERE household_id = p_household_id;

  v_receipt := pg_catalog.jsonb_build_object(
    'version', 2,
    'success', true,
    'operationId', p_operation_id,
    'householdId', p_household_id,
    'membershipVersion', v_auth.r_membership_version::text,
    'debtId', p_debt_id,
    'billId', v_bill_id,
    'historicalBillId', v_historical_bill_id,
    'deletedTransactions', v_transaction_count,
    'deletedReconciliationAnchors', v_anchor_count,
    'deletedBills', v_bill_count,
    'deletedDebts', v_debt_count,
    'settingsRevision', v_next_settings_revision,
    'settings', v_settings,
    'historyCleanupComplete', true
  );

  INSERT INTO public.debtfree_household_debt_deletion_receipts (
    household_id, operation_id, actor_user_id, debt_id, expected_version, receipt
  ) VALUES (
    p_household_id, p_operation_id, v_auth.r_actor, p_debt_id, p_expected_version, v_receipt
  );

  RETURN v_receipt;
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_save_unified_loan_atomic(text, bigint, jsonb, bigint, text, bigint, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_save_unified_loan_atomic(text, bigint, jsonb, bigint, text, bigint, jsonb, jsonb)
  TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_delete_household_debt_atomic(text, bigint, uuid, bigint, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_delete_household_debt_atomic(text, bigint, uuid, bigint, uuid)
  TO authenticated;

COMMIT;
