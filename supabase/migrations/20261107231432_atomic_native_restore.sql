-- DebtFree Native Forward-only Migration: Atomic Native Snapshot Restore & Authoritative Receipt Protocol
-- Author: Senior Database Architect & Security Engineer (Worker Gemini 3.8 Flash High | Task T-058-SQL)
-- Status: UNAPPLIED (Forward migration for isolated sandbox review; do not execute automatically)
-- Prerequisites:
--   20261105065959_debt_currency_precision.sql
--   20261106054618_onboarding_and_households.sql
--   20261106054648_secure_household_debts.sql
--   20261106054656_debt_revisions_and_tombstones.sql
--   20261106054705_settings_cas_and_tombstone_hardening.sql
--   20261106054714_transactions_bills_reconciliation.sql
--   20261106054719_strict_financial_rls_and_atomic_transactions.sql
--   20261106100000_transaction_due_cycle.sql
--   20261106120000_phase1_financial_integrity_mutations.sql
--   20261106130000_phase1_rpc_only_financial_writes.sql

BEGIN;

-- ============================================================================
-- 1. Receipt Table: public.debtfree_restore_receipts
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.debtfree_restore_receipts (
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_id text NOT NULL,
  request_identity jsonb NOT NULL,
  client_payload_fingerprint text NOT NULL,
  restored_snapshot jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, operation_id)
);

ALTER TABLE public.debtfree_restore_receipts ENABLE ROW LEVEL SECURITY;

-- Deny all client direct operations; access strictly via SECURITY DEFINER RPCs.
REVOKE ALL ON TABLE public.debtfree_restore_receipts FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 2. Internal Helper: Currency Minor-Unit Scale Resolution
-- ============================================================================
CREATE OR REPLACE FUNCTION public.debtfree_internal_currency_scale(p_currency text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'RESTORE_INVALID_CURRENCY: Invalid ISO 4217 currency code %', p_currency
      USING ERRCODE = '22023';
  END IF;

  -- Scale 0: currencies without decimal minor units (e.g. JPY, KRW)
  IF p_currency IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN
    RETURN 0;
  -- Scale 3: 3-decimal currencies (e.g. KWD, BHD, OMR)
  ELSIF p_currency IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN
    RETURN 3;
  -- Scale 4: 4-decimal currencies (e.g. CLF, UYW)
  ELSIF p_currency IN ('CLF', 'UYW') THEN
    RETURN 4;
  -- Scale 2: explicit supported currency set from src/finance/currencies.ts.
  ELSIF p_currency IN ('USD','EUR','GBP','CAD','AUD','CHF','CNY','INR','AED','AFN','ALL','AMD','AOA','ARS','AWG','AZN','BAM','BBD','BDT','BMD','BND','BOB','BOV','BRL','BSD','BTN','BWP','BYN','BZD','CDF','CHE','CHW','COP','COU','CRC','CUP','CVE','CZK','DKK','DOP','DZD','EGP','ERN','ETB','FJD','FKP','GEL','GHS','GIP','GMD','GTQ','GYD','HKD','HNL','HTG','HUF','IDR','ILS','IRR','JMD','KES','KGS','KHR','KPW','KYD','KZT','LAK','LBP','LKR','LRD','LSL','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MXV','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','PAB','PEN','PGK','PHP','PKR','PLN','QAR','RON','RSD','RUB','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SOS','SRD','SSP','STN','SVC','SYP','SZL','THB','TJS','TMT','TOP','TRY','TTD','TWD','TZS','UAH','USN','UYU','UZS','VED','VES','WST','XAD','XCD','XCG','YER','ZAR','ZMW','ZWG') THEN
    RETURN 2;
  ELSE
    RAISE EXCEPTION 'RESTORE_INVALID_CURRENCY: Unsupported currency code %', p_currency USING ERRCODE='22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_internal_currency_scale(text) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 3. Internal Helper: Verified Server Household & Currency Resolver
-- ============================================================================
CREATE OR REPLACE FUNCTION public.debtfree_internal_verify_user_household(
  p_uid uuid,
  OUT r_household_id text,
  OUT r_currency text
)
RETURNS record
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile jsonb;
  v_meta_household_id text;
BEGIN
  SELECT raw_user_meta_data -> 'debtfree_native_v1' INTO v_profile
  FROM auth.users WHERE id = p_uid;

  IF v_profile IS NULL OR pg_catalog.jsonb_typeof(v_profile) <> 'object' THEN
    RAISE EXCEPTION 'RESTORE_PRECONDITION_FAILED: User onboarding profile not found'
      USING ERRCODE = '22023';
  END IF;

  v_meta_household_id := v_profile ->> 'householdId';

  IF v_meta_household_id IS NOT NULL AND v_meta_household_id <> '' THEN
    SELECT h.id, h.currency INTO r_household_id, r_currency
    FROM public.households h
    WHERE h.id = v_meta_household_id
      AND (
        h.created_by = p_uid OR EXISTS (
          SELECT 1 FROM public.household_members hm
          WHERE hm.household_id = h.id AND hm.user_id = p_uid AND hm.status = 'active'
        )
      );
  END IF;

  IF r_household_id IS NULL AND (v_meta_household_id IS NULL OR v_meta_household_id = '') THEN
    SELECT h.id, h.currency INTO r_household_id, r_currency
    FROM public.households h
    WHERE h.created_by = p_uid OR EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = h.id AND hm.user_id = p_uid AND hm.status = 'active'
    )
    ORDER BY (h.created_by = p_uid) DESC, h.created_at ASC
    LIMIT 1;
  END IF;

  IF r_household_id IS NULL THEN
    RAISE EXCEPTION 'RESTORE_PRECONDITION_FAILED: No active household membership or ownership found'
      USING ERRCODE = '23514';
  END IF;

  IF r_currency IS NULL OR r_currency = '' THEN
    r_currency := COALESCE(v_profile ->> 'currencyCode', 'USD');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_internal_verify_user_household(uuid) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 4. Internal Helper: Canonical Server Snapshot & Baseline Token Builder
-- ============================================================================
CREATE OR REPLACE FUNCTION public.debtfree_internal_build_snapshot(
  p_uid uuid,
  p_household_id text,
  p_currency text,
  OUT r_snapshot jsonb,
  OUT r_baseline_token text
)
RETURNS record
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_scale integer;
  v_factor numeric;
  v_profile jsonb;
  v_debts_json jsonb;
  v_bills_json jsonb;
  v_transactions_json jsonb;
  v_anchors_json jsonb;
  v_onboarding_data jsonb;
  v_state_for_token jsonb;
BEGIN
  v_scale := public.debtfree_internal_currency_scale(p_currency);
  v_factor := (10 ^ v_scale)::numeric;

  SELECT raw_user_meta_data -> 'debtfree_native_v1' INTO v_profile
  FROM auth.users WHERE id = p_uid;

  IF v_profile IS NULL OR pg_catalog.jsonb_typeof(v_profile) <> 'object' THEN
    RAISE EXCEPTION 'RESTORE_PRECONDITION_FAILED: User onboarding profile not found'
      USING ERRCODE = '22023';
  END IF;

  -- 1. Debts Projection
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', d.id::text,
      'name', d.name,
      'category', d.category,
      'balance', d.balance,
      'originalBalance', d.original_balance,
      'apr', d.apr,
      'minimumPayment', d.minimum_payment,
      'dueDay', d.due_day,
      'creditLimit', d.credit_limit,
      'createdAt', to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', to_char(d.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'serverVersion', d.version
    ) ORDER BY d.id::text
  ), '[]'::jsonb)
  INTO v_debts_json
  FROM public.debts d
  WHERE d.user_id = p_uid;

  -- 2. Recurring Bills Projection
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'category', b.category,
      'amount', pg_catalog.jsonb_build_object(
        'currency', p_currency,
        'minorUnits', round(b.amount * v_factor)::bigint
      ),
      'dueDay', b.due_day,
      'paymentMethod', b.payment_method,
      'creditAccountId', b.credit_account_id::text,
      'autoPost', b.auto_post,
      'active', b.active,
      'createdAt', to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', to_char(b.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY b.id
  ), '[]'::jsonb)
  INTO v_bills_json
  FROM public.recurring_bills b
  WHERE b.user_id = p_uid;

  -- 3. Transactions Projection (Includes soft-deleted rows; isPending is always false)
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', t.id,
      'accountId', t.account_id::text,
      'date', to_char(t.date, 'YYYY-MM-DD'),
      'appliesToDate', CASE WHEN t.applies_to_date IS NOT NULL THEN to_char(t.applies_to_date, 'YYYY-MM-DD') ELSE NULL END,
      'amount', pg_catalog.jsonb_build_object(
        'currency', p_currency,
        'minorUnits', round(t.amount * v_factor)::bigint
      ),
      'category', t.category,
      'payee', t.payee,
      'memo', t.memo,
      'source', t.source,
      'reconciled', t.reconciled,
      'createdAt', to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deletedAt', CASE WHEN t.deleted_at IS NOT NULL THEN to_char(t.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
      'isPending', false,
      'principalAmount', CASE WHEN t.principal_amount IS NOT NULL THEN pg_catalog.jsonb_build_object('currency', p_currency, 'minorUnits', round(t.principal_amount * v_factor)::bigint) ELSE NULL END,
      'interestAmount', CASE WHEN t.interest_amount IS NOT NULL THEN pg_catalog.jsonb_build_object('currency', p_currency, 'minorUnits', round(t.interest_amount * v_factor)::bigint) ELSE NULL END,
      'escrowAmount', CASE WHEN t.escrow_amount IS NOT NULL THEN pg_catalog.jsonb_build_object('currency', p_currency, 'minorUnits', round(t.escrow_amount * v_factor)::bigint) ELSE NULL END,
      'feeAmount', CASE WHEN t.fee_amount IS NOT NULL THEN pg_catalog.jsonb_build_object('currency', p_currency, 'minorUnits', round(t.fee_amount * v_factor)::bigint) ELSE NULL END
    ) ORDER BY t.id
  ), '[]'::jsonb)
  INTO v_transactions_json
  FROM public.transactions t
  WHERE t.user_id = p_uid;

  -- 4. Reconciliation Anchors Projection
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', a.id,
      'accountId', a.account_id::text,
      'asOfDate', to_char(a.as_of_date, 'YYYY-MM-DD'),
      'verifiedBalance', pg_catalog.jsonb_build_object(
        'currency', p_currency,
        'minorUnits', round(a.verified_balance * v_factor)::bigint
      ),
      'createdAt', to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'note', a.note,
      'createdAdjustmentId', a.created_adjustment_id
    ) ORDER BY a.id
  ), '[]'::jsonb)
  INTO v_anchors_json
  FROM public.reconciliation_anchors a
  WHERE a.user_id = p_uid;

  -- Attach database debts to onboardingData
  v_onboarding_data := pg_catalog.jsonb_set(v_profile, '{debts}', v_debts_json, true);

  -- Assemble NativeBackup structure
  r_snapshot := pg_catalog.jsonb_build_object(
    'schema', 'debtfree-native-backup',
    'version', 1,
    'userId', p_uid::text,
    'householdId', p_household_id,
    'currency', p_currency,
    'exportedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'onboardingData', v_onboarding_data,
    'transactions', v_transactions_json,
    'recurringBills', v_bills_json,
    'reconciliationAnchors', v_anchors_json
  );

  -- Assemble deterministic representation for baseline token (excludes volatile exportedAt)
  v_state_for_token := pg_catalog.jsonb_build_object(
    'userId', p_uid::text,
    'householdId', p_household_id,
    'currency', p_currency,
    'settings', v_profile - 'debts',
    'debts', v_debts_json,
    'recurringBills', v_bills_json,
    'transactions', v_transactions_json,
    'reconciliationAnchors', v_anchors_json
  );

  -- md5 is built into PostgreSQL (no pgcrypto extension schema assumption); token is only a CAS marker.
  r_baseline_token := pg_catalog.md5(v_state_for_token::text);
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_internal_build_snapshot(uuid, text, text) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 5. RPC: public.debtfree_read_restore_baseline()
-- ============================================================================
CREATE OR REPLACE FUNCTION public.debtfree_read_restore_baseline()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_household record;
  v_res record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_household FROM public.debtfree_internal_verify_user_household(v_uid);
  SELECT * INTO v_res FROM public.debtfree_internal_build_snapshot(v_uid, v_household.r_household_id, v_household.r_currency);

  RETURN pg_catalog.jsonb_build_object(
    'snapshot', v_res.r_snapshot,
    'baselineToken', v_res.r_baseline_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_read_restore_baseline() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_read_restore_baseline() TO authenticated;


-- ============================================================================
-- 6. RPC: public.debtfree_find_restore_receipt(text)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.debtfree_find_restore_receipt(p_operation_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_rec record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_operation_id IS NULL OR trim(p_operation_id) = '' OR length(p_operation_id) > 512 OR p_operation_id <> trim(p_operation_id) THEN
    RAISE EXCEPTION 'RESTORE_INVALID_OPERATION_ID: Invalid operation ID' USING ERRCODE = '22023';
  END IF;

  SELECT operation_id, client_payload_fingerprint, restored_snapshot
  INTO v_rec
  FROM public.debtfree_restore_receipts
  WHERE owner_user_id = v_uid AND operation_id = p_operation_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'operationId', v_rec.operation_id,
    'payloadFingerprint', v_rec.client_payload_fingerprint,
    'restoredSnapshot', v_rec.restored_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.debtfree_find_restore_receipt(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_find_restore_receipt(text) TO authenticated;


-- ============================================================================
-- 7. RPC: public.debtfree_apply_snapshot_restore(...)
-- ============================================================================
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

  -- Result
  v_final_snapshot record;
BEGIN
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

  IF p_mode NOT IN ('merge', 'replace') THEN
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

    -- Reject Tombstoned Debt Identity Revival
    IF EXISTS (SELECT 1 FROM public.debtfree_deleted_debt_ids WHERE id = v_id::uuid) THEN
      RAISE EXCEPTION 'RESTORE_TOMBSTONED_DEBT_ID: Deleted debt identity % cannot be reused', v_id USING ERRCODE = '23505';
    END IF;

    -- Reject Cross-Owner Row ID Collision
    IF EXISTS (SELECT 1 FROM public.debts WHERE id = v_id::uuid AND user_id <> v_uid) THEN
      RAISE EXCEPTION 'RESTORE_ROW_COLLISION: Debt ID % belongs to another user', v_id USING ERRCODE = '42501';
    END IF;

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

    IF EXISTS (SELECT 1 FROM public.recurring_bills WHERE id = v_id AND user_id <> v_uid) THEN
      RAISE EXCEPTION 'RESTORE_ROW_COLLISION: Bill ID % belongs to another user', v_id USING ERRCODE = '42501';
    END IF;

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

    IF EXISTS (SELECT 1 FROM public.transactions WHERE id = v_id AND user_id <> v_uid) THEN
      RAISE EXCEPTION 'RESTORE_ROW_COLLISION: Transaction ID % belongs to another user', v_id USING ERRCODE = '42501';
    END IF;

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

    IF EXISTS (SELECT 1 FROM public.reconciliation_anchors WHERE id = v_id AND user_id <> v_uid) THEN
      RAISE EXCEPTION 'RESTORE_ROW_COLLISION: Anchor ID % belongs to another user', v_id USING ERRCODE = '42501';
    END IF;

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

  -- Merge choices are checked against the server baseline before any write.
  -- The resolved payload contains the chosen row, so a changed extant row must
  -- be named accepted; a kept key must resolve byte-for-byte to its baseline row.
  IF p_mode='merge' THEN
    v_conflict_key := 'onboardingData:' || v_uid::text;
    IF (v_current_snapshot.r_snapshot->'onboardingData' - 'debts' - 'settingsRevision' - 'updatedAt')
       IS DISTINCT FROM (p_snapshot->'onboardingData' - 'debts' - 'settingsRevision' - 'updatedAt') THEN
      IF NOT (v_conflict_key=ANY(p_accepted_conflict_ids)) THEN
        RAISE EXCEPTION 'RESTORE_CONFLICT_CHOICE_REQUIRED: %', v_conflict_key USING ERRCODE='22023';
      END IF;
    ELSIF v_conflict_key=ANY(p_accepted_conflict_ids) THEN
      RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Accepted settings key is not a changed conflict' USING ERRCODE='22023';
    END IF;

    FOREACH v_domain IN ARRAY ARRAY['debts','recurringBills','transactions','reconciliationAnchors'] LOOP
      FOR v_elem IN SELECT value FROM pg_catalog.jsonb_array_elements(
        CASE v_domain WHEN 'debts' THEN v_current_snapshot.r_snapshot->'onboardingData'->'debts'
        ELSE v_current_snapshot.r_snapshot->v_domain END
      ) value
      LOOP
        v_conflict_key := v_domain || ':' || (v_elem->>'id');
        v_old := NULL;
        SELECT value INTO v_old FROM pg_catalog.jsonb_array_elements(
          CASE v_domain WHEN 'debts' THEN p_snapshot->'onboardingData'->'debts'
          ELSE p_snapshot->v_domain END
        ) value WHERE value->>'id'=v_elem->>'id';
        IF v_old IS NOT NULL AND v_old IS DISTINCT FROM v_elem THEN
          IF NOT (v_conflict_key=ANY(p_accepted_conflict_ids)) THEN
            RAISE EXCEPTION 'RESTORE_CONFLICT_CHOICE_REQUIRED: %', v_conflict_key USING ERRCODE='22023';
          END IF;
        ELSIF v_conflict_key=ANY(p_accepted_conflict_ids) THEN
          RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Accepted key is not a changed conflict: %', v_conflict_key USING ERRCODE='22023';
        END IF;
        IF v_conflict_key=ANY(p_kept_current_conflict_ids) AND v_old IS DISTINCT FROM v_elem THEN
          RAISE EXCEPTION 'RESTORE_INVALID_KEPT_ROW: Kept row differs from baseline: %', v_conflict_key USING ERRCODE='22023';
        END IF;
      END LOOP;
    END LOOP;
    FOREACH v_conflict_key IN ARRAY p_accepted_conflict_ids || p_kept_current_conflict_ids LOOP
      IF split_part(v_conflict_key,':',1)='onboardingData' THEN
        IF split_part(v_conflict_key,':',2) IS DISTINCT FROM v_uid::text THEN
          RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Settings conflict key has wrong owner' USING ERRCODE='22023';
        END IF;
      ELSE
        v_domain:=split_part(v_conflict_key,':',1);
        v_id:=substring(v_conflict_key FROM position(':' IN v_conflict_key)+1);
        IF v_domain='debts' THEN
          SELECT value INTO v_elem FROM pg_catalog.jsonb_array_elements(v_current_snapshot.r_snapshot->'onboardingData'->'debts') value WHERE value->>'id'=v_id;
          IF v_elem IS NULL THEN RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Unknown debt conflict key' USING ERRCODE='22023'; END IF;
          SELECT value INTO v_old FROM pg_catalog.jsonb_array_elements(p_snapshot->'onboardingData'->'debts') value WHERE value->>'id'=v_id;
        ELSIF v_domain IN ('recurringBills','transactions','reconciliationAnchors') THEN
          SELECT value INTO v_elem FROM pg_catalog.jsonb_array_elements(v_current_snapshot.r_snapshot->v_domain) value WHERE value->>'id'=v_id;
          IF v_elem IS NULL THEN RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Unknown financial conflict key' USING ERRCODE='22023'; END IF;
          SELECT value INTO v_old FROM pg_catalog.jsonb_array_elements(p_snapshot->v_domain) value WHERE value->>'id'=v_id;
        ELSE
          RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Unknown conflict domain' USING ERRCODE='22023';
        END IF;
        IF v_old IS NULL OR (v_conflict_key=ANY(p_kept_current_conflict_ids) AND v_old IS DISTINCT FROM v_elem) THEN
          RAISE EXCEPTION 'RESTORE_INVALID_CONFLICT: Conflict key does not resolve to the baseline row' USING ERRCODE='22023';
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- --------------------------------------------------------------------------
  -- 6. Execute Atomic Mutations
  -- --------------------------------------------------------------------------

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
    (p_snapshot -> 'onboardingData' - 'settingsRevision' - 'debts') || '{"debts":[]}'::jsonb,
    '{settingsRevision}',
    pg_catalog.to_jsonb(v_next_settings_revision),
    true
  );
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
