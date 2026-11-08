# Supabase & RLS Migrations Skill

## Description
Database migrations, PostgreSQL RPC, and Row-Level Security (RLS) standards for the `debtfree-native` Supabase backend. All agents creating, modifying, or querying database schema and stored procedures must follow these patterns.

---

## 1. Migration File Standards

All migrations live under [`supabase/migrations/`](file:///C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/supabase/migrations/):
- **Naming Pattern**: `<YYYYMMDDHHMMSS>_<short_descriptive_name>.sql`
- **Forward-Only**: Never edit or mutate previous historical migration files that have already been executed. Always create a new forward migration.
- **Idempotency**: Use `IF NOT EXISTS`, `OR REPLACE`, and defensive column additions (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`).

---

## 2. Multi-Tenant Household Security & RLS Invariants

This application enforces household-isolated tenancy. Data belongs to a `household_id`, tied to authenticated users.

### Table RLS Baseline
Every table must have Row-Level Security enabled:
```sql
ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;
```

### Policy Requirements
1. **Authenticated Users Only**:
   ```sql
   CREATE POLICY "household_isolation_policy"
   ON public.<table_name>
   FOR ALL
   TO authenticated
   USING (
     household_id IN (
       SELECT household_id FROM public.household_members
       WHERE user_id = auth.uid()
     )
   )
   WITH CHECK (
     household_id IN (
       SELECT household_id FROM public.household_members
       WHERE user_id = auth.uid()
     )
   );
   ```
2. **Explicit Public Revocation**:
   Always revoke public and anonymous access to financial tables and RPCs:
   ```sql
   REVOKE ALL ON TABLE public.<table_name> FROM anon, public;
   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.<table_name> TO authenticated;
   ```

---

## 3. Atomic Financial Mutations & Stored Procedures (RPCs)

Financial mutations (e.g., updating payments, soft-deleting transactions, adjusting account balances) must be wrapped inside PostgreSQL stored procedures marked `SECURITY DEFINER` and execute with explicit row locks (`FOR UPDATE`).

### Standard Concurrency Pattern
```sql
CREATE OR REPLACE FUNCTION public.debtfree_mutation_atomic(
  p_household_id UUID,
  p_account_id UUID,
  ...
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account RECORD;
BEGIN
  -- 1. Authorization check
  IF NOT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = p_household_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized household mutation';
  END IF;

  -- 2. Lock target row to prevent race conditions
  SELECT * INTO v_account
  FROM public.debt_accounts
  WHERE id = p_account_id AND household_id = p_household_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target account not found';
  END IF;

  -- 3. Execute mutation logic & update balance
  ...

  RETURN jsonb_build_object('success', true);
END;
$$;
```

---

## 4. Soft Deletes & Audit Trails

- Transactions and accounts must never be hard-deleted from production tables.
- Use `deleted_at TIMESTAMPTZ DEFAULT NULL` and filter queries with `WHERE deleted_at IS NULL`.
- If a transaction is soft-deleted, reverse its ledger balance delta atomically in the same procedure call.

---

## 5. Prohibited Database Actions

- **NEVER** drop existing tables, truncate data, or drop foreign keys.
- **NEVER** run commands connecting to live remote production environments.
- **NEVER** hardcode user IDs, household IDs, or API keys in migration scripts.
