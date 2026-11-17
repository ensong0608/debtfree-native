import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMonthlyCashflow, calculateCategoryBreakdown, summarizeSinglePurchases, selectCardDebtCommitment, buildMonthlyBudgetBreakdown } from '../src/finance/budget.ts';
import { makeMoney } from '../src/finance/money.ts';

test('T-090: Budget uses entered card minimums plus extra, excludes loan projections and counts Auto once', () => {
  const cards = [
    { id: 'card-a', category: 'Credit card', balance: 10000, minimumPayment: 125.25, firstMonthPayment: 10000 },
    { id: 'card-b', category: 'Credit card', balance: 8000, minimumPayment: 80.50, firstMonthPayment: 8000 },
  ];
  const debts = [...cards,
    { id: 'paid-card', category: 'Credit card', balance: 0, minimumPayment: 50 },
    { id: 'auto', category: 'Auto loan', balance: 20000, minimumPayment: 698 },
    { id: 'personal', category: 'Personal loan', balance: 3000, minimumPayment: 100 },
  ];
  const commitment = selectCardDebtCommitment(debts, 200, 'USD');
  assert.deepEqual(commitment.cards, cards);
  assert.equal(commitment.total, 405.75);
  const bill = { id: 'auto-bill', category: 'other_bill', active: true, paymentMethod: 'debit', amount: makeMoney('USD', 69800) };
  const cashflow = calculateMonthlyCashflow({ monthlyIncome: 3000, recurringBills: [bill], monthlyDebtPlanPayment: commitment.total, currencyCode: 'USD' });
  const categories = calculateCategoryBreakdown({ monthlyIncome: 3000, recurringBills: [bill], monthlyDebtPlanPayment: commitment.total, debtAccountCount: commitment.cards.length, currencyCode: 'USD' });
  assert.equal(categories.find(row => row.categoryKey === 'debt').amount, 405.75);
  assert.equal(categories.find(row => row.categoryKey === 'other_bill').amount, 698);
  assert.equal(cashflow.totalCommitments, 1103.75);
  assert.equal(cashflow.remainingFreeCashflow, 1896.25);
  assert.equal(categories.reduce((sum, row) => sum + row.amount, 0), cashflow.totalCommitments);
});

test('T-090: extra remains visible without cards and card minimum sums honor currency scale', () => {
  const commitment = selectCardDebtCommitment([], 25, 'USD');
  assert.equal(commitment.total, 25);
  const categories = calculateCategoryBreakdown({ recurringBills: [], monthlyIncome: 100, monthlyDebtPlanPayment: commitment.total, currencyCode: 'USD' });
  assert.equal(buildMonthlyBudgetBreakdown({ categories, hasActiveDebt: commitment.cards.length > 0 || commitment.extra > 0, purchases: { total: 0, count: 0 }, monthlyIncome: 100 })[0].amount, 25);
  const cards = [{ category: 'Credit card', balance: 10, minimumPayment: 1.001 }, { category: 'Credit card', balance: 20, minimumPayment: 2.002 }];
  assert.equal(selectCardDebtCommitment(cards, 0.003, 'KWD').total, 3.006);
});

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

test('T-079: custom recurring labels are grouped by reusable name while storage stays other_bill', () => {
  const bills = [
    { id: 'driveway', name: 'Gas', category: 'other_bill', amount: makeMoney('USD', 7200), dueDay: 3, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2026-11-01T00:00:00Z' },
    { id: 'parking', name: 'Parking', category: 'other_bill', amount: makeMoney('USD', 1800), dueDay: 10, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2026-11-01T00:00:00Z' },
    { id: 'misc', name: 'Other fee', category: 'other_bill', amount: makeMoney('USD', 500), dueDay: 20, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2026-11-01T00:00:00Z' },
  ];
  const rows = calculateCategoryBreakdown({ recurringBills: bills, customCategoryLabelsByBillId: { driveway: 'Transportation', parking: 'transportation' }, monthlyIncome: 1000, monthlyDebtPlanPayment: 0, currencyCode: 'USD' });
  const transportation = rows.find(row => row.categoryKey === 'custom:transportation');
  assert.equal(transportation.label, 'Transportation');
  assert.equal(transportation.amount, 90);
  assert.equal(transportation.count, 2);
  assert.equal(rows.find(row => row.categoryKey === 'other_bill').amount, 5);
  assert.equal(bills[0].category, 'other_bill');
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

test('single purchases include only confirmed standalone purchases in the selected month', () => {
  const base = { id: 'one', accountId: 'card', date: '2026-11-03', amount: makeMoney('USD', 1250), category: 'purchase', payee: 'Shop', source: 'manual', reconciled: false, createdAt: '2026-11-03', deletedAt: null };
  const transactions = [base, { ...base, id: 'two', amount: makeMoney('USD', 99) },
    { ...base, id: 'pending', isPending: true }, { ...base, id: 'deleted', deletedAt: '2026-11-04' },
    { ...base, id: 'bill:abc:2026-11-01' }, { ...base, id: 'memo', memo: '[bill:abc]' },
    { ...base, id: 'source', source: 'recurring_bill' }, { ...base, id: 'other', category: 'payment' },
    { ...base, id: 'prior', date: '2026-10-31' }];
  const summary = summarizeSinglePurchases(transactions, '2026-11', 'USD');
  assert.deepEqual(summary.items.map(tx => tx.id), ['one', 'two']);
  assert.equal(summary.total, 13.49);
  assert.equal(summarizeSinglePurchases(transactions, '2026-10', 'USD').total, 12.5);
});

test('T-273: unified Mortgage and Auto loans group into Housing & Rent and Transportation alongside recurring expenses', () => {
  const bills = [
    {
      id: 'b-hoa',
      name: 'HOA Dues',
      category: 'housing',
      amount: makeMoney('USD', 12000), // $120.00
      dueDay: 1,
      paymentMethod: 'debit',
      autoPost: false,
      active: true,
      createdAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'b-ins-auto',
      name: 'Auto Insurance',
      category: 'other_bill',
      amount: makeMoney('USD', 16500), // $165.00
      dueDay: 8,
      paymentMethod: 'debit',
      autoPost: false,
      active: true,
      createdAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'b-fuel',
      name: 'Fuel Budget',
      category: 'other_bill',
      amount: makeMoney('USD', 22000), // $220.00
      dueDay: 15,
      paymentMethod: 'debit',
      autoPost: false,
      active: true,
      createdAt: '2026-11-01T00:00:00Z',
    },
  ];
  const unifiedLoans = [
    // Mortgage includes escrow in monthly payment without altering card debt commitment
    { id: 'd-home', category: 'Mortgage', balance: 250000, minimumPayment: 1850 },
    { id: 'd-hrv', category: 'Auto loan', balance: 19200, minimumPayment: 460 },
    // Non-qualifying categories and $0 balance loans are ignored here
    { id: 'd-card', category: 'Credit card', balance: 3000, minimumPayment: 95 },
    { id: 'd-paid', category: 'Auto loan', balance: 0, minimumPayment: 310 },
  ];

  const customCategoryLabelsByBillId = {
    'b-ins-auto': 'Transportation',
    'b-fuel': 'Transportation',
  };

  const cashflow = calculateMonthlyCashflow({
    monthlyIncome: 8500,
    recurringBills: bills,
    unifiedLoans,
    monthlyDebtPlanPayment: 200, // credit card minimum + extra
    currencyCode: 'USD',
  });
  // Debit commitments = (120 + 165 + 220) bills + (1850 + 460) unified loans = 2815
  assert.equal(cashflow.totalDebitBills, 2815);
  assert.equal(cashflow.totalDebtPlanPayment, 200);
  assert.equal(cashflow.totalCommitments, 3015);
  assert.equal(cashflow.remainingFreeCashflow, 5485);

  const breakdown = calculateCategoryBreakdown({
    recurringBills: bills,
    unifiedLoans,
    customCategoryLabelsByBillId,
    monthlyIncome: 8500,
    monthlyDebtPlanPayment: 200,
    debtAccountCount: 1,
    currencyCode: 'USD',
  });

  const housing = breakdown.find(row => row.categoryKey === 'housing');
  assert.equal(housing.amount, 1970); // $1,850 Mortgage + $120 HOA
  assert.equal(housing.count, 2);

  const transport = breakdown.find(row => row.categoryKey === 'custom:transportation');
  assert.equal(transport.label, 'Transportation');
  assert.equal(transport.amount, 845); // $460 Auto loan + $165 Insurance + $220 Fuel
  assert.equal(transport.count, 3);

  const debt = breakdown.find(row => row.categoryKey === 'debt');
  assert.equal(debt.amount, 200);
  assert.equal(breakdown.reduce((sum, row) => sum + row.amount, 0), cashflow.totalCommitments);
});


