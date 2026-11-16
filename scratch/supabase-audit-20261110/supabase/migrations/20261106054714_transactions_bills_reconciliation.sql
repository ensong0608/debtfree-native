-- DebtFree Native Schema Migration: Manual Transactions Ledger, Recurring Bills, and Reconciliation Anchors
-- Supports multi-currency numeric(18, 4) precision and enforces strict Row-Level Security (RLS).

BEGIN;

-- 1. Transactions Ledger
CREATE TABLE IF NOT EXISTS public.transactions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id text,
  account_id uuid REFERENCES public.debts(id) ON DELETE SET NULL,
  date date NOT NULL,
  amount numeric(18, 4) NOT NULL CHECK (amount >= 0),
  category text NOT NULL CHECK (category IN (
    'purchase',
    'subscription',
    'utilities',
    'interest',
    'fee',
    'annual_fee',
    'interest_adjustment',
    'balance_adjustment',
    'payment',
    'refund',
    'credit_adjustment',
    'debit_bill',
    'debit_spending'
  )),
  payee text NOT NULL,
  memo text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'recurring_bill', 'reconciliation', 'system')),
  reconciled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'transactions' AND policyname = 'transactions_owner_isolation'
  ) THEN
    CREATE POLICY transactions_owner_isolation ON public.transactions
      FOR ALL TO authenticated
      USING (
        user_id = auth.uid() OR (
          household_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.household_members hm
            WHERE hm.household_id = transactions.household_id AND hm.user_id = auth.uid() AND hm.status = 'active'
          )
        )
      )
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON public.transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON public.transactions(account_id);


-- 2. Recurring Bills
CREATE TABLE IF NOT EXISTS public.recurring_bills (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id text,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'utilities',
    'subscription',
    'housing',
    'insurance',
    'other_bill'
  )),
  amount numeric(18, 4) NOT NULL CHECK (amount > 0),
  due_day integer NOT NULL CHECK (due_day >= 1 AND due_day <= 31),
  payment_method text NOT NULL CHECK (payment_method IN ('debit', 'credit')),
  credit_account_id uuid REFERENCES public.debts(id) ON DELETE SET NULL,
  auto_post boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recurring_bills ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'recurring_bills' AND policyname = 'recurring_bills_owner_isolation'
  ) THEN
    CREATE POLICY recurring_bills_owner_isolation ON public.recurring_bills
      FOR ALL TO authenticated
      USING (
        user_id = auth.uid() OR (
          household_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.household_members hm
            WHERE hm.household_id = recurring_bills.household_id AND hm.user_id = auth.uid() AND hm.status = 'active'
          )
        )
      )
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recurring_bills_user ON public.recurring_bills(user_id);


-- 3. Statement Reconciliation Anchors
CREATE TABLE IF NOT EXISTS public.reconciliation_anchors (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  as_of_date date NOT NULL,
  verified_balance numeric(18, 4) NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reconciliation_anchors ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reconciliation_anchors' AND policyname = 'reconciliation_anchors_owner_isolation'
  ) THEN
    CREATE POLICY reconciliation_anchors_owner_isolation ON public.reconciliation_anchors
      FOR ALL TO authenticated
      USING (
        user_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.debts d
          WHERE d.id = reconciliation_anchors.account_id AND (
            d.user_id = auth.uid() OR (
              d.household_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.household_members hm
                WHERE hm.household_id = d.household_id AND hm.user_id = auth.uid() AND hm.status = 'active'
              )
            )
          )
        )
      )
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reconciliation_anchors_account ON public.reconciliation_anchors(account_id, as_of_date DESC);

COMMIT;
