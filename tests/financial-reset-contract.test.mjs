import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('financial reset fails closed before changing onboarding or local data', () => {
  const source = readFileSync(new URL('../src/onboarding-storage.ts', import.meta.url), 'utf8');
  const reset = source.split('export async function resetUserOnboardingData')[1].split('/**')[0];
  assert.doesNotMatch(reset, /debtfree_reset_debts_atomic/);
  assert.doesNotMatch(reset, /supabase\.auth\.updateUser/);
  assert.match(reset, /debtfree_reset_household_financial_data_atomic[\s\S]*receipt\.success !== true[\s\S]*receipt\.householdId !== householdId[\s\S]*throw new Error/);
  assert.match(reset, /await saveUserOnboardingData\(fresh\)/);
  assert.ok(reset.indexOf('throw new Error') < reset.indexOf('await saveUserOnboardingData(fresh)'));
  assert.ok(reset.lastIndexOf('throw new Error') < reset.indexOf('clearHouseholdFinanceStorage'));
});

test('pending migration revokes the obsolete reset and scopes the replacement', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261111194327_reset_financial_data_atomic.sql', import.meta.url), 'utf8');
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.debtfree_reset_debts_atomic\(\) FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /v_uid uuid := auth\.uid\(\)/i);
  for (const table of ['transactions', 'reconciliation_anchors', 'recurring_bills', 'debts']) {
    assert.match(sql, new RegExp(`DELETE FROM public\\.${table} WHERE user_id = v_uid`, 'i'));
  }
});
