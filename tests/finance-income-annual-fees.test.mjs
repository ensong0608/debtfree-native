import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateTotalGrossMonthlyIncome } from '../src/onboarding-domain.ts';
import { calculateTrackedDebtToIncome } from '../src/finance/budget.ts';
import { annualFeeTransactionId, createAnnualFeeTransaction, isAnnualFeeTransaction, nextAnnualFeeRenewalDate } from '../src/finance/annual-fees.ts';

test('gross monthly income normalizes each active source and stays unavailable when one is missing', () => {
  const additionalIncomes = [
    { id: 'weekly', name: 'Weekly job', amount: 600, grossAmount: 750, frequency: 'weekly', monthlyAmount: 2600 },
    { id: 'inactive', name: 'Inactive', amount: 0, frequency: 'monthly', monthlyAmount: 0 },
  ];
  assert.equal(calculateTotalGrossMonthlyIncome(4000, 5000, 'monthly', additionalIncomes, 'USD'), 8250);
  assert.equal(calculateTotalGrossMonthlyIncome(4000, null, 'monthly', additionalIncomes, 'USD'), null);
  assert.equal(calculateTotalGrossMonthlyIncome(4000, 5000, 'monthly', [
    { id: 'missing', name: 'Unentered gross', amount: 100, frequency: 'monthly', monthlyAmount: 100 },
  ], 'USD'), null);
});

test('tracked DTI uses listed minimums on positive-balance debts and excludes paid accounts', () => {
  const result = calculateTrackedDebtToIncome({
    debts: [
      { category: 'Credit card', balance: 1200, minimumPayment: 100 },
      { category: 'Mortgage', balance: 100000, minimumPayment: 225 },
      { category: 'Auto loan', balance: 0, minimumPayment: 300 },
      { category: 'Personal loan', balance: -10, minimumPayment: 100 },
    ],
    grossMonthlyIncome: 6500,
    currencyCode: 'USD',
  });
  assert.equal(result.monthlyDebtMinimums, 325);
  assert.equal(result.ratioPercent, 5);
  assert.deepEqual(calculateTrackedDebtToIncome({
    debts: [{ category: 'Credit card', balance: 1200, minimumPayment: 100 }],
    grossMonthlyIncome: null,
    currencyCode: 'USD',
  }), { monthlyDebtMinimums: 100, ratioPercent: null });
});

test('annual-fee identity is stable per account and renewal and renewal dates clamp leap day', () => {
  const renewalDate = '2028-02-29';
  assert.equal(annualFeeTransactionId('card-1', renewalDate), annualFeeTransactionId('card-1', renewalDate));
  assert.notEqual(annualFeeTransactionId('card-1', renewalDate), annualFeeTransactionId('card-1', '2029-02-28'));
  assert.equal(annualFeeTransactionId('card-1', renewalDate), 'annual-fee:card-1:2028-02-29');
  assert.equal(nextAnnualFeeRenewalDate(renewalDate), '2029-02-28');
});

test('annual-fee transaction is an explicit positive card charge tied to its renewal cycle', () => {
  const debt = {
    id: 'card-1', name: 'Travel card', category: 'Credit card', balance: 1200,
    originalBalance: null, apr: 19.99, minimumPayment: 45, dueDay: 7,
    creditLimit: 5000, annualFeeAmount: 95, annualFeeNextDueDate: '2026-12-15',
  };
  const tx = createAnnualFeeTransaction({
    debt,
    renewalDate: '2026-12-15',
    actualDate: '2026-12-15',
    currencyCode: 'USD',
    now: new Date('2026-12-15T12:00:00.000Z'),
  });
  assert.equal(tx.id, 'annual-fee:card-1:2026-12-15');
  assert.equal(tx.accountId, debt.id);
  assert.equal(tx.category, 'annual_fee');
  assert.equal(tx.amount.minorUnits, 9500);
  assert.equal(tx.appliesToDate, '2026-12-15');
  assert.equal(isAnnualFeeTransaction(tx, debt.id, '2026-12-15'), true);
  assert.throws(() => createAnnualFeeTransaction({
    debt,
    renewalDate: '2026-12-16',
    actualDate: '2026-12-15',
    currencyCode: 'USD',
  }), /renewal date changed/);
});

test('restore migration keeps scheduled annual-fee identity when debt IDs are rekeyed', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261111194453_annual_card_fee_support.sql', import.meta.url), 'utf8');
  assert.match(migration, /WHEN item\.value ->> 'category' = 'annual_fee'[\s\S]{0,600}THEN 'annual-fee:' \|\| \(v_debt_id_map ->> \(item\.value ->> 'accountId'\)\) \|\| ':' \|\| \(item\.value ->> 'appliesToDate'\)/);
});
