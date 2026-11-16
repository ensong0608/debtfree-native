-- DebtFree Native: atomic financial settings CAS and tombstone race hardening.
-- SANDBOX REVIEW ONLY. NEVER apply automatically or in production.
-- Apply AFTER:
-- 20261104000000_onboarding_and_households.sql
-- 20261105065959_debt_currency_precision.sql
-- 20261105081000_secure_household_debts.sql
-- 20261105090000_debt_revisions_and_tombstones.sql
-- Auth user metadata remains the only authoritative settings store. Existing
-- debtfree_native_v1 metadata needs no copy: its missing settingsRevision means 0.
-- Supabase Auth updateUser Reset is intentionally unchanged. Its default-state
-- replacement is recognized and revision-stamped to prevent stale writes.
-- Requires migration-owner privileges on auth.users and public.debts.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.debts') IS NULL
     OR to_regclass('public.debtfree_deleted_debt_ids') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'debts' AND column_name = 'version') THEN
    RAISE EXCEPTION 'DebtFree prerequisite missing: apply all four earlier migrations in order';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'debts' AND
        column_name IN ('id','user_id','household_id','name','category','balance',
                        'original_balance','apr','minimum_payment','due_day',
                        'credit_limit','created_at','updated_at','version')) <> 14 THEN
    RAISE EXCEPTION 'Debt schema columns do not match approved native adapter';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN
        ('debts','households','household_members','debtfree_deleted_debt_ids')
        AND c.relrowsecurity) <> 4 THEN
    RAISE EXCEPTION 'DebtFree RLS prerequisite missing; stop and review sandbox permissions';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'debts' AND
        policyname IN ('debts_user_select','debts_user_insert','debts_user_update','debts_user_delete')) <> 4 THEN
    RAISE EXCEPTION 'Debt ownership policies require sandbox review before migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'debts'
        AND t.tgname = 'debtfree_debt_tombstone' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'Debt tombstone trigger missing; repair earlier migration before continuing';
  END IF;
END;
$$;

-- Parse existing (legacy) metadata without changing it, and reject corrupt
-- or out-of-range revision tokens rather than treating them as zero.
CREATE OR REPLACE FUNCTION public.debtfree_settings_revision(profile jsonb)
RETURNS bigint
LANGUAGE plpgsql IMMUTABLE
SET search_path = ''
AS $$
DECLARE raw text;
BEGIN
  raw := profile ->> 'settingsRevision';
  IF raw IS NULL THEN RETURN 0; END IF;
  IF raw !~ '^(0|[1-9][0-9]{0,17})$' THEN
    RAISE EXCEPTION 'Invalid settings revision' USING ERRCODE = '22023';
  END IF;
  RETURN raw::bigint;
END;
$$;

-- All changes to the protected metadata field must pass through the CAS RPC,
-- except the app's existing explicit Reset operation. A previous app version
-- writing user_metadata without revisions must fail, never silently overwrite.
CREATE OR REPLACE FUNCTION public.debtfree_guard_settings_revision()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_profile jsonb;
  new_profile jsonb;
  before_revision bigint;
  after_revision bigint;
  is_development_reset boolean;
BEGIN
  old_profile := OLD.raw_user_meta_data -> 'debtfree_native_v1';
  new_profile := NEW.raw_user_meta_data -> 'debtfree_native_v1';
  IF new_profile IS NOT DISTINCT FROM old_profile THEN RETURN NEW; END IF;
  IF new_profile IS NULL OR jsonb_typeof(new_profile) <> 'object' THEN
    RAISE EXCEPTION 'DEBTFREE_SETTINGS_PROTECTED' USING ERRCODE = '23514';
  END IF;
  before_revision := public.debtfree_settings_revision(old_profile);
  after_revision := public.debtfree_settings_revision(new_profile);
  IF before_revision >= 9223372036854775806 THEN
    RAISE EXCEPTION 'Settings revision exhausted' USING ERRCODE = '22003';
  END IF;
  IF pg_catalog.current_setting('debtfree.settings_rpc_cas', true) = 'on' THEN
    IF after_revision <> before_revision + 1 THEN
      RAISE EXCEPTION 'DEBTFREE_SETTINGS_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  -- Existing development Reset path, unchanged in the application.
  is_development_reset :=
    NOT (new_profile ? 'settingsRevision')
    AND new_profile ->> 'version' = '1'
    AND new_profile ->> 'userId' = NEW.id::text
    AND new_profile ->> 'currentStage' = 'signup_2'
    AND new_profile -> 'signupCompleted' = 'false'::jsonb
    AND new_profile -> 'onboardingCompleted' = 'false'::jsonb
    AND new_profile -> 'primaryIncomeAmount' = '0'::jsonb
    AND new_profile -> 'extraMonthlyPayment' = '0'::jsonb
    AND new_profile -> 'additionalIncomes' = '[]'::jsonb
    AND new_profile -> 'debts' = '[]'::jsonb
    AND new_profile ->> 'strategy' = 'snowball';
  IF is_development_reset THEN
    NEW.raw_user_meta_data := pg_catalog.jsonb_set(
      NEW.raw_user_meta_data, '{debtfree_native_v1,settingsRevision}',
      pg_catalog.to_jsonb(before_revision + 1), true
    );
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'DEBTFREE_SETTINGS_PROTECTED: use atomic settings RPC' USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS debtfree_settings_revision_guard ON auth.users;
CREATE TRIGGER debtfree_settings_revision_guard
  BEFORE UPDATE OF raw_user_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.debtfree_guard_settings_revision();

-- JSONB is stored only inside auth.users. A row lock protects the compare, and
-- the UPDATE commits the metadata change and next revision atomically.
CREATE OR REPLACE FUNCTION public.debtfree_save_settings(
  p_expected_revision bigint, p_settings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid;
  previous_revision bigint;
  previous_profile jsonb;
  normalized jsonb;
BEGIN
  current_user_id := (SELECT auth.uid());
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_expected_revision >= 9223372036854775806
     OR p_settings IS NULL OR pg_catalog.jsonb_typeof(p_settings) <> 'object'
     OR p_settings ->> 'userId' IS DISTINCT FROM current_user_id::text
     OR p_settings ->> 'version' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Invalid DebtFree settings payload' USING ERRCODE = '22023';
  END IF;
  SELECT raw_user_meta_data -> 'debtfree_native_v1',
         public.debtfree_settings_revision(raw_user_meta_data -> 'debtfree_native_v1')
    INTO previous_profile, previous_revision FROM auth.users
    WHERE id = current_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF previous_profile ? 'householdId' AND
     previous_profile ->> 'householdId' IS DISTINCT FROM p_settings ->> 'householdId' THEN
    RAISE EXCEPTION 'Saved household ownership cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF previous_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'DEBTFREE_SETTINGS_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  normalized := pg_catalog.jsonb_set(
    (p_settings - 'settingsRevision' - 'debts') || '{"debts":[]}'::jsonb,
    '{settingsRevision}', pg_catalog.to_jsonb(previous_revision + 1), true
  );
  PERFORM pg_catalog.set_config('debtfree.settings_rpc_cas', 'on', true);
  UPDATE auth.users SET raw_user_meta_data = pg_catalog.jsonb_set(
    COALESCE(raw_user_meta_data, '{}'::jsonb), '{debtfree_native_v1}', normalized, true
  ) WHERE id = current_user_id;
  RETURN normalized;
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_settings_revision(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debtfree_guard_settings_revision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debtfree_save_settings(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_save_settings(bigint, jsonb) TO authenticated;

-- BEFORE INSERT checks can run before a concurrently deleting transaction
-- commits. Recheck after unique-index arbitration to prevent a stale insert
-- recreating an ID that was deleted while it waited for the existing row.
DROP TRIGGER IF EXISTS debtfree_debt_tombstone_postinsert ON public.debts;
CREATE TRIGGER debtfree_debt_tombstone_postinsert
  AFTER INSERT ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.debtfree_debt_tombstone_guard();

REVOKE INSERT, UPDATE, DELETE ON public.debtfree_deleted_debt_ids FROM PUBLIC, anon, authenticated;
-- Readback confirms a deletion without exposing another user's tombstones (RLS).
GRANT SELECT ON public.debtfree_deleted_debt_ids TO authenticated;

-- PostgREST must refresh its function signature cache after this migration.
NOTIFY pgrst, 'reload schema';
COMMIT;
