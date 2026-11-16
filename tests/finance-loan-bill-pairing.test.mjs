import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeLoanBillLinks,
  auditLegacyLoanPairings,
  createOnboardingLoanBill,
  isUnifiedBudgetLoanCategory,
  loansNeedingPairingReview,
  onboardingLoanBillSaveAction,
  pairedDebtMinimumTotal,
  selectUnifiedBudgetLoans,
  suggestLoanBills,
  unifiedExcludedBillIds,
  unifiedLoanBudgetCategory,
  withoutDeletedDebtPairing,
  withoutDeletedBillPairings,
  withoutIncompatibleDebtPairing,
  withoutIncompatibleBillPairings,
} from '../src/finance/loan-bill-pairing.ts';
import { getScheduledObligationRows, calculateOverdueObligations } from '../src/finance/payment-matching.ts';
import { calculateMonthlyCashflow, calculateCategoryBreakdown, buildMonthlyBudgetBreakdown, selectCardDebtCommitment } from '../src/finance/budget.ts';
import { calculateReconciledBalance, isPaidOffAccountArchived } from '../src/finance/ledger.ts';
import { makeMoney } from '../src/finance/money.ts';

const debt = { id: 'mortgage-1', name: 'Cedar Mortgage', category: 'Mortgage', balance: 90000, minimumPayment: 1000, dueDay: 15, createdAt: '2025-01-01T00:00:00Z' };
const bill = { id: 'bill-home', name: 'Cedar Mortgage', category: 'housing', amount: makeMoney('USD', 150000), dueDay: 20, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2025-01-01T00:00:00Z' };

test('loan suggestions remain proposals until the user confirms a persisted relation', () => {
  const proposals = suggestLoanBills(debt, [bill]);
  assert.deepEqual(proposals.map(row => row.id), ['bill-home']);
  assert.deepEqual(suggestLoanBills(debt, [{ ...bill, paymentMethod: 'credit' }]), []);
  assert.deepEqual(activeLoanBillLinks({}, [bill]), {});
  assert.deepEqual(loansNeedingPairingReview([debt], [bill], {}).map(row => row.id), ['mortgage-1']);
  assert.deepEqual(loansNeedingPairingReview([{ ...debt, id: 'auto-unmatched', category: 'Auto loan' }], [], {}).map(row => row.id), ['auto-unmatched']);
  assert.deepEqual(loansNeedingPairingReview([debt], [bill], { 'mortgage-1': { status: 'dismissed' } }), []);
  assert.deepEqual(activeLoanBillLinks({ 'mortgage-1': { status: 'linked', billId: 'bill-home' } }, [bill]), { 'mortgage-1': 'bill-home' });
  assert.deepEqual(activeLoanBillLinks({ 'mortgage-1': { status: 'linked', billId: 'bill-home' } }, [{ ...bill, active: false }]), {});
  assert.deepEqual(activeLoanBillLinks({ 'mortgage-1': { status: 'linked', billId: 'bill-home' } }, [{ ...bill, paymentMethod: 'credit' }], [debt]), {});
});

test('T-079 onboarding loan bills use stable IDs, debit commitments, and no synthetic transactions', () => {
  const auto = { ...debt, id: 'loan-stable-id', category: 'Auto loan', dueDay: 9, minimumPayment: 425.5 };
  const first = createOnboardingLoanBill(auto, 'USD', auto.createdAt);
  const retry = createOnboardingLoanBill(auto, 'USD', auto.createdAt);
  assert.equal(first.id, auto.id);
  assert.deepEqual(retry, first);
  assert.equal(first.amount.minorUnits, 42550);
  assert.equal(first.category, 'other_bill');
  assert.equal(first.paymentMethod, 'debit');
  assert.equal(first.autoPost, false);
  assert.throws(() => createOnboardingLoanBill({ ...auto, dueDay: null }, 'USD'), /due day/);
});

test('T-079 onboarding bill retries wait for readback and reuse a confirmed identical row', () => {
  const auto = { ...debt, id: 'loan-stable-id', category: 'Auto loan', dueDay: 9, minimumPayment: 425.5 };
  const desiredBill = createOnboardingLoanBill(auto, 'USD', auto.createdAt);
  const pending = { ...desiredBill };
  assert.equal(onboardingLoanBillSaveAction({ existingBill: pending, desiredBill, authoritativeSnapshot: false }), 'wait_for_recovery');
  assert.equal(onboardingLoanBillSaveAction({ existingBill: { ...desiredBill, updatedAt: '2026-11-07T00:00:00Z' }, desiredBill, authoritativeSnapshot: false }), 'wait_for_recovery');
  assert.equal(onboardingLoanBillSaveAction({ desiredBill, authoritativeSnapshot: false }), 'wait_for_recovery');
  assert.equal(onboardingLoanBillSaveAction({ existingBill: { ...desiredBill, updatedAt: '2026-11-07T00:00:00Z' }, desiredBill, authoritativeSnapshot: true }), 'reuse_confirmed');
  assert.equal(onboardingLoanBillSaveAction({ existingBill: { ...desiredBill, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00Z' }, desiredBill, authoritativeSnapshot: true }), 'reuse_confirmed');
  assert.equal(onboardingLoanBillSaveAction({ existingBill: { ...desiredBill, createdAt: 'bad timestamp', updatedAt: '2026-11-07T00:00:00Z' }, desiredBill: { ...desiredBill, createdAt: 'bad timestamp' }, authoritativeSnapshot: true }), 'conflict');
  assert.equal(onboardingLoanBillSaveAction({ existingBill: { ...desiredBill, amount: makeMoney('USD', 1), updatedAt: '2026-11-07T00:00:00Z' }, desiredBill, authoritativeSnapshot: true }), 'conflict');
  assert.equal(onboardingLoanBillSaveAction({ desiredBill, authoritativeSnapshot: true }), 'persist');
});

test('lifecycle cleanup removes only deleted or newly incompatible loan/bill relations', () => {
  const pairings = {
    [debt.id]: { status: 'linked', billId: bill.id },
    'auto-2': { status: 'linked', billId: 'bill-auto-2' },
    'other-loan': { status: 'dismissed' },
  };
  assert.deepEqual(withoutDeletedDebtPairing(pairings, debt.id), { 'auto-2': pairings['auto-2'], 'other-loan': pairings['other-loan'] });
  assert.deepEqual(withoutDeletedBillPairings(pairings, bill.id), { 'auto-2': pairings['auto-2'], 'other-loan': pairings['other-loan'] });
  assert.deepEqual(withoutIncompatibleDebtPairing(pairings, { ...debt, category: 'Credit card' }, [bill]), { 'auto-2': pairings['auto-2'], 'other-loan': pairings['other-loan'] });
  assert.deepEqual(withoutIncompatibleDebtPairing(pairings, { ...debt, category: 'Auto loan' }, [bill]), { 'auto-2': pairings['auto-2'], 'other-loan': pairings['other-loan'] });
  assert.deepEqual(withoutIncompatibleBillPairings(pairings, { ...bill, category: 'utilities' }, [debt]), { 'auto-2': pairings['auto-2'], 'other-loan': pairings['other-loan'] });
  assert.deepEqual(withoutIncompatibleBillPairings(pairings, { ...bill, paymentMethod: 'credit', creditAccountId: 'card' }, [debt]), { 'auto-2': pairings['auto-2'], 'other-loan': pairings['other-loan'] });
});

test('linked debt minimum is replaced once in budget commitments while its loan calculation is independent', () => {
  const pairings = { 'mortgage-1': { status: 'linked', billId: 'bill-home' } };
  assert.equal(pairedDebtMinimumTotal([debt], pairings), 0); // Mortgage projection is standalone, outside the shared debt-plan total.
  const autoDebt = { ...debt, id: 'auto-1', category: 'Auto loan' };
  assert.equal(pairedDebtMinimumTotal([autoDebt], { 'auto-1': { status: 'linked', billId: 'bill-auto' } }), 1000);
  const bills = [{ ...bill, amount: makeMoney('USD', 150000) }];
  const cashflow = calculateMonthlyCashflow({ monthlyIncome: 6000, recurringBills: bills, monthlyDebtPlanPayment: 1300, pairedDebtMinimums: 1000, currencyCode: 'USD' });
  assert.equal(cashflow.totalCommitments, 1800);
  const rows = calculateCategoryBreakdown({ recurringBills: bills, monthlyIncome: 6000, monthlyDebtPlanPayment: 1300, pairedDebtMinimums: 1000, debtAccountCount: 1, currencyCode: 'USD' });
  assert.equal(rows.find(row => row.categoryKey === 'debt').amount, 300);
  assert.equal(rows.find(row => row.categoryKey === 'housing').amount, 1500);
});

test('a linked account payment satisfies the one bill reminder in the same month, with no duplicate debt reminder', () => {
  const transaction = {
    id: 'loan-payment-1', accountId: debt.id, date: '2026-11-15', appliesToDate: '2026-11-15',
    amount: makeMoney('USD', 150000), category: 'payment', payee: 'Cedar Mortgage', source: 'manual',
    reconciled: true, createdAt: '2026-11-15T12:00:00Z', deletedAt: null,
  };
  const rows = getScheduledObligationRows({ debts: [debt], recurringBills: [bill], transactions: [transaction], asOfDate: '2026-11-01', currencyCode: 'USD', loanBillPairs: { [debt.id]: bill.id } });
  const november = rows.filter(row => row.dueCycleMonth === '2026-11');
  assert.equal(november.length, 1);
  assert.equal(november[0].kind, 'bill');
  assert.equal(november[0].state.status, 'paid');
  assert.equal(november[0].state.confirmedMatch.matchedTransactions.length, 1);
});

test('budget breakdown hides absent categories by record presence and inserts purchase totals there', () => {
  const categories = [
    { categoryKey: 'debt', label: 'Debt', amount: 0, percentOfIncome: 0, count: 0 },
    { categoryKey: 'housing', label: 'Housing', amount: 0, percentOfIncome: 0, count: 1 },
    { categoryKey: 'utilities', label: 'Utilities', amount: 0, percentOfIncome: 0, count: 0 },
  ];
  const visible = buildMonthlyBudgetBreakdown({ categories, hasActiveDebt: false, purchases: { total: 42, count: 2 }, monthlyIncome: 1000 });
  assert.deepEqual(visible.map(row => row.categoryKey), ['housing', 'purchases']);
  assert.equal(visible[0].amount, 0); // a present zero-dollar category remains visible
  assert.equal(visible[1].amount, 42);
});

test('T-273 canonical Mortgage and Auto loan identity routes directly into Budget without duplicate recurring bills', () => {
  assert.equal(isUnifiedBudgetLoanCategory('Mortgage'), true);
  assert.equal(isUnifiedBudgetLoanCategory('Auto loan'), true);
  assert.equal(isUnifiedBudgetLoanCategory('Credit card'), false);
  assert.equal(isUnifiedBudgetLoanCategory('Personal loan'), false);

  assert.equal(unifiedLoanBudgetCategory('Mortgage'), 'housing');
  assert.equal(unifiedLoanBudgetCategory('Auto loan'), 'custom:transportation');
  assert.equal(unifiedLoanBudgetCategory('Credit card'), null);

  const mortgage = { id: 'm-1', name: 'Primary Home', category: 'Mortgage', balance: 280000, minimumPayment: 1950, dueDay: 1, createdAt: '2026-11-01T00:00:00Z' };
  const auto = { id: 'a-1', name: 'Daily Driver', category: 'Auto loan', balance: 18500, minimumPayment: 485, dueDay: 12, createdAt: '2026-11-01T00:00:00Z' };
  const card = { id: 'c-1', name: 'Rewards Card', category: 'Credit card', balance: 4000, minimumPayment: 120, dueDay: 18, createdAt: '2026-11-01T00:00:00Z' };
  const paidOffZeroUnarchived = { id: 'a-zero', name: 'Manual Zero Auto', category: 'Auto loan', balance: 0, minimumPayment: 300, dueDay: 5, createdAt: '2026-11-01T00:00:00Z' };
  const paidOffArchived = { id: 'm-arch', name: 'Paid Home', category: 'Mortgage', balance: 0, minimumPayment: 1200, dueDay: 1, createdAt: '2025-01-01T00:00:00Z' };

  const selected = selectUnifiedBudgetLoans([mortgage, auto, card, paidOffZeroUnarchived, paidOffArchived], ['m-arch']);
  assert.deepEqual(selected.map(item => item.id), ['m-1', 'a-1']);
  assert.equal(isPaidOffAccountArchived(paidOffZeroUnarchived, []), false);
  assert.equal(isPaidOffAccountArchived(paidOffArchived, ['m-arch']), true);

  const commitment = selectCardDebtCommitment([mortgage, auto, card], 100, 'USD');
  assert.equal(commitment.total, 220);

  const cashflow = calculateMonthlyCashflow({
    monthlyIncome: 7000,
    recurringBills: [],
    unifiedLoans: selected,
    monthlyDebtPlanPayment: commitment.total,
    currencyCode: 'USD',
  });
  assert.equal(cashflow.totalDebitBills, 2435);
  assert.equal(cashflow.totalDebtPlanPayment, 220);
  assert.equal(cashflow.totalCommitments, 2655);

  const rows = getScheduledObligationRows({
    debts: [mortgage, auto],
    recurringBills: [],
    transactions: [],
    asOfDate: '2026-11-01',
    currencyCode: 'USD',
  });
  const novRows = rows.filter(row => row.dueCycleMonth === '2026-11');
  assert.equal(novRows.length, 2);
  assert.equal(novRows.every(row => row.kind === 'debt'), true);

  const autoPaymentUnallocated = {
    id: 'pay-a1-1',
    accountId: 'a-1',
    date: '2026-11-12',
    appliesToDate: '2026-11-12',
    amount: makeMoney('USD', 48500),
    category: 'payment',
    payee: 'Daily Driver',
    source: 'manual',
    reconciled: true,
    createdAt: '2026-11-12T10:00:00Z',
    deletedAt: null,
  };
  const updatedRows = getScheduledObligationRows({
    debts: [auto, paidOffArchived],
    recurringBills: [],
    transactions: [autoPaymentUnallocated],
    asOfDate: '2026-11-15',
    currencyCode: 'USD',
  });
  // Paid-off zero-balance loan generates zero scheduled obligations; active auto loan has one satisfied November row.
  assert.equal(updatedRows.some(row => row.debt?.id === 'm-arch'), false);
  const novAuto = updatedRows.filter(row => row.dueCycleMonth === '2026-11');
  assert.equal(novAuto.length, 1);
  assert.equal(novAuto[0].state.status, 'paid');
  assert.equal(novAuto[0].state.confirmedMatch.matchedTransactions.length, 1);
  assert.equal(calculateOverdueObligations({ debts: [auto], recurringBills: [], transactions: [autoPaymentUnallocated], asOfDate: '2026-11-15', currencyCode: 'USD' }).length, 0);

  // Unknown principal breakdown preserves balance; explicit principal allocation reduces principal once.
  assert.equal(calculateReconciledBalance({
    openingBalance: makeMoney('USD', 1850000),
    transactions: [autoPaymentUnallocated],
    accountId: 'a-1',
    debtCategory: 'Auto loan',
  }).currentBalance.minorUnits, 1850000);

  const autoPaymentAllocated = {
    ...autoPaymentUnallocated,
    id: 'pay-a1-2',
    principalAmount: makeMoney('USD', 42000),
    interestAmount: makeMoney('USD', 6500),
  };
  assert.equal(calculateReconciledBalance({
    openingBalance: makeMoney('USD', 1850000),
    transactions: [autoPaymentAllocated],
    accountId: 'a-1',
    debtCategory: 'Auto loan',
  }).currentBalance.minorUnits, 1808000);
});

test('T-273 auditLegacyLoanPairings preserves divergent or invalid links explicitly and avoids double-counting consistent links', () => {
  const mortgage = { id: 'm-consistent', name: 'Home', category: 'Mortgage', balance: 200000, minimumPayment: 1500, dueDay: 20, createdAt: '2025-01-01T00:00:00Z' };
  const mortgageBill = { id: 'b-consistent', name: 'Home bill', category: 'housing', amount: makeMoney('USD', 150000), dueDay: 20, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2025-01-01T00:00:00Z' };

  const autoDiv = { id: 'a-div', name: 'HR-V', category: 'Auto loan', balance: 15000, minimumPayment: 400, dueDay: 5, createdAt: '2025-01-01T00:00:00Z' };
  const autoDivBill = { id: 'b-div', name: 'HR-V Budget', category: 'other_bill', amount: makeMoney('USD', 45000), dueDay: 10, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2025-01-01T00:00:00Z' };

  const dupDebt = { id: 'a-dup', name: 'Dup Auto', category: 'Auto loan', balance: 5000, minimumPayment: 200, dueDay: 8, createdAt: '2025-01-01T00:00:00Z' };
  const dupDebtTwo = { id: 'a-dup-2', name: 'Dup Auto 2', category: 'Auto loan', balance: 5000, minimumPayment: 200, dueDay: 8, createdAt: '2025-01-01T00:00:00Z' };
  const sharedBill = { id: 'b-shared', name: 'Shared Auto', category: 'other_bill', amount: makeMoney('USD', 20000), dueDay: 8, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2025-01-01T00:00:00Z' };
  const incompatibleBill = { id: 'b-credit', name: 'Credit Utility', category: 'utilities', amount: makeMoney('USD', 9000), dueDay: 4, paymentMethod: 'credit', creditAccountId: 'c-1', autoPost: false, active: true, createdAt: '2025-01-01T00:00:00Z' };
  const incompDebt = { id: 'm-incomp', name: 'Bad Link', category: 'Mortgage', balance: 100000, minimumPayment: 900, dueDay: 4, createdAt: '2025-01-01T00:00:00Z' };
  const orphanBill = { id: 'b-orphan', name: 'Orphan Bill', category: 'housing', amount: makeMoney('USD', 110000), dueDay: 1, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2025-01-01T00:00:00Z' };

  const pairings = {
    'm-consistent': { status: 'linked', billId: 'b-consistent' },
    'a-div': { status: 'linked', billId: 'b-div' },
    'a-dup': { status: 'linked', billId: 'b-shared' },
    'a-dup-2': { status: 'linked', billId: 'b-shared' },
    'm-incomp': { status: 'linked', billId: 'b-credit' },
    'missing-debt': { status: 'linked', billId: 'b-orphan' },
    'a-missing-bill': { status: 'linked', billId: 'nope' },
  };
  const missingBillDebt = { id: 'a-missing-bill', name: 'Orphan Link', category: 'Auto loan', balance: 8000, minimumPayment: 250, dueDay: 15, createdAt: '2025-01-01T00:00:00Z' };
  const debts = [mortgage, autoDiv, dupDebt, dupDebtTwo, incompDebt, missingBillDebt];
  const bills = [mortgageBill, autoDivBill, sharedBill, incompatibleBill, orphanBill];

  const audit = auditLegacyLoanPairings({ debts, recurringBills: bills, pairings, currencyCode: 'USD' });
  assert.equal(audit.divergentLinks.length, 1);
  assert.equal(audit.divergentLinks[0].debt.id, 'a-div');
  assert.equal(audit.divergentLinks[0].amountDiffers, true);
  assert.equal(audit.divergentLinks[0].dueDayDiffers, true);

  assert.deepEqual(
    audit.invalidLinks.map(item => [item.debtId, item.reason]),
    [
      ['a-dup', 'duplicate_bill'],
      ['a-dup-2', 'duplicate_bill'],
      ['m-incomp', 'incompatible_bill'],
      ['missing-debt', 'missing_debt'],
      ['a-missing-bill', 'missing_bill'],
    ],
  );

  const divergentIds = audit.divergentLinks.map(item => item.debt.id);
  const excludedBillIds = unifiedExcludedBillIds(pairings, bills, debts, [], divergentIds);
  assert.deepEqual(excludedBillIds, ['b-consistent']); // Consistent link owned by canonical loan; divergent link preserved for review.

  const unifiedLoans = selectUnifiedBudgetLoans([mortgage, autoDiv], [], divergentIds);
  assert.deepEqual(unifiedLoans.map(item => item.id), ['m-consistent']);

  const breakdown = calculateCategoryBreakdown({
    recurringBills: [mortgageBill, autoDivBill].filter(item => !excludedBillIds.includes(item.id)),
    customCategoryLabelsByBillId: { 'b-div': 'Transportation' },
    unifiedLoans,
    monthlyIncome: 8000,
    monthlyDebtPlanPayment: 0,
    currencyCode: 'USD',
  });
  // Consistent mortgage counted once via canonical loan ($1,500), divergent HR-V bill keeps its $450 bill amount without silent overwrite.
  assert.equal(breakdown.find(row => row.categoryKey === 'housing').amount, 1500);
  assert.equal(breakdown.find(row => row.categoryKey === 'housing').count, 1);
  assert.equal(breakdown.find(row => row.categoryKey === 'custom:transportation').amount, 450);
});

