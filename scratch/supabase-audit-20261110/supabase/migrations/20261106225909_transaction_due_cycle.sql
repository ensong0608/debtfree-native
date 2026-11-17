-- Allows an advance payment to retain its actual transaction date while satisfying
-- a distinct future billing cycle. This migration is reviewed but not applied.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS applies_to_date date;

CREATE INDEX IF NOT EXISTS transactions_user_applies_to_date_active_idx
  ON public.transactions (user_id, applies_to_date)
  WHERE deleted_at IS NULL AND applies_to_date IS NOT NULL;
