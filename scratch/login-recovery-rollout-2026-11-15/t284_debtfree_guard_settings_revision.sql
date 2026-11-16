CREATE OR REPLACE FUNCTION public.debtfree_guard_settings_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  old_profile jsonb;
  new_profile jsonb;
  before_revision bigint;
  after_revision bigint;
BEGIN
  old_profile := OLD.raw_user_meta_data -> 'debtfree_native_v1';
  new_profile := NEW.raw_user_meta_data -> 'debtfree_native_v1';
  IF new_profile IS NOT DISTINCT FROM old_profile THEN RETURN NEW; END IF;
  IF new_profile IS NULL OR jsonb_typeof(new_profile) <> 'object' THEN
    RAISE EXCEPTION 'DEBTFREE_SETTINGS_PROTECTED' USING ERRCODE = '23514';
  END IF;
  before_revision := public.debtfree_settings_revision(old_profile);
  after_revision := public.debtfree_settings_revision(new_profile);
  IF before_revision >= 9223372036854775806 THEN
    RAISE EXCEPTION 'Settings revision exhausted' USING ERRCODE = '22003';
  END IF;
  IF pg_catalog.current_setting('debtfree.settings_rpc_cas', true) = 'on' THEN
    IF after_revision <> before_revision + 1 THEN
      RAISE EXCEPTION 'DEBTFREE_SETTINGS_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'DEBTFREE_SETTINGS_PROTECTED: use atomic settings RPC' USING ERRCODE = '23514';
END;
$function$
