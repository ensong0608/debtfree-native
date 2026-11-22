import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDaysBetween } from '../src/finance/calendar.ts';
import {
  ACCENT_COLORS, THEME_MODES, THEME_STYLES, accentDetails, appearanceStorageKeys,
  getAppearancePalette, isLightMode, resolveAppearancePreferences,
} from '../src/components/appearance-theme.ts';
import {
  AI_REFERRAL_SOURCE,
  calculateDailyInterestCost,
  calculateExtraPaymentScenario,
  calculatePayoffPlan,
  calculateStrategyScenario,
  calculateTotalMonthlyIncome,
  canSuggestLoanPaymentSplit,
  comparePayoffStrategies,
  createDefaultOnboardingData,
  findPreviousLoanPaymentDate,
  formatCurrency,
  normalizeMonthlyIncome,
  parseMoneyInput,
  parsePercentInput,
  projectedLoanBalanceAfterPrincipal,
  resolveAuthenticatedStage,
  resolveAutoLoanSplitSuggestion,
  resolveNextAutoDueDate,
  resolveOneTimePaymentPeriod,
  sortDebtsByStrategy,
  suggestLoanPaymentSplit,
  summarizeInterestBurn,
  validateDebtDraft,
  validateDebtsStep,
  validateExtraPaymentInput,
  validateIncomeStep,
  validateSignUpStep2,
  validateSignUpStep3,
  validateSignUpStep4,
} from '../src/onboarding-domain.ts';

test('Strategy models one entered amount without stacking it on the saved monthly extra', () => {
  const debts = [{
    id: 'card', name: 'Card', category: 'Credit card', balance: 20000, originalBalance: 20000,
    minimumPayment: 500, apr: 18, creditLimit: null, dueDay: 1,
  }];
  const date = new Date('2026-11-01T12:00:00Z');
  const monthly = calculateExtraPaymentScenario(debts, 'avalanche', 2000, 5000, 'monthly', date);
  const oneTime = calculateExtraPaymentScenario(debts, 'avalanche', 2000, 5000, 'oneTime', date);
  const lower = calculateExtraPaymentScenario(debts, 'avalanche', 2000, 1000, 'monthly', date);

  assert.equal(monthly.baseline.extraMonthlyPayment, 2000);
  assert.equal(monthly.totalScenarioMonthlyExtra, 5000);
  assert.equal(monthly.firstPayment.totalPaid, 5500);
  assert.equal(monthly.nextPayment.scenarioExtraPaid, 5000);
  assert.equal(oneTime.firstPayment.totalPaid, 5500);
  assert.equal(oneTime.nextPayment.totalPaid, 500);
  assert.equal(oneTime.nextPayment.scenarioExtraPaid, 0);
  assert.ok(lower.monthsSaved < 0);
  assert.ok(lower.interestSaved < 0);
});

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

  // Mortgage accounts remain separate from the shared payoff strategy but are valid onboarding debts.
  assert.equal(validateDebtsStep('Own', 'Own', [cardItem]), null);
  assert.equal(validateDebtsStep('Own', 'Own', [{ ...cardItem, id: 'mortgage', category: 'Mortgage' }]), null);
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

test('T-299: normalizeMonthlyIncome handles high-precision floats and calculatePayoffPlan marks all-$0 debts as paidOff 100%', () => {
  assert.equal(normalizeMonthlyIncome(1234.56789, 'monthly'), 1234.57);
  const paidOffPlan = calculatePayoffPlan(
    [
      {
        id: 'card-paid',
        name: 'Paid Card',
        category: 'Credit card',
        balance: 0,
        originalBalance: 2500,
        apr: 19.99,
        minimumPayment: 50,
        dueDay: 15,
        creditLimit: 5000,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
    ],
    'snowball',
    100,
    new Date('2026-11-18T00:00:00Z'),
    'USD',
    'America/Los_Angeles',
    ['card-paid'],
  );
  assert.equal(paidOffPlan.status, 'paidOff');
  assert.equal(paidOffPlan.monthsToPayoff, 0);
  assert.equal(paidOffPlan.progressPercent, 100);
  assert.equal(paidOffPlan.totalStartingDebt, 2500);
  assert.equal(paidOffPlan.stalled, false);
});

test('T-301: summarizeInterestBurn computes weighted APR and monthly/daily burn across positive balances', () => {
  const debts = [
    {
      id: 'card-high',
      name: 'High Card',
      category: 'Credit card',
      balance: 3000,
      originalBalance: 3000,
      apr: 24,
      minimumPayment: 90,
      dueDay: 10,
      creditLimit: 5000,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'card-low',
      name: 'Low Card',
      category: 'Credit card',
      balance: 1000,
      originalBalance: 1000,
      apr: 12,
      minimumPayment: 35,
      dueDay: 15,
      creditLimit: 2000,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'home-1',
      name: 'Mortgage',
      category: 'Mortgage',
      balance: 200000,
      originalBalance: 220000,
      apr: 6,
      minimumPayment: 1400,
      dueDay: 1,
      creditLimit: null,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
  ];
  const nonMortgage = summarizeInterestBurn(debts);
  assert.equal(nonMortgage.activeBalance, 4000);
  assert.equal(nonMortgage.weightedAvgApr, 21); // (3000*24 + 1000*12) / 4000 = 21%
  assert.equal(nonMortgage.monthlyInterestBurn, 70); // (3000*0.24 + 1000*0.12) / 12 = 70
  assert.equal(nonMortgage.dailyInterestBurn, 2.3); // (720 + 120) / 365 = 2.3013 -> 2.3

  const withMortgages = summarizeInterestBurn(debts, { includeMortgages: true });
  assert.equal(withMortgages.activeBalance, 204000);
  assert.equal(withMortgages.monthlyInterestBurn, 1070);
});

test('T-301: comparePayoffStrategies compares active plan vs minimums and Snowball vs Avalanche', () => {
  const debts = [
    {
      id: 'small-low-apr',
      name: 'Store Card',
      category: 'Credit card',
      balance: 1500,
      originalBalance: 1500,
      apr: 10,
      minimumPayment: 50,
      dueDay: 5,
      creditLimit: 2500,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'large-high-apr',
      name: 'Rewards Card',
      category: 'Credit card',
      balance: 4000,
      originalBalance: 4000,
      apr: 26,
      minimumPayment: 120,
      dueDay: 20,
      creditLimit: 6000,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
  ];
  const comparison = comparePayoffStrategies(
    debts,
    'snowball',
    200,
    new Date('2026-11-18T00:00:00Z'),
    'USD',
    'UTC',
  );
  assert.ok((comparison.monthsSavedVsMinimums ?? 0) > 0);
  assert.ok((comparison.interestSavedVsMinimums ?? 0) > 0);
  assert.ok((comparison.avalancheInterestSavingsVsSnowball ?? 0) > 0);
  assert.equal(comparison.snowball.firstTargetName, 'Store Card');
  assert.equal(comparison.avalanche.firstTargetName, 'Rewards Card');
});

test('T-301: suggestLoanPaymentSplit computes escrow-first and monthly interest allocation', () => {
  const mortgageSplit = suggestLoanPaymentSplit({
    balance: 240000,
    aprPercent: 6,
    paymentAmount: 2000,
    escrowAmount: 450,
    currencyCode: 'USD',
  });
  assert.deepEqual(mortgageSplit, {
    escrow: 450,
    interest: 1200, // 240000 * 0.06 / 12
    principal: 350, // 2000 - 450 - 1200
  });

  const autoSplit = suggestLoanPaymentSplit({
    balance: 12000,
    aprPercent: 6,
    paymentAmount: 400,
    currencyCode: 'USD',
  });
  assert.deepEqual(autoSplit, {
    escrow: 0,
    interest: 60, // 12000 * 0.06 / 12
    principal: 340,
  });
});

test('T-346: suggestLoanPaymentSplit tracks mortgage amortization, extra principal, payoff cap, and canSuggestLoanPaymentSplit guards', () => {
  let balance = 313990.56;
  const expectedBalances = [313346.54, 312700.58, 312052.67, 311402.80];
  let lastSplit = null;
  for (const expectedBalance of expectedBalances) {
    lastSplit = suggestLoanPaymentSplit({
      balance,
      aprPercent: 3.625,
      paymentAmount: 2210.90,
      escrowAmount: 618.37,
      currencyCode: 'USD',
    });
    balance = projectedLoanBalanceAfterPrincipal(balance, lastSplit.principal, 'USD');
    assert.equal(balance, expectedBalance);
  }
  assert.deepEqual(lastSplit, {
    escrow: 618.37,
    interest: 942.66,
    principal: 649.87,
  });

  const extraSplit = suggestLoanPaymentSplit({
    balance: 312052.67,
    aprPercent: 3.625,
    paymentAmount: 2500.00,
    escrowAmount: 618.37,
    currencyCode: 'USD',
  });
  assert.deepEqual(extraSplit, {
    escrow: 618.37,
    interest: 942.66,
    principal: 938.97,
  });

  const finalPayoff = suggestLoanPaymentSplit({
    balance: 500.00,
    aprPercent: 3.625,
    paymentAmount: 2210.90,
    escrowAmount: 618.37,
    currencyCode: 'USD',
  });
  assert.equal(finalPayoff.principal, 500);
  assert.equal(projectedLoanBalanceAfterPrincipal(500, finalPayoff.principal, 'USD'), 0);

  assert.equal(canSuggestLoanPaymentSplit({ category: 'Mortgage', balance: 300000, apr: 3.625 }, 0), true);
  assert.equal(canSuggestLoanPaymentSplit({ category: 'Mortgage', balance: 300000, apr: 3.625 }, 618.37), true);
  assert.equal(canSuggestLoanPaymentSplit({ category: 'Mortgage', balance: 300000, apr: 3.625 }, undefined), false);
  assert.equal(canSuggestLoanPaymentSplit({ category: 'Auto loan', balance: 15000, apr: 5.5 }, undefined), true);
  assert.equal(canSuggestLoanPaymentSplit({ category: 'Credit card', balance: 2000, apr: 19.99 }, 0), false);
  assert.equal(canSuggestLoanPaymentSplit({ category: 'Auto loan', balance: 0, apr: 5.5 }, undefined), false);
});

test('appearance preferences migrate and retain all three independently saved choices', () => {
  assert.deepEqual(resolveAppearancePreferences(null, 'Inspire', 'Indigo'), { style: 'Inspire', mode: 'Light', accent: 'indigo' });
  assert.deepEqual(resolveAppearancePreferences(null, 'Dark', 'Cobalt'), { style: 'Fresh', mode: 'Dark', accent: 'cobalt' });
  assert.deepEqual(resolveAppearancePreferences('{bad', 'System', null), { style: 'Fresh', mode: 'System', accent: 'green' });
  for (const style of THEME_STYLES) {
    for (const mode of THEME_MODES) {
      for (const accent of ACCENT_COLORS) {
        const saved = { style, mode, accent };
        assert.deepEqual(resolveAppearancePreferences(JSON.stringify(saved), 'Inspire', 'Cobalt'), saved);
      }
    }
  }
  assert.notEqual(appearanceStorageKeys('owner').preferences, appearanceStorageKeys('member').preferences);
  assert.equal(appearanceStorageKeys('user-1').legacyTheme, 'debtfree-pref-theme.user-1');
  assert.equal(appearanceStorageKeys('user-1').legacyAccent, 'debtfree-pref-accent.75-73-65-72-2d-31');
  assert.equal(isLightMode('System', 'light'), true);
  assert.equal(isLightMode('System', 'dark'), false);
  assert.equal(isLightMode('Light', 'dark'), true);
  assert.equal(isLightMode('Dark', 'light'), false);
});

test('both appearance styles have ten complete day and night palettes with readable button fills', () => {
  const expected = {
    Fresh: [
      ['#49CC68', '#84FB7F'], ['#2563EB', '#60A5FA'], ['#D97706', '#FBBF24'], ['#00B386', '#22F3BA'],
      ['#00A8C6', '#22D3EE'], ['#4F46E5', '#818CF8'], ['#7C3AED', '#A78BFA'], ['#DB2777', '#F472B6'],
      ['#EA580C', '#FB923C'], ['#1E293B', '#E2E8F0'],
    ],
    Inspire: [
      ['#15803D', '#4ADE80'], ['#2563EB', '#60A5FA'], ['#C27803', '#FBBF24'], ['#0D9488', '#34D399'],
      ['#0A85A5', '#2DD4BF'], ['#4F46E5', '#818CF8'], ['#6D5BD0', '#A78BFA'], ['#DB2777', '#F472B6'],
      ['#EA580C', '#FB923C'], ['#334155', '#CBD5E1'],
    ],
  };
  const luminance = hex => {
    const [r, g, b] = hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const style of THEME_STYLES) {
    assert.equal(new Set(ACCENT_COLORS.map(color => accentDetails(style, color).label)).size, 10);
    for (const [index, color] of ACCENT_COLORS.entries()) {
      const light = getAppearancePalette(style, color, true);
      const dark = getAppearancePalette(style, color, false);
      assert.deepEqual([light.brand, dark.brand], expected[style][index]);
      assert.notEqual(light.canvas, dark.canvas);
      assert.notEqual(light.sky1, dark.sky1);
      for (const palette of [light, dark]) {
        assert.ok(Object.values(palette).every(value => typeof value === 'string' && value.length > 0));
        const bg = luminance(palette.brand);
        const fg = luminance(palette.onBrand);
        assert.ok((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) >= 4.5, `${style} / ${color}`);
        assert.notEqual(palette.posInk, palette.neg);
      }
    }
  }
});

test('T-313: resolveOneTimePaymentPeriod and calculateStrategyScenario model combined monthly and dated one-time previews', () => {
  const baseDate = new Date('2026-11-19T18:00:00Z');
  const currentMonth = resolveOneTimePaymentPeriod('2026-11-25', baseDate, 'UTC');
  assert.equal(currentMonth.period, 1);
  assert.equal(currentMonth.cycleLabel, 'Dec 2026');
  assert.equal(currentMonth.clampedToFirstCycle, true);

  const febCycle = resolveOneTimePaymentPeriod('2027-02-14', baseDate, 'UTC');
  assert.equal(febCycle.period, 3);
  assert.equal(febCycle.cycleLabel, 'Feb 2027');
  assert.equal(febCycle.clampedToFirstCycle, false);

  const debts = [{
    id: 'card', name: 'Card', category: 'Credit card', balance: 6000, originalBalance: 6000,
    minimumPayment: 200, apr: 24, creditLimit: null, dueDay: 1,
  }];
  const decPreview = calculateStrategyScenario({
    debts,
    strategy: 'avalanche',
    baselineExtraMonthlyPayment: 300,
    monthlyExtraAmount: 300,
    oneTimeExtraAmount: 1000,
    oneTimeDate: '2026-12-10',
    baseDate,
    householdTimeZone: 'UTC',
  });
  const febPreview = calculateStrategyScenario({
    debts,
    strategy: 'avalanche',
    baselineExtraMonthlyPayment: 300,
    monthlyExtraAmount: 300,
    oneTimeExtraAmount: 1000,
    oneTimeDate: '2027-02-10',
    baseDate,
    householdTimeZone: 'UTC',
  });

  assert.equal(decPreview.firstPayment.totalPaid, 1500);
  assert.equal(decPreview.firstPayment.scenarioExtraPaid, 1300);
  assert.equal(febPreview.firstPayment.totalPaid, 500);
  assert.equal(febPreview.firstPayment.scenarioExtraPaid, 300);
  assert.equal(febPreview.oneTimePeriod, 3);
  assert.equal(febPreview.oneTimePayment.totalPaid, 1500);
  assert.equal(febPreview.oneTimePayment.scenarioExtraPaid, 1300);
  assert.ok(decPreview.projected.totalInterest < febPreview.projected.totalInterest);
});

test('T-347: calendarDaysBetween handles same-day, cross-month, DST boundaries, leap years, and negative diffs', () => {
  assert.equal(calendarDaysBetween('2026-03-09', '2026-03-09'), 0);
  assert.equal(calendarDaysBetween('2026-03-09', '2026-04-03'), 25);
  assert.equal(calendarDaysBetween('2026-08-01', '2026-09-08'), 38);
  assert.equal(calendarDaysBetween('2026-09-08', '2026-10-02'), 24);
  // US DST spring-forward (2026-03-08) and fall-back (2026-11-01)
  assert.equal(calendarDaysBetween('2026-03-07', '2026-03-09'), 2);
  assert.equal(calendarDaysBetween('2026-10-31', '2026-11-02'), 2);
  // Leap year Feb 29
  assert.equal(calendarDaysBetween('2024-02-28', '2024-03-01'), 2);
  assert.equal(calendarDaysBetween('2026-02-28', '2026-03-01'), 1);
  // Negative diff
  assert.equal(calendarDaysBetween('2026-04-03', '2026-03-09'), -25);
});

test('T-347: Actual/365 daily simple interest progression matches 9-payment Auto loan schedule and same-day extra payment', () => {
  const schedule = [
    { date: '2026-03-09', expectedDays: 30, expectedInterest: 117.88 },
    { date: '2026-04-03', expectedDays: 25, expectedInterest: 96.36 },
    { date: '2026-05-02', expectedDays: 29, expectedInterest: 109.49 },
    { date: '2026-05-30', expectedDays: 28, expectedInterest: 103.57 },
    { date: '2026-06-30', expectedDays: 31, expectedInterest: 112.26 },
    { date: '2026-08-01', expectedDays: 32, expectedInterest: 113.45 },
    { date: '2026-09-08', expectedDays: 38, expectedInterest: 131.84 },
    { date: '2026-10-02', expectedDays: 24, expectedInterest: 81.51 },
    { date: '2026-11-02', expectedDays: 31, expectedInterest: 102.78 },
  ];

  let balance = 24516.35;
  const apr = 5.85;
  const paymentAmount = 587.30;
  const txs = [
    { id: 'tx-init', accountId: 'auto-1', date: '2026-02-07', category: 'payment', deletedAt: null },
  ];

  const interestsByDate = new Map();
  let previousDailyCost = Infinity;

  for (let i = 0; i < schedule.length; i += 1) {
    const row = schedule[i];
    const est = resolveAutoLoanSplitSuggestion({
      debt: { id: 'auto-1', balance, apr },
      paymentAmount,
      paymentDate: row.date,
      transactions: txs,
      currencyCode: 'USD',
    });
    assert.equal(est.method, 'daily_simple');
    assert.equal(est.daysElapsed, row.expectedDays);
    assert.ok(
      Math.round(Math.abs(est.suggestion.interest - row.expectedInterest) * 100) <= 1,
      `Row ${row.date}: expected interest ~${row.expectedInterest}, got ${est.suggestion.interest}`,
    );
    assert.ok(est.dailyInterestCost < previousDailyCost);
    previousDailyCost = est.dailyInterestCost;
    interestsByDate.set(row.date, est.suggestion.interest);

    balance = projectedLoanBalanceAfterPrincipal(balance, est.suggestion.principal, 'USD');
    txs.push({ id: `tx-${i + 1}`, accountId: 'auto-1', date: row.date, category: 'payment', deletedAt: null });
  }

  assert.ok(interestsByDate.get('2026-09-08') > interestsByDate.get('2026-10-02'));
  assert.ok(Math.abs(balance - 20199.79) <= 0.05, `Expected ending balance ~20199.79, got ${balance}`);
  const finalDailyCost = calculateDailyInterestCost(balance, apr);
  assert.ok(Math.abs(finalDailyCost - 3.24) < 0.01, `Expected final daily cost ~$3.24/day, got ${finalDailyCost}`);

  // Same-day extra auto payment: 0 days elapsed -> $0 interest, full payment to principal, capped at remaining balance
  const sameDayExtra = resolveAutoLoanSplitSuggestion({
    debt: { id: 'auto-1', balance: 500, apr },
    paymentAmount: 650,
    paymentDate: '2026-11-02',
    transactions: txs,
    currencyCode: 'USD',
  });
  assert.equal(sameDayExtra.method, 'daily_simple');
  assert.equal(sameDayExtra.daysElapsed, 0);
  assert.equal(sameDayExtra.suggestion.interest, 0);
  assert.equal(sameDayExtra.suggestion.principal, 500);
});

test('T-347: findPreviousLoanPaymentDate, resolveAutoLoanSplitSuggestion, and resolveNextAutoDueDate handle exclusions, bill links, fallbacks, and month clamping', () => {
  const txs = [
    { id: 'bill:bill-auto:2026-09-01', accountId: null, date: '2026-09-01', category: 'debit_bill', deletedAt: null, memo: 'Auto bill [bill:bill-auto]' },
    { id: 'tx-charge', accountId: 'auto-1', date: '2026-10-05', category: 'fee', deletedAt: null },
    { id: 'tx-pending', accountId: 'auto-1', date: '2026-10-12', category: 'payment', deletedAt: null, isPending: true },
    { id: 'tx-deleted', accountId: 'auto-1', date: '2026-10-15', category: 'payment', deletedAt: '2026-10-16T00:00:00Z' },
    { id: 'tx-confirmed', accountId: 'auto-1', date: '2026-10-02', category: 'payment', deletedAt: null },
    { id: 'tx-future', accountId: 'auto-1', date: '2026-11-15', category: 'payment', deletedAt: null },
  ];

  assert.equal(
    findPreviousLoanPaymentDate({ debtId: 'auto-1', transactions: txs, onOrBeforeDate: '2026-11-02' }),
    '2026-10-02',
  );
  // Excluding tx-confirmed falls back to legacy linked bill payment
  assert.equal(
    findPreviousLoanPaymentDate({
      debtId: 'auto-1',
      transactions: txs,
      onOrBeforeDate: '2026-11-02',
      excludeTransactionId: 'tx-confirmed',
      linkedBillIds: ['bill-auto'],
    }),
    '2026-09-01',
  );

  // Fallback to monthly when no prior payment exists
  const noHistoryEst = resolveAutoLoanSplitSuggestion({
    debt: { id: 'auto-new', balance: 12000, apr: 6 },
    paymentAmount: 400,
    paymentDate: '2026-11-02',
    transactions: txs,
    currencyCode: 'USD',
  });
  assert.equal(noHistoryEst.method, 'monthly');
  assert.equal(noHistoryEst.daysElapsed, null);
  assert.equal(noHistoryEst.lastPaymentDate, null);
  assert.equal(noHistoryEst.suggestion.interest, 60);
  assert.equal(noHistoryEst.suggestion.principal, 340);

  // Explicit preferredMethod: 'monthly' overrides daily_simple even when prior payment exists
  const forcedMonthly = resolveAutoLoanSplitSuggestion({
    debt: { id: 'auto-1', balance: 12000, apr: 6 },
    paymentAmount: 400,
    paymentDate: '2026-11-02',
    transactions: txs,
    currencyCode: 'USD',
    preferredMethod: 'monthly',
  });
  assert.equal(forcedMonthly.method, 'monthly');
  assert.equal(forcedMonthly.daysElapsed, null);
  assert.equal(forcedMonthly.lastPaymentDate, '2026-10-02');
  assert.equal(forcedMonthly.suggestion.interest, 60);

  // resolveNextAutoDueDate advances past today & lastPaymentDate and clamps day 31 in shorter months
  assert.equal(resolveNextAutoDueDate({ dueDay: null, today: '2026-11-01' }), null);
  assert.equal(
    resolveNextAutoDueDate({ dueDay: 31, today: '2026-11-01', lastPaymentDate: '2026-10-31' }),
    '2026-11-30',
  );
  assert.equal(
    resolveNextAutoDueDate({ dueDay: 31, today: '2026-11-30', lastPaymentDate: '2026-11-30' }),
    '2026-12-31',
  );
  assert.equal(
    resolveNextAutoDueDate({ dueDay: 31, today: '2026-02-15', lastPaymentDate: null }),
    '2026-02-28',
  );
});
