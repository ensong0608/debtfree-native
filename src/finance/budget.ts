// Node's direct TypeScript loader requires the extension; Expo resolves it as well.
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { getCurrency } from './currencies.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { addMoney, makeMoney, moneyToMajor } from './money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type RecurringBill } from './recurring-bills.ts';
// @ts-ignore TS5097
import { type LedgerTransaction } from './ledger.ts';
// @ts-ignore TS5097
import { extractBillIdFromTxId, extractBillIdsFromMemo } from './payment-matching.ts';

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

/** Render only categories that have source records; a real zero-dollar bill still counts as present. */
export function buildMonthlyBudgetBreakdown(params: {
  categories: readonly CategoryBudgetBreakdown[];
  hasActiveDebt: boolean;
  purchases: { total: number; count: number };
  monthlyIncome: number;
}): CategoryBudgetBreakdown[] {
  const visible = params.categories.filter(item => item.categoryKey === 'debt'
    ? params.hasActiveDebt
    : item.count > 0);
  if (params.purchases.count > 0) visible.push({
    categoryKey: 'purchases', label: 'Single purchases', amount: params.purchases.total,
    percentOfIncome: params.monthlyIncome > 0 ? Math.min(100, Math.round(params.purchases.total / params.monthlyIncome * 100)) : 0,
    count: params.purchases.count,
  });
  return visible;
}

function roundedAmount(value: number, currency: string): number {
  const scale = getCurrency(currency).scale;
  return Math.round(value * 10 ** scale) / 10 ** scale;
}

function percentage(amount: number, income: number): number {
  return income > 0 ? Math.min(100, Math.round(amount / income * 100)) : 0;
}

/** Cash commitments count debit bills, the debt plan, and card charges once. */
export function calculateMonthlyCashflow(params: {
  monthlyIncome: number;
  recurringBills: readonly RecurringBill[];
  monthlyDebtPlanPayment: number;
  /** Minimums represented by explicitly linked mortgage/auto bills, counted once via the bill. */
  pairedDebtMinimums?: number;
  currencyCode?: string;
}): MonthlyCashflowSummary {
  const { monthlyIncome, recurringBills, monthlyDebtPlanPayment } = params;
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
  const totalDebitBills = moneyToMajor(debit);
  const totalCreditBills = moneyToMajor(credit);
  const totalDebtPlanPayment = roundedAmount(Math.max(0, monthlyDebtPlanPayment - (params.pairedDebtMinimums ?? 0)), currency);
  const totalIncome = roundedAmount(monthlyIncome, currency);
  const totalCommitments = roundedAmount(totalDebitBills + totalCreditBills + totalDebtPlanPayment, currency);
  const remainingFreeCashflow = roundedAmount(totalIncome - totalCommitments, currency);
  return {
    totalIncome,
    totalDebitBills,
    totalCreditBills,
    totalDebtPlanPayment,
    totalCommitments,
    remainingFreeCashflow,
    debtPaymentPercent: percentage(totalDebtPlanPayment + totalCreditBills, totalIncome),
    debitBillsPercent: percentage(totalDebitBills, totalIncome),
    freeCashPercent: totalIncome > 0 ? Math.max(0, Math.min(100, Math.round(remainingFreeCashflow / totalIncome * 100))) : 0,
    isDeficit: remainingFreeCashflow < 0,
  };
}

/** Group active recurring bills and the debt plan by budget category. */
export function calculateCategoryBreakdown(params: {
  recurringBills: readonly RecurringBill[];
  customCategoryLabelsByBillId?: Readonly<Record<string, string>>;
  monthlyIncome: number;
  monthlyDebtPlanPayment: number;
  pairedDebtMinimums?: number;
  debtAccountCount?: number;
  currencyCode?: string;
}): CategoryBudgetBreakdown[] {
  const { recurringBills, monthlyIncome, monthlyDebtPlanPayment } = params;
  const currency = params.currencyCode ?? recurringBills[0]?.amount.currency ?? 'USD';
  getCurrency(currency);
  const categoryTotals: Record<string, { label: string; total: ReturnType<typeof makeMoney>; count: number }> = {
    housing: { label: 'Housing & Rent', total: makeMoney(currency, 0), count: 0 },
    utilities: { label: 'Utilities', total: makeMoney(currency, 0), count: 0 },
    subscription: { label: 'Subscriptions', total: makeMoney(currency, 0), count: 0 },
    insurance: { label: 'Insurance', total: makeMoney(currency, 0), count: 0 },
    other_bill: { label: 'Other Bills', total: makeMoney(currency, 0), count: 0 },
  };
  const customTotals: Record<string, { label: string; total: ReturnType<typeof makeMoney>; count: number }> = {};
  for (const bill of recurringBills) {
    if (!bill.active) continue;
    if (bill.amount.currency !== currency) throw new TypeError('Recurring bill currency does not match budget currency');
    const customLabel = bill.category === 'other_bill'
      ? params.customCategoryLabelsByBillId?.[bill.id]?.trim()
      : undefined;
    const customKey = customLabel ? customLabel.toLocaleLowerCase() : '';
    const cat = customKey
      ? (customTotals[customKey] ??= { label: customLabel!, total: makeMoney(currency, 0), count: 0 })
      : (categoryTotals[bill.category] ?? categoryTotals.other_bill);
    cat.total = addMoney(cat.total, bill.amount);
    cat.count += 1;
  }
  const income = roundedAmount(monthlyIncome, currency);
  const debt = roundedAmount(Math.max(0, monthlyDebtPlanPayment - (params.pairedDebtMinimums ?? 0)), currency);
  return [
    { categoryKey: 'debt', label: 'Debt plan payments', amount: debt, percentOfIncome: percentage(debt, income), count: params.debtAccountCount ?? 1 },
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
