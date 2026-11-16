-- Coordinated household shared-finance cutover and membership authority.
-- Locks finance/profile tables, closes all staged client-write gaps, replaces
-- user-scoped triggers/RPCs with household-scoped equivalents, installs member
-- management RPCs, enables the cutover gate, and verifies deletion readiness.
BEGIN;

LOCK TABLE auth.users,
  public.debtfree_account_lifecycle,
  public.debtfree_household_cutover_gate,
  public.households,
  public.household_members,
  public.household_settings,
  public.household_profiles,
  public.debts,
  public.transactions,
  public.recurring_bills,
  public.reconciliation_anchors,
  public.debtfree_deleted_debt_ids,
  public.debtfree_deleted_bill_ids,
  public.debtfree_restore_receipts
  IN ACCESS EXCLUSIVE MODE;

-- ============================================================================
-- 1. Preflight Verification & Household Settings Backfill
-- ============================================================================
DO $preflight$
DECLARE
  r record;
  v_bad boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.debtfree_household_cutover_gate
    WHERE singleton AND NOT enabled
  ) OR (SELECT count(*) FROM public.debtfree_household_cutover_gate) <> 1 THEN
    RAISE EXCEPTION 'Household cutover gate is in an unexpected state' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.households AS h
    WHERE (
      SELECT count(*)
      FROM public.household_members AS hm
      WHERE hm.household_id = h.id
        AND hm.status = 'active'
        AND hm.role = 'owner'
    ) <> 1
      AND h.lifecycle_state = 'active'
  ) THEN
    RAISE EXCEPTION 'Active household without exactly one active owner detected' USING ERRCODE = '55000';
  END IF;

  -- Backfill durable settings rows for any existing household that lacked
  -- legacy auth metadata during bootstrap.
  INSERT INTO public.household_settings (household_id, revision, settings)
  SELECT h.id,
         0,
         pg_catalog.jsonb_build_object(
           'householdId', h.id,
           'householdName', h.name,
           'currencyCode', pg_catalog.upper(h.currency)
         )
  FROM public.households AS h
  WHERE NOT EXISTS (
    SELECT 1 FROM public.household_settings AS hs WHERE hs.household_id = h.id
  )
  ON CONFLICT (household_id) DO NOTHING;

  -- Confirm zero null household_id values and valid household attribution on
  -- all 6 financial & tombstone tables before enforcing NOT NULL.
  FOR r IN SELECT * FROM (VALUES
    ('debts', 'user_id'),
    ('transactions', 'user_id'),
    ('recurring_bills', 'user_id'),
    ('reconciliation_anchors', 'user_id'),
    ('debtfree_deleted_debt_ids', 'deleted_user_id'),
    ('debtfree_deleted_bill_ids', 'user_id')
  ) AS x(tbl, actor_col) LOOP
    EXECUTE pg_catalog.format(
      'SELECT EXISTS (
         SELECT 1 FROM public.%I AS f
         LEFT JOIN public.households AS h ON h.id = f.household_id
         WHERE f.household_id IS NULL OR h.id IS NULL
       )',
      r.tbl
    ) INTO STRICT v_bad;
    IF v_bad THEN
      RAISE EXCEPTION 'Null or orphan household_id remains in %', r.tbl USING ERRCODE = '55000';
    END IF;
  END LOOP;

  -- Confirm no cross-household links exist across debts, transactions, bills, or anchors.
  IF EXISTS (
    SELECT 1
    FROM public.transactions AS t
    JOIN public.debts AS d ON d.id = t.account_id
    WHERE t.account_id IS NOT NULL
      AND t.household_id IS DISTINCT FROM d.household_id
  ) OR EXISTS (
    SELECT 1
    FROM public.recurring_bills AS b
    JOIN public.debts AS d ON d.id = b.credit_account_id
    WHERE b.credit_account_id IS NOT NULL
      AND b.household_id IS DISTINCT FROM d.household_id
  ) OR EXISTS (
    SELECT 1
    FROM public.reconciliation_anchors AS a
    JOIN public.debts AS d ON d.id = a.account_id
    WHERE a.household_id IS DISTINCT FROM d.household_id
  ) THEN
    RAISE EXCEPTION 'Cross-household financial link detected before cutover' USING ERRCODE = '55000';
  END IF;
END
$preflight$;

-- ============================================================================
-- 2. Enforce Mandatory Household Attribution, Primary Keys & Read-Only Privileges
-- ============================================================================
ALTER TABLE public.debts ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.recurring_bills ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.reconciliation_anchors ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.debtfree_deleted_debt_ids ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.debtfree_deleted_bill_ids ALTER COLUMN household_id SET NOT NULL;

ALTER TABLE public.debtfree_deleted_bill_ids
  DROP CONSTRAINT IF EXISTS debtfree_deleted_bill_ids_legacy_actor_key;
ALTER TABLE public.debtfree_deleted_bill_ids
  DROP CONSTRAINT IF EXISTS debtfree_deleted_bill_ids_household_key;
ALTER TABLE public.debtfree_deleted_bill_ids
  DROP CONSTRAINT IF EXISTS debtfree_deleted_bill_ids_pkey;
ALTER TABLE public.debtfree_deleted_bill_ids
  ADD CONSTRAINT debtfree_deleted_bill_ids_pkey PRIMARY KEY (household_id, bill_id);

-- Drop all non-SELECT policies on the 6 finance tables and legacy household_profiles,
-- and drop the staged client-visible deleted-bill policy.
DO $drop_policies$
DECLARE
  r record;
BEGIN
  DROP POLICY IF EXISTS debtfree_deleted_bill_ids_staged_select ON public.debtfree_deleted_bill_ids;
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'debts',
        'transactions',
        'recurring_bills',
        'reconciliation_anchors',
        'debtfree_deleted_debt_ids',
        'debtfree_deleted_bill_ids',
        'household_profiles'
      )
      AND cmd <> 'SELECT'
  LOOP
    EXECUTE pg_catalog.format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END
$drop_policies$;

DROP POLICY IF EXISTS debtfree_deleted_bill_ids_no_direct_client_access ON public.debtfree_deleted_bill_ids;
CREATE POLICY debtfree_deleted_bill_ids_no_direct_client_access
  ON public.debtfree_deleted_bill_ids
  AS RESTRICTIVE
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

-- Revoke ALL table and column privileges from PUBLIC, anon, and authenticated on
-- the 6 finance/tombstone tables and household_profiles, then re-grant SELECT only
-- on the client-readable tables.
REVOKE ALL ON TABLE
  public.debts,
  public.transactions,
  public.recurring_bills,
  public.reconciliation_anchors,
  public.debtfree_deleted_debt_ids,
  public.debtfree_deleted_bill_ids,
  public.household_profiles
  FROM PUBLIC, anon, authenticated;

DO $revoke_cols$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'debts',
        'transactions',
        'recurring_bills',
        'reconciliation_anchors',
        'debtfree_deleted_debt_ids',
        'debtfree_deleted_bill_ids',
        'household_profiles'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL (%1$I) ON TABLE public.%2$I FROM PUBLIC, anon, authenticated',
      r.column_name,
      r.table_name
    );
  END LOOP;
END
$revoke_cols$;

GRANT SELECT ON TABLE
  public.debts,
  public.transactions,
  public.recurring_bills,
  public.reconciliation_anchors,
  public.debtfree_deleted_debt_ids,
  public.household_profiles
  TO authenticated;

-- ============================================================================
-- 3. Convert debtfree_restore_receipts to Household Key & Add Household Receipts
-- ============================================================================
ALTER TABLE public.debtfree_restore_receipts
  ADD COLUMN IF NOT EXISTS household_id text;

DO $restore_receipt_backfill$
DECLARE
  v_fk_name text;
  v_bad boolean;
BEGIN
  UPDATE public.debtfree_restore_receipts AS rr
  SET household_id = COALESCE(
    NULLIF(rr.request_identity ->> 'householdId', ''),
    NULLIF(rr.restored_snapshot ->> 'householdId', ''),
    (
      SELECT min(hm.household_id)
      FROM public.household_members AS hm
      WHERE hm.user_id = rr.owner_user_id
        AND hm.role = 'owner'
        AND hm.status = 'active'
      HAVING count(*) = 1
    )
  )
  WHERE rr.household_id IS NULL;

  SELECT EXISTS (
    SELECT 1
    FROM public.debtfree_restore_receipts AS rr
    LEFT JOIN public.households AS h ON h.id = rr.household_id
    WHERE rr.household_id IS NULL OR h.id IS NULL
  ) INTO STRICT v_bad;
  IF v_bad THEN
    RAISE EXCEPTION 'Unable to attribute existing restore receipts to a valid household' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.debtfree_restore_receipts
    GROUP BY household_id, operation_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Restore receipt (household_id, operation_id) collision detected' USING ERRCODE = '55000';
  END IF;

  SELECT c.conname INTO v_fk_name
  FROM pg_catalog.pg_constraint AS c
  JOIN pg_catalog.pg_attribute AS a
    ON a.attrelid = c.conrelid AND a.attname = 'owner_user_id'
  WHERE c.conrelid = 'public.debtfree_restore_receipts'::regclass
    AND c.contype = 'f'
    AND c.confrelid = 'auth.users'::regclass
    AND c.conkey = ARRAY[a.attnum]::smallint[];
  IF v_fk_name IS NOT NULL THEN
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.debtfree_restore_receipts DROP CONSTRAINT %I',
      v_fk_name
    );
  END IF;
END
$restore_receipt_backfill$;

ALTER TABLE public.debtfree_restore_receipts
  DROP CONSTRAINT IF EXISTS debtfree_restore_receipts_pkey;
ALTER TABLE public.debtfree_restore_receipts
  ALTER COLUMN household_id SET NOT NULL,
  ALTER COLUMN owner_user_id DROP NOT NULL;
ALTER TABLE public.debtfree_restore_receipts
  ADD CONSTRAINT debtfree_restore_receipts_pkey PRIMARY KEY (household_id, operation_id);
ALTER TABLE public.debtfree_restore_receipts
  DROP CONSTRAINT IF EXISTS debtfree_restore_receipts_household_id_fkey;
ALTER TABLE public.debtfree_restore_receipts
  ADD CONSTRAINT debtfree_restore_receipts_household_id_fkey
    FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;
ALTER TABLE public.debtfree_restore_receipts
  ADD CONSTRAINT debtfree_restore_receipts_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_debtfree_restore_receipts_owner_user_id
  ON public.debtfree_restore_receipts (owner_user_id);

-- Durable idempotency receipts for household debt deletion, bill deletion, and reset.
CREATE TABLE IF NOT EXISTS public.debtfree_household_debt_deletion_receipts (
  household_id text NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  debt_id uuid NOT NULL,
  expected_version bigint NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (household_id, operation_id)
);
ALTER TABLE public.debtfree_household_debt_deletion_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.debtfree_household_debt_deletion_receipts FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS debtfree_household_debt_deletion_receipts_deny ON public.debtfree_household_debt_deletion_receipts;
CREATE POLICY debtfree_household_debt_deletion_receipts_deny
  ON public.debtfree_household_debt_deletion_receipts
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.debtfree_household_bill_deletion_receipts (
  household_id text NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  operation_id text NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  bill_id text NOT NULL,
  expected_updated_at timestamptz NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (household_id, operation_id)
);
ALTER TABLE public.debtfree_household_bill_deletion_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.debtfree_household_bill_deletion_receipts FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS debtfree_household_bill_deletion_receipts_deny ON public.debtfree_household_bill_deletion_receipts;
CREATE POLICY debtfree_household_bill_deletion_receipts_deny
  ON public.debtfree_household_bill_deletion_receipts
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.debtfree_household_reset_receipts (
  household_id text NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (household_id, operation_id)
);
ALTER TABLE public.debtfree_household_reset_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.debtfree_household_reset_receipts FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS debtfree_household_reset_receipts_deny ON public.debtfree_household_reset_receipts;
CREATE POLICY debtfree_household_reset_receipts_deny
  ON public.debtfree_household_reset_receipts
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

-- ============================================================================
-- 4. Household-Scoped Finance Triggers & Auth ON DELETE SET NULL Compatibility
-- ============================================================================
DROP TRIGGER IF EXISTS debtfree_financial_mutex ON public.debts;
DROP TRIGGER IF EXISTS debtfree_financial_mutex ON public.recurring_bills;
DROP TRIGGER IF EXISTS debtfree_rpc_only_debt_updates ON public.debts;
DROP TRIGGER IF EXISTS debtfree_rpc_only_debt_writes ON public.debts;
DROP TRIGGER IF EXISTS debtfree_rpc_only_bill_writes ON public.recurring_bills;

CREATE TRIGGER debtfree_rpc_only_debt_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.debtfree_reject_direct_ledger_write();

CREATE TRIGGER debtfree_rpc_only_bill_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.recurring_bills
  FOR EACH ROW EXECUTE FUNCTION public.debtfree_reject_direct_ledger_write();

-- Debt version trigger: allows Auth ON DELETE SET NULL when only user_id clears,
-- without advancing revision or blocking Auth cleanup.
CREATE OR REPLACE FUNCTION public.debtfree_increment_debt_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (SELECT auth.uid()) IS NULL
     AND OLD.user_id IS NOT NULL AND NEW.user_id IS NULL
     AND (pg_catalog.to_jsonb(NEW) - 'user_id') IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD) - 'user_id') THEN
    NEW.version := OLD.version;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.household_id IS DISTINCT FROM OLD.household_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Debt household, creator attribution, and identity are immutable'
      USING ERRCODE = '23514';
  END IF;
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_increment_debt_version() FROM PUBLIC, anon, authenticated;

-- Debt tombstone guard: writes household_id alongside nullable deleted_user_id
-- whenever a debt in an active household is deleted.
CREATE OR REPLACE FUNCTION public.debtfree_debt_tombstone_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM public.households AS h
      WHERE h.id = OLD.household_id AND h.lifecycle_state = 'active'
    ) THEN
      INSERT INTO public.debtfree_deleted_debt_ids (id, deleted_user_id, household_id)
      VALUES (OLD.id, OLD.user_id, OLD.household_id)
      ON CONFLICT (id) DO NOTHING;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.debtfree_deleted_debt_ids WHERE id = NEW.id) THEN
      RAISE EXCEPTION 'Deleted debt identity cannot be reused' USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_debt_tombstone_guard() FROM PUBLIC, anon, authenticated;

-- Recurring bill identity & retired-ID guard: scoped by household_id and safe
-- for Auth ON DELETE SET NULL.
CREATE OR REPLACE FUNCTION public.debtfree_guard_bill_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (SELECT auth.uid()) IS NULL
     AND OLD.user_id IS NOT NULL AND NEW.user_id IS NULL
     AND (pg_catalog.to_jsonb(NEW) - 'user_id') IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD) - 'user_id') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.household_id IS DISTINCT FROM OLD.household_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
  ) THEN
    RAISE EXCEPTION 'Recurring bill identity, household, and creator cannot be changed'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.debtfree_deleted_bill_ids AS retired
    WHERE retired.household_id = NEW.household_id
      AND retired.bill_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Deleted recurring bill identity cannot be reused'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_guard_bill_identity() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.debtfree_record_deleted_bill_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.households AS h
    WHERE h.id = OLD.household_id AND h.lifecycle_state = 'active'
  ) THEN
    INSERT INTO public.debtfree_deleted_bill_ids (household_id, user_id, bill_id)
    VALUES (OLD.household_id, OLD.user_id, OLD.id)
    ON CONFLICT (household_id, bill_id) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_record_deleted_bill_identity() FROM PUBLIC, anon, authenticated;

-- Transaction retired-bill identity guard: scoped by household_id and safe for
-- Auth ON DELETE SET NULL.
CREATE OR REPLACE FUNCTION public.debtfree_guard_transaction_bill_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.transactions%ROWTYPE;
  v_ids text[];
  v_old_ids text[] := ARRAY[]::text[];
  v_new_ids text[] := ARRAY[]::text[];
  v_match text[];
  v_bill_id text;
  v_pass integer;
  v_space text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF TG_OP = 'UPDATE' AND (SELECT auth.uid()) IS NULL
     AND OLD.user_id IS NOT NULL AND NEW.user_id IS NULL
     AND (pg_catalog.to_jsonb(NEW) - 'user_id') IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD) - 'user_id') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.household_id IS DISTINCT FROM OLD.household_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
  ) THEN
    RAISE EXCEPTION 'Transaction household and creator attribution cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  FOR v_pass IN 1..2 LOOP
    IF v_pass = 1 THEN
      IF TG_OP = 'INSERT' THEN CONTINUE; END IF;
      v_row := OLD;
    ELSE
      v_row := NEW;
    END IF;
    v_ids := ARRAY[]::text[];
    IF pg_catalog.left(v_row.id, 5) = 'bill:' THEN
      v_bill_id := pg_catalog.split_part(v_row.id, ':', 2);
      IF v_bill_id <> '' THEN v_ids := pg_catalog.array_append(v_ids, v_bill_id); END IF;
    END IF;
    FOR v_match IN SELECT pg_catalog.regexp_matches(COALESCE(v_row.memo, '') COLLATE pg_catalog."C", $re$\[bill:([^\]:]+)(?::[^\]]*)?\]$re$, 'g') LOOP
      v_ids := pg_catalog.array_append(v_ids, pg_catalog.btrim(v_match[1], v_space));
    END LOOP;
    FOR v_match IN SELECT pg_catalog.regexp_matches(
      COALESCE(v_row.memo, '') COLLATE pg_catalog."C",
      '(^|[' || v_space || ',;:(])bill:([a-zA-Z0-9_-]+)(:[^' || v_space || ',;)\]]*)?', 'g'
    ) LOOP
      v_ids := pg_catalog.array_append(v_ids, v_match[2]);
    END LOOP;
    IF v_pass = 1 THEN v_old_ids := v_ids; ELSE v_new_ids := v_ids; END IF;
  END LOOP;

  FOREACH v_bill_id IN ARRAY v_new_ids LOOP
    IF (TG_OP = 'INSERT'
        OR NEW.household_id IS DISTINCT FROM OLD.household_id
        OR NOT (v_bill_id COLLATE pg_catalog."C" = ANY(v_old_ids))
        OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL))
       AND EXISTS (
         SELECT 1 FROM public.debtfree_deleted_bill_ids AS retired
         WHERE retired.household_id = NEW.household_id
           AND retired.bill_id COLLATE pg_catalog."C" = v_bill_id COLLATE pg_catalog."C"
       ) THEN
      RAISE EXCEPTION 'Deleted recurring bill identity cannot be referenced' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_guard_transaction_bill_identity() FROM PUBLIC, anon, authenticated;

-- Reconciliation anchor immutability guard (allows Auth ON DELETE SET NULL).
CREATE OR REPLACE FUNCTION public.debtfree_guard_anchor_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (SELECT auth.uid()) IS NULL
     AND OLD.user_id IS NOT NULL AND NEW.user_id IS NULL
     AND (pg_catalog.to_jsonb(NEW) - 'user_id') IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD) - 'user_id') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.household_id IS DISTINCT FROM OLD.household_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
  ) THEN
    RAISE EXCEPTION 'Reconciliation anchor identity, household, and creator cannot be changed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_guard_anchor_identity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS debtfree_guard_anchor_identity ON public.reconciliation_anchors;
CREATE TRIGGER debtfree_guard_anchor_identity
  BEFORE UPDATE ON public.reconciliation_anchors
  FOR EACH ROW EXECUTE FUNCTION public.debtfree_guard_anchor_identity();

-- ============================================================================
-- 5. Household-Scoped Paid-Off Archive Triggers & Legacy Profile CAS Save
-- ============================================================================
CREATE OR REPLACE FUNCTION public.debtfree_internal_sync_household_paid_off_archive(
  p_household_id text,
  p_debt_id uuid,
  p_archive boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_balance numeric(18, 4);
  v_revision bigint;
  v_settings jsonb;
  v_ids jsonb;
  v_next_ids jsonb;
BEGIN
  IF p_household_id IS NULL OR p_debt_id IS NULL OR p_archive IS NULL THEN
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('debtfree.finance:' || p_household_id, 0)
  );

  SELECT balance INTO v_balance
  FROM public.debts
  WHERE id = p_debt_id AND household_id = p_household_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF (p_archive AND v_balance <> 0) OR (NOT p_archive AND v_balance <= 0) THEN RETURN; END IF;

  SELECT revision, settings INTO v_revision, v_settings
  FROM public.household_settings
  WHERE household_id = p_household_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paid-off archive household settings are unavailable' USING ERRCODE = 'P0001';
  END IF;

  v_ids := COALESCE(v_settings -> 'archivedPaidOffDebtIds', '[]'::jsonb);
  IF pg_catalog.jsonb_typeof(v_ids) <> 'array' THEN
    RAISE EXCEPTION 'Paid-off archive settings are invalid' USING ERRCODE = '23514';
  END IF;

  IF p_archive THEN
    IF EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements_text(v_ids) AS item(value)
      WHERE item.value = p_debt_id::text
    ) THEN
      RETURN;
    END IF;
    v_next_ids := v_ids || pg_catalog.jsonb_build_array(p_debt_id::text);
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements_text(v_ids) AS item(value)
      WHERE item.value = p_debt_id::text
    ) THEN
      RETURN;
    END IF;
    SELECT COALESCE(pg_catalog.jsonb_agg(item.value ORDER BY item.ordinality), '[]'::jsonb)
    INTO v_next_ids
    FROM pg_catalog.jsonb_array_elements(v_ids) WITH ORDINALITY AS item(value, ordinality)
    WHERE item.value <> pg_catalog.to_jsonb(p_debt_id::text);
  END IF;

  IF v_revision >= 9223372036854775806 THEN
    RAISE EXCEPTION 'Paid-off archive settings revision exhausted' USING ERRCODE = '22003';
  END IF;

  v_settings := pg_catalog.jsonb_set(v_settings, '{archivedPaidOffDebtIds}', v_next_ids, true);
  UPDATE public.household_settings
  SET settings = v_settings,
      revision = v_revision + 1,
      updated_at = pg_catalog.now()
  WHERE household_id = p_household_id;
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_internal_sync_household_paid_off_archive(text, uuid, boolean)
  FROM PUBLIC, anon, authenticated;

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
  IF (SELECT auth.uid()) IS NOT NULL AND NEW.balance > 0 THEN
    PERFORM public.debtfree_internal_sync_household_paid_off_archive(NEW.household_id, NEW.id, false);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_unarchive_reopened_debt() FROM PUBLIC, anon, authenticated;

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
  IF v_uid IS NULL OR NEW.account_id IS NULL
     OR NEW.category <> 'payment' OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF pg_catalog.current_setting('debtfree.restore_importing', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT balance, category INTO v_balance, v_debt_category
  FROM public.debts
  WHERE id = NEW.account_id AND household_id = NEW.household_id;
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
    PERFORM public.debtfree_internal_sync_household_paid_off_archive(NEW.household_id, NEW.account_id, true);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_archive_confirmed_payment_at_zero() FROM PUBLIC, anon, authenticated;

-- Preserve personal onboarding/profile envelope CAS without calling the retired
-- single-user financial advisory lock.
CREATE OR REPLACE FUNCTION public.debtfree_save_settings(
  p_expected_revision bigint,
  p_settings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid := (SELECT auth.uid());
  previous_revision bigint;
  previous_profile jsonb;
  normalized jsonb;
BEGIN
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

  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[current_user_id], 'share', false);

  SELECT raw_user_meta_data -> 'debtfree_native_v1',
         public.debtfree_settings_revision(raw_user_meta_data -> 'debtfree_native_v1')
    INTO previous_profile, previous_revision
  FROM auth.users
  WHERE id = current_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;

  IF previous_profile ? 'householdId'
     AND previous_profile ->> 'householdId' IS DISTINCT FROM p_settings ->> 'householdId' THEN
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
  UPDATE auth.users
  SET raw_user_meta_data = pg_catalog.jsonb_set(
    COALESCE(raw_user_meta_data, '{}'::jsonb), '{debtfree_native_v1}', normalized, true
  )
  WHERE id = current_user_id;
  PERFORM pg_catalog.set_config('debtfree.settings_rpc_cas', 'off', true);

  RETURN normalized;
END;
$$;

-- ============================================================================
-- 6. Internal Household Finance Authorization & Core Debt / Reset RPCs
-- ============================================================================
CREATE OR REPLACE FUNCTION public.debtfree_internal_finance_authorize(
  p_household_id text,
  p_expected_membership_version bigint,
  p_allowed_roles text[],
  OUT r_actor uuid,
  OUT r_role text,
  OUT r_membership_version bigint,
  OUT r_currency text,
  OUT r_household_name text
)
RETURNS record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lifecycle_state text;
BEGIN
  r_actor := (SELECT auth.uid());
  IF r_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_household_id IS NULL OR p_household_id = ''
     OR p_household_id <> pg_catalog.btrim(p_household_id)
     OR pg_catalog.length(p_household_id) > 120 THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;
  IF p_expected_membership_version IS NULL OR p_expected_membership_version < 1
     OR p_allowed_roles IS NULL OR pg_catalog.cardinality(p_allowed_roles) = 0 THEN
    RAISE EXCEPTION 'Invalid household authorization parameters' USING ERRCODE = '22023';
  END IF;

  -- Global lock hierarchy: account guard -> household -> membership -> finance mutex.
  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[r_actor], 'share', false);
  PERFORM public.debtfree_internal_lock_households(ARRAY[p_household_id], 'share');

  SELECT h.lifecycle_state,
         h.membership_version,
         pg_catalog.upper(h.currency),
         h.name
    INTO v_lifecycle_state, r_membership_version, r_currency, r_household_name
  FROM public.households AS h
  WHERE h.id = p_household_id;
  IF NOT FOUND OR v_lifecycle_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  SELECT hm.role INTO r_role
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id
    AND hm.user_id = r_actor
    AND hm.status = 'active'
  FOR SHARE;
  IF NOT FOUND OR r_role IS NULL OR NOT (r_role = ANY (p_allowed_roles)) THEN
    RAISE EXCEPTION 'Household finance access denied' USING ERRCODE = '42501';
  END IF;

  IF r_membership_version IS DISTINCT FROM p_expected_membership_version THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Household membership version changed (expected %, current %)',
      p_expected_membership_version, r_membership_version
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('debtfree.finance:' || p_household_id, 0)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_internal_finance_authorize(text, bigint, text[])
  FROM PUBLIC, anon, authenticated;

-- Upsert one household debt account with optimistic concurrency and idempotency.
CREATE OR REPLACE FUNCTION public.debtfree_upsert_household_debt_atomic(
  p_household_id text,
  p_expected_membership_version bigint,
  p_debt jsonb,
  p_expected_version bigint DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
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

  SELECT * INTO v_existing
  FROM public.debts
  WHERE id = v_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.household_id IS DISTINCT FROM p_household_id THEN
      RAISE EXCEPTION 'Debt identity belongs to another household' USING ERRCODE = '23505';
    END IF;
    IF p_expected_version IS NULL THEN
      IF v_existing.name IS NOT DISTINCT FROM v_name
         AND v_existing.category IS NOT DISTINCT FROM v_category
         AND v_existing.balance IS NOT DISTINCT FROM v_balance
         AND v_existing.apr IS NOT DISTINCT FROM v_apr
         AND v_existing.minimum_payment IS NOT DISTINCT FROM v_minimum
         AND v_existing.original_balance IS NOT DISTINCT FROM v_original
         AND v_existing.credit_limit IS NOT DISTINCT FROM v_limit
         AND v_existing.due_day IS NOT DISTINCT FROM v_due
         AND v_existing.annual_fee_amount IS NOT DISTINCT FROM v_annual_fee
         AND v_existing.annual_fee_next_due_date IS NOT DISTINCT FROM v_annual_fee_next_due THEN
        RETURN pg_catalog.jsonb_build_object(
          'success', true,
          'householdId', p_household_id,
          'membershipVersion', v_auth.r_membership_version::text,
          'row', pg_catalog.to_jsonb(v_existing)
        );
      END IF;
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Debt already exists with different fields' USING ERRCODE = '23505';
    END IF;
    IF p_expected_version < 1 THEN
      RAISE EXCEPTION 'Invalid expected debt version' USING ERRCODE = '22023';
    END IF;
    IF v_existing.version IS DISTINCT FROM p_expected_version THEN
      RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Stale debt revision' USING ERRCODE = 'P0001';
    END IF;

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

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'householdId', p_household_id,
    'membershipVersion', v_auth.r_membership_version::text,
    'row', pg_catalog.to_jsonb(v_saved)
  );
END;
$$;

-- Atomically delete a debt, its unambiguous linked transactions/anchors/paired
-- bill, and clean up corresponding household_settings metadata with idempotency.
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
  v_bill_id text;
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
      SELECT bill.id INTO v_bill_id
      FROM public.recurring_bills AS bill
      WHERE bill.id = v_pair_bill_id
        AND bill.household_id = p_household_id
        AND bill.active IS TRUE
        AND bill.payment_method = 'debit'
        AND (
          (v_debt_category = 'Mortgage' AND bill.category IN ('housing', 'other_bill'))
          OR (v_debt_category = 'Auto loan' AND bill.category = 'other_bill')
        );
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
          OR (v_bill_id IS NOT NULL AND
              v_bill_id = ANY(public.debtfree_bill_ids_for_transaction(tx.id, tx.memo)))
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
            OR (v_bill_id IS NOT NULL AND
                v_bill_id = ANY(public.debtfree_bill_ids_for_transaction(tx.id, tx.memo)))
          )
      )
    );
  GET DIAGNOSTICS v_anchor_count = ROW_COUNT;

  DELETE FROM public.transactions AS tx
  WHERE tx.household_id = p_household_id
    AND (
      tx.account_id = p_debt_id
      OR (v_bill_id IS NOT NULL AND
          v_bill_id = ANY(public.debtfree_bill_ids_for_transaction(tx.id, tx.memo)))
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

-- Owner-only atomic household financial reset with durable operation receipt.
CREATE OR REPLACE FUNCTION public.debtfree_reset_household_financial_data_atomic(
  p_household_id text,
  p_expected_membership_version bigint,
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
  v_next_settings jsonb;
  v_receipt jsonb;
BEGIN
  SELECT * INTO v_auth
  FROM public.debtfree_internal_finance_authorize(
    p_household_id, p_expected_membership_version, ARRAY['owner']
  );

  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Reset operation ID is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_rec
  FROM public.debtfree_household_reset_receipts
  WHERE household_id = p_household_id AND operation_id = p_operation_id;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_set(
      v_rec.receipt,
      ARRAY['membershipVersion'],
      pg_catalog.to_jsonb(v_auth.r_membership_version::text),
      true
    );
  END IF;

  SELECT hs.revision, hs.settings
    INTO v_settings_revision, v_settings
  FROM public.household_settings AS hs
  WHERE hs.household_id = p_household_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Household settings unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF v_settings_revision >= 9223372036854775806 THEN
    RAISE EXCEPTION 'Household settings revision exhausted' USING ERRCODE = '22003';
  END IF;

  DELETE FROM public.reconciliation_anchors WHERE household_id = p_household_id;
  DELETE FROM public.transactions WHERE household_id = p_household_id;
  DELETE FROM public.recurring_bills WHERE household_id = p_household_id;
  DELETE FROM public.debts WHERE household_id = p_household_id;

  v_next_settings := pg_catalog.jsonb_build_object(
    'householdId', p_household_id,
    'householdName', v_auth.r_household_name,
    'currencyCode', v_auth.r_currency
  );
  IF pg_catalog.jsonb_typeof(v_settings) = 'object' THEN
    IF v_settings ->> 'countryCode' IN ('US', 'CA', 'GB', 'AU') THEN
      v_next_settings := v_next_settings || pg_catalog.jsonb_build_object(
        'countryCode', v_settings ->> 'countryCode'
      );
    END IF;
    IF v_settings ? 'householdTimeZone'
       AND pg_catalog.jsonb_typeof(v_settings -> 'householdTimeZone') = 'string'
       AND EXISTS (
         SELECT 1 FROM pg_catalog.pg_timezone_names AS t
         WHERE t.name = v_settings ->> 'householdTimeZone'
       ) THEN
      v_next_settings := v_next_settings || pg_catalog.jsonb_build_object(
        'householdTimeZone', v_settings ->> 'householdTimeZone'
      );
    END IF;
  END IF;

  v_next_settings_revision := v_settings_revision + 1;
  UPDATE public.household_settings
  SET settings = v_next_settings,
      revision = v_next_settings_revision,
      updated_at = pg_catalog.now()
  WHERE household_id = p_household_id;

  v_receipt := pg_catalog.jsonb_build_object(
    'success', true,
    'operationId', p_operation_id,
    'householdId', p_household_id,
    'membershipVersion', v_auth.r_membership_version::text,
    'settingsRevision', v_next_settings_revision,
    'settings', v_next_settings
  );

  INSERT INTO public.debtfree_household_reset_receipts (
    household_id, operation_id, actor_user_id, receipt
  ) VALUES (
    p_household_id, p_operation_id, v_auth.r_actor, v_receipt
  );

  RETURN v_receipt;
END;
$$;

-- ============================================================================
-- 7. Household Transaction & Recurring Bill Atomic RPCs
-- ============================================================================
CREATE OR REPLACE FUNCTION public.debtfree_record_household_transaction_atomic(
  p_household_id text,
  p_expected_membership_version bigint,
  p_tx jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_expected_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth record;
  v_tx_id text;
  v_account_id uuid;
  v_date date;
  v_applies_to_date date;
  v_amount numeric(18, 4);
  v_category text;
  v_payee text;
  v_memo text;
  v_source text;
  v_reconciled boolean;
  v_principal numeric(18, 4);
  v_interest numeric(18, 4);
  v_escrow numeric(18, 4);
  v_fee numeric(18, 4);
  v_now timestamptz := pg_catalog.now();
  v_existing public.transactions%ROWTYPE;
  v_saved_tx public.transactions%ROWTYPE;
  v_current_balance numeric(18, 4);
  v_debt_category text;
  v_current_version bigint;
  v_delta numeric(18, 4);
  v_new_balance numeric(18, 4) := NULL;
  v_new_version bigint := NULL;
BEGIN
  SELECT * INTO v_auth
  FROM public.debtfree_internal_finance_authorize(
    p_household_id, p_expected_membership_version, ARRAY['owner', 'admin']
  );

  IF p_tx IS NULL OR pg_catalog.jsonb_typeof(p_tx) <> 'object' THEN
    RAISE EXCEPTION 'Transaction payload is required' USING ERRCODE = '22023';
  END IF;
  IF p_tx ? 'household_id'
     AND NULLIF(pg_catalog.btrim(p_tx ->> 'household_id'), '') IS NOT NULL
     AND (p_tx ->> 'household_id') IS DISTINCT FROM p_household_id THEN
    RAISE EXCEPTION 'Transaction household mismatch' USING ERRCODE = '42501';
  END IF;

  v_tx_id := COALESCE(
    NULLIF(pg_catalog.btrim(p_idempotency_key), ''),
    NULLIF(pg_catalog.btrim(p_tx ->> 'id'), '')
  );
  IF v_tx_id IS NULL OR pg_catalog.length(v_tx_id) > 512 THEN
    RAISE EXCEPTION 'Transaction ID / idempotency key is required' USING ERRCODE = '23502';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_tx ->> 'id'), '') IS DISTINCT FROM v_tx_id THEN
    RAISE EXCEPTION 'Transaction payload ID must match idempotency key' USING ERRCODE = '23514';
  END IF;

  v_account_id := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'account_id', '')), '')::uuid;
  v_date := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'date', '')), '')::date;
  v_applies_to_date := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'applies_to_date', '')), '')::date;
  v_amount := (p_tx ->> 'amount')::numeric(18, 4);
  v_category := pg_catalog.btrim(COALESCE(p_tx ->> 'category', ''));
  v_payee := pg_catalog.btrim(COALESCE(p_tx ->> 'payee', ''));
  v_memo := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'memo', '')), '');
  v_source := COALESCE(NULLIF(pg_catalog.btrim(p_tx ->> 'source'), ''), 'manual');
  v_reconciled := COALESCE((p_tx ->> 'reconciled')::boolean, false);
  v_principal := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'principal_amount', '')), '')::numeric(18, 4);
  v_interest := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'interest_amount', '')), '')::numeric(18, 4);
  v_escrow := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'escrow_amount', '')), '')::numeric(18, 4);
  v_fee := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'fee_amount', '')), '')::numeric(18, 4);

  IF v_date IS NULL OR v_amount IS NULL OR v_amount <= 0 OR v_payee = '' OR pg_catalog.length(v_payee) > 200 THEN
    RAISE EXCEPTION 'Invalid transaction date, amount, or payee' USING ERRCODE = '23514';
  END IF;
  IF v_source NOT IN ('manual', 'recurring_bill', 'reconciliation', 'system')
     OR v_category NOT IN (
       'purchase', 'subscription', 'utilities', 'interest', 'fee', 'annual_fee',
       'interest_adjustment', 'balance_adjustment', 'payment', 'refund', 'credit_adjustment',
       'debit_bill', 'debit_spending'
     ) THEN
    RAISE EXCEPTION 'Invalid transaction category or source' USING ERRCODE = '23514';
  END IF;
  IF v_category IN ('debit_bill', 'debit_spending') AND v_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cashflow transaction cannot reference a debt account' USING ERRCODE = '23514';
  END IF;
  IF v_category NOT IN ('debit_bill', 'debit_spending') AND v_account_id IS NULL THEN
    RAISE EXCEPTION 'Debt transaction requires an account ID' USING ERRCODE = '23514';
  END IF;
  IF (v_principal IS NOT NULL AND v_principal < 0)
     OR (v_interest IS NOT NULL AND v_interest < 0)
     OR (v_escrow IS NOT NULL AND v_escrow < 0)
     OR (v_fee IS NOT NULL AND v_fee < 0)
     OR (
       (v_principal IS NOT NULL OR v_interest IS NOT NULL OR v_escrow IS NOT NULL OR v_fee IS NOT NULL)
       AND v_category <> 'payment'
     )
     OR (
       COALESCE(v_principal, 0) + COALESCE(v_interest, 0) + COALESCE(v_escrow, 0) + COALESCE(v_fee, 0) > v_amount
     ) THEN
    RAISE EXCEPTION 'Invalid transaction payment allocation breakdown' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_existing
  FROM public.transactions
  WHERE id = v_tx_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.household_id IS DISTINCT FROM p_household_id THEN
      RAISE EXCEPTION 'Transaction identity belongs to another household' USING ERRCODE = '23505';
    END IF;
    IF v_existing.deleted_at IS NULL
       AND v_existing.account_id IS NOT DISTINCT FROM v_account_id
       AND v_existing.date = v_date
       AND v_existing.applies_to_date IS NOT DISTINCT FROM v_applies_to_date
       AND v_existing.amount = v_amount
       AND v_existing.category = v_category
       AND v_existing.payee = v_payee
       AND v_existing.memo IS NOT DISTINCT FROM v_memo
       AND v_existing.source = v_source
       AND v_existing.reconciled = v_reconciled
       AND v_existing.principal_amount IS NOT DISTINCT FROM v_principal
       AND v_existing.interest_amount IS NOT DISTINCT FROM v_interest
       AND v_existing.escrow_amount IS NOT DISTINCT FROM v_escrow
       AND v_existing.fee_amount IS NOT DISTINCT FROM v_fee THEN
      IF v_account_id IS NOT NULL THEN
        SELECT balance, version INTO v_new_balance, v_new_version
        FROM public.debts
        WHERE id = v_account_id AND household_id = p_household_id;
      END IF;
      RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'householdId', p_household_id,
        'membershipVersion', v_auth.r_membership_version::text,
        'status', 'idempotent_duplicate',
        'transaction_id', v_tx_id,
        'account_id', v_account_id,
        'new_balance', v_new_balance,
        'new_version', v_new_version,
        'updated_at', v_existing.updated_at,
        'row', pg_catalog.to_jsonb(v_existing)
      );
    END IF;
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Transaction ID % already exists with different financial data', v_tx_id
      USING ERRCODE = '23505';
  END IF;

  IF v_account_id IS NOT NULL THEN
    SELECT balance, category, version
      INTO v_current_balance, v_debt_category, v_current_version
    FROM public.debts
    WHERE id = v_account_id AND household_id = p_household_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target debt account not found in household' USING ERRCODE = '23503';
    END IF;
    IF p_expected_version IS NULL THEN
      RAISE EXCEPTION 'MISSING_REVISION: Expected account version is required' USING ERRCODE = 'P0002';
    END IF;
    IF v_current_version IS DISTINCT FROM p_expected_version THEN
      RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Account balance changed concurrently (expected %, actual %)',
        p_expected_version, v_current_version
        USING ERRCODE = 'P0001';
    END IF;

    v_delta := public.debtfree_calculate_tx_delta(v_category, v_debt_category, v_amount, v_principal);
    v_new_balance := GREATEST(0::numeric(18, 4), v_current_balance + v_delta);

    UPDATE public.debts
    SET balance = v_new_balance,
        updated_at = v_now
    WHERE id = v_account_id AND household_id = p_household_id
    RETURNING version INTO v_new_version;
  END IF;

  INSERT INTO public.transactions (
    id, user_id, household_id, account_id, date, applies_to_date,
    amount, category, payee, memo, source, reconciled,
    created_at, updated_at, deleted_at,
    principal_amount, interest_amount, escrow_amount, fee_amount
  ) VALUES (
    v_tx_id, v_auth.r_actor, p_household_id, v_account_id, v_date, v_applies_to_date,
    v_amount, v_category, v_payee, v_memo, v_source, v_reconciled,
    v_now, v_now, NULL,
    v_principal, v_interest, v_escrow, v_fee
  )
  RETURNING * INTO v_saved_tx;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'householdId', p_household_id,
    'membershipVersion', v_auth.r_membership_version::text,
    'status', 'recorded',
    'transaction_id', v_tx_id,
    'account_id', v_account_id,
    'new_balance', v_new_balance,
    'new_version', v_new_version,
    'updated_at', v_saved_tx.updated_at,
    'row', pg_catalog.to_jsonb(v_saved_tx)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.debtfree_update_household_transaction_atomic(
  p_household_id text,
  p_expected_membership_version bigint,
  p_tx jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_expected_version bigint DEFAULT NULL,
  p_expected_old_account_version bigint DEFAULT NULL,
  p_expected_tx_version timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth record;
  v_tx_id text;
  v_old_tx public.transactions%ROWTYPE;
  v_saved_tx public.transactions%ROWTYPE;
  v_new_account_id uuid;
  v_new_date date;
  v_new_applies date;
  v_new_amount numeric(18, 4);
  v_new_category text;
  v_new_payee text;
  v_new_memo text;
  v_new_source text;
  v_new_reconciled boolean;
  v_new_principal numeric(18, 4);
  v_new_interest numeric(18, 4);
  v_new_escrow numeric(18, 4);
  v_new_fee numeric(18, 4);
  v_first_lock uuid;
  v_second_lock uuid;
  v_old_bal numeric(18, 4);
  v_old_cat text;
  v_old_ver bigint;
  v_new_bal numeric(18, 4);
  v_new_cat text;
  v_new_ver bigint;
  v_old_delta numeric(18, 4) := 0;
  v_new_delta numeric(18, 4) := 0;
  v_updated_at timestamptz;
BEGIN
  SELECT * INTO v_auth
  FROM public.debtfree_internal_finance_authorize(
    p_household_id, p_expected_membership_version, ARRAY['owner', 'admin']
  );

  IF p_tx IS NULL OR pg_catalog.jsonb_typeof(p_tx) <> 'object' THEN
    RAISE EXCEPTION 'Transaction payload is required' USING ERRCODE = '22023';
  END IF;
  IF p_tx ? 'household_id'
     AND NULLIF(pg_catalog.btrim(p_tx ->> 'household_id'), '') IS NOT NULL
     AND (p_tx ->> 'household_id') IS DISTINCT FROM p_household_id THEN
    RAISE EXCEPTION 'Transaction household mismatch' USING ERRCODE = '42501';
  END IF;

  v_tx_id := COALESCE(
    NULLIF(pg_catalog.btrim(p_idempotency_key), ''),
    NULLIF(pg_catalog.btrim(p_tx ->> 'id'), '')
  );
  IF v_tx_id IS NULL OR pg_catalog.length(v_tx_id) > 512 THEN
    RAISE EXCEPTION 'Transaction ID is required' USING ERRCODE = '23502';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_tx ->> 'id'), '') IS DISTINCT FROM v_tx_id THEN
    RAISE EXCEPTION 'Transaction payload ID must match idempotency key' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_old_tx
  FROM public.transactions
  WHERE id = v_tx_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction % not found', v_tx_id USING ERRCODE = '23503';
  END IF;
  IF v_old_tx.household_id IS DISTINCT FROM p_household_id THEN
    RAISE EXCEPTION 'Transaction belongs to another household' USING ERRCODE = '42501';
  END IF;
  IF v_old_tx.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot update a deleted transaction' USING ERRCODE = '23514';
  END IF;

  IF p_expected_tx_version IS NULL THEN
    RAISE EXCEPTION 'MISSING_REVISION: Expected transaction timestamp is required' USING ERRCODE = 'P0002';
  END IF;
  IF v_old_tx.updated_at IS DISTINCT FROM p_expected_tx_version THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Transaction changed concurrently (expected %, actual %)',
      p_expected_tx_version, v_old_tx.updated_at
      USING ERRCODE = 'P0001';
  END IF;

  v_new_account_id := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'account_id', '')), '')::uuid;
  v_new_date := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'date', '')), '')::date;
  v_new_applies := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'applies_to_date', '')), '')::date;
  v_new_amount := (p_tx ->> 'amount')::numeric(18, 4);
  v_new_category := pg_catalog.btrim(COALESCE(p_tx ->> 'category', ''));
  v_new_payee := pg_catalog.btrim(COALESCE(p_tx ->> 'payee', ''));
  v_new_memo := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'memo', '')), '');
  v_new_source := COALESCE(NULLIF(pg_catalog.btrim(p_tx ->> 'source'), ''), v_old_tx.source);
  v_new_reconciled := COALESCE((p_tx ->> 'reconciled')::boolean, v_old_tx.reconciled);
  v_new_principal := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'principal_amount', '')), '')::numeric(18, 4);
  v_new_interest := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'interest_amount', '')), '')::numeric(18, 4);
  v_new_escrow := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'escrow_amount', '')), '')::numeric(18, 4);
  v_new_fee := NULLIF(pg_catalog.btrim(COALESCE(p_tx ->> 'fee_amount', '')), '')::numeric(18, 4);

  IF v_new_date IS NULL OR v_new_amount IS NULL OR v_new_amount <= 0
     OR v_new_payee = '' OR pg_catalog.length(v_new_payee) > 200 THEN
    RAISE EXCEPTION 'Invalid transaction date, amount, or payee' USING ERRCODE = '23514';
  END IF;
  IF v_new_source NOT IN ('manual', 'recurring_bill', 'reconciliation', 'system')
     OR v_new_category NOT IN (
       'purchase', 'subscription', 'utilities', 'interest', 'fee', 'annual_fee',
       'interest_adjustment', 'balance_adjustment', 'payment', 'refund', 'credit_adjustment',
       'debit_bill', 'debit_spending'
     ) THEN
    RAISE EXCEPTION 'Invalid transaction category or source' USING ERRCODE = '23514';
  END IF;
  IF v_new_category IN ('debit_bill', 'debit_spending') AND v_new_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cashflow transaction cannot reference a debt account' USING ERRCODE = '23514';
  END IF;
  IF v_new_category NOT IN ('debit_bill', 'debit_spending') AND v_new_account_id IS NULL THEN
    RAISE EXCEPTION 'Debt transaction requires an account ID' USING ERRCODE = '23514';
  END IF;
  IF (v_new_principal IS NOT NULL AND v_new_principal < 0)
     OR (v_new_interest IS NOT NULL AND v_new_interest < 0)
     OR (v_new_escrow IS NOT NULL AND v_new_escrow < 0)
     OR (v_new_fee IS NOT NULL AND v_new_fee < 0)
     OR (
       (v_new_principal IS NOT NULL OR v_new_interest IS NOT NULL OR v_new_escrow IS NOT NULL OR v_new_fee IS NOT NULL)
       AND v_new_category <> 'payment'
     )
     OR (
       COALESCE(v_new_principal, 0) + COALESCE(v_new_interest, 0) + COALESCE(v_new_escrow, 0) + COALESCE(v_new_fee, 0) > v_new_amount
     ) THEN
    RAISE EXCEPTION 'Invalid transaction payment allocation breakdown' USING ERRCODE = '23514';
  END IF;

  -- Lock involved household debt rows in deterministic UUID order.
  IF v_old_tx.account_id IS NOT NULL AND v_new_account_id IS NOT NULL
     AND v_old_tx.account_id IS DISTINCT FROM v_new_account_id THEN
    v_first_lock := LEAST(v_old_tx.account_id, v_new_account_id);
    v_second_lock := GREATEST(v_old_tx.account_id, v_new_account_id);
    PERFORM 1 FROM public.debts WHERE id = v_first_lock AND household_id = p_household_id FOR UPDATE;
    PERFORM 1 FROM public.debts WHERE id = v_second_lock AND household_id = p_household_id FOR UPDATE;
  END IF;

  IF v_old_tx.account_id IS NOT NULL THEN
    SELECT balance, category, version INTO v_old_bal, v_old_cat, v_old_ver
    FROM public.debts
    WHERE id = v_old_tx.account_id AND household_id = p_household_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Original debt account not found in household' USING ERRCODE = '23503';
    END IF;
    v_old_delta := public.debtfree_calculate_tx_delta(
      v_old_tx.category, v_old_cat, v_old_tx.amount, v_old_tx.principal_amount
    );
  END IF;

  IF v_new_account_id IS NOT NULL THEN
    IF v_new_account_id = v_old_tx.account_id THEN
      v_new_bal := v_old_bal;
      v_new_cat := v_old_cat;
      v_new_ver := v_old_ver;
    ELSE
      SELECT balance, category, version INTO v_new_bal, v_new_cat, v_new_ver
      FROM public.debts
      WHERE id = v_new_account_id AND household_id = p_household_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Target debt account not found in household' USING ERRCODE = '23503';
      END IF;
    END IF;
    v_new_delta := public.debtfree_calculate_tx_delta(
      v_new_category, v_new_cat, v_new_amount, v_new_principal
    );
  END IF;

  IF v_old_tx.account_id IS NOT NULL AND v_new_account_id IS NOT DISTINCT FROM v_old_tx.account_id THEN
    IF p_expected_version IS NULL THEN
      RAISE EXCEPTION 'MISSING_REVISION: Expected account version is required' USING ERRCODE = 'P0002';
    END IF;
    IF v_new_ver IS DISTINCT FROM p_expected_version THEN
      RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Account balance changed concurrently' USING ERRCODE = 'P0001';
    END IF;
    IF p_expected_old_account_version IS NOT NULL AND v_old_ver IS DISTINCT FROM p_expected_old_account_version THEN
      RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Account balance changed concurrently' USING ERRCODE = 'P0001';
    END IF;

    v_new_bal := GREATEST(0::numeric(18, 4), v_old_bal - v_old_delta + v_new_delta);
    IF v_new_bal IS DISTINCT FROM v_old_bal THEN
      UPDATE public.debts
      SET balance = v_new_bal, updated_at = pg_catalog.now()
      WHERE id = v_new_account_id AND household_id = p_household_id
      RETURNING version INTO v_new_ver;
    END IF;
    v_old_bal := v_new_bal;
    v_old_ver := v_new_ver;
  ELSE
    IF v_old_tx.account_id IS NOT NULL THEN
      IF p_expected_old_account_version IS NULL THEN
        RAISE EXCEPTION 'MISSING_REVISION: Expected previous account version is required' USING ERRCODE = 'P0002';
      END IF;
      IF v_old_ver IS DISTINCT FROM p_expected_old_account_version THEN
        RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Previous account balance changed concurrently' USING ERRCODE = 'P0001';
      END IF;
      v_old_bal := GREATEST(0::numeric(18, 4), v_old_bal - v_old_delta);
      UPDATE public.debts
      SET balance = v_old_bal, updated_at = pg_catalog.now()
      WHERE id = v_old_tx.account_id AND household_id = p_household_id
      RETURNING version INTO v_old_ver;
    END IF;

    IF v_new_account_id IS NOT NULL THEN
      IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'MISSING_REVISION: Expected target account version is required' USING ERRCODE = 'P0002';
      END IF;
      IF v_new_ver IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Target account balance changed concurrently' USING ERRCODE = 'P0001';
      END IF;
      v_new_bal := GREATEST(0::numeric(18, 4), v_new_bal + v_new_delta);
      UPDATE public.debts
      SET balance = v_new_bal, updated_at = pg_catalog.now()
      WHERE id = v_new_account_id AND household_id = p_household_id
      RETURNING version INTO v_new_ver;
    END IF;
  END IF;

  v_updated_at := GREATEST(pg_catalog.now(), v_old_tx.updated_at + interval '1 millisecond');

  UPDATE public.transactions
  SET account_id = v_new_account_id,
      date = v_new_date,
      applies_to_date = v_new_applies,
      amount = v_new_amount,
      category = v_new_category,
      payee = v_new_payee,
      memo = v_new_memo,
      source = v_new_source,
      reconciled = v_new_reconciled,
      principal_amount = v_new_principal,
      interest_amount = v_new_interest,
      escrow_amount = v_new_escrow,
      fee_amount = v_new_fee,
      updated_at = v_updated_at
  WHERE id = v_tx_id AND household_id = p_household_id
  RETURNING * INTO v_saved_tx;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'householdId', p_household_id,
    'membershipVersion', v_auth.r_membership_version::text,
    'status', 'updated',
    'transaction_id', v_tx_id,
    'account_id', v_new_account_id,
    'new_balance', v_new_bal,
    'new_version', v_new_ver,
    'old_account_id', v_old_tx.account_id,
    'old_balance', v_old_bal,
    'old_version', v_old_ver,
    'updated_at', v_saved_tx.updated_at,
    'row', pg_catalog.to_jsonb(v_saved_tx)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.debtfree_delete_household_transaction_atomic(
  p_household_id text,
  p_expected_membership_version bigint,
  p_tx_id text,
  p_idempotency_key text DEFAULT NULL,
  p_expected_version bigint DEFAULT NULL,
  p_expected_tx_version timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth record;
  v_tx_id text;
  v_tx public.transactions%ROWTYPE;
  v_saved_tx public.transactions%ROWTYPE;
  v_bal numeric(18, 4) := NULL;
  v_cat text;
  v_ver bigint := NULL;
  v_delta numeric(18, 4) := 0;
  v_now timestamptz;
BEGIN
  SELECT * INTO v_auth
  FROM public.debtfree_internal_finance_authorize(
    p_household_id, p_expected_membership_version, ARRAY['owner', 'admin']
  );

  v_tx_id := NULLIF(pg_catalog.btrim(COALESCE(p_tx_id, '')), '');
  IF v_tx_id IS NULL OR pg_catalog.length(v_tx_id) > 512 THEN
    RAISE EXCEPTION 'Transaction ID is required' USING ERRCODE = '23502';
  END IF;
  IF NULLIF(pg_catalog.btrim(COALESCE(p_idempotency_key, '')), '') IS NOT NULL
     AND pg_catalog.btrim(p_idempotency_key) IS DISTINCT FROM v_tx_id THEN
    RAISE EXCEPTION 'Idempotency key must match transaction ID' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_tx
  FROM public.transactions
  WHERE id = v_tx_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction % not found', v_tx_id USING ERRCODE = '23503';
  END IF;
  IF v_tx.household_id IS DISTINCT FROM p_household_id THEN
    RAISE EXCEPTION 'Transaction belongs to another household' USING ERRCODE = '42501';
  END IF;

  IF v_tx.deleted_at IS NOT NULL THEN
    IF v_tx.account_id IS NOT NULL THEN
      SELECT balance, version INTO v_bal, v_ver
      FROM public.debts
      WHERE id = v_tx.account_id AND household_id = p_household_id;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'householdId', p_household_id,
      'membershipVersion', v_auth.r_membership_version::text,
      'status', 'already_deleted',
      'transaction_id', v_tx_id,
      'account_id', v_tx.account_id,
      'new_balance', v_bal,
      'new_version', v_ver,
      'updated_at', v_tx.updated_at,
      'row', pg_catalog.to_jsonb(v_tx)
    );
  END IF;

  IF p_expected_tx_version IS NULL THEN
    RAISE EXCEPTION 'MISSING_REVISION: Expected transaction timestamp is required' USING ERRCODE = 'P0002';
  END IF;
  IF v_tx.updated_at IS DISTINCT FROM p_expected_tx_version THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Transaction changed concurrently' USING ERRCODE = 'P0001';
  END IF;

  IF v_tx.account_id IS NOT NULL THEN
    SELECT balance, category, version INTO v_bal, v_cat, v_ver
    FROM public.debts
    WHERE id = v_tx.account_id AND household_id = p_household_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Debt account not found in household' USING ERRCODE = '23503';
    END IF;
    IF p_expected_version IS NULL THEN
      RAISE EXCEPTION 'MISSING_REVISION: Expected account version is required' USING ERRCODE = 'P0002';
    END IF;
    IF v_ver IS DISTINCT FROM p_expected_version THEN
      RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Account balance changed concurrently' USING ERRCODE = 'P0001';
    END IF;

    v_delta := public.debtfree_calculate_tx_delta(v_tx.category, v_cat, v_tx.amount, v_tx.principal_amount);
    v_bal := GREATEST(0::numeric(18, 4), v_bal - v_delta);
    UPDATE public.debts
    SET balance = v_bal, updated_at = pg_catalog.now()
    WHERE id = v_tx.account_id AND household_id = p_household_id
    RETURNING version INTO v_ver;
  END IF;

  v_now := GREATEST(pg_catalog.now(), v_tx.updated_at + interval '1 millisecond');
  UPDATE public.transactions
  SET deleted_at = v_now,
      updated_at = v_now
  WHERE id = v_tx_id AND household_id = p_household_id
  RETURNING * INTO v_saved_tx;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'householdId', p_household_id,
    'membershipVersion', v_auth.r_membership_version::text,
    'status', 'deleted',
    'transaction_id', v_tx_id,
    'account_id', v_tx.account_id,
    'new_balance', v_bal,
    'new_version', v_ver,
    'updated_at', v_saved_tx.updated_at,
    'row', pg_catalog.to_jsonb(v_saved_tx)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.debtfree_upsert_household_bill_atomic(
  p_household_id text,
  p_expected_membership_version bigint,
  p_bill jsonb,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth record;
  v_id text;
  v_idem text;
  v_name text;
  v_category text;
  v_amount numeric(18, 4);
  v_due_day integer;
  v_method text;
  v_credit_acct uuid;
  v_auto_post boolean;
  v_active boolean;
  v_created_at timestamptz;
  v_next_updated_at timestamptz;
  v_existing public.recurring_bills%ROWTYPE;
  v_saved public.recurring_bills%ROWTYPE;
BEGIN
  SELECT * INTO v_auth
  FROM public.debtfree_internal_finance_authorize(
    p_household_id, p_expected_membership_version, ARRAY['owner', 'admin']
  );

  IF p_bill IS NULL OR pg_catalog.jsonb_typeof(p_bill) <> 'object' THEN
    RAISE EXCEPTION 'Recurring bill payload is required' USING ERRCODE = '22023';
  END IF;
  IF p_bill ? 'household_id'
     AND NULLIF(pg_catalog.btrim(p_bill ->> 'household_id'), '') IS NOT NULL
     AND (p_bill ->> 'household_id') IS DISTINCT FROM p_household_id THEN
    RAISE EXCEPTION 'Recurring bill household mismatch' USING ERRCODE = '42501';
  END IF;

  v_id := NULLIF(pg_catalog.btrim(COALESCE(p_bill ->> 'id', '')), '');
  IF v_id IS NULL OR pg_catalog.length(v_id) > 512 THEN
    RAISE EXCEPTION 'Recurring bill ID is required' USING ERRCODE = '23502';
  END IF;
  v_idem := NULLIF(pg_catalog.btrim(COALESCE(p_idempotency_key, '')), '');
  IF v_idem IS NOT NULL AND v_idem NOT IN (v_id, 'bill:upsert:' || v_id) THEN
    RAISE EXCEPTION 'Recurring bill idempotency key mismatch' USING ERRCODE = '23514';
  END IF;

  v_name := pg_catalog.btrim(COALESCE(p_bill ->> 'name', ''));
  v_category := pg_catalog.btrim(COALESCE(p_bill ->> 'category', ''));
  v_amount := (p_bill ->> 'amount')::numeric(18, 4);
  v_due_day := (p_bill ->> 'due_day')::integer;
  v_method := pg_catalog.btrim(COALESCE(p_bill ->> 'payment_method', ''));
  v_credit_acct := NULLIF(pg_catalog.btrim(COALESCE(p_bill ->> 'credit_account_id', '')), '')::uuid;
  v_auto_post := COALESCE((p_bill ->> 'auto_post')::boolean, true);
  v_active := COALESCE((p_bill ->> 'active')::boolean, true);
  v_created_at := COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_bill ->> 'created_at', '')), '')::timestamptz, pg_catalog.now());

  IF v_name = '' OR pg_catalog.length(v_name) > 200
     OR v_category NOT IN ('utilities', 'subscription', 'housing', 'insurance', 'other_bill')
     OR v_amount IS NULL OR v_amount <= 0
     OR v_due_day IS NULL OR NOT (v_due_day BETWEEN 1 AND 31)
     OR v_method NOT IN ('debit', 'credit')
     OR (v_method = 'debit' AND v_credit_acct IS NOT NULL)
     OR (v_method = 'credit' AND v_credit_acct IS NULL) THEN
    RAISE EXCEPTION 'Recurring bill contains invalid fields' USING ERRCODE = '23514';
  END IF;

  IF v_credit_acct IS NOT NULL THEN
    PERFORM 1
    FROM public.debts
    WHERE id = v_credit_acct AND household_id = p_household_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked credit account not found in household' USING ERRCODE = '23503';
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM public.recurring_bills
  WHERE id = v_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.household_id IS DISTINCT FROM p_household_id THEN
      RAISE EXCEPTION 'Recurring bill identity belongs to another household' USING ERRCODE = '23505';
    END IF;
    IF p_expected_updated_at IS NULL THEN
      IF v_existing.name = v_name
         AND v_existing.category = v_category
         AND v_existing.amount = v_amount
         AND v_existing.due_day = v_due_day
         AND v_existing.payment_method = v_method
         AND v_existing.credit_account_id IS NOT DISTINCT FROM v_credit_acct
         AND v_existing.auto_post = v_auto_post
         AND v_existing.active = v_active THEN
        RETURN pg_catalog.jsonb_build_object(
          'success', true,
          'householdId', p_household_id,
          'membershipVersion', v_auth.r_membership_version::text,
          'row', pg_catalog.to_jsonb(v_existing)
        );
      END IF;
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Recurring bill already exists with different fields'
        USING ERRCODE = '23505';
    END IF;
    IF v_existing.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Recurring bill changed concurrently'
        USING ERRCODE = 'P0001';
    END IF;

    v_next_updated_at := GREATEST(pg_catalog.now(), v_existing.updated_at + interval '1 millisecond');
    UPDATE public.recurring_bills
    SET name = v_name,
        category = v_category,
        amount = v_amount,
        due_day = v_due_day,
        payment_method = v_method,
        credit_account_id = v_credit_acct,
        auto_post = v_auto_post,
        active = v_active,
        updated_at = v_next_updated_at
    WHERE id = v_id AND household_id = p_household_id
    RETURNING * INTO v_saved;
  ELSE
    IF p_expected_updated_at IS NOT NULL THEN
      RAISE EXCEPTION 'Recurring bill not found or was deleted' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.debtfree_deleted_bill_ids
      WHERE household_id = p_household_id AND bill_id = v_id
    ) THEN
      RAISE EXCEPTION 'Recurring bill ID was retired and cannot be reused' USING ERRCODE = '23505';
    END IF;

    v_next_updated_at := pg_catalog.now();
    INSERT INTO public.recurring_bills (
      id, user_id, household_id, name, category, amount, due_day,
      payment_method, credit_account_id, auto_post, active, created_at, updated_at
    ) VALUES (
      v_id, v_auth.r_actor, p_household_id, v_name, v_category, v_amount, v_due_day,
      v_method, v_credit_acct, v_auto_post, v_active, v_created_at, v_next_updated_at
    )
    RETURNING * INTO v_saved;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'householdId', p_household_id,
    'membershipVersion', v_auth.r_membership_version::text,
    'row', pg_catalog.to_jsonb(v_saved)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.debtfree_delete_household_bill_atomic(
  p_household_id text,
  p_expected_membership_version bigint,
  p_bill_id text,
  p_expected_updated_at timestamptz,
  p_operation_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth record;
  v_bill_id text;
  v_op_id text;
  v_rec record;
  v_existing public.recurring_bills%ROWTYPE;
  v_receipt jsonb;
BEGIN
  SELECT * INTO v_auth
  FROM public.debtfree_internal_finance_authorize(
    p_household_id, p_expected_membership_version, ARRAY['owner', 'admin']
  );

  v_bill_id := NULLIF(pg_catalog.btrim(COALESCE(p_bill_id, '')), '');
  v_op_id := NULLIF(pg_catalog.btrim(COALESCE(p_operation_id, '')), '');
  IF v_bill_id IS NULL OR p_expected_updated_at IS NULL OR v_op_id IS NULL OR pg_catalog.length(v_op_id) > 512 THEN
    RAISE EXCEPTION 'Bill deletion requires bill ID, expected timestamp, and operation ID'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_rec
  FROM public.debtfree_household_bill_deletion_receipts
  WHERE household_id = p_household_id AND operation_id = v_op_id;
  IF FOUND THEN
    IF v_rec.bill_id = v_bill_id AND v_rec.expected_updated_at = p_expected_updated_at THEN
      RETURN pg_catalog.jsonb_set(
        v_rec.receipt,
        ARRAY['membershipVersion'],
        pg_catalog.to_jsonb(v_auth.r_membership_version::text),
        true
      );
    END IF;
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Bill deletion operation ID is bound to another bill'
      USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_existing
  FROM public.recurring_bills
  WHERE id = v_bill_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recurring bill not found or already deleted' USING ERRCODE = 'P0002';
  END IF;
  IF v_existing.household_id IS DISTINCT FROM p_household_id THEN
    RAISE EXCEPTION 'Recurring bill belongs to another household' USING ERRCODE = '42501';
  END IF;
  IF v_existing.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Recurring bill changed concurrently'
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.recurring_bills
  WHERE id = v_bill_id AND household_id = p_household_id;

  v_receipt := pg_catalog.jsonb_build_object(
    'success', true,
    'householdId', p_household_id,
    'membershipVersion', v_auth.r_membership_version::text,
    'billId', v_bill_id,
    'deleted', true
  );

  INSERT INTO public.debtfree_household_bill_deletion_receipts (
    household_id, operation_id, actor_user_id, bill_id, expected_updated_at, receipt
  ) VALUES (
    p_household_id, v_op_id, v_auth.r_actor, v_bill_id, p_expected_updated_at, v_receipt
  );

  RETURN v_receipt;
END;
$$;

-- ============================================================================
-- 8. Household Reconciliation Anchor, Reconcile & Backup Restore RPCs
-- ============================================================================
CREATE OR REPLACE FUNCTION public.debtfree_upsert_household_anchor_atomic(
  p_household_id text,
  p_expected_membership_version bigint,
  p_anchor jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth record;
  v_id text;
  v_idem text;
  v_account_id uuid;
  v_as_of_date date;
  v_verified_balance numeric(18, 4);
  v_note text;
  v_created_at timestamptz;
  v_adj_id text;
  v_existing public.reconciliation_anchors%ROWTYPE;
  v_saved public.reconciliation_anchors%ROWTYPE;
BEGIN
  SELECT * INTO v_auth
  FROM public.debtfree_internal_finance_authorize(
    p_household_id, p_expected_membership_version, ARRAY['owner', 'admin']
  );

  IF p_anchor IS NULL OR pg_catalog.jsonb_typeof(p_anchor) <> 'object' THEN
    RAISE EXCEPTION 'Reconciliation anchor payload is required' USING ERRCODE = '22023';
  END IF;
  IF p_anchor ? 'household_id'
     AND NULLIF(pg_catalog.btrim(p_anchor ->> 'household_id'), '') IS NOT NULL
     AND (p_anchor ->> 'household_id') IS DISTINCT FROM p_household_id THEN
    RAISE EXCEPTION 'Reconciliation anchor household mismatch' USING ERRCODE = '42501';
  END IF;

  v_id := NULLIF(pg_catalog.btrim(COALESCE(p_anchor ->> 'id', '')), '');
  IF v_id IS NULL OR pg_catalog.length(v_id) > 512 THEN
    RAISE EXCEPTION 'Reconciliation anchor ID is required' USING ERRCODE = '23502';
  END IF;
  v_idem := NULLIF(pg_catalog.btrim(COALESCE(p_idempotency_key, '')), '');
  IF v_idem IS NOT NULL AND v_idem NOT IN (v_id, 'anchor:upsert:' || v_id) THEN
    RAISE EXCEPTION 'Reconciliation anchor idempotency key mismatch' USING ERRCODE = '23514';
  END IF;

  v_account_id := NULLIF(pg_catalog.btrim(COALESCE(p_anchor ->> 'account_id', '')), '')::uuid;
  v_as_of_date := NULLIF(pg_catalog.btrim(COALESCE(p_anchor ->> 'as_of_date', '')), '')::date;
  v_verified_balance := (p_anchor ->> 'verified_balance')::numeric(18, 4);
  v_note := NULLIF(pg_catalog.btrim(COALESCE(p_anchor ->> 'note', '')), '');
  v_created_at := COALESCE(
    NULLIF(pg_catalog.btrim(COALESCE(p_anchor ->> 'created_at', '')), '')::timestamptz,
    pg_catalog.now()
  );
  v_adj_id := NULLIF(pg_catalog.btrim(COALESCE(p_anchor ->> 'created_adjustment_id', '')), '');

  IF v_account_id IS NULL OR v_as_of_date IS NULL OR v_verified_balance IS NULL OR v_verified_balance < 0 THEN
    RAISE EXCEPTION 'Reconciliation anchor contains invalid fields' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM public.debts WHERE id = v_account_id AND household_id = p_household_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target debt account not found in household' USING ERRCODE = '23503';
  END IF;
  IF v_adj_id IS NOT NULL THEN
    PERFORM 1 FROM public.transactions WHERE id = v_adj_id AND household_id = p_household_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Referenced adjustment transaction not found in household' USING ERRCODE = '23503';
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM public.reconciliation_anchors
  WHERE id = v_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.household_id IS DISTINCT FROM p_household_id THEN
      RAISE EXCEPTION 'Reconciliation anchor identity belongs to another household' USING ERRCODE = '23505';
    END IF;
    IF v_existing.account_id = v_account_id
       AND v_existing.as_of_date = v_as_of_date
       AND v_existing.verified_balance = v_verified_balance
       AND v_existing.note IS NOT DISTINCT FROM v_note
       AND v_existing.created_adjustment_id IS NOT DISTINCT FROM v_adj_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'householdId', p_household_id,
        'membershipVersion', v_auth.r_membership_version::text,
        'row', pg_catalog.to_jsonb(v_existing)
      );
    END IF;
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Reconciliation anchor already exists with different fields'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.reconciliation_anchors (
    id, user_id, household_id, account_id, as_of_date, verified_balance,
    note, created_at, created_adjustment_id
  ) VALUES (
    v_id, v_auth.r_actor, p_household_id, v_account_id, v_as_of_date, v_verified_balance,
    v_note, v_created_at, v_adj_id
  )
  RETURNING * INTO v_saved;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'householdId', p_household_id,
    'membershipVersion', v_auth.r_membership_version::text,
    'row', pg_catalog.to_jsonb(v_saved)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.debtfree_reconcile_household_debt_atomic(
  p_household_id text,
  p_expected_membership_version bigint,
  p_reconciliation jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth record;
  v_account_id uuid;
  v_verified_balance numeric(18, 4);
  v_as_of_date date;
  v_reason text;
  v_anchor_id text;
  v_adjustment_id text;
  v_expected_version bigint;
  v_now timestamptz := pg_catalog.now();
  v_existing_anchor public.reconciliation_anchors%ROWTYPE;
  v_saved_anchor public.reconciliation_anchors%ROWTYPE;
  v_saved_tx public.transactions%ROWTYPE;
  v_has_tx boolean := false;
  v_current_balance numeric(18, 4);
  v_current_version bigint;
  v_new_version bigint;
  v_drift numeric(18, 4);
  v_adj_category text;
  v_adj_amount numeric(18, 4);
  v_adj_payee text;
BEGIN
  SELECT * INTO v_auth
  FROM public.debtfree_internal_finance_authorize(
    p_household_id, p_expected_membership_version, ARRAY['owner', 'admin']
  );

  IF p_reconciliation IS NULL OR pg_catalog.jsonb_typeof(p_reconciliation) <> 'object' THEN
    RAISE EXCEPTION 'Reconciliation payload is required' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NOT NULL AND pg_catalog.btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Invalid idempotency key' USING ERRCODE = '22023';
  END IF;

  v_account_id := NULLIF(pg_catalog.btrim(COALESCE(p_reconciliation ->> 'account_id', '')), '')::uuid;
  v_verified_balance := (p_reconciliation ->> 'verified_balance')::numeric(18, 4);
  v_as_of_date := NULLIF(pg_catalog.btrim(COALESCE(p_reconciliation ->> 'as_of_date', '')), '')::date;
  v_reason := COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_reconciliation ->> 'reason', '')), ''), 'balance_adjustment');
  v_anchor_id := pg_catalog.btrim(COALESCE(p_reconciliation ->> 'anchor_id', ''));
  v_adjustment_id := NULLIF(pg_catalog.btrim(COALESCE(p_reconciliation ->> 'adjustment_id', '')), '');
  v_expected_version := NULLIF(pg_catalog.btrim(COALESCE(p_reconciliation ->> 'expected_version', '')), '')::bigint;

  IF v_account_id IS NULL OR v_verified_balance IS NULL OR v_as_of_date IS NULL
     OR v_anchor_id = '' OR pg_catalog.length(v_anchor_id) > 512 THEN
    RAISE EXCEPTION 'Account ID, verified balance, date, and anchor ID are required' USING ERRCODE = '23502';
  END IF;
  IF v_verified_balance < 0 THEN
    RAISE EXCEPTION 'Verified balance cannot be negative' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_existing_anchor
  FROM public.reconciliation_anchors
  WHERE id = v_anchor_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_anchor.household_id IS DISTINCT FROM p_household_id THEN
      RAISE EXCEPTION 'Reconciliation anchor identity belongs to another household' USING ERRCODE = '23505';
    END IF;
    IF v_existing_anchor.account_id IS DISTINCT FROM v_account_id
       OR v_existing_anchor.as_of_date IS DISTINCT FROM v_as_of_date
       OR v_existing_anchor.verified_balance IS DISTINCT FROM v_verified_balance THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Anchor ID % already exists with different parameters', v_anchor_id
        USING ERRCODE = '23505';
    END IF;

    IF v_existing_anchor.created_adjustment_id IS NOT NULL THEN
      SELECT * INTO v_saved_tx
      FROM public.transactions
      WHERE id = v_existing_anchor.created_adjustment_id AND household_id = p_household_id;
      v_has_tx := FOUND;
    END IF;

    SELECT balance, version INTO v_current_balance, v_current_version
    FROM public.debts
    WHERE id = v_account_id AND household_id = p_household_id;

    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'householdId', p_household_id,
      'membershipVersion', v_auth.r_membership_version::text,
      'status', 'idempotent_duplicate',
      'anchor_id', v_anchor_id,
      'account_id', v_account_id,
      'adjustment_id', v_existing_anchor.created_adjustment_id,
      'new_balance', v_current_balance,
      'new_version', v_current_version,
      'anchorRow', pg_catalog.to_jsonb(v_existing_anchor),
      'transactionRow', CASE WHEN v_has_tx THEN pg_catalog.to_jsonb(v_saved_tx) ELSE NULL END
    );
  END IF;

  SELECT balance, version
    INTO v_current_balance, v_current_version
  FROM public.debts
  WHERE id = v_account_id AND household_id = p_household_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target debt account % not found in household', v_account_id USING ERRCODE = '23503';
  END IF;

  IF v_expected_version IS NULL THEN
    RAISE EXCEPTION 'MISSING_REVISION: Expected account version is required for reconciliation'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_current_version IS DISTINCT FROM v_expected_version THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Account balance changed concurrently (expected %, actual %)',
      v_expected_version, v_current_version
      USING ERRCODE = 'P0001';
  END IF;

  v_drift := v_verified_balance - v_current_balance;
  IF v_drift <> 0 THEN
    IF v_adjustment_id IS NULL OR pg_catalog.length(v_adjustment_id) > 512 THEN
      RAISE EXCEPTION 'Adjustment transaction ID is required when verified balance differs from current balance'
        USING ERRCODE = '23502';
    END IF;
    PERFORM 1 FROM public.transactions WHERE id = v_adjustment_id;
    IF FOUND THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Adjustment transaction ID % already exists', v_adjustment_id
        USING ERRCODE = '23505';
    END IF;

    IF v_drift > 0 THEN
      v_adj_category := 'balance_adjustment';
      v_adj_amount := v_drift;
      v_adj_payee := 'Balance adjustment (+drift)';
    ELSE
      v_adj_category := 'credit_adjustment';
      v_adj_amount := ABS(v_drift);
      v_adj_payee := 'Balance adjustment (-drift)';
    END IF;

    INSERT INTO public.transactions (
      id, user_id, household_id, account_id, date, applies_to_date,
      amount, category, payee, memo, source, reconciled,
      created_at, updated_at, deleted_at
    ) VALUES (
      v_adjustment_id, v_auth.r_actor, p_household_id, v_account_id, v_as_of_date, v_as_of_date,
      v_adj_amount, v_adj_category, v_adj_payee, v_reason, 'reconciliation', true,
      v_now, v_now, NULL
    )
    RETURNING * INTO v_saved_tx;
    v_has_tx := true;
  ELSE
    v_adjustment_id := NULL;
  END IF;

  INSERT INTO public.reconciliation_anchors (
    id, user_id, household_id, account_id, as_of_date, verified_balance,
    note, created_at, created_adjustment_id
  ) VALUES (
    v_anchor_id, v_auth.r_actor, p_household_id, v_account_id, v_as_of_date, v_verified_balance,
    v_reason, v_now, v_adjustment_id
  )
  RETURNING * INTO v_saved_anchor;

  UPDATE public.debts
  SET balance = v_verified_balance,
      updated_at = v_now
  WHERE id = v_account_id AND household_id = p_household_id
  RETURNING version INTO v_new_version;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'householdId', p_household_id,
    'membershipVersion', v_auth.r_membership_version::text,
    'status', 'reconciled',
    'anchor_id', v_anchor_id,
    'account_id', v_account_id,
    'adjustment_id', v_adjustment_id,
    'drift', v_drift,
    'new_balance', v_verified_balance,
    'new_version', v_new_version,
    'anchorRow', pg_catalog.to_jsonb(v_saved_anchor),
    'transactionRow', CASE WHEN v_has_tx THEN pg_catalog.to_jsonb(v_saved_tx) ELSE NULL END
  );
END;
$$;

-- Build household-scoped snapshot using household_settings + household rows,
-- enriched with non-financial personal UI envelope keys from actor metadata.
CREATE OR REPLACE FUNCTION public.debtfree_internal_build_snapshot(
  p_actor_id uuid,
  p_household_id text,
  p_household_name text,
  p_currency text,
  OUT r_snapshot jsonb,
  OUT r_baseline_token text
)
RETURNS record
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_scale integer;
  v_factor numeric;
  v_hs_revision bigint;
  v_hs jsonb;
  v_hs_clean jsonb;
  v_profile jsonb;
  v_envelope jsonb;
  v_debts_json jsonb;
  v_bills_json jsonb;
  v_transactions_json jsonb;
  v_anchors_json jsonb;
  v_onboarding_data jsonb;
  v_state_for_token jsonb;
  v_now_iso text := pg_catalog.to_char(pg_catalog.now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_k text;
BEGIN
  v_scale := public.debtfree_internal_currency_scale(p_currency);
  v_factor := (10 ^ v_scale)::numeric;

  SELECT revision, settings INTO v_hs_revision, v_hs
  FROM public.household_settings
  WHERE household_id = p_household_id;
  IF NOT FOUND OR v_hs IS NULL OR pg_catalog.jsonb_typeof(v_hs) <> 'object' THEN
    RAISE EXCEPTION 'RESTORE_PRECONDITION_FAILED: Household settings not found' USING ERRCODE = '22023';
  END IF;

  SELECT raw_user_meta_data -> 'debtfree_native_v1' INTO v_profile
  FROM auth.users WHERE id = p_actor_id;
  IF v_profile IS NULL OR pg_catalog.jsonb_typeof(v_profile) <> 'object' THEN
    v_profile := '{}'::jsonb;
  END IF;

  -- Strip optional empty primaryIncomeName so validateNativeBackup never sees "".
  v_hs_clean := v_hs;
  IF (v_hs_clean ? 'primaryIncomeName')
     AND NULLIF(pg_catalog.btrim(COALESCE(v_hs_clean ->> 'primaryIncomeName', '')), '') IS NULL THEN
    v_hs_clean := v_hs_clean - 'primaryIncomeName';
  END IF;
  v_hs_clean := v_hs_clean || pg_catalog.jsonb_build_object(
    'householdId', p_household_id,
    'householdName', p_household_name,
    'currencyCode', p_currency
  );
  IF NOT (v_hs_clean ? 'countryCode') THEN
    v_hs_clean := v_hs_clean || '{"countryCode":"US"}'::jsonb;
  END IF;
  IF NOT (v_hs_clean ? 'primaryPayFrequency') THEN
    v_hs_clean := v_hs_clean || '{"primaryPayFrequency":"monthly"}'::jsonb;
  END IF;
  IF NOT (v_hs_clean ? 'strategy') THEN
    v_hs_clean := v_hs_clean || '{"strategy":"avalanche"}'::jsonb;
  END IF;
  IF NOT (v_hs_clean ? 'primaryMonthlyIncome') THEN
    v_hs_clean := v_hs_clean || '{"primaryMonthlyIncome":0}'::jsonb;
  END IF;
  IF NOT (v_hs_clean ? 'extraMonthlyPayment') THEN
    v_hs_clean := v_hs_clean || '{"extraMonthlyPayment":0}'::jsonb;
  END IF;
  IF NOT (v_hs_clean ? 'additionalIncomes') THEN
    v_hs_clean := v_hs_clean || '{"additionalIncomes":[]}'::jsonb;
  END IF;

  v_envelope := pg_catalog.jsonb_build_object(
    'version', 1,
    'userId', p_actor_id::text,
    'settingsRevision', v_hs_revision,
    'currentStage', CASE
      WHEN v_profile ->> 'currentStage' IN ('welcome','signup_1','signup_2','signup_3','signup_4','onboard_1','onboard_2','onboard_3','onboard_4','onboard_5','home')
      THEN v_profile ->> 'currentStage' ELSE 'home' END,
    'selectedPlan', CASE
      WHEN v_profile ->> 'selectedPlan' IN ('premium','premium_bank_sync')
      THEN v_profile ->> 'selectedPlan' ELSE 'premium' END,
    'homeStatus', CASE
      WHEN v_profile ->> 'homeStatus' IN ('Own','Rent','Other')
      THEN v_profile ->> 'homeStatus' ELSE 'Rent' END,
    'vehicleStatus', CASE
      WHEN v_profile ->> 'vehicleStatus' IN ('Finance','Lease','Own','None')
      THEN v_profile ->> 'vehicleStatus' ELSE 'None' END,
    'createdAt', COALESCE(NULLIF(v_profile ->> 'createdAt', ''), v_now_iso),
    'updatedAt', COALESCE(NULLIF(v_profile ->> 'updatedAt', ''), v_now_iso)
  );
  FOREACH v_k IN ARRAY ARRAY[
    'consideredBeforeAi', 'signupCompleted', 'onboardingCompleted',
    'managesWithPartner', 'worksWithProfessional', 'referralSource',
    'goals', 'notifications', 'completedAt'
  ] LOOP
    IF v_profile ? v_k AND v_profile -> v_k IS NOT NULL THEN
      v_envelope := v_envelope || pg_catalog.jsonb_build_object(v_k, v_profile -> v_k);
    END IF;
  END LOOP;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', d.id::text,
      'name', d.name,
      'category', d.category,
      'balance', d.balance,
      'originalBalance', d.original_balance,
      'apr', d.apr,
      'minimumPayment', d.minimum_payment,
      'dueDay', d.due_day,
      'creditLimit', d.credit_limit,
      'annualFeeAmount', d.annual_fee_amount,
      'annualFeeNextDueDate', d.annual_fee_next_due_date,
      'createdAt', pg_catalog.to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', pg_catalog.to_char(d.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'serverVersion', d.version
    ) ORDER BY d.id::text
  ), '[]'::jsonb)
  INTO v_debts_json
  FROM public.debts d
  WHERE d.household_id = p_household_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'category', b.category,
      'amount', pg_catalog.jsonb_build_object(
        'currency', p_currency,
        'minorUnits', pg_catalog.round(b.amount * v_factor)::bigint
      ),
      'dueDay', b.due_day,
      'paymentMethod', b.payment_method,
      'creditAccountId', b.credit_account_id::text,
      'autoPost', b.auto_post,
      'active', b.active,
      'createdAt', pg_catalog.to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', pg_catalog.to_char(b.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY b.id
  ), '[]'::jsonb)
  INTO v_bills_json
  FROM public.recurring_bills b
  WHERE b.household_id = p_household_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', t.id,
      'accountId', t.account_id::text,
      'date', pg_catalog.to_char(t.date, 'YYYY-MM-DD'),
      'appliesToDate', CASE WHEN t.applies_to_date IS NOT NULL THEN pg_catalog.to_char(t.applies_to_date, 'YYYY-MM-DD') ELSE NULL END,
      'amount', pg_catalog.jsonb_build_object(
        'currency', p_currency,
        'minorUnits', pg_catalog.round(t.amount * v_factor)::bigint
      ),
      'category', t.category,
      'payee', t.payee,
      'memo', t.memo,
      'source', t.source,
      'reconciled', t.reconciled,
      'createdAt', pg_catalog.to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', pg_catalog.to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deletedAt', CASE WHEN t.deleted_at IS NOT NULL THEN pg_catalog.to_char(t.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
      'isPending', false,
      'principalAmount', CASE WHEN t.principal_amount IS NOT NULL THEN pg_catalog.jsonb_build_object('currency', p_currency, 'minorUnits', pg_catalog.round(t.principal_amount * v_factor)::bigint) ELSE NULL END,
      'interestAmount', CASE WHEN t.interest_amount IS NOT NULL THEN pg_catalog.jsonb_build_object('currency', p_currency, 'minorUnits', pg_catalog.round(t.interest_amount * v_factor)::bigint) ELSE NULL END,
      'escrowAmount', CASE WHEN t.escrow_amount IS NOT NULL THEN pg_catalog.jsonb_build_object('currency', p_currency, 'minorUnits', pg_catalog.round(t.escrow_amount * v_factor)::bigint) ELSE NULL END,
      'feeAmount', CASE WHEN t.fee_amount IS NOT NULL THEN pg_catalog.jsonb_build_object('currency', p_currency, 'minorUnits', pg_catalog.round(t.fee_amount * v_factor)::bigint) ELSE NULL END
    ) ORDER BY t.id
  ), '[]'::jsonb)
  INTO v_transactions_json
  FROM public.transactions t
  WHERE t.household_id = p_household_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', a.id,
      'accountId', a.account_id::text,
      'asOfDate', pg_catalog.to_char(a.as_of_date, 'YYYY-MM-DD'),
      'verifiedBalance', pg_catalog.jsonb_build_object(
        'currency', p_currency,
        'minorUnits', pg_catalog.round(a.verified_balance * v_factor)::bigint
      ),
      'createdAt', pg_catalog.to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'note', a.note,
      'createdAdjustmentId', a.created_adjustment_id
    ) ORDER BY a.id
  ), '[]'::jsonb)
  INTO v_anchors_json
  FROM public.reconciliation_anchors a
  WHERE a.household_id = p_household_id;

  v_onboarding_data := pg_catalog.jsonb_set(v_envelope || v_hs_clean, '{debts}', v_debts_json, true);

  r_snapshot := pg_catalog.jsonb_build_object(
    'schema', 'debtfree-native-backup',
    'version', 1,
    'userId', p_actor_id::text,
    'householdId', p_household_id,
    'currency', p_currency,
    'exportedAt', v_now_iso,
    'onboardingData', v_onboarding_data,
    'transactions', v_transactions_json,
    'recurringBills', v_bills_json,
    'reconciliationAnchors', v_anchors_json
  );

  v_state_for_token := pg_catalog.jsonb_build_object(
    'householdId', p_household_id,
    'currency', p_currency,
    'settingsRevision', v_hs_revision,
    'householdSettings', v_hs_clean,
    'debts', v_debts_json,
    'recurringBills', v_bills_json,
    'transactions', v_transactions_json,
    'reconciliationAnchors', v_anchors_json
  );
  r_baseline_token := pg_catalog.md5(v_state_for_token::text);
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_internal_build_snapshot(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.debtfree_read_restore_baseline(
  p_household_id text,
  p_expected_membership_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth record;
  v_result record;
BEGIN
  SELECT * INTO v_auth
  FROM public.debtfree_internal_finance_authorize(
    p_household_id, p_expected_membership_version, ARRAY['owner']
  );

  SELECT * INTO v_result
  FROM public.debtfree_internal_build_snapshot(
    v_auth.r_actor, p_household_id, v_auth.r_household_name, v_auth.r_currency
  );

  RETURN pg_catalog.jsonb_build_object(
    'snapshot', v_result.r_snapshot,
    'baselineToken', v_result.r_baseline_token
  );
END;
$$;

-- Deliberately VOLATILE because it acquires account-guard and household share locks.
CREATE OR REPLACE FUNCTION public.debtfree_find_restore_receipt(
  p_household_id text,
  p_operation_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_lifecycle_state text;
  v_rec record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_household_id IS NULL OR p_household_id = ''
     OR p_household_id <> pg_catalog.btrim(p_household_id)
     OR pg_catalog.length(p_household_id) > 120 THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NULL OR pg_catalog.btrim(p_operation_id) = ''
     OR pg_catalog.length(p_operation_id) > 512 THEN
    RETURN NULL;
  END IF;

  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[v_uid], 'share', false);
  PERFORM public.debtfree_internal_lock_households(ARRAY[p_household_id], 'share');

  SELECT h.lifecycle_state INTO v_lifecycle_state
  FROM public.households AS h
  WHERE h.id = p_household_id;
  IF NOT FOUND OR v_lifecycle_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id
    AND hm.user_id = v_uid
    AND hm.status = 'active'
    AND hm.role = 'owner'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Household restore access denied' USING ERRCODE = '42501';
  END IF;

  SELECT operation_id, client_payload_fingerprint, restored_snapshot
    INTO v_rec
  FROM public.debtfree_restore_receipts
  WHERE household_id = p_household_id AND operation_id = p_operation_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'operationId', v_rec.operation_id,
    'payloadFingerprint', v_rec.client_payload_fingerprint,
    'restoredSnapshot', v_rec.restored_snapshot
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.debtfree_apply_snapshot_restore(
  p_household_id text,
  p_expected_membership_version bigint,
  p_operation_id text,
  p_expected_baseline_token text,
  p_payload_fingerprint text,
  p_mode text,
  p_accepted_conflict_ids text[],
  p_kept_current_conflict_ids text[],
  p_snapshot jsonb,
  p_confirm_full_replacement boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth record;
  v_rec record;
  v_current_request_identity jsonb;
  v_original_snapshot jsonb;
  v_resolved_snapshot jsonb;
  v_current_rows jsonb;
  v_import_rows jsonb;
  v_resolved_rows jsonb;
  v_resolved_onboarding jsonb;
  v_is_accepted boolean;
  v_is_kept boolean;
  v_settings_conflict boolean;
  v_scale integer;
  v_factor numeric;
  v_current_snapshot record;
  v_current_hs_revision bigint;
  v_next_hs_revision bigint;
  v_next_household_settings jsonb := '{}'::jsonb;
  v_next_household_name text;
  v_remapped_split_plans jsonb;
  v_allowed_hs_keys CONSTANT text[] := ARRAY[
    'householdId','householdName','countryCode','currencyCode','householdTimeZone',
    'primaryIncomeName','primaryIncomeAmount','primaryGrossIncomeAmount','primaryPayFrequency',
    'primaryMonthlyIncome','additionalIncomes','strategy','extraMonthlyPayment','obligationSchedules',
    'debtPaymentSplitPlansByDebtId','billPaymentSplitPlansByBillId','mortgageEscrowByDebtId',
    'mortgageExtraPaymentByDebtId','loanBillPairingByDebtId','recurringBillCategoryLabelByBillId',
    'archivedPaidOffDebtIds'
  ]::text[];

  v_elem jsonb;
  v_id text;
  v_uuid uuid;
  v_item_currency text;
  v_minor_units bigint;
  v_k text;

  v_debt_name text;
  v_debt_category text;
  v_debt_balance numeric(18, 4);
  v_debt_original numeric(18, 4);
  v_debt_apr numeric(6, 3);
  v_debt_min numeric(18, 4);
  v_debt_due integer;
  v_debt_limit numeric(18, 4);
  v_debt_annual_fee numeric(18, 4);
  v_debt_annual_fee_next_due date;
  v_debt_created timestamptz;
  v_debt_exists boolean;

  v_bill_name text;
  v_bill_cat text;
  v_bill_amount numeric(18, 4);
  v_bill_due integer;
  v_bill_method text;
  v_bill_credit_acct uuid;
  v_bill_autopost boolean;
  v_bill_active boolean;
  v_bill_created timestamptz;

  v_tx_acct uuid;
  v_tx_date date;
  v_tx_applies date;
  v_tx_amount numeric(18, 4);
  v_tx_cat text;
  v_tx_payee text;
  v_tx_memo text;
  v_tx_source text;
  v_tx_reconciled boolean;
  v_tx_created timestamptz;
  v_tx_deleted timestamptz;
  v_tx_principal numeric(18, 4);
  v_tx_interest numeric(18, 4);
  v_tx_escrow numeric(18, 4);
  v_tx_fee numeric(18, 4);

  v_anchor_acct uuid;
  v_anchor_date date;
  v_anchor_balance numeric(18, 4);
  v_anchor_note text;
  v_anchor_adj text;
  v_anchor_created timestamptz;

  v_snapshot_debt_ids text[] := ARRAY[]::text[];
  v_snapshot_tx_ids text[] := ARRAY[]::text[];
  v_seen_ids text[] := ARRAY[]::text[];
  v_conflict_key text;
  v_domain text;
  v_old jsonb;

  v_debt_id_map jsonb;
  v_bill_id_map jsonb;
  v_tx_id_map jsonb;
  v_original_tx_id_map jsonb;
  v_remapped_array jsonb;
  v_remapped_bills jsonb;
  v_final_tx_id_map jsonb := '{}'::jsonb;
  v_rekeyed_tx_id_map jsonb := '{}'::jsonb;
  v_ref record;
  v_original_tx_id text;
  v_current_tx_id text;
  v_final_tx_id text;
  v_final_snapshot record;
BEGIN
  -- 1. Authorize household owner + acquire account/household/finance locks first.
  SELECT * INTO v_auth
  FROM public.debtfree_internal_finance_authorize(
    p_household_id, p_expected_membership_version, ARRAY['owner']
  );

  -- 2. Argument sanity
  IF p_operation_id IS NULL OR pg_catalog.btrim(p_operation_id) = ''
     OR pg_catalog.length(p_operation_id) > 512 OR p_operation_id <> pg_catalog.btrim(p_operation_id) THEN
    RAISE EXCEPTION 'RESTORE_INVALID_OPERATION_ID: Operation ID is malformed or exceeds length limit'
      USING ERRCODE = '22023';
  END IF;
  IF p_payload_fingerprint IS NULL OR p_payload_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'RESTORE_INVALID_FINGERPRINT: Payload fingerprint must be a 64-character lowercase hex string'
      USING ERRCODE = '22023';
  END IF;
  IF p_expected_baseline_token IS NULL OR pg_catalog.btrim(p_expected_baseline_token) = ''
     OR pg_catalog.length(p_expected_baseline_token) > 512 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_BASELINE_TOKEN: Baseline token is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('merge', 'replace') THEN
    RAISE EXCEPTION 'RESTORE_INVALID_MODE: Mode must be merge or replace' USING ERRCODE = '22023';
  END IF;

  IF p_mode = 'replace' THEN
    IF p_confirm_full_replacement IS NOT TRUE THEN
      RAISE EXCEPTION 'RESTORE_CONFIRMATION_REQUIRED: Full replacement and omission deletion requires explicit confirmation'
        USING ERRCODE = '22023';
    END IF;
    IF COALESCE(pg_catalog.cardinality(p_accepted_conflict_ids), 0) > 0
       OR COALESCE(pg_catalog.cardinality(p_kept_current_conflict_ids), 0) > 0 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFLICTS: Replacement mode uses full confirmation, not per-conflict choices'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_confirm_full_replacement IS TRUE THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFIRMATION: Merge mode does not permit full replacement confirmation'
        USING ERRCODE = '22023';
    END IF;
    IF p_accepted_conflict_ids IS NULL OR p_kept_current_conflict_ids IS NULL THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFLICTS: Conflict choice arrays are required' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.cardinality(p_accepted_conflict_ids) <> (SELECT count(DISTINCT x) FROM pg_catalog.unnest(p_accepted_conflict_ids) AS u(x))
       OR pg_catalog.cardinality(p_kept_current_conflict_ids) <> (SELECT count(DISTINCT x) FROM pg_catalog.unnest(p_kept_current_conflict_ids) AS u(x)) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFLICTS: Conflict keys must be unique' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.unnest(p_accepted_conflict_ids || p_kept_current_conflict_ids) AS c(key)
      WHERE key !~ '^(onboardingData|debts|recurringBills|transactions|reconciliationAnchors):.+$'
         OR key <> pg_catalog.btrim(key) OR pg_catalog.length(key) > 1024
    ) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFLICTS: Conflict keys must be domain-qualified IDs' USING ERRCODE = '22023';
    END IF;
    IF p_accepted_conflict_ids && p_kept_current_conflict_ids THEN
      RAISE EXCEPTION 'RESTORE_CONFLICT_OVERLAP: A conflict key cannot be both accepted and kept'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_snapshot IS NULL OR pg_catalog.jsonb_typeof(p_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'RESTORE_INVALID_PAYLOAD: Snapshot object is required' USING ERRCODE = '22023';
  END IF;
  v_original_snapshot := p_snapshot;

  -- 3. Canonical Request Identity & Same-Op Advisory Lock
  v_current_request_identity := pg_catalog.jsonb_build_object(
    'householdId', p_household_id,
    'userId', v_auth.r_actor::text,
    'expectedBaselineToken', p_expected_baseline_token,
    'mode', p_mode,
    'acceptedConflictIds', pg_catalog.to_jsonb(COALESCE((SELECT pg_catalog.array_agg(x ORDER BY x) FROM pg_catalog.unnest(p_accepted_conflict_ids) AS x), ARRAY[]::text[])),
    'keptCurrentConflictIds', pg_catalog.to_jsonb(COALESCE((SELECT pg_catalog.array_agg(x ORDER BY x) FROM pg_catalog.unnest(p_kept_current_conflict_ids) AS x), ARRAY[]::text[])),
    'confirmFullReplacement', COALESCE(p_confirm_full_replacement, false),
    'snapshot', p_snapshot
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('debtfree.restore:' || p_household_id || ':' || p_operation_id, 0)
  );

  SELECT operation_id, client_payload_fingerprint, request_identity, restored_snapshot
    INTO v_rec
  FROM public.debtfree_restore_receipts
  WHERE household_id = p_household_id AND operation_id = p_operation_id;

  IF FOUND THEN
    IF v_rec.request_identity = v_current_request_identity
       AND v_rec.client_payload_fingerprint = p_payload_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object(
        'operationId', p_operation_id,
        'payloadFingerprint', v_rec.client_payload_fingerprint,
        'restoredSnapshot', v_rec.restored_snapshot
      );
    END IF;
    RAISE EXCEPTION 'RESTORE_OPERATION_ID_REUSED: Operation ID is already bound to a different payload'
      USING ERRCODE = '23505';
  END IF;

  -- 4. Acquire Deterministic EXCLUSIVE NOWAIT Locks (never auth.users)
  BEGIN
    LOCK TABLE public.household_settings IN EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.debts IN EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.debtfree_deleted_debt_ids IN EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.reconciliation_anchors IN EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.recurring_bills IN EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.transactions IN EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.debtfree_restore_receipts IN EXCLUSIVE MODE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RAISE EXCEPTION 'RESTORE_BUSY: Conflicting write transaction in progress; retry shortly'
        USING ERRCODE = '55P03';
  END;

  SELECT revision INTO v_current_hs_revision
  FROM public.household_settings
  WHERE household_id = p_household_id
  FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESTORE_PRECONDITION_FAILED: Household settings not found' USING ERRCODE = '22023';
  END IF;

  v_scale := public.debtfree_internal_currency_scale(v_auth.r_currency);
  v_factor := (10 ^ v_scale)::numeric;

  SELECT * INTO v_current_snapshot
  FROM public.debtfree_internal_build_snapshot(
    v_auth.r_actor, p_household_id, v_auth.r_household_name, v_auth.r_currency
  );

  IF v_current_snapshot.r_baseline_token IS DISTINCT FROM p_expected_baseline_token THEN
    RAISE EXCEPTION 'RESTORE_BASELINE_STALE: Current database state does not match expected baseline'
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Deep Snapshot Payload Validation
  IF p_snapshot ->> 'schema' IS DISTINCT FROM 'debtfree-native-backup'
     OR (p_snapshot ->> 'version')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_PAYLOAD: Unsupported backup schema or version' USING ERRCODE = '22023';
  END IF;
  IF p_snapshot ->> 'userId' IS DISTINCT FROM v_auth.r_actor::text THEN
    RAISE EXCEPTION 'RESTORE_FOREIGN_OWNER: Backup belongs to a different user' USING ERRCODE = '42501';
  END IF;
  IF p_snapshot ->> 'householdId' IS DISTINCT FROM p_household_id THEN
    RAISE EXCEPTION 'RESTORE_HOUSEHOLD_MISMATCH: Backup belongs to a different household' USING ERRCODE = '42501';
  END IF;
  IF p_snapshot ->> 'currency' IS DISTINCT FROM v_auth.r_currency THEN
    RAISE EXCEPTION 'RESTORE_CURRENCY_MISMATCH: Backup currency does not match household currency' USING ERRCODE = '22023';
  END IF;
  IF p_snapshot ->> 'exportedAt' IS NULL OR p_snapshot ->> 'exportedAt' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d' THEN
    RAISE EXCEPTION 'RESTORE_INVALID_TIMESTAMP: exportedAt timestamp is malformed' USING ERRCODE = '22023';
  END IF;

  v_elem := p_snapshot -> 'onboardingData';
  IF v_elem IS NULL OR pg_catalog.jsonb_typeof(v_elem) <> 'object'
     OR (v_elem ->> 'version')::integer IS DISTINCT FROM 1
     OR v_elem ->> 'userId' IS DISTINCT FROM v_auth.r_actor::text
     OR v_elem ->> 'householdId' IS DISTINCT FROM p_household_id THEN
    RAISE EXCEPTION 'RESTORE_INVALID_ONBOARDING: Onboarding profile is missing or invalid' USING ERRCODE = '22023';
  END IF;
  IF v_elem ->> 'currentStage' NOT IN ('welcome','signup_1','signup_2','signup_3','signup_4','onboard_1','onboard_2','onboard_3','onboard_4','onboard_5','home')
     OR v_elem ->> 'countryCode' NOT IN ('US','CA','GB','AU')
     OR v_elem ->> 'primaryPayFrequency' NOT IN ('biweekly','monthly','weekly','twice_monthly')
     OR v_elem ->> 'selectedPlan' NOT IN ('premium','premium_bank_sync')
     OR v_elem ->> 'homeStatus' NOT IN ('Own','Rent','Other')
     OR v_elem ->> 'vehicleStatus' NOT IN ('Finance','Lease','Own','None')
     OR v_elem ->> 'strategy' NOT IN ('snowball','avalanche') THEN
    RAISE EXCEPTION 'RESTORE_INVALID_ONBOARDING_FIELD: Onboarding contains invalid enumeration values' USING ERRCODE = '22023';
  END IF;
  IF v_elem ? 'archivedPaidOffDebtIds' THEN
    IF pg_catalog.jsonb_typeof(v_elem -> 'archivedPaidOffDebtIds') <> 'array'
       OR pg_catalog.jsonb_array_length(v_elem -> 'archivedPaidOffDebtIds') > 100000
       OR EXISTS (
         SELECT 1 FROM pg_catalog.jsonb_array_elements(v_elem -> 'archivedPaidOffDebtIds') AS item(value)
         WHERE pg_catalog.jsonb_typeof(item.value) <> 'string'
            OR pg_catalog.btrim(item.value #>> '{}') = ''
            OR item.value #>> '{}' <> pg_catalog.btrim(item.value #>> '{}')
            OR pg_catalog.length(item.value #>> '{}') > 512
       ) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_ONBOARDING_FIELD: archivedPaidOffDebtIds must be an array of valid debt IDs' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_snapshot -> 'onboardingData' -> 'debts' IS NULL
     OR pg_catalog.jsonb_typeof(p_snapshot -> 'onboardingData' -> 'debts') <> 'array'
     OR pg_catalog.jsonb_array_length(p_snapshot -> 'onboardingData' -> 'debts') > 100000 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_DEBTS: Missing or oversize debts domain' USING ERRCODE = '22023';
  END IF;

  v_seen_ids := ARRAY[]::text[];
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'onboardingData' -> 'debts')
  LOOP
    v_id := v_elem ->> 'id';
    IF v_id IS NULL OR v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'RESTORE_INVALID_DEBT_ID: Debt ID % is not a valid UUID', v_id USING ERRCODE = '22023';
    END IF;
    IF v_id = ANY(v_seen_ids) THEN
      RAISE EXCEPTION 'RESTORE_DUPLICATE_DEBT_ID: Duplicate debt ID % in payload', v_id USING ERRCODE = '22023';
    END IF;
    v_seen_ids := array_append(v_seen_ids, v_id);

    IF v_elem ->> 'category' NOT IN ('Mortgage','Auto loan','Credit card','Personal loan','Student loan','Medical debt','Other loan') THEN
      RAISE EXCEPTION 'RESTORE_INVALID_DEBT_CATEGORY: Debt category % is unsupported', v_elem ->> 'category' USING ERRCODE = '22023';
    END IF;
    IF (v_elem ->> 'apr')::numeric < 0 OR (v_elem ->> 'apr')::numeric > 100 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_APR: APR % out of valid range 0..100', v_elem ->> 'apr' USING ERRCODE = '22023';
    END IF;
    IF (v_elem ->> 'minimumPayment')::numeric < 0 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_MINIMUM: Negative minimum payment on debt %', v_id USING ERRCODE = '22023';
    END IF;
    IF v_elem ? 'dueDay' AND v_elem ->> 'dueDay' IS NOT NULL THEN
      IF (v_elem ->> 'dueDay')::integer < 1 OR (v_elem ->> 'dueDay')::integer > 31 THEN
        RAISE EXCEPTION 'RESTORE_INVALID_DUE_DAY: Invalid due day on debt %', v_id USING ERRCODE = '22023';
      END IF;
    END IF;
    IF (v_elem ->> 'annualFeeAmount' IS NULL) <> (v_elem ->> 'annualFeeNextDueDate' IS NULL)
       OR (v_elem ->> 'annualFeeAmount' IS NOT NULL AND (
         v_elem ->> 'category' <> 'Credit card'
         OR (v_elem ->> 'annualFeeAmount')::numeric <= 0
         OR (v_elem ->> 'annualFeeNextDueDate')::date IS NULL
       )) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_ANNUAL_FEE: Annual fee amount and renewal date must be a positive card-linked pair on debt %', v_id USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_snapshot_debt_ids := v_seen_ids;

  IF p_snapshot -> 'recurringBills' IS NULL
     OR pg_catalog.jsonb_typeof(p_snapshot -> 'recurringBills') <> 'array'
     OR pg_catalog.jsonb_array_length(p_snapshot -> 'recurringBills') > 100000 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_BILLS: Missing or oversize recurringBills domain' USING ERRCODE = '22023';
  END IF;

  v_seen_ids := ARRAY[]::text[];
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'recurringBills')
  LOOP
    v_id := v_elem ->> 'id';
    IF v_id IS NULL OR pg_catalog.btrim(v_id) = '' OR pg_catalog.length(v_id) > 512 OR v_id <> pg_catalog.btrim(v_id) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_BILL_ID: Bill ID % is malformed', v_id USING ERRCODE = '22023';
    END IF;
    IF v_id = ANY(v_seen_ids) THEN
      RAISE EXCEPTION 'RESTORE_DUPLICATE_BILL_ID: Duplicate bill ID % in payload', v_id USING ERRCODE = '22023';
    END IF;
    v_seen_ids := array_append(v_seen_ids, v_id);

    IF v_elem ->> 'category' NOT IN ('utilities','subscription','housing','insurance','other_bill') THEN
      RAISE EXCEPTION 'RESTORE_INVALID_BILL_CATEGORY: Recurring bill category % is unsupported', v_elem ->> 'category' USING ERRCODE = '22023';
    END IF;
    IF v_elem ->> 'paymentMethod' NOT IN ('debit','credit') THEN
      RAISE EXCEPTION 'RESTORE_INVALID_BILL_METHOD: Payment method must be debit or credit' USING ERRCODE = '22023';
    END IF;
    v_minor_units := (v_elem -> 'amount' ->> 'minorUnits')::bigint;
    IF v_minor_units IS NULL OR v_minor_units <= 0 OR pg_catalog.abs(v_minor_units) > 9007199254740991 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_BILL_AMOUNT: Recurring bill % amount must be positive safe integer', v_id USING ERRCODE = '22023';
    END IF;
    IF v_elem -> 'amount' ->> 'currency' IS DISTINCT FROM v_auth.r_currency THEN
      RAISE EXCEPTION 'RESTORE_CURRENCY_MISMATCH: Bill % currency differs from %', v_id, v_auth.r_currency USING ERRCODE = '22023';
    END IF;
    IF (v_elem ->> 'dueDay')::integer < 1 OR (v_elem ->> 'dueDay')::integer > 31 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_BILL_DUEDAY: Bill % dueDay must be between 1 and 31', v_id USING ERRCODE = '22023';
    END IF;
    IF v_elem ->> 'paymentMethod' = 'credit' THEN
      v_id := v_elem ->> 'creditAccountId';
      IF v_id IS NULL OR NOT (v_id = ANY(v_snapshot_debt_ids)) THEN
        RAISE EXCEPTION 'RESTORE_ORPHAN_BILL_ACCOUNT: Credit bill references unknown debt account %', v_id USING ERRCODE = '23503';
      END IF;
    ELSE
      IF v_elem ->> 'creditAccountId' IS NOT NULL THEN
        RAISE EXCEPTION 'RESTORE_INVALID_DEBIT_BILL: Debit bill must not reference credit account' USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  IF p_snapshot -> 'transactions' IS NULL
     OR pg_catalog.jsonb_typeof(p_snapshot -> 'transactions') <> 'array'
     OR pg_catalog.jsonb_array_length(p_snapshot -> 'transactions') > 100000 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_TRANSACTIONS: Missing or oversize transactions domain' USING ERRCODE = '22023';
  END IF;

  v_seen_ids := ARRAY[]::text[];
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'transactions')
  LOOP
    v_id := v_elem ->> 'id';
    IF v_id IS NULL OR pg_catalog.btrim(v_id) = '' OR pg_catalog.length(v_id) > 512 OR v_id <> pg_catalog.btrim(v_id) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_TX_ID: Transaction ID % is malformed', v_id USING ERRCODE = '22023';
    END IF;
    IF v_id = ANY(v_seen_ids) THEN
      RAISE EXCEPTION 'RESTORE_DUPLICATE_TX_ID: Duplicate transaction ID % in payload', v_id USING ERRCODE = '22023';
    END IF;
    v_seen_ids := array_append(v_seen_ids, v_id);

    IF v_elem ->> 'accountId' IS NOT NULL AND NOT ((v_elem ->> 'accountId') = ANY(v_snapshot_debt_ids)) THEN
      RAISE EXCEPTION 'RESTORE_ORPHAN_TX_ACCOUNT: Transaction % references unknown debt account %', v_id, v_elem ->> 'accountId' USING ERRCODE = '23503';
    END IF;
    IF v_elem ->> 'category' NOT IN (
      'purchase','subscription','utilities','interest','fee','annual_fee',
      'interest_adjustment','balance_adjustment','payment','refund','credit_adjustment',
      'debit_bill','debit_spending'
    ) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_TX_CATEGORY: Transaction category % is invalid', v_elem ->> 'category' USING ERRCODE = '22023';
    END IF;
    v_minor_units := (v_elem -> 'amount' ->> 'minorUnits')::bigint;
    IF v_minor_units IS NULL OR v_minor_units < 0 OR pg_catalog.abs(v_minor_units) > 9007199254740991 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_TX_AMOUNT: Transaction % amount must be non-negative safe integer', v_id USING ERRCODE = '22023';
    END IF;
    IF v_elem -> 'amount' ->> 'currency' IS DISTINCT FROM v_auth.r_currency THEN
      RAISE EXCEPTION 'RESTORE_CURRENCY_MISMATCH: Transaction % currency differs from %', v_id, v_auth.r_currency USING ERRCODE = '22023';
    END IF;
    FOR v_item_currency IN SELECT * FROM pg_catalog.unnest(ARRAY['principalAmount','interestAmount','escrowAmount','feeAmount'])
    LOOP
      IF v_elem ? v_item_currency AND v_elem -> v_item_currency IS NOT NULL
         AND pg_catalog.jsonb_typeof(v_elem -> v_item_currency) = 'object' THEN
        v_minor_units := (v_elem -> v_item_currency ->> 'minorUnits')::bigint;
        IF v_minor_units IS NULL OR v_minor_units < 0 OR pg_catalog.abs(v_minor_units) > 9007199254740991 THEN
          RAISE EXCEPTION 'RESTORE_INVALID_ALLOCATION: Allocation % on transaction % must be non-negative safe integer', v_item_currency, v_id USING ERRCODE = '22023';
        END IF;
        IF v_elem -> v_item_currency ->> 'currency' IS DISTINCT FROM v_auth.r_currency THEN
          RAISE EXCEPTION 'RESTORE_CURRENCY_MISMATCH: Allocation currency on transaction % differs from %', v_id, v_auth.r_currency USING ERRCODE = '22023';
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  v_snapshot_tx_ids := v_seen_ids;

  IF p_snapshot -> 'reconciliationAnchors' IS NULL
     OR pg_catalog.jsonb_typeof(p_snapshot -> 'reconciliationAnchors') <> 'array'
     OR pg_catalog.jsonb_array_length(p_snapshot -> 'reconciliationAnchors') > 100000 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_ANCHORS: Missing or oversize reconciliationAnchors domain' USING ERRCODE = '22023';
  END IF;

  v_seen_ids := ARRAY[]::text[];
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'reconciliationAnchors')
  LOOP
    v_id := v_elem ->> 'id';
    IF v_id IS NULL OR pg_catalog.btrim(v_id) = '' OR pg_catalog.length(v_id) > 512 OR v_id <> pg_catalog.btrim(v_id) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_ANCHOR_ID: Anchor ID % is malformed', v_id USING ERRCODE = '22023';
    END IF;
    IF v_id = ANY(v_seen_ids) THEN
      RAISE EXCEPTION 'RESTORE_DUPLICATE_ANCHOR_ID: Duplicate anchor ID % in payload', v_id USING ERRCODE = '22023';
    END IF;
    v_seen_ids := array_append(v_seen_ids, v_id);

    IF NOT ((v_elem ->> 'accountId') = ANY(v_snapshot_debt_ids)) THEN
      RAISE EXCEPTION 'RESTORE_ORPHAN_ANCHOR_ACCOUNT: Anchor % references unknown debt account %', v_id, v_elem ->> 'accountId' USING ERRCODE = '23503';
    END IF;
    v_minor_units := (v_elem -> 'verifiedBalance' ->> 'minorUnits')::bigint;
    IF v_minor_units IS NULL OR pg_catalog.abs(v_minor_units) > 9007199254740991 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_ANCHOR_BALANCE: Anchor % verifiedBalance must be safe integer', v_id USING ERRCODE = '22023';
    END IF;
    IF v_elem -> 'verifiedBalance' ->> 'currency' IS DISTINCT FROM v_auth.r_currency THEN
      RAISE EXCEPTION 'RESTORE_CURRENCY_MISMATCH: Anchor % currency differs from %', v_id, v_auth.r_currency USING ERRCODE = '22023';
    END IF;
    IF v_elem ? 'createdAdjustmentId' AND v_elem ->> 'createdAdjustmentId' IS NOT NULL THEN
      v_id := v_elem ->> 'createdAdjustmentId';
      IF NOT (v_id = ANY(v_snapshot_tx_ids)) THEN
        RAISE EXCEPTION 'RESTORE_ORPHAN_ANCHOR_ADJUSTMENT: Anchor references nonexistent adjustment transaction %', v_id USING ERRCODE = '23503';
      END IF;
    END IF;
    IF v_elem ? 'coveredTransactionIds' AND v_elem -> 'coveredTransactionIds' IS NOT NULL THEN
      IF pg_catalog.jsonb_array_length(v_elem -> 'coveredTransactionIds') > 0 THEN
        RAISE EXCEPTION 'RESTORE_UNSUPPORTED_COVERAGE: Non-empty coveredTransactionIds is unsupported in restore v1'
          USING ERRCODE = '0A000';
      END IF;
    END IF;
  END LOOP;

  -- Merge conflict resolution on untouched import + locked server baseline
  IF p_mode = 'merge' THEN
    v_resolved_snapshot := v_current_snapshot.r_snapshot;
    v_conflict_key := 'onboardingData:' || v_auth.r_actor::text;
    v_old := (v_original_snapshot -> 'onboardingData') - 'debts'::text;
    v_elem := (v_current_snapshot.r_snapshot -> 'onboardingData') - 'debts'::text;
    v_settings_conflict := v_old IS DISTINCT FROM v_elem;
    v_is_accepted := v_conflict_key = ANY(p_accepted_conflict_ids);
    v_is_kept := v_conflict_key = ANY(p_kept_current_conflict_ids);
    IF v_settings_conflict THEN
      IF v_is_accepted = v_is_kept THEN
        RAISE EXCEPTION 'RESTORE_CONFLICT_CHOICE_REQUIRED: %', v_conflict_key USING ERRCODE = '22023';
      END IF;
      v_resolved_onboarding := CASE WHEN v_is_accepted
        THEN v_original_snapshot -> 'onboardingData'
        ELSE v_current_snapshot.r_snapshot -> 'onboardingData' END;
    ELSE
      IF v_is_accepted OR v_is_kept THEN
        RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Settings key is not a changed conflict' USING ERRCODE = '22023';
      END IF;
      v_resolved_onboarding := v_current_snapshot.r_snapshot -> 'onboardingData';
    END IF;
    v_resolved_onboarding := pg_catalog.jsonb_set(
      v_resolved_onboarding,
      ARRAY['debts'],
      v_current_snapshot.r_snapshot -> 'onboardingData' -> 'debts',
      false
    );
    v_resolved_snapshot := pg_catalog.jsonb_set(v_resolved_snapshot, ARRAY['onboardingData'], v_resolved_onboarding, false);

    FOREACH v_domain IN ARRAY ARRAY['debts','recurringBills','transactions','reconciliationAnchors'] LOOP
      IF v_domain = 'debts' THEN
        v_current_rows := v_current_snapshot.r_snapshot -> 'onboardingData' -> 'debts';
        v_import_rows := v_original_snapshot -> 'onboardingData' -> 'debts';
      ELSE
        v_current_rows := v_current_snapshot.r_snapshot -> v_domain;
        v_import_rows := v_original_snapshot -> v_domain;
      END IF;
      v_conflict_key := NULL;
      WITH baseline_rows AS MATERIALIZED (
        SELECT source_item.value, source_item.ordinality FROM pg_catalog.jsonb_array_elements(v_current_rows)
          WITH ORDINALITY AS source_item(value, ordinality)
      ), imported_rows AS MATERIALIZED (
        SELECT source_item.value, source_item.ordinality FROM pg_catalog.jsonb_array_elements(v_import_rows)
          WITH ORDINALITY AS source_item(value, ordinality)
      ), choice_errors AS (
        SELECT v_domain || ':' || (baseline.value ->> 'id') AS conflict_key,
               imported.value IS NOT NULL AND imported.value IS DISTINCT FROM baseline.value AS is_conflict
        FROM baseline_rows AS baseline
        LEFT JOIN imported_rows AS imported ON imported.value ->> 'id' = baseline.value ->> 'id'
      )
      SELECT conflict_key INTO v_conflict_key
      FROM choice_errors
      WHERE (is_conflict AND
             ((conflict_key = ANY(p_accepted_conflict_ids)) = (conflict_key = ANY(p_kept_current_conflict_ids))))
         OR (NOT is_conflict AND
             (conflict_key = ANY(p_accepted_conflict_ids) OR conflict_key = ANY(p_kept_current_conflict_ids)))
      LIMIT 1;
      IF v_conflict_key IS NOT NULL THEN
        IF v_conflict_key = ANY(p_accepted_conflict_ids) OR v_conflict_key = ANY(p_kept_current_conflict_ids) THEN
          RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Key is not a changed conflict: %', v_conflict_key USING ERRCODE = '22023';
        END IF;
        RAISE EXCEPTION 'RESTORE_CONFLICT_CHOICE_REQUIRED: %', v_conflict_key USING ERRCODE = '22023';
      END IF;

      v_conflict_key := NULL;
      WITH baseline_rows AS MATERIALIZED (
        SELECT source_item.value FROM pg_catalog.jsonb_array_elements(v_current_rows) AS source_item(value)
      ), imported_rows AS MATERIALIZED (
        SELECT source_item.value, source_item.ordinality FROM pg_catalog.jsonb_array_elements(v_import_rows)
          WITH ORDINALITY AS source_item(value, ordinality)
      )
      SELECT v_domain || ':' || (imported.value ->> 'id') INTO v_conflict_key
      FROM imported_rows AS imported
      WHERE NOT EXISTS (SELECT 1 FROM baseline_rows AS baseline WHERE baseline.value ->> 'id' = imported.value ->> 'id')
        AND ((v_domain || ':' || (imported.value ->> 'id')) = ANY(p_accepted_conflict_ids)
             OR (v_domain || ':' || (imported.value ->> 'id')) = ANY(p_kept_current_conflict_ids))
      ORDER BY imported.ordinality
      LIMIT 1;
      IF v_conflict_key IS NOT NULL THEN
        RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Key is not a changed conflict: %', v_conflict_key USING ERRCODE = '22023';
      END IF;

      WITH baseline_rows AS MATERIALIZED (
        SELECT source_item.value, source_item.ordinality FROM pg_catalog.jsonb_array_elements(v_current_rows)
          WITH ORDINALITY AS source_item(value, ordinality)
      ), imported_rows AS MATERIALIZED (
        SELECT source_item.value, source_item.ordinality FROM pg_catalog.jsonb_array_elements(v_import_rows)
          WITH ORDINALITY AS source_item(value, ordinality)
      ), resolved_rows AS (
        SELECT CASE WHEN imported.value IS NOT NULL
                         AND imported.value IS DISTINCT FROM baseline.value
                         AND (v_domain || ':' || (baseline.value ->> 'id')) = ANY(p_accepted_conflict_ids)
                    THEN imported.value ELSE baseline.value END AS value,
               0 AS source_order,
               baseline.ordinality AS row_order
        FROM baseline_rows AS baseline
        LEFT JOIN imported_rows AS imported ON imported.value ->> 'id' = baseline.value ->> 'id'
        UNION ALL
        SELECT imported.value, 1 AS source_order, imported.ordinality AS row_order
        FROM imported_rows AS imported
        WHERE NOT EXISTS (SELECT 1 FROM baseline_rows AS baseline WHERE baseline.value ->> 'id' = imported.value ->> 'id')
      )
      SELECT COALESCE(pg_catalog.jsonb_agg(value ORDER BY source_order, row_order), '[]'::jsonb)
      INTO v_resolved_rows
      FROM resolved_rows;

      IF v_domain = 'debts' THEN
        v_resolved_snapshot := pg_catalog.jsonb_set(v_resolved_snapshot, ARRAY['onboardingData','debts'], v_resolved_rows, false);
      ELSE
        v_resolved_snapshot := pg_catalog.jsonb_set(v_resolved_snapshot, ARRAY[v_domain], v_resolved_rows, false);
      END IF;
    END LOOP;

    WITH baseline_rows AS MATERIALIZED (
      SELECT 'debts'::text AS domain, source_item.value FROM pg_catalog.jsonb_array_elements(v_current_snapshot.r_snapshot -> 'onboardingData' -> 'debts') AS source_item(value)
      UNION ALL SELECT 'recurringBills', source_item.value FROM pg_catalog.jsonb_array_elements(v_current_snapshot.r_snapshot -> 'recurringBills') AS source_item(value)
      UNION ALL SELECT 'transactions', source_item.value FROM pg_catalog.jsonb_array_elements(v_current_snapshot.r_snapshot -> 'transactions') AS source_item(value)
      UNION ALL SELECT 'reconciliationAnchors', source_item.value FROM pg_catalog.jsonb_array_elements(v_current_snapshot.r_snapshot -> 'reconciliationAnchors') AS source_item(value)
    ), imported_rows AS MATERIALIZED (
      SELECT 'debts'::text AS domain, source_item.value FROM pg_catalog.jsonb_array_elements(v_original_snapshot -> 'onboardingData' -> 'debts') AS source_item(value)
      UNION ALL SELECT 'recurringBills', source_item.value FROM pg_catalog.jsonb_array_elements(v_original_snapshot -> 'recurringBills') AS source_item(value)
      UNION ALL SELECT 'transactions', source_item.value FROM pg_catalog.jsonb_array_elements(v_original_snapshot -> 'transactions') AS source_item(value)
      UNION ALL SELECT 'reconciliationAnchors', source_item.value FROM pg_catalog.jsonb_array_elements(v_original_snapshot -> 'reconciliationAnchors') AS source_item(value)
    ), valid_conflicts AS (
      SELECT baseline.domain || ':' || (baseline.value ->> 'id') AS conflict_key
      FROM baseline_rows AS baseline
      JOIN imported_rows AS imported
        ON imported.domain = baseline.domain AND imported.value ->> 'id' = baseline.value ->> 'id'
      WHERE imported.value IS DISTINCT FROM baseline.value
      UNION ALL
      SELECT 'onboardingData:' || v_auth.r_actor::text WHERE v_settings_conflict
    ), choices AS (
      SELECT choice.key FROM pg_catalog.unnest(p_accepted_conflict_ids || p_kept_current_conflict_ids) AS choice(key)
    )
    SELECT choice.key INTO v_conflict_key
    FROM choices AS choice
    WHERE NOT EXISTS (SELECT 1 FROM valid_conflicts AS valid WHERE valid.conflict_key = choice.key)
    LIMIT 1;
    IF v_conflict_key IS NOT NULL THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Key is not a changed import/baseline conflict: %', v_conflict_key USING ERRCODE = '22023';
    END IF;
    p_snapshot := v_resolved_snapshot;
  END IF;

  -- Household-scoped debt tombstone check
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'onboardingData' -> 'debts') AS item(value)
    JOIN public.debtfree_deleted_debt_ids AS tombstone
      ON tombstone.id = (item.value ->> 'id')::uuid
    WHERE tombstone.household_id = p_household_id
  ) THEN
    RAISE EXCEPTION 'RESTORE_TOMBSTONED_DEBT_ID: A deleted debt identity cannot be restored'
      USING ERRCODE = '23505';
  END IF;

  -- Rekey imported identities not owned by this household
  WITH incoming AS MATERIALIZED (
    SELECT item.value, item.ordinality, item.value ->> 'id' AS old_id,
           CASE WHEN EXISTS (
             SELECT 1 FROM public.debts AS owned
             WHERE owned.id = (item.value ->> 'id')::uuid AND owned.household_id = p_household_id
           ) THEN item.value ->> 'id' ELSE pg_catalog.gen_random_uuid()::text END AS new_id
    FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'onboardingData' -> 'debts')
      WITH ORDINALITY AS item(value, ordinality)
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_set(value, ARRAY['id'], pg_catalog.to_jsonb(new_id), false)
           ORDER BY ordinality), '[]'::jsonb),
         COALESCE(pg_catalog.jsonb_object_agg(old_id, new_id), '{}'::jsonb),
         COALESCE(pg_catalog.array_agg(new_id ORDER BY ordinality), ARRAY[]::text[])
  INTO v_remapped_array, v_debt_id_map, v_snapshot_debt_ids
  FROM incoming;
  p_snapshot := pg_catalog.jsonb_set(p_snapshot, ARRAY['onboardingData','debts'], v_remapped_array, false);

  WITH incoming AS MATERIALIZED (
    SELECT item.value, item.ordinality, item.value ->> 'id' AS old_id,
           CASE
             WHEN EXISTS (
               SELECT 1 FROM public.debtfree_deleted_bill_ids AS retired
               WHERE retired.household_id = p_household_id AND retired.bill_id = item.value ->> 'id'
             ) THEN pg_catalog.gen_random_uuid()::text
             WHEN EXISTS (
               SELECT 1 FROM public.recurring_bills AS owned
               WHERE owned.id = (item.value ->> 'id') AND owned.household_id = p_household_id
             ) THEN item.value ->> 'id'
             ELSE pg_catalog.gen_random_uuid()::text
           END AS new_id
    FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'recurringBills')
      WITH ORDINALITY AS item(value, ordinality)
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(
           CASE WHEN value ->> 'creditAccountId' IS NULL THEN
             pg_catalog.jsonb_set(value, ARRAY['id'], pg_catalog.to_jsonb(new_id), false)
           ELSE
             pg_catalog.jsonb_set(
               pg_catalog.jsonb_set(value, ARRAY['id'], pg_catalog.to_jsonb(new_id), false),
               ARRAY['creditAccountId'],
               pg_catalog.to_jsonb(v_debt_id_map ->> (value ->> 'creditAccountId')),
               false
             )
           END
           ORDER BY ordinality), '[]'::jsonb),
         COALESCE(pg_catalog.jsonb_object_agg(old_id, new_id), '{}'::jsonb)
  INTO v_remapped_bills, v_bill_id_map
  FROM incoming;

  WITH incoming AS MATERIALIZED (
    SELECT item.value, item.ordinality, item.value ->> 'id' AS old_id,
           CASE
             WHEN item.value ->> 'category' = 'annual_fee'
               AND item.value ->> 'accountId' IS NOT NULL
               AND item.value ->> 'appliesToDate' IS NOT NULL
               AND item.value ->> 'id' = 'annual-fee:' || (item.value ->> 'accountId') || ':' || (item.value ->> 'appliesToDate')
             THEN 'annual-fee:' || (v_debt_id_map ->> (item.value ->> 'accountId')) || ':' || (item.value ->> 'appliesToDate')
             WHEN EXISTS (
               SELECT 1 FROM public.transactions AS owned
               WHERE owned.id = (item.value ->> 'id') AND owned.household_id = p_household_id
             ) THEN item.value ->> 'id'
             ELSE pg_catalog.gen_random_uuid()::text
           END AS new_id
    FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'transactions')
      WITH ORDINALITY AS item(value, ordinality)
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(
           CASE WHEN value ->> 'accountId' IS NULL THEN
             pg_catalog.jsonb_set(value, ARRAY['id'], pg_catalog.to_jsonb(new_id), false)
           ELSE
             pg_catalog.jsonb_set(
               pg_catalog.jsonb_set(value, ARRAY['id'], pg_catalog.to_jsonb(new_id), false),
               ARRAY['accountId'],
               pg_catalog.to_jsonb(v_debt_id_map ->> (value ->> 'accountId')),
               false
             )
           END
           ORDER BY ordinality), '[]'::jsonb),
         COALESCE(pg_catalog.jsonb_object_agg(old_id, new_id), '{}'::jsonb),
         COALESCE(pg_catalog.array_agg(new_id ORDER BY ordinality), ARRAY[]::text[])
  INTO v_remapped_array, v_tx_id_map, v_snapshot_tx_ids
  FROM incoming;
  p_snapshot := pg_catalog.jsonb_set(p_snapshot, ARRAY['transactions'], v_remapped_array, false);

  WITH incoming AS MATERIALIZED (
    SELECT item.value, item.ordinality,
           CASE WHEN EXISTS (
             SELECT 1 FROM public.reconciliation_anchors AS owned
             WHERE owned.id = (item.value ->> 'id') AND owned.household_id = p_household_id
           ) THEN item.value ->> 'id' ELSE pg_catalog.gen_random_uuid()::text END AS new_id
    FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'reconciliationAnchors')
      WITH ORDINALITY AS item(value, ordinality)
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(
           CASE WHEN value ->> 'createdAdjustmentId' IS NULL THEN
             pg_catalog.jsonb_set(
               pg_catalog.jsonb_set(value, ARRAY['id'], pg_catalog.to_jsonb(new_id), false),
               ARRAY['accountId'],
               pg_catalog.to_jsonb(v_debt_id_map ->> (value ->> 'accountId')),
               false
             )
           ELSE
             pg_catalog.jsonb_set(
               pg_catalog.jsonb_set(
                 pg_catalog.jsonb_set(value, ARRAY['id'], pg_catalog.to_jsonb(new_id), false),
                 ARRAY['accountId'],
                 pg_catalog.to_jsonb(v_debt_id_map ->> (value ->> 'accountId')),
                 false
               ),
               ARRAY['createdAdjustmentId'],
               pg_catalog.to_jsonb(v_tx_id_map ->> (value ->> 'createdAdjustmentId')),
               false
             )
           END
           ORDER BY ordinality), '[]'::jsonb)
  INTO v_remapped_array
  FROM incoming;
  p_snapshot := pg_catalog.jsonb_set(p_snapshot, ARRAY['reconciliationAnchors'], v_remapped_array, false);

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'transactions') AS tx(value)
    CROSS JOIN LATERAL pg_catalog.unnest(
      public.debtfree_bill_ids_for_transaction(tx.value ->> 'id', tx.value ->> 'memo')
    ) AS marker(bill_id)
    JOIN public.debtfree_deleted_bill_ids AS retired
      ON retired.household_id = p_household_id AND retired.bill_id = marker.bill_id
    WHERE NOT (v_bill_id_map ? marker.bill_id)
  ) THEN
    RAISE EXCEPTION 'RESTORE_RETIRED_BILL_REFERENCE: A retired bill reference has no imported bill identity'
      USING ERRCODE = '23505';
  END IF;

  p_snapshot := pg_catalog.jsonb_set(p_snapshot, ARRAY['recurringBills'], v_remapped_bills, false);
  v_original_tx_id_map := v_tx_id_map;

  FOR v_ref IN
    SELECT item.value ->> 'id' AS original_id
    FROM pg_catalog.jsonb_array_elements(v_current_request_identity -> 'snapshot' -> 'transactions') AS item(value)
  LOOP
    v_original_tx_id := v_ref.original_id;
    v_current_tx_id := v_tx_id_map ->> v_original_tx_id;
    v_final_tx_id := public.debtfree_rewrite_bill_transaction_id(v_original_tx_id, v_bill_id_map);
    IF v_final_tx_id = v_original_tx_id THEN
      v_final_tx_id := v_current_tx_id;
    END IF;
    v_final_tx_id_map := v_final_tx_id_map || pg_catalog.jsonb_build_object(v_original_tx_id, v_final_tx_id);
    v_tx_id_map := v_tx_id_map || pg_catalog.jsonb_build_object(v_original_tx_id, v_final_tx_id);
    IF v_current_tx_id IS DISTINCT FROM v_final_tx_id THEN
      v_rekeyed_tx_id_map := v_rekeyed_tx_id_map || pg_catalog.jsonb_build_object(v_current_tx_id, v_final_tx_id);
    END IF;
  END LOOP;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(item.value, ARRAY['id'],
        pg_catalog.to_jsonb(COALESCE(v_rekeyed_tx_id_map ->> (item.value ->> 'id'), item.value ->> 'id')), false),
      ARRAY['memo'],
      CASE WHEN item.value -> 'memo' IS NULL OR item.value -> 'memo' = 'null'::jsonb THEN item.value -> 'memo'
           ELSE pg_catalog.to_jsonb(public.debtfree_rewrite_bill_memo(item.value ->> 'memo', v_bill_id_map)) END,
      true
    ) ORDER BY item.ordinality
  ), '[]'::jsonb)
  INTO v_remapped_array
  FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'transactions') WITH ORDINALITY AS item(value, ordinality);
  p_snapshot := pg_catalog.jsonb_set(p_snapshot, ARRAY['transactions'], v_remapped_array, false);

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_each_text(v_rekeyed_tx_id_map) AS remap(old_id, new_id)
    JOIN public.transactions AS occupied
      ON occupied.id = remap.new_id AND occupied.id <> remap.old_id
  ) THEN
    RAISE EXCEPTION 'RESTORE_BILL_REKEY_COLLISION: A transaction identity target is already occupied'
      USING ERRCODE = '23505';
  END IF;

  PERFORM pg_catalog.set_config('debtfree.restore_importing', 'on', true);
  UPDATE public.transactions AS current_tx
  SET id = remap.new_id,
      memo = public.debtfree_rewrite_bill_memo(current_tx.memo, v_bill_id_map)
  FROM pg_catalog.jsonb_each_text(v_original_tx_id_map) AS selected(original_id, current_id)
  JOIN pg_catalog.jsonb_each_text(v_rekeyed_tx_id_map) AS remap(old_id, new_id)
    ON remap.old_id = selected.current_id
  WHERE current_tx.household_id = p_household_id
    AND current_tx.id = selected.current_id
    AND (current_tx.id IS DISTINCT FROM remap.new_id
         OR current_tx.memo IS DISTINCT FROM public.debtfree_rewrite_bill_memo(current_tx.memo, v_bill_id_map));
  PERFORM pg_catalog.set_config('debtfree.restore_importing', 'off', true);

  UPDATE public.reconciliation_anchors AS anchor
  SET created_adjustment_id = remap.new_id
  FROM pg_catalog.jsonb_each_text(v_rekeyed_tx_id_map) AS remap(old_id, new_id)
  WHERE anchor.household_id = p_household_id AND anchor.created_adjustment_id = remap.old_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    CASE WHEN item.value ->> 'createdAdjustmentId' IS NULL THEN item.value
         ELSE pg_catalog.jsonb_set(item.value, ARRAY['createdAdjustmentId'],
           pg_catalog.to_jsonb(COALESCE(v_rekeyed_tx_id_map ->> (item.value ->> 'createdAdjustmentId'),
                                      item.value ->> 'createdAdjustmentId')), false)
    END ORDER BY item.ordinality
  ), '[]'::jsonb)
  INTO v_remapped_array
  FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'reconciliationAnchors') WITH ORDINALITY AS item(value, ordinality);
  p_snapshot := pg_catalog.jsonb_set(p_snapshot, ARRAY['reconciliationAnchors'], v_remapped_array, false);

  -- 6. Atomic Household Finance Mutations
  IF p_mode = 'merge' THEN
    DELETE FROM public.recurring_bills AS current_bill
    USING pg_catalog.jsonb_each_text(v_bill_id_map) AS remap(old_id, new_id)
    WHERE current_bill.household_id = p_household_id
      AND current_bill.id = remap.old_id
      AND remap.old_id IS DISTINCT FROM remap.new_id
      AND EXISTS (
        SELECT 1 FROM public.debtfree_deleted_bill_ids AS retired
        WHERE retired.household_id = p_household_id AND retired.bill_id = remap.old_id
      );
  END IF;

  IF p_mode = 'replace' THEN
    DELETE FROM public.transactions AS t
    WHERE t.household_id = p_household_id
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'transactions') elem
        WHERE elem ->> 'id' = t.id
      );
    DELETE FROM public.reconciliation_anchors AS a
    WHERE a.household_id = p_household_id
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'reconciliationAnchors') elem
        WHERE elem ->> 'id' = a.id
      );
    DELETE FROM public.recurring_bills AS b
    WHERE b.household_id = p_household_id
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'recurringBills') elem
        WHERE elem ->> 'id' = b.id
      );
    DELETE FROM public.debts AS d
    WHERE d.household_id = p_household_id
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'onboardingData' -> 'debts') elem
        WHERE (elem ->> 'id')::uuid = d.id
      );
  END IF;

  -- Filter restored settings strictly to the 21 shared household keys (never write auth.users)
  v_elem := p_snapshot -> 'onboardingData';
  FOREACH v_k IN ARRAY v_allowed_hs_keys LOOP
    IF v_elem ? v_k AND v_elem -> v_k IS NOT NULL THEN
      v_next_household_settings := v_next_household_settings || pg_catalog.jsonb_build_object(v_k, v_elem -> v_k);
    END IF;
  END LOOP;
  IF (v_next_household_settings ? 'primaryIncomeName')
     AND NULLIF(pg_catalog.btrim(COALESCE(v_next_household_settings ->> 'primaryIncomeName', '')), '') IS NULL THEN
    v_next_household_settings := v_next_household_settings - 'primaryIncomeName';
  END IF;

  v_next_household_name := COALESCE(
    NULLIF(pg_catalog.btrim(COALESCE(v_next_household_settings ->> 'householdName', '')), ''),
    v_auth.r_household_name
  );
  v_next_household_settings := v_next_household_settings || pg_catalog.jsonb_build_object(
    'householdId', p_household_id,
    'householdName', v_next_household_name,
    'currencyCode', v_auth.r_currency
  );

  IF pg_catalog.jsonb_typeof(v_next_household_settings -> 'debtPaymentSplitPlansByDebtId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(COALESCE(v_debt_id_map ->> plan.key, plan.key), plan.value), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_next_household_settings -> 'debtPaymentSplitPlansByDebtId') AS plan(key, value);
    v_next_household_settings := pg_catalog.jsonb_set(v_next_household_settings, '{debtPaymentSplitPlansByDebtId}', v_remapped_split_plans, true);
  END IF;
  IF pg_catalog.jsonb_typeof(v_next_household_settings -> 'billPaymentSplitPlansByBillId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(COALESCE(v_bill_id_map ->> plan.key, plan.key), plan.value), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_next_household_settings -> 'billPaymentSplitPlansByBillId') AS plan(key, value);
    v_next_household_settings := pg_catalog.jsonb_set(v_next_household_settings, '{billPaymentSplitPlansByBillId}', v_remapped_split_plans, true);
  END IF;
  IF pg_catalog.jsonb_typeof(v_next_household_settings -> 'loanBillPairingByDebtId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(
      COALESCE(v_debt_id_map ->> pair.key, pair.key),
      CASE WHEN pg_catalog.jsonb_typeof(pair.value) = 'object' AND pair.value ? 'billId'
           THEN pg_catalog.jsonb_set(pair.value, ARRAY['billId'],
             pg_catalog.to_jsonb(COALESCE(v_bill_id_map ->> (pair.value ->> 'billId'), pair.value ->> 'billId')), false)
           ELSE pair.value END
    ), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_next_household_settings -> 'loanBillPairingByDebtId') AS pair(key, value);
    v_next_household_settings := pg_catalog.jsonb_set(v_next_household_settings, ARRAY['loanBillPairingByDebtId'], v_remapped_split_plans, true);
  END IF;
  IF pg_catalog.jsonb_typeof(v_next_household_settings -> 'recurringBillCategoryLabelByBillId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(COALESCE(v_bill_id_map ->> label.key, label.key), label.value), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_next_household_settings -> 'recurringBillCategoryLabelByBillId') AS label(key, value);
    v_next_household_settings := pg_catalog.jsonb_set(v_next_household_settings, ARRAY['recurringBillCategoryLabelByBillId'], v_remapped_split_plans, true);
  END IF;
  IF pg_catalog.jsonb_typeof(v_next_household_settings -> 'obligationSchedules') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(
      CASE
        WHEN pg_catalog.left(schedule.key, 5) = 'debt:' THEN 'debt:' || COALESCE(v_debt_id_map ->> pg_catalog.substr(schedule.key, 6), pg_catalog.substr(schedule.key, 6))
        WHEN pg_catalog.left(schedule.key, 5) = 'bill:' THEN 'bill:' || COALESCE(v_bill_id_map ->> pg_catalog.substr(schedule.key, 6), pg_catalog.substr(schedule.key, 6))
        ELSE schedule.key
      END, schedule.value
    ), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_next_household_settings -> 'obligationSchedules') AS schedule(key, value);
    v_next_household_settings := pg_catalog.jsonb_set(v_next_household_settings, ARRAY['obligationSchedules'], v_remapped_split_plans, true);
  END IF;
  IF pg_catalog.jsonb_typeof(v_next_household_settings -> 'mortgageEscrowByDebtId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(COALESCE(v_debt_id_map ->> setting.key, setting.key), setting.value), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_next_household_settings -> 'mortgageEscrowByDebtId') AS setting(key, value);
    v_next_household_settings := pg_catalog.jsonb_set(v_next_household_settings, ARRAY['mortgageEscrowByDebtId'], v_remapped_split_plans, true);
  END IF;
  IF pg_catalog.jsonb_typeof(v_next_household_settings -> 'mortgageExtraPaymentByDebtId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(COALESCE(v_debt_id_map ->> setting.key, setting.key), setting.value), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_next_household_settings -> 'mortgageExtraPaymentByDebtId') AS setting(key, value);
    v_next_household_settings := pg_catalog.jsonb_set(v_next_household_settings, ARRAY['mortgageExtraPaymentByDebtId'], v_remapped_split_plans, true);
  END IF;
  IF pg_catalog.jsonb_typeof(v_next_household_settings -> 'archivedPaidOffDebtIds') = 'array' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(mapped.debt_id) ORDER BY archived.ordinality), '[]'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_array_elements_text(v_next_household_settings -> 'archivedPaidOffDebtIds')
      WITH ORDINALITY AS archived(source_id, ordinality)
    CROSS JOIN LATERAL (SELECT COALESCE(v_debt_id_map ->> archived.source_id, archived.source_id) AS debt_id) AS mapped
    WHERE EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'onboardingData' -> 'debts') AS debt(value)
      WHERE debt.value ->> 'id' = mapped.debt_id
        AND (debt.value ->> 'balance')::numeric(18, 4) = 0
    );
    v_next_household_settings := pg_catalog.jsonb_set(v_next_household_settings, '{archivedPaidOffDebtIds}', v_remapped_split_plans, true);
  END IF;

  IF v_current_hs_revision >= 9223372036854775806 THEN
    RAISE EXCEPTION 'Household settings revision exhausted' USING ERRCODE = '22003';
  END IF;
  v_next_hs_revision := v_current_hs_revision + 1;

  IF v_next_household_name IS DISTINCT FROM v_auth.r_household_name THEN
    UPDATE public.households
    SET name = v_next_household_name
    WHERE id = p_household_id;
  END IF;

  UPDATE public.household_settings
  SET settings = v_next_household_settings,
      revision = v_next_hs_revision,
      updated_at = pg_catalog.now()
  WHERE household_id = p_household_id;

  PERFORM pg_catalog.set_config('debtfree.restore_importing', 'on', true);

  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'onboardingData' -> 'debts')
  LOOP
    v_uuid := (v_elem ->> 'id')::uuid;
    v_debt_name := pg_catalog.btrim(v_elem ->> 'name');
    v_debt_category := v_elem ->> 'category';
    v_debt_balance := (v_elem ->> 'balance')::numeric(18, 4);
    v_debt_original := NULLIF(v_elem ->> 'originalBalance', '')::numeric(18, 4);
    v_debt_apr := (v_elem ->> 'apr')::numeric(6, 3);
    v_debt_min := (v_elem ->> 'minimumPayment')::numeric(18, 4);
    v_debt_due := NULLIF(v_elem ->> 'dueDay', '')::integer;
    v_debt_limit := NULLIF(v_elem ->> 'creditLimit', '')::numeric(18, 4);
    v_debt_annual_fee := NULLIF(v_elem ->> 'annualFeeAmount', '')::numeric(18, 4);
    v_debt_annual_fee_next_due := NULLIF(v_elem ->> 'annualFeeNextDueDate', '')::date;
    v_debt_created := (v_elem ->> 'createdAt')::timestamptz;

    SELECT EXISTS (
      SELECT 1 FROM public.debts WHERE id = v_uuid AND household_id = p_household_id
    ) INTO v_debt_exists;

    IF v_debt_exists THEN
      UPDATE public.debts SET
        name = v_debt_name,
        category = v_debt_category,
        balance = v_debt_balance,
        original_balance = v_debt_original,
        apr = v_debt_apr,
        minimum_payment = v_debt_min,
        due_day = v_debt_due,
        credit_limit = v_debt_limit,
        annual_fee_amount = v_debt_annual_fee,
        annual_fee_next_due_date = v_debt_annual_fee_next_due,
        updated_at = pg_catalog.now()
      WHERE id = v_uuid AND household_id = p_household_id;
    ELSE
      INSERT INTO public.debts (
        id, user_id, household_id, name, category, balance,
        original_balance, apr, minimum_payment, due_day, credit_limit,
        annual_fee_amount, annual_fee_next_due_date, created_at, updated_at, version
      ) VALUES (
        v_uuid, v_auth.r_actor, p_household_id, v_debt_name, v_debt_category, v_debt_balance,
        v_debt_original, v_debt_apr, v_debt_min, v_debt_due, v_debt_limit,
        v_debt_annual_fee, v_debt_annual_fee_next_due, v_debt_created, pg_catalog.now(), 1
      );
    END IF;
  END LOOP;

  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'recurringBills')
  LOOP
    v_id := v_elem ->> 'id';
    v_bill_name := pg_catalog.btrim(v_elem ->> 'name');
    v_bill_cat := v_elem ->> 'category';
    v_minor_units := (v_elem -> 'amount' ->> 'minorUnits')::bigint;
    v_bill_amount := (v_minor_units::numeric / v_factor)::numeric(18, 4);
    v_bill_due := (v_elem ->> 'dueDay')::integer;
    v_bill_method := v_elem ->> 'paymentMethod';
    v_bill_credit_acct := NULLIF(v_elem ->> 'creditAccountId', '')::uuid;
    v_bill_autopost := COALESCE((v_elem ->> 'autoPost')::boolean, true);
    v_bill_active := COALESCE((v_elem ->> 'active')::boolean, true);
    v_bill_created := (v_elem ->> 'createdAt')::timestamptz;

    INSERT INTO public.recurring_bills (
      id, user_id, household_id, name, category, amount, due_day,
      payment_method, credit_account_id, auto_post, active, created_at, updated_at
    ) VALUES (
      v_id, v_auth.r_actor, p_household_id, v_bill_name, v_bill_cat, v_bill_amount, v_bill_due,
      v_bill_method, v_bill_credit_acct, v_bill_autopost, v_bill_active, v_bill_created, pg_catalog.now()
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      amount = EXCLUDED.amount,
      due_day = EXCLUDED.due_day,
      payment_method = EXCLUDED.payment_method,
      credit_account_id = EXCLUDED.credit_account_id,
      auto_post = EXCLUDED.auto_post,
      active = EXCLUDED.active,
      updated_at = pg_catalog.now()
    WHERE recurring_bills.household_id = p_household_id;
  END LOOP;

  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'transactions')
  LOOP
    v_id := v_elem ->> 'id';
    v_tx_acct := NULLIF(v_elem ->> 'accountId', '')::uuid;
    v_tx_date := (v_elem ->> 'date')::date;
    v_tx_applies := NULLIF(v_elem ->> 'appliesToDate', '')::date;
    v_minor_units := (v_elem -> 'amount' ->> 'minorUnits')::bigint;
    v_tx_amount := (v_minor_units::numeric / v_factor)::numeric(18, 4);
    v_tx_cat := v_elem ->> 'category';
    v_tx_payee := pg_catalog.btrim(v_elem ->> 'payee');
    v_tx_memo := NULLIF(pg_catalog.btrim(v_elem ->> 'memo'), '');
    v_tx_source := COALESCE(v_elem ->> 'source', 'manual');
    v_tx_reconciled := COALESCE((v_elem ->> 'reconciled')::boolean, false);
    v_tx_created := (v_elem ->> 'createdAt')::timestamptz;
    v_tx_deleted := NULLIF(v_elem ->> 'deletedAt', '')::timestamptz;

    v_tx_principal := CASE WHEN v_elem ? 'principalAmount' AND v_elem -> 'principalAmount' IS NOT NULL
      AND pg_catalog.jsonb_typeof(v_elem -> 'principalAmount') = 'object'
      THEN ((v_elem -> 'principalAmount' ->> 'minorUnits')::bigint::numeric / v_factor)::numeric(18, 4) ELSE NULL END;
    v_tx_interest := CASE WHEN v_elem ? 'interestAmount' AND v_elem -> 'interestAmount' IS NOT NULL
      AND pg_catalog.jsonb_typeof(v_elem -> 'interestAmount') = 'object'
      THEN ((v_elem -> 'interestAmount' ->> 'minorUnits')::bigint::numeric / v_factor)::numeric(18, 4) ELSE NULL END;
    v_tx_escrow := CASE WHEN v_elem ? 'escrowAmount' AND v_elem -> 'escrowAmount' IS NOT NULL
      AND pg_catalog.jsonb_typeof(v_elem -> 'escrowAmount') = 'object'
      THEN ((v_elem -> 'escrowAmount' ->> 'minorUnits')::bigint::numeric / v_factor)::numeric(18, 4) ELSE NULL END;
    v_tx_fee := CASE WHEN v_elem ? 'feeAmount' AND v_elem -> 'feeAmount' IS NOT NULL
      AND pg_catalog.jsonb_typeof(v_elem -> 'feeAmount') = 'object'
      THEN ((v_elem -> 'feeAmount' ->> 'minorUnits')::bigint::numeric / v_factor)::numeric(18, 4) ELSE NULL END;

    INSERT INTO public.transactions (
      id, user_id, household_id, account_id, date, applies_to_date,
      amount, category, payee, memo, source, reconciled,
      created_at, updated_at, deleted_at,
      principal_amount, interest_amount, escrow_amount, fee_amount
    ) VALUES (
      v_id, v_auth.r_actor, p_household_id, v_tx_acct, v_tx_date, v_tx_applies,
      v_tx_amount, v_tx_cat, v_tx_payee, v_tx_memo, v_tx_source, v_tx_reconciled,
      v_tx_created, pg_catalog.now(), v_tx_deleted,
      v_tx_principal, v_tx_interest, v_tx_escrow, v_tx_fee
    )
    ON CONFLICT (id) DO UPDATE SET
      account_id = EXCLUDED.account_id,
      date = EXCLUDED.date,
      applies_to_date = EXCLUDED.applies_to_date,
      amount = EXCLUDED.amount,
      category = EXCLUDED.category,
      payee = EXCLUDED.payee,
      memo = EXCLUDED.memo,
      source = EXCLUDED.source,
      reconciled = EXCLUDED.reconciled,
      updated_at = pg_catalog.now(),
      deleted_at = EXCLUDED.deleted_at,
      principal_amount = EXCLUDED.principal_amount,
      interest_amount = EXCLUDED.interest_amount,
      escrow_amount = EXCLUDED.escrow_amount,
      fee_amount = EXCLUDED.fee_amount
    WHERE transactions.household_id = p_household_id;
  END LOOP;

  PERFORM pg_catalog.set_config('debtfree.restore_importing', 'off', true);

  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'reconciliationAnchors')
  LOOP
    v_id := v_elem ->> 'id';
    v_anchor_acct := (v_elem ->> 'accountId')::uuid;
    v_anchor_date := (v_elem ->> 'asOfDate')::date;
    v_minor_units := (v_elem -> 'verifiedBalance' ->> 'minorUnits')::bigint;
    v_anchor_balance := (v_minor_units::numeric / v_factor)::numeric(18, 4);
    v_anchor_note := NULLIF(pg_catalog.btrim(v_elem ->> 'note'), '');
    v_anchor_adj := NULLIF(v_elem ->> 'createdAdjustmentId', '');
    v_anchor_created := (v_elem ->> 'createdAt')::timestamptz;

    INSERT INTO public.reconciliation_anchors (
      id, user_id, household_id, account_id, as_of_date, verified_balance,
      note, created_at, created_adjustment_id
    ) VALUES (
      v_id, v_auth.r_actor, p_household_id, v_anchor_acct, v_anchor_date, v_anchor_balance,
      v_anchor_note, v_anchor_created, v_anchor_adj
    )
    ON CONFLICT (id) DO UPDATE SET
      account_id = EXCLUDED.account_id,
      as_of_date = EXCLUDED.as_of_date,
      verified_balance = EXCLUDED.verified_balance,
      note = EXCLUDED.note,
      created_adjustment_id = EXCLUDED.created_adjustment_id
    WHERE reconciliation_anchors.household_id = p_household_id;
  END LOOP;

  SELECT * INTO v_final_snapshot
  FROM public.debtfree_internal_build_snapshot(
    v_auth.r_actor, p_household_id, v_next_household_name, v_auth.r_currency
  );

  INSERT INTO public.debtfree_restore_receipts (
    household_id, owner_user_id, operation_id, request_identity,
    client_payload_fingerprint, restored_snapshot, completed_at
  ) VALUES (
    p_household_id, v_auth.r_actor, p_operation_id, v_current_request_identity,
    p_payload_fingerprint, v_final_snapshot.r_snapshot, pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'operationId', p_operation_id,
    'payloadFingerprint', p_payload_fingerprint,
    'restoredSnapshot', v_final_snapshot.r_snapshot
  );
END;
$$;

-- ============================================================================
-- 9. Household Membership Management RPCs
-- ============================================================================
CREATE OR REPLACE FUNCTION public.debtfree_list_household_members(
  p_household_id text,
  p_expected_membership_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_lifecycle_state text;
  v_version bigint;
  v_caller_role text;
  v_members jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_household_id IS NULL OR p_household_id = ''
     OR p_household_id <> pg_catalog.btrim(p_household_id)
     OR pg_catalog.length(p_household_id) > 120 THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;
  IF p_expected_membership_version IS NOT NULL AND p_expected_membership_version < 1 THEN
    RAISE EXCEPTION 'Invalid expected membership version' USING ERRCODE = '22023';
  END IF;

  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[v_actor], 'share', false);
  PERFORM public.debtfree_internal_lock_households(ARRAY[p_household_id], 'share');

  SELECT h.lifecycle_state, h.membership_version
    INTO v_lifecycle_state, v_version
  FROM public.households AS h
  WHERE h.id = p_household_id;
  IF NOT FOUND OR v_lifecycle_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  SELECT hm.role INTO v_caller_role
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id
    AND hm.user_id = v_actor
    AND hm.status = 'active'
  FOR SHARE;
  IF NOT FOUND OR v_caller_role NOT IN ('owner', 'admin', 'viewer') THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  IF p_expected_membership_version IS NOT NULL
     AND v_version IS DISTINCT FROM p_expected_membership_version THEN
    RAISE EXCEPTION 'Household membership changed; refresh contexts and retry' USING ERRCODE = '40001';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'userId', hm.user_id::text,
      'role', CASE WHEN hm.role = 'admin' THEN 'member' ELSE hm.role END,
      'emailHint', CASE
        WHEN u.email IS NULL OR pg_catalog.strpos(u.email, '@') = 0 THEN NULL
        ELSE pg_catalog.left(pg_catalog.split_part(u.email, '@', 1), 1)
             || '***@' || pg_catalog.split_part(u.email, '@', 2)
      END,
      'isSelf', hm.user_id = v_actor,
      'joinedAt', hm.created_at
    ) ORDER BY
      CASE hm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
      hm.created_at,
      hm.user_id
  ), '[]'::jsonb)
  INTO v_members
  FROM public.household_members AS hm
  LEFT JOIN auth.users AS u ON u.id = hm.user_id
  WHERE hm.household_id = p_household_id
    AND hm.status = 'active';

  RETURN pg_catalog.jsonb_build_object(
    'status', 'ok',
    'householdId', p_household_id,
    'membershipVersion', v_version::text,
    'members', v_members
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.debtfree_update_household_member_role(
  p_household_id text,
  p_expected_membership_version bigint,
  p_member_user_id uuid,
  p_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_normalized_role text;
  v_lifecycle_state text;
  v_version bigint;
  v_actor_role text;
  v_target_role text;
  v_owner_count bigint;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_household_id IS NULL OR p_household_id = ''
     OR p_household_id <> pg_catalog.btrim(p_household_id)
     OR pg_catalog.length(p_household_id) > 120 THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;
  IF p_expected_membership_version IS NULL OR p_expected_membership_version < 1
     OR p_member_user_id IS NULL OR p_role IS NULL THEN
    RAISE EXCEPTION 'Invalid membership role parameters' USING ERRCODE = '22023';
  END IF;

  v_normalized_role := CASE WHEN p_role = 'member' THEN 'admin' ELSE p_role END;
  IF v_normalized_role NOT IN ('admin', 'viewer') THEN
    RAISE EXCEPTION 'Member role must be admin/member or viewer' USING ERRCODE = '22023';
  END IF;
  IF p_member_user_id = v_actor THEN
    RAISE EXCEPTION 'Owner cannot change their own role; transfer ownership instead' USING ERRCODE = '23514';
  END IF;

  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[v_actor, p_member_user_id], 'update', false);
  PERFORM public.debtfree_internal_lock_households(ARRAY[p_household_id], 'update');

  SELECT h.lifecycle_state, h.membership_version
    INTO v_lifecycle_state, v_version
  FROM public.households AS h
  WHERE h.id = p_household_id;
  IF NOT FOUND OR v_lifecycle_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  PERFORM hm.user_id
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id
  ORDER BY hm.user_id
  FOR UPDATE;

  SELECT hm.role INTO v_actor_role
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id AND hm.user_id = v_actor AND hm.status = 'active';

  SELECT count(*) INTO v_owner_count
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id AND hm.status = 'active' AND hm.role = 'owner';

  IF v_actor_role IS DISTINCT FROM 'owner' OR v_owner_count <> 1 THEN
    RAISE EXCEPTION 'Only the household owner can update member roles' USING ERRCODE = '42501';
  END IF;
  IF v_version IS DISTINCT FROM p_expected_membership_version THEN
    RAISE EXCEPTION 'Household membership version changed' USING ERRCODE = '40001';
  END IF;

  SELECT hm.role INTO v_target_role
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id AND hm.user_id = p_member_user_id AND hm.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target household member is not active' USING ERRCODE = 'P0002';
  END IF;
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Owner role cannot be overwritten; use ownership transfer' USING ERRCODE = '23514';
  END IF;

  UPDATE public.household_members
  SET role = v_normalized_role
  WHERE household_id = p_household_id AND user_id = p_member_user_id AND status = 'active';

  UPDATE public.households
  SET membership_version = membership_version + 1
  WHERE id = p_household_id
  RETURNING membership_version INTO v_version;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'updated',
    'householdId', p_household_id,
    'userId', p_member_user_id::text,
    'role', CASE WHEN v_normalized_role = 'admin' THEN 'member' ELSE v_normalized_role END,
    'membershipVersion', v_version::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.debtfree_remove_household_member(
  p_household_id text,
  p_expected_membership_version bigint,
  p_member_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_lifecycle_state text;
  v_version bigint;
  v_actor_role text;
  v_target_role text;
  v_owner_count bigint;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_household_id IS NULL OR p_household_id = ''
     OR p_household_id <> pg_catalog.btrim(p_household_id)
     OR pg_catalog.length(p_household_id) > 120 THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;
  IF p_expected_membership_version IS NULL OR p_expected_membership_version < 1
     OR p_member_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid member removal parameters' USING ERRCODE = '22023';
  END IF;
  IF p_member_user_id = v_actor THEN
    RAISE EXCEPTION 'Owner cannot remove themselves; leave or delete account instead' USING ERRCODE = '23514';
  END IF;

  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[v_actor, p_member_user_id], 'update', true);
  IF EXISTS (
    SELECT 1 FROM public.debtfree_account_lifecycle AS al
    WHERE al.account_id = v_actor AND al.deletion_state <> 'active'
  ) THEN
    RAISE EXCEPTION 'Account is not active' USING ERRCODE = '42501';
  END IF;
  PERFORM public.debtfree_internal_lock_households(ARRAY[p_household_id], 'update');

  SELECT h.lifecycle_state, h.membership_version
    INTO v_lifecycle_state, v_version
  FROM public.households AS h
  WHERE h.id = p_household_id;
  IF NOT FOUND OR v_lifecycle_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  PERFORM hm.user_id
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id
  ORDER BY hm.user_id
  FOR UPDATE;

  SELECT hm.role INTO v_actor_role
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id AND hm.user_id = v_actor AND hm.status = 'active';

  SELECT count(*) INTO v_owner_count
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id AND hm.status = 'active' AND hm.role = 'owner';

  IF v_actor_role IS DISTINCT FROM 'owner' OR v_owner_count <> 1 THEN
    RAISE EXCEPTION 'Only the household owner can remove members' USING ERRCODE = '42501';
  END IF;
  IF v_version IS DISTINCT FROM p_expected_membership_version THEN
    RAISE EXCEPTION 'Household membership version changed' USING ERRCODE = '40001';
  END IF;

  SELECT hm.role INTO v_target_role
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id AND hm.user_id = p_member_user_id AND hm.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target household member is not active' USING ERRCODE = 'P0002';
  END IF;
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Household owner cannot be removed' USING ERRCODE = '23514';
  END IF;

  UPDATE public.household_members
  SET status = 'revoked'
  WHERE household_id = p_household_id AND user_id = p_member_user_id AND status = 'active';

  UPDATE public.households
  SET membership_version = membership_version + 1
  WHERE id = p_household_id
  RETURNING membership_version INTO v_version;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'removed',
    'householdId', p_household_id,
    'userId', p_member_user_id::text,
    'membershipVersion', v_version::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.debtfree_leave_household(
  p_household_id text,
  p_expected_membership_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_lifecycle_state text;
  v_version bigint;
  v_actor_role text;
  v_owner_count bigint;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_household_id IS NULL OR p_household_id = ''
     OR p_household_id <> pg_catalog.btrim(p_household_id)
     OR pg_catalog.length(p_household_id) > 120 THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;
  IF p_expected_membership_version IS NULL OR p_expected_membership_version < 1 THEN
    RAISE EXCEPTION 'Invalid membership version' USING ERRCODE = '22023';
  END IF;

  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[v_actor], 'update', false);
  PERFORM public.debtfree_internal_lock_households(ARRAY[p_household_id], 'update');

  SELECT h.lifecycle_state, h.membership_version
    INTO v_lifecycle_state, v_version
  FROM public.households AS h
  WHERE h.id = p_household_id;
  IF NOT FOUND OR v_lifecycle_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  PERFORM hm.user_id
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id
  ORDER BY hm.user_id
  FOR UPDATE;

  SELECT hm.role INTO v_actor_role
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id AND hm.user_id = v_actor AND hm.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Household membership not active' USING ERRCODE = '42501';
  END IF;
  IF v_actor_role = 'owner' THEN
    RAISE EXCEPTION 'Household owner cannot leave without transferring ownership first' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_owner_count
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id AND hm.status = 'active' AND hm.role = 'owner';
  IF v_owner_count <> 1 THEN
    RAISE EXCEPTION 'Household ownership invariant violation' USING ERRCODE = 'P0001';
  END IF;
  IF v_version IS DISTINCT FROM p_expected_membership_version THEN
    RAISE EXCEPTION 'Household membership version changed' USING ERRCODE = '40001';
  END IF;

  UPDATE public.household_members
  SET status = 'revoked'
  WHERE household_id = p_household_id AND user_id = v_actor AND status = 'active';

  UPDATE public.households
  SET membership_version = membership_version + 1
  WHERE id = p_household_id
  RETURNING membership_version INTO v_version;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'left',
    'householdId', p_household_id,
    'userId', v_actor::text,
    'membershipVersion', v_version::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.debtfree_transfer_household_ownership(
  p_household_id text,
  p_expected_membership_version bigint,
  p_new_owner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_lifecycle_state text;
  v_version bigint;
  v_actor_role text;
  v_target_role text;
  v_owner_count bigint;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_household_id IS NULL OR p_household_id = ''
     OR p_household_id <> pg_catalog.btrim(p_household_id)
     OR pg_catalog.length(p_household_id) > 120 THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;
  IF p_expected_membership_version IS NULL OR p_expected_membership_version < 1
     OR p_new_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid ownership transfer parameters' USING ERRCODE = '22023';
  END IF;
  IF p_new_owner_user_id = v_actor THEN
    RAISE EXCEPTION 'Cannot transfer ownership to yourself' USING ERRCODE = '23514';
  END IF;

  PERFORM public.debtfree_internal_lock_account_guards(ARRAY[v_actor, p_new_owner_user_id], 'update', false);
  PERFORM public.debtfree_internal_lock_households(ARRAY[p_household_id], 'update');

  SELECT h.lifecycle_state, h.membership_version
    INTO v_lifecycle_state, v_version
  FROM public.households AS h
  WHERE h.id = p_household_id;
  IF NOT FOUND OR v_lifecycle_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Household access denied' USING ERRCODE = '42501';
  END IF;

  PERFORM hm.user_id
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id
  ORDER BY hm.user_id
  FOR UPDATE;

  SELECT hm.role INTO v_actor_role
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id AND hm.user_id = v_actor AND hm.status = 'active';

  SELECT count(*) INTO v_owner_count
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id AND hm.status = 'active' AND hm.role = 'owner';

  IF v_actor_role IS DISTINCT FROM 'owner' OR v_owner_count <> 1 THEN
    RAISE EXCEPTION 'Only the current owner can transfer household ownership' USING ERRCODE = '42501';
  END IF;
  IF v_version IS DISTINCT FROM p_expected_membership_version THEN
    RAISE EXCEPTION 'Household membership version changed' USING ERRCODE = '40001';
  END IF;

  SELECT hm.role INTO v_target_role
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id AND hm.user_id = p_new_owner_user_id AND hm.status = 'active';
  IF NOT FOUND OR v_target_role NOT IN ('admin', 'viewer') THEN
    RAISE EXCEPTION 'Target new owner must be an active member of this household' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.household_members
  SET role = CASE
    WHEN user_id = v_actor THEN 'admin'
    WHEN user_id = p_new_owner_user_id THEN 'owner'
    ELSE role
  END
  WHERE household_id = p_household_id
    AND user_id IN (v_actor, p_new_owner_user_id)
    AND status = 'active';

  UPDATE public.households
  SET membership_version = membership_version + 1
  WHERE id = p_household_id
  RETURNING membership_version INTO v_version;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'transferred',
    'householdId', p_household_id,
    'previousOwnerUserId', v_actor::text,
    'newOwnerUserId', p_new_owner_user_id::text,
    'membershipVersion', v_version::text
  );
END;
$$;

-- ============================================================================
-- 10. Drop Retired Single-User Finance RPCs & Legacy Locks
-- ============================================================================
DROP FUNCTION IF EXISTS public.debtfree_lock_financial_user();
DROP FUNCTION IF EXISTS public.debtfree_lock_financial_statement();
DROP FUNCTION IF EXISTS public.debtfree_sync_paid_off_archive(uuid, boolean);
DROP FUNCTION IF EXISTS public.debtfree_internal_verify_user_household(uuid);
DROP FUNCTION IF EXISTS public.debtfree_internal_build_snapshot(uuid, text, text);
DROP FUNCTION IF EXISTS public.debtfree_read_restore_baseline();
DROP FUNCTION IF EXISTS public.debtfree_find_restore_receipt(text);
DROP FUNCTION IF EXISTS public.debtfree_apply_snapshot_restore(text, text, text, text, text[], text[], jsonb, boolean);
DROP FUNCTION IF EXISTS public.debtfree_save_household_settings(text, bigint, jsonb);
DROP FUNCTION IF EXISTS public.debtfree_update_debt_atomic(jsonb, bigint);
DROP FUNCTION IF EXISTS public.debtfree_delete_debt_atomic(uuid, bigint);
DROP FUNCTION IF EXISTS public.debtfree_delete_debt_atomic(uuid, bigint, uuid);
DROP FUNCTION IF EXISTS public.debtfree_reset_financial_data_atomic();
DROP FUNCTION IF EXISTS public.debtfree_reset_financial_data_atomic(uuid);
DROP FUNCTION IF EXISTS public.debtfree_record_transaction_atomic(jsonb, text, bigint);
DROP FUNCTION IF EXISTS public.debtfree_update_transaction_atomic(jsonb, text, bigint, bigint, timestamptz);
DROP FUNCTION IF EXISTS public.debtfree_delete_transaction_atomic(text, text, bigint, timestamptz);
DROP FUNCTION IF EXISTS public.debtfree_reconcile_debt_atomic(jsonb);

-- ============================================================================
-- 11. Least-Privilege Function Grants
-- ============================================================================
REVOKE ALL ON FUNCTION public.debtfree_save_settings(bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_save_settings(bigint, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_upsert_household_debt_atomic(text, bigint, jsonb, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_upsert_household_debt_atomic(text, bigint, jsonb, bigint, text) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_delete_household_debt_atomic(text, bigint, uuid, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_delete_household_debt_atomic(text, bigint, uuid, bigint, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_reset_household_financial_data_atomic(text, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_reset_household_financial_data_atomic(text, bigint, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_record_household_transaction_atomic(text, bigint, jsonb, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_record_household_transaction_atomic(text, bigint, jsonb, text, bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_update_household_transaction_atomic(text, bigint, jsonb, text, bigint, bigint, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_update_household_transaction_atomic(text, bigint, jsonb, text, bigint, bigint, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_delete_household_transaction_atomic(text, bigint, text, text, bigint, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_delete_household_transaction_atomic(text, bigint, text, text, bigint, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_upsert_household_bill_atomic(text, bigint, jsonb, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_upsert_household_bill_atomic(text, bigint, jsonb, timestamptz, text) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_delete_household_bill_atomic(text, bigint, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_delete_household_bill_atomic(text, bigint, text, timestamptz, text) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_upsert_household_anchor_atomic(text, bigint, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_upsert_household_anchor_atomic(text, bigint, jsonb, text) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_reconcile_household_debt_atomic(text, bigint, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_reconcile_household_debt_atomic(text, bigint, jsonb, text) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_read_restore_baseline(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_read_restore_baseline(text, bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_find_restore_receipt(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_find_restore_receipt(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_apply_snapshot_restore(text, bigint, text, text, text, text, text[], text[], jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_apply_snapshot_restore(text, bigint, text, text, text, text, text[], text[], jsonb, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_list_household_members(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_list_household_members(text, bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_update_household_member_role(text, bigint, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_update_household_member_role(text, bigint, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_remove_household_member(text, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_remove_household_member(text, bigint, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_leave_household(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_leave_household(text, bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.debtfree_transfer_household_ownership(text, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_transfer_household_ownership(text, bigint, uuid) TO authenticated;

-- ============================================================================
-- 12. Cutover Gate Activation & Postcondition Assertion
-- ============================================================================
UPDATE public.debtfree_household_cutover_gate
SET enabled = true
WHERE singleton;

DO $$
BEGIN
  PERFORM public.debtfree_internal_require_deletion_cutover();
END
$$;

COMMIT;
