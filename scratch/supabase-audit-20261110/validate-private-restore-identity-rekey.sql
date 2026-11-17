BEGIN;
DO $t144$
DECLARE
  v_user_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_user_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_debt_collision_id uuid := '11111111-1111-4111-8111-111111111111';
  v_debt_foreign_tombstone_id uuid := '22222222-2222-4222-8222-222222222222';
  v_debt_own_tombstone_id uuid := '33333333-3333-4333-8333-333333333333';
  v_debt_unused_id uuid := '44444444-4444-4444-8444-444444444444';
  v_tx_collision_id text := 't144-tx-id-collision';
  v_bill_collision_id text := 't144-bill-id-collision';
  v_anchor_collision_id text := 't144-anchor-id-collision';
  v_snapshot jsonb;
  v_payload jsonb;
  v_base_token text;
  v_result jsonb;
  v_snapshot_second jsonb;
  v_base_token_second text;
  v_result_second jsonb;
  v_message text;
  v_debt_new_id text;
  v_debt_tombstone_new_id text;
  v_debt_unused_new_id text;
  v_bill_new_id text;
  v_tx_new_id text;
  v_anchor_new_id text;
  v_debt_new_id_second text;
  v_ref text;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
  (
    v_user_a, 'authenticated', 'authenticated', 't144-owner-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    pg_catalog.jsonb_build_object('debtfree_native_v1', pg_catalog.jsonb_build_object(
      'version', 1, 'userId', v_user_a::text, 'householdId', 't144-household-a',
      'currencyCode', 'USD', 'settingsRevision', 1, 'currentStage', 'home',
      'countryCode', 'US', 'primaryPayFrequency', 'monthly', 'selectedPlan', 'premium',
      'homeStatus', 'Own', 'vehicleStatus', 'Own', 'strategy', 'snowball'
    )), now(), now()
  ),
  (
    v_user_b, 'authenticated', 'authenticated', 't144-owner-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    pg_catalog.jsonb_build_object('debtfree_native_v1', pg_catalog.jsonb_build_object(
      'version', 1, 'userId', v_user_b::text, 'householdId', 't144-household-b',
      'currencyCode', 'USD', 'settingsRevision', 1, 'currentStage', 'home',
      'countryCode', 'US', 'primaryPayFrequency', 'monthly', 'selectedPlan', 'premium',
      'homeStatus', 'Rent', 'vehicleStatus', 'None', 'strategy', 'avalanche'
    )), now(), now()
  );

  INSERT INTO public.households (id, name, currency, created_by) VALUES
    ('t144-household-a', 'T144 A', 'USD', v_user_a),
    ('t144-household-b', 'T144 B', 'USD', v_user_b);

  INSERT INTO public.debts (id, user_id, household_id, name, category, balance, original_balance, apr, minimum_payment, due_day)
  VALUES (v_debt_collision_id, v_user_b, 't144-household-b', 'B private debt', 'Credit card', 901, 1200, 19.9, 35, 5);
  INSERT INTO public.recurring_bills (id, user_id, household_id, name, category, amount, due_day, payment_method, credit_account_id)
  VALUES (v_bill_collision_id, v_user_b, 't144-household-b', 'B private bill', 'utilities', 91, 10, 'credit', v_debt_collision_id);
  INSERT INTO public.transactions (id, user_id, household_id, account_id, date, applies_to_date, amount, category, payee)
  VALUES (v_tx_collision_id, v_user_b, 't144-household-b', v_debt_collision_id, DATE '2026-11-01', DATE '2026-11-01', 11, 'payment', 'B private transaction');
  INSERT INTO public.reconciliation_anchors (id, user_id, account_id, as_of_date, verified_balance, note, created_adjustment_id)
  VALUES (v_anchor_collision_id, v_user_b, v_debt_collision_id, DATE '2026-11-01', 901, 'B private anchor', v_tx_collision_id);
  INSERT INTO public.debtfree_deleted_debt_ids (id, deleted_user_id)
  VALUES (v_debt_foreign_tombstone_id, v_user_b);

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_user_a::text, true);
  SELECT b.r_snapshot, b.r_baseline_token INTO v_snapshot, v_base_token
  FROM public.debtfree_internal_build_snapshot(v_user_a, 't144-household-a', 'USD') AS b;

  -- Caller-owned tombstones remain hard rejections and do not echo the supplied ID.
  INSERT INTO public.debtfree_deleted_debt_ids (id, deleted_user_id)
  VALUES (v_debt_own_tombstone_id, v_user_a);
  v_payload := pg_catalog.jsonb_set(
    v_snapshot,
    ARRAY['onboardingData','debts'],
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', v_debt_own_tombstone_id::text, 'name', 'A tombstoned debt',
      'category', 'Credit card', 'balance', 100, 'originalBalance', 200,
      'apr', 12.5, 'minimumPayment', 10, 'dueDay', 5,
      'createdAt', '2026-11-11T12:00:00.000Z'
    )),
    false
  );
  BEGIN
    PERFORM public.debtfree_apply_snapshot_restore(
      't144-own-tombstone', v_base_token, repeat('a', 64), 'merge',
      ARRAY[]::text[], ARRAY[]::text[], v_payload, false
    );
    RAISE EXCEPTION 'T144_TEST_FAILED: caller-owned tombstone was accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE 'RESTORE_TOMBSTONED_DEBT_ID:%' THEN
      RAISE EXCEPTION 'T144_TEST_FAILED: unexpected tombstone error: %', v_message;
    END IF;
    IF pg_catalog.strpos(v_message, v_debt_own_tombstone_id::text) > 0 THEN
      RAISE EXCEPTION 'T144_TEST_FAILED: tombstone error disclosed the ID';
    END IF;
  END;
  DELETE FROM public.debtfree_deleted_debt_ids
  WHERE id = v_debt_own_tombstone_id AND deleted_user_id = v_user_a;

  -- All submitted IDs are remapped unless already owned by A. This includes B's
  -- active IDs, B's tombstone ID, and a fresh unused ID, so response differences
  -- cannot identify B's rows or tombstones.
  v_payload := pg_catalog.jsonb_set(
    v_snapshot,
    ARRAY['onboardingData','debts'],
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_debt_collision_id::text, 'name', 'A imported debt',
        'category', 'Credit card', 'balance', 500, 'originalBalance', 1000,
        'apr', 12.5, 'minimumPayment', 35, 'dueDay', 5, 'creditLimit', 2500,
        'createdAt', '2026-11-11T12:00:00.000Z'
      ),
      pg_catalog.jsonb_build_object(
        'id', v_debt_foreign_tombstone_id::text, 'name', 'A imported tombstone debt',
        'category', 'Personal loan', 'balance', 300, 'originalBalance', 400,
        'apr', 7.5, 'minimumPayment', 20, 'dueDay', 12,
        'createdAt', '2026-11-11T12:00:00.000Z'
      ),
      pg_catalog.jsonb_build_object(
        'id', v_debt_unused_id::text, 'name', 'A imported unused debt',
        'category', 'Auto loan', 'balance', 2000, 'originalBalance', 2500,
        'apr', 6.5, 'minimumPayment', 80, 'dueDay', 20,
        'createdAt', '2026-11-11T12:00:00.000Z'
      )
    ), false
  );
  v_payload := pg_catalog.jsonb_set(
    v_payload, ARRAY['recurringBills'],
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', v_bill_collision_id, 'name', 'A imported bill', 'category', 'utilities',
      'amount', pg_catalog.jsonb_build_object('currency', 'USD', 'minorUnits', 12500),
      'dueDay', 10, 'paymentMethod', 'credit', 'creditAccountId', v_debt_collision_id::text,
      'autoPost', true, 'active', true, 'createdAt', '2026-11-11T12:00:00.000Z'
    )), false
  );
  v_payload := pg_catalog.jsonb_set(
    v_payload, ARRAY['transactions'],
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', v_tx_collision_id, 'accountId', v_debt_collision_id::text,
      'date', '2026-11-01', 'appliesToDate', '2026-11-01',
      'amount', pg_catalog.jsonb_build_object('currency', 'USD', 'minorUnits', 5000),
      'category', 'payment', 'payee', 'A imported payment', 'memo', NULL,
      'source', 'manual', 'reconciled', false, 'createdAt', '2026-11-11T12:00:00.000Z'
    )), false
  );
  v_payload := pg_catalog.jsonb_set(
    v_payload, ARRAY['reconciliationAnchors'],
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', v_anchor_collision_id, 'accountId', v_debt_collision_id::text,
      'asOfDate', '2026-11-01',
      'verifiedBalance', pg_catalog.jsonb_build_object('currency', 'USD', 'minorUnits', 50000),
      'note', 'A imported anchor', 'createdAdjustmentId', v_tx_collision_id,
      'coveredTransactionIds', pg_catalog.jsonb_build_array(),
      'createdAt', '2026-11-11T12:00:00.000Z'
    )), false
  );

  v_result := public.debtfree_apply_snapshot_restore(
    't144-foreign-id-rekey', v_base_token, repeat('b', 64), 'merge',
    ARRAY[]::text[], ARRAY[]::text[], v_payload, false
  );

  SELECT e.value ->> 'id' INTO v_debt_new_id
  FROM pg_catalog.jsonb_array_elements(v_result -> 'restoredSnapshot' -> 'onboardingData' -> 'debts') AS e(value)
  WHERE e.value ->> 'name' = 'A imported debt';
  SELECT e.value ->> 'id' INTO v_debt_tombstone_new_id
  FROM pg_catalog.jsonb_array_elements(v_result -> 'restoredSnapshot' -> 'onboardingData' -> 'debts') AS e(value)
  WHERE e.value ->> 'name' = 'A imported tombstone debt';
  SELECT e.value ->> 'id' INTO v_debt_unused_new_id
  FROM pg_catalog.jsonb_array_elements(v_result -> 'restoredSnapshot' -> 'onboardingData' -> 'debts') AS e(value)
  WHERE e.value ->> 'name' = 'A imported unused debt';
  SELECT e.value ->> 'id' INTO v_bill_new_id
  FROM pg_catalog.jsonb_array_elements(v_result -> 'restoredSnapshot' -> 'recurringBills') AS e(value)
  WHERE e.value ->> 'name' = 'A imported bill';
  SELECT e.value ->> 'id' INTO v_tx_new_id
  FROM pg_catalog.jsonb_array_elements(v_result -> 'restoredSnapshot' -> 'transactions') AS e(value)
  WHERE e.value ->> 'payee' = 'A imported payment';
  SELECT e.value ->> 'id' INTO v_anchor_new_id
  FROM pg_catalog.jsonb_array_elements(v_result -> 'restoredSnapshot' -> 'reconciliationAnchors') AS e(value)
  WHERE e.value ->> 'note' = 'A imported anchor';

  IF v_debt_new_id = v_debt_collision_id::text
     OR v_debt_tombstone_new_id = v_debt_foreign_tombstone_id::text
     OR v_debt_unused_new_id = v_debt_unused_id::text
     OR v_bill_new_id = v_bill_collision_id
     OR v_tx_new_id = v_tx_collision_id
     OR v_anchor_new_id = v_anchor_collision_id THEN
    RAISE EXCEPTION 'T144_TEST_FAILED: a non-owned incoming identity was not rekeyed';
  END IF;

  SELECT e.value ->> 'creditAccountId' INTO v_ref
  FROM pg_catalog.jsonb_array_elements(v_result -> 'restoredSnapshot' -> 'recurringBills') AS e(value)
  WHERE e.value ->> 'id' = v_bill_new_id;
  IF v_ref IS DISTINCT FROM v_debt_new_id THEN RAISE EXCEPTION 'T144_TEST_FAILED: bill debt reference was not remapped'; END IF;
  SELECT e.value ->> 'accountId' INTO v_ref
  FROM pg_catalog.jsonb_array_elements(v_result -> 'restoredSnapshot' -> 'transactions') AS e(value)
  WHERE e.value ->> 'id' = v_tx_new_id;
  IF v_ref IS DISTINCT FROM v_debt_new_id THEN RAISE EXCEPTION 'T144_TEST_FAILED: transaction debt reference was not remapped'; END IF;
  SELECT e.value ->> 'accountId' INTO v_ref
  FROM pg_catalog.jsonb_array_elements(v_result -> 'restoredSnapshot' -> 'reconciliationAnchors') AS e(value)
  WHERE e.value ->> 'id' = v_anchor_new_id;
  IF v_ref IS DISTINCT FROM v_debt_new_id THEN RAISE EXCEPTION 'T144_TEST_FAILED: anchor debt reference was not remapped'; END IF;
  SELECT e.value ->> 'createdAdjustmentId' INTO v_ref
  FROM pg_catalog.jsonb_array_elements(v_result -> 'restoredSnapshot' -> 'reconciliationAnchors') AS e(value)
  WHERE e.value ->> 'id' = v_anchor_new_id;
  IF v_ref IS DISTINCT FROM v_tx_new_id THEN RAISE EXCEPTION 'T144_TEST_FAILED: anchor transaction reference was not remapped'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.debts WHERE id = v_debt_collision_id AND user_id = v_user_b AND name = 'B private debt' AND balance = 901)
     OR NOT EXISTS (SELECT 1 FROM public.recurring_bills WHERE id = v_bill_collision_id AND user_id = v_user_b AND name = 'B private bill')
     OR NOT EXISTS (SELECT 1 FROM public.transactions WHERE id = v_tx_collision_id AND user_id = v_user_b AND payee = 'B private transaction')
     OR NOT EXISTS (SELECT 1 FROM public.reconciliation_anchors WHERE id = v_anchor_collision_id AND user_id = v_user_b AND note = 'B private anchor') THEN
    RAISE EXCEPTION 'T144_TEST_FAILED: owner B data was changed';
  END IF;

  -- A second restore from A's authoritative snapshot must preserve A-owned IDs.
  SELECT b.r_snapshot, b.r_baseline_token INTO v_snapshot_second, v_base_token_second
  FROM public.debtfree_internal_build_snapshot(v_user_a, 't144-household-a', 'USD') AS b;
  v_result_second := public.debtfree_apply_snapshot_restore(
    't144-preserve-own-ids', v_base_token_second, repeat('c', 64), 'merge',
    ARRAY[]::text[], ARRAY[]::text[], v_snapshot_second, false
  );
  SELECT e.value ->> 'id' INTO v_debt_new_id_second
  FROM pg_catalog.jsonb_array_elements(v_result_second -> 'restoredSnapshot' -> 'onboardingData' -> 'debts') AS e(value)
  WHERE e.value ->> 'name' = 'A imported debt';
  IF v_debt_new_id_second IS DISTINCT FROM v_debt_new_id THEN
    RAISE EXCEPTION 'T144_TEST_FAILED: caller-owned identity was not preserved';
  END IF;

  RAISE NOTICE 'T144 PASS: caller tombstone rejected without ID echo; foreign active/tombstoned and unused IDs rekeyed; references remapped; owner B rows unchanged; caller-owned IDs preserved on repeat restore.';
END;
$t144$;
ROLLBACK;