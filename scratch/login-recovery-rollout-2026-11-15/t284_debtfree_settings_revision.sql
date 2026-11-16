CREATE OR REPLACE FUNCTION public.debtfree_settings_revision(profile jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE raw text;
BEGIN
  raw := profile ->> 'settingsRevision';
  IF raw IS NULL THEN RETURN 0; END IF;
  IF raw !~ '^(0|[1-9][0-9]{0,17})$' THEN
    RAISE EXCEPTION 'Invalid settings revision' USING ERRCODE = '22023';
  END IF;
  RETURN raw::bigint;
END;
$function$
