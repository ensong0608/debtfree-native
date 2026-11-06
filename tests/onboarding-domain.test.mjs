import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_REFERRAL_SOURCE,
  calculatePayoffPlan,
  calculateTotalMonthlyIncome,
  createDefaultOnboardingData,
  formatCurrency,
  normalizeMonthlyIncome,
  parseMoneyInput,
  parsePercentInput,
  resolveAuthenticatedStage,
  sortDebtsByStrategy,
  validateDebtDraft,
  validateDebtsStep,
  validateExtraPaymentInput,
  validateIncomeStep,
  validateSignUpStep2,
  validateSignUpStep3,
  validateSignUpStep4,
} from '../src/onboarding-domain.ts';

test('Sign-Up Step 2–4 validations enforce required selections and conditional AI follow-up', () => {
  assert.equal(validateSignUpStep2([]), 'Select at least one goal to continue.');
  assert.equal(validateSignUpStep2(['Pay down my credit card debt']), null);

  assert.equal(validateSignUpStep3('', null), 'Select how you heard about DebtFree to continue.');
  assert.equal(validateSignUpStep3('Friend or family', null), null);
  assert.equal(
    validateSignUpStep3(AI_REFERRAL_SOURCE, null),
    'Please choose whether you were considering DebtFree before asking an AI assistant.',
  );
  assert.equal(validateSignUpStep3(AI_REFERRAL_SOURCE, 'no'), null);

  assert.equal(
    validateSignUpStep4(null, false),
    'Please select whether you manage finances with a partner.',
  );
  assert.equal(
    validateSignUpStep4(true, null),
    'Please select whether you work with a financial professional.',
  );
  assert.equal(validateSignUpStep4(true, false), null);
});

test('Income normalization converts weekly, biweekly, twice monthly, and monthly accurately', () => {
  assert.equal(normalizeMonthlyIncome(1200, 'weekly'), 5200);
  assert.equal(normalizeMonthlyIncome(2400, 'biweekly'), 5200);
  assert.equal(normalizeMonthlyIncome(2600, 'twice_monthly'), 5200);
  assert.equal(normalizeMonthlyIncome(5200, 'monthly'), 5200);

  const total = calculateTotalMonthlyIncome(2400, 'biweekly', [
    { id: '1', name: 'Partner', amount: 1500, frequency: 'twice_monthly', monthlyAmount: 3000 },
  ]);
  assert.equal(total, 8200);

  const invalidPrimary = validateIncomeStep('0', []);
  assert.equal(invalidPrimary.valid, false);

  const validPrimary = validateIncomeStep('$5,200.00', [{ name: 'Side consulting', amount: 800 }]);
  assert.equal(validPrimary.valid, true);
  if (validPrimary.valid) {
    assert.equal(validPrimary.primaryAmount, 5200);
  }
});

test('Debt validation checks required fields, numeric ranges, and home/vehicle ownership rules', () => {
  const missingName = validateDebtDraft({
    name: '   ',
    category: 'Credit card',
    balanceRaw: '1500',
    aprRaw: '19.99',
    minimumPaymentRaw: '45',
  });
  assert.equal(missingName.valid, false);

  const badApr = validateDebtDraft({
    name: 'Visa',
    category: 'Credit card',
    balanceRaw: '1500',
    aprRaw: '145',
    minimumPaymentRaw: '45',
  });
  assert.equal(badApr.valid, false);

  const validCard = validateDebtDraft({
    name: 'Chase Sapphire',
    category: 'Credit card',
    balanceRaw: '$4,250.50',
    aprRaw: '21.99%',
    minimumPaymentRaw: '125.00',
    dueDayRaw: '15',
    creditLimitRaw: '10000',
  });
  assert.equal(validCard.valid, true);
  if (validCard.valid) {
    assert.equal(validCard.debt.balance, 4250.5);
    assert.equal(validCard.debt.apr, 21.99);
    assert.equal(validCard.debt.minimumPayment, 125);
    assert.equal(validCard.debt.dueDay, 15);
    assert.equal(validCard.debt.creditLimit, 10000);
  }

  const cardItem = {
    id: 'd1',
    name: 'Chase Sapphire',
    category: 'Credit card',
    balance: 4250.5,
    originalBalance: null,
    apr: 21.99,
    minimumPayment: 125,
    dueDay: 15,
    creditLimit: 10000,
    createdAt: '2026-11-04T00:00:00Z',
    updatedAt: '2026-11-04T00:00:00Z',
  };

  // Mortgage is deliberately excluded from active onboarding, even for owners.
  assert.equal(validateDebtsStep('Own', 'Own', [cardItem]), null);
  // Financing a vehicle requires an Auto loan entry
  assert.match(validateDebtsStep('Rent', 'Finance', [cardItem]) ?? '', /Auto loan/);
  // Rent + Own vehicle with 1 credit card passes
  assert.equal(validateDebtsStep('Rent', 'Own', [cardItem]), null);
});

test('Snowball and Avalanche strategies order debts and calculate payoff schedules accurately', () => {
  const debts = [
    {
      id: 'card-high-apr',
      name: 'High APR Card',
      category: 'Credit card',
      balance: 3000,
      originalBalance: 3000,
      apr: 24,
      minimumPayment: 90,
      dueDay: 10,
      creditLimit: 5000,
      createdAt: '2026-11-04T00:00:00Z',
      updatedAt: '2026-11-04T00:00:00Z',
    },
    {
      id: 'card-small-bal',
      name: 'Small Store Card',
      category: 'Credit card',
      balance: 800,
      originalBalance: 1000,
      apr: 15,
      minimumPayment: 35,
      dueDay: 20,
      creditLimit: 2000,
      createdAt: '2026-11-04T00:00:00Z',
      updatedAt: '2026-11-04T00:00:00Z',
    },
  ];

  const snowballOrder = sortDebtsByStrategy(debts, 'snowball');
  assert.equal(snowballOrder[0].id, 'card-small-bal');

  const avalancheOrder = sortDebtsByStrategy(debts, 'avalanche');
  assert.equal(avalancheOrder[0].id, 'card-high-apr');

  const baseDate = new Date('2026-11-01T00:00:00Z');
  const snowballPlan = calculatePayoffPlan(debts, 'snowball', 150, baseDate);
  const avalanchePlan = calculatePayoffPlan(debts, 'avalanche', 150, baseDate);

  assert.equal(snowballPlan.firstTarget?.id, 'card-small-bal');
  // Small card gets its $35 min + $150 extra = $185 in month 1
  assert.equal(snowballPlan.firstTarget?.firstMonthPayment, 185);
  assert.equal(snowballPlan.monthlyTotalPayment, 275);
  assert.equal(snowballPlan.stalled, false);

  assert.equal(avalanchePlan.firstTarget?.id, 'card-high-apr');
  // High APR card gets its $90 min + $150 extra = $240 in month 1
  assert.equal(avalanchePlan.firstTarget?.firstMonthPayment, 240);
  // Avalanche saves interest compared to Snowball
  assert.ok(avalanchePlan.totalInterest <= snowballPlan.totalInterest);

  // $0 extra payment is valid
  const zeroExtra = validateExtraPaymentInput('0');
  assert.deepEqual(zeroExtra, { valid: true, extraMonthlyPayment: 0 });
});

test('resolveAuthenticatedStage resumes incomplete onboarding and goes straight to home when completed', () => {
  const data = createDefaultOnboardingData('user-123456789012');
  assert.equal(resolveAuthenticatedStage(data), 'signup_2');

  const midOnboarding = { ...data, signupCompleted: true, currentStage: 'onboard_3' };
  assert.equal(resolveAuthenticatedStage(midOnboarding), 'onboard_3');

  const completed = { ...data, signupCompleted: true, onboardingCompleted: true, currentStage: 'home' };
  assert.equal(resolveAuthenticatedStage(completed), 'home');

  assert.equal(parseMoneyInput('$1,250.75'), 1250.75);
  assert.equal(parsePercentInput('18.5%'), 18.5);
  assert.equal(formatCurrency(5200, '$'), '$5,200.00');
});
