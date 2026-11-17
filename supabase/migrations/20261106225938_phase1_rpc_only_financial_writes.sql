-- DebtFree Native Phase 1: protect the authoritative financial write boundary.
-- FOR ISOLATED SANDBOX REVIEW ONLY. Do NOT apply to production without authorization.
-- Prerequisite: 20261106120000_phase1_financial_integrity_mutations.sql
BEGIN;

-- Ownership RLS controls *who* can access rows, not whether a direct write
-- maintains debt/ledger atomicity. Authenticated clients must use the RPCs.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.transactions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.reconciliation_anchors FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE ON TABLE public.debts FROM PUBLIC, anon, authenticated;
-- Preserve SELECT and INSERT (new onboarding debts), while guarded
-- debt deletion/reset operations use the RPCs below.

-- Defense-in-depth for installations with previously granted column privileges.
-- SECURITY DEFINER RPCs run under the owner role, not authenticated.
CREATE OR REPLACE FUNCTION public.debtfree_reject_direct_debt_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'RPC_REQUIRED: Debt modifications require an atomic revision-checked RPC'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS debtfree_rpc_only_debt_updates ON public.debts;
CREATE TRIGGER debtfree_rpc_only_debt_updates
  BEFORE UPDATE OR DELETE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.debtfree_reject_direct_debt_update();
REVOKE ALL ON FUNCTION public.debtfree_reject_direct_debt_update() FROM PUBLIC, anon, authenticated;


-- Column-level privileges might survive a table-level revoke from older schemas.
-- Reject direct edits at the table too, while preserving SECURITY DEFINER RPCs.
CREATE OR REPLACE FUNCTION public.debtfree_reject_direct_ledger_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'RPC_REQUIRED: Ledger writes require an atomic financial RPC'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS debtfree_rpc_only_transaction_writes ON public.transactions;
CREATE TRIGGER debtfree_rpc_only_transaction_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.debtfree_reject_direct_ledger_write();
DROP TRIGGER IF EXISTS debtfree_rpc_only_anchor_writes ON public.reconciliation_anchors;
CREATE TRIGGER debtfree_rpc_only_anchor_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.reconciliation_anchors
  FOR EACH ROW EXECUTE FUNCTION public.debtfree_reject_direct_ledger_write();
REVOKE ALL ON FUNCTION public.debtfree_reject_direct_ledger_write() FROM PUBLIC, anon, authenticated;

-- Profile edits (including user-entered corrections to balance) use CAS, not
-- direct table UPDATE. Existing account identity and owner cannot change.
CREATE OR REPLACE FUNCTION public.debtfree_update_debt_atomic(
  p_debt jsonb,
  p_expected_version bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_row public.debts%ROWTYPE;
  v_new public.debts%ROWTYPE;
  v_name text;
  v_category text;
  v_balance numeric;
  v_apr numeric;
  v_minimum numeric;
  v_original numeric;
  v_limit numeric;
  v_due integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_expected_version IS NULL THEN
    RAISE EXCEPTION 'MISSING_REVISION: Expected debt version is required' USING ERRCODE = 'P0002';
  END IF;
  v_id := (p_debt->>'id')::uuid;
  IF v_id IS NULL OR (p_debt->>'user_id')::uuid IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Debt owner or ID is invalid' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.debts
  WHERE id = v_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debt not found or access denied' USING ERRCODE = '23503';
  END IF;
  IF v_row.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale debt revision' USING ERRCODE = 'P0001';
  END IF;

  v_name := trim(COALESCE(p_debt->>'name', ''));
  v_category := trim(COALESCE(p_debt->>'category', ''));
  v_balance := (p_debt->>'balance')::numeric;
  v_apr := (p_debt->>'apr')::numeric;
  v_minimum := (p_debt->>'minimum_payment')::numeric;
  v_original := NULLIF(p_debt->>'original_balance', '')::numeric;
  v_limit := NULLIF(p_debt->>'credit_limit', '')::numeric;
  v_due := NULLIF(p_debt->>'due_day', '')::integer;
  IF v_name = '' OR v_category NOT IN ('Mortgage', 'Auto loan', 'Credit card', 'Personal loan', 'Student loan', 'Medical debt', 'Other loan')
    OR v_balance IS NULL OR v_apr IS NULL OR NOT (v_apr BETWEEN 0 AND 100)
    OR v_minimum IS NULL OR v_minimum < 0 OR (v_balance > 0 AND v_minimum = 0) OR (v_original IS NOT NULL AND v_original < 0)
    OR (v_limit IS NOT NULL AND v_limit < 0) OR (v_due IS NOT NULL AND NOT (v_due BETWEEN 1 AND 31)) THEN
    RAISE EXCEPTION 'Debt edit contains invalid financial fields' USING ERRCODE = '23514';
  END IF;

  UPDATE public.debts SET
    name = v_name, category = v_category, balance = v_balance, apr = v_apr,
    minimum_payment = v_minimum, original_balance = v_original,
    credit_limit = v_limit, due_day = v_due, updated_at = now()
  WHERE id = v_id AND user_id = v_uid
  RETURNING * INTO v_new;
  -- Existing debt revision trigger increments version exactly once.
  RETURN to_jsonb(v_new);
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_update_debt_atomic(jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_update_debt_atomic(jsonb, bigint) TO authenticated;

-- Deletion uses the same version lock as profile updates and preserves the
-- existing deletion/tombstone trigger semantics.
CREATE OR REPLACE FUNCTION public.debtfree_delete_debt_atomic(
  p_debt_id uuid,
  p_expected_version bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_version bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF p_expected_version IS NULL THEN
    RAISE EXCEPTION 'MISSING_REVISION: Expected debt version is required' USING ERRCODE = 'P0002';
  END IF;
  SELECT version INTO v_version FROM public.debts
    WHERE id = p_debt_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Debt not found or access denied' USING ERRCODE = '23503'; END IF;
  IF v_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale debt revision' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.debts WHERE id = p_debt_id AND user_id = v_uid;
  RETURN jsonb_build_object('success', true, 'id', p_debt_id);
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_delete_debt_atomic(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_delete_debt_atomic(uuid, bigint) TO authenticated;

-- Explicit user-initiated account reset, not a generic client table DELETE.
CREATE OR REPLACE FUNCTION public.debtfree_reset_debts_atomic()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  DELETE FROM public.debts WHERE user_id = v_uid;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'deleted_count', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_reset_debts_atomic() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_reset_debts_atomic() TO authenticated;

COMMIT;
