-- Preserve existing debt values and policies while supporting currency scales up to four.
BEGIN;
ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS original_balance numeric(18,4),
  ADD COLUMN IF NOT EXISTS credit_limit numeric(18,4);
ALTER TABLE public.debts
  ALTER COLUMN balance TYPE numeric(18,4),
  ALTER COLUMN minimum_payment TYPE numeric(18,4),
  ALTER COLUMN original_balance TYPE numeric(18,4),
  ALTER COLUMN credit_limit TYPE numeric(18,4);
COMMIT;
