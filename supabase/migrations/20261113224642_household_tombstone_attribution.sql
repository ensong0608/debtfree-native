-- Staging prerequisite only. Shared access remains disabled until all finance
-- RPCs, tombstone writers, restore paths, and account lifecycle paths are cut over.
BEGIN;

-- Freeze Auth and membership identity first, then the finance sources and their
-- tombstone tables in the same order used by the current restore lock preflight.
LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.households IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.household_members IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.debts IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.debtfree_deleted_debt_ids IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.recurring_bills IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.debtfree_deleted_bill_ids IN SHARE ROW EXCLUSIVE MODE;

-- Snapshot the only permissible legacy mapping: exactly one active owner
-- household for the user that authored the existing tombstone.
CREATE TEMP TABLE _df_tombstone_owner_households ON COMMIT DROP AS
SELECT hm.user_id,
       min(hm.household_id) AS household_id,
       count(*) AS owner_count
FROM public.household_members AS hm
WHERE hm.role = 'owner'
  AND hm.status = 'active'
GROUP BY hm.user_id;

DO $migration$
DECLARE
  v_debt_id_att smallint;
  v_debt_user_att smallint;
  v_bill_user_att smallint;
  v_bill_id_att smallint;
BEGIN
  -- Fail closed if any table or identity definition differs from the reviewed
  -- legacy contract. This migration must never silently re-key a tombstone.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.households'::regclass
      AND attname = 'id' AND atttypid = 'text'::regtype
      AND attnotnull AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.household_members'::regclass
      AND attname = 'household_id' AND atttypid = 'text'::regtype
      AND attnotnull AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.household_members'::regclass
      AND attname = 'user_id' AND atttypid = 'uuid'::regtype
      AND attnotnull AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.household_members'::regclass
      AND attname = 'role' AND atttypid = 'text'::regtype
      AND attnotnull AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.household_members'::regclass
      AND attname = 'status' AND atttypid = 'text'::regtype
      AND attnotnull AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Unexpected household or membership schema; review tombstone attribution before migration';
  END IF;

  SELECT a.attnum INTO v_debt_id_att
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.debtfree_deleted_debt_ids'::regclass
    AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype
    AND a.attnotnull AND NOT a.attisdropped;
  SELECT a.attnum INTO v_debt_user_att
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.debtfree_deleted_debt_ids'::regclass
    AND a.attname = 'deleted_user_id' AND a.atttypid = 'uuid'::regtype
    AND a.attnotnull AND NOT a.attisdropped;
  SELECT a.attnum INTO v_bill_user_att
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.debtfree_deleted_bill_ids'::regclass
    AND a.attname = 'user_id' AND a.atttypid = 'uuid'::regtype
    AND a.attnotnull AND NOT a.attisdropped;
  SELECT a.attnum INTO v_bill_id_att
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.debtfree_deleted_bill_ids'::regclass
    AND a.attname = 'bill_id' AND a.atttypid = 'text'::regtype
    AND a.attnotnull AND NOT a.attisdropped;

  IF v_debt_id_att IS NULL OR v_debt_user_att IS NULL OR v_bill_user_att IS NULL OR v_bill_id_att IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.debtfree_deleted_debt_ids'::regclass
         AND attname = 'deleted_at' AND atttypid = 'timestamp with time zone'::regtype
         AND attnotnull AND NOT attisdropped
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.debtfree_deleted_bill_ids'::regclass
         AND attname = 'deleted_at' AND atttypid = 'timestamp with time zone'::regtype
         AND attnotnull AND NOT attisdropped
     ) THEN
    RAISE EXCEPTION 'Unexpected debt or bill tombstone columns; review before migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = 'public.debtfree_deleted_debt_ids'::regclass
      AND c.contype = 'p'
      AND c.conkey = ARRAY[v_debt_id_att]::smallint[]
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = 'public.debtfree_deleted_bill_ids'::regclass
      AND c.contype = 'p'
      AND c.conkey = ARRAY[v_bill_user_att, v_bill_id_att]::smallint[]
  ) THEN
    RAISE EXCEPTION 'Unexpected tombstone primary key; preserve and review existing identity before migration';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid IN (
      'public.debtfree_deleted_debt_ids'::regclass,
      'public.debtfree_deleted_bill_ids'::regclass
    ) AND attname = 'household_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Unexpected existing tombstone household_id column; review migration drift';
  END IF;

  -- An ambiguous mapping aborts the entire transaction before columns or rows
  -- are changed. Do not select an arbitrary membership for historical data.
  IF EXISTS (
    SELECT 1
    FROM public.debtfree_deleted_debt_ids AS t
    LEFT JOIN _df_tombstone_owner_households AS o ON o.user_id = t.deleted_user_id
    LEFT JOIN public.households AS h ON h.id = o.household_id
    WHERE o.owner_count IS DISTINCT FROM 1::bigint OR h.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.debtfree_deleted_bill_ids AS t
    LEFT JOIN _df_tombstone_owner_households AS o ON o.user_id = t.user_id
    LEFT JOIN public.households AS h ON h.id = o.household_id
    WHERE o.owner_count IS DISTINCT FROM 1::bigint OR h.id IS NULL
  ) THEN
    RAISE EXCEPTION 'A tombstone lacks one proven active owner household; abort attribution and keep sharing disabled';
  END IF;
END
$migration$;

-- Keep the existing tombstone keys and values unchanged. These columns remain
-- nullable only during staging because the legacy writers do not pass household
-- IDs; the final authorization cutover must update writers and enforce NOT NULL
-- before any shared finance access is enabled.
ALTER TABLE public.debtfree_deleted_debt_ids
  ADD COLUMN household_id text;
ALTER TABLE public.debtfree_deleted_bill_ids
  ADD COLUMN household_id text;

UPDATE public.debtfree_deleted_debt_ids AS t
SET household_id = o.household_id
FROM _df_tombstone_owner_households AS o
WHERE o.user_id = t.deleted_user_id;

UPDATE public.debtfree_deleted_bill_ids AS t
SET household_id = o.household_id
FROM _df_tombstone_owner_households AS o
WHERE o.user_id = t.user_id;

ALTER TABLE public.debtfree_deleted_debt_ids
  ADD CONSTRAINT debtfree_deleted_debt_ids_household_id_fkey
  FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE RESTRICT;
ALTER TABLE public.debtfree_deleted_bill_ids
  ADD CONSTRAINT debtfree_deleted_bill_ids_household_id_fkey
  FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE RESTRICT;

CREATE INDEX debtfree_deleted_debt_ids_household_id_id_idx
  ON public.debtfree_deleted_debt_ids (household_id, id);
CREATE INDEX debtfree_deleted_bill_ids_household_id_bill_id_idx
  ON public.debtfree_deleted_bill_ids (household_id, bill_id);

COMMENT ON COLUMN public.debtfree_deleted_debt_ids.household_id IS
  'Staged household attribution for a deleted debt identity. Nullable only until the household finance-writer cutover; shared access must remain disabled until mandatory.';
COMMENT ON COLUMN public.debtfree_deleted_bill_ids.household_id IS
  'Staged household attribution for a deleted bill identity. Nullable only until the household finance-writer cutover; shared access must remain disabled until mandatory.';

COMMIT;
