-- Supabase may grant functions directly to anon/authenticated via default
-- privileges, so revoking PUBLIC alone does not remove those grants.
REVOKE ALL ON FUNCTION public.debtfree_debt_tombstone_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debtfree_record_transaction_atomic(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debtfree_record_transaction_atomic(jsonb, text) TO authenticated;
