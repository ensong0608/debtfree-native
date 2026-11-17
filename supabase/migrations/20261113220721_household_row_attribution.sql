-- Source only: review before applying. Existing debt revisions advance on backfill.
BEGIN;

-- Freeze the mapping and linked rows throughout preflight and backfill.
LOCK TABLE public.households, public.household_members, public.debts,
  public.transactions, public.recurring_bills, public.reconciliation_anchors
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('debts', 'household_id'), ('transactions', 'household_id'),
    ('recurring_bills', 'household_id')
  ) AS v(tbl, col) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = pg_catalog.to_regclass('public.' || r.tbl)
        AND a.attname = r.col AND a.atttypid = 'text'::regtype
        AND NOT a.attnotnull AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'Unexpected %.% structure; expected nullable text', r.tbl, r.col;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.reconciliation_anchors'::regclass
      AND attname = 'household_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Unexpected reconciliation_anchors.household_id; review drift';
  END IF;
END $$;

ALTER TABLE public.reconciliation_anchors ADD COLUMN household_id text;

-- A mapping exists only when there is exactly one active owner membership.
CREATE TEMP TABLE attribution_owners ON COMMIT DROP AS
SELECT user_id, min(household_id) AS household_id, count(*) AS owner_count
FROM public.household_members
WHERE role = 'owner' AND status = 'active'
GROUP BY user_id;

DO $$
DECLARE r record; r_bad boolean;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('debts'), ('transactions'), ('recurring_bills'), ('reconciliation_anchors')
  ) AS v(tbl) LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = pg_catalog.to_regclass('public.' || r.tbl)
        AND attname = 'user_id' AND (attisdropped OR atttypid <> 'uuid'::regtype)) THEN
      RAISE EXCEPTION 'Unexpected %.user_id structure', r.tbl;
    END IF;
    EXECUTE pg_catalog.format(
      'SELECT EXISTS (SELECT 1 FROM public.%I f LEFT JOIN attribution_owners o ON o.user_id = f.user_id WHERE o.owner_count IS DISTINCT FROM 1::bigint OR (f.household_id IS NOT NULL AND f.household_id IS DISTINCT FROM o.household_id))', r.tbl
    ) INTO STRICT r_bad;
    IF r_bad THEN
      RAISE EXCEPTION 'Missing, ambiguous, or conflicting owner mapping in %', r.tbl;
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.transactions t
    LEFT JOIN public.debts d ON d.id = t.account_id
    LEFT JOIN attribution_owners t_owner ON t_owner.user_id = t.user_id
    LEFT JOIN attribution_owners d_owner ON d_owner.user_id = d.user_id
    WHERE t.account_id IS NOT NULL AND (d.id IS NULL OR t_owner.household_id IS DISTINCT FROM d_owner.household_id)
  ) OR EXISTS (
    SELECT 1 FROM public.recurring_bills b
    LEFT JOIN public.debts d ON d.id = b.credit_account_id
    LEFT JOIN attribution_owners b_owner ON b_owner.user_id = b.user_id
    LEFT JOIN attribution_owners d_owner ON d_owner.user_id = d.user_id
    WHERE b.credit_account_id IS NOT NULL AND (d.id IS NULL OR b_owner.household_id IS DISTINCT FROM d_owner.household_id)
  ) OR EXISTS (
    SELECT 1 FROM public.reconciliation_anchors a
    LEFT JOIN public.debts d ON d.id = a.account_id
    LEFT JOIN attribution_owners a_owner ON a_owner.user_id = a.user_id
    LEFT JOIN attribution_owners d_owner ON d_owner.user_id = d.user_id
    WHERE d.id IS NULL OR a_owner.household_id IS DISTINCT FROM d_owner.household_id
  ) THEN
    RAISE EXCEPTION 'Linked financial row and debt have different households or missing debt';
  END IF;
END $$;

UPDATE public.debts f SET household_id = o.household_id
FROM attribution_owners o WHERE f.user_id = o.user_id AND f.household_id IS NULL;
UPDATE public.transactions f SET household_id = o.household_id
FROM attribution_owners o WHERE f.user_id = o.user_id AND f.household_id IS NULL;
UPDATE public.recurring_bills f SET household_id = o.household_id
FROM attribution_owners o WHERE f.user_id = o.user_id AND f.household_id IS NULL;
UPDATE public.reconciliation_anchors f SET household_id = o.household_id
FROM attribution_owners o WHERE f.user_id = o.user_id AND f.household_id IS NULL;

ALTER TABLE public.debts ADD CONSTRAINT debts_household_attribution_fk
  FOREIGN KEY (household_id) REFERENCES public.households(id);
ALTER TABLE public.transactions ADD CONSTRAINT transactions_household_attribution_fk
  FOREIGN KEY (household_id) REFERENCES public.households(id);
ALTER TABLE public.recurring_bills ADD CONSTRAINT recurring_bills_household_attribution_fk
  FOREIGN KEY (household_id) REFERENCES public.households(id);
ALTER TABLE public.reconciliation_anchors ADD CONSTRAINT reconciliation_anchors_household_attribution_fk
  FOREIGN KEY (household_id) REFERENCES public.households(id);

ALTER TABLE public.debts ADD CONSTRAINT debts_id_household_attribution_key UNIQUE (id, household_id);
-- MATCH SIMPLE permits legacy writes with a null household; existing single-column
-- account FKs retain their original ON DELETE behavior.
ALTER TABLE public.transactions ADD CONSTRAINT transactions_account_household_fk
  FOREIGN KEY (account_id, household_id) REFERENCES public.debts(id, household_id)
  ON DELETE SET NULL (account_id);
ALTER TABLE public.recurring_bills ADD CONSTRAINT recurring_bills_account_household_fk
  FOREIGN KEY (credit_account_id, household_id) REFERENCES public.debts(id, household_id)
  ON DELETE SET NULL (credit_account_id);
ALTER TABLE public.reconciliation_anchors ADD CONSTRAINT reconciliation_anchors_account_household_fk
  FOREIGN KEY (account_id, household_id) REFERENCES public.debts(id, household_id)
  ON DELETE CASCADE;

CREATE INDEX debts_household_attribution_idx ON public.debts(household_id);
CREATE INDEX transactions_household_attribution_idx ON public.transactions(household_id, account_id);
CREATE INDEX recurring_bills_household_attribution_idx ON public.recurring_bills(household_id, credit_account_id);
CREATE INDEX reconciliation_anchors_household_attribution_idx ON public.reconciliation_anchors(household_id, account_id);

COMMIT;
