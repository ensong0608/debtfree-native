CREATE OR REPLACE FUNCTION public.debtfree_active_select_household_ids()
RETURNS text[]
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_enabled boolean;
  v_state text;
  v_ids text[];
BEGIN
  IF v_actor IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;

  SELECT enabled INTO v_enabled
  FROM public.debtfree_household_cutover_gate
  WHERE singleton;
  IF NOT FOUND OR NOT v_enabled THEN
    RETURN ARRAY[]::text[];
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('debtfree.account:' || v_actor::text, 0)
  );

  SELECT lifecycle.deletion_state INTO v_state
  FROM public.debtfree_account_lifecycle AS lifecycle
  WHERE lifecycle.account_id = v_actor;
  IF NOT FOUND OR v_state <> 'active' THEN
    RETURN ARRAY[]::text[];
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(hm.household_id), ARRAY[]::text[])
    INTO v_ids
  FROM public.household_members AS hm
  JOIN public.households AS h ON h.id = hm.household_id
  WHERE hm.user_id = v_actor
    AND hm.status = 'active'
    AND h.lifecycle_state = 'active';

  RETURN v_ids;
END
$function$;

REVOKE ALL ON FUNCTION public.debtfree_active_select_household_ids()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.debtfree_active_select_household_ids()
  TO authenticated;
COMMENT ON FUNCTION public.debtfree_active_select_household_ids() IS
  'InitPlan-friendly RLS helper returning active household IDs for auth.uid() under the shared account advisory lock.';

DROP POLICY IF EXISTS household_members_self_select ON public.household_members;
CREATE POLICY household_members_self_select ON public.household_members
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND household_id = ANY ((SELECT public.debtfree_active_select_household_ids())::text[])
  );

DROP POLICY IF EXISTS households_active_member_select ON public.households;
CREATE POLICY households_active_member_select ON public.households
  FOR SELECT TO authenticated
  USING (id = ANY ((SELECT public.debtfree_active_select_household_ids())::text[]));

DROP POLICY IF EXISTS debts_user_select ON public.debts;
CREATE POLICY debts_user_select ON public.debts
  FOR SELECT TO authenticated
  USING (household_id = ANY ((SELECT public.debtfree_active_select_household_ids())::text[]));

DROP POLICY IF EXISTS transactions_user_select ON public.transactions;
CREATE POLICY transactions_user_select ON public.transactions
  FOR SELECT TO authenticated
  USING (household_id = ANY ((SELECT public.debtfree_active_select_household_ids())::text[]));

DROP POLICY IF EXISTS recurring_bills_user_select ON public.recurring_bills;
CREATE POLICY recurring_bills_user_select ON public.recurring_bills
  FOR SELECT TO authenticated
  USING (household_id = ANY ((SELECT public.debtfree_active_select_household_ids())::text[]));

DROP POLICY IF EXISTS reconciliation_anchors_user_select ON public.reconciliation_anchors;
CREATE POLICY reconciliation_anchors_user_select ON public.reconciliation_anchors
  FOR SELECT TO authenticated
  USING (household_id = ANY ((SELECT public.debtfree_active_select_household_ids())::text[]));

DROP POLICY IF EXISTS debtfree_deleted_debt_ids_owner_select ON public.debtfree_deleted_debt_ids;
CREATE POLICY debtfree_deleted_debt_ids_owner_select ON public.debtfree_deleted_debt_ids
  FOR SELECT TO authenticated
  USING (household_id = ANY ((SELECT public.debtfree_active_select_household_ids())::text[]));

DROP POLICY IF EXISTS debtfree_household_import_archives_select ON public.debtfree_household_import_archives;
CREATE POLICY debtfree_household_import_archives_select ON public.debtfree_household_import_archives
  FOR SELECT TO authenticated
  USING (household_id = ANY ((SELECT public.debtfree_active_select_household_ids())::text[]));

DROP POLICY IF EXISTS debtfree_household_import_records_select ON public.debtfree_household_import_records;
CREATE POLICY debtfree_household_import_records_select ON public.debtfree_household_import_records
  FOR SELECT TO authenticated
  USING (household_id = ANY ((SELECT public.debtfree_active_select_household_ids())::text[]));

CREATE INDEX IF NOT EXISTS debtfree_household_import_records_archive_household_idx
  ON public.debtfree_household_import_records (archive_id, household_id);
