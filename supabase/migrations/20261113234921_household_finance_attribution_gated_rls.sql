-- Staged attribution and RLS only. Do not enable the cutover gate until every
-- finance writer, trigger, restore/reset path, and client has been replaced.
BEGIN;
LOCK TABLE auth.users, public.households, public.household_members,
  public.debtfree_household_cutover_gate, public.debts,
  public.debtfree_deleted_debt_ids, public.transactions, public.recurring_bills,
  public.debtfree_deleted_bill_ids, public.reconciliation_anchors
  IN SHARE ROW EXCLUSIVE MODE;

-- Sharing has not started. A null legacy row can be attributed only if its
-- actor has one active membership and that membership is the sole owned home.
CREATE TEMP TABLE _df_finance_owner_map ON COMMIT DROP AS
SELECT hm.user_id,
       min(hm.household_id) FILTER (WHERE hm.role = 'owner') AS household_id,
       count(*) FILTER (WHERE hm.role = 'owner') AS owner_count,
       count(*) AS active_count
FROM public.household_members hm
WHERE hm.status = 'active'
GROUP BY hm.user_id;

DO $preflight$
DECLARE r record; bad boolean; actor_att smallint; bill_att smallint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.debtfree_household_cutover_gate WHERE singleton AND NOT enabled)
     OR (SELECT count(*) FROM public.debtfree_household_cutover_gate) <> 1 THEN
    RAISE EXCEPTION 'The household finance cutover gate must remain disabled';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('debts','user_id'), ('transactions','user_id'), ('recurring_bills','user_id'),
    ('reconciliation_anchors','user_id'), ('debtfree_deleted_debt_ids','deleted_user_id'),
    ('debtfree_deleted_bill_ids','user_id')
  ) AS x(tbl, actor_col) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
       WHERE a.attrelid=pg_catalog.to_regclass('public.'||r.tbl) AND a.attname='household_id'
         AND a.atttypid='text'::regtype AND NOT a.attisdropped)
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
       WHERE a.attrelid=pg_catalog.to_regclass('public.'||r.tbl) AND a.attname=r.actor_col
         AND a.atttypid='uuid'::regtype AND a.attnotnull AND NOT a.attisdropped)
       OR (SELECT count(*) FROM pg_catalog.pg_constraint c
         JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attname=r.actor_col
         WHERE c.conrelid=pg_catalog.to_regclass('public.'||r.tbl) AND c.contype='f'
           AND c.confrelid='auth.users'::regclass AND c.conkey=ARRAY[a.attnum]::smallint[]) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
         JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attname=r.actor_col
         JOIN pg_catalog.pg_attribute b ON b.attrelid=c.confrelid AND b.attname='id'
         WHERE c.conrelid=pg_catalog.to_regclass('public.'||r.tbl) AND c.contype='f'
           AND c.confrelid='auth.users'::regclass AND c.confdeltype='c'
           AND c.conkey=ARRAY[a.attnum]::smallint[] AND c.confkey=ARRAY[b.attnum]::smallint[]) THEN
      RAISE EXCEPTION 'Unexpected actor or household schema in %; stop and review', r.tbl;
    END IF;
    EXECUTE pg_catalog.format(
      'SELECT EXISTS (SELECT 1 FROM public.%I f LEFT JOIN _df_finance_owner_map m ON m.user_id=f.%I LEFT JOIN public.households h ON h.id=m.household_id WHERE m.owner_count IS DISTINCT FROM 1::bigint OR h.id IS NULL OR (f.household_id IS NULL AND m.active_count IS DISTINCT FROM 1::bigint) OR (f.household_id IS NOT NULL AND f.household_id IS DISTINCT FROM m.household_id))',
      r.tbl,r.actor_col) INTO bad;
    IF bad THEN
      RAISE EXCEPTION 'Ambiguous or conflicting household attribution in %; keep sharing disabled',r.tbl;
    END IF;
  END LOOP;
  SELECT attnum INTO actor_att FROM pg_catalog.pg_attribute WHERE attrelid='public.debtfree_deleted_bill_ids'::regclass AND attname='user_id' AND NOT attisdropped;
  SELECT attnum INTO bill_att FROM pg_catalog.pg_attribute WHERE attrelid='public.debtfree_deleted_bill_ids'::regclass AND attname='bill_id' AND NOT attisdropped;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.debtfree_deleted_bill_ids'::regclass
       AND c.contype='p' AND c.conkey=ARRAY[actor_att,bill_att]::smallint[]) THEN
    RAISE EXCEPTION 'Unexpected deleted-bill primary key; preserve the legacy conflict identity';
  END IF;
  IF EXISTS (
    SELECT COALESCE(t.household_id,m.household_id),t.bill_id
    FROM public.debtfree_deleted_bill_ids t JOIN _df_finance_owner_map m ON m.user_id=t.user_id
    GROUP BY COALESCE(t.household_id,m.household_id),t.bill_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Deleted-bill identity collides within a household';
  END IF;
  -- Existing cross-domain references must resolve to the same household after
  -- the proposed backfill. Do this before the first update or DDL change.
  IF EXISTS (SELECT 1 FROM public.transactions t
    JOIN _df_finance_owner_map tm ON tm.user_id=t.user_id
    LEFT JOIN public.debts d ON d.id=t.account_id
    LEFT JOIN _df_finance_owner_map dm ON dm.user_id=d.user_id
    WHERE t.account_id IS NOT NULL AND (d.id IS NULL OR
      COALESCE(t.household_id,tm.household_id) IS DISTINCT FROM COALESCE(d.household_id,dm.household_id)))
   OR EXISTS (SELECT 1 FROM public.recurring_bills b
    JOIN _df_finance_owner_map bm ON bm.user_id=b.user_id
    LEFT JOIN public.debts d ON d.id=b.credit_account_id
    LEFT JOIN _df_finance_owner_map dm ON dm.user_id=d.user_id
    WHERE b.credit_account_id IS NOT NULL AND (d.id IS NULL OR
      COALESCE(b.household_id,bm.household_id) IS DISTINCT FROM COALESCE(d.household_id,dm.household_id)))
   OR EXISTS (SELECT 1 FROM public.reconciliation_anchors a
    JOIN _df_finance_owner_map am ON am.user_id=a.user_id
    LEFT JOIN public.debts d ON d.id=a.account_id
    LEFT JOIN _df_finance_owner_map dm ON dm.user_id=d.user_id
    WHERE d.id IS NULL OR COALESCE(a.household_id,am.household_id) IS DISTINCT FROM COALESCE(d.household_id,dm.household_id)) THEN
    RAISE EXCEPTION 'A linked finance record is missing its debt or crosses household boundaries';
  END IF;
END
$preflight$;

-- Existing debt revision triggers run on this update; backfilled debts receive
-- a new revision so stale pre-backfill writes fail rather than overwrite it.
UPDATE public.debts f SET household_id=m.household_id FROM _df_finance_owner_map m WHERE f.user_id=m.user_id AND f.household_id IS NULL;
UPDATE public.transactions f SET household_id=m.household_id FROM _df_finance_owner_map m WHERE f.user_id=m.user_id AND f.household_id IS NULL;
UPDATE public.recurring_bills f SET household_id=m.household_id FROM _df_finance_owner_map m WHERE f.user_id=m.user_id AND f.household_id IS NULL;
UPDATE public.reconciliation_anchors f SET household_id=m.household_id FROM _df_finance_owner_map m WHERE f.user_id=m.user_id AND f.household_id IS NULL;
UPDATE public.debtfree_deleted_debt_ids f SET household_id=m.household_id FROM _df_finance_owner_map m WHERE f.deleted_user_id=m.user_id AND f.household_id IS NULL;
UPDATE public.debtfree_deleted_bill_ids f SET household_id=m.household_id FROM _df_finance_owner_map m WHERE f.user_id=m.user_id AND f.household_id IS NULL;

-- Keep the legacy ON CONFLICT (user_id,bill_id) target used by the old bill
-- deletion trigger. The unique household key is staged now; final cutover
-- must require household_id and make that key primary after replacing writers.
ALTER TABLE public.debtfree_deleted_bill_ids DROP CONSTRAINT debtfree_deleted_bill_ids_pkey;
ALTER TABLE public.debtfree_deleted_bill_ids ADD CONSTRAINT debtfree_deleted_bill_ids_legacy_actor_key UNIQUE (user_id,bill_id);
ALTER TABLE public.debtfree_deleted_bill_ids ADD CONSTRAINT debtfree_deleted_bill_ids_household_key UNIQUE (household_id,bill_id);

DO $actor_fks$
DECLARE r record; fk_name text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('debts','user_id'), ('transactions','user_id'), ('recurring_bills','user_id'),
    ('reconciliation_anchors','user_id'), ('debtfree_deleted_debt_ids','deleted_user_id'),
    ('debtfree_deleted_bill_ids','user_id')
  ) AS x(tbl, actor_col) LOOP
    SELECT c.conname INTO STRICT fk_name FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attname=r.actor_col
      WHERE c.conrelid=pg_catalog.to_regclass('public.'||r.tbl) AND c.contype='f'
        AND c.confrelid='auth.users'::regclass AND c.conkey=ARRAY[a.attnum]::smallint[];
    EXECUTE pg_catalog.format('ALTER TABLE public.%I DROP CONSTRAINT %I',r.tbl,fk_name);
    EXECUTE pg_catalog.format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL',r.tbl,r.actor_col);
    EXECUTE pg_catalog.format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE SET NULL',r.tbl,fk_name,r.actor_col);
  END LOOP;
END
$actor_fks$;

-- Authenticated clients may use this function only as an RLS predicate. The
-- gate-off branch preserves existing actor-owned reads during staging. Null
-- attribution is never exposed when sharing is enabled. The final migration
-- must abort on any null row before enabling the gate.
CREATE FUNCTION public.debtfree_finance_select_allowed(p_household_id text,p_actor_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_actor uuid := (SELECT auth.uid()); v_enabled boolean; v_state text;
BEGIN
  IF v_actor IS NULL THEN RETURN false; END IF;
  SELECT enabled INTO v_enabled FROM public.debtfree_household_cutover_gate WHERE singleton;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_enabled THEN
    RETURN p_household_id IS NOT NULL AND public.debtfree_household_member_context_active(p_household_id);
  END IF;
  IF p_actor_id IS DISTINCT FROM v_actor THEN RETURN false; END IF;
  IF p_household_id IS NOT NULL THEN
    RETURN public.debtfree_household_member_context_active(p_household_id);
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('debtfree.account:'||v_actor::text,0));
  SELECT deletion_state INTO v_state FROM public.debtfree_account_lifecycle WHERE account_id=v_actor;
  RETURN FOUND AND v_state='active';
END
$function$;
REVOKE ALL ON FUNCTION public.debtfree_finance_select_allowed(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debtfree_finance_select_allowed(text,uuid) TO authenticated;

-- Abort on unexpected SELECT/ALL policies, since permissive policies combine
-- with OR and an unrecognized policy could bypass the staged predicate.
DO $policies$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('debts','debts_user_select'), ('transactions','transactions_user_select'),
    ('recurring_bills','recurring_bills_user_select'), ('reconciliation_anchors','reconciliation_anchors_user_select'),
    ('debtfree_deleted_debt_ids','debtfree_deleted_debt_ids_owner_select')
  ) AS x(tbl,policy_name) LOOP
    IF (SELECT count(*) FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename=r.tbl AND p.cmd IN ('SELECT','ALL')) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename=r.tbl
         AND p.policyname=r.policy_name AND p.cmd='SELECT' AND p.permissive='PERMISSIVE' AND p.roles=ARRAY['authenticated']::name[]) THEN
      RAISE EXCEPTION 'Unexpected finance SELECT policy inventory in %',r.tbl;
    END IF;
    EXECUTE pg_catalog.format('DROP POLICY %I ON public.%I',r.policy_name,r.tbl);
    EXECUTE pg_catalog.format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.debtfree_finance_select_allowed(household_id,%I))',
      r.policy_name,r.tbl,CASE WHEN r.tbl='debtfree_deleted_debt_ids' THEN 'deleted_user_id' ELSE 'user_id' END);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='debtfree_deleted_bill_ids' AND cmd IN ('SELECT','ALL')) THEN
    RAISE EXCEPTION 'Unexpected client-visible deleted-bill policy';
  END IF;
  CREATE POLICY debtfree_deleted_bill_ids_staged_select ON public.debtfree_deleted_bill_ids
    FOR SELECT TO authenticated USING (public.debtfree_finance_select_allowed(household_id,user_id));
END
$policies$;

-- The bill tombstone registry remains private; the staged policy does not
-- grant table access. Trusted RPC/trigger code retains its existing access.
REVOKE ALL ON TABLE public.debtfree_deleted_bill_ids FROM PUBLIC, anon, authenticated;

-- Deferred: replace actor-keyed finance mutex, debt/bill tombstone writers,
-- retired-bill and transaction identity guards, archive/unarchive triggers,
-- all finance RPCs and direct bill/anchor writes, restore receipts and reset,
-- account-history deletion, and all client caches/pending recovery. Then recheck
-- all null rows, revoke client DML, enforce household_id NOT NULL, promote the
-- household bill key to primary, and enable the gate in one reviewed cutover.
COMMIT;
