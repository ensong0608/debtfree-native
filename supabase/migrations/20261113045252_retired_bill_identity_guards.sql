BEGIN;

CREATE TABLE public.debtfree_deleted_bill_ids (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bill_id text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (user_id, bill_id)
);

ALTER TABLE public.debtfree_deleted_bill_ids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.debtfree_deleted_bill_ids FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.debtfree_guard_bill_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     (NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'Recurring bill identity and owner cannot be changed' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.debtfree_deleted_bill_ids AS retired
    WHERE retired.user_id = NEW.user_id AND retired.bill_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Deleted recurring bill identity cannot be reused' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.debtfree_record_deleted_bill_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
    INSERT INTO public.debtfree_deleted_bill_ids (user_id, bill_id)
    VALUES (OLD.user_id, OLD.id)
    ON CONFLICT (user_id, bill_id) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_guard_bill_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debtfree_record_deleted_bill_identity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER debtfree_guard_bill_identity
  BEFORE INSERT OR UPDATE ON public.recurring_bills
  FOR EACH ROW EXECUTE FUNCTION public.debtfree_guard_bill_identity();

CREATE TRIGGER debtfree_record_deleted_bill_identity
  AFTER DELETE ON public.recurring_bills
  FOR EACH ROW EXECUTE FUNCTION public.debtfree_record_deleted_bill_identity();

COMMIT;
