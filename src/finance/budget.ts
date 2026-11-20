// Node's direct TypeScript loader requires the extension; Expo resolves it as well.
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { getCurrency } from './currencies.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { addMoney, makeMoney, moneyFromMajor, moneyToMajor } from './money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type RecurringBill } from './recurring-bills.ts';
// @ts-ignore TS5097
import { type LedgerTransaction } from './ledger.ts';
// @ts-ignore TS5097
import { extractBillIdFromTxId, extractBillIdsFromMemo } from './payment-matching.ts';
// @ts-ignore TS5097
import { linkedDebtByBillId, type LoanBillPairingMap, unifiedLoanBudgetCategory, unifiedLoanRuntime } from './loan-bill-pairing.ts';
// @ts-ignore TS5097
import { type DebtItem } from '../onboarding-domain.ts';

export type MonthlyCashflowSummary = Readonly<{
  totalIncome: number;
  totalDebitBills: number;
  totalCreditBills: number;
  totalDebtPlanPayment: number;
  totalCommitments: number;
  remainingFreeCashflow: number;
  debtPaymentPercent: number;
  debitBillsPercent: number;
  freeCashPercent: number;
  isDeficit: boolean;
}>;

export type CategoryBudgetBreakdown = Readonly<{
  categoryKey: string;
  label: string;
  amount: number;
  percentOfIncome: number;
  count: number;
}>;

export type TrackedDebtToIncomeSummary = Readonly<{
  monthlyDebtMinimums: number;
  ratioPercent: number | null;
}>;

/** DTI-style tracked ratio; deliberately separate from Budget commitments and payoff projections. */
export function calculateTrackedDebtToIncome(params: {
  debts: readonly { category: string; balance: number; minimumPayment: number }[];
  grossMonthlyIncome: number | null;
  currencyCode?: string;
}): TrackedDebtToIncomeSummary {
  const currency = params.currencyCode ?? 'USD';
  getCurrency(currency);
  const monthlyDebtMinimums = params.debts
    .filter(debt => debt.balance > 0)
    .reduce((total, debt) => addMoney(total, moneyFromMajor(debt.minimumPayment, currency)), makeMoney(currency, 0));
  const minimums = moneyToMajor(monthlyDebtMinimums);
  const gross = params.grossMonthlyIncome;
  return {
    monthlyDebtMinimums: minimums,
    ratioPercent: gross != null && Number.isFinite(gross) && gross > 0
      ? Math.round(minimums / gross * 1000) / 10
      : null,
  };
}

/** Budget commitment uses entered minimums for open cards and the entered extra. */
export function selectCardDebtCommitment<T extends { category: string; balance: number; minimumPayment: number }>(
  debts: readonly T[], extraMonthlyPayment: number, currency: string,
): { cards: T[]; extra: number; total: number } {
  const cards = debts.filter(debt => debt.category === 'Credit card' && debt.balance > 0);
  const extraMoney = moneyFromMajor(extraMonthlyPayment, currency);
  const total = cards.reduce((sum, card) => addMoney(sum, moneyFromMajor(card.minimumPayment, currency)), extraMoney);
  return { cards, extra: moneyToMajor(extraMoney), total: moneyToMajor(total) };
}

/** Budget debt-plan commitment includes all active non-Mortgage, non-Auto debts plus extra. */
export function selectDebtPlanCommitment<T extends { category: string; balance: number; minimumPayment: number }>(
  debts: readonly T[], extraMonthlyPayment: number, currency: string,
): { accounts: T[]; cards: T[]; extra: number; total: number } {
  const accounts = debts.filter(
    debt => debt.balance > 0 && debt.category !== 'Mortgage' && debt.category !== 'Auto loan',
  );
  const extraMoney = moneyFromMajor(extraMonthlyPayment, currency);
  const total = accounts.reduce((sum, debt) => addMoney(sum, moneyFromMajor(debt.minimumPayment, currency)), extraMoney);
  return { accounts, cards: accounts, extra: moneyToMajor(extraMoney), total: moneyToMajor(total) };
}

/** Render only categories that have source records; a real zero-dollar bill still counts as present. */
export function buildMonthlyBudgetBreakdown(params: {
  categories: readonly CategoryBudgetBreakdown[];
  hasActiveDebt: boolean;
  purchases?: { total: number; count: number };
  monthlyIncome: number;
}): CategoryBudgetBreakdown[] {
  const visible = params.categories.filter(item => item.categoryKey === 'debt'
    ? params.hasActiveDebt
    : item.count > 0);
  if (params.purchases && params.purchases.count > 0) visible.push({
    categoryKey: 'purchases', label: 'Recorded expenses', amount: params.purchases.total,
    percentOfIncome: params.monthlyIncome > 0 ? Math.round(params.purchases.total / params.monthlyIncome * 100) : 0,
    count: params.purchases.count,
  });
  return visible;
}

function roundedAmount(value: number, currency: string): number {
  const scale = getCurrency(currency).scale;
  return Math.round(value * 10 ** scale) / 10 ** scale;
}

function percentage(amount: number, income: number): number {
  return income > 0 ? Math.round(amount / income * 100) : 0;
}

export type UnifiedBudgetLoanCommitment = Readonly<{
  id: string;
  category: string;
  balance: number;
  minimumPayment: number;
}>;

/** Cash commitments count debit bills, unified loans, the debt plan, card charges once, and optional single purchases. */
export function calculateMonthlyCashflow(params: {
  monthlyIncome: number;
  recurringBills: readonly RecurringBill[];
  monthlyDebtPlanPayment: number;
  unifiedLoans?: readonly UnifiedBudgetLoanCommitment[];
  /** Minimums represented by explicitly linked mortgage/auto bills, counted once via the bill. */
  pairedDebtMinimums?: number;
  /** Optional confirmed single purchases for the selected month so header totals match breakdown rows. */
  singlePurchasesTotal?: number;
  currencyCode?: string;
}): MonthlyCashflowSummary {
  const { monthlyIncome, recurringBills, monthlyDebtPlanPayment, unifiedLoans = [], singlePurchasesTotal = 0 } = params;
  const currency = params.currencyCode ?? recurringBills[0]?.amount.currency ?? 'USD';
  getCurrency(currency);
  let debit = makeMoney(currency, 0);
  let credit = makeMoney(currency, 0);
  for (const bill of recurringBills) {
    if (!bill.active) continue;
    if (bill.amount.currency !== currency) throw new TypeError('Recurring bill currency does not match budget currency');
    if (bill.paymentMethod === 'debit') debit = addMoney(debit, bill.amount);
    else credit = addMoney(credit, bill.amount);
  }
  for (const loan of unifiedLoans) {
    if (loan.balance <= 0) continue;
    if (loan.category !== 'Mortgage' && loan.category !== 'Auto loan') continue;
    debit = addMoney(debit, moneyFromMajor(Math.max(0, loan.minimumPayment), currency));
  }
  const totalDebitBills = moneyToMajor(debit);
  const totalCreditBills = moneyToMajor(credit);
  const totalDebtPlanPayment = roundedAmount(Math.max(0, monthlyDebtPlanPayment - (params.pairedDebtMinimums ?? 0)), currency);
  const singlePurchases = roundedAmount(Math.max(0, singlePurchasesTotal), currency);
  const totalIncome = roundedAmount(monthlyIncome, currency);
  const totalCommitments = roundedAmount(totalDebitBills + totalCreditBills + totalDebtPlanPayment + singlePurchases, currency);
  const remainingFreeCashflow = roundedAmount(totalIncome - totalCommitments, currency);
  return {
    totalIncome,
    totalDebitBills,
    totalCreditBills,
    totalDebtPlanPayment,
    totalCommitments,
    remainingFreeCashflow,
    debtPaymentPercent: percentage(totalDebtPlanPayment, totalIncome),
    debitBillsPercent: percentage(totalDebitBills, totalIncome),
    freeCashPercent: totalIncome > 0 ? Math.max(0, Math.min(100, Math.round(remainingFreeCashflow / totalIncome * 100))) : 0,
    isDeficit: remainingFreeCashflow < 0,
  };
}

const BASE_BILL_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  housing: 'Home',
  utilities: 'Utilities',
  subscription: 'Subscriptions',
  insurance: 'Insurance',
  other_bill: 'Other Bills',
};

function resolveRecurringBillBudgetCategory(
  bill: Pick<RecurringBill, 'id' | 'category'>,
  customCategoryLabelsByBillId?: Readonly<Record<string, string>>,
): { categoryKey: string; label: string } {
  const customLabel = bill.category === 'other_bill'
    ? customCategoryLabelsByBillId?.[bill.id]?.trim()
    : undefined;
  const rawKey = customLabel ? customLabel.toLocaleLowerCase() : '';
  const customKey = rawKey === 'auto' || rawKey === 'transportation' ? 'transportation' : rawKey;
  if (customKey) {
    return {
      categoryKey: `custom:${customKey}`,
      label: customKey === 'transportation' ? 'Auto' : customLabel!,
    };
  }
  const key = BASE_BILL_CATEGORY_LABELS[bill.category] ? bill.category : 'other_bill';
  return { categoryKey: key, label: BASE_BILL_CATEGORY_LABELS[key] };
}

/** Group active recurring bills, unified loans, and the debt plan by budget category. */
export function calculateCategoryBreakdown(params: {
  recurringBills: readonly RecurringBill[];
  unifiedLoans?: readonly UnifiedBudgetLoanCommitment[];
  customCategoryLabelsByBillId?: Readonly<Record<string, string>>;
  monthlyIncome: number;
  monthlyDebtPlanPayment: number;
  pairedDebtMinimums?: number;
  debtAccountCount?: number;
  currencyCode?: string;
}): CategoryBudgetBreakdown[] {
  const { recurringBills, unifiedLoans = [], monthlyIncome, monthlyDebtPlanPayment } = params;
  const currency = params.currencyCode ?? recurringBills[0]?.amount.currency ?? 'USD';
  getCurrency(currency);
  const categoryTotals: Record<string, { label: string; total: ReturnType<typeof makeMoney>; count: number }> = {
    housing: { label: 'Home', total: makeMoney(currency, 0), count: 0 },
    utilities: { label: 'Utilities', total: makeMoney(currency, 0), count: 0 },
    subscription: { label: 'Subscriptions', total: makeMoney(currency, 0), count: 0 },
    insurance: { label: 'Insurance', total: makeMoney(currency, 0), count: 0 },
    other_bill: { label: 'Other Bills', total: makeMoney(currency, 0), count: 0 },
  };
  const customTotals: Record<string, { label: string; total: ReturnType<typeof makeMoney>; count: number }> = {};
  for (const bill of recurringBills) {
    if (!bill.active) continue;
    if (bill.amount.currency !== currency) throw new TypeError('Recurring bill currency does not match budget currency');
    const resolved = resolveRecurringBillBudgetCategory(bill, params.customCategoryLabelsByBillId);
    const cat = resolved.categoryKey.startsWith('custom:')
      ? (customTotals[resolved.categoryKey.slice('custom:'.length)] ??= { label: resolved.label, total: makeMoney(currency, 0), count: 0 })
      : (categoryTotals[resolved.categoryKey] ?? categoryTotals.other_bill);
    cat.total = addMoney(cat.total, bill.amount);
    cat.count += 1;
  }
  for (const loan of unifiedLoans) {
    if (loan.balance <= 0) continue;
    if (loan.category === 'Mortgage') {
      categoryTotals.housing.total = addMoney(categoryTotals.housing.total, moneyFromMajor(Math.max(0, loan.minimumPayment), currency));
      categoryTotals.housing.count += 1;
    } else if (loan.category === 'Auto loan') {
      const transport = (customTotals.transportation ??= { label: 'Auto', total: makeMoney(currency, 0), count: 0 });
      transport.total = addMoney(transport.total, moneyFromMajor(Math.max(0, loan.minimumPayment), currency));
      transport.count += 1;
    }
  }
  const income = roundedAmount(monthlyIncome, currency);
  const debt = roundedAmount(Math.max(0, monthlyDebtPlanPayment - (params.pairedDebtMinimums ?? 0)), currency);
  return [
    { categoryKey: 'debt', label: 'Debt payments', amount: debt, percentOfIncome: percentage(debt, income), count: params.debtAccountCount ?? 1 },
    ...Object.entries(categoryTotals).map(([key, data]) => {
      const amount = moneyToMajor(data.total);
      return { categoryKey: key, label: data.label, amount, percentOfIncome: percentage(amount, income), count: data.count };
    }),
    ...Object.entries(customTotals).map(([key, data]) => {
      const amount = moneyToMajor(data.total);
      return { categoryKey: `custom:${key}`, label: data.label, amount, percentOfIncome: percentage(amount, income), count: data.count };
    }),
  ];
}

/** Confirmed standalone purchases are recorded spending, separate from commitments. */
export function summarizeSinglePurchases(transactions: readonly LedgerTransaction[], month: string, currency: string) {
  const items = transactions.filter(tx => (tx.category === 'purchase' || tx.category === 'debit_spending') && tx.date.slice(0, 7) === month &&
    tx.deletedAt === null && !tx.isPending && tx.source !== 'recurring_bill' &&
    extractBillIdFromTxId(tx.id) === null && extractBillIdsFromMemo(tx.memo).size === 0);
  let total = makeMoney(currency, 0);
  for (const tx of items) {
    if (tx.amount.currency !== currency) throw new TypeError('Transaction currency does not match budget currency');
    total = addMoney(total, tx.amount);
  }
  return { items, total: moneyToMajor(total) };
}

export type ExpenseDebtInput = Pick<DebtItem, 'id' | 'category' | 'balance' | 'minimumPayment' | 'dueDay'> & Partial<DebtItem>;

export type ExpenseCategoryBreakdown = Readonly<{
  categoryKey: string;
  label: string;
  amount: number;
  count: number;
  paymentCount: number;
  billCount: number;
  chargeCount: number;
  subtitle: string;
  items: readonly LedgerTransaction[];
}>;

export type MonthlyExpenseSummary = Readonly<{
  cashOutflow: number;
  totalDebtPayments: number;
  others: number;
  unpaidCharges: number;
  netBalanceChange: number;
  cashBreakdown: readonly { categoryKey: string; label: string; amount: number }[];
  categories: readonly ExpenseCategoryBreakdown[];
  transactions: readonly LedgerTransaction[];
}>;

type ExpenseEntryKind = 'payment' | 'bill' | 'charge';

const EXPENSE_CATEGORY_ORDER: Readonly<Record<string, number>> = {
  debt: 0,
  housing: 1,
  charges: 2,
  'custom:transportation': 3,
  utilities: 4,
  insurance: 5,
  subscription: 6,
  other_bill: 7,
};

/**
 * Summarize confirmed, undeleted actual payments, recurring bill settlements, and standalone charges
 * for a selected month without double-counting linked Mortgage/Auto obligations or repeated tags.
 */
export function summarizeMonthlyExpenses(params: {
  month: string;
  currencyCode: string;
  transactions: readonly LedgerTransaction[];
  debts?: readonly ExpenseDebtInput[];
  recurringBills?: readonly RecurringBill[];
  loanBillPairingByDebtId?: LoanBillPairingMap;
  customCategoryLabelsByBillId?: Readonly<Record<string, string>>;
  archivedPaidOffDebtIds?: readonly string[];
  historicalBillIdsByDebtId?: Readonly<Record<string, readonly string[]>>;
}): MonthlyExpenseSummary {
  const {
    month,
    currencyCode,
    transactions,
    debts = [],
    recurringBills = [],
    loanBillPairingByDebtId = {},
    customCategoryLabelsByBillId,
    archivedPaidOffDebtIds = [],
    historicalBillIdsByDebtId = {},
  } = params;
  getCurrency(currencyCode);

  const normalizedDebts: DebtItem[] = debts.map(debt => ({
    id: debt.id,
    name: debt.name ?? '',
    category: debt.category,
    balance: debt.balance,
    originalBalance: debt.originalBalance ?? null,
    apr: debt.apr ?? 0,
    minimumPayment: debt.minimumPayment,
    dueDay: debt.dueDay,
    creditLimit: debt.creditLimit ?? null,
    annualFeeAmount: debt.annualFeeAmount,
    annualFeeNextDueDate: debt.annualFeeNextDueDate,
    createdAt: debt.createdAt ?? '1970-01-01T00:00:00Z',
    updatedAt: debt.updatedAt ?? '1970-01-01T00:00:00Z',
    serverVersion: debt.serverVersion,
  }));

  const debtById = new Map(normalizedDebts.map(debt => [debt.id, debt]));
  const billById = new Map(recurringBills.map(bill => [bill.id, bill]));
  const runtime = unifiedLoanRuntime({
    debts: normalizedDebts,
    bills: recurringBills,
    pairings: loanBillPairingByDebtId,
    archived: archivedPaidOffDebtIds,
    currency: currencyCode,
  });

  const linkedDebtIdByBillId = new Map<string, string>();
  for (const [debtId, aliasIds] of Object.entries(runtime.aliases)) {
    for (const billId of aliasIds) linkedDebtIdByBillId.set(billId, debtId);
  }
  const historicalUses = new Map<string, number>();
  for (const aliasIds of Object.values(historicalBillIdsByDebtId)) {
    for (const billId of aliasIds) historicalUses.set(billId, (historicalUses.get(billId) ?? 0) + 1);
  }
  for (const [debtId, aliasIds] of Object.entries(historicalBillIdsByDebtId)) {
    for (const billId of aliasIds) {
      if (historicalUses.get(billId) === 1 && !linkedDebtIdByBillId.has(billId)) {
        linkedDebtIdByBillId.set(billId, debtId);
      }
    }
  }
  const invalidBillIds = new Set(runtime.audit.invalidLinks.map(item => item.billId).filter((id): id is string => Boolean(id)));
  for (const [billId, debtId] of Object.entries(linkedDebtByBillId(loanBillPairingByDebtId))) {
    if (!invalidBillIds.has(billId) && !linkedDebtIdByBillId.has(billId)) {
      linkedDebtIdByBillId.set(billId, debtId);
    }
  }

  const eligibleTransactions = transactions.filter(tx => {
    if (tx.deletedAt !== null || tx.isPending) return false;
    if (tx.amount.currency !== currencyCode || tx.amount.minorUnits <= 0) return false;
    if (tx.date.slice(0, 7) !== month) return false;
    if (tx.source === 'reconciliation') return false;
    if (
      tx.category === 'refund' ||
      tx.category === 'credit_adjustment' ||
      tx.category === 'balance_adjustment' ||
      tx.category === 'interest_adjustment'
    ) {
      return false;
    }
    return true;
  });

  // An old linked bill can mirror a loan payment. Match by amount and actual date
  // within its due cycle so separate installments in the cycle remain counted.
  const loanPaymentKey = (debtId: string, tx: LedgerTransaction) =>
    JSON.stringify([debtId, (tx.appliesToDate ?? tx.date).slice(0, 7), tx.date, tx.amount.minorUnits]);
  const loanPayments = new Map<string, number>();
  const indexedPaymentIds = new Set<string>();
  for (const tx of eligibleTransactions) {
    if (tx.category !== 'payment' || !tx.accountId || indexedPaymentIds.has(tx.id)) continue;
    const debt = debtById.get(tx.accountId);
    if (!debt || (debt.category !== 'Mortgage' && debt.category !== 'Auto loan')) continue;
    indexedPaymentIds.add(tx.id);
    const key = loanPaymentKey(debt.id, tx);
    loanPayments.set(key, (loanPayments.get(key) ?? 0) + 1);
  }

  const seenTxIds = new Set<string>();
  const includedTransactions: LedgerTransaction[] = [];
  let totalDebtPayments = makeMoney(currencyCode, 0);
  let others = makeMoney(currencyCode, 0);
  let unpaidCharges = makeMoney(currencyCode, 0);
  const cashByCategory = new Map<string, { label: string; amount: LedgerTransaction['amount'] }>();
  const buckets = new Map<string, {
    categoryKey: string;
    label: string;
    total: ReturnType<typeof makeMoney>;
    paymentCount: number;
    billCount: number;
    chargeCount: number;
    transactions: LedgerTransaction[];
  }>();

  const recordTransaction = (categoryKey: string, label: string, kind: ExpenseEntryKind, tx: LedgerTransaction) => {
    seenTxIds.add(tx.id);
    includedTransactions.push(tx);
    if (kind === 'charge') {
      unpaidCharges = addMoney(unpaidCharges, tx.amount);
    } else {
      if (kind === 'payment') totalDebtPayments = addMoney(totalDebtPayments, tx.amount);
      else others = addMoney(others, tx.amount);
      const prior = cashByCategory.get(categoryKey);
      cashByCategory.set(categoryKey, { label, amount: prior ? addMoney(prior.amount, tx.amount) : tx.amount });
    }
    let bucket = buckets.get(categoryKey);
    if (!bucket) {
      bucket = {
        categoryKey,
        label,
        total: makeMoney(currencyCode, 0),
        paymentCount: 0,
        billCount: 0,
        chargeCount: 0,
        transactions: [],
      };
      buckets.set(categoryKey, bucket);
    }
    bucket.total = addMoney(bucket.total, tx.amount);
    if (kind === 'payment') bucket.paymentCount += 1;
    else if (kind === 'bill') bucket.billCount += 1;
    else bucket.chargeCount += 1;
    bucket.transactions.push(tx);
  };

  for (const tx of eligibleTransactions) {
    if (seenTxIds.has(tx.id)) continue;

    // 1. Confirmed debt payments route by account category (Mortgage -> Home, Auto -> Auto, others -> Debts).
    if (tx.category === 'payment' && tx.accountId !== null) {
      const debt = debtById.get(tx.accountId);
      if (debt?.category === 'Mortgage') {
        recordTransaction('housing', 'Home', 'payment', tx);
      } else if (debt?.category === 'Auto loan') {
        recordTransaction('custom:transportation', 'Auto', 'payment', tx);
      } else {
        recordTransaction('debt', 'Debts', 'payment', tx);
      }
      continue;
    }

    // 2. Recurring bill settlements resolved strictly by stored bill IDs and validated loan pairings.
    const txBillIdFromId = extractBillIdFromTxId(tx.id);
    const memoBillIds = extractBillIdsFromMemo(tx.memo);
    const candidateBillIds: string[] = [];
    if (txBillIdFromId) candidateBillIds.push(txBillIdFromId);
    for (const memoId of memoBillIds) {
      if (memoId !== txBillIdFromId) candidateBillIds.push(memoId);
    }

    const linkedBillId = candidateBillIds.find(id => linkedDebtIdByBillId.has(id));
    if (linkedBillId) {
      const linkedDebtId = linkedDebtIdByBillId.get(linkedBillId)!;
      const linkedDebt = debtById.get(linkedDebtId);
      const loanCat = linkedDebt ? unifiedLoanBudgetCategory(linkedDebt.category) : null;
      if (loanCat) {
        const key = loanPaymentKey(linkedDebtId, tx);
        const duplicateCount = loanPayments.get(key) ?? 0;
        if (duplicateCount > 0) {
          loanPayments.set(key, duplicateCount - 1);
          seenTxIds.add(tx.id);
          continue;
        }
        recordTransaction(
          loanCat,
          loanCat === 'housing' ? 'Home' : 'Auto',
          'payment',
          tx,
        );
        continue;
      }
    }

    const matchedBill = candidateBillIds.map(id => billById.get(id)).find((bill): bill is RecurringBill => {
      if (!bill) return false;
      if (bill.paymentMethod === 'credit') {
        return tx.category !== 'payment' && (tx.accountId === bill.creditAccountId || (tx.category === 'debit_bill' && tx.accountId === null));
      }
      return tx.accountId === null
        ? (tx.category === 'debit_bill' || tx.category === 'payment')
        : tx.category !== 'payment';
    });

    // Automatic credit posts record a charge. An explicit recorded bill payment
    // or a historical linked settlement counts as a paid expense.
    if (tx.source === 'recurring_bill' && tx.accountId !== null &&
      tx.memo?.startsWith('Auto-recorded recurring bill (Charged to credit card)')) {
      recordTransaction('charges', 'Charges', 'charge', tx);
      continue;
    }

    if (matchedBill) {
      const resolved = resolveRecurringBillBudgetCategory(matchedBill, customCategoryLabelsByBillId);
      recordTransaction(resolved.categoryKey, resolved.label, 'bill', tx);
      continue;
    }

    if (tx.category === 'debit_bill' || tx.source === 'recurring_bill') {
      if (tx.category === 'subscription') {
        recordTransaction('subscription', 'Subscriptions', 'bill', tx);
      } else if (tx.category === 'utilities') {
        recordTransaction('utilities', 'Utilities', 'bill', tx);
      } else {
        recordTransaction('other_bill', 'Other Bills', 'bill', tx);
      }
      continue;
    }

    // 3. Standalone charges (interest, fees, annual fees, standalone purchases/debit spending/non-bill charges).
    if (
      tx.category === 'purchase' ||
      tx.category === 'debit_spending' ||
      tx.category === 'subscription' ||
      tx.category === 'utilities' ||
      tx.category === 'interest' ||
      tx.category === 'fee' ||
      tx.category === 'annual_fee'
    ) {
      if (tx.accountId === null) recordTransaction('other_spending', 'Other spending', 'bill', tx);
      else recordTransaction('charges', 'Charges', 'charge', tx);
    }
  }

  const categories: ExpenseCategoryBreakdown[] = [...buckets.values()]
    .map(bucket => {
      const sortedTxs = [...bucket.transactions].sort((a, b) =>
        b.date.localeCompare(a.date) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
      );
      const count = sortedTxs.length;
      const unit = bucket.billCount === 0 ? 'payment' : bucket.paymentCount === 0 ? 'bill' : 'item';
      return {
        categoryKey: bucket.categoryKey,
        label: bucket.label,
        amount: moneyToMajor(bucket.total),
        count,
        paymentCount: bucket.paymentCount,
        billCount: bucket.billCount,
        chargeCount: bucket.chargeCount,
        subtitle: bucket.chargeCount > 0 ? 'Purchases, interest & fees' : `${count} ${unit}${count === 1 ? '' : 's'}`,
        items: sortedTxs,
      };
    })
    .sort((a, b) =>
      b.amount - a.amount ||
      (EXPENSE_CATEGORY_ORDER[a.categoryKey] ?? 99) - (EXPENSE_CATEGORY_ORDER[b.categoryKey] ?? 99) ||
      a.label.localeCompare(b.label),
    );

  const sortedIncluded = [...includedTransactions].sort((a, b) =>
    b.date.localeCompare(a.date) ||
    b.createdAt.localeCompare(a.createdAt) ||
    a.id.localeCompare(b.id),
  );

  return {
    cashOutflow: moneyToMajor(addMoney(totalDebtPayments, others)),
    totalDebtPayments: moneyToMajor(totalDebtPayments),
    others: moneyToMajor(others),
    unpaidCharges: moneyToMajor(unpaidCharges),
    netBalanceChange: moneyToMajor(addMoney(unpaidCharges, makeMoney(currencyCode, -totalDebtPayments.minorUnits))),
    cashBreakdown: [...cashByCategory].map(([categoryKey, entry]) => ({
      categoryKey, label: entry.label, amount: moneyToMajor(entry.amount),
    })).sort((a, b) => b.amount - a.amount),
    categories,
    transactions: sortedIncluded,
  };
}

export type AnnualCardFeeReserveSummary = Readonly<{
  totalAnnualFees: number;
  monthlySinkingReserve: number;
  cardCount: number;
}>;

/** Monthly sinking-fund reserve for recurring annual credit card fees. */
export function summarizeAnnualCardFeesMonthly(
  debts: readonly { category?: string; annualFeeAmount?: number | null }[],
  currencyCode = 'USD',
): AnnualCardFeeReserveSummary {
  const scale = getCurrency(currencyCode).scale;
  const factor = 10 ** scale;
  const roundToCurrency = (value: number) => Math.round((value + Number.EPSILON) * factor) / factor;
  let totalAnnualFees = 0;
  let cardCount = 0;
  for (const debt of debts) {
    if (debt.category !== 'Credit card') continue;
    const fee = debt.annualFeeAmount;
    if (fee != null && Number.isFinite(fee) && fee > 0) {
      totalAnnualFees += fee;
      cardCount += 1;
    }
  }
  const roundedAnnual = roundToCurrency(totalAnnualFees);
  return {
    totalAnnualFees: roundedAnnual,
    monthlySinkingReserve: cardCount > 0 ? roundToCurrency(roundedAnnual / 12) : 0,
    cardCount,
  };
}
