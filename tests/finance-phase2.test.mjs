import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paymentMatchesObligation,
  matchPaymentsToObligation,
  getObligationPaymentState,
  findUnassignedPaymentsForObligation,
  calculateOverdueObligations,
} from '../src/finance/payment-matching.ts';
import {
  calculateActivitySummary,
  calculateAccountActivities,
  calculateCreditUtilization,
  calculateMilestones,
} from '../src/finance/progress.ts';
import {
  resolveRecurringBillDate,
  createConfirmedRecurringBillTransaction,
  generateRecurringBillTransaction,
  processRecurringBills,
  getActiveRecurringBills,
} from '../src/finance/recurring-bills.ts';
import {
  calculateMonthlyCashflow,
} from '../src/finance/budget.ts';
import {
  addCalendarDays,
  householdDate,
  currentHouseholdDate,
  parseDateOnly,
  daysInMonth,
  getPreviousMonthString,
  getNextMonthString,
} from '../src/finance/calendar.ts';
import { makeMoney, moneyToMajor } from '../src/finance/money.ts';
import { calculatePayoffPlan } from '../src/onboarding-domain.ts';

// Helper to construct test ledger transactions
function createTestTx(params) {
  const currency = params.currency ?? 'USD';
  return {
    id: params.id ?? `tx-${Math.random()}`,
    accountId: 'accountId' in params ? params.accountId : 'card-1',
    date: parseDateOnly(params.date ?? '2026-11-05'),
    appliesToDate: params.appliesToDate ? parseDateOnly(params.appliesToDate) : null,
    amount: makeMoney(currency, params.minorUnits ?? 5000),
    category: params.category ?? 'payment',
    payee: params.payee ?? 'Test Payee',
    memo: params.memo ?? null,
    source: params.source ?? 'manual',
    reconciled: false,
    createdAt: params.createdAt ?? '2026-11-05T12:00:00Z',
    deletedAt: params.deletedAt ?? null,
    isPending: params.isPending ?? false,
    principalAmount: params.principalMinor != null ? makeMoney(currency, params.principalMinor) : null,
    interestAmount: params.interestMinor != null ? makeMoney(currency, params.interestMinor) : null,
  };
}

// =============================================================================
// Phase 2 Independent Audit — 14 Mandatory Regression Tests
// =============================================================================

// -----------------------------------------------------------------------------
// Test 1: Two bills same card/date both post
// -----------------------------------------------------------------------------
test('Phase 2 Test 1: Two bills on same card and same date both post without collision or suppression', () => {
  const bill1 = {
    id: 'bill-netflix',
    name: 'Netflix',
    category: 'subscription',
    amount: makeMoney('USD', 1599),
    dueDay: 15,
    paymentMethod: 'credit',
    creditAccountId: 'card-chase',
    autoPost: true,
    active: true,
    createdAt: '2026-11-01T00:00:00Z',
  };
  const bill2 = {
    id: 'bill-spotify',
    name: 'Spotify',
    category: 'subscription',
    amount: makeMoney('USD', 999),
    dueDay: 15,
    paymentMethod: 'credit',
    creditAccountId: 'card-chase',
    autoPost: true,
    active: true,
    createdAt: '2026-11-01T00:00:00Z',
  };

  const runnerResult = processRecurringBills({
    bills: [bill1, bill2],
    existingTransactions: [],
    currentInstant: new Date('2026-11-16T12:00:00Z'),
    householdTimeZone: 'America/Los_Angeles',
  });

  // Both bills must post without suppressing each other
  assert.equal(runnerResult.newTransactions.length, 2);
  const ids = runnerResult.newTransactions.map(t => t.id);
  assert.ok(ids.includes('bill:bill-netflix:2026-11'));
  assert.ok(ids.includes('bill:bill-spotify:2026-11'));
  assert.equal(runnerResult.alreadyPostedCount, 0);
});

// -----------------------------------------------------------------------------
// Test 2: Card repayment does not settle merchant bill
// -----------------------------------------------------------------------------
test('Phase 2 Test 2: Card repayment does not settle merchant recurring bill', () => {
  const merchantBillObligation = {
    id: 'bill:bill-netflix',
    kind: 'bill',
    name: 'Netflix',
    dueDate: parseDateOnly('2026-11-15'),
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 1599),
    accountId: 'card-chase',
    billId: 'bill-netflix',
  };

  // Card payment made to reduce card balance
  const cardRepaymentTx = createTestTx({
    id: 'tx-card-repayment',
    accountId: 'card-chase',
    date: '2026-11-15',
    appliesToDate: '2026-11-15',
    minorUnits: 1599,
    category: 'payment',
    payee: 'Chase Card Payment',
  });

  // Must NOT match or settle the merchant bill
  assert.equal(paymentMatchesObligation(cardRepaymentTx, merchantBillObligation), false);
  const matchResult = matchPaymentsToObligation(merchantBillObligation, [cardRepaymentTx]);
  assert.equal(matchResult.isSatisfied, false);
  assert.equal(matchResult.matchedTransactions.length, 0);

  // Must NOT offer card debt repayment as unassigned candidate for merchant bill
  const unassignedCandidates = findUnassignedPaymentsForObligation(merchantBillObligation, [cardRepaymentTx]);
  assert.equal(unassignedCandidates.length, 0);
});

// -----------------------------------------------------------------------------
// Test 3: Merchant refund does not reverse minimum payment
// -----------------------------------------------------------------------------
test('Phase 2 Test 3: Merchant refund does not reverse card minimum payment', () => {
  const cardMinimumObligation = {
    id: 'minimum:card-chase',
    kind: 'debt',
    name: 'Chase Freedom minimum',
    dueDate: parseDateOnly('2026-11-15'),
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 10000), // $100 required
    accountId: 'card-chase',
  };

  const paymentTx = createTestTx({
    id: 'tx-user-pay',
    accountId: 'card-chase',
    date: '2026-11-10',
    appliesToDate: '2026-11-15',
    minorUnits: 10000, // $100 payment
    category: 'payment',
  });

  const merchantRefundTx = createTestTx({
    id: 'tx-merchant-refund',
    accountId: 'card-chase',
    date: '2026-11-12',
    appliesToDate: '2026-11-15',
    minorUnits: 3000, // $30 refund on card
    category: 'refund',
  });

  // Minimum payment must remain 100% satisfied; merchant refund does not reverse user payment
  const result = matchPaymentsToObligation(cardMinimumObligation, [paymentTx, merchantRefundTx]);
  assert.equal(result.isSatisfied, true);
  assert.equal(moneyToMajor(result.totalPaid), 100);
  assert.equal(moneyToMajor(result.remainingAmount), 0);
});

// -----------------------------------------------------------------------------
// Test 4: $100 bill with $60 partial then $40 remaining posted without collision
// -----------------------------------------------------------------------------
test('Phase 2 Test 4: $100 bill with $60 partial then $40 remaining posted exactly once without collision', () => {
  const billObligation = {
    id: 'bill:bill-electric',
    kind: 'bill',
    name: 'Electric Utility',
    dueDate: parseDateOnly('2026-11-15'),
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 10000), // $100
    accountId: null,
    billId: 'bill-electric',
  };

  // First payment: $60 with unique non-colliding ID
  const part1Tx = createTestTx({
    id: 'bill:bill-electric:2026-11-15:part-1',
    accountId: null,
    date: '2026-11-10',
    appliesToDate: '2026-11-15',
    minorUnits: 6000,
    category: 'debit_bill',
    payee: 'Electric Utility',
  });

  const result1 = matchPaymentsToObligation(billObligation, [part1Tx]);
  assert.equal(result1.isSatisfied, false);
  assert.equal(result1.isPartiallyPaid, true);
  assert.equal(moneyToMajor(result1.remainingAmount), 40);

  // Second payment: remaining $40 with unique ID
  const part2Tx = createTestTx({
    id: 'bill:bill-electric:2026-11-15:part-2',
    accountId: null,
    date: '2026-11-14',
    appliesToDate: '2026-11-15',
    minorUnits: 4000,
    category: 'debit_bill',
    payee: 'Electric Utility',
  });

  const result2 = matchPaymentsToObligation(billObligation, [part1Tx, part2Tx]);
  assert.equal(result2.isSatisfied, true);
  assert.equal(result2.isPartiallyPaid, false);
  assert.equal(moneyToMajor(result2.totalPaid), 100);
  assert.equal(moneyToMajor(result2.remainingAmount), 0);
  assert.equal(result2.matchedTransactions.length, 2);
  assert.notEqual(part1Tx.id, part2Tx.id);
});

// -----------------------------------------------------------------------------
// Test 5: Overdues from prior month appear as Past Due
// -----------------------------------------------------------------------------
test('Phase 2 Test 5: Overdues from prior month appear as Past Due obligations', () => {
  const currentMonth = '2026-11';
  const octDueDate = parseDateOnly('2026-10-20');
  const novDueDate = parseDateOnly('2026-11-20');

  const priorCycleObligation = {
    id: 'bill:bill-water',
    kind: 'bill',
    name: 'City Water',
    dueDate: octDueDate,
    dueCycleMonth: '2026-10',
    requiredAmount: makeMoney('USD', 5000),
    accountId: null,
    billId: 'bill-water',
  };

  const currentCycleObligation = {
    id: 'bill:bill-water',
    kind: 'bill',
    name: 'City Water',
    dueDate: novDueDate,
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 5000),
    accountId: null,
    billId: 'bill-water',
  };

  // Prior cycle is strictly before current month -> past due
  assert.ok(priorCycleObligation.dueCycleMonth < currentMonth);
  assert.equal(currentCycleObligation.dueCycleMonth < currentMonth, false);

  // Unpaid prior cycle obligation has 0 matching transactions and remains unsatisfied
  const matchResult = matchPaymentsToObligation(priorCycleObligation, []);
  assert.equal(matchResult.isSatisfied, false);
  assert.equal(moneyToMajor(matchResult.remainingAmount), 50);
});

// -----------------------------------------------------------------------------
// Test 6: Advance payment assigned to future cycle
// -----------------------------------------------------------------------------
test('Phase 2 Test 6: Advance payment preserves physical posting date while binding to future due cycle', () => {
  const novObligation = {
    id: 'minimum:card-chase',
    kind: 'debt',
    name: 'Chase minimum',
    dueDate: parseDateOnly('2026-11-15'),
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 10000),
    accountId: 'card-chase',
  };

  const decObligation = {
    id: 'minimum:card-chase',
    kind: 'debt',
    name: 'Chase minimum',
    dueDate: parseDateOnly('2026-12-15'),
    dueCycleMonth: '2026-12',
    requiredAmount: makeMoney('USD', 10000),
    accountId: 'card-chase',
  };

  // Payment physically posted on Nov 28, designated for Dec 15 due cycle
  const advanceTx = createTestTx({
    accountId: 'card-chase',
    date: '2026-11-28',
    appliesToDate: '2026-12-15',
    minorUnits: 10000,
  });

  // Does NOT match Nov cycle
  const novMatch = matchPaymentsToObligation(novObligation, [advanceTx]);
  assert.equal(novMatch.isSatisfied, false);
  assert.equal(novMatch.matchedTransactions.length, 0);

  // Strictly matches Dec cycle and flags advance payment
  const decMatch = matchPaymentsToObligation(decObligation, [advanceTx]);
  assert.equal(decMatch.isSatisfied, true);
  assert.equal(decMatch.hasAdvancePayment, true);
  assert.equal(moneyToMajor(decMatch.totalPaid), 100);
});

// -----------------------------------------------------------------------------
// Test 7: Debit AutoPay not falsely confirmed
// -----------------------------------------------------------------------------
test('Phase 2 Test 7: Debit AutoPay is not falsely auto-confirmed without explicit payment', () => {
  const debitBill = {
    id: 'bill-water',
    name: 'City Water',
    category: 'utilities',
    amount: makeMoney('USD', 5000),
    dueDay: 10,
    paymentMethod: 'debit',
    autoPost: true,
    active: true,
    createdAt: '2026-11-01T00:00:00Z',
  };

  // generateRecurringBillTransaction returns null for debit bills (cannot auto-post)
  const autoTx = generateRecurringBillTransaction({
    bill: debitBill,
    targetMonth: '2026-11',
    today: parseDateOnly('2026-11-15'),
  });
  assert.equal(autoTx, null);

  // processRecurringBills does NOT create unconfirmed transactions for debit bills
  const runnerResult = processRecurringBills({
    bills: [debitBill],
    existingTransactions: [],
    currentInstant: new Date('2026-11-15T12:00:00Z'),
    householdTimeZone: 'UTC',
  });
  assert.equal(runnerResult.newTransactions.length, 0);

  // Only explicit confirmation creates a confirmed debit transaction
  const confirmedTx = createConfirmedRecurringBillTransaction({
    bill: debitBill,
    dueCycle: parseDateOnly('2026-11-10'),
    actualDate: parseDateOnly('2026-11-10'),
  });
  assert.notEqual(confirmedTx, null);
  assert.equal(confirmedTx.category, 'debit_bill');
  assert.equal(confirmedTx.accountId, null);
});

// -----------------------------------------------------------------------------
// Test 8: Mortgage $2,000 payment with $500 principal breakdown displays $500 principal reduction
// -----------------------------------------------------------------------------
test('Phase 2 Test 8: Mortgage $2,000 payment with $500 principal breakdown displays $500 principal reduction', () => {
  const debts = [
    { id: 'mortgage-1', name: 'Home Mortgage', category: 'Mortgage', balance: 300000, originalBalance: 320000, creditLimit: null },
  ];

  const mortgageTx = createTestTx({
    id: 'tx-mortgage',
    accountId: 'mortgage-1',
    date: '2026-11-01',
    minorUnits: 200000, // $2,000 total cash payment
    principalMinor: 50000, // $500 verified principal reduction
    interestMinor: 120000, // $1,200 interest
    category: 'payment',
  });

  const summary = calculateActivitySummary({
    transactions: [mortgageTx],
    debts,
    period: 'current_month',
    today: parseDateOnly('2026-11-15'),
  });

  assert.equal(summary.totalPayments, 2000);
  assert.equal(summary.principalReduction, 500); // Must be $500, NOT $2,000!

  // Payment without breakdown on Mortgage does not fabricate principal reduction
  const unallocatedMortgageTx = createTestTx({
    id: 'tx-mortgage-unallocated',
    accountId: 'mortgage-1',
    date: '2026-11-01',
    minorUnits: 200000,
    category: 'payment',
  });

  const unallocatedSummary = calculateActivitySummary({
    transactions: [unallocatedMortgageTx],
    debts,
    period: 'current_month',
    today: parseDateOnly('2026-11-15'),
  });
  assert.equal(unallocatedSummary.totalPayments, 2000);
  assert.equal(unallocatedSummary.principalReduction, 0); // Preserved without inventing reduction
});

// -----------------------------------------------------------------------------
// Test 9: November refund does not cause October false payoff
// -----------------------------------------------------------------------------
test('Phase 2 Test 9: November refund does not cause October false payoff in historical reconstruction', () => {
  const today = parseDateOnly('2026-11-15');
  // Account currently has $0 balance because a $50 refund arrived in November on a card with $50 balance
  const debts = [
    { id: 'card-1', name: 'Chase Card', category: 'Credit card', balance: 0, originalBalance: 1000, creditLimit: 3000 },
  ];

  const novRefundTx = createTestTx({
    id: 'tx-nov-refund',
    accountId: 'card-1',
    date: '2026-11-04',
    minorUnits: 5000, // $50 refund in November
    category: 'refund',
  });

  // Reconstructed October 31 balance: current balance (0) - delta(-50) = $50 > 0.
  const prevMonthSummary = calculateActivitySummary({
    transactions: [novRefundTx],
    debts,
    period: 'previous_month',
    today,
  });

  // Must NOT claim account was paid off in October!
  assert.equal(prevMonthSummary.accountsPaidOffCount, null);

  // A zero balance alone does not establish a payoff event in the current month.
  const currMonthSummary = calculateActivitySummary({
    transactions: [novRefundTx],
    debts,
    period: 'current_month',
    today,
  });
  assert.equal(currMonthSummary.accountsPaidOffCount, null);
});

// -----------------------------------------------------------------------------
// Test 10: Mixed JPY/USD rejection
// -----------------------------------------------------------------------------
test('Phase 2 Test 10: Mixed JPY/USD rejection across Progress calculations', () => {
  const debts = [
    { id: 'card-1', name: 'Card', category: 'Credit card', balance: 1000, originalBalance: 2000, creditLimit: 5000 },
  ];

  const usdTx = createTestTx({
    currency: 'USD',
    date: '2026-11-05',
    minorUnits: 5000,
    category: 'payment',
  });
  const jpyTx = createTestTx({
    currency: 'JPY',
    date: '2026-11-05',
    minorUnits: 10000,
    category: 'payment',
  });

  // calculateActivitySummary rejects mixed currencies
  assert.throws(() => {
    calculateActivitySummary({
      transactions: [usdTx, jpyTx],
      debts,
      period: 'current_month',
      today: parseDateOnly('2026-11-15'),
      currencyCode: 'USD',
    });
  }, /Currency mismatch/);

  // calculateAccountActivities rejects mismatched currency
  assert.throws(() => {
    calculateAccountActivities({
      transactions: [jpyTx],
      debts,
      period: 'current_month',
      today: parseDateOnly('2026-11-15'),
      currencyCode: 'USD',
    });
  }, /Currency mismatch/);

  // calculateMilestones rejects mismatched currency
  assert.throws(() => {
    calculateMilestones({
      debts,
      transactions: [jpyTx],
      currencyCode: 'USD',
    });
  }, /Currency mismatch/);
});

// -----------------------------------------------------------------------------
// Test 11: Multi-currency scale precision without cent division
// -----------------------------------------------------------------------------
test('Phase 2 Test 11: Multi-currency scale precision without cent division (JPY scale 0, USD scale 2, KWD scale 3, CLF scale 4)', () => {
  // Japanese Yen (scale 0): 10,000 JPY is 10,000 minor units
  const jpyTx = createTestTx({
    currency: 'JPY',
    date: '2026-11-05',
    minorUnits: 10000,
    category: 'payment',
  });
  assert.equal(moneyToMajor(jpyTx.amount), 10000);

  const jpySummary = calculateActivitySummary({
    transactions: [jpyTx],
    debts: [{ id: 'card-1', name: 'JCB', category: 'Credit card', balance: 50000, originalBalance: 60000, creditLimit: 200000 }],
    period: 'current_month',
    today: parseDateOnly('2026-11-15'),
    currencyCode: 'JPY',
  });
  assert.equal(jpySummary.totalPayments, 10000); // NEVER 100.00!

  // US Dollar (scale 2): 10,000 USD minor units is 100.00 USD
  const usdTx = createTestTx({
    currency: 'USD',
    date: '2026-11-05',
    minorUnits: 10000,
    category: 'payment',
  });
  assert.equal(moneyToMajor(usdTx.amount), 100.00);

  // Kuwaiti Dinar (scale 3): 12,350 KWD minor units is 12.350 KWD
  const kwdTx = createTestTx({
    currency: 'KWD',
    date: '2026-11-05',
    minorUnits: 12350,
    category: 'payment',
  });
  assert.equal(moneyToMajor(kwdTx.amount), 12.35);

  const kwdSummary = calculateActivitySummary({
    transactions: [kwdTx],
    debts: [{ id: 'card-1', name: 'NBK', category: 'Credit card', balance: 50, originalBalance: 100, creditLimit: 500 }],
    period: 'current_month',
    today: parseDateOnly('2026-11-15'),
    currencyCode: 'KWD',
  });
  assert.equal(kwdSummary.totalPayments, 12.35);

  // Chilean Unidad de Fomento (scale 4): 15,000 CLF minor units is 1.5000 CLF
  const clfTx = createTestTx({
    currency: 'CLF',
    date: '2026-11-05',
    minorUnits: 15000,
    category: 'payment',
  });
  assert.equal(moneyToMajor(clfTx.amount), 1.5);
});

// -----------------------------------------------------------------------------
// Test 12: Late-night LA/UTC calendar date resolution
// -----------------------------------------------------------------------------
test('Phase 2 Test 12: Late-night LA/UTC calendar date resolution around midnight and leap years', () => {
  // At 2026-11-07T04:30:00Z:
  // In America/Los_Angeles (UTC-8): 2026-11-06 8:30 PM
  // In UTC: 2026-11-07 4:30 AM
  const instant = new Date('2026-11-07T04:30:00Z');
  const laDate = householdDate(instant, 'America/Los_Angeles');
  assert.equal(laDate, '2026-11-06');

  const utcDate = householdDate(instant, 'UTC');
  assert.equal(utcDate, '2026-11-07');

  const currentLa = currentHouseholdDate('America/Los_Angeles', instant);
  assert.equal(currentLa, '2026-11-06');

  // Leap years and month bounds
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(resolveRecurringBillDate('2024-02', 31), '2024-02-29');

  assert.equal(daysInMonth(2025, 2), 28);
  assert.equal(resolveRecurringBillDate('2025-02', 31), '2025-02-28');

  assert.equal(getPreviousMonthString('2026-01'), '2025-12');
  assert.equal(getNextMonthString('2026-12'), '2027-01');
});

// -----------------------------------------------------------------------------
// Test 13: Reconciliation adjustment excluded from debt reduction
// -----------------------------------------------------------------------------
test('Phase 2 Test 13: Reconciliation adjustment excluded from debt reduction', () => {
  const debts = [
    { id: 'card-1', name: 'Chase Card', category: 'Credit card', balance: 2000, originalBalance: 3000, creditLimit: 5000 },
  ];

  const paymentTx = createTestTx({
    id: 'tx-real-payment',
    accountId: 'card-1',
    date: '2026-11-02',
    minorUnits: 20000, // $200 real payment
    category: 'payment',
    source: 'manual',
  });

  const adjustmentTx = createTestTx({
    id: 'tx-recon-adjustment',
    accountId: 'card-1',
    date: '2026-11-10',
    minorUnits: 10000, // $100 drift adjustment
    category: 'credit_adjustment',
    source: 'reconciliation',
  });

  const summary = calculateActivitySummary({
    transactions: [paymentTx, adjustmentTx],
    debts,
    period: 'current_month',
    today: parseDateOnly('2026-11-15'),
  });

  // Total payments must reflect real cash payments only
  assert.equal(summary.totalPayments, 200);
  // Total adjustments captures reconciliation drift separately
  assert.equal(summary.totalAdjustments, 100);

  // In milestones, reconciliation drift must NOT count toward payment milestones
  const milestones = calculateMilestones({
    debts,
    transactions: [paymentTx, adjustmentTx],
    currencyCode: 'USD',
  });
  const first1000 = milestones.find(m => m.id === 'first_1000');
  assert.notEqual(first1000, undefined);
  assert.equal(first1000?.currentValue, 200); // Exactly $200, NOT $300!
});

// -----------------------------------------------------------------------------
// Test 14: Comprehensive synthetic household dataset agreement across screens
// -----------------------------------------------------------------------------
test('Phase 2 Test 14: Comprehensive synthetic household dataset agreement across Home, Budget, Transactions, and Progress', () => {
  const currencyCode = 'USD';
  const debts = [
    { id: 'card-1', name: 'Sapphire Card', category: 'Credit card', balance: 2500, originalBalance: 4000, apr: 22.0, minimumPayment: 75, dueDay: 15, creditLimit: 10000 },
    { id: 'auto-1', name: 'Auto Loan', category: 'Auto loan', balance: 12000, originalBalance: 15000, apr: 5.5, minimumPayment: 320, dueDay: 20, creditLimit: null },
    { id: 'mortgage-1', name: 'Home Mortgage', category: 'Mortgage', balance: 280000, originalBalance: 300000, apr: 6.25, minimumPayment: 1850, dueDay: 1, creditLimit: null },
  ];

  const recurringBills = [
    { id: 'bill-power', name: 'Power Utility', category: 'utilities', amount: makeMoney('USD', 12000), dueDay: 10, paymentMethod: 'debit', autoPost: true, active: true, createdAt: '2026-11-01T00:00:00Z' },
    { id: 'bill-cloud', name: 'Cloud Storage', category: 'subscription', amount: makeMoney('USD', 999), dueDay: 25, paymentMethod: 'credit', creditAccountId: 'card-1', autoPost: true, active: true, createdAt: '2026-11-01T00:00:00Z' },
  ];

  const plan = calculatePayoffPlan(debts, 'snowball', 100, new Date('2026-11-01T00:00:00Z'), currencyCode);

  // 1. Budget Screen Verification
  const cashflow = calculateMonthlyCashflow({
    monthlyIncome: 6500,
    recurringBills,
    monthlyDebtPlanPayment: plan.monthlyTotalPayment,
    currencyCode,
  });
  assert.equal(cashflow.totalIncome, 6500);
  assert.equal(cashflow.totalDebitBills, 120);
  assert.equal(cashflow.totalCreditBills, 9.99);
  assert.ok(cashflow.totalCommitments > 0);
  assert.ok(cashflow.remainingFreeCashflow > 0);
  assert.equal(cashflow.isDeficit, false);

  // 2. Upcoming Obligations on Budget & Home
  const powerObligation = {
    id: 'bill-power',
    kind: 'bill',
    name: 'Power Utility',
    dueDate: parseDateOnly('2026-11-10'),
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 12000),
    accountId: null,
    billId: 'bill-power',
  };
  const cardObligation = {
    id: 'minimum:card-1',
    kind: 'debt',
    name: 'Sapphire Card minimum',
    dueDate: parseDateOnly('2026-11-15'),
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 7500),
    accountId: 'card-1',
  };

  // Initially both are unpaid
  assert.equal(matchPaymentsToObligation(powerObligation, []).isSatisfied, false);
  assert.equal(matchPaymentsToObligation(cardObligation, []).isSatisfied, false);

  // User makes partial payment of $30 on card
  const partialCardTx = createTestTx({
    accountId: 'card-1',
    date: '2026-11-06',
    appliesToDate: '2026-11-15',
    minorUnits: 3000,
  });
  const cardPartialResult = matchPaymentsToObligation(cardObligation, [partialCardTx]);
  assert.equal(cardPartialResult.isPartiallyPaid, true);
  assert.equal(cardPartialResult.isSatisfied, false);
  assert.equal(moneyToMajor(cardPartialResult.remainingAmount), 45); // $45 remaining

  // User pays full power bill
  const powerTx = createConfirmedRecurringBillTransaction({
    bill: recurringBills[0],
    dueCycle: parseDateOnly('2026-11-10'),
    actualDate: parseDateOnly('2026-11-10'),
  });
  const powerResult = matchPaymentsToObligation(powerObligation, [powerTx]);
  assert.equal(powerResult.isSatisfied, true);
  assert.equal(moneyToMajor(powerResult.remainingAmount), 0);

  // 3. Historical Progress Screen Verification
  const progressSummary = calculateActivitySummary({
    transactions: [partialCardTx, powerTx],
    debts,
    period: 'current_month',
    today: parseDateOnly('2026-11-15'),
  });
  assert.equal(progressSummary.totalPayments, 30);
  assert.equal(progressSummary.principalReduction, 30);
  assert.equal(progressSummary.debtPaidDown, 30);

  // 4. Revolving Credit Utilization
  const util = calculateCreditUtilization(debts);
  assert.equal(util.totalLimit, 10000);
  assert.equal(util.totalUsed, 2500);
  assert.equal(util.utilizationPercent, 25);
  assert.equal(util.statusBand, 'good');
});

// =============================================================================
// DFN-004-V1 Acceptance Remediation Focused Regression Tests
// =============================================================================

test('DFN-004 Test 1: Payee substring alone does NOT match/settle bill without explicit bill ID', () => {
  const obligation = {
    id: 'bill-water',
    kind: 'bill',
    name: 'City Water',
    dueDate: parseDateOnly('2026-11-15'),
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 5000),
    accountId: null,
    billId: 'bill-water',
  };

  // Transaction has matching payee substring, but arbitrary ID and no bill memo reference
  const randomTx = createTestTx({
    id: 'tx-unrelated-random',
    accountId: null,
    date: '2026-11-15',
    minorUnits: 5000,
    category: 'debit_bill',
    payee: 'City Water Utility Co.',
    memo: 'Paid via web portal',
  });

  const res = matchPaymentsToObligation(obligation, [randomTx]);
  assert.equal(res.isSatisfied, false);
  assert.equal(res.isPartiallyPaid, false);
  assert.equal(res.matchedTransactions.length, 0);

  // Now with explicit durable memo reference [bill:bill-water]
  const explicitMemoTx = createTestTx({
    id: 'tx-manual-with-memo',
    accountId: null,
    date: '2026-11-15',
    appliesToDate: '2026-11-15',
    minorUnits: 5000,
    category: 'debit_bill',
    payee: 'City Water Utility Co.',
    memo: 'Paid [bill:bill-water]',
  });

  const resMemo = matchPaymentsToObligation(obligation, [explicitMemoTx]);
  assert.equal(resMemo.isSatisfied, true);
  assert.equal(resMemo.matchedTransactions.length, 1);
});

test('DFN-004 Test 2: Segregation of credit vs debit obligations (cross-account and cross-category rejection)', () => {
  const creditBillObligation = {
    id: 'bill-netflix',
    kind: 'bill',
    name: 'Netflix',
    dueDate: parseDateOnly('2026-11-10'),
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 1599),
    accountId: 'card-1',
    billId: 'bill-netflix',
  };

  // 1. Transaction on different card (card-2) with bill memo must NOT match
  const wrongCardTx = createTestTx({
    id: 'bill:bill-netflix:2026-11-10:wrong',
    accountId: 'card-2',
    date: '2026-11-10',
    appliesToDate: '2026-11-10',
    minorUnits: 1599,
    category: 'subscription',
    payee: 'Netflix',
  });
  assert.equal(matchPaymentsToObligation(creditBillObligation, [wrongCardTx]).isSatisfied, false);

  // 2. Transaction on checking account (accountId: null) must NOT match credit card obligation
  const checkingTx = createTestTx({
    id: 'bill:bill-netflix:2026-11-10:checking',
    accountId: null,
    date: '2026-11-10',
    appliesToDate: '2026-11-10',
    minorUnits: 1599,
    category: 'debit_bill',
    payee: 'Netflix',
  });
  assert.equal(matchPaymentsToObligation(creditBillObligation, [checkingTx]).isSatisfied, false);

  // 3. Debt payment (category: 'payment') on card-1 must NOT settle merchant bill obligation
  const paymentTx = createTestTx({
    id: 'bill:bill-netflix:2026-11-10:payment',
    accountId: 'card-1',
    date: '2026-11-10',
    appliesToDate: '2026-11-10',
    minorUnits: 1599,
    category: 'payment',
    payee: 'Card Repayment',
  });
  assert.equal(matchPaymentsToObligation(creditBillObligation, [paymentTx]).isSatisfied, false);

  // 4. Correct merchant subscription charge on card-1 DOES match
  const correctTx = createTestTx({
    id: 'bill:bill-netflix:2026-11-10',
    accountId: 'card-1',
    date: '2026-11-10',
    appliesToDate: '2026-11-10',
    minorUnits: 1599,
    category: 'subscription',
    payee: 'Netflix',
  });
  assert.equal(matchPaymentsToObligation(creditBillObligation, [correctTx]).isSatisfied, true);
});

test('DFN-004 Test 3: Exact cycle/due date matching rejects transactions from different due date in same month', () => {
  const earlyCycleObligation = {
    id: 'bill-cell',
    kind: 'bill',
    name: 'Cell Phone',
    dueDate: parseDateOnly('2026-11-05'),
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 8000),
    accountId: null,
    billId: 'bill-cell',
  };

  // Transaction explicitly stamped for a DIFFERENT due date in November (Nov 20)
  const lateTx = createTestTx({
    id: 'bill:bill-cell:2026-11-20',
    accountId: null,
    date: '2026-11-20',
    appliesToDate: '2026-11-20',
    minorUnits: 8000,
    category: 'debit_bill',
    payee: 'Cell Phone',
  });

  const res = matchPaymentsToObligation(earlyCycleObligation, [lateTx]);
  assert.equal(res.isSatisfied, false, 'Transaction for Nov 20 must NOT settle Nov 5 obligation');
  assert.equal(res.matchedTransactions.length, 0);

  // Correct transaction for Nov 5 does match
  const correctTx = createTestTx({
    id: 'bill:bill-cell:2026-11-05',
    accountId: null,
    date: '2026-11-05',
    appliesToDate: '2026-11-05',
    minorUnits: 8000,
    category: 'debit_bill',
    payee: 'Cell Phone',
  });
  const resCorrect = matchPaymentsToObligation(earlyCycleObligation, [correctTx]);
  assert.equal(resCorrect.isSatisfied, true);
});

test('DFN-004 Test 4: Mortgage split payment ($2000 payment with $500 principal) reduces debt by $500, not $2000', () => {
  const debts = [
    { id: 'mortgage-1', name: 'Home Mortgage', category: 'Mortgage', balance: 250000, originalBalance: 260000, apr: 6.0, minimumPayment: 2000, dueDay: 1, creditLimit: null },
  ];

  // $2,000 cash payment with $500 principal breakdown
  const mortgageTx = createTestTx({
    id: 'tx-mortgage-nov',
    accountId: 'mortgage-1',
    date: '2026-11-01',
    minorUnits: 200000, // $2,000 total paid out of cash
    principalMinor: 50000, // $500 principal reduction
    interestMinor: 150000, // $1,500 interest/escrow
    category: 'payment',
    source: 'manual',
  });

  const summary = calculateActivitySummary({
    transactions: [mortgageTx],
    debts,
    period: 'current_month',
    today: parseDateOnly('2026-11-15'),
  });

  assert.equal(summary.totalPayments, 2000, 'Total user cash payments must be $2,000');
  assert.equal(summary.principalReduction, 500, 'Principal reduction must be $500');
  assert.equal(summary.netBalanceChange, -500, 'Net balance change must be -$500');
  assert.equal(summary.debtPaidDown, 500, 'Debt paid down must be $500 (NOT $2,000)');

  // Account activities breakdown
  const accountActivities = calculateAccountActivities({
    transactions: [mortgageTx],
    debts,
    period: 'current_month',
    today: parseDateOnly('2026-11-15'),
  });
  assert.equal(accountActivities.length, 1);
  assert.equal(accountActivities[0].payments, 2000);
  assert.equal(accountActivities[0].netChange, -500);
});

test('DFN-004 Test 5: Merchant refund on credit card ($30) does not count as debt repayment or principal reduction', () => {
  const debts = [
    { id: 'card-1', name: 'Rewards Card', category: 'Credit card', balance: 1000, originalBalance: 1500, apr: 19.99, minimumPayment: 35, dueDay: 20, creditLimit: 5000 },
  ];

  // A merchant refund of $30 on the card
  const refundTx = createTestTx({
    id: 'tx-refund-nov',
    accountId: 'card-1',
    date: '2026-11-03',
    minorUnits: 3000, // $30 refund
    category: 'refund',
    source: 'manual',
    payee: 'Target Store Refund',
  });

  const summary = calculateActivitySummary({
    transactions: [refundTx],
    debts,
    period: 'current_month',
    today: parseDateOnly('2026-11-15'),
  });

  assert.equal(summary.totalPayments, 0, 'Merchant refund must NOT count as user repayment');
  assert.equal(summary.principalReduction, 0, 'Merchant refund must NOT count as user principal reduction');
  assert.equal(summary.netBalanceChange, -30, 'Net balance delta should be -$30');
  assert.equal(summary.debtPaidDown, 0, 'Refund is not payment-earned reduction');

  // Also verify that a refund doesn't reverse debt payment obligations
  const cardObligation = {
    id: 'minimum:card-1',
    kind: 'debt',
    name: 'Rewards Card minimum',
    dueDate: parseDateOnly('2026-11-20'),
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 3500),
    accountId: 'card-1',
  };
  const matchResult = matchPaymentsToObligation(cardObligation, [refundTx]);
  assert.equal(matchResult.isSatisfied, false, 'Refund must not satisfy card minimum payment');
  assert.equal(matchResult.matchedTransactions.length, 0);
});

test('DFN-004 Test 6: Multi-currency progress calculation across JPY, KWD, and CLF without errors', () => {
  // Test JPY (scale 0)
  const jpyDebts = [
    { id: 'jpy-card', name: 'Tokyo Card', category: 'Credit card', balance: 50000, originalBalance: 100000, apr: 15.0, minimumPayment: 5000, dueDay: 10, creditLimit: 300000 },
  ];
  const jpyTx = createTestTx({
    currency: 'JPY',
    accountId: 'jpy-card',
    date: '2026-11-05',
    minorUnits: 5000, // 5000 JPY
    category: 'payment',
  });
  const jpySummary = calculateActivitySummary({
    transactions: [jpyTx],
    debts: jpyDebts,
    period: 'current_month',
    today: parseDateOnly('2026-11-15'),
    currencyCode: 'JPY',
  });
  assert.equal(jpySummary.totalPayments, 5000);
  assert.equal(jpySummary.debtPaidDown, 5000);

  const jpyMilestones = calculateMilestones({
    debts: jpyDebts,
    transactions: [jpyTx],
    currencyCode: 'JPY',
  });
  assert.ok(jpyMilestones.length > 0);

  // Test KWD (scale 3)
  const kwdDebts = [
    { id: 'kwd-loan', name: 'Kuwait Loan', category: 'Personal loan', balance: 1500, originalBalance: 2000, apr: 4.5, minimumPayment: 100, dueDay: 1, creditLimit: null },
  ];
  const kwdTx = createTestTx({
    currency: 'KWD',
    accountId: 'kwd-loan',
    date: '2026-11-01',
    minorUnits: 100000, // 100.000 KWD
    category: 'payment',
  });
  const kwdSummary = calculateActivitySummary({
    transactions: [kwdTx],
    debts: kwdDebts,
    period: 'current_month',
    today: parseDateOnly('2026-11-15'),
    currencyCode: 'KWD',
  });
  assert.equal(kwdSummary.totalPayments, 100);
  assert.equal(kwdSummary.debtPaidDown, 100);
});

test('DFN-004 Test 7: Multi-cycle past due accumulation without phantom cycles before bill creation', () => {
  // A bill created in 2026-10 with due day 10
  const bill = {
    id: 'bill-water-history',
    name: 'Water Service',
    category: 'utilities',
    amount: makeMoney('USD', 6500),
    dueDay: 10,
    paymentMethod: 'debit',
    autoPost: false,
    active: true,
    createdAt: '2026-10-01T00:00:00Z',
  };

  // October cycle: 2026-10-10, November cycle: 2026-11-10
  // In November (after Nov 10), if neither was paid, both should appear as past-due obligations
  const octDueDate = resolveRecurringBillDate('2026-10', bill.dueDay);
  const novDueDate = resolveRecurringBillDate('2026-11', bill.dueDay);

  const octObligation = {
    id: bill.id,
    kind: 'bill',
    name: bill.name,
    dueDate: octDueDate,
    dueCycleMonth: '2026-10',
    requiredAmount: bill.amount,
    accountId: null,
    billId: bill.id,
    bill,
  };

  const novObligation = {
    id: bill.id,
    kind: 'bill',
    name: bill.name,
    dueDate: novDueDate,
    dueCycleMonth: '2026-11',
    requiredAmount: bill.amount,
    accountId: null,
    billId: bill.id,
    bill,
  };

  // With no transactions, neither is satisfied
  assert.equal(matchPaymentsToObligation(octObligation, []).isSatisfied, false);
  assert.equal(matchPaymentsToObligation(novObligation, []).isSatisfied, false);

  // Paying October cycle satisfies Oct but NOT Nov
  const octTx = createConfirmedRecurringBillTransaction({
    bill,
    dueCycle: octDueDate,
    actualDate: octDueDate,
  });

  assert.equal(matchPaymentsToObligation(octObligation, [octTx]).isSatisfied, true);
  assert.equal(matchPaymentsToObligation(novObligation, [octTx]).isSatisfied, false);
});

test('DFN-004 Test 8: Partial payments and overpayment boundary', () => {
  const obligation = {
    id: 'bill-electric',
    kind: 'bill',
    name: 'Electric',
    dueDate: parseDateOnly('2026-11-15'),
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 10000), // $100
    accountId: null,
    billId: 'bill-electric',
  };

  // Pay $60
  const tx60 = createConfirmedRecurringBillTransaction({
    bill: {
      id: 'bill-electric',
      name: 'Electric',
      category: 'utilities',
      amount: makeMoney('USD', 10000),
      dueDay: 15,
      paymentMethod: 'debit',
      autoPost: false,
      active: true,
      createdAt: '2026-11-01T00:00:00Z',
    },
    dueCycle: parseDateOnly('2026-11-15'),
    actualDate: parseDateOnly('2026-11-10'),
    amount: makeMoney('USD', 6000),
    transactionId: 'bill:bill-electric:2026-11-15:part-1',
  });

  const res1 = matchPaymentsToObligation(obligation, [tx60]);
  assert.equal(res1.isSatisfied, false);
  assert.equal(res1.isPartiallyPaid, true);
  assert.equal(moneyToMajor(res1.remainingAmount), 40);

  // Pay remaining $40
  const tx40 = createConfirmedRecurringBillTransaction({
    bill: {
      id: 'bill-electric',
      name: 'Electric',
      category: 'utilities',
      amount: makeMoney('USD', 10000),
      dueDay: 15,
      paymentMethod: 'debit',
      autoPost: false,
      active: true,
      createdAt: '2026-11-01T00:00:00Z',
    },
    dueCycle: parseDateOnly('2026-11-15'),
    actualDate: parseDateOnly('2026-11-14'),
    amount: makeMoney('USD', 4000),
    transactionId: 'bill:bill-electric:2026-11-15:part-2',
  });

  const res2 = matchPaymentsToObligation(obligation, [tx60, tx40]);
  assert.equal(res2.isSatisfied, true);
  assert.equal(res2.isPartiallyPaid, false);
  assert.equal(moneyToMajor(res2.remainingAmount), 0);
});

test('DFN-004 Test 9: Debit recurring bills never auto-post without explicit user confirmation', () => {
  const debitBill = {
    id: 'bill-gym',
    name: 'Gym Membership',
    category: 'subscription',
    amount: makeMoney('USD', 4500),
    dueDay: 5,
    paymentMethod: 'debit',
    autoPost: true, // Even if autoPost is true, debit bills MUST NOT auto-post
    active: true,
    createdAt: '2026-11-01T00:00:00Z',
  };

  const autoTx = generateRecurringBillTransaction({
    bill: debitBill,
    targetMonth: '2026-11',
    today: parseDateOnly('2026-11-10'), // today is past dueDay
  });

  assert.equal(autoTx, null, 'Debit bill must NEVER be auto-posted by generateRecurringBillTransaction');
});

test('DFN-004 Test 10: ProcessRecurringBills respects explicit household timezone across day boundaries', () => {
  const creditBill = {
    id: 'bill-streaming',
    name: 'Streaming Service',
    category: 'subscription',
    amount: makeMoney('USD', 1499),
    dueDay: 15,
    paymentMethod: 'credit',
    creditAccountId: 'card-1',
    autoPost: true,
    active: true,
    createdAt: '2026-11-01T00:00:00Z',
  };

  // In UTC it is Nov 15 02:00, but in America/Los_Angeles it is Nov 14 18:00 (due date has NOT arrived in LA)
  const instant = new Date('2026-11-15T02:00:00Z');

  const laResult = processRecurringBills({
    bills: [creditBill],
    existingTransactions: [],
    currentInstant: instant,
    householdTimeZone: 'America/Los_Angeles',
  });

  // On Nov 14 in LA, due date Nov 15 has not arrived, so 0 transactions generated
  assert.equal(laResult.newTransactions.length, 0);

  // In UTC, it IS Nov 15, so 1 transaction is generated
  const utcResult = processRecurringBills({
    bills: [creditBill],
    existingTransactions: [],
    currentInstant: instant,
    householdTimeZone: 'UTC',
  });

  assert.equal(utcResult.newTransactions.length, 1);
  assert.equal(utcResult.newTransactions[0].date, '2026-11-15');
});

// =============================================================================
// Critical Remediation Audit Tests: P0-A, P1-A, P1-B
// =============================================================================

test('P0-A Test: Overlapping bill identifiers (Bill A "a" vs Bill B "ab") must NOT collide', () => {
  const billA = {
    id: 'a',
    kind: 'bill',
    name: 'Bill Alpha',
    dueDate: parseDateOnly('2026-11-05'),
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 5000),
    accountId: null,
    billId: 'a',
  };

  const billB = {
    id: 'ab',
    kind: 'bill',
    name: 'Bill Alpha Beta',
    dueDate: parseDateOnly('2026-11-05'),
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 7500),
    accountId: null,
    billId: 'ab',
  };

  // Transaction explicitly marked for Bill B via [bill:ab] in memo
  const txForB = createTestTx({
    id: 'tx-payment-b',
    accountId: null,
    date: '2026-11-05',
    minorUnits: 7500,
    category: 'debit_bill',
    payee: 'Alpha Beta Merchant',
    memo: 'Monthly subscription [bill:ab]',
  });

  // Must match Bill B
  const matchB = matchPaymentsToObligation(billB, [txForB]);
  assert.equal(matchB.isSatisfied, true, 'Transaction must settle Bill B');
  assert.equal(matchB.matchedTransactions.length, 1);

  // Must NOT match Bill A (even though "a" is a substring of "ab")
  const matchA = matchPaymentsToObligation(billA, [txForB]);
  assert.equal(matchA.isSatisfied, false, 'Transaction for Bill B must NOT settle Bill A');
  assert.equal(matchA.matchedTransactions.length, 0);

  // Now test with memo "bill:ab" without brackets
  const txForBTag = createTestTx({
    id: 'tx-payment-b-tag',
    accountId: null,
    date: '2026-11-05',
    minorUnits: 7500,
    category: 'debit_bill',
    payee: 'Alpha Beta Merchant',
    memo: 'Auto debit bill:ab for cycle',
  });

  assert.equal(matchPaymentsToObligation(billB, [txForBTag]).isSatisfied, true);
  assert.equal(matchPaymentsToObligation(billA, [txForBTag]).isSatisfied, false);

  // Now test transaction explicitly for Bill A
  const txForA = createTestTx({
    id: 'tx-payment-a',
    accountId: null,
    date: '2026-11-05',
    minorUnits: 5000,
    category: 'debit_bill',
    payee: 'Alpha Services',
    memo: 'Payment for [bill:a]',
  });

  assert.equal(matchPaymentsToObligation(billA, [txForA]).isSatisfied, true);
  assert.equal(matchPaymentsToObligation(billB, [txForA]).isSatisfied, false);
});

test('P0-A Test: Recurring bill transaction CANNOT settle credit card debt minimum payment', () => {
  const cardDebtObligation = {
    id: 'minimum:card-chase',
    kind: 'debt',
    name: 'Chase Sapphire minimum',
    dueDate: parseDateOnly('2026-11-15'),
    dueCycleMonth: '2026-11',
    requiredAmount: makeMoney('USD', 10000), // $100
    accountId: 'card-chase',
  };

  // A recurring bill payment on the card (or tagged as bill)
  const billTx = createTestTx({
    id: 'bill:netflix-sub:2026-11-15',
    accountId: 'card-chase',
    date: '2026-11-15',
    minorUnits: 10000,
    category: 'purchase',
    payee: 'Netflix',
    memo: 'Payment for [bill:netflix-sub]',
  });

  const res = matchPaymentsToObligation(cardDebtObligation, [billTx]);
  assert.equal(res.isSatisfied, false, 'Recurring bill purchase must not settle credit card debt minimum obligation');
  assert.equal(res.matchedTransactions.length, 0);

  // Even if category is 'payment', explicit bill tagging prevents settling a debt obligation
  const billPaymentTx = createTestTx({
    id: 'bill:utility:2026-11-15',
    accountId: 'card-chase',
    date: '2026-11-15',
    minorUnits: 10000,
    category: 'payment',
    payee: 'Utility',
    memo: 'Bill payment [bill:utility]',
  });

  const res2 = matchPaymentsToObligation(cardDebtObligation, [billPaymentTx]);
  assert.equal(res2.isSatisfied, false, 'Explicit bill payment must not settle debt minimum obligation');
});

test('P1-A Test: Shared past-due obligation engine handles multi-year overdue without 24-month cutoff', () => {
  // A debt created 36 months ago (3 years ago: Nov 2023)
  const debt = {
    id: 'old-loan',
    name: 'Legacy Personal Loan',
    category: 'Personal loan',
    balance: 5000,
    originalBalance: 10000,
    apr: 9.99,
    minimumPayment: 150,
    dueDay: 1,
    creditLimit: null,
    createdAt: '2023-11-01T00:00:00Z',
  };

  const overdueList = calculateOverdueObligations({
    debts: [debt],
    recurringBills: [],
    transactions: [],
    asOfDate: parseDateOnly('2026-11-15'),
    currencyCode: 'USD',
  });

  // Between 2023-11 and 2026-11, there are 37 cycles (including 2026-11-01 which is < 2026-11-15)
  // An arbitrary 24-month cutoff would have missed cycles older than 24 months.
  assert.ok(overdueList.length >= 36, `Expected at least 36 overdue cycles, got ${overdueList.length}`);
  // Check the oldest cycle from 2023-11 is present
  assert.ok(overdueList.some(item => item.dueDate === '2023-11-01'), '2023-11-01 cycle must be present');
});

test('P1-A Test: Future-dated records or cycles before creation date produce NO phantom obligations', () => {
  // Bill created in the future: Dec 2026
  const futureBill = {
    id: 'future-bill',
    name: 'Future Service',
    category: 'subscription',
    amount: makeMoney('USD', 2000),
    dueDay: 5,
    paymentMethod: 'debit',
    autoPost: false,
    active: true,
    createdAt: '2026-12-01T00:00:00Z',
  };

  const overdue = calculateOverdueObligations({
    debts: [],
    recurringBills: [futureBill],
    transactions: [],
    asOfDate: parseDateOnly('2026-11-15'),
    currencyCode: 'USD',
  });

  assert.equal(overdue.length, 0, 'Future-dated bill must have 0 overdue obligations as of Nov 15');
});

test('P1-B Test: $100 recurring bill partial pay ($60 then $40) leaves $0 remaining and prevents further pay', () => {
  const bill = {
    id: 'bill-water-100',
    name: 'Water Co',
    category: 'utilities',
    amount: makeMoney('USD', 10000), // $100
    dueDay: 10,
    paymentMethod: 'debit',
    autoPost: false,
    active: true,
    createdAt: '2026-11-01T00:00:00Z',
  };

  const obligation = {
    id: bill.id,
    kind: 'bill',
    name: bill.name,
    dueDate: parseDateOnly('2026-11-10'),
    dueCycleMonth: '2026-11',
    requiredAmount: bill.amount,
    accountId: null,
    billId: bill.id,
    bill,
  };

  // Step 1: Record $60
  const tx1 = createTestTx({
    id: 'bill:bill-water-100:2026-11-10:part-1',
    accountId: null,
    date: '2026-11-08',
    appliesToDate: '2026-11-10',
    minorUnits: 6000,
    category: 'debit_bill',
    payee: 'Water Co',
    memo: 'Partial payment [bill:bill-water-100]',
  });

  const step1 = matchPaymentsToObligation(obligation, [tx1]);
  assert.equal(step1.isPartiallyPaid, true);
  assert.equal(step1.isSatisfied, false);
  assert.equal(moneyToMajor(step1.totalPaid), 60);
  assert.equal(moneyToMajor(step1.remainingAmount), 40);

  // Step 2: Record remaining $40
  const tx2 = createTestTx({
    id: 'bill:bill-water-100:2026-11-10:part-2',
    accountId: null,
    date: '2026-11-09',
    appliesToDate: '2026-11-10',
    minorUnits: 4000,
    category: 'debit_bill',
    payee: 'Water Co',
    memo: 'Final remainder [bill:bill-water-100]',
  });

  const step2 = matchPaymentsToObligation(obligation, [tx1, tx2]);
  assert.equal(step2.isPartiallyPaid, false);
  assert.equal(step2.isSatisfied, true);
  assert.equal(moneyToMajor(step2.totalPaid), 100);
  assert.equal(moneyToMajor(step2.remainingAmount), 0);
  assert.equal(moneyToMajor(step2.extraAmount), 0);
});

test('T-049: shared settlement state keeps unconfirmed bill payments pending and preserves partial transaction IDs', () => {
  const bill = {
    id: 'bill-water-status', name: 'Water', category: 'utilities', amount: makeMoney('USD', 10000),
    dueDay: 20, paymentMethod: 'debit', autoPost: false, active: true, createdAt: '2026-01-01T00:00:00Z',
  };
  const obligation = {
    kind: 'bill', billId: bill.id, bill, name: bill.name, dueDate: parseDateOnly('2026-11-20'),
    dueCycleMonth: '2026-11', requiredAmount: bill.amount, accountId: null,
  };
  const paid60 = createTestTx({
    id: `bill:${bill.id}:2026-11-20:part-1`, accountId: null, date: '2026-11-06',
    appliesToDate: '2026-11-20', minorUnits: 6000, category: 'debit_bill', payee: 'Water',
    memo: `[bill:${bill.id}]`, source: 'recurring_bill',
  });
  const pending40 = createTestTx({
    id: `bill:${bill.id}:2026-11-20:part-2`, accountId: null, date: '2026-11-07',
    appliesToDate: '2026-11-20', minorUnits: 4000, category: 'debit_bill', payee: 'Water',
    memo: `[bill:${bill.id}]`, source: 'recurring_bill', isPending: true,
  });

  assert.equal(getObligationPaymentState(obligation, []).status, 'unpaid');
  assert.equal(getObligationPaymentState(obligation, [paid60]).status, 'partially_paid');
  const awaiting = getObligationPaymentState(obligation, [paid60, pending40]);
  assert.equal(awaiting.status, 'pending_confirmation');
  assert.equal(awaiting.confirmedMatch.totalPaid.minorUnits, 6000);
  assert.equal(awaiting.confirmedMatch.remainingAmount.minorUnits, 4000);
  assert.equal(awaiting.pendingAmount.minorUnits, 4000);
  const confirmed = getObligationPaymentState(obligation, [paid60, { ...pending40, isPending: false }]);
  assert.equal(confirmed.status, 'paid');
  assert.equal(confirmed.confirmedMatch.matchedTransactions.length, 2);
  assert.notEqual(confirmed.confirmedMatch.matchedTransactions[0].id, confirmed.confirmedMatch.matchedTransactions[1].id);
});

test('T-049: upcoming and scheduled views share the active recurring-bill filter', () => {
  const activeBill = { id: 'active', active: true };
  const inactiveBill = { id: 'inactive', active: false };
  assert.deepEqual(getActiveRecurringBills([activeBill, inactiveBill]).map(bill => bill.id), ['active']);
});

test('T-049: date-only upcoming windows cross month boundaries without device-zone drift', () => {
  assert.equal(addCalendarDays(parseDateOnly('2026-11-30'), 14), '2026-12-14');
  assert.equal(addCalendarDays(parseDateOnly('2026-12-31'), 1), '2027-01-01');
  const instant = new Date('2026-11-01T06:30:00.000Z');
  const losAngelesToday = currentHouseholdDate('America/Los_Angeles', instant);
  assert.equal(losAngelesToday, '2026-10-31');
  assert.equal(addCalendarDays(losAngelesToday, 1), '2026-11-01');
});

