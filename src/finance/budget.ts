// Node's direct TypeScript loader requires the extension; Expo resolves it as well.
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { getCurrency } from './currencies.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { addMoney, makeMoney, moneyToMajor } from './money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { type RecurringBill } from './recurring-bills.ts';

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
  const totalDebtPlanPayment = roundedAmount(monthlyDebtPlanPayment, currency);
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
  monthlyIncome: number;
  monthlyDebtPlanPayment: number;
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
  for (const bill of recurringBills) {
    if (!bill.active) continue;
    if (bill.amount.currency !== currency) throw new TypeError('Recurring bill currency does not match budget currency');
    const cat = categoryTotals[bill.category] ?? categoryTotals.other_bill;
    cat.total = addMoney(cat.total, bill.amount);
    cat.count += 1;
  }
  const income = roundedAmount(monthlyIncome, currency);
  const debt = roundedAmount(monthlyDebtPlanPayment, currency);
  return [
    { categoryKey: 'debt', label: 'Debt plan payments', amount: debt, percentOfIncome: percentage(debt, income), count: 1 },
    ...Object.entries(categoryTotals).map(([key, data]) => {
      const amount = moneyToMajor(data.total);
      return { categoryKey: key, label: data.label, amount, percentOfIncome: percentage(amount, income), count: data.count };
    }),
  ];
}
