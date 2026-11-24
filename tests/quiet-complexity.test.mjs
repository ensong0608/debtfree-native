import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeMoney } from '../src/finance/money.ts';
import { calculatePayoff, calculateSnowflakeImpact, calculateConsolidationComparison } from '../src/finance/payoff.ts';
import { calculatePayoffPlan, calculateStrategyScenario, comparePayoffStrategies, createDefaultOnboardingData } from '../src/onboarding-domain.ts';
import { validateNativeBackup } from '../src/finance/backup.ts';
import { calculateBillMonthlyReserve, calculateCategoryBreakdown, calculateSafeExtraToday } from '../src/finance/budget.ts';
import { calculateUtilizationAdvisor } from '../src/finance/progress.ts';
import { buildMilestoneNotificationPayloads } from '../src/notifications.ts';
import { buildTransactionsCsv, parseBankCsv, buildSplitTransactionPayloads, detectRecurringCandidates } from '../src/finance/csv.ts';

const money = (amount) => makeMoney('USD', Math.round(amount * 100));
const context = { householdId: 'hh-test', source: { id: 'test', kind: 'projection' }, asOf: '2026-01-01', coverage: { status: 'complete', description: 'test accounts' } };
const assumptions = { firstPaymentDate: '2026-01-15', requestedDay: 15, householdTimeZone: 'UTC' };
const payoffInput = (accounts, options = {}) => ({ accounts: { status: 'available', data: accounts, context }, assumptions, strategy: 'avalanche', currency: 'USD', extraMonthlyPayment: money(100), ...options });
const account = (accountId, balance, aprThousandths, scheduledMinimum = 100, extra = {}) => ({ accountId, inclusion: 'accelerated', balance: money(balance), aprThousandths, scheduledMinimum: money(scheduledMinimum), ...extra });

test('promo APR is applied through its end date and lowers interest against flat APR', () => {
  const promo = calculatePayoff(payoffInput([account('card', 1200, 24990, 50, { promo: { promoAprThousandths: 0, promoEndDate: '2026-03-01', postPromoAprThousandths: 24990 } })]));
  const flat = calculatePayoff(payoffInput([account('card', 1200, 24990, 50)]));
  assert.equal(promo.status, 'paidOff'); assert.equal(flat.status, 'paidOff');
  assert.ok(promo.totalInterest.minorUnits < flat.totalInterest.minorUnits);
  assert.ok(promo.schedule.some(period => period.paymentDate > '2026-03-01' && period.accounts[0].interestAccrued.minorUnits > 0));
});

test('custom payoff order is honored by both payoff APIs', () => {
  const cards = [account('high-apr', 1000, 30000), account('custom-first', 1000, 10000)];
  const direct = calculatePayoff(payoffInput(cards, { strategy: 'custom', customOrderIds: ['custom-first', 'high-apr'] }));
  assert.equal(direct.status, 'paidOff');
  assert.equal(direct.schedule[0].accounts.find(row => row.accountId === 'custom-first').extraPaid.minorUnits, 10000);
  const debt = (id, apr) => ({ id, name: id, category: 'Credit card', balance: 1000, originalBalance: null, apr, minimumPayment: 100, dueDay: null, creditLimit: null });
  const plan = calculatePayoffPlan([debt('high-apr', 30), debt('custom-first', 10)], 'custom', 100, new Date('2026-01-01T12:00:00Z'), 'USD', 'UTC', [], 0, 0, 1, undefined, ['custom-first', 'high-apr']);
  assert.equal(plan.payoffOrder[0].id, 'custom-first');
});

test('snowflake boost saves payoff time and interest', () => {
  const impact = calculateSnowflakeImpact(payoffInput([account('card', 3000, 19990, 100)]), money(500), 'oneTime');
  assert.ok(impact); assert.ok(impact.monthsSaved > 0); assert.ok(impact.interestSaved.minorUnits > 0);
});

test('consolidation comparison accounts for low and high transfer fees', () => {
  const params = { accounts: [{ balance: money(5000), aprThousandths: 24990, scheduledMinimum: money(150) }], offerAprThousandths: 5000, transferFeeBps: 100, monthlyPayment: money(300), currency: 'USD', assumptions };
  const lowFee = calculateConsolidationComparison(params); const highFee = calculateConsolidationComparison({ ...params, transferFeeBps: 3000 });
  assert.equal(lowFee.worthIt, true); assert.equal(lowFee.feeAmount.minorUnits, 5000);
  assert.equal(highFee.worthIt, false);
});

test('backup accepts card promo terms and rejects promo terms on an auto loan', () => {
  const owner = { userId: 'test-user', householdId: 'hh-test' };
  const backup = (category) => {
    const onboardingData = createDefaultOnboardingData(owner.userId);
    onboardingData.householdId = owner.householdId; onboardingData.countryCode = 'US'; onboardingData.currencyCode = 'USD';
    onboardingData.promoTermsByDebtId = { debt1: { promoApr: 0, promoEndDate: '2026-06-01', postPromoApr: 24.99 } };
    onboardingData.debts = [{ id: 'debt1', name: 'Test debt', category, balance: 1000, originalBalance: null, apr: 24.99, minimumPayment: 50, dueDay: category === 'Auto loan' ? 15 : null, creditLimit: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }];
    return { schema: 'debtfree-native-backup', version: 1, userId: owner.userId, householdId: owner.householdId, currency: 'USD', exportedAt: '2026-01-01T00:00:00Z', onboardingData, transactions: [], recurringBills: [], reconciliationAnchors: [] };
  };
  assert.doesNotThrow(() => validateNativeBackup(backup('Credit card'), owner));
  assert.throws(() => validateNativeBackup(backup('Auto loan'), owner));
});

test('bill reserves divide by their billing interval and safe extra reports all cashflow states', () => {
  assert.equal(calculateBillMonthlyReserve(money(120), 'quarterly').minorUnits, 4000);
  assert.equal(calculateBillMonthlyReserve(money(120), 'semiannual').minorUnits, 2000);
  assert.equal(calculateBillMonthlyReserve(money(120), 'annual').minorUnits, 1000);
  assert.deepEqual(calculateSafeExtraToday({ remainingMonthlyCashflow: 500, unsettled14dObligations: 100, currencyCode: 'USD' }), { safeExtraAmount: 400, status: 'surplus' });
  assert.deepEqual(calculateSafeExtraToday({ remainingMonthlyCashflow: 100, unsettled14dObligations: 100, currencyCode: 'USD' }), { safeExtraAmount: 0, status: 'tight' });
  assert.deepEqual(calculateSafeExtraToday({ remainingMonthlyCashflow: 50, unsettled14dObligations: 100, currencyCode: 'USD' }), { safeExtraAmount: 0, status: 'deficit' });
});

test('utilization advisor prioritizes highest APR card and calculates exact 30% paydown', () => {
  const result = calculateUtilizationAdvisor([
    { id: 'lower-apr', name: 'Lower APR', category: 'Credit card', balance: 900, originalBalance: null, creditLimit: 1000, apr: 19.99 },
    { id: 'higher-apr', name: 'Higher APR', category: 'Credit card', balance: 800, originalBalance: null, creditLimit: 1000, apr: 29.99 },
  ]);
  assert.equal(result.bestCardId, 'higher-apr'); assert.equal(result.paydownTo30, 500); assert.equal(result.projectedCardPercent, 30);
});

test('milestone payloads skip already notified IDs and all output when disabled', () => {
  const milestones = [{ id: 'done', title: 'Debt paid', status: 'completed' }, { id: 'open', title: 'Keep going', status: 'in_progress' }];
  assert.deepEqual(buildMilestoneNotificationPayloads(milestones, ['done'], true), []);
  assert.deepEqual(buildMilestoneNotificationPayloads(milestones, [], false), []);
});

test('transaction CSV uses RFC-4180 quote escaping', () => {
  const tx = { id: 'tx1', date: '2026-01-01', source: 'manual', accountId: 'debt1', category: 'purchase', payee: 'Cafe, "North"', amount: money(12.34), memo: 'first line\nsecond', deletedAt: null };
  const csv = buildTransactionsCsv([tx], [{ id: 'debt1', name: 'Card' }], [], 'USD');
  assert.equal(csv, 'Date,Type,AccountOrBill,Category,Payee,Amount,Memo\r\n2026-01-01,manual,Card,purchase,"Cafe, ""North""",12.34,"first line\nsecond"');
});

test('bank CSV parses both date formats, flags matching duplicates, and keeps distinct same-day payees', () => {
  const existing = [{ id: 'old', date: '2026-01-02', payee: 'Coffee Corner', amount: money(12.5), deletedAt: null }];
  const rows = parseBankCsv('Date,Description,Amount\n01/02/2026,Coffee Corner,12.50\n01/02/2026,Market,12.50\n2026-01-03,Bookshop,8.00', existing, 'USD');
  assert.deepEqual(rows.map(row => row.date), ['2026-01-02', '2026-01-02', '2026-01-03']);
  assert.deepEqual(rows.map(row => row.likelyDuplicate), [true, false, false]);
});

test('split transaction payloads require exact sum and recurring purchases match monthly', () => {
  const parts = [{ label: 'one', amount: money(4) }, { label: 'two', amount: money(6) }];
  assert.equal(buildSplitTransactionPayloads(money(10), parts).length, 2);
  assert.throws(() => buildSplitTransactionPayloads(money(10.01), parts), /add up to the total/);
  const tx = (id, date) => ({ id, date, payee: 'Gym Membership', source: 'manual', category: 'purchase', amount: money(49.99), deletedAt: null });
  const candidates = detectRecurringCandidates([tx('jan', '2026-01-05'), tx('feb', '2026-02-04')], []);
  assert.equal(candidates.length, 1); assert.deepEqual(candidates[0].transactionIds, ['jan', 'feb']);
});

test('custom strategy comparison, budget Payoff Budget label, UI contracts, and SQL settings allowlist align', () => {
  const debt = (id, apr) => ({ id, name: id, category: 'Credit card', balance: 1000, originalBalance: null, apr, minimumPayment: 100, dueDay: null, creditLimit: null });
  const comparison = comparePayoffStrategies([debt('high-apr', 30), debt('custom-first', 10)], 'custom', 100, new Date('2026-01-01T12:00:00Z'), 'USD', 'UTC', [], 0, 1, undefined, ['custom-first', 'high-apr']);
  assert.equal(comparison.activePlan.payoffOrder[0].id, 'custom-first');
  const scenario = calculateStrategyScenario({ debts: [debt('high-apr', 30), debt('custom-first', 10)], strategy: 'custom', baselineExtraMonthlyPayment: 100, monthlyExtraAmount: 100, baseDate: new Date('2026-01-01T12:00:00Z'), currencyCode: 'USD', householdTimeZone: 'UTC', customPayoffOrder: ['custom-first', 'high-apr'] });
  assert.equal(scenario.firstPayment.allocations[0].accountId, 'custom-first');
  assert.equal(scenario.firstPayment.allocations[0].scenarioExtraPaid, 100);

  const rows = calculateCategoryBreakdown({ recurringBills: [], monthlyIncome: 1000, monthlyDebtPlanPayment: 250, currencyCode: 'USD' });
  assert.equal(rows[0].label, 'Payoff Budget');

  const debtSrc = readFileSync(new URL('../src/screens/DebtScreen.tsx', import.meta.url), 'utf8');
  assert.match(debtSrc, /accessibilityLabel="Advanced account options"/);
  assert.match(debtSrc, /Custom payoff order active/);
  assert.match(debtSrc, /Tap ↑ ↓ to reorder/);

  const txSrc = readFileSync(new URL('../src/screens/TransactionsScreen.tsx', import.meta.url), 'utf8');
  assert.match(txSrc, /accessibilityLabel="Import CSV"/);

  const budgetSrc = readFileSync(new URL('../src/screens/BudgetScreen.tsx', import.meta.url), 'utf8');
  assert.match(budgetSrc, /'Minimum \+ extra'/);

  const sql = readFileSync(new URL('../supabase/migrations/20261124100000_quiet_complexity_household_settings.sql', import.meta.url), 'utf8');
  for (const field of ['promoTermsByDebtId', 'customPayoffOrder', 'minimumModeByDebtId', 'variableCategoryCaps', 'irregularBillScheduleByBillId']) {
    assert.match(sql, new RegExp(`'${field}'`));
  }
  assert.match(sql, /'custom'/);
});
