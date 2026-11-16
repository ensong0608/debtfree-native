-- DebtFree Native: close household self-enrolment, isolate manual debt rows,
-- and preserve signed credit balances.  Apply only after a sandbox schema review.
-- Deliberately does not enable shared-household debt access: invitation acceptance
-- and a server-side authorization path must be designed before that is safe.
BEGIN;

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS household_members_self_access ON public.household_members;
DROP POLICY IF EXISTS households_member_access ON public.households;
DROP POLICY IF EXISTS debts_owner_isolation ON public.debts;
-- Remove legacy policies granted to PUBLIC. They would remain permissive
-- alongside the authenticated-only ownership policies added below.
DROP POLICY IF EXISTS "Users can view their own debts" ON public.debts;
DROP POLICY IF EXISTS "Users can insert their own debts" ON public.debts;
DROP POLICY IF EXISTS "Users can update their own debts" ON public.debts;
DROP POLICY IF EXISTS "Users can delete their own debts" ON public.debts;
DROP POLICY IF EXISTS household_members_select ON public.household_members;
DROP POLICY IF EXISTS households_owner_select ON public.households;
DROP POLICY IF EXISTS households_owner_insert ON public.households;
DROP POLICY IF EXISTS households_owner_update ON public.households;
DROP POLICY IF EXISTS households_owner_delete ON public.households;
DROP POLICY IF EXISTS debts_user_select ON public.debts;
DROP POLICY IF EXISTS debts_user_insert ON public.debts;
DROP POLICY IF EXISTS debts_user_update ON public.debts;
DROP POLICY IF EXISTS debts_user_delete ON public.debts;

-- Membership can be viewed by the member or household creator. No client-side
-- INSERT/UPDATE/DELETE grant is provided; arbitrary users cannot join a household.
CREATE POLICY household_members_select ON public.household_members
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM public.households h
    WHERE h.id = household_id AND h.created_by = (SELECT auth.uid())
  ));

CREATE POLICY households_owner_select ON public.households
  FOR SELECT TO authenticated USING (created_by = (SELECT auth.uid()));
CREATE POLICY households_owner_insert ON public.households
  FOR INSERT TO authenticated WITH CHECK (created_by = (SELECT auth.uid()));
CREATE POLICY households_owner_update ON public.households
  FOR UPDATE TO authenticated
  USING (created_by = (SELECT auth.uid()))
  WITH CHECK (created_by = (SELECT auth.uid()));
CREATE POLICY households_owner_delete ON public.households
  FOR DELETE TO authenticated USING (created_by = (SELECT auth.uid()));

-- The authenticated user owns each manual debt row. The previous OR-clause let
-- a self-invited member see another owner's balances.
CREATE POLICY debts_user_select ON public.debts
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY debts_user_insert ON public.debts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND (
    household_id IS NULL OR EXISTS (
      SELECT 1 FROM public.households h
      WHERE h.id = household_id AND h.created_by = (SELECT auth.uid())
    )
  ));
CREATE POLICY debts_user_update ON public.debts
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (
    household_id IS NULL OR EXISTS (
      SELECT 1 FROM public.households h
      WHERE h.id = household_id AND h.created_by = (SELECT auth.uid())
    )
  ));
CREATE POLICY debts_user_delete ON public.debts
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- The original migration rejected negative balances; a credit balance is a
-- valid signed observation while scheduled minimums and limits stay nonnegative.
ALTER TABLE public.debts DROP CONSTRAINT IF EXISTS debts_balance_check;

COMMIT;
