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

test('Transactions History filters use Direction 1 All chips, active chips, and a separate four-way sort sheet', () => {
  const source = readFileSync(new URL('../src/screens/TransactionsScreen.tsx', import.meta.url), 'utf8');
  assert.match(source, /filterChip\('All', draftTypes\.length === 0/);
  assert.match(source, /filterChip\('All', draftAccountGroups\.length === 0 && draftAccountIds\.length === 0/);
  assert.match(source, /Choose specific accounts/);
  assert.match(source, /accessibilityLabel="Reset filters"/);
  assert.match(source, /accessibilityLabel="Apply filters"/);
  assert.match(source, /Show \$\{draftMatchCount\}/);
  assert.match(source, /Active transaction filters/);
  assert.match(source, /Clear all filters/);
  assert.match(source, /Sort by/);
  assert.match(source, /Highest amount/);
  assert.match(source, /Lowest amount/);
  assert.doesNotMatch(source, /Debit Cards/);
  assert.doesNotMatch(source, /Cancel filters/);

  for (const label of ['Payments', 'Bills', 'Purchases', 'Interest & fees', 'Refunds & adj.']) {
    assert.match(source, new RegExp(`label: '${label}'`));
  }
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
  assert.match(budget, /CASH OUTFLOW/);
  assert.match(budget, /DEBT TUG-OF-WAR/);
  assert.match(budget, /Paid to Debt/);
  assert.match(budget, /New Card Charges/);
  assert.match(budget, /cashBreakdown[\s\S]*categoryKey !== 'charges'/);
  assert.match(budget, /accessibilityLabel="Previous expense month"/);
  assert.match(budget, /accessibilityLabel="Next expense month"/);
  assert.doesNotMatch(budget, /Actual Cash Flow|Cash to Debt Payments|Net Balance Change/);
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

test('T-329B: Pull-to-refresh settles cleanly with bounded timeouts, search syncs safely, modals isolate drafts, and History memos/windowing stay stable', () => {
  const onboard = readFileSync(new URL('../src/OnboardingAndHome.tsx', import.meta.url), 'utf8');
  assert.match(onboard, /REFRESH_TIMEOUT_MS\s*=\s*15_000/);
  assert.match(onboard, /withRefreshTimeout/);
  assert.doesNotMatch(onboard, /void onRefreshHouseholdContexts\?\.\(\)/);
  assert.match(onboard, /const OnboardingDebtFormCard = memo\(/);

  const ptr = readFileSync(new URL('../src/components/PullToRefreshScrollView.tsx', import.meta.url), 'utf8');
  assert.match(ptr, /settlingSafetyTimerRef/);
  assert.match(ptr, /collapseSafetyTimerRef/);
  assert.match(ptr, /Promise\.resolve\(\)\.then\(\(\) => onRefreshRef\.current\?\.\(\)\)/);
  assert.doesNotMatch(ptr, /if \(finished && !refreshingRef\.current/);
  assert.match(ptr, /pullY\.stopAnimation\(\)/);

  const home = readFileSync(new URL('../src/screens/HomeScreen.tsx', import.meta.url), 'utf8');
  assert.match(home, /REFRESH_SAFETY_TIMEOUT_MS\s*=\s*16_000/);
  assert.match(home, /const DebtEditorModal = memo\(/);
  assert.match(home, /actionBusyRef/);

  const debt = readFileSync(new URL('../src/screens/DebtScreen.tsx', import.meta.url), 'utf8');
  assert.match(debt, /export const DebtScreen = memo\(/);
  assert.match(debt, /const AccountQuickTransactionModal = memo\(/);
  assert.match(debt, /searchDirty/);
  assert.match(debt, /clearSearch/);
  assert.match(debt, /savingAccountTxRef/);

  const tx = readFileSync(new URL('../src/screens/TransactionsScreen.tsx', import.meta.url), 'utf8');
  assert.match(tx, /export const TransactionsScreen = memo\(/);
  assert.match(tx, /const AddTransactionModal = memo\(/);
  assert.match(tx, /const EditTransactionModal = memo\(/);
  assert.match(tx, /searchDirty/);
  assert.match(tx, /clearSearch/);
  assert.match(tx, /const TYPE_FILTER_OPTIONS:/);
  assert.match(tx, /\{\s*totalPaymentsMinor,\s*totalInterestFeesMinor\s*\}\s*=\s*useMemo\(/);
  assert.match(tx, /savingTxRef/);
  assert.match(tx, /savingEditRef/);
  assert.match(tx, /deletingTxRef/);

  const budget = readFileSync(new URL('../src/screens/BudgetScreen.tsx', import.meta.url), 'utf8');
  assert.match(budget, /export const BudgetScreen = memo\(/);

  const progress = readFileSync(new URL('../src/screens/ProgressScreen.tsx', import.meta.url), 'utf8');
  assert.match(progress, /export const ProgressScreen = memo\(/);
});

test('T-336: Transactions distinguishes Auto-Bill from Bill Payment, Scheduled opens ObligationPaySheet, and ObligationPaySheet uses busyRef', () => {
  const tx = readFileSync(new URL('../src/screens/TransactionsScreen.tsx', import.meta.url), 'utf8');
  assert.match(tx, /const formatTransactionSourceLabel = \(source\?: string, memo\?: string \| null\): string =>/);
  assert.match(tx, /memo\?\.startsWith\('Auto-recorded recurring bill'\) \? 'Auto-Bill' : 'Bill Payment'/);
  assert.match(tx, /formatTransactionSourceLabel\(tx\.source, tx\.memo\)/);
  assert.match(tx, /findUnassignedPaymentsForObligation\(match\.obligation, transactions\)/);
  assert.match(tx, /hasMatchCandidates \? 'Match \/ Pay' : 'Pay'/);
  assert.match(tx, /onPress=\{\(\) => onOpenPaySheet\(buildPayTarget\(\)\)\}/);
  assert.match(tx, /<ObligationPaySheet[\s\S]*target=\{payTarget\}[\s\S]*onUpdateTransaction=\{onUpdateTransaction\}/);

  const paySheet = readFileSync(new URL('../src/components/ObligationPaySheet.tsx', import.meta.url), 'utf8');
  assert.match(paySheet, /const busyRef = useRef\(false\)/);
  assert.match(paySheet, /handleMatchPayment[\s\S]*busyRef\.current/);
  assert.match(paySheet, /handleRecordNewPayment[\s\S]*busyRef\.current/);
});

test('T-345: BudgetScreen and TransactionsScreen render cross-month For due-date clarity labels and PAID EARLIER card', () => {
  const budget = readFileSync(new URL('../src/screens/BudgetScreen.tsx', import.meta.url), 'utf8');
  assert.match(budget, /resolveExpenseTxDisplay/);
  assert.match(budget, /tx\.appliesToDate && tx\.appliesToDate\.slice\(0, 7\) !== tx\.date\.slice\(0, 7\)/);
  assert.match(budget, /' · For ' \+ formatShortDate\(tx\.appliesToDate\)/);
  assert.match(budget, /expenseSummary\.paidEarlyForMonth\.length > 0/);
  assert.match(budget, /PAID EARLIER/);
  assert.match(budget, /Counted in the month paid/);
  assert.match(budget, /'Paid ' \+ formatShortDate\(tx\.date\) \+ ' · For ' \+ formatShortDate\(tx\.appliesToDate!\)/);

  const tx = readFileSync(new URL('../src/screens/TransactionsScreen.tsx', import.meta.url), 'utf8');
  assert.match(tx, /tx\.appliesToDate && tx\.appliesToDate\.slice\(0, 7\) !== tx\.date\.slice\(0, 7\)/);
  assert.match(tx, /· For \$\{formatShortMonthDay\(tx\.appliesToDate\)\}/);
});

test('T-346: ObligationPaySheet, SnapshotCard, HomeScreen, TransactionsScreen, and DebtScreen wire universal Mortgage/Auto P/I/Escrow splits cleanly', () => {
  const paySheet = readFileSync(new URL('../src/components/ObligationPaySheet.tsx', import.meta.url), 'utf8');
  assert.match(paySheet, /suggestLoanPaymentSplit/);
  assert.match(paySheet, /canSuggestLoanPaymentSplit/);
  assert.match(paySheet, /projectedLoanBalanceAfterPrincipal/);
  assert.match(paySheet, /principalAmount/);
  assert.match(paySheet, /interestAmount/);
  assert.match(paySheet, /escrowAmount/);
  assert.match(paySheet, /accountId:\s*loanDebt\.id/);
  assert.match(paySheet, /\[bill:\$\{bill\.id\}\]/);

  const home = readFileSync(new URL('../src/screens/HomeScreen.tsx', import.meta.url), 'utf8');
  assert.match(home, /<ObligationPaySheet[\s\S]*debts=\{onboardingData\.debts\}[\s\S]*mortgageEscrowByDebtId=\{onboardingData\.mortgageEscrowByDebtId\}/);
  assert.match(home, /<SnapshotCard[\s\S]*mortgageEscrowByDebtId=\{onboardingData\.mortgageEscrowByDebtId\}[\s\S]*currencyCode=\{currencyCode\}/);

  const tx = readFileSync(new URL('../src/screens/TransactionsScreen.tsx', import.meta.url), 'utf8');
  assert.match(tx, /<ObligationPaySheet[\s\S]*debts=\{debts\}[\s\S]*mortgageEscrowByDebtId=\{mortgageEscrowByDebtId\}/);
  assert.match(tx, /canSuggestLoanPaymentSplit/);

  const financial = readFileSync(new URL('../src/components/FinancialScreen.tsx', import.meta.url), 'utf8');
  assert.match(financial, /Next payment est\./);
  assert.match(financial, /canSuggestLoanPaymentSplit/);

  const debt = readFileSync(new URL('../src/screens/DebtScreen.tsx', import.meta.url), 'utf8');
  assert.match(debt, /Next payment estimate/);
  assert.match(debt, /canSuggestLoanPaymentSplit/);
});

test('T-347: Auto loans use Actual/365 daily simple interest split with Daily/Monthly toggle across PaySheet, Overview, Add/Edit Tx, and Home Snapshot', () => {
  const paySheet = readFileSync(new URL('../src/components/ObligationPaySheet.tsx', import.meta.url), 'utf8');
  assert.match(paySheet, /resolveAutoLoanSplitSuggestion/);
  assert.match(paySheet, /autoMethodOverride/);
  assert.match(paySheet, /Daily \(\$\{rawDays\}d\)/);
  assert.match(paySheet, /'Monthly'/);

  const debt = readFileSync(new URL('../src/screens/DebtScreen.tsx', import.meta.url), 'utf8');
  assert.match(debt, /resolveAutoLoanSplitSuggestion/);
  assert.match(debt, /dailyInterestCost/);
  assert.match(debt, /<AccountQuickTransactionModal[\s\S]*transactions=\{transactions\}[\s\S]*linkedBillIds=\{selectedLinkedBillIds\}/);

  const tx = readFileSync(new URL('../src/screens/TransactionsScreen.tsx', import.meta.url), 'utf8');
  assert.match(tx, /<AddTransactionModal[\s\S]*transactions=\{transactions\}[\s\S]*loanBillPairs=\{loanBillPairs\}/);
  assert.match(tx, /<EditTransactionModal[\s\S]*transactions=\{transactions\}[\s\S]*loanBillPairs=\{loanBillPairs\}/);
  assert.match(tx, /const AddTransactionModal = memo[\s\S]*?resolveAutoLoanSplitSuggestion[\s\S]*?Suggest P\/I split/);
  assert.match(tx, /const EditTransactionModal = memo[\s\S]*?resolveAutoLoanSplitSuggestion[\s\S]*?Suggest P\/I split/);

  const financial = readFileSync(new URL('../src/components/FinancialScreen.tsx', import.meta.url), 'utf8');
  assert.match(financial, /autoSplitTotals/);
  assert.match(financial, /Daily cost/);
  assert.match(financial, /resolveAutoLoanSplitSuggestion/);

  const home = readFileSync(new URL('../src/screens/HomeScreen.tsx', import.meta.url), 'utf8');
  assert.match(home, /<SnapshotCard[\s\S]*transactions=\{transactions\}[\s\S]*loanBillPairs=\{loanBillPairs\}[\s\S]*historicalBillIdsByDebtId=\{historicalLoanBillIds\}[\s\S]*todayDate=\{todayKey\}/);
});
