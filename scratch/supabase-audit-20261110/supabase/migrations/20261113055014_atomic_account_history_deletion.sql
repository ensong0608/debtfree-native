BEGIN;

DROP FUNCTION public.debtfree_delete_debt_atomic(uuid, bigint);

CREATE FUNCTION public.debtfree_delete_debt_atomic(
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
  v_uid uuid := (SELECT auth.uid());
  v_current_profile jsonb;
  v_settings jsonb;
  v_settings_revision bigint;
  v_next_settings_revision bigint;
  v_debt_version bigint;
  v_debt_category text;
  v_pairings jsonb;
  v_pair_bill_id text;
  v_bill_id text;
  v_bill_count integer := 0;
  v_transaction_count integer := 0;
  v_anchor_count integer := 0;
  v_debt_count integer := 0;
  v_updated_map jsonb;
  v_ambiguous_history jsonb;
BEGIN
  PERFORM public.debtfree_lock_financial_user();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_debt_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 1 OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Account deletion requires a debt ID, expected version, and operation ID' USING ERRCODE = '22023';
  END IF;

  SELECT raw_user_meta_data
  INTO v_current_profile
  FROM auth.users
  WHERE id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  v_settings := v_current_profile -> 'debtfree_native_v1';
  IF v_settings IS NULL OR pg_catalog.jsonb_typeof(v_settings) <> 'object' THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_SETTINGS_UNAVAILABLE: Saved account settings could not be verified'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT version, category
  INTO v_debt_version, v_debt_category
  FROM public.debts
  WHERE id = p_debt_id AND user_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    -- A tombstone alone is not proof of the earlier history cleanup.
    RAISE EXCEPTION 'ACCOUNT_DELETE_NO_CLEANUP_RECEIPT: Account is absent and no verifiable deletion receipt is available'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_debt_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale debt revision' USING ERRCODE = 'P0001';
  END IF;

  v_pairings := v_settings -> 'loanBillPairingByDebtId';
  IF pg_catalog.jsonb_typeof(v_pairings) = 'object' THEN
    v_pair_bill_id := v_pairings -> (p_debt_id::text) ->> 'billId';
    IF v_pairings -> (p_debt_id::text) ->> 'status' = 'linked'
       AND v_pair_bill_id IS NOT NULL
       AND (v_debt_category IN ('Mortgage', 'Auto loan'))
       AND (
         SELECT count(*) = 1
         FROM pg_catalog.jsonb_each(v_pairings) AS pair(key, value)
         WHERE pair.value ->> 'status' = 'linked'
           AND pair.value ->> 'billId' = v_pair_bill_id
       ) THEN
      SELECT bill.id
      INTO v_bill_id
      FROM public.recurring_bills AS bill
      WHERE bill.id = v_pair_bill_id
        AND bill.user_id = v_uid
        AND bill.active IS TRUE
        AND bill.payment_method = 'debit'
        AND (
          (v_debt_category = 'Mortgage' AND bill.category IN ('housing', 'other_bill'))
          OR (v_debt_category = 'Auto loan' AND bill.category = 'other_bill')
        );
    END IF;
  END IF;

  -- Do not wipe a transaction that is also attached to a different account or
  -- another recurring-item identity. Resolve ambiguous links before deleting.
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
      WHERE tx.user_id = v_uid
        AND (
          tx.account_id = p_debt_id
          OR (v_bill_id IS NOT NULL AND
              v_bill_id = ANY(public.debtfree_bill_ids_for_transaction(tx.id, tx.memo)))
        )
    )
    SELECT candidate.id, candidate.transaction_date, candidate.payee,
      COALESCE((
        SELECT pg_catalog.jsonb_agg(anchor.id ORDER BY anchor.id)
        FROM public.reconciliation_anchors AS anchor
        WHERE anchor.user_id = v_uid
          AND anchor.created_adjustment_id = candidate.id
          AND anchor.account_id <> p_debt_id
      ), '[]'::jsonb) AS conflicting_anchor_ids
    FROM candidates AS candidate
    WHERE (candidate.account_id IS NOT NULL AND candidate.account_id <> p_debt_id)
       OR EXISTS (
         SELECT 1 FROM public.reconciliation_anchors AS anchor
         WHERE anchor.user_id = v_uid
           AND anchor.created_adjustment_id = candidate.id
           AND anchor.account_id <> p_debt_id
       )
       OR (
         pg_catalog.cardinality(candidate.bill_ids) > 0
         AND (
           v_bill_id IS NULL
           OR EXISTS (
             SELECT 1 FROM pg_catalog.unnest(candidate.bill_ids) AS tag(bill_id)
             WHERE tag.bill_id <> v_bill_id
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

  -- Remove anchors for the account and anchors whose recorded adjustment is
  -- one of the exact transaction rows about to be physically removed.
  DELETE FROM public.reconciliation_anchors AS anchor
  WHERE anchor.user_id = v_uid
    AND (
      anchor.account_id = p_debt_id
      OR anchor.created_adjustment_id IN (
        SELECT tx.id
        FROM public.transactions AS tx
        WHERE tx.user_id = v_uid
          AND (
            tx.account_id = p_debt_id
            OR (v_bill_id IS NOT NULL AND
                v_bill_id = ANY(public.debtfree_bill_ids_for_transaction(tx.id, tx.memo)))
          )
      )
    );
  GET DIAGNOSTICS v_anchor_count = ROW_COUNT;

  DELETE FROM public.transactions AS tx
  WHERE tx.user_id = v_uid
    AND (
      tx.account_id = p_debt_id
      OR (v_bill_id IS NOT NULL AND
          v_bill_id = ANY(public.debtfree_bill_ids_for_transaction(tx.id, tx.memo)))
    );
  GET DIAGNOSTICS v_transaction_count = ROW_COUNT;

  IF v_bill_id IS NOT NULL THEN
    DELETE FROM public.recurring_bills AS bill
    WHERE bill.id = v_bill_id AND bill.user_id = v_uid;
    GET DIAGNOSTICS v_bill_count = ROW_COUNT;
    IF v_bill_count <> 1 THEN
      RAISE EXCEPTION 'ACCOUNT_DELETE_BILL_CONFLICT: The linked recurring item changed before cleanup'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  DELETE FROM public.debts
  WHERE id = p_debt_id AND user_id = v_uid;
  GET DIAGNOSTICS v_debt_count = ROW_COUNT;
  IF v_debt_count <> 1 THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_CONFLICT: The account changed before cleanup'
      USING ERRCODE = 'P0001';
  END IF;

  -- Clear only metadata owned by this debt and, when physically removed,
  -- the exact linked bill. Everything else in the household settings survives.
  IF pg_catalog.jsonb_typeof(v_settings -> 'loanBillPairingByDebtId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(pair.key, pair.value), '{}'::jsonb)
    INTO v_updated_map
    FROM pg_catalog.jsonb_each(v_settings -> 'loanBillPairingByDebtId') AS pair(key, value)
    WHERE pair.key <> p_debt_id::text
      AND (v_bill_id IS NULL OR pair.value ->> 'billId' IS DISTINCT FROM v_bill_id);
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
    IF v_bill_id IS NOT NULL THEN v_updated_map := v_updated_map - ('bill:' || v_bill_id); END IF;
    v_settings := pg_catalog.jsonb_set(v_settings, ARRAY['obligationSchedules'], v_updated_map, true);
  END IF;
  IF pg_catalog.jsonb_typeof(v_settings -> 'archivedPaidOffDebtIds') = 'array' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(item.value ORDER BY item.ordinality), '[]'::jsonb)
    INTO v_updated_map
    FROM pg_catalog.jsonb_array_elements(v_settings -> 'archivedPaidOffDebtIds') WITH ORDINALITY AS item(value, ordinality)
    WHERE item.value <> pg_catalog.to_jsonb(p_debt_id::text);
    v_settings := pg_catalog.jsonb_set(v_settings, ARRAY['archivedPaidOffDebtIds'], v_updated_map, true);
  END IF;
  IF v_bill_id IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(v_settings -> 'billPaymentSplitPlansByBillId') = 'object' THEN
      v_settings := pg_catalog.jsonb_set(v_settings, ARRAY['billPaymentSplitPlansByBillId'],
        (v_settings -> 'billPaymentSplitPlansByBillId') - v_bill_id, true);
    END IF;
    IF pg_catalog.jsonb_typeof(v_settings -> 'recurringBillCategoryLabelByBillId') = 'object' THEN
      v_settings := pg_catalog.jsonb_set(v_settings, ARRAY['recurringBillCategoryLabelByBillId'],
        (v_settings -> 'recurringBillCategoryLabelByBillId') - v_bill_id, true);
    END IF;
  END IF;

  v_settings_revision := public.debtfree_settings_revision(
    v_current_profile -> 'debtfree_native_v1'
  );
  IF v_settings_revision >= 9223372036854775806 THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_SETTINGS_REVISION_EXHAUSTED: Settings revision cannot be advanced'
      USING ERRCODE = '22003';
  END IF;
  v_next_settings_revision := v_settings_revision + 1;
  v_settings := pg_catalog.jsonb_set(v_settings, ARRAY['settingsRevision'],
    pg_catalog.to_jsonb(v_next_settings_revision), true);
  v_settings := pg_catalog.jsonb_set(v_settings, ARRAY['updatedAt'],
    pg_catalog.to_jsonb(pg_catalog.to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), true);

  PERFORM pg_catalog.set_config('debtfree.settings_rpc_cas', 'on', true);
  UPDATE auth.users
  SET raw_user_meta_data = pg_catalog.jsonb_set(
    COALESCE(raw_user_meta_data, '{}'::jsonb),
    ARRAY['debtfree_native_v1'],
    v_settings,
    true
  )
  WHERE id = v_uid;
  PERFORM pg_catalog.set_config('debtfree.settings_rpc_cas', 'off', true);

  RETURN pg_catalog.jsonb_build_object(
    'version', 1,
    'success', true,
    'operationId', p_operation_id,
    'debtId', p_debt_id,
    'billId', v_bill_id,
    'deletedTransactions', v_transaction_count,
    'deletedReconciliationAnchors', v_anchor_count,
    'deletedBills', v_bill_count,
    'deletedDebts', v_debt_count,
    'settingsRevision', v_next_settings_revision,
    'settings', v_settings,
    'historyCleanupComplete', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_delete_debt_atomic(uuid, bigint, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_delete_debt_atomic(uuid, bigint, uuid) TO authenticated;

COMMIT;
