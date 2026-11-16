-- DebtFree Native: server-validated revisions and deletion tombstones.
-- FOR SANDBOX REVIEW ONLY. Do not apply automatically.
-- Prerequisite: 20261105081000_secure_household_debts.sql must already be applied.
-- Existing debt rows retain their IDs, amounts and owners. Reset's existing DELETE
-- path remains supported; its removed IDs are tombstoned by the trigger.
BEGIN;

ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

-- Avoid silently accepting invalid revisions on preexisting rows.
ALTER TABLE public.debts
  ADD CONSTRAINT debts_version_positive CHECK (version >= 1);

CREATE OR REPLACE FUNCTION public.debtfree_increment_debt_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Debt owner and identity are immutable' USING ERRCODE = '23514';
  END IF;
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS debtfree_debt_revision ON public.debts;
CREATE TRIGGER debtfree_debt_revision
  BEFORE UPDATE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.debtfree_increment_debt_version();

-- Tombstones block stale clients from recreating a debt after it was deleted.
-- No auth.users FK: account removal must not be blocked by a tombstone insert.
CREATE TABLE IF NOT EXISTS public.debtfree_deleted_debt_ids (
  id uuid PRIMARY KEY,
  deleted_user_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.debtfree_deleted_debt_ids ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS debtfree_deleted_debt_ids_owner_select ON public.debtfree_deleted_debt_ids;
CREATE POLICY debtfree_deleted_debt_ids_owner_select
  ON public.debtfree_deleted_debt_ids FOR SELECT TO authenticated
  USING (deleted_user_id = (SELECT auth.uid()));

-- This trigger runs as the migration owner, avoiding a client INSERT grant to
-- tombstones. Policy above permits the owner to inspect their own tombstones.
CREATE OR REPLACE FUNCTION public.debtfree_debt_tombstone_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.debtfree_deleted_debt_ids (id, deleted_user_id)
    VALUES (OLD.id, OLD.user_id)
    ON CONFLICT (id) DO NOTHING;
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

-- Trigger execution does not require callers to have EXECUTE on this function.
-- Explicitly remove Supabase's role-specific default grants as well as PUBLIC.
REVOKE ALL ON FUNCTION public.debtfree_debt_tombstone_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS debtfree_debt_tombstone ON public.debts;
CREATE TRIGGER debtfree_debt_tombstone
  BEFORE INSERT OR DELETE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.debtfree_debt_tombstone_guard();

COMMIT;
