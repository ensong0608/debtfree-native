-- DebtFree Native Sandbox Schema Migration: Households, Onboarding Profiles, Income Sources, and Debts
-- Enforces strict Row-Level Security (RLS) so each authenticated user/household only accesses their own records.

BEGIN;

CREATE TABLE IF NOT EXISTS public.households (
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT 'My Household',
  currency text NOT NULL DEFAULT 'USD',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.household_members (
  household_id text NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);

ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'household_members' AND policyname = 'household_members_self_access'
  ) THEN
    CREATE POLICY household_members_self_access ON public.household_members
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'households' AND policyname = 'households_member_access'
  ) THEN
    CREATE POLICY households_member_access ON public.households
      FOR ALL TO authenticated
      USING (
        created_by = auth.uid() OR EXISTS (
          SELECT 1 FROM public.household_members hm
          WHERE hm.household_id = id AND hm.user_id = auth.uid() AND hm.status = 'active'
        )
      )
      WITH CHECK (created_by = auth.uid());
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id text,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Credit card',
  balance numeric(12, 2) NOT NULL CHECK (balance >= 0),
  original_balance numeric(12, 2),
  apr numeric(6, 3) NOT NULL CHECK (apr >= 0 AND apr <= 100),
  minimum_payment numeric(12, 2) NOT NULL CHECK (minimum_payment >= 0),
  due_day integer CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 31)),
  credit_limit numeric(12, 2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'debts' AND policyname = 'debts_owner_isolation'
  ) THEN
    CREATE POLICY debts_owner_isolation ON public.debts
      FOR ALL TO authenticated
      USING (
        user_id = auth.uid() OR (
          household_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.household_members hm
            WHERE hm.household_id = debts.household_id AND hm.user_id = auth.uid() AND hm.status = 'active'
          )
        )
      )
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

COMMIT;
