import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMonthlyCashflow, calculateCategoryBreakdown, summarizeAnnualCardFeesMonthly, summarizeSinglePurchases, summarizeMonthlyExpenses, selectCardDebtCommitment, selectDebtPlanCommitment, buildMonthlyBudgetBreakdown } from '../src/finance/budget.ts';
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
  assert.equal(cashflow.debtPaymentPercent, 8); // 400 / 5000 = 8% (excludes credit bills)
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
  assert.equal(transportation.label, 'Auto');
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

test('T-273: unified Mortgage and Auto loans group into Home and Auto alongside recurring expenses', () => {
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
    'b-ins-auto': 'Auto',
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
  assert.equal(housing.label, 'Home');
  assert.equal(housing.amount, 1970); // $1,850 Mortgage + $120 HOA
  assert.equal(housing.count, 2);

  const transport = breakdown.find(row => row.categoryKey === 'custom:transportation');
  assert.equal(transport.label, 'Auto');
  assert.equal(transport.amount, 845); // $460 Auto loan + $165 Insurance + $220 Fuel
  assert.equal(transport.count, 3);

  const debt = breakdown.find(row => row.categoryKey === 'debt');
  assert.equal(debt.amount, 200);
  assert.equal(breakdown.reduce((sum, row) => sum + row.amount, 0), cashflow.totalCommitments);
});

test('T-299: selectDebtPlanCommitment includes non-Mortgage/non-Auto loans and excludes $0 or Mortgage/Auto debts', () => {
  const debts = [
    { id: 'cc-1', category: 'Credit card', balance: 1500, minimumPayment: 45 },
    { id: 'pl-1', category: 'Personal loan', balance: 4000, minimumPayment: 120 },
    { id: 'sl-1', category: 'Student loan', balance: 8000, minimumPayment: 95 },
    { id: 'med-1', category: 'Medical debt', balance: 900, minimumPayment: 50 },
    { id: 'oth-1', category: 'Other loan', balance: 1200, minimumPayment: 40 },
    { id: 'paid-1', category: 'Personal loan', balance: 0, minimumPayment: 110 },
    { id: 'mtg-1', category: 'Mortgage', balance: 220000, minimumPayment: 1850 },
    { id: 'auto-1', category: 'Auto loan', balance: 18000, minimumPayment: 460 },
  ];

  const commitment = selectDebtPlanCommitment(debts, 100, 'USD');
  assert.deepEqual(
    commitment.accounts.map(d => d.id),
    ['cc-1', 'pl-1', 'sl-1', 'med-1', 'oth-1'],
  );
  assert.equal(commitment.extra, 100);
  assert.equal(commitment.total, 450); // 45 + 120 + 95 + 50 + 40 + 100
});

test('T-299: budget cashflow includes singlePurchasesTotal, keeps percentages uncapped over 100%, and excludes credit bills from debtPaymentPercent', () => {
  const bills = [
    {
      id: 'b-rent',
      name: 'Rent',
      category: 'housing',
      amount: makeMoney('USD', 220000), // $2,200 debit
      dueDay: 1,
      paymentMethod: 'debit',
      autoPost: true,
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'b-cc-sub',
      name: 'Cloud Suite',
      category: 'subscription',
      amount: makeMoney('USD', 20000), // $200 credit bill
      dueDay: 5,
      paymentMethod: 'credit',
      creditAccountId: 'cc-1',
      autoPost: true,
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  // debtPaymentPercent excludes $200 credit bill: 400 / 5000 = 8% (would be 12% if credit bills were added).
  const normalCashflow = calculateMonthlyCashflow({
    monthlyIncome: 5000,
    recurringBills: bills,
    monthlyDebtPlanPayment: 400,
    singlePurchasesTotal: 150,
    currencyCode: 'USD',
  });
  assert.equal(normalCashflow.debtPaymentPercent, 8);
  assert.equal(normalCashflow.totalCommitments, 2950); // 2200 + 200 + 400 + 150
  assert.equal(normalCashflow.remainingFreeCashflow, 2050);

  // Over-budget scenario: percentages exceed 100% without artificial capping, and total matches breakdown + single purchases.
  const deficitCashflow = calculateMonthlyCashflow({
    monthlyIncome: 1000,
    recurringBills: bills,
    monthlyDebtPlanPayment: 1200,
    singlePurchasesTotal: 1500,
    currencyCode: 'USD',
  });
  assert.equal(deficitCashflow.debtPaymentPercent, 120);
  assert.equal(deficitCashflow.debitBillsPercent, 220);
  assert.equal(deficitCashflow.freeCashPercent, 0);
  assert.equal(deficitCashflow.isDeficit, true);
  assert.equal(deficitCashflow.totalCommitments, 5100); // 2200 + 200 + 1200 + 1500
  assert.equal(deficitCashflow.remainingFreeCashflow, -4100);

  const categories = calculateCategoryBreakdown({
    monthlyIncome: 1000,
    recurringBills: bills,
    monthlyDebtPlanPayment: 1200,
    debtAccountCount: 2,
    currencyCode: 'USD',
  });
  const breakdown = buildMonthlyBudgetBreakdown({
    categories,
    hasActiveDebt: true,
    purchases: { total: 1500, count: 2 },
    monthlyIncome: 1000,
  });
  const purchasesRow = breakdown.find(row => row.categoryKey === 'purchases');
  assert.equal(purchasesRow.percentOfIncome, 150);
  assert.equal(breakdown.reduce((sum, row) => sum + row.amount, 0), deficitCashflow.totalCommitments);
});

test('T-301: summarizeAnnualCardFeesMonthly calculates monthly reserve across positive annual-fee credit cards', () => {
  const empty = summarizeAnnualCardFeesMonthly([
    { category: 'Credit card', annualFeeAmount: 0 },
    { category: 'Auto loan', annualFeeAmount: 120 },
  ]);
  assert.deepEqual(empty, { totalAnnualFees: 0, monthlySinkingReserve: 0, cardCount: 0 });

  const reserve = summarizeAnnualCardFeesMonthly([
    { category: 'Credit card', annualFeeAmount: 95 },
    { category: 'Credit card', annualFeeAmount: 250 },
    { category: 'Credit card', annualFeeAmount: null },
    { category: 'Mortgage', annualFeeAmount: 100 },
  ], 'USD');
  assert.deepEqual(reserve, {
    totalAnnualFees: 345,
    monthlySinkingReserve: 28.75,
    cardCount: 2,
  });
});

test('T-312: summarizeMonthlyExpenses classifies payments, recurring bill settlements, and standalone charges while excluding pending, deleted, other months, adjustments, and foreign currencies', () => {
  const debts = [
    { id: 'cc-1', name: 'Sapphire', category: 'Credit card', balance: 2400, minimumPayment: 120, dueDay: 15 },
    { id: 'pl-1', name: 'Personal Loan', category: 'Personal loan', balance: 4000, minimumPayment: 150, dueDay: 20 },
    { id: 'mtg-1', name: 'Home Mortgage', category: 'Mortgage', balance: 200000, minimumPayment: 1850, dueDay: 1 },
    { id: 'auto-1', name: 'Civic Loan', category: 'Auto loan', balance: 12000, minimumPayment: 420, dueDay: 10 },
    { id: 'cc-paid', name: 'Paid Off Card', category: 'Credit card', balance: 0, minimumPayment: 0, dueDay: 5 },
  ];
  const recurringBills = [
    { id: 'bill-ins', name: 'Auto & Home Ins', category: 'insurance', amount: makeMoney('USD', 17980), dueDay: 8, paymentMethod: 'credit', creditAccountId: 'cc-1', autoPost: true, active: true, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'bill-sub', name: 'Streaming', category: 'subscription', amount: makeMoney('USD', 2199), dueDay: 12, paymentMethod: 'credit', creditAccountId: 'cc-1', autoPost: true, active: true, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'bill-util', name: 'Electric', category: 'utilities', amount: makeMoney('USD', 14250), dueDay: 14, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'bill-child', name: 'Aftercare', category: 'other_bill', amount: makeMoney('USD', 25000), dueDay: 18, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'bill-mtg-linked', name: 'Legacy Mortgage', category: 'housing', amount: makeMoney('USD', 185000), dueDay: 1, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2026-01-01T00:00:00Z' },
  ];
  const txBase = {
    appliesToDate: null,
    payee: 'Payee',
    memo: '',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-10T00:00:00Z',
    deletedAt: null,
    isPending: false,
  };
  const transactions = [
    // Payments -> Debts (cc-1, pl-1, cc-paid), Home (mtg-1), Auto (auto-1)
    { ...txBase, id: 'p-cc', accountId: 'cc-1', date: '2026-11-15', amount: makeMoney('USD', 50000), category: 'payment', payee: 'Payment' },
    { ...txBase, id: 'p-pl', accountId: 'pl-1', date: '2026-11-20', amount: makeMoney('USD', 15000), category: 'payment', payee: 'Payment' },
    { ...txBase, id: 'p-paid', accountId: 'cc-paid', date: '2026-11-05', amount: makeMoney('USD', 7500), category: 'payment', payee: 'Final payment' },
    { ...txBase, id: 'p-mtg', accountId: 'mtg-1', date: '2026-11-01', appliesToDate: '2026-11-01', amount: makeMoney('USD', 185000), principalAmount: makeMoney('USD', 90000), category: 'payment', payee: 'Payment' },
    { ...txBase, id: 'p-auto', accountId: 'auto-1', date: '2026-11-10', amount: makeMoney('USD', 42000), category: 'payment', payee: 'Payment' },
    // Recurring bill settlements (credit insurance uses category 'purchase' with bill id; credit sub uses 'subscription')
    { ...txBase, id: 'bill:bill-ins:2026-11-08', accountId: 'cc-1', date: '2026-11-08', appliesToDate: '2026-11-08', amount: makeMoney('USD', 17980), category: 'purchase', payee: 'Auto & Home Ins', memo: '[bill:bill-ins]', source: 'recurring_bill' },
    { ...txBase, id: 'bill:bill-sub:2026-11-12', accountId: 'cc-1', date: '2026-11-12', appliesToDate: '2026-11-12', amount: makeMoney('USD', 2199), category: 'subscription', payee: 'Streaming', memo: '[bill:bill-sub]', source: 'recurring_bill' },
    { ...txBase, id: 'bill:bill-util:2026-11-14', accountId: null, date: '2026-11-14', appliesToDate: '2026-11-14', amount: makeMoney('USD', 14250), category: 'debit_bill', payee: 'Electric', memo: '[bill:bill-util]', source: 'recurring_bill' },
    { ...txBase, id: 'bill:bill-child:2026-11-18', accountId: null, date: '2026-11-18', appliesToDate: '2026-11-18', amount: makeMoney('USD', 25000), category: 'debit_bill', payee: 'Aftercare', source: 'recurring_bill' },
    // Automatic credit billing is an unpaid charge, while direct debit is paid spending.
    { ...txBase, id: 'bill:bill-sub:2026-11', accountId: 'cc-1', date: '2026-11-20', amount: makeMoney('USD', 1000), category: 'subscription', memo: 'Auto-recorded recurring bill (Charged to credit card)', source: 'recurring_bill' },
    { ...txBase, id: 'c-purch', accountId: 'cc-1', date: '2026-11-04', amount: makeMoney('USD', 8450), category: 'purchase', payee: 'Grocery' },
    { ...txBase, id: 'c-debit', accountId: null, date: '2026-11-06', amount: makeMoney('USD', 2500), category: 'debit_spending', payee: 'Coffee' },
    { ...txBase, id: 'c-int', accountId: 'cc-1', date: '2026-11-28', amount: makeMoney('USD', 3210), category: 'interest', payee: 'Interest' },
    { ...txBase, id: 'c-fee', accountId: 'cc-1', date: '2026-11-28', amount: makeMoney('USD', 1500), category: 'fee', payee: 'Late fee' },
    { ...txBase, id: 'c-ann', accountId: 'cc-1', date: '2026-11-02', amount: makeMoney('USD', 9500), category: 'annual_fee', payee: 'Annual fee' },
    { ...txBase, id: 'c-sub', accountId: 'cc-1', date: '2026-11-09', amount: makeMoney('USD', 1200), category: 'subscription', payee: 'One-off App' },
    // Exclusions: pending, deleted, prior month, foreign currency, refund, reconciliation, adjustments
    { ...txBase, id: 'ex-pend', accountId: 'cc-1', date: '2026-11-19', amount: makeMoney('USD', 99900), category: 'purchase', isPending: true },
    { ...txBase, id: 'ex-del', accountId: 'cc-1', date: '2026-11-19', amount: makeMoney('USD', 88800), category: 'payment', deletedAt: '2026-11-20T00:00:00Z' },
    { ...txBase, id: 'ex-oct', accountId: 'cc-1', date: '2026-10-31', amount: makeMoney('USD', 77700), category: 'purchase' },
    { ...txBase, id: 'ex-eur', accountId: 'cc-1', date: '2026-11-11', amount: makeMoney('EUR', 50000), category: 'purchase' },
    { ...txBase, id: 'ex-ref', accountId: 'cc-1', date: '2026-11-11', amount: makeMoney('USD', 2000), category: 'refund' },
    { ...txBase, id: 'ex-rec', accountId: 'cc-1', date: '2026-11-11', amount: makeMoney('USD', 3000), category: 'balance_adjustment', source: 'reconciliation' },
    { ...txBase, id: 'ex-adj', accountId: 'cc-1', date: '2026-11-11', amount: makeMoney('USD', 1000), category: 'interest_adjustment' },
  ];

  const summary = summarizeMonthlyExpenses({
    month: '2026-11',
    currencyCode: 'USD',
    transactions,
    debts,
    recurringBills,
    loanBillPairingByDebtId: { 'mtg-1': { status: 'linked', billId: 'bill-mtg-linked', canonical: true } },
    customCategoryLabelsByBillId: { 'bill-child': 'Childcare' },
    archivedPaidOffDebtIds: ['cc-paid'],
  });

  const byKey = Object.fromEntries(summary.categories.map(cat => [cat.categoryKey, cat]));
  assert.equal(byKey.debt.amount, 725); // 500 + 150 + 75
  assert.equal(byKey.debt.paymentCount, 3);
  assert.equal(byKey.housing.amount, 1850);
  assert.equal(byKey['custom:transportation'].amount, 420);
  assert.equal(byKey.insurance.amount, 179.8);
  assert.equal(byKey.subscription.amount, 21.99);
  assert.equal(byKey.utilities.amount, 142.5);
  assert.equal(byKey['custom:childcare'].amount, 250);
  assert.equal(byKey['custom:childcare'].label, 'Childcare');
  assert.equal(byKey.charges.amount, 248.6);
  assert.equal(byKey.charges.chargeCount, 6);
  assert.equal(byKey.other_spending.amount, 25);
  assert.equal(summary.totalDebtPayments, 2995);
  assert.equal(summary.others, 619.29);
  assert.equal(summary.cashOutflow, 3614.29);
  assert.equal(summary.unpaidCharges, 248.6);
  assert.equal(summary.netBalanceChange, -2746.4);
  assert.equal(summary.cashBreakdown.reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0), 361429);
  assert.equal(summary.transactions.some(tx => tx.id.startsWith('ex-')), false);
});

test('T-312: summarizeMonthlyExpenses avoids linked Mortgage/Auto and duplicate settlement double counting while preserving split payments and currency scale', () => {
  const debts = [
    { id: 'mtg-1', name: 'Home Loan', category: 'Mortgage', balance: 250000, minimumPayment: 2010, dueDay: 1 },
    { id: 'auto-1', name: 'Auto Loan', category: 'Auto loan', balance: 15000, minimumPayment: 460, dueDay: 15 },
    { id: 'cc-1', name: 'Card', category: 'Credit card', balance: 1000, minimumPayment: 50, dueDay: 20 },
  ];
  const recurringBills = [
    { id: 'bill-mtg', name: 'Old Mortgage', category: 'housing', amount: makeMoney('USD', 201000), dueDay: 1, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'bill-auto', name: 'Old Auto', category: 'other_bill', amount: makeMoney('USD', 46000), dueDay: 15, paymentMethod: 'debit', autoPost: false, active: false, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'bill-sub', name: 'Media', category: 'subscription', amount: makeMoney('USD', 2000), dueDay: 5, paymentMethod: 'credit', creditAccountId: 'cc-1', autoPost: true, active: true, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'bill-rent-split', name: 'Parking', category: 'other_bill', amount: makeMoney('USD', 10000), dueDay: 1, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2026-01-01T00:00:00Z' },
  ];
  const base = { appliesToDate: null, payee: 'Pay', memo: '', source: 'manual', reconciled: false, createdAt: '2026-11-01T00:00:00Z', deletedAt: null, isPending: false };
  const billSubTx = { ...base, id: 'bill:bill-sub:2026-11-05', accountId: 'cc-1', date: '2026-11-05', appliesToDate: '2026-11-05', amount: makeMoney('USD', 2000), category: 'subscription', memo: '[bill:bill-sub] [bill:bill-rent-split]', source: 'recurring_bill' };
  const transactions = [
    // Direct Mortgage payment + duplicate legacy excluded bill settlement for the exact same cycle
    { ...base, id: 'pay-mtg', accountId: 'mtg-1', date: '2026-11-01', appliesToDate: '2026-11-01', amount: makeMoney('USD', 201000), category: 'payment' },
    { ...base, id: 'bill:bill-mtg:2026-11-01', accountId: null, date: '2026-11-01', appliesToDate: '2026-11-01', amount: makeMoney('USD', 201000), category: 'debit_bill', memo: '[bill:bill-mtg]', source: 'recurring_bill' },
    { ...base, id: 'bill:bill-mtg:2026-11-01:part2', accountId: null, date: '2026-11-18', appliesToDate: '2026-11-01', amount: makeMoney('USD', 2000), category: 'debit_bill', memo: '[bill:bill-mtg]', source: 'recurring_bill' },
    // Historical alias debit_bill settling Auto loan when no direct loan payment exists
    { ...base, id: 'bill:bill-auto:2026-11-15', accountId: null, date: '2026-11-15', appliesToDate: '2026-11-15', amount: makeMoney('USD', 46000), category: 'debit_bill', memo: '[bill:bill-auto]', source: 'recurring_bill' },
    // Repeated array entry & multi-bill memo tag on credit bill settlement
    billSubTx,
    billSubTx,
    // Genuine 2-part split payment on a recurring bill (both must count)
    { ...base, id: 'bill:bill-rent-split:2026-11-01', accountId: null, date: '2026-11-01', appliesToDate: '2026-11-01', amount: makeMoney('USD', 5000), category: 'debit_bill', source: 'recurring_bill' },
    { ...base, id: 'bill:bill-rent-split:2026-11-01:part2', accountId: null, date: '2026-11-15', appliesToDate: '2026-11-01', amount: makeMoney('USD', 5000), category: 'debit_bill', source: 'recurring_bill' },
  ];

  const summary = summarizeMonthlyExpenses({
    month: '2026-11',
    currencyCode: 'USD',
    transactions,
    debts,
    recurringBills,
    loanBillPairingByDebtId: {
      'mtg-1': { status: 'linked', billId: 'bill-mtg', canonical: true },
      'auto-1': { status: 'linked', billId: 'bill-auto', canonical: true },
    },
    historicalBillIdsByDebtId: { 'auto-1': ['bill-auto'] },
  });

  const byKey = Object.fromEntries(summary.categories.map(cat => [cat.categoryKey, cat]));
  assert.equal(byKey.housing.amount, 2030);
  assert.equal(byKey.housing.count, 2);
  assert.deepEqual(byKey.housing.items.map(tx => tx.id), ['bill:bill-mtg:2026-11-01:part2', 'pay-mtg']);
  assert.equal(byKey['custom:transportation'].amount, 460);
  assert.equal(byKey.subscription.amount, 20);
  assert.equal(byKey.subscription.count, 1);
  assert.equal(byKey.other_bill.amount, 100);
  assert.equal(byKey.other_bill.count, 2);
  assert.equal(byKey.charges, undefined);
  assert.equal(summary.cashOutflow, 2610);
  assert.equal(summary.totalDebtPayments, 2490);
  assert.equal(summary.unpaidCharges, 0);
  assert.equal(summary.netBalanceChange, -2490);

  const kwd = summarizeMonthlyExpenses({
    month: '2026-11',
    currencyCode: 'KWD',
    transactions: [
      { ...base, id: 'k1', accountId: 'cc-1', date: '2026-11-02', amount: makeMoney('KWD', 1001), category: 'payment' },
      { ...base, id: 'k2', accountId: 'cc-1', date: '2026-11-03', amount: makeMoney('KWD', 2002), category: 'purchase' },
      { ...base, id: 'u1', accountId: 'cc-1', date: '2026-11-04', amount: makeMoney('USD', 5000), category: 'purchase' },
    ],
    debts,
  });
  assert.equal(kwd.cashOutflow, 1.001);
  assert.equal(kwd.totalDebtPayments, 1.001);
  assert.equal(kwd.unpaidCharges, 2.002);
  assert.equal(kwd.netBalanceChange, 1.001);
});

test('T-345: summarizeMonthlyExpenses keeps cash-basis totals unchanged and surfaces paidEarlyForMonth without double-counting', () => {
  const debts = [
    { id: 'mtg-1', name: 'Home Loan', category: 'Mortgage', balance: 250000, minimumPayment: 2010, dueDay: 1 },
    { id: 'cc-1', name: 'Card', category: 'Credit card', balance: 1000, minimumPayment: 50, dueDay: 20 },
  ];
  const recurringBills = [
    { id: 'bill-mtg', name: 'Old Mortgage', category: 'housing', amount: makeMoney('USD', 201000), dueDay: 1, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'bill-util', name: 'Electric', category: 'utilities', amount: makeMoney('USD', 12000), dueDay: 3, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'bill-sub', name: 'Streaming', category: 'subscription', amount: makeMoney('USD', 2500), dueDay: 2, paymentMethod: 'credit', creditAccountId: 'cc-1', autoPost: true, active: true, createdAt: '2026-01-01T00:00:00Z' },
  ];
  const base = { payee: 'Pay', memo: '', source: 'manual', reconciled: false, createdAt: '2026-11-21T00:00:00Z', deletedAt: null, isPending: false };
  const transactions = [
    // Early mortgage payment paid in Nov for Dec 1 + legacy mirrored recurring bill row (must dedup)
    { ...base, id: 'pay-mtg-early', accountId: 'mtg-1', date: '2026-11-21', appliesToDate: '2026-12-01', amount: makeMoney('USD', 201000), category: 'payment' },
    { ...base, id: 'bill:bill-mtg:2026-12-01', accountId: null, date: '2026-11-21', appliesToDate: '2026-12-01', amount: makeMoney('USD', 201000), category: 'debit_bill', memo: '[bill:bill-mtg]', source: 'recurring_bill' },
    // Early debit utility bill paid in Nov for Dec 3
    { ...base, id: 'bill:bill-util:2026-12-03', accountId: null, date: '2026-11-25', appliesToDate: '2026-12-03', amount: makeMoney('USD', 12000), category: 'debit_bill', memo: '[bill:bill-util]', source: 'recurring_bill', createdAt: '2026-11-25T00:00:00Z' },
    // Charges (credit-card auto-bill + standalone card purchase) must never appear in paidEarlyForMonth
    { ...base, id: 'bill:bill-sub:2026-12-02', accountId: 'cc-1', date: '2026-11-29', appliesToDate: '2026-12-02', amount: makeMoney('USD', 2500), category: 'subscription', memo: 'Auto-recorded recurring bill (Charged to credit card) [bill:bill-sub]', source: 'recurring_bill' },
    { ...base, id: 'chg-early', accountId: 'cc-1', date: '2026-11-28', appliesToDate: '2026-12-04', amount: makeMoney('USD', 4500), category: 'purchase' },
    // Same-month December payment & bill (must stay in Dec cashOutflow and NOT in paidEarlyForMonth)
    { ...base, id: 'pay-cc-dec', accountId: 'cc-1', date: '2026-12-10', appliesToDate: '2026-12-20', amount: makeMoney('USD', 10000), category: 'payment', createdAt: '2026-12-10T00:00:00Z' },
  ];

  const common = {
    currencyCode: 'USD',
    transactions,
    debts,
    recurringBills,
    loanBillPairingByDebtId: { 'mtg-1': { status: 'linked', billId: 'bill-mtg', canonical: true } },
  };
  const nov = summarizeMonthlyExpenses({ ...common, month: '2026-11' });
  const dec = summarizeMonthlyExpenses({ ...common, month: '2026-12' });

  assert.equal(nov.cashOutflow, 2130);
  assert.equal(nov.totalDebtPayments, 2010);
  assert.equal(nov.others, 120);
  assert.equal(nov.paidEarlyForMonth.length, 0);

  assert.equal(dec.cashOutflow, 100);
  assert.equal(dec.totalDebtPayments, 100);
  assert.equal(dec.others, 0);
  assert.deepEqual(
    dec.paidEarlyForMonth.map(entry => ({ categoryKey: entry.categoryKey, label: entry.label, id: entry.tx.id })),
    [
      { categoryKey: 'housing', label: 'Home', id: 'pay-mtg-early' },
      { categoryKey: 'utilities', label: 'Utilities', id: 'bill:bill-util:2026-12-03' },
    ],
  );
});
