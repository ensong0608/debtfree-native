-- Durable server-side lifecycle state and account deletion fence foundation.
-- This migration does not widen financial authorization; shared finance stays
-- disabled until every RPC, trigger, read and restore path uses these guards.
BEGIN;

LOCK TABLE auth.users, public.households, public.household_members
  IN SHARE ROW EXCLUSIVE MODE;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'auth.users'::regclass AND attname = 'id'
      AND atttypid = 'uuid'::regtype AND attnotnull AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.households'::regclass AND attname = 'id'
      AND atttypid = 'text'::regtype AND attnotnull AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.household_members'::regclass AND attname = 'household_id'
      AND atttypid = 'text'::regtype AND attnotnull AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.household_members'::regclass AND attname = 'user_id'
      AND atttypid = 'uuid'::regtype AND attnotnull AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.household_members'::regclass AND attname = 'status'
      AND atttypid = 'text'::regtype AND attnotnull AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Unexpected Auth or household lifecycle schema; review before applying';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.households'::regclass
      AND attname IN ('lifecycle_state', 'membership_version', 'pending_delete_operation_id', 'pending_delete_version')
      AND NOT attisdropped
  ) OR pg_catalog.to_regclass('public.debtfree_account_lifecycle') IS NOT NULL THEN
    RAISE EXCEPTION 'Household lifecycle objects already exist; review migration drift';
  END IF;
END
$migration$;

-- There is deliberately no Auth FK: a completed fence is durable after the
-- auth.users row and its memberships have been deleted.
CREATE TABLE public.debtfree_account_lifecycle (
  account_id uuid PRIMARY KEY,
  deletion_state text NOT NULL DEFAULT 'active'
    CHECK (deletion_state IN ('active', 'fenced', 'dispatched', 'uncertain', 'deleted')),
  deletion_operation_id uuid,
  deletion_household_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  fence_version bigint NOT NULL DEFAULT 0 CHECK (fence_version >= 0),
  fenced_at timestamptz,
  dispatch_started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CHECK (
    (deletion_state = 'active' AND deletion_operation_id IS NULL
      AND fenced_at IS NULL AND dispatch_started_at IS NULL
      AND cardinality(deletion_household_ids) = 0)
    OR (deletion_state = 'fenced' AND deletion_operation_id IS NOT NULL
      AND fenced_at IS NOT NULL AND dispatch_started_at IS NULL)
    OR (deletion_state IN ('dispatched', 'uncertain', 'deleted')
      AND deletion_operation_id IS NOT NULL AND fenced_at IS NOT NULL
      AND dispatch_started_at IS NOT NULL)
  )
);
ALTER TABLE public.debtfree_account_lifecycle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.debtfree_account_lifecycle FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.debtfree_account_lifecycle IS
  'Durable account lifecycle fence. Rows intentionally survive Auth deletion; only narrow SECURITY DEFINER/service operations may read or mutate them.';

-- Version changes on any membership transition and serializes selected client
-- contexts. A pending-delete household remains present until Auth deletion has
-- a confirmed terminal outcome.
ALTER TABLE public.households
  ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_state IN ('active', 'pending_delete')),
  ADD COLUMN membership_version bigint NOT NULL DEFAULT 1
    CHECK (membership_version > 0),
  ADD COLUMN pending_delete_operation_id uuid,
  ADD COLUMN pending_delete_version bigint;
ALTER TABLE public.households ADD CONSTRAINT households_pending_delete_state_check
  CHECK (
    (lifecycle_state = 'active' AND pending_delete_operation_id IS NULL AND pending_delete_version IS NULL)
    OR (lifecycle_state = 'pending_delete' AND pending_delete_operation_id IS NOT NULL
      AND pending_delete_version IS NOT NULL AND pending_delete_version = membership_version)
  );
COMMENT ON COLUMN public.households.membership_version IS
  'Monotonic household membership/lifecycle version returned with server-verified household contexts.';
COMMENT ON COLUMN public.households.lifecycle_state IS
  'Active contexts can be read and changed by current members. pending_delete denies member and finance access until finalization or version-checked rollback.';

INSERT INTO public.debtfree_account_lifecycle (account_id)
SELECT u.id FROM auth.users AS u
ON CONFLICT (account_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.debtfree_internal_lock_account_guards(
  p_account_ids uuid[],
  p_lock_mode text DEFAULT 'share',
  p_allow_nonactive boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_role text := COALESCE((SELECT auth.role()), '');
  v_account_id uuid;
  v_state text;
BEGIN
  IF p_lock_mode IS NULL OR p_lock_mode NOT IN ('share', 'update')
     OR p_account_ids IS NULL
     OR cardinality(p_account_ids) = 0
     OR array_position(p_account_ids, NULL) IS NOT NULL
     OR p_allow_nonactive IS NULL THEN
    RAISE EXCEPTION 'Invalid account lifecycle lock request' USING ERRCODE = '22023';
  END IF;
  IF v_actor IS NULL AND v_role <> 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF v_actor IS NOT NULL AND v_role <> 'service_role'
     AND NOT (v_actor = ANY (p_account_ids)) THEN
    RAISE EXCEPTION 'Lifecycle participant set is incomplete' USING ERRCODE = '40001';
  END IF;

  -- All participating Auth account guards precede household and membership
  -- locks. Sorting is mandatory for multi-account operations.
  FOR v_account_id IN
    SELECT DISTINCT requested.account_id
    FROM pg_catalog.unnest(p_account_ids) AS requested(account_id)
    ORDER BY requested.account_id
  LOOP
    IF p_lock_mode = 'update' THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('debtfree.account:' || v_account_id::text, 0)
      );
      INSERT INTO public.debtfree_account_lifecycle (account_id)
      VALUES (v_account_id)
      ON CONFLICT (account_id) DO NOTHING;
      SELECT lifecycle.deletion_state INTO v_state
      FROM public.debtfree_account_lifecycle AS lifecycle
      WHERE lifecycle.account_id = v_account_id
      FOR UPDATE;
    ELSE
      -- Read/write operations use the shared guard. A lifecycle transition
      -- takes the exclusive form before changing the durable fence state.
      PERFORM pg_catalog.pg_advisory_xact_lock_shared(
        pg_catalog.hashtextextended('debtfree.account:' || v_account_id::text, 0)
      );
      SELECT lifecycle.deletion_state INTO v_state
      FROM public.debtfree_account_lifecycle AS lifecycle
      WHERE lifecycle.account_id = v_account_id;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Account lifecycle state unavailable' USING ERRCODE = 'P0002';
    END IF;
    IF v_state <> 'active' AND NOT p_allow_nonactive THEN
      RAISE EXCEPTION 'Account deletion is pending; retry after lifecycle reconciliation'
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
END
$function$;
REVOKE ALL ON FUNCTION public.debtfree_internal_lock_account_guards(uuid[], text, boolean)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.debtfree_internal_lock_households(
  p_household_ids text[],
  p_lock_mode text DEFAULT 'share'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_role text := COALESCE((SELECT auth.role()), '');
  v_household_id text;
  v_locked_id text;
BEGIN
  IF p_lock_mode IS NULL OR p_lock_mode NOT IN ('share', 'update')
     OR p_household_ids IS NULL OR cardinality(p_household_ids) = 0
     OR array_position(p_household_ids, NULL) IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_household_ids) AS requested(id)
       WHERE requested.id = '' OR requested.id <> pg_catalog.btrim(requested.id)
          OR pg_catalog.length(requested.id) > 120
     ) THEN
    RAISE EXCEPTION 'Invalid household lock request' USING ERRCODE = '22023';
  END IF;
  IF v_actor IS NULL AND v_role <> 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Caller has already acquired every participating account guard. Household
  -- advisory and row locks follow in deterministic C-collation order.
  FOR v_household_id IN
    SELECT distinct_ids.id
    FROM (
      SELECT DISTINCT requested.id
      FROM pg_catalog.unnest(p_household_ids) AS requested(id)
    ) AS distinct_ids
    ORDER BY distinct_ids.id COLLATE "C"
  LOOP
    IF p_lock_mode = 'update' THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('debtfree.household:' || v_household_id, 0)
      );
      SELECT h.id INTO v_locked_id
      FROM public.households AS h WHERE h.id = v_household_id FOR UPDATE;
    ELSE
      PERFORM pg_catalog.pg_advisory_xact_lock_shared(
        pg_catalog.hashtextextended('debtfree.household:' || v_household_id, 0)
      );
      SELECT h.id INTO v_locked_id
      FROM public.households AS h WHERE h.id = v_household_id FOR SHARE;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Household not found' USING ERRCODE = 'P0002';
    END IF;
  END LOOP;
END
$function$;
REVOKE ALL ON FUNCTION public.debtfree_internal_lock_households(text[], text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.debtfree_household_member_context_active(p_household_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_state text;
BEGIN
  IF v_actor IS NULL OR p_household_id IS NULL OR p_household_id = ''
     OR p_household_id <> pg_catalog.btrim(p_household_id)
     OR pg_catalog.length(p_household_id) > 120 THEN
    RETURN false;
  END IF;

  -- GET/HEAD requests can be read-only transactions, so authorization reads
  -- coordinate through the caller's shared account guard rather than row-lock
  -- clauses. Every lifecycle operation affecting this membership takes the
  -- same account guard exclusively before changing household/member state.
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('debtfree.account:' || v_actor::text, 0)
  );
  SELECT lifecycle.deletion_state INTO v_state
  FROM public.debtfree_account_lifecycle AS lifecycle
  WHERE lifecycle.account_id = v_actor;
  IF NOT FOUND OR v_state <> 'active' THEN RETURN false; END IF;

  SELECT h.lifecycle_state INTO v_state
  FROM public.households AS h
  WHERE h.id = p_household_id;
  IF NOT FOUND OR v_state <> 'active' THEN RETURN false; END IF;

  SELECT hm.status INTO v_state
  FROM public.household_members AS hm
  WHERE hm.household_id = p_household_id
    AND hm.user_id = v_actor;
  RETURN FOUND AND v_state = 'active';
END
$function$;
REVOKE ALL ON FUNCTION public.debtfree_household_member_context_active(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_household_member_context_active(text) TO authenticated;
COMMENT ON FUNCTION public.debtfree_household_member_context_active(text) IS
  'RLS-safe current membership predicate. A pending-delete household or fenced account is denied immediately.';

CREATE OR REPLACE FUNCTION public.debtfree_seed_account_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.debtfree_account_lifecycle (account_id)
  VALUES (NEW.id)
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.debtfree_seed_account_lifecycle_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER debtfree_seed_account_lifecycle_guard_after_insert
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.debtfree_seed_account_lifecycle_guard();

-- Keep household/member identity read-only to clients, and make even those
-- reads disappear while the selected household or account is fenced.
DROP POLICY IF EXISTS household_members_self_select ON public.household_members;
CREATE POLICY household_members_self_select ON public.household_members
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND public.debtfree_household_member_context_active(household_id)
  );

DROP POLICY IF EXISTS households_active_member_select ON public.households;
CREATE POLICY households_active_member_select ON public.households
  FOR SELECT TO authenticated
  USING (public.debtfree_household_member_context_active(id));

COMMIT;
