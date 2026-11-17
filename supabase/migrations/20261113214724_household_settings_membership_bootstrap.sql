-- Shared household groundwork: materialize durable settings and owner membership.
-- This migration deliberately does not widen financial row access or change any
-- financial identifiers. Auth metadata is read only as a one-time legacy source.
BEGIN;

DO $migration$
DECLARE
  bad_household_id text;
BEGIN
  IF to_regclass('auth.users') IS NULL
     OR to_regclass('public.households') IS NULL
     OR to_regclass('public.household_members') IS NULL THEN
    RAISE EXCEPTION 'Shared household bootstrap prerequisite missing';
  END IF;

  -- Fail closed if truncated legacy household IDs collide or a stored ID is
  -- malformed. Never guess which user's records a household should contain.
  WITH legacy AS (
    SELECT u.id AS user_id,
           COALESCE(
             NULLIF(p.profile ->> 'householdId', ''),
             'hh-' || left(u.id::text, 12)
           ) AS household_id,
           p.profile
    FROM auth.users u
    CROSS JOIN LATERAL (
      SELECT u.raw_user_meta_data -> 'debtfree_native_v1' AS profile
    ) p
    WHERE jsonb_typeof(p.profile) = 'object'
      AND p.profile ->> 'userId' = u.id::text
  )
  SELECT household_id INTO bad_household_id
  FROM legacy
  GROUP BY household_id
  HAVING household_id IS NULL
      OR household_id = ''
      OR length(household_id) > 120
      OR household_id <> btrim(household_id)
      OR count(DISTINCT user_id) > 1
  LIMIT 1;

  IF bad_household_id IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid or colliding legacy household ID: %', bad_household_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE jsonb_typeof(u.raw_user_meta_data -> 'debtfree_native_v1') = 'object'
      AND u.raw_user_meta_data -> 'debtfree_native_v1' ->> 'userId' = u.id::text
      AND (u.raw_user_meta_data -> 'debtfree_native_v1') ? 'settingsRevision'
      AND u.raw_user_meta_data -> 'debtfree_native_v1' ->> 'settingsRevision'
          !~ '^(0|[1-9][0-9]{0,17})$'
  ) THEN
    RAISE EXCEPTION 'Invalid legacy household settings revision';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE jsonb_typeof(u.raw_user_meta_data -> 'debtfree_native_v1') = 'object'
      AND u.raw_user_meta_data -> 'debtfree_native_v1' ->> 'userId' = u.id::text
      AND (
        length(COALESCE(u.raw_user_meta_data -> 'debtfree_native_v1' ->> 'householdName', '')) > 120
        OR COALESCE(u.raw_user_meta_data -> 'debtfree_native_v1' ->> 'currencyCode', '') <> ''
           AND u.raw_user_meta_data -> 'debtfree_native_v1' ->> 'currencyCode' !~ '^[A-Za-z]{3}$'
      )
  ) THEN
    RAISE EXCEPTION 'Invalid legacy household name or currency';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.households h
    WHERE pg_catalog.length(pg_catalog.btrim(h.name)) = 0
       OR pg_catalog.length(h.name) > 120
       OR h.currency !~ '^[A-Za-z]{3}$'
  ) THEN
    RAISE EXCEPTION 'Invalid existing household name or currency';
  END IF;

  IF EXISTS (
    WITH legacy AS (
      SELECT u.id AS user_id,
             COALESCE(
               NULLIF(p.profile ->> 'householdId', ''),
               'hh-' || left(u.id::text, 12)
             ) AS household_id
      FROM auth.users u
      CROSS JOIN LATERAL (
        SELECT u.raw_user_meta_data -> 'debtfree_native_v1' AS profile
      ) p
      WHERE jsonb_typeof(p.profile) = 'object'
        AND p.profile ->> 'userId' = u.id::text
    )
    SELECT 1
    FROM legacy l
    JOIN public.households h ON h.id = l.household_id
    WHERE h.created_by <> l.user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.household_members hm
        WHERE hm.household_id = l.household_id
          AND hm.user_id = l.user_id
          AND hm.status = 'active'
      )
  ) THEN
    RAISE EXCEPTION 'Legacy profile points at a household without matching ownership or active membership';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.households h
    JOIN public.household_members hm ON hm.household_id = h.id
    WHERE h.created_by IS NOT NULL
      AND hm.role = 'owner'
      AND hm.status = 'active'
      AND hm.user_id <> h.created_by
  ) THEN
    RAISE EXCEPTION 'Household creator conflicts with an existing active owner membership';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.households h
    JOIN public.household_members hm
      ON hm.household_id = h.id
     AND hm.user_id = h.created_by
    WHERE h.created_by IS NOT NULL
      AND (hm.role <> 'owner' OR hm.status <> 'active')
  ) THEN
    RAISE EXCEPTION 'Household creator has a conflicting membership state';
  END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS public.household_settings (
  household_id text PRIMARY KEY REFERENCES public.households(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.household_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.household_settings FROM PUBLIC, anon, authenticated;

-- Create missing legacy household rows without changing an existing household.
WITH legacy AS (
  SELECT u.id AS user_id,
         COALESCE(
           NULLIF(p.profile ->> 'householdId', ''),
           'hh-' || left(u.id::text, 12)
         ) AS household_id,
         p.profile
  FROM auth.users u
  CROSS JOIN LATERAL (
    SELECT u.raw_user_meta_data -> 'debtfree_native_v1' AS profile
  ) p
  WHERE jsonb_typeof(p.profile) = 'object'
    AND p.profile ->> 'userId' = u.id::text
)
INSERT INTO public.households (id, name, currency, created_by)
SELECT l.household_id,
       COALESCE(NULLIF(btrim(l.profile ->> 'householdName'), ''), 'My Household'),
       COALESCE(NULLIF(upper(l.profile ->> 'currencyCode'), ''), 'USD'),
       l.user_id
FROM legacy l
ON CONFLICT (id) DO NOTHING;

-- Owner membership is derived from the household row, not from client claims.
-- Existing memberships and roles are preserved exactly.
INSERT INTO public.household_members (household_id, user_id, role, status)
SELECT h.id, h.created_by, 'owner', 'active'
FROM public.households h
WHERE h.created_by IS NOT NULL
ON CONFLICT (household_id, user_id) DO NOTHING;

-- Preserve only explicitly household-scoped settings as the initial canonical
-- snapshot. Per-user onboarding, referral, plan, and notification preferences
-- are not copied into shared household state.
WITH owner_profile AS (
  SELECT h.id AS household_id,
         h.name AS household_name,
         h.currency AS household_currency,
         u.raw_user_meta_data -> 'debtfree_native_v1' AS profile
  FROM public.households h
  JOIN public.household_members hm
    ON hm.household_id = h.id
   AND hm.user_id = h.created_by
   AND hm.role = 'owner'
   AND hm.status = 'active'
  JOIN auth.users u ON u.id = hm.user_id
  WHERE h.created_by IS NOT NULL
    AND jsonb_typeof(u.raw_user_meta_data -> 'debtfree_native_v1') = 'object'
    AND u.raw_user_meta_data -> 'debtfree_native_v1' ->> 'userId' = u.id::text
)
INSERT INTO public.household_settings (household_id, revision, settings)
SELECT household_id,
       CASE
         WHEN profile ->> 'settingsRevision' IS NULL THEN 0
         ELSE (profile ->> 'settingsRevision')::bigint
       END,
       jsonb_strip_nulls(jsonb_build_object(
         'householdId', to_jsonb(household_id),
         'householdName', COALESCE(NULLIF(btrim(profile ->> 'householdName'), ''), household_name),
         'countryCode', profile -> 'countryCode',
         'currencyCode', upper(COALESCE(NULLIF(profile ->> 'currencyCode', ''), household_currency)),
         'householdTimeZone', profile -> 'householdTimeZone',
         'primaryIncomeName', profile -> 'primaryIncomeName',
         'primaryIncomeAmount', profile -> 'primaryIncomeAmount',
         'primaryGrossIncomeAmount', profile -> 'primaryGrossIncomeAmount',
         'primaryPayFrequency', profile -> 'primaryPayFrequency',
         'primaryMonthlyIncome', profile -> 'primaryMonthlyIncome',
         'additionalIncomes', profile -> 'additionalIncomes',
         'strategy', profile -> 'strategy',
         'extraMonthlyPayment', profile -> 'extraMonthlyPayment',
         'obligationSchedules', profile -> 'obligationSchedules',
         'debtPaymentSplitPlansByDebtId', profile -> 'debtPaymentSplitPlansByDebtId',
         'billPaymentSplitPlansByBillId', profile -> 'billPaymentSplitPlansByBillId',
         'mortgageEscrowByDebtId', profile -> 'mortgageEscrowByDebtId',
         'mortgageExtraPaymentByDebtId', profile -> 'mortgageExtraPaymentByDebtId',
         'loanBillPairingByDebtId', profile -> 'loanBillPairingByDebtId',
         'recurringBillCategoryLabelByBillId', profile -> 'recurringBillCategoryLabelByBillId',
         'archivedPaidOffDebtIds', profile -> 'archivedPaidOffDebtIds'
       ))
FROM owner_profile
ON CONFLICT (household_id) DO NOTHING;

COMMIT;
