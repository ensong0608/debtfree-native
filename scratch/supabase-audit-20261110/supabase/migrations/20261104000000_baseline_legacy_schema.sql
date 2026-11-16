-- DebtFree Native Baseline Schema (Pre-Migration Snapshot)
-- Captures the initial tables (`public.household_profiles` and `public.debts`) that existed in `debtfree-native-auth`
-- (`bitepxsdujceoszbldhd`) prior to the first recorded migration (`20261105065959_debt_currency_precision`).
-- Uses `CREATE TABLE IF NOT EXISTS` and idempotent policy checks so it is safe on both fresh local databases
-- and any database where these legacy tables already exist.

BEGIN;

CREATE TABLE IF NOT EXISTS public.household_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  household_name text NOT NULL DEFAULT 'My Household'::text,
  monthly_income numeric NOT NULL DEFAULT 0,
  monthly_extra_payment numeric NOT NULL DEFAULT 0,
  payoff_strategy text NOT NULL DEFAULT 'snowball'::text CHECK (payoff_strategy = ANY (ARRAY['snowball'::text, 'avalanche'::text, 'custom'::text])),
  onboarding_completed boolean NOT NULL DEFAULT false,
  estimated_debt_free_date text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.household_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'household_profiles' AND policyname = 'Users can view their own household profile'
  ) THEN
    CREATE POLICY "Users can view their own household profile" ON public.household_profiles
      FOR SELECT TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'household_profiles' AND policyname = 'Users can insert their own household profile'
  ) THEN
    CREATE POLICY "Users can insert their own household profile" ON public.household_profiles
      FOR INSERT TO authenticated
      WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'household_profiles' AND policyname = 'Users can update their own household profile'
  ) THEN
    CREATE POLICY "Users can update their own household profile" ON public.household_profiles
      FOR UPDATE TO authenticated
      USING (user_id = (SELECT auth.uid()))
      WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  balance numeric(12, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  apr numeric(6, 3) NOT NULL DEFAULT 0 CHECK (apr >= 0 AND apr <= 100),
  minimum_payment numeric(12, 2) NOT NULL DEFAULT 0 CHECK (minimum_payment >= 0),
  priority_order integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;

COMMIT;
