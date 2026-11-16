BEGIN;

CREATE FUNCTION public.debtfree_guard_transaction_bill_identity()
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
  -- ECMAScript whitespace, used by both \s and String.trim().
  v_space text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
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
    IF (TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NOT (v_bill_id COLLATE pg_catalog."C" = ANY(v_old_ids))
        OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL))
       AND EXISTS (
         SELECT 1 FROM public.debtfree_deleted_bill_ids AS retired
         WHERE retired.user_id = NEW.user_id AND retired.bill_id COLLATE pg_catalog."C" = v_bill_id COLLATE pg_catalog."C"
       ) THEN
      RAISE EXCEPTION 'Deleted recurring bill identity cannot be referenced' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_guard_transaction_bill_identity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER debtfree_guard_transaction_bill_identity
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.debtfree_guard_transaction_bill_identity();

COMMIT;
