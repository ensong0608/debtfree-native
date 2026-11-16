-- Forward-only Migration: Atomic Financial Data Reset
-- Author: Lead Financial Systems Architect & Security Reviewer
-- Status: UNAPPLIED (Pending explicit database deployment authorization)
-- Purpose: Atomically purge all user-owned financial records (transactions, recurring bills,
--          reconciliation anchors, and debt accounts) in a single transactional RPC.

BEGIN;

-- Retire the debt-only entry point without dropping it or disturbing dependencies.
-- The preceding local migration defines this exact zero-argument signature.
REVOKE ALL ON FUNCTION public.debtfree_reset_debts_atomic() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.debtfree_reset_financial_data_atomic()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_txs_count integer := 0;
  v_bills_count integer := 0;
  v_anchors_count integer := 0;
  v_debts_count integer := 0;
BEGIN
  -- Strict authentication check: caller must be authenticated
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  -- 1. Transactions Ledger (scoped strictly to auth.uid())
  DELETE FROM public.transactions WHERE user_id = v_uid;
  GET DIAGNOSTICS v_txs_count = ROW_COUNT;

  -- 2. Statement Reconciliation Anchors (scoped strictly to auth.uid())
  DELETE FROM public.reconciliation_anchors WHERE user_id = v_uid;
  GET DIAGNOSTICS v_anchors_count = ROW_COUNT;

  -- 3. Recurring Bills (scoped strictly to auth.uid())
  DELETE FROM public.recurring_bills WHERE user_id = v_uid;
  GET DIAGNOSTICS v_bills_count = ROW_COUNT;

  -- 4. Debts / Accounts (scoped strictly to auth.uid())
  DELETE FROM public.debts WHERE user_id = v_uid;
  GET DIAGNOSTICS v_debts_count = ROW_COUNT;

  -- Return atomic confirmation breakdown
  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_uid,
    'deleted_transactions', v_txs_count,
    'deleted_reconciliation_anchors', v_anchors_count,
    'deleted_recurring_bills', v_bills_count,
    'deleted_debts', v_debts_count,
    'reset_at', now()
  );
EXCEPTION
  WHEN OTHERS THEN
    -- Transactional rollback is automatic in PL/pgSQL on unhandled exception
    RAISE;
END;
$$;

-- Security hardening: revoke public/anon access, grant strictly to authenticated
REVOKE ALL ON FUNCTION public.debtfree_reset_financial_data_atomic() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_reset_financial_data_atomic() TO authenticated;

COMMIT;
