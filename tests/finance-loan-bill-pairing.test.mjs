import test from 'node:test';
import assert from 'node:assert/strict';
import { activeLoanBillLinks, createOnboardingLoanBill, loansNeedingPairingReview, onboardingLoanBillSaveAction, pairedDebtMinimumTotal, suggestLoanBills, withoutDeletedDebtPairing, withoutDeletedBillPairings, withoutIncompatibleDebtPairing, withoutIncompatibleBillPairings } from '../src/finance/loan-bill-pairing.ts';
import { getScheduledObligationRows } from '../src/finance/payment-matching.ts';
import { calculateMonthlyCashflow, calculateCategoryBreakdown, buildMonthlyBudgetBreakdown } from '../src/finance/budget.ts';
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
