// @ts-ignore TS5097: direct Node tests use TypeScript extensions.
import type { DebtItem, UserOnboardingData } from '../onboarding-domain.ts';
// @ts-ignore TS5097
import type { RecurringBill } from './recurring-bills.ts';
// @ts-ignore TS5097
import { moneyFromMajor } from './money.ts';
// @ts-ignore TS5097
import type { DateOnly } from './calendar.ts';
// @ts-ignore TS5097
import { prepareObligationEditorSchedule, type ObligationDueDateEdit } from './obligation-editor-domain.ts';
// @ts-ignore TS5097
import { resolveEffectiveDebtSchedule } from './payment-matching.ts';
// @ts-ignore TS5097
import { resolveUnifiedDebtSplitPlans } from './debt-payment-split.ts';
// @ts-ignore TS5097
import { auditLegacyLoanPairings, historicalBillIdsByDebtId, isUnifiedBudgetLoanCategory } from './loan-bill-pairing.ts';

export type UnifiedLoanSettings = Pick<UserOnboardingData, 'obligationSchedules' | 'mortgageEscrowByDebtId' | 'mortgageExtraPaymentByDebtId' | 'loanBillPairingByDebtId' | 'debtPaymentSplitPlansByDebtId' | 'billPaymentSplitPlansByBillId'>;

/** Prepare every loan-owned setting before a single atomic write. Bills are never rewritten. */
export function prepareUnifiedLoanSettings(params: {
  current: UserOnboardingData; debt: DebtItem; bills: readonly RecurringBill[];
  today: DateOnly; currency: string; paidToday?: boolean; escrow?: number | null; resolveLegacy?: boolean;
  dateEdit?: ObligationDueDateEdit;
}): UnifiedLoanSettings {
  const { current, debt, bills, today, currency } = params;
  if (!isUnifiedBudgetLoanCategory(debt.category)) throw new Error('Only mortgage and auto loans use this editor.');
  if (debt.balance > 0 && (debt.dueDay == null || !Number.isInteger(debt.dueDay) || debt.dueDay < 1 || debt.dueDay > 31)) {
    throw new Error('Enter a due day from 1 to 31 for this loan.');
  }
  const prior = current.debts.find(item => item.id === debt.id);
  const audit = auditLegacyLoanPairings({ debts: current.debts, recurringBills: bills, pairings: current.loanBillPairingByDebtId, currencyCode: currency });
  if (audit.invalidLinks.some(item => item.debtId === debt.id)) throw new Error('This loan has an unresolved historical identity. Records were preserved; resolve the link before editing.');
  if (!params.resolveLegacy && audit.divergentLinks.some(item => item.debt.id === debt.id)) throw new Error('Review the loan and recurring payment terms on Home before editing this loan.');
  const aliases = historicalBillIdsByDebtId(current.loanBillPairingByDebtId)[debt.id] ?? [];
  const priorBill = bills.find(bill => aliases.includes(bill.id));
  if (priorBill && priorBill.amount.currency !== currency) throw new Error('The saved bill currency does not match this household.');
  const relation = current.loanBillPairingByDebtId?.[debt.id];
  const legacySchedule = aliases.map(id => current.obligationSchedules?.['bill:' + id]).find(Boolean);
  const obligationSchedules = { ...(current.obligationSchedules ?? {}) };
  if (debt.dueDay != null) {
    obligationSchedules[`debt:${debt.id}`] = prepareObligationEditorSchedule({
      kind: 'debt', id: debt.id, today, timeZone: current.householdTimeZone,
      dueDay: debt.dueDay, amount: moneyFromMajor(debt.minimumPayment, currency),
      legacyDueDay: priorBill?.dueDay ?? prior?.dueDay ?? undefined,
      legacyAmount: priorBill?.amount ?? (prior ? moneyFromMajor(prior.minimumPayment, currency) : undefined),
      createdAt: priorBill?.createdAt ?? prior?.createdAt ?? debt.createdAt,
      isNew: !prior, paidToday: params.paidToday, ...params.dateEdit,
      existing: relation?.canonical ? resolveEffectiveDebtSchedule(current.obligationSchedules, debt.id, aliases)
        : legacySchedule ?? current.obligationSchedules?.['debt:' + debt.id],
    });
  }
  const mortgageEscrowByDebtId = { ...(current.mortgageEscrowByDebtId ?? {}) };
  const mortgageExtraPaymentByDebtId = { ...(current.mortgageExtraPaymentByDebtId ?? {}) };
  const escrow = params.escrow === undefined ? mortgageEscrowByDebtId[debt.id] : params.escrow;
  if (debt.category === 'Mortgage' && escrow != null) {
    if (!Number.isFinite(escrow) || escrow < 0 || moneyFromMajor(escrow, currency).minorUnits > moneyFromMajor(debt.minimumPayment, currency).minorUnits) {
      throw new Error('Mortgage escrow must be between zero and the monthly payment.');
    }
    mortgageEscrowByDebtId[debt.id] = escrow;
  } else {
    delete mortgageEscrowByDebtId[debt.id];
    if (debt.category !== 'Mortgage') delete mortgageExtraPaymentByDebtId[debt.id];
  }
  const loanBillPairingByDebtId = { ...(current.loanBillPairingByDebtId ?? {}) };
  if (relation?.status === 'linked') loanBillPairingByDebtId[debt.id] = { ...relation, canonical: true };
  const debtPaymentSplitPlansByDebtId = { ...(current.debtPaymentSplitPlansByDebtId ?? {}) };
  const billPaymentSplitPlansByBillId = { ...(current.billPaymentSplitPlansByBillId ?? {}) };
  const effective = resolveUnifiedDebtSplitPlans(debtPaymentSplitPlansByDebtId, billPaymentSplitPlansByBillId, { [debt.id]: aliases });
  if (effective[debt.id]) debtPaymentSplitPlansByDebtId[debt.id] = effective[debt.id];
  for (const id of aliases) delete billPaymentSplitPlansByBillId[id];
  return { obligationSchedules, mortgageEscrowByDebtId, mortgageExtraPaymentByDebtId, loanBillPairingByDebtId, debtPaymentSplitPlansByDebtId, billPaymentSplitPlansByBillId };
}
