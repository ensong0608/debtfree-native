-- Scoped provenance and archive storage for household backup migrations.
-- Retains raw source payloads, conversion manifests, identity maps, and
-- source-only/historical records with household attribution and RLS.

BEGIN;

CREATE TABLE IF NOT EXISTS public.debtfree_household_import_archives (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  household_id text NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  imported_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_format text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(source_format)) > 0),
  source_version integer NOT NULL CHECK (source_version >= 1),
  source_exported_at timestamptz NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_byte_length bigint NOT NULL CHECK (source_byte_length > 0),
  migration_key text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(migration_key)) > 0),
  source_payload jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(source_payload) = 'object'),
  conversion_manifest jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(conversion_manifest) = 'object'),
  identity_map jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(identity_map) = 'object'),
  owner_questions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (pg_catalog.jsonb_typeof(owner_questions) = 'array'),
  imported_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (id, household_id),
  UNIQUE (household_id, migration_key),
  UNIQUE (household_id, source_sha256)
);

CREATE TABLE IF NOT EXISTS public.debtfree_household_import_records (
  archive_id uuid NOT NULL,
  domain text NOT NULL CHECK (domain IN (
    'account_metadata',
    'account_archive_history',
    'loan_tracker',
    'loan_history',
    'loan_correction',
    'transaction_archive',
    'transaction_revision',
    'balance_adjustment',
    'balance_adjustment_revision',
    'payee',
    'monthly_budget',
    'monthly_plan',
    'monthly_plan_month',
    'monthly_plan_settlement',
    'due_payment_association',
    'snapshot',
    'snapshot_revision',
    'disabled_recurring_source',
    'settings_metadata',
    'owner_question'
  )),
  id text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(id)) > 0),
  household_id text NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  imported_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_id text NOT NULL,
  native_table text,
  native_record_id text,
  disposition text NOT NULL CHECK (disposition IN (
    'mapped_native',
    'mapped_with_metadata',
    'source_only_archive',
    'excluded_from_active_ledger',
    'pending_owner_clarification'
  )),
  source_deleted_at timestamptz,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  attribution jsonb,
  source_record jsonb NOT NULL,
  notes text,
  PRIMARY KEY (archive_id, domain, id),
  FOREIGN KEY (archive_id, household_id)
    REFERENCES public.debtfree_household_import_archives(id, household_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS debtfree_household_import_archives_household_idx
  ON public.debtfree_household_import_archives (household_id, imported_at DESC);

CREATE INDEX IF NOT EXISTS debtfree_household_import_records_household_domain_idx
  ON public.debtfree_household_import_records (household_id, domain, id);

CREATE INDEX IF NOT EXISTS debtfree_household_import_records_native_ref_idx
  ON public.debtfree_household_import_records (household_id, native_table, native_record_id)
  WHERE native_table IS NOT NULL AND native_record_id IS NOT NULL;

ALTER TABLE public.debtfree_household_import_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debtfree_household_import_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.debtfree_household_import_archives FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.debtfree_household_import_records FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.debtfree_household_import_archives TO authenticated;
GRANT SELECT ON TABLE public.debtfree_household_import_records TO authenticated;

DROP POLICY IF EXISTS debtfree_household_import_archives_select
  ON public.debtfree_household_import_archives;
CREATE POLICY debtfree_household_import_archives_select
  ON public.debtfree_household_import_archives
  FOR SELECT
  TO authenticated
  USING (public.debtfree_household_member_context_active(household_id));

DROP POLICY IF EXISTS debtfree_household_import_records_select
  ON public.debtfree_household_import_records;
CREATE POLICY debtfree_household_import_records_select
  ON public.debtfree_household_import_records
  FOR SELECT
  TO authenticated
  USING (public.debtfree_household_member_context_active(household_id));

CREATE OR REPLACE FUNCTION public.debtfree_list_household_import_archives(
  p_household_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_lifecycle_state text;
  v_archives jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_household_id IS NULL OR p_household_id = ''
     OR p_household_id <> pg_catalog.btrim(p_household_id)
     OR pg_catalog.length(p_household_id) > 120 THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  SELECT h.lifecycle_state INTO v_lifecycle_state
  FROM public.households AS h
  WHERE h.id = p_household_id;
  IF NOT FOUND OR v_lifecycle_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  IF NOT public.debtfree_household_member_context_active(p_household_id) THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', a.id::text,
      'householdId', a.household_id,
      'importedByUserId', a.imported_by_user_id::text,
      'sourceFormat', a.source_format,
      'sourceVersion', a.source_version,
      'sourceExportedAt', a.source_exported_at,
      'sourceSha256', a.source_sha256,
      'sourceByteLength', a.source_byte_length,
      'migrationKey', a.migration_key,
      'importedAt', a.imported_at,
      'conversionManifest', a.conversion_manifest,
      'ownerQuestions', a.owner_questions
    ) ORDER BY a.imported_at DESC, a.id DESC
  ), '[]'::jsonb)
  INTO v_archives
  FROM public.debtfree_household_import_archives AS a
  WHERE a.household_id = p_household_id
    AND public.debtfree_household_member_context_active(a.household_id);

  RETURN v_archives;
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_list_household_import_archives(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_list_household_import_archives(text) TO authenticated;

COMMIT;
