import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOTYPE_DEBTS,
  PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA,
  PROTOTYPE_RECURRING_BILLS,
  PROTOTYPE_TRANSACTIONS,
  PROTOTYPE_RECONCILIATION_ANCHORS,
  convertPrototypeBackup,
} from '../src/finance/prototype-loader.ts';
import { calculatePayoffPlan, calculateTotalMonthlyIncome, activeDebts } from '../src/onboarding-domain.ts';
import { validateStoredAmounts } from '../src/debt-storage-domain.ts';

test('Prototype Loader: PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA is structurally valid', () => {
  assert.equal(PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA.userId, 'test-user-preview');
  assert.equal(PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA.householdId, 'hh-papi-mama');
  assert.equal(PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA.currencyCode, 'USD');
  assert.equal(PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA.strategy, 'avalanche');
  assert.equal(PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA.extraMonthlyPayment, 3000);

  // Validate stored amounts pass domain checks
  assert.doesNotThrow(() => {
    validateStoredAmounts(PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA);
  });

  // Incomes: Papi $3,700 + Mama $4,100 = $7,800
  assert.equal(PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA.primaryIncomeAmount, 3700);
  assert.equal(PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA.additionalIncomes.length, 1);
  assert.equal(PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA.additionalIncomes[0].amount, 4100);

  const totalMonthlyIncome = calculateTotalMonthlyIncome(
    PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA.primaryIncomeAmount,
    PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA.primaryPayFrequency,
    PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA.additionalIncomes,
    PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA.currencyCode,
  );
  assert.equal(totalMonthlyIncome, 7800);
});

test('Prototype Loader: All 15 debts are converted and categorized accurately', () => {
  assert.equal(PROTOTYPE_DEBTS.length, 15);

  const active = activeDebts(PROTOTYPE_DEBTS);
  // 14 non-mortgage debts (9 active credit cards + 1 auto loan + 4 zero-balance archived cards)
  assert.equal(active.length, 14);

  const mortgage = PROTOTYPE_DEBTS.find(d => d.category === 'Mortgage');
  assert.ok(mortgage);
  assert.equal(mortgage.name, 'House');
  assert.equal(mortgage.balance, 312700.58);
  assert.equal(mortgage.apr, 3.625);
  assert.equal(mortgage.minimumPayment, 2210.9);

  const autoLoan = PROTOTYPE_DEBTS.find(d => d.category === 'Auto loan');
  assert.ok(autoLoan);
  assert.equal(autoLoan.name, 'Honda HR-V');
  assert.equal(autoLoan.balance, 19751.94);
  assert.equal(autoLoan.apr, 5.85);
  assert.equal(autoLoan.minimumPayment, 587.3);

  // 9 active cards with positive balances
  const activeCards = PROTOTYPE_DEBTS.filter(d => d.category === 'Credit card' && d.balance > 0);
  assert.equal(activeCards.length, 9);

  const activeCardTotal = Math.round(activeCards.reduce((sum, d) => sum + d.balance, 0) * 100) / 100;
  assert.equal(activeCardTotal, 44549.79);

  // 4 archived cards with 0 balance
  const zeroCards = PROTOTYPE_DEBTS.filter(d => d.category === 'Credit card' && d.balance === 0);
  assert.equal(zeroCards.length, 4);
});

test('Prototype Loader: Recurring bills map accurately to November 2026 budget', () => {
  assert.equal(PROTOTYPE_RECURRING_BILLS.length, 8);

  const house = PROTOTYPE_RECURRING_BILLS.find(b => b.name === 'House');
  assert.ok(house);
  assert.equal(house.amount.minorUnits, 221090); // $2,210.90
  assert.equal(house.paymentMethod, 'debit');

  const hoa = PROTOTYPE_RECURRING_BILLS.find(b => b.name === 'HOA');
  assert.ok(hoa);
  assert.equal(hoa.amount.minorUnits, 16300); // $163.00

  const ameritas = PROTOTYPE_RECURRING_BILLS.find(b => b.name === 'Ameritas');
  assert.ok(ameritas);
  assert.equal(ameritas.amount.minorUnits, 17980); // $179.80

  const netflix = PROTOTYPE_RECURRING_BILLS.find(b => b.name === 'Netflix');
  assert.ok(netflix);
  assert.equal(netflix.amount.minorUnits, 2699); // $26.99
  assert.equal(netflix.paymentMethod, 'credit');
});

test('Prototype Loader: Transactions and reconciliation anchors maintain integrity', () => {
  assert.equal(PROTOTYPE_TRANSACTIONS.length, 51); // 49 imported ledger transactions + 2 confirmed debit bill payments
  assert.equal(PROTOTYPE_RECONCILIATION_ANCHORS.length, 9);

  // Every transaction with an accountId links to a known debt
  const debtIds = new Set(PROTOTYPE_DEBTS.map(d => d.id));
  for (const tx of PROTOTYPE_TRANSACTIONS) {
    if (tx.accountId) {
      assert.ok(debtIds.has(tx.accountId), `Transaction ${tx.id} has unlinked accountId ${tx.accountId}`);
    }
  }

  // Check Discover payment of $1,821.22 on 2026-10-30
  const discoverPymt = PROTOTYPE_TRANSACTIONS.find(t => t.id === '11c3f752-407b-4448-adea-e164d2181b88');
  assert.ok(discoverPymt);
  assert.equal(discoverPymt.amount.minorUnits, 182122);
  assert.equal(discoverPymt.category, 'payment');
});

test('Prototype Loader: Payoff plan calculates amortizing projection', () => {
  const plan = calculatePayoffPlan(
    [...PROTOTYPE_DEBTS],
    PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA.strategy,
    PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA.extraMonthlyPayment,
  );

  assert.equal(plan.status, 'paidOff');
  assert.ok(plan.monthsToPayoff != null && plan.monthsToPayoff <= 20);
  assert.equal(plan.stalled, false);
});

test('Prototype Loader: convertPrototypeBackup converts backup fixture payload', () => {
  const sampleBackup = {
    format: 'debtfree-dashboard-backup',
    version: 1,
    payload: {
      accounts: [
        { id: 'card-1', name: 'Test Card', kind: 'card', currentBalance: 500, apr: 18.5, minimumPayment: 25, dueDay: 10, limit: 2000 },
      ],
      monthlyBudgets: {
        '2026-11': [
          { id: 'b-1', name: 'Netflix', kind: 'expense', category: 'Subscriptions', amount: 15.99, dueDay: 5, autoPay: false },
        ],
      },
    },
  };
  const result = convertPrototypeBackup(sampleBackup, 'user-backup-1');
  assert.equal(result.onboardingData.userId, 'user-backup-1');
  assert.equal(result.onboardingData.debts.length, 1);
  assert.equal(result.onboardingData.debts[0].name, 'Test Card');
  assert.equal(result.recurringBills.length, 1);
  assert.equal(result.recurringBills[0].name, 'Netflix');
});
