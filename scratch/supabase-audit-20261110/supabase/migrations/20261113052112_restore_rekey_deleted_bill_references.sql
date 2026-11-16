BEGIN;

CREATE OR REPLACE FUNCTION public.debtfree_bill_ids_for_transaction(p_id text, p_memo text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_ids text[] := ARRAY[]::text[];
  v_match text[];
  v_id text;
  v_space text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF pg_catalog.left(COALESCE(p_id, ''), 5) = 'bill:' THEN
    v_id := pg_catalog.split_part(p_id, ':', 2);
    IF v_id <> '' THEN v_ids := pg_catalog.array_append(v_ids, v_id); END IF;
  END IF;
  FOR v_match IN SELECT pg_catalog.regexp_matches(COALESCE(p_memo, '') COLLATE pg_catalog."C", $re$\[bill:([^\]:]+)(?::[^\]]*)?\]$re$, 'g') LOOP
    v_id := pg_catalog.btrim(v_match[1], v_space);
    IF v_id <> '' AND NOT (v_id = ANY(v_ids)) THEN v_ids := pg_catalog.array_append(v_ids, v_id); END IF;
  END LOOP;
  FOR v_match IN SELECT pg_catalog.regexp_matches(
    COALESCE(p_memo, '') COLLATE pg_catalog."C",
    '(^|[' || v_space || ',;:(])bill:([a-zA-Z0-9_-]+)(:[^' || v_space || ',;)\]]*)?', 'g'
  ) LOOP
    v_id := v_match[2];
    IF v_id <> '' AND NOT (v_id = ANY(v_ids)) THEN v_ids := pg_catalog.array_append(v_ids, v_id); END IF;
  END LOOP;
  RETURN v_ids;
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_bill_ids_for_transaction(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.debtfree_rewrite_bill_transaction_id(p_id text, p_map jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN pg_catalog.left(COALESCE(p_id, ''), 5) = 'bill:'
         AND COALESCE(p_map, '{}'::jsonb) ? pg_catalog.split_part(p_id, ':', 2)
    THEN 'bill:' || (p_map ->> pg_catalog.split_part(p_id, ':', 2))
         || pg_catalog.substr(p_id, 6 + pg_catalog.length(pg_catalog.split_part(p_id, ':', 2)))
    ELSE p_id
  END
$$;
REVOKE ALL ON FUNCTION public.debtfree_rewrite_bill_transaction_id(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.debtfree_rewrite_bill_memo(p_memo text, p_map jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_result text := p_memo;
  v_space text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_cursor integer;
  v_start integer;
  v_close integer;
  v_id_start integer;
  v_relative integer;
  v_content text;
  v_raw_id text;
  v_id_part text;
  v_old_id text;
  v_new_id text;
  v_suffix text;
  v_leading integer;
  v_trailing integer;
  v_id_length integer;
  v_boundary text;
BEGIN
  IF p_memo IS NULL THEN RETURN NULL; END IF;
  IF COALESCE(pg_catalog.jsonb_typeof(p_map), 'null') <> 'object' OR p_map = '{}'::jsonb THEN
    RETURN v_result;
  END IF;

  -- Bracket markers support the complete stored text ID, including separators.
  v_cursor := 1;
  LOOP
    v_relative := pg_catalog.strpos(pg_catalog.substr(v_result, v_cursor), '[bill:');
    EXIT WHEN v_relative = 0;
    v_start := v_cursor + v_relative - 1;
    v_id_start := v_start + 6;
    v_relative := pg_catalog.strpos(pg_catalog.substr(v_result, v_id_start), ']');
    IF v_relative = 0 THEN
      v_cursor := v_id_start;
      CONTINUE;
    END IF;
    v_close := v_id_start + v_relative - 1;
    v_content := pg_catalog.substr(v_result, v_id_start, v_close - v_id_start);
    v_relative := pg_catalog.strpos(v_content, ':');
    IF v_relative = 0 THEN
      v_raw_id := v_content;
      v_suffix := '';
    ELSE
      v_raw_id := pg_catalog.substr(v_content, 1, v_relative - 1);
      v_suffix := pg_catalog.substr(v_content, v_relative);
    END IF;
    v_old_id := pg_catalog.btrim(v_raw_id, v_space);
    IF v_old_id <> '' AND p_map ? v_old_id THEN
      v_new_id := p_map ->> v_old_id;
      v_leading := pg_catalog.length(v_raw_id) - pg_catalog.length(pg_catalog.ltrim(v_raw_id, v_space));
      v_trailing := pg_catalog.length(v_raw_id) - pg_catalog.length(pg_catalog.rtrim(v_raw_id, v_space));
      v_id_part := pg_catalog.substr(v_raw_id, 1, v_leading)
        || v_new_id
        || CASE WHEN v_trailing = 0 THEN '' ELSE pg_catalog.substr(v_raw_id, pg_catalog.length(v_raw_id) - v_trailing + 1, v_trailing) END;
      v_content := v_id_part || v_suffix;
      v_result := pg_catalog.substr(v_result, 1, v_id_start - 1)
        || v_content
        || pg_catalog.substr(v_result, v_close);
      v_cursor := v_id_start + pg_catalog.length(v_content) + 1;
    ELSE
      v_cursor := v_close + 1;
    END IF;
  END LOOP;

  -- Plain markers use the same exact token boundaries as bill identity parsing.
  v_cursor := 1;
  LOOP
    v_relative := pg_catalog.strpos(pg_catalog.substr(v_result, v_cursor), 'bill:');
    EXIT WHEN v_relative = 0;
    v_start := v_cursor + v_relative - 1;
    IF v_start > 1 THEN
      v_boundary := pg_catalog.substr(v_result, v_start - 1, 1);
      IF pg_catalog.strpos(v_space || ',;:(', v_boundary) = 0 THEN
        v_cursor := v_start + 5;
        CONTINUE;
      END IF;
    END IF;
    v_id_start := v_start + 5;
    v_id_length := 0;
    WHILE pg_catalog.substr(v_result, v_id_start + v_id_length, 1) ~ '^[A-Za-z0-9_-]$' LOOP
      v_id_length := v_id_length + 1;
    END LOOP;
    IF v_id_length = 0 THEN
      v_cursor := v_id_start;
      CONTINUE;
    END IF;
    v_old_id := pg_catalog.substr(v_result, v_id_start, v_id_length);
    IF p_map ? v_old_id THEN
      v_new_id := p_map ->> v_old_id;
      v_result := pg_catalog.substr(v_result, 1, v_id_start - 1)
        || v_new_id
        || pg_catalog.substr(v_result, v_id_start + v_id_length);
      v_cursor := v_id_start + pg_catalog.length(v_new_id);
    ELSE
      v_cursor := v_id_start + v_id_length;
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.debtfree_rewrite_bill_memo(text, jsonb) FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.debtfree_apply_snapshot_restore(
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
  v_uid uuid := (SELECT auth.uid());
  v_lock_key bigint;
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

  -- Server verified state
  v_household record;
  v_household_id text;
  v_currency text;
  v_scale integer;
  v_factor numeric;
  v_current_snapshot record;

  -- Settings CAS
  v_current_profile jsonb;
  v_current_settings_revision bigint;
  v_next_settings_revision bigint;
  v_normalized_settings jsonb;
  v_remapped_split_plans jsonb;

  -- Iterators & elements
  v_elem jsonb;
  v_id text;
  v_uuid uuid;
  v_item_currency text;
  v_minor_units bigint;
  v_amount numeric(18, 4);

  -- Debt variables
  v_debt_name text;
  v_debt_category text;
  v_debt_balance numeric(18, 4);
  v_debt_original numeric(18, 4);
  v_debt_apr numeric(6, 3);
  v_debt_min numeric(18, 4);
  v_debt_due integer;
  v_debt_limit numeric(18, 4);
  v_debt_created timestamptz;
  v_debt_exists boolean;

  -- Bill variables
  v_bill_name text;
  v_bill_cat text;
  v_bill_amount numeric(18, 4);
  v_bill_due integer;
  v_bill_method text;
  v_bill_credit_acct uuid;
  v_bill_autopost boolean;
  v_bill_active boolean;
  v_bill_created timestamptz;

  -- Transaction variables
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

  -- Anchor variables
  v_anchor_acct uuid;
  v_anchor_date date;
  v_anchor_balance numeric(18, 4);
  v_anchor_note text;
  v_anchor_adj text;
  v_anchor_created timestamptz;

  -- Sets for validation
  v_snapshot_debt_ids text[] := ARRAY[]::text[];
  v_snapshot_tx_ids text[] := ARRAY[]::text[];
  v_seen_ids text[] := ARRAY[]::text[];
  v_conflict_key text;
  v_domain text;
  v_old jsonb;

  -- Owner-scoped identity maps used to rekey imported rows without probing other users' IDs.
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

  -- Result
  v_final_snapshot record;
BEGIN
  PERFORM public.debtfree_lock_financial_user();
  -- --------------------------------------------------------------------------
  -- 1. Authentication & Argument Sanity
  -- --------------------------------------------------------------------------
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_operation_id IS NULL OR trim(p_operation_id) = '' OR length(p_operation_id) > 512 OR p_operation_id <> trim(p_operation_id) THEN
    RAISE EXCEPTION 'RESTORE_INVALID_OPERATION_ID: Operation ID is malformed or exceeds length limit'
      USING ERRCODE = '22023';
  END IF;

  IF p_payload_fingerprint IS NULL OR p_payload_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'RESTORE_INVALID_FINGERPRINT: Payload fingerprint must be a 64-character lowercase hex string'
      USING ERRCODE = '22023';
  END IF;

  IF p_expected_baseline_token IS NULL OR trim(p_expected_baseline_token) = '' OR length(p_expected_baseline_token) > 512 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_BASELINE_TOKEN: Baseline token is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('merge', 'replace') THEN
    RAISE EXCEPTION 'RESTORE_INVALID_MODE: Mode must be merge or replace'
      USING ERRCODE = '22023';
  END IF;

  IF p_mode = 'replace' THEN
    IF p_confirm_full_replacement IS NOT TRUE THEN
      RAISE EXCEPTION 'RESTORE_CONFIRMATION_REQUIRED: Full replacement and omission deletion requires explicit confirmation'
        USING ERRCODE = '22023';
    END IF;
    IF COALESCE(cardinality(p_accepted_conflict_ids), 0) > 0 OR COALESCE(cardinality(p_kept_current_conflict_ids), 0) > 0 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFLICTS: Replacement mode uses full confirmation, not per-conflict choices'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    -- Mode = 'merge'
    IF p_confirm_full_replacement IS TRUE THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFIRMATION: Merge mode does not permit full replacement confirmation'
        USING ERRCODE = '22023';
    END IF;
    -- Validate conflict key sets
    IF p_accepted_conflict_ids IS NULL OR p_kept_current_conflict_ids IS NULL THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFLICTS: Conflict choice arrays are required' USING ERRCODE = '22023';
    END IF;
    IF cardinality(p_accepted_conflict_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_accepted_conflict_ids) AS u(x))
       OR cardinality(p_kept_current_conflict_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_kept_current_conflict_ids) AS u(x)) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFLICTS: Conflict keys must be unique' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_accepted_conflict_ids || p_kept_current_conflict_ids) AS c(key)
      WHERE key !~ '^(onboardingData|debts|recurringBills|transactions|reconciliationAnchors):.+$' OR key <> trim(key) OR length(key)>1024) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFLICTS: Conflict keys must be domain-qualified IDs' USING ERRCODE = '22023';
    END IF;
    IF p_accepted_conflict_ids IS NOT NULL AND p_kept_current_conflict_ids IS NOT NULL THEN
      IF p_accepted_conflict_ids && p_kept_current_conflict_ids THEN
        RAISE EXCEPTION 'RESTORE_CONFLICT_OVERLAP: A conflict key cannot be both accepted and kept'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  IF p_snapshot IS NULL OR pg_catalog.jsonb_typeof(p_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'RESTORE_INVALID_PAYLOAD: Snapshot object is required'
      USING ERRCODE = '22023';
  END IF;
  v_original_snapshot := p_snapshot;

  -- --------------------------------------------------------------------------
  -- 2. Build Canonical Request Identity & Acquire Same-Op Advisory Lock
  -- --------------------------------------------------------------------------
  v_current_request_identity := pg_catalog.jsonb_build_object(
    'userId', v_uid::text,
    'expectedBaselineToken', p_expected_baseline_token,
    'mode', p_mode,
    'acceptedConflictIds', to_jsonb(COALESCE((SELECT array_agg(x ORDER BY x) FROM unnest(p_accepted_conflict_ids) AS x), ARRAY[]::text[])),
    'keptCurrentConflictIds', to_jsonb(COALESCE((SELECT array_agg(x ORDER BY x) FROM unnest(p_kept_current_conflict_ids) AS x), ARRAY[]::text[])),
    'confirmFullReplacement', COALESCE(p_confirm_full_replacement, false),
    'snapshot', p_snapshot
  );

  v_lock_key := ('x' || substr(md5(v_uid::text || ':' || p_operation_id), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Check existing receipt for this operation ID immediately after advisory lock
  SELECT operation_id, client_payload_fingerprint, request_identity, restored_snapshot
  INTO v_rec
  FROM public.debtfree_restore_receipts
  WHERE owner_user_id = v_uid AND operation_id = p_operation_id;

  IF FOUND THEN
    IF v_rec.request_identity = v_current_request_identity AND v_rec.client_payload_fingerprint = p_payload_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object(
        'operationId', p_operation_id,
        'payloadFingerprint', v_rec.client_payload_fingerprint,
        'restoredSnapshot', v_rec.restored_snapshot
      );
    ELSE
      RAISE EXCEPTION 'RESTORE_OPERATION_ID_REUSED: Operation ID is already bound to a different payload'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- --------------------------------------------------------------------------
  -- 3. Acquire Deterministic Global EXCLUSIVE NOWAIT Table Locks
  -- --------------------------------------------------------------------------
  BEGIN
    LOCK TABLE auth.users IN EXCLUSIVE MODE NOWAIT;
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

  -- Lock caller's auth row
  SELECT raw_user_meta_data INTO v_current_profile
  FROM auth.users
  WHERE id = v_uid FOR UPDATE NOWAIT;

  -- --------------------------------------------------------------------------
  -- 4. Server Household & Currency Verification + Stale Baseline Gate
  -- --------------------------------------------------------------------------
  SELECT * INTO v_household FROM public.debtfree_internal_verify_user_household(v_uid);
  v_household_id := v_household.r_household_id;
  v_currency := v_household.r_currency;
  v_scale := public.debtfree_internal_currency_scale(v_currency);
  v_factor := (10 ^ v_scale)::numeric;

  -- Re-read server snapshot & compute baseline token under the write gate
  SELECT * INTO v_current_snapshot FROM public.debtfree_internal_build_snapshot(v_uid, v_household_id, v_currency);

  IF v_current_snapshot.r_baseline_token IS DISTINCT FROM p_expected_baseline_token THEN
    RAISE EXCEPTION 'RESTORE_BASELINE_STALE: Current database state does not match expected baseline'
      USING ERRCODE = 'P0001';
  END IF;

  -- --------------------------------------------------------------------------
  -- 5. Deep Snapshot Payload Validation
  -- --------------------------------------------------------------------------
  IF p_snapshot ->> 'schema' IS DISTINCT FROM 'debtfree-native-backup'
     OR (p_snapshot ->> 'version')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_PAYLOAD: Unsupported backup schema or version' USING ERRCODE = '22023';
  END IF;

  IF p_snapshot ->> 'userId' IS DISTINCT FROM v_uid::text THEN
    RAISE EXCEPTION 'RESTORE_FOREIGN_OWNER: Backup belongs to a different user' USING ERRCODE = '42501';
  END IF;

  IF p_snapshot ->> 'householdId' IS DISTINCT FROM v_household_id THEN
    RAISE EXCEPTION 'RESTORE_HOUSEHOLD_MISMATCH: Backup belongs to a different household' USING ERRCODE = '42501';
  END IF;

  IF p_snapshot ->> 'currency' IS DISTINCT FROM v_currency THEN
    RAISE EXCEPTION 'RESTORE_CURRENCY_MISMATCH: Backup currency does not match household currency' USING ERRCODE = '22023';
  END IF;

  IF p_snapshot ->> 'exportedAt' IS NULL OR p_snapshot ->> 'exportedAt' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d' THEN
    RAISE EXCEPTION 'RESTORE_INVALID_TIMESTAMP: exportedAt timestamp is malformed' USING ERRCODE = '22023';
  END IF;

  -- Validate onboardingData
  v_elem := p_snapshot -> 'onboardingData';
  IF v_elem IS NULL OR pg_catalog.jsonb_typeof(v_elem) <> 'object'
     OR (v_elem ->> 'version')::integer IS DISTINCT FROM 1
     OR v_elem ->> 'userId' IS DISTINCT FROM v_uid::text
     OR v_elem ->> 'householdId' IS DISTINCT FROM v_household_id THEN
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

  -- Validate Debts Array
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

    -- Validate Category, APR, Minimum, Balance
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
  END LOOP;
  v_snapshot_debt_ids := v_seen_ids;

  -- Validate Recurring Bills Array
  IF p_snapshot -> 'recurringBills' IS NULL
     OR pg_catalog.jsonb_typeof(p_snapshot -> 'recurringBills') <> 'array'
     OR pg_catalog.jsonb_array_length(p_snapshot -> 'recurringBills') > 100000 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_BILLS: Missing or oversize recurringBills domain' USING ERRCODE = '22023';
  END IF;

  v_seen_ids := ARRAY[]::text[];
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'recurringBills')
  LOOP
    v_id := v_elem ->> 'id';
    IF v_id IS NULL OR trim(v_id) = '' OR length(v_id) > 512 OR v_id <> trim(v_id) THEN
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
    IF v_minor_units IS NULL OR v_minor_units <= 0 OR abs(v_minor_units) > 9007199254740991 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_BILL_AMOUNT: Recurring bill % amount must be positive safe integer', v_id USING ERRCODE = '22023';
    END IF;
    IF v_elem -> 'amount' ->> 'currency' IS DISTINCT FROM v_currency THEN
      RAISE EXCEPTION 'RESTORE_CURRENCY_MISMATCH: Bill % currency differs from %', v_id, v_currency USING ERRCODE = '22023';
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

  -- Validate Transactions Array
  IF p_snapshot -> 'transactions' IS NULL
     OR pg_catalog.jsonb_typeof(p_snapshot -> 'transactions') <> 'array'
     OR pg_catalog.jsonb_array_length(p_snapshot -> 'transactions') > 100000 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_TRANSACTIONS: Missing or oversize transactions domain' USING ERRCODE = '22023';
  END IF;

  v_seen_ids := ARRAY[]::text[];
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'transactions')
  LOOP
    v_id := v_elem ->> 'id';
    IF v_id IS NULL OR trim(v_id) = '' OR length(v_id) > 512 OR v_id <> trim(v_id) THEN
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
    IF v_minor_units IS NULL OR v_minor_units < 0 OR abs(v_minor_units) > 9007199254740991 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_TX_AMOUNT: Transaction % amount must be non-negative safe integer', v_id USING ERRCODE = '22023';
    END IF;
    IF v_elem -> 'amount' ->> 'currency' IS DISTINCT FROM v_currency THEN
      RAISE EXCEPTION 'RESTORE_CURRENCY_MISMATCH: Transaction % currency differs from %', v_id, v_currency USING ERRCODE = '22023';
    END IF;

    -- Validate Optional Allocations
    FOR v_item_currency IN SELECT unnest(ARRAY['principalAmount','interestAmount','escrowAmount','feeAmount'])
    LOOP
      IF v_elem ? v_item_currency AND v_elem -> v_item_currency IS NOT NULL AND pg_catalog.jsonb_typeof(v_elem -> v_item_currency) = 'object' THEN
        v_minor_units := (v_elem -> v_item_currency ->> 'minorUnits')::bigint;
        IF v_minor_units IS NULL OR v_minor_units < 0 OR abs(v_minor_units) > 9007199254740991 THEN
          RAISE EXCEPTION 'RESTORE_INVALID_ALLOCATION: Allocation % on transaction % must be non-negative safe integer', v_item_currency, v_id USING ERRCODE = '22023';
        END IF;
        IF v_elem -> v_item_currency ->> 'currency' IS DISTINCT FROM v_currency THEN
          RAISE EXCEPTION 'RESTORE_CURRENCY_MISMATCH: Allocation currency on transaction % differs from %', v_id, v_currency USING ERRCODE = '22023';
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  v_snapshot_tx_ids := v_seen_ids;

  -- Validate Reconciliation Anchors Array
  IF p_snapshot -> 'reconciliationAnchors' IS NULL
     OR pg_catalog.jsonb_typeof(p_snapshot -> 'reconciliationAnchors') <> 'array'
     OR pg_catalog.jsonb_array_length(p_snapshot -> 'reconciliationAnchors') > 100000 THEN
    RAISE EXCEPTION 'RESTORE_INVALID_ANCHORS: Missing or oversize reconciliationAnchors domain' USING ERRCODE = '22023';
  END IF;

  v_seen_ids := ARRAY[]::text[];
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'reconciliationAnchors')
  LOOP
    v_id := v_elem ->> 'id';
    IF v_id IS NULL OR trim(v_id) = '' OR length(v_id) > 512 OR v_id <> trim(v_id) THEN
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
    IF v_minor_units IS NULL OR abs(v_minor_units) > 9007199254740991 THEN
      RAISE EXCEPTION 'RESTORE_INVALID_ANCHOR_BALANCE: Anchor % verifiedBalance must be safe integer', v_id USING ERRCODE = '22023';
    END IF;
    IF v_elem -> 'verifiedBalance' ->> 'currency' IS DISTINCT FROM v_currency THEN
      RAISE EXCEPTION 'RESTORE_CURRENCY_MISMATCH: Anchor % currency differs from %', v_id, v_currency USING ERRCODE = '22023';
    END IF;

    -- Created Adjustment Relationship
    IF v_elem ? 'createdAdjustmentId' AND v_elem ->> 'createdAdjustmentId' IS NOT NULL THEN
      v_id := v_elem ->> 'createdAdjustmentId';
      IF NOT (v_id = ANY(v_snapshot_tx_ids)) THEN
        RAISE EXCEPTION 'RESTORE_ORPHAN_ANCHOR_ADJUSTMENT: Anchor references nonexistent adjustment transaction %', v_id USING ERRCODE = '23503';
      END IF;
    END IF;

    -- Explicit Reject of Non-Empty coveredTransactionIds (Protocol v1 limitation)
    IF v_elem ? 'coveredTransactionIds' AND v_elem -> 'coveredTransactionIds' IS NOT NULL THEN
      IF pg_catalog.jsonb_array_length(v_elem -> 'coveredTransactionIds') > 0 THEN
        RAISE EXCEPTION 'RESTORE_UNSUPPORTED_COVERAGE: Non-empty coveredTransactionIds is unsupported in restore v1'
          USING ERRCODE = '0A000';
      END IF;
    END IF;
  END LOOP;

  -- Resolve merge choices from the untouched import and the locked server baseline.
  -- The RPC receives the original backup, not a client-resolved snapshot; it creates
  -- the selected result itself before any identity map or write is applied.
  IF p_mode = 'merge' THEN
    v_resolved_snapshot := v_current_snapshot.r_snapshot;
    v_conflict_key := 'onboardingData:' || v_uid::text;
    -- Keep the established conflict contract for local checkpoints: every
    -- onboarding setting except the separately merged debt rows participates.
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
      SELECT 'onboardingData:' || v_uid::text WHERE v_settings_conflict
    ), choices AS (
      SELECT choice.key FROM unnest(p_accepted_conflict_ids || p_kept_current_conflict_ids) AS choice(key)
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

  -- Rekey imported identities that are not already owned by this caller.
  -- This preserves IDs for merge/update of the caller's rows, while new rows,
  -- foreign-ID collisions and retired bill IDs receive fresh IDs. The original
  -- request identity above remains bound to the raw imported backup and choices.
  -- A caller-owned debt tombstone remains a hard rejection; the lookup is owner-scoped.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'onboardingData' -> 'debts') AS item(value)
    JOIN public.debtfree_deleted_debt_ids AS tombstone
      ON tombstone.id = (item.value ->> 'id')::uuid
    WHERE tombstone.deleted_user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'RESTORE_TOMBSTONED_DEBT_ID: A deleted debt identity cannot be restored'
      USING ERRCODE = '23505';
  END IF;

  WITH incoming AS MATERIALIZED (
    SELECT item.value,
           item.ordinality,
           item.value ->> 'id' AS old_id,
           CASE WHEN EXISTS (
             SELECT 1 FROM public.debts AS owned
             WHERE owned.id = (item.value ->> 'id')::uuid AND owned.user_id = v_uid
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
    SELECT item.value,
           item.ordinality,
           item.value ->> 'id' AS old_id,
           CASE
             WHEN EXISTS (
               SELECT 1 FROM public.debtfree_deleted_bill_ids AS retired
               WHERE retired.user_id = v_uid AND retired.bill_id = item.value ->> 'id'
             ) THEN pg_catalog.gen_random_uuid()::text
             WHEN EXISTS (
               SELECT 1 FROM public.recurring_bills AS owned
               WHERE owned.id::text = (item.value ->> 'id') AND owned.user_id = v_uid
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
  -- Keep original bill IDs in the resolved rows until the exact marker rewrite
  -- below; the separate map changes only the technical identity references.

  WITH incoming AS MATERIALIZED (
    SELECT item.value,
           item.ordinality,
           item.value ->> 'id' AS old_id,
           CASE WHEN EXISTS (
             SELECT 1 FROM public.transactions AS owned
             WHERE owned.id::text = (item.value ->> 'id') AND owned.user_id = v_uid
           ) THEN item.value ->> 'id' ELSE pg_catalog.gen_random_uuid()::text END AS new_id
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
    SELECT item.value,
           item.ordinality,
           CASE WHEN EXISTS (
             SELECT 1 FROM public.reconciliation_anchors AS owned
             WHERE owned.id::text = (item.value ->> 'id') AND owned.user_id = v_uid
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
  -- Merge choices were resolved from the raw import and locked baseline before identity rekey.
  --

  -- Rekey bill references only after merge choices have been checked against
  -- the original IDs. Reject a retired marker when its bill was not imported.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'transactions') AS tx(value)
    CROSS JOIN LATERAL pg_catalog.unnest(
      public.debtfree_bill_ids_for_transaction(tx.value ->> 'id', tx.value ->> 'memo')
    ) AS marker(bill_id)
    JOIN public.debtfree_deleted_bill_ids AS retired
      ON retired.user_id = v_uid AND retired.bill_id = marker.bill_id
    WHERE NOT (v_bill_id_map ? marker.bill_id)
  ) THEN
    RAISE EXCEPTION 'RESTORE_RETIRED_BILL_REFERENCE: A retired bill reference has no imported bill identity'
      USING ERRCODE = '23505';
  END IF;

  p_snapshot := pg_catalog.jsonb_set(p_snapshot, ARRAY['recurringBills'], v_remapped_bills, false);
  v_original_tx_id_map := v_tx_id_map;

  FOR v_ref IN
    SELECT item.value ->> 'id' AS original_id
    FROM pg_catalog.jsonb_array_elements(v_current_request_identity -> 'snapshot' -> 'transactions')
      AS item(value)
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
  FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'transactions')
    WITH ORDINALITY AS item(value, ordinality);
  p_snapshot := pg_catalog.jsonb_set(p_snapshot, ARRAY['transactions'], v_remapped_array, false);

  -- Detect an occupied target before changing any accepted/current row.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_each_text(v_rekeyed_tx_id_map) AS remap(old_id, new_id)
    JOIN public.transactions AS occupied
      ON occupied.id = remap.new_id AND occupied.id <> remap.old_id
  ) THEN
    RAISE EXCEPTION 'RESTORE_BILL_REKEY_COLLISION: A transaction identity target is already occupied'
      USING ERRCODE = '23505';
  END IF;

  -- Move only transaction rows selected in this restore payload. Updating the
  -- same row preserves ledger history and avoids a duplicate imported payment.
  UPDATE public.transactions AS current_tx
  SET id = remap.new_id,
      memo = public.debtfree_rewrite_bill_memo(current_tx.memo, v_bill_id_map)
  FROM pg_catalog.jsonb_each_text(v_original_tx_id_map) AS selected(original_id, current_id)
  JOIN pg_catalog.jsonb_each_text(v_rekeyed_tx_id_map) AS remap(old_id, new_id)
    ON remap.old_id = selected.current_id
  WHERE current_tx.user_id = v_uid
    AND current_tx.id = selected.current_id
    AND (current_tx.id IS DISTINCT FROM remap.new_id
         OR current_tx.memo IS DISTINCT FROM public.debtfree_rewrite_bill_memo(current_tx.memo, v_bill_id_map));

  UPDATE public.reconciliation_anchors AS anchor
  SET created_adjustment_id = remap.new_id
  FROM pg_catalog.jsonb_each_text(v_rekeyed_tx_id_map) AS remap(old_id, new_id)
  WHERE anchor.user_id = v_uid AND anchor.created_adjustment_id = remap.old_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    CASE WHEN item.value ->> 'createdAdjustmentId' IS NULL THEN item.value
         ELSE pg_catalog.jsonb_set(item.value, ARRAY['createdAdjustmentId'],
           pg_catalog.to_jsonb(COALESCE(v_rekeyed_tx_id_map ->> (item.value ->> 'createdAdjustmentId'),
                                      item.value ->> 'createdAdjustmentId')), false)
    END ORDER BY item.ordinality
  ), '[]'::jsonb)
  INTO v_remapped_array
  FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'reconciliationAnchors')
    WITH ORDINALITY AS item(value, ordinality);
  p_snapshot := pg_catalog.jsonb_set(p_snapshot, ARRAY['reconciliationAnchors'], v_remapped_array, false);

  -- --------------------------------------------------------------------------
  -- 6. Execute Atomic Mutations
  -- --------------------------------------------------------------------------

  -- In merge mode, a tombstoned bill row may still exist because of an
  -- interrupted legacy cleanup. Retire it before inserting its fresh identity.
  IF p_mode = 'merge' THEN
    DELETE FROM public.recurring_bills AS current_bill
    USING pg_catalog.jsonb_each_text(v_bill_id_map) AS remap(old_id, new_id)
    WHERE current_bill.user_id = v_uid
      AND current_bill.id::text = remap.old_id
      AND remap.old_id IS DISTINCT FROM remap.new_id
      AND EXISTS (
        SELECT 1 FROM public.debtfree_deleted_bill_ids AS retired
        WHERE retired.user_id = v_uid AND retired.bill_id = remap.old_id
      );
  END IF;

  -- 6a. Deletion Phase (Replace Mode Only) - Dependents First Order
  IF p_mode = 'replace' THEN
    -- 1. Transactions
    DELETE FROM public.transactions
    WHERE user_id = v_uid AND id NOT IN (
      SELECT elem ->> 'id' FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'transactions') elem
    );

    -- 2. Reconciliation Anchors
    DELETE FROM public.reconciliation_anchors
    WHERE user_id = v_uid AND id NOT IN (
      SELECT elem ->> 'id' FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'reconciliationAnchors') elem
    );

    -- 3. Recurring Bills
    DELETE FROM public.recurring_bills
    WHERE user_id = v_uid AND id NOT IN (
      SELECT elem ->> 'id' FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'recurringBills') elem
    );

    -- 4. Debts (Omitted live debts get deleted & tombstoned by debtfree_debt_tombstone trigger)
    DELETE FROM public.debts
    WHERE user_id = v_uid AND id NOT IN (
      SELECT (elem ->> 'id')::uuid FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'onboardingData' -> 'debts') elem
    );
  END IF;

  -- 6b. Settings Profile CAS Update
  v_current_settings_revision := public.debtfree_settings_revision(v_current_profile -> 'debtfree_native_v1');
  v_next_settings_revision := v_current_settings_revision + 1;

  v_normalized_settings := pg_catalog.jsonb_set(
    ((p_snapshot -> 'onboardingData') - 'settingsRevision'::text - 'debts'::text) || '{"debts":[]}'::jsonb,
    '{settingsRevision}',
    pg_catalog.to_jsonb(v_next_settings_revision),
    true
  );
  -- Technical settings references follow exact server-generated identity maps.
  -- Keep unrelated and stale keys intact; only mapped IDs change.
  IF pg_catalog.jsonb_typeof(v_normalized_settings -> 'debtPaymentSplitPlansByDebtId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(
      COALESCE(v_debt_id_map ->> plan.key, plan.key), plan.value
    ), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_normalized_settings -> 'debtPaymentSplitPlansByDebtId') AS plan(key, value);
    v_normalized_settings := pg_catalog.jsonb_set(
      v_normalized_settings,
      '{debtPaymentSplitPlansByDebtId}',
      v_remapped_split_plans,
      true
    );
  END IF;
  IF pg_catalog.jsonb_typeof(v_normalized_settings -> 'billPaymentSplitPlansByBillId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(
      COALESCE(v_bill_id_map ->> plan.key, plan.key), plan.value
    ), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_normalized_settings -> 'billPaymentSplitPlansByBillId') AS plan(key, value);
    v_normalized_settings := pg_catalog.jsonb_set(
      v_normalized_settings,
      '{billPaymentSplitPlansByBillId}',
      v_remapped_split_plans,
      true
    );
  END IF;
  IF pg_catalog.jsonb_typeof(v_normalized_settings -> 'loanBillPairingByDebtId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(
      COALESCE(v_debt_id_map ->> pair.key, pair.key),
      CASE WHEN pg_catalog.jsonb_typeof(pair.value) = 'object'
                 AND pair.value ? 'billId'
           THEN pg_catalog.jsonb_set(pair.value, ARRAY['billId'],
             pg_catalog.to_jsonb(COALESCE(v_bill_id_map ->> (pair.value ->> 'billId'), pair.value ->> 'billId')), false)
           ELSE pair.value END
    ), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_normalized_settings -> 'loanBillPairingByDebtId') AS pair(key, value);
    v_normalized_settings := pg_catalog.jsonb_set(v_normalized_settings,
      ARRAY['loanBillPairingByDebtId'], v_remapped_split_plans, true);
  END IF;

  IF pg_catalog.jsonb_typeof(v_normalized_settings -> 'recurringBillCategoryLabelByBillId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(
      COALESCE(v_bill_id_map ->> label.key, label.key), label.value
    ), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_normalized_settings -> 'recurringBillCategoryLabelByBillId') AS label(key, value);
    v_normalized_settings := pg_catalog.jsonb_set(v_normalized_settings,
      ARRAY['recurringBillCategoryLabelByBillId'], v_remapped_split_plans, true);
  END IF;

  IF pg_catalog.jsonb_typeof(v_normalized_settings -> 'obligationSchedules') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(
      CASE
        WHEN pg_catalog.left(schedule.key, 5) = 'debt:' THEN 'debt:' || COALESCE(v_debt_id_map ->> pg_catalog.substr(schedule.key, 6), pg_catalog.substr(schedule.key, 6))
        WHEN pg_catalog.left(schedule.key, 5) = 'bill:' THEN 'bill:' || COALESCE(v_bill_id_map ->> pg_catalog.substr(schedule.key, 6), pg_catalog.substr(schedule.key, 6))
        ELSE schedule.key
      END, schedule.value
    ), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_normalized_settings -> 'obligationSchedules') AS schedule(key, value);
    v_normalized_settings := pg_catalog.jsonb_set(v_normalized_settings,
      ARRAY['obligationSchedules'], v_remapped_split_plans, true);
  END IF;

  IF pg_catalog.jsonb_typeof(v_normalized_settings -> 'mortgageEscrowByDebtId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(
      COALESCE(v_debt_id_map ->> setting.key, setting.key), setting.value
    ), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_normalized_settings -> 'mortgageEscrowByDebtId') AS setting(key, value);
    v_normalized_settings := pg_catalog.jsonb_set(v_normalized_settings,
      ARRAY['mortgageEscrowByDebtId'], v_remapped_split_plans, true);
  END IF;

  IF pg_catalog.jsonb_typeof(v_normalized_settings -> 'mortgageExtraPaymentByDebtId') = 'object' THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(
      COALESCE(v_debt_id_map ->> setting.key, setting.key), setting.value
    ), '{}'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_each(v_normalized_settings -> 'mortgageExtraPaymentByDebtId') AS setting(key, value);
    v_normalized_settings := pg_catalog.jsonb_set(v_normalized_settings,
      ARRAY['mortgageExtraPaymentByDebtId'], v_remapped_split_plans, true);
  END IF;

  IF pg_catalog.jsonb_typeof(v_normalized_settings -> 'archivedPaidOffDebtIds') = 'array' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(mapped.debt_id) ORDER BY archived.ordinality), '[]'::jsonb)
    INTO v_remapped_split_plans
    FROM pg_catalog.jsonb_array_elements_text(v_normalized_settings -> 'archivedPaidOffDebtIds')
      WITH ORDINALITY AS archived(source_id, ordinality)
    CROSS JOIN LATERAL (
      SELECT COALESCE(v_debt_id_map ->> archived.source_id, archived.source_id) AS debt_id
    ) AS mapped
    WHERE EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'onboardingData' -> 'debts') AS debt(value)
      WHERE debt.value ->> 'id' = mapped.debt_id
        AND (debt.value ->> 'balance')::numeric(18, 4) = 0
    );
    v_normalized_settings := pg_catalog.jsonb_set(
      v_normalized_settings,
      '{archivedPaidOffDebtIds}',
      v_remapped_split_plans,
      true
    );
  END IF;

  v_normalized_settings := pg_catalog.jsonb_set(
    v_normalized_settings,
    '{updatedAt}',
    pg_catalog.to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    true
  );

  PERFORM pg_catalog.set_config('debtfree.settings_rpc_cas', 'on', true);

  UPDATE auth.users
  SET raw_user_meta_data = pg_catalog.jsonb_set(
    COALESCE(raw_user_meta_data, '{}'::jsonb),
    '{debtfree_native_v1}',
    v_normalized_settings,
    true
  )
  WHERE id = v_uid;
  PERFORM pg_catalog.set_config('debtfree.settings_rpc_cas', 'off', true);

  -- 6c. Upsert Debts (Existing debts updated in-place to fire version increment; new start at version 1)
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'onboardingData' -> 'debts')
  LOOP
    v_uuid := (v_elem ->> 'id')::uuid;
    v_debt_name := trim(v_elem ->> 'name');
    v_debt_category := v_elem ->> 'category';
    v_debt_balance := (v_elem ->> 'balance')::numeric(18, 4);
    v_debt_original := NULLIF(v_elem ->> 'originalBalance', '')::numeric(18, 4);
    v_debt_apr := (v_elem ->> 'apr')::numeric(6, 3);
    v_debt_min := (v_elem ->> 'minimumPayment')::numeric(18, 4);
    v_debt_due := NULLIF(v_elem ->> 'dueDay', '')::integer;
    v_debt_limit := NULLIF(v_elem ->> 'creditLimit', '')::numeric(18, 4);
    v_debt_created := (v_elem ->> 'createdAt')::timestamptz;

    SELECT EXISTS (SELECT 1 FROM public.debts WHERE id = v_uuid AND user_id = v_uid) INTO v_debt_exists;

    IF v_debt_exists THEN
      -- In-place update triggers debtfree_debt_revision (NEW.version := OLD.version + 1)
      UPDATE public.debts SET
        household_id = v_household_id,
        name = v_debt_name,
        category = v_debt_category,
        balance = v_debt_balance,
        original_balance = v_debt_original,
        apr = v_debt_apr,
        minimum_payment = v_debt_min,
        due_day = v_debt_due,
        credit_limit = v_debt_limit,
        updated_at = now()
      WHERE id = v_uuid AND user_id = v_uid;
    ELSE
      -- New debt inserted with initial version = 1
      INSERT INTO public.debts (
        id, user_id, household_id, name, category, balance,
        original_balance, apr, minimum_payment, due_day, credit_limit,
        created_at, updated_at, version
      ) VALUES (
        v_uuid, v_uid, v_household_id, v_debt_name, v_debt_category, v_debt_balance,
        v_debt_original, v_debt_apr, v_debt_min, v_debt_due, v_debt_limit,
        v_debt_created, now(), 1
      );
    END IF;
  END LOOP;

  -- 6d. Upsert Recurring Bills
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'recurringBills')
  LOOP
    v_id := v_elem ->> 'id';
    v_bill_name := trim(v_elem ->> 'name');
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
      v_id, v_uid, v_household_id, v_bill_name, v_bill_cat, v_bill_amount, v_bill_due,
      v_bill_method, v_bill_credit_acct, v_bill_autopost, v_bill_active, v_bill_created, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      household_id = v_household_id,
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      amount = EXCLUDED.amount,
      due_day = EXCLUDED.due_day,
      payment_method = EXCLUDED.payment_method,
      credit_account_id = EXCLUDED.credit_account_id,
      auto_post = EXCLUDED.auto_post,
      active = EXCLUDED.active,
      updated_at = now()
    WHERE recurring_bills.user_id = v_uid;
  END LOOP;

  -- 6e. Upsert Transactions Ledger (Historical insertion without balance-delta replay)
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'transactions')
  LOOP
    v_id := v_elem ->> 'id';
    v_tx_acct := NULLIF(v_elem ->> 'accountId', '')::uuid;
    v_tx_date := (v_elem ->> 'date')::date;
    v_tx_applies := NULLIF(v_elem ->> 'appliesToDate', '')::date;
    v_minor_units := (v_elem -> 'amount' ->> 'minorUnits')::bigint;
    v_tx_amount := (v_minor_units::numeric / v_factor)::numeric(18, 4);
    v_tx_cat := v_elem ->> 'category';
    v_tx_payee := trim(v_elem ->> 'payee');
    v_tx_memo := NULLIF(trim(v_elem ->> 'memo'), '');
    v_tx_source := COALESCE(v_elem ->> 'source', 'manual');
    v_tx_reconciled := COALESCE((v_elem ->> 'reconciled')::boolean, false);
    v_tx_created := (v_elem ->> 'createdAt')::timestamptz;
    v_tx_deleted := NULLIF(v_elem ->> 'deletedAt', '')::timestamptz;

    IF v_elem ? 'principalAmount' AND v_elem -> 'principalAmount' IS NOT NULL AND pg_catalog.jsonb_typeof(v_elem -> 'principalAmount') = 'object' THEN
      v_tx_principal := ((v_elem -> 'principalAmount' ->> 'minorUnits')::bigint::numeric / v_factor)::numeric(18, 4);
    ELSE
      v_tx_principal := NULL;
    END IF;

    IF v_elem ? 'interestAmount' AND v_elem -> 'interestAmount' IS NOT NULL AND pg_catalog.jsonb_typeof(v_elem -> 'interestAmount') = 'object' THEN
      v_tx_interest := ((v_elem -> 'interestAmount' ->> 'minorUnits')::bigint::numeric / v_factor)::numeric(18, 4);
    ELSE
      v_tx_interest := NULL;
    END IF;

    IF v_elem ? 'escrowAmount' AND v_elem -> 'escrowAmount' IS NOT NULL AND pg_catalog.jsonb_typeof(v_elem -> 'escrowAmount') = 'object' THEN
      v_tx_escrow := ((v_elem -> 'escrowAmount' ->> 'minorUnits')::bigint::numeric / v_factor)::numeric(18, 4);
    ELSE
      v_tx_escrow := NULL;
    END IF;

    IF v_elem ? 'feeAmount' AND v_elem -> 'feeAmount' IS NOT NULL AND pg_catalog.jsonb_typeof(v_elem -> 'feeAmount') = 'object' THEN
      v_tx_fee := ((v_elem -> 'feeAmount' ->> 'minorUnits')::bigint::numeric / v_factor)::numeric(18, 4);
    ELSE
      v_tx_fee := NULL;
    END IF;

    INSERT INTO public.transactions (
      id, user_id, household_id, account_id, date, applies_to_date,
      amount, category, payee, memo, source, reconciled,
      created_at, updated_at, deleted_at, principal_amount,
      interest_amount, escrow_amount, fee_amount
    ) VALUES (
      v_id, v_uid, v_household_id, v_tx_acct, v_tx_date, v_tx_applies,
      v_tx_amount, v_tx_cat, v_tx_payee, v_tx_memo, v_tx_source, v_tx_reconciled,
      v_tx_created, now(), v_tx_deleted, v_tx_principal,
      v_tx_interest, v_tx_escrow, v_tx_fee
    )
    ON CONFLICT (id) DO UPDATE SET
      household_id = v_household_id,
      account_id = EXCLUDED.account_id,
      date = EXCLUDED.date,
      applies_to_date = EXCLUDED.applies_to_date,
      amount = EXCLUDED.amount,
      category = EXCLUDED.category,
      payee = EXCLUDED.payee,
      memo = EXCLUDED.memo,
      source = EXCLUDED.source,
      reconciled = EXCLUDED.reconciled,
      updated_at = now(),
      deleted_at = EXCLUDED.deleted_at,
      principal_amount = EXCLUDED.principal_amount,
      interest_amount = EXCLUDED.interest_amount,
      escrow_amount = EXCLUDED.escrow_amount,
      fee_amount = EXCLUDED.fee_amount
    WHERE transactions.user_id = v_uid;
  END LOOP;

  -- 6f. Upsert Reconciliation Anchors
  FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'reconciliationAnchors')
  LOOP
    v_id := v_elem ->> 'id';
    v_anchor_acct := (v_elem ->> 'accountId')::uuid;
    v_anchor_date := (v_elem ->> 'asOfDate')::date;
    v_minor_units := (v_elem -> 'verifiedBalance' ->> 'minorUnits')::bigint;
    v_anchor_balance := (v_minor_units::numeric / v_factor)::numeric(18, 4);
    v_anchor_note := NULLIF(trim(v_elem ->> 'note'), '');
    v_anchor_adj := NULLIF(v_elem ->> 'createdAdjustmentId', '');
    v_anchor_created := (v_elem ->> 'createdAt')::timestamptz;

    INSERT INTO public.reconciliation_anchors (
      id, user_id, account_id, as_of_date, verified_balance, note,
      created_at, created_adjustment_id
    ) VALUES (
      v_id, v_uid, v_anchor_acct, v_anchor_date, v_anchor_balance, v_anchor_note,
      v_anchor_created, v_anchor_adj
    )
    ON CONFLICT (id) DO UPDATE SET
      account_id = EXCLUDED.account_id,
      as_of_date = EXCLUDED.as_of_date,
      verified_balance = EXCLUDED.verified_balance,
      note = EXCLUDED.note,
      created_adjustment_id = EXCLUDED.created_adjustment_id
    WHERE reconciliation_anchors.user_id = v_uid;
  END LOOP;

  -- --------------------------------------------------------------------------
  -- 7. Read Authoritative Restored Snapshot & Insert Durable Receipt
  -- --------------------------------------------------------------------------
  SELECT * INTO v_final_snapshot
  FROM public.debtfree_internal_build_snapshot(v_uid, v_household_id, v_currency);

  INSERT INTO public.debtfree_restore_receipts (
    owner_user_id,
    operation_id,
    request_identity,
    client_payload_fingerprint,
    restored_snapshot,
    completed_at
  ) VALUES (
    v_uid,
    p_operation_id,
    v_current_request_identity,
    p_payload_fingerprint,
    v_final_snapshot.r_snapshot,
    now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'operationId', p_operation_id,
    'payloadFingerprint', p_payload_fingerprint,
    'restoredSnapshot', v_final_snapshot.r_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_apply_snapshot_restore(text, text, text, text, text[], text[], jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_apply_snapshot_restore(text, text, text, text, text[], text[], jsonb, boolean) TO authenticated;

COMMIT;
