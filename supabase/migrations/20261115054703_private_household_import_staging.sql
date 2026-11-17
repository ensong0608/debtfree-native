-- Step 1: Create restricted staging table for chunked migration payload.
BEGIN;
CREATE TABLE IF NOT EXISTS public.debtfree_migration_stage_private (
  migration_key text NOT NULL,
  chunk_seq integer NOT NULL CHECK (chunk_seq >= 1),
  chunk_b64 text NOT NULL,
  expected_bundle_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (migration_key, chunk_seq)
);
ALTER TABLE public.debtfree_migration_stage_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.debtfree_migration_stage_private FROM PUBLIC, anon, authenticated;
COMMIT;
