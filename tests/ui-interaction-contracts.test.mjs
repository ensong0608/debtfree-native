import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);

test('FinancialScreen implements native horizontal paging ScrollView without JS PanResponder lag, black gap, or floating release pill', () => {
  const source = readFileSync(new URL('../src/components/FinancialScreen.tsx', import.meta.url), 'utf8');
  assert.match(source, /renderSegment\?:/);
  assert.match(source, /trackTranslateX/);
  assert.match(source, /useSideBySidePager/);
  assert.match(source, /<Animated\.ScrollView\b/);
  assert.match(source, /pagingEnabled/);
  assert.match(source, /nestedScrollEnabled/);
  assert.match(source, /directionalLockEnabled/);
  assert.match(source, /Animated\.event\(/);
  assert.doesNotMatch(source, /\bPanResponder\b/);
  assert.doesNotMatch(source, /swipePreview/);
  assert.doesNotMatch(source, /Release · /);
  assert.match(source, /PullToRefreshScrollView/);
  assert.doesNotMatch(source, /RefreshControl/);

  const debt = readFileSync(new URL('../src/screens/DebtScreen.tsx', import.meta.url), 'utf8');
  assert.match(debt, /<SwipeProtectedHorizontalArea\b/);
  assert.match(debt, /horizontal\s+nestedScrollEnabled/);
});

test('HomeScreen and FinancialScreen use PullToRefreshScrollView with Data updated confirmation and DFNPullDownView', () => {
  const home = readFileSync(new URL('../src/screens/HomeScreen.tsx', import.meta.url), 'utf8');
  assert.match(home, /<PullToRefreshScrollView\b/);
  assert.doesNotMatch(home, /RefreshControl/);

  const ptr = readFileSync(new URL('../src/components/PullToRefreshScrollView.tsx', import.meta.url), 'utf8');
  assert.match(ptr, /Pull down to refresh/);
  assert.match(ptr, /Release to refresh/);
  assert.match(ptr, /Refreshing data\.\.\./);
  assert.match(ptr, /Data updated/);
  assert.match(ptr, /translateY:\s*pullY/);
  assert.match(ptr, /DFNPullDownView/);

  for (const screenFile of ['../src/screens/DebtScreen.tsx', '../src/screens/TransactionsScreen.tsx', '../src/screens/ProgressScreen.tsx']) {
    const screenSource = readFileSync(new URL(screenFile, import.meta.url), 'utf8');
    assert.match(screenSource, /renderSegment=/);
  }
});

test('with-android-pull-down-view plugin generates DFNPullDownViewManager and registers DFNPullDownPackage idempotently', () => {
  const plugin = require('../plugins/with-android-pull-down-view.js');
  const sampleMainApp = `class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
        }
    )
  }
}`;
  const once = plugin.ensureMainApplicationRegistration(sampleMainApp);
  assert.match(once, /add\(DFNPullDownPackage\(\)\)/);
  const twice = plugin.ensureMainApplicationRegistration(once);
  assert.equal(twice, once);

  const kotlin = plugin.buildPullDownViewManagerKotlin('com.debtfree.nativetest');
  assert.match(kotlin, /class DFNPullDownViewManager : ViewGroupManager<DFNPullDownView>\(\)/);
  assert.match(kotlin, /class DFNSwipeBlockViewManager : ViewGroupManager<DFNSwipeBlockView>\(\)/);
  assert.match(kotlin, /requestDisallowInterceptTouchEvent\(true\)/);
  assert.match(kotlin, /NativeGestureUtil\.notifyNativeGestureStarted/);
  assert.match(kotlin, /topPullMove/);
  assert.match(kotlin, /topPullRelease/);
});

test('Transactions History Filters modal matches owner-specified Account Type, Transaction Type, and Apply-only footer', () => {
  const source = readFileSync(new URL('../src/screens/TransactionsScreen.tsx', import.meta.url), 'utf8');
  assert.match(source, /filterRadio\('All'/);
  assert.doesNotMatch(source, /All account types/);
  assert.doesNotMatch(source, /Debit Cards/);
  assert.doesNotMatch(source, /All types/);
  assert.doesNotMatch(source, /Debit only/);
  assert.doesNotMatch(source, /Charges and fees/);

  for (const label of ['Credit Card', 'Home', 'Auto', 'Subscriptions', 'Utilities', 'Insurance', 'Others']) {
    assert.match(source, new RegExp(`label: '${label}'`));
  }
  for (const label of ['Payments', 'Purchase', 'Fees', 'Others']) {
    assert.match(source, new RegExp(`label: '${label}'`));
  }
  assert.match(source, /accessibilityLabel="Apply filters"/);
  assert.doesNotMatch(source, /accessibilityLabel="Cancel filters"/);
});

test('T-301: Sub-tabs persist across bottom-tab switches and Phase 3 clarity features are wired', () => {
  const tabCtx = readFileSync(new URL('../src/components/TabShellContext.tsx', import.meta.url), 'utf8');
  assert.match(tabCtx, /debtSection:\s*'Accounts'\s*\|\s*'Strategy'/);
  assert.match(tabCtx, /transactionsSection:\s*'History'\s*\|\s*'Scheduled'/);
  assert.match(tabCtx, /progressSection:\s*'Overview'\s*\|\s*'Utilization'\s*\|\s*'Milestones'/);

  const shell = readFileSync(new URL('../src/FiveTabShell.tsx', import.meta.url), 'utf8');
  assert.match(shell, /uiPreferences,\s*setUiPreferences/);

  const debt = readFileSync(new URL('../src/screens/DebtScreen.tsx', import.meta.url), 'utf8');
  assert.match(debt, /uiPreferences\.debtSection/);
  assert.doesNotMatch(debt, /Weighted APR:/);
  assert.ok(debt.includes('Snowball vs. Avalanche comparison') && !debt.includes('Your method'), 'Strategy shows a collapsible comparison without the method heading');
  assert.doesNotMatch(debt, /WhatIfBoostSlider/);
  assert.ok(debt.includes('Monthly extra payment amount') && debt.includes('One-time extra payment amount'), 'Strategy has distinct editable amounts');
  assert.ok(debt.includes('One-time preview date'), 'Strategy exposes the preview date');
  assert.match(debt, /Save monthly plan/);
  assert.match(debt, /Saved plan/);
  assert.match(debt, /scenarioPlanLabel/);
  assert.match(debt, /First payment/);
  assert.match(debt, /<ScenarioAllocationRow\b/);
  assert.match(debt, /accessibilityHint="Toggles payment details and schedule"/);
  assert.match(debt, />Payoff order</);
  assert.doesNotMatch(debt, /Scenario payoff order/);
  assert.match(debt, /Payoff timeline/);
  assert.match(debt, /Suggest P\/I split/);

  const tx = readFileSync(new URL('../src/screens/TransactionsScreen.tsx', import.meta.url), 'utf8');
  assert.match(tx, /uiPreferences\.transactionsSection/);
  assert.match(tx, /Suggest P\/I split/);
  assert.doesNotMatch(tx, /Debit Cards/);
  assert.doesNotMatch(tx, /Debit Bill \(Checking\)/);
  assert.doesNotMatch(tx, /Debit Spending \(Checking\)/);

  const progress = readFileSync(new URL('../src/screens/ProgressScreen.tsx', import.meta.url), 'utf8');
  assert.match(progress, /uiPreferences\.progressSection/);
  assert.match(progress, /debt\.category === 'Credit card'/);
  assert.ok(progress.includes('Balance activity'), 'Overview preserves account activity');
  assert.ok(!/House & Auto|What changed|Recorded activity/.test(progress), 'Overview omits the removed recorded activity block');

  const budget = readFileSync(new URL('../src/screens/BudgetScreen.tsx', import.meta.url), 'utf8');
  assert.match(budget, /Checking \/ Debit/);
  assert.match(budget, /Annual card fee reserve/);
  assert.doesNotMatch(budget, />Debit Card</);

  const home = readFileSync(new URL('../src/screens/HomeScreen.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(home, /Weighted APR/);

  const onboard = readFileSync(new URL('../src/OnboardingAndHome.tsx', import.meta.url), 'utf8');
  assert.match(onboard, /four short steps/);
  assert.doesNotMatch(onboard, /five short steps/);
  assert.match(onboard, /Your home/);
  assert.match(onboard, /Payoff Plan Summary/);
  assert.doesNotMatch(onboard, /Weighted APR/);
});

test('Tab switching and Transactions screen keep visited panes alive, defer secondary segments, batch History rows, and gate closed modals', () => {
  const shell = readFileSync(new URL('../src/FiveTabShell.tsx', import.meta.url), 'utf8');
  assert.match(shell, /visitedTabs/);
  assert.match(shell, /styles\.hidden/);
  assert.match(shell, /hidden:\s*\{\s*display:\s*'none'\s*\}/);

  const finScreen = readFileSync(new URL('../src/components/FinancialScreen.tsx', import.meta.url), 'utf8');
  assert.match(finScreen, /readySegments/);
  assert.match(finScreen, /requestAnimationFrame/);
  assert.match(finScreen, /ActivityIndicator/);
  assert.match(finScreen, /onSegmentScrollNearEnd\?:/);

  const home = readFileSync(new URL('../src/screens/HomeScreen.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(home, /<TransactionsScreen[\s\S]{0,120}\bkey=/);

  const tx = readFileSync(new URL('../src/screens/TransactionsScreen.tsx', import.meta.url), 'utf8');
  assert.match(tx, /const HISTORY_PAGE_SIZE\s*=\s*30/);
  assert.match(tx, /const ScheduledSegment\s*=\s*memo\(/);
  assert.match(tx, /const TransactionHistoryRow\s*=\s*memo\(/);
  assert.match(tx, /visibleHistoryRows\.map\(/);
  assert.match(tx, /Show more \(/);
  assert.match(tx, /\{showFilters \?/);
  assert.match(tx, /\{showHistoryDatePicker \?/);
  assert.match(tx, /\{canEdit && splitPlanState && splitPlanRow \?/);
  assert.match(tx, /\{editingTx !== null \?/);
  assert.match(tx, /\{confirmDeleteTx !== null \?/);
  assert.match(tx, /\{confirmRemoveSplitRow !== null \?/);
});

test('T-312: BudgetScreen implements swipeable Budget and Expense segments with persisted section, shared month, and drilldown', () => {
  const tabCtx = readFileSync(new URL('../src/components/TabShellContext.tsx', import.meta.url), 'utf8');
  assert.match(tabCtx, /budgetSection:\s*'Budget'\s*\|\s*'Expense'/);
  assert.match(tabCtx, /budgetSection:\s*'Budget'/);

  const budget = readFileSync(new URL('../src/screens/BudgetScreen.tsx', import.meta.url), 'utf8');
  assert.match(budget, /uiPreferences\.budgetSection/);
  assert.match(budget, /segments=\{?\['Budget',\s*'Expense'\]\}?/);
  assert.match(budget, /renderSegment=/);
  assert.match(budget, /summarizeMonthlyExpenses/);
  assert.ok(['Actual Cash Flow', 'Cash to Debt Payments', 'Others', 'Charges', 'Net Balance Change']
    .every(label => budget.includes(`label: '${label}'`)), 'Expense summary should expose all five metrics');
  assert.doesNotMatch(budget, /Recorded expenses|Preview extra payment/);
  assert.match(budget, /onOpenPurchase\?\.\(tx\.id\)/);
  assert.match(budget, /InspireCornerArt/);
  assert.match(budget, /hero-budget/);
  assert.match(budget, /hero-expense/);
  assert.match(budget, /cardBorder/);
  assert.match(budget, /graphOutline/);
  assert.match(budget, /posInk/);
  assert.match(budget, /neg/);
  assert.match(budget, /Checking \/ Debit/);
  assert.match(budget, /Annual card fee reserve/);
  assert.doesNotMatch(budget, />Debit Card</);
});
