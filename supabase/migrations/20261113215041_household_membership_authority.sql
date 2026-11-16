-- Source-only: apply only after the account deletion fence is ready.
BEGIN;

-- Fail closed if the inspected policy inventory or creator FK has drifted.
DO $$
DECLARE
  p record;
  expected_count integer;
BEGIN
  SELECT count(*) INTO expected_count FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND (
    (tablename = 'households' AND (policyname, cmd) IN
      (('households_owner_select', 'SELECT'), ('households_owner_insert', 'INSERT'),
       ('households_owner_update', 'UPDATE'), ('households_owner_delete', 'DELETE')))
    OR (tablename = 'household_members' AND policyname = 'household_members_select' AND cmd = 'SELECT')
  ) AND permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']::name[];
  IF expected_count <> 5 OR (SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename IN ('households', 'household_members')) <> 5 THEN
    RAISE EXCEPTION 'Unexpected household policy inventory or shape; review before applying';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public'
      AND tablename IN ('households', 'household_members')
      AND position('created_by' IN coalesce(qual, '') || coalesce(with_check, '')) = 0) THEN
    RAISE EXCEPTION 'Unexpected household policy predicate; review before applying';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.households'::regclass AND c.conname = 'households_created_by_fkey'
      AND c.contype = 'f' AND c.confrelid = 'auth.users'::regclass AND c.confdeltype = 'c'
      AND c.conkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = c.conrelid AND attname = 'created_by')]::smallint[]
      AND c.confkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = c.confrelid AND attname = 'id')]::smallint[]
  ) OR (SELECT count(*) FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = 'public.households'::regclass AND c.contype = 'f'
        AND (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = c.conrelid AND attname = 'created_by') = ANY(c.conkey)) <> 1 THEN
    RAISE EXCEPTION 'Unexpected households.created_by foreign key; review before applying';
  END IF;
END $$;

ALTER TABLE public.households ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.households DROP CONSTRAINT households_created_by_fkey;
ALTER TABLE public.households ADD CONSTRAINT households_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.households.created_by IS
  'Original creator attribution only; never an authorization source. Null after creator deletion.';

DROP POLICY households_owner_select ON public.households;
DROP POLICY households_owner_insert ON public.households;
DROP POLICY households_owner_update ON public.households;
DROP POLICY households_owner_delete ON public.households;
DROP POLICY household_members_select ON public.household_members;

-- Remove both table and column privileges, including inherited PUBLIC privileges.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.households, public.household_members FROM PUBLIC, anon, authenticated;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('households', 'household_members')
  LOOP
    EXECUTE format('REVOKE INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON public.%2$I FROM PUBLIC, anon, authenticated', r.column_name, r.table_name);
  END LOOP;
END $$;

GRANT SELECT ON public.households, public.household_members TO authenticated;
CREATE POLICY household_members_self_select ON public.household_members
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY households_active_member_select ON public.households
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.household_members hm
    WHERE hm.household_id = households.id
      AND hm.user_id = (SELECT auth.uid()) AND hm.status = 'active'
  ));
COMMIT;
