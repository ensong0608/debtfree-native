BEGIN;

-- A payoff archive is durable household metadata, synchronized inside the
-- same financial transaction that changes the debt balance or records the
-- completed payment. New zero-balance debts are never archived by this rule.
CREATE OR REPLACE FUNCTION public.debtfree_sync_paid_off_archive(
  p_debt_id uuid,
  p_archive boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_balance numeric(18, 4);
  v_profile jsonb;
  v_raw_metadata jsonb;
  v_ids jsonb;
  v_next_ids jsonb;
  v_revision bigint;
  v_cas_state text;
  v_updated_count integer;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  PERFORM public.debtfree_lock_financial_user();

  SELECT balance INTO v_balance
  FROM public.debts
  WHERE id = p_debt_id AND user_id = v_uid;
  IF NOT FOUND THEN RETURN; END IF;
  IF (p_archive AND v_balance <> 0) OR (NOT p_archive AND v_balance <= 0) THEN RETURN; END IF;

  SELECT raw_user_meta_data INTO v_raw_metadata
  FROM auth.users WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paid-off archive settings are unavailable' USING ERRCODE = 'P0001'; END IF;
  v_profile := v_raw_metadata -> 'debtfree_native_v1';
  IF v_profile IS NULL OR pg_catalog.jsonb_typeof(v_profile) <> 'object' THEN
    RAISE EXCEPTION 'Paid-off archive settings are unavailable' USING ERRCODE = 'P0001';
  END IF;
  v_ids := COALESCE(v_profile -> 'archivedPaidOffDebtIds', '[]'::jsonb);
  IF pg_catalog.jsonb_typeof(v_ids) <> 'array' THEN
    RAISE EXCEPTION 'Paid-off archive settings are invalid' USING ERRCODE = '23514';
  END IF;

  IF p_archive THEN
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(v_ids) AS item(value) WHERE item.value = p_debt_id::text) THEN
      RETURN;
    END IF;
    v_next_ids := v_ids || pg_catalog.jsonb_build_array(p_debt_id::text);
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(v_ids) AS item(value) WHERE item.value = p_debt_id::text) THEN
      RETURN;
    END IF;
    SELECT COALESCE(pg_catalog.jsonb_agg(item.value ORDER BY item.ordinality), '[]'::jsonb)
    INTO v_next_ids
    FROM pg_catalog.jsonb_array_elements(v_ids) WITH ORDINALITY AS item(value, ordinality)
    WHERE item.value <> pg_catalog.to_jsonb(p_debt_id::text);
  END IF;

  v_revision := public.debtfree_settings_revision(v_profile);
  IF v_revision >= 9223372036854775806 THEN
    RAISE EXCEPTION 'Paid-off archive settings revision exhausted' USING ERRCODE = '22003';
  END IF;
  v_profile := pg_catalog.jsonb_set(v_profile, '{archivedPaidOffDebtIds}', v_next_ids, true);
  v_profile := pg_catalog.jsonb_set(v_profile, '{settingsRevision}', pg_catalog.to_jsonb(v_revision + 1), true);
  v_profile := pg_catalog.jsonb_set(v_profile, '{updatedAt}',
    pg_catalog.to_jsonb(pg_catalog.to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), true);

  v_cas_state := pg_catalog.current_setting('debtfree.settings_rpc_cas', true);
  PERFORM pg_catalog.set_config('debtfree.settings_rpc_cas', 'on', true);
  UPDATE auth.users
  SET raw_user_meta_data = pg_catalog.jsonb_set(
    COALESCE(raw_user_meta_data, '{}'::jsonb), '{debtfree_native_v1}', v_profile, true
  )
  WHERE id = v_uid;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> 1 THEN
    RAISE EXCEPTION 'Paid-off archive settings could not be updated' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_catalog.set_config('debtfree.settings_rpc_cas', COALESCE(NULLIF(v_cas_state, ''), 'off'), true);
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_sync_paid_off_archive(uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.debtfree_unarchive_reopened_debt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_catalog.current_setting('debtfree.restore_importing', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL AND NEW.user_id = auth.uid() AND NEW.balance > 0 THEN
    PERFORM public.debtfree_sync_paid_off_archive(NEW.id, false);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_unarchive_reopened_debt() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER debtfree_unarchive_reopened_debt
AFTER UPDATE OF balance ON public.debts
FOR EACH ROW
WHEN (OLD.balance IS DISTINCT FROM NEW.balance AND NEW.balance > 0)
EXECUTE FUNCTION public.debtfree_unarchive_reopened_debt();

CREATE OR REPLACE FUNCTION public.debtfree_archive_confirmed_payment_at_zero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_balance numeric(18, 4);
  v_debt_category text;
  v_new_delta numeric(18, 4);
  v_old_delta numeric(18, 4) := 0;
  v_previous_balance numeric(18, 4);
BEGIN
  IF v_uid IS NULL OR NEW.user_id IS DISTINCT FROM v_uid OR NEW.account_id IS NULL
     OR NEW.category <> 'payment' OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Restore imports recorded history after installing the restored settings;
  -- those rows must not be mistaken for a newly confirmed payoff event.
  IF pg_catalog.current_setting('debtfree.restore_importing', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT balance, category INTO v_balance, v_debt_category
  FROM public.debts
  WHERE id = NEW.account_id AND user_id = v_uid;
  IF NOT FOUND OR v_balance <> 0 THEN RETURN NEW; END IF;

  v_new_delta := public.debtfree_calculate_tx_delta(
    NEW.category, v_debt_category, NEW.amount, NEW.principal_amount
  );
  IF v_new_delta >= 0 THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    v_previous_balance := v_balance - v_new_delta;
  ELSIF OLD.account_id IS NOT DISTINCT FROM NEW.account_id THEN
    IF OLD.deleted_at IS NULL THEN
      v_old_delta := public.debtfree_calculate_tx_delta(
        OLD.category, v_debt_category, OLD.amount, OLD.principal_amount
      );
    END IF;
    IF v_old_delta = v_new_delta AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN
      RETURN NEW;
    END IF;
    v_previous_balance := v_balance - v_new_delta + v_old_delta;
  ELSE
    v_previous_balance := v_balance - v_new_delta;
  END IF;

  IF v_previous_balance > 0 THEN
    PERFORM public.debtfree_sync_paid_off_archive(NEW.account_id, true);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_archive_confirmed_payment_at_zero() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER debtfree_archive_confirmed_payment_at_zero
AFTER INSERT OR UPDATE ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.debtfree_archive_confirmed_payment_at_zero();

COMMIT;
