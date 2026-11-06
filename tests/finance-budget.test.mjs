import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMonthlyCashflow, calculateCategoryBreakdown } from '../src/finance/budget.ts';
import { makeMoney } from '../src/finance/money.ts';

test('T-028: calculateMonthlyCashflow correctly differentiates debit cashflow from credit charges', () => {
  const bills = [
    {
      id: 'b-1',
      name: 'Electric',
      category: 'utilities',
      amount: makeMoney('USD', 14250), // $142.50
      dueDay: 14,
      paymentMethod: 'debit',
      autoPost: true,
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'b-2',
      name: 'Internet',
      category: 'utilities',
      amount: makeMoney('USD', 6500), // $65.00
      dueDay: 2,
      paymentMethod: 'debit',
      autoPost: true,
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'b-3',
      name: 'Netflix',
      category: 'subscription',
      amount: makeMoney('USD', 2199), // $21.99
      dueDay: 8,
      paymentMethod: 'credit',
      creditAccountId: 'card-chase',
      autoPost: true,
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'b-4',
      name: 'Cancelled Gym',
      category: 'subscription',
      amount: makeMoney('USD', 5000),
      dueDay: 1,
      paymentMethod: 'debit',
      autoPost: false,
      active: false, // inactive bill
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  const cashflow = calculateMonthlyCashflow({
    monthlyIncome: 5000,
    recurringBills: bills,
    monthlyDebtPlanPayment: 400,
    currencyCode: 'USD',
  });

  // Debit bills: 142.50 + 65.00 = 207.50
  assert.equal(cashflow.totalDebitBills, 207.5);
  // Credit bills: 21.99
  assert.equal(cashflow.totalCreditBills, 21.99);
  // Planned obligations include debit bills, debt plan payments, and recurring card charges.
  assert.equal(cashflow.totalCommitments, 629.49);
  // Free cashflow = 5000 - 629.49 = 4370.51
  assert.equal(cashflow.remainingFreeCashflow, 4370.51);
  assert.equal(cashflow.isDeficit, false);
  assert.equal(cashflow.debtPaymentPercent, 8); // (400 + 21.99) / 5000 rounds to 8%
  assert.equal(cashflow.debitBillsPercent, 4); // 207.50 / 5000 = 4%
  assert.equal(cashflow.freeCashPercent, 87); // 4370.51 / 5000 rounds to 87%
});

test('T-028: calculateMonthlyCashflow flags budget deficit accurately', () => {
  const bills = [
    {
      id: 'b-rent',
      name: 'Apartment Rent',
      category: 'housing',
      amount: makeMoney('USD', 250000), // $2,500
      dueDay: 1,
      paymentMethod: 'debit',
      autoPost: true,
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  const cashflow = calculateMonthlyCashflow({
    monthlyIncome: 3000,
    recurringBills: bills,
    monthlyDebtPlanPayment: 800,
    currencyCode: 'USD',
  });

  // Commitments = 2500 + 800 = 3300. Income = 3000. Deficit = -300
  assert.equal(cashflow.totalCommitments, 3300);
  assert.equal(cashflow.remainingFreeCashflow, -300);
  assert.equal(cashflow.isDeficit, true);
  assert.equal(cashflow.freeCashPercent, 0);
});

test('T-028: calculateCategoryBreakdown categorizes bills and debt plan', () => {
  const bills = [
    {
      id: 'b-util',
      name: 'Power',
      category: 'utilities',
      amount: makeMoney('USD', 15000), // $150
      dueDay: 10,
      paymentMethod: 'debit',
      autoPost: true,
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'b-sub',
      name: 'Spotify',
      category: 'subscription',
      amount: makeMoney('USD', 1500), // $15
      dueDay: 5,
      paymentMethod: 'debit',
      autoPost: true,
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  const breakdown = calculateCategoryBreakdown({
    recurringBills: bills,
    monthlyIncome: 4000,
    monthlyDebtPlanPayment: 300,
    currencyCode: 'USD',
  });

  const debtItem = breakdown.find(b => b.categoryKey === 'debt');
  assert.equal(debtItem.amount, 300);

  const utilItem = breakdown.find(b => b.categoryKey === 'utilities');
  assert.equal(utilItem.amount, 150);
  assert.equal(utilItem.count, 1);

  const subItem = breakdown.find(b => b.categoryKey === 'subscription');
  assert.equal(subItem.amount, 15);
  assert.equal(subItem.count, 1);
});

test('cashflow and category amounts retain 0, 3, and 4 decimal currency scales', () => {
  for (const sample of [
    { code: 'JPY', units: 1, income: 10, expected: 1 },
    { code: 'KWD', units: 1, income: 10, expected: 0.001 },
    { code: 'CLF', units: 1, income: 10, expected: 0.0001 },
  ]) {
    const bills = [{ id: `bill-${sample.code}`, name: 'Scale test', category: 'utilities',
      amount: makeMoney(sample.code, sample.units), dueDay: 1, paymentMethod: 'debit',
      autoPost: false, active: true, createdAt: '2026-01-01T00:00:00Z' }];
    const cashflow = calculateMonthlyCashflow({ monthlyIncome: sample.income, recurringBills: bills,
      monthlyDebtPlanPayment: 0, currencyCode: sample.code });
    const categories = calculateCategoryBreakdown({ recurringBills: bills, monthlyIncome: sample.income,
      monthlyDebtPlanPayment: 0, currencyCode: sample.code });
    assert.equal(cashflow.totalDebitBills, sample.expected);
    assert.equal(categories.find(item => item.categoryKey === 'utilities').amount, sample.expected);
  }
});
