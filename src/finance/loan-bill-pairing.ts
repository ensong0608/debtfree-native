// @ts-ignore TS5097: direct Node tests load TypeScript modules by extension.
import { type DebtItem, type LoanBillPairing } from '../onboarding-domain.ts';
// @ts-ignore TS5097
import { type RecurringBill } from './recurring-bills.ts';
// @ts-ignore TS5097
import { parseMoney } from './money.ts';

export type LoanBillPairingMap = Readonly<Record<string, LoanBillPairing | undefined>>;

/** One stable, idempotent debit commitment for a mortgage/auto loan entered in first-time onboarding. */
export function createOnboardingLoanBill(debt: DebtItem, currency: string, createdAt = debt.createdAt): RecurringBill {
  if (debt.category !== 'Mortgage' && debt.category !== 'Auto loan') throw new TypeError('Only mortgage and auto loans have linked onboarding bills');
  if (debt.dueDay === null || debt.minimumPayment <= 0) throw new RangeError('A due day and positive monthly payment are required to create the linked recurring item');
  return {
    // Debt and recurring-bill IDs live in separate tables. Reusing the UUID makes retry/reload recovery deterministic.
    id: debt.id,
    name: `${debt.name} payment`,
    category: debt.category === 'Mortgage' ? 'housing' : 'other_bill',
    amount: parseMoney(String(debt.minimumPayment), currency),
    dueDay: debt.dueDay,
    paymentMethod: 'debit',
    autoPost: false,
    active: true,
    createdAt,
  };
}

/** Decide whether an onboarding retry may safely reuse, persist, or must recover a bill first. */
export function onboardingLoanBillSaveAction(params: {
  existingBill?: RecurringBill;
  desiredBill: RecurringBill;
  authoritativeSnapshot: boolean;
}): 'reuse_confirmed' | 'persist' | 'wait_for_recovery' | 'conflict' {
  const { existingBill, desiredBill, authoritativeSnapshot } = params;
  if (!authoritativeSnapshot) return 'wait_for_recovery';
  if (!existingBill) return 'persist';
  if (!existingBill.updatedAt) return 'wait_for_recovery';
  const normalizedTimestamp = (value: string): string | null => {
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
  };
  const existingCreatedAt = normalizedTimestamp(existingBill.createdAt);
  const desiredCreatedAt = normalizedTimestamp(desiredBill.createdAt);
  const matches = existingBill.id === desiredBill.id && existingBill.name === desiredBill.name &&
    existingBill.category === desiredBill.category && existingBill.amount.currency === desiredBill.amount.currency &&
    existingBill.amount.minorUnits === desiredBill.amount.minorUnits && existingBill.dueDay === desiredBill.dueDay &&
    existingBill.paymentMethod === desiredBill.paymentMethod && existingBill.creditAccountId === desiredBill.creditAccountId &&
    existingBill.autoPost === desiredBill.autoPost && existingBill.active === desiredBill.active &&
    existingCreatedAt !== null && desiredCreatedAt !== null && existingCreatedAt === desiredCreatedAt;
  return matches ? 'reuse_confirmed' : 'conflict';
}

export function linkedBillByDebtId(pairings: LoanBillPairingMap = {}): Record<string, string> {
  return Object.fromEntries(Object.entries(pairings)
    .filter(([, relation]) => relation?.status === 'linked' && relation.billId)
    .map(([debtId, relation]) => [debtId, relation!.billId!]));
}

export function activeLoanBillLinks(pairings: LoanBillPairingMap = {}, bills: readonly RecurringBill[] = [], debts?: readonly DebtItem[]): Record<string, string> {
  const activeIds = new Set(bills.filter(bill => bill.active).map(bill => bill.id));
  const billById = new Map(bills.map(bill => [bill.id, bill]));
  const debtById = debts ? new Map(debts.map(debt => [debt.id, debt])) : null;
  const links = linkedBillByDebtId(pairings);
  const uses = new Map<string, number>();
  for (const billId of Object.values(links)) uses.set(billId, (uses.get(billId) ?? 0) + 1);
  return Object.fromEntries(Object.entries(links).filter(([debtId, billId]) => {
    if (!activeIds.has(billId) || uses.get(billId) !== 1) return false;
    if (!debtById) return true;
    const debt = debtById.get(debtId);
    const bill = billById.get(billId);
    return Boolean(debt && debt.balance > 0 && bill && compatibleLoanBills(debt, [bill]).length === 1);
  }));
}

export function linkedDebtByBillId(pairings: LoanBillPairingMap = {}): Record<string, string> {
  return Object.fromEntries(Object.entries(linkedBillByDebtId(pairings)).map(([debtId, billId]) => [billId, debtId]));
}

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(word => word.length > 2));
}

export function compatibleLoanBills(debt: DebtItem, bills: readonly RecurringBill[]): RecurringBill[] {
  if (debt.category === 'Mortgage') return bills.filter(bill => bill.active && bill.paymentMethod === 'debit' && (bill.category === 'housing' || bill.category === 'other_bill'));
  if (debt.category === 'Auto loan') return bills.filter(bill => bill.active && bill.paymentMethod === 'debit' && bill.category === 'other_bill');
  return [];
}

export function isCompatibleLoanBillPair(debt: DebtItem, bill: RecurringBill): boolean {
  return compatibleLoanBills(debt, [bill]).length === 1;
}

/** Remove only the confirmed-deleted debt's relation; unrelated settings survive. */
export function withoutDeletedDebtPairing(pairings: LoanBillPairingMap = {}, debtId: string): Record<string, LoanBillPairing> {
  const next = { ...pairings } as Record<string, LoanBillPairing>;
  delete next[debtId];
  return next;
}

/** Remove only relations to the confirmed-deleted bill; preserve all other metadata. */
export function withoutDeletedBillPairings(pairings: LoanBillPairingMap = {}, billId: string): Record<string, LoanBillPairing> {
  return Object.fromEntries(Object.entries(pairings).filter(([, relation]) => relation?.status !== 'linked' || relation.billId !== billId)) as Record<string, LoanBillPairing>;
}

/** Clear a link only when the edited debt can no longer use its previously linked bill. */
export function withoutIncompatibleDebtPairing(pairings: LoanBillPairingMap = {}, debt: DebtItem, bills: readonly RecurringBill[]): Record<string, LoanBillPairing> {
  const relation = pairings[debt.id];
  if (relation?.status !== 'linked') return { ...pairings } as Record<string, LoanBillPairing>;
  const bill = bills.find(candidate => candidate.id === relation.billId);
  if (bill && isCompatibleLoanBillPair(debt, bill)) return { ...pairings } as Record<string, LoanBillPairing>;
  return withoutDeletedDebtPairing(pairings, debt.id);
}

/** Clear links invalidated by the edited bill's category, method, or active state. */
export function withoutIncompatibleBillPairings(pairings: LoanBillPairingMap = {}, bill: RecurringBill, debts: readonly DebtItem[]): Record<string, LoanBillPairing> {
  return Object.fromEntries(Object.entries(pairings).filter(([debtId, relation]) => {
    if (relation?.status !== 'linked' || relation.billId !== bill.id) return true;
    const debt = debts.find(candidate => candidate.id === debtId);
    return Boolean(debt && isCompatibleLoanBillPair(debt, bill));
  })) as Record<string, LoanBillPairing>;
}

/** Suggestions are hints only. A row is persisted as linked only after an explicit user action. */
export function suggestLoanBills(debt: DebtItem, bills: readonly RecurringBill[]): RecurringBill[] {
  const candidates = compatibleLoanBills(debt, bills);
  const debtWords = words(debt.name);
  return candidates.map((bill, index) => ({ bill, index, score: [...words(bill.name)].filter(word => debtWords.has(word)).length }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(row => row.bill);
}

export function loansNeedingPairingReview(debts: readonly DebtItem[], _bills: readonly RecurringBill[], pairings: LoanBillPairingMap = {}): DebtItem[] {
  return debts.filter(debt => (debt.category === 'Mortgage' || debt.category === 'Auto loan') &&
    debt.balance > 0 &&
    pairings[debt.id] === undefined);
}

/** Sum the loan minimums replaced by linked recurring bill commitments. */
export function pairedDebtMinimumTotal(debts: readonly DebtItem[], pairings: LoanBillPairingMap = {}): number {
  const linkedDebtIds = new Set(Object.keys(linkedBillByDebtId(pairings)));
  // The shared payoff plan excludes mortgages and includes auto loans. Only the latter
  // minimum can be replaced from its aggregate monthly plan commitment.
  return debts.filter(debt => linkedDebtIds.has(debt.id) && debt.category === 'Auto loan' && debt.balance > 0)
    .reduce((total, debt) => total + Math.max(0, debt.minimumPayment), 0);
}
