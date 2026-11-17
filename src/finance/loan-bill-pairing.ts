// @ts-ignore TS5097: direct Node tests load TypeScript modules by extension.
import { type DebtItem, type LoanBillPairing } from '../onboarding-domain.ts';
// @ts-ignore TS5097
import { type RecurringBill } from './recurring-bills.ts';
// @ts-ignore TS5097
import { moneyFromMajor, moneyToMajor, parseMoney } from './money.ts';
// @ts-ignore TS5097
import { isPaidOffAccountArchived } from './ledger.ts';

export type LoanBillPairingMap = Readonly<Record<string, LoanBillPairing | undefined>>;
export type UnifiedLoanBudgetCategory = 'housing' | 'custom:transportation';

export function isUnifiedBudgetLoanCategory(category: DebtItem['category'] | string): category is 'Mortgage' | 'Auto loan' {
  return category === 'Mortgage' || category === 'Auto loan';
}

export function unifiedLoanBudgetCategory(category: DebtItem['category'] | string): UnifiedLoanBudgetCategory | null {
  if (category === 'Mortgage') return 'housing';
  if (category === 'Auto loan') return 'custom:transportation';
  return null;
}

export function selectUnifiedBudgetLoans(
  debts: readonly DebtItem[],
  archivedPaidOffDebtIds: readonly string[] = [],
  excludedDebtIds: readonly string[] = [],
): DebtItem[] {
  const excluded = new Set(excludedDebtIds);
  return debts.filter(debt =>
    isUnifiedBudgetLoanCategory(debt.category) &&
    debt.balance > 0 &&
    !isPaidOffAccountArchived(debt, archivedPaidOffDebtIds) &&
    !excluded.has(debt.id));
}

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

/** Resolve active, unique, compatible stored identities for history and editing. */
export function validatedLoanBillLinks(pairings: LoanBillPairingMap = {}, bills: readonly RecurringBill[] = [], debts?: readonly DebtItem[]): Record<string, string> {
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
    return Boolean(debt && bill && compatibleLoanBills(debt, [bill]).length === 1);
  }));
}

/** Only outstanding loans schedule the recurring payment as a debt obligation. */
export function activeLoanBillLinks(pairings: LoanBillPairingMap = {}, bills: readonly RecurringBill[] = [], debts?: readonly DebtItem[]): Record<string, string> {
  const validated = validatedLoanBillLinks(pairings, bills, debts);
  if (!debts) {
    const billById = new Map(bills.map(bill => [bill.id, bill]));
    return Object.fromEntries(Object.entries(validated).filter(([, billId]) => billById.get(billId)?.active === true));
  }
  const debtById = new Map(debts.map(debt => [debt.id, debt]));
  const billById = new Map(bills.map(bill => [bill.id, bill]));
  return Object.fromEntries(Object.entries(validated).filter(([debtId, billId]) =>
    (debtById.get(debtId)?.balance ?? 0) > 0 && billById.get(billId)?.active === true));
}

/** Exact active recurring bills whose stored loan pairing belongs to an archived account. */
export function recurringBillsForArchivedLoans(
  pairings: LoanBillPairingMap = {},
  bills: readonly RecurringBill[] = [],
  debts: readonly DebtItem[] = [],
  archivedPaidOffDebtIds: readonly string[] = [],
): string[] {
  const archived = new Set(archivedPaidOffDebtIds);
  const debtById = new Map(debts.map(debt => [debt.id, debt]));
  return Object.entries(validatedLoanBillLinks(pairings, bills, debts)).flatMap(([debtId, billId]) => {
    if (!archived.has(debtId)) return [];
    const debt = debtById.get(debtId);
    const bill = bills.find(item => item.id === billId);
    return debt && debt.balance === 0 && bill?.active ? [billId] : [];
  });
}

export type DivergentLoanBillLink = Readonly<{
  debt: DebtItem;
  bill: RecurringBill;
  amountDiffers: boolean;
  dueDayDiffers: boolean;
}>;

export type InvalidLoanBillLink = Readonly<{
  debtId: string;
  billId: string | null;
  reason: 'missing_debt' | 'missing_bill' | 'inactive_bill' | 'duplicate_bill' | 'incompatible_bill';
  debt?: DebtItem;
  bill?: RecurringBill;
}>;

export type LegacyLoanPairingAudit = Readonly<{
  divergentLinks: DivergentLoanBillLink[];
  invalidLinks: InvalidLoanBillLink[];
}>;

/** Surface invalid or divergent legacy pairings without silently overwriting either record. */
export function auditLegacyLoanPairings(params: {
  debts: readonly DebtItem[];
  recurringBills: readonly RecurringBill[];
  pairings?: LoanBillPairingMap;
  currencyCode?: string;
}): LegacyLoanPairingAudit {
  const { debts, recurringBills, pairings = {}, currencyCode } = params;
  const debtById = new Map(debts.map(debt => [debt.id, debt]));
  const billById = new Map(recurringBills.map(bill => [bill.id, bill]));
  const linkedEntries = Object.entries(pairings).filter(([, relation]) => relation?.status === 'linked');
  const billUses = new Map<string, number>();
  for (const [, relation] of linkedEntries) {
    if (relation?.billId) billUses.set(relation.billId, (billUses.get(relation.billId) ?? 0) + 1);
  }
  const invalidLinks: InvalidLoanBillLink[] = [];
  const divergentLinks: DivergentLoanBillLink[] = [];

  for (const [debtId, relation] of linkedEntries) {
    const billId = relation?.billId ?? null;
    const debt = debtById.get(debtId);
    const bill = billId ? billById.get(billId) : undefined;
    if (!debt) {
      invalidLinks.push({ debtId, billId, reason: 'missing_debt', bill });
      continue;
    }
    if (billId && relation?.canonical === true && (billUses.get(billId) ?? 0) === 1 && isUnifiedBudgetLoanCategory(debt.category) && (!bill || bill.amount.currency === (currencyCode ?? bill.amount.currency))) continue;
    if (!billId || !bill) {
      invalidLinks.push({ debtId, billId, reason: 'missing_bill', debt });
      continue;
    }
    if (!bill.active) {
      invalidLinks.push({ debtId, billId, reason: 'inactive_bill', debt, bill });
      continue;
    }
    if ((billUses.get(billId) ?? 0) !== 1) {
      invalidLinks.push({ debtId, billId, reason: 'duplicate_bill', debt, bill });
      continue;
    }
    if (!isCompatibleLoanBillPair(debt, bill)) {
      invalidLinks.push({ debtId, billId, reason: 'incompatible_bill', debt, bill });
      continue;
    }
    if (debt.balance <= 0) continue;
    const currency = currencyCode || bill.amount.currency || 'USD';
    const debtMinMinor = moneyFromMajor(debt.minimumPayment, currency).minorUnits;
    const amountDiffers = bill.amount.currency !== currency || debtMinMinor !== bill.amount.minorUnits;
    const dueDayDiffers = debt.dueDay !== bill.dueDay;
    if (amountDiffers || dueDayDiffers) {
      divergentLinks.push({ debt, bill, amountDiffers, dueDayDiffers });
    }
  }

  return { divergentLinks, invalidLinks };
}

/** Immutable historical bill alias IDs keyed by debt ID. Uniquely linked bills stay
 *  attached to the debt across inactive/deleted/category-drifted states; duplicate bill
 *  claims across multiple debts are intentionally omitted so history is never guessed. */
export function historicalBillIdsByDebtId(pairings: LoanBillPairingMap = {}): Record<string, string[]> {
  const links = linkedBillByDebtId(pairings);
  const uses = new Map<string, number>();
  for (const billId of Object.values(links)) {
    uses.set(billId, (uses.get(billId) ?? 0) + 1);
  }
  const result: Record<string, string[]> = {};
  for (const [debtId, billId] of Object.entries(links)) {
    if (uses.get(billId) === 1) {
      result[debtId] = [billId];
    }
  }
  return result;
}

export function uniqueHistoricalBillIdByDebtId(pairings: LoanBillPairingMap = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(historicalBillIdsByDebtId(pairings)).map(([debtId, ids]) => [debtId, ids[0]]),
  );
}

export function hasUnresolvedLegacyLoanLinks(audit: LegacyLoanPairingAudit): boolean {
  return audit.divergentLinks.length > 0 || audit.invalidLinks.length > 0;
}

export function loansWithIncompleteSchedule(
  debts: readonly DebtItem[],
  archivedPaidOffDebtIds: readonly string[] = [],
): DebtItem[] {
  return debts.filter(debt =>
    isUnifiedBudgetLoanCategory(debt.category) &&
    debt.balance > 0 &&
    !isPaidOffAccountArchived(debt, archivedPaidOffDebtIds) &&
    debt.dueDay === null);
}

export function canEditDebtCategoryWithPairings(
  pairings: LoanBillPairingMap | undefined,
  debtId: string,
  nextCategory: DebtItem['category'],
  recurringBills: readonly RecurringBill[] = [],
): { valid: true } | { valid: false; error: string } {
  const relation = pairings?.[debtId];
  if (relation?.status !== 'linked') return { valid: true };
  if (!isUnifiedBudgetLoanCategory(nextCategory)) {
    return {
      valid: false,
      error: 'This account has a historical loan-bill link, so its category must stay Mortgage or Auto loan to preserve payment history.',
    };
  }
  if (relation.billId) {
    const bill = recurringBills.find(candidate => candidate.id === relation.billId);
    if (bill && nextCategory === 'Auto loan' && bill.category !== 'other_bill') {
      return {
        valid: false,
        error: 'The linked recurring item is categorized as Housing, so this account cannot be changed to Auto loan.',
      };
    }
  }
  return { valid: true };
}

export function validateDivergentLinkResolution(params: {
  link: DivergentLoanBillLink;
  mode: 'use_loan' | 'use_bill';
  mortgageEscrowByDebtId?: Readonly<Record<string, number | undefined>>;
  currencyCode: string;
}): { valid: true; minimumPayment: number; dueDay: number } | { valid: false; error: string } {
  const { link, mode, mortgageEscrowByDebtId, currencyCode } = params;
  if (link.bill.amount.currency !== currencyCode) {
    return { valid: false, error: 'The loan and recurring bill use different currencies. Resolve the currency mismatch before applying terms.' };
  }
  const targetMinimum = mode === 'use_loan' ? link.debt.minimumPayment : moneyToMajor(link.bill.amount);
  const targetDueDay = mode === 'use_loan' ? link.debt.dueDay : link.bill.dueDay;

  if (targetDueDay === null || !Number.isInteger(targetDueDay) || targetDueDay < 1 || targetDueDay > 31) {
    return { valid: false, error: 'Choose or set a valid due day (1–31) before applying these terms.' };
  }
  if (!Number.isFinite(targetMinimum) || targetMinimum <= 0) {
    return { valid: false, error: 'Monthly payment must be greater than zero.' };
  }

  const targetMinMinor = mode === 'use_loan'
    ? moneyFromMajor(link.debt.minimumPayment, currencyCode).minorUnits
    : link.bill.amount.minorUnits;

  if (targetMinMinor <= 0) {
    return { valid: false, error: 'Monthly payment must be greater than zero.' };
  }

  if (link.debt.category === 'Mortgage') {
    const escrow = mortgageEscrowByDebtId?.[link.debt.id];
    if (escrow !== undefined) {
      if (!Number.isFinite(escrow) || escrow < 0) {
        return { valid: false, error: 'Saved mortgage escrow is invalid. Edit loan terms to fix it.' };
      }
      const escrowMinor = moneyFromMajor(escrow, currencyCode).minorUnits;
      if (escrowMinor > targetMinMinor) {
        return {
          valid: false,
          error: 'Monthly mortgage payment cannot be less than saved monthly escrow. Edit loan terms or lower escrow first.',
        };
      }
    }
  }

  return { valid: true, minimumPayment: targetMinimum, dueDay: targetDueDay };
}

/** Legacy bills excluded from Budget totals because the canonical unified loan or archive owns the commitment. */
export function unifiedExcludedBillIds(
  pairings: LoanBillPairingMap = {},
  bills: readonly RecurringBill[] = [],
  debts: readonly DebtItem[] = [],
  archivedPaidOffDebtIds: readonly string[] = [],
  divergentDebtIds: readonly string[] = [],
): string[] {
  const archivedBillIds = recurringBillsForArchivedLoans(pairings, bills, debts, archivedPaidOffDebtIds);
  const excludedSet = new Set(archivedBillIds);
  const divergentSet = new Set(divergentDebtIds);
  const debtById = new Map(debts.map(debt => [debt.id, debt]));
  for (const [debtId, billId] of Object.entries(validatedLoanBillLinks(pairings, bills, debts))) {
    if (divergentSet.has(debtId)) continue;
    const debt = debtById.get(debtId);
    if (debt && debt.balance > 0 && !isPaidOffAccountArchived(debt, archivedPaidOffDebtIds)) {
      excludedSet.add(billId);
    }
  }
  for (const [debtId, billIds] of Object.entries(historicalBillIdsByDebtId(pairings))) {
    const debt = debtById.get(debtId);
    if (pairings[debtId]?.canonical && !divergentSet.has(debtId) && debt && isUnifiedBudgetLoanCategory(debt.category) && (debt.balance > 0 || isPaidOffAccountArchived(debt, archivedPaidOffDebtIds))) {
      for (const billId of billIds) excludedSet.add(billId);
    }
  }
  return [...excludedSet];
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

/** Shared runtime: legacy rows are history aliases once the loan owns its schedule. */
export function unifiedLoanRuntime(params: { debts: readonly DebtItem[]; bills: readonly RecurringBill[]; pairings?: LoanBillPairingMap; archived?: readonly string[]; currency: string }) {
  const { debts, bills, pairings = {}, archived = [], currency } = params;
  const audit = auditLegacyLoanPairings({ debts, recurringBills: bills, pairings, currencyCode: currency });
  const invalidDebtIds = new Set(audit.invalidLinks.map(item => item.debtId));
  const divergentDebtIds = audit.divergentLinks.map(item => item.debt.id);
  const legacyPairs = Object.fromEntries(Object.entries(activeLoanBillLinks(pairings, bills, debts)).filter(([id]) => divergentDebtIds.includes(id)));
  const excluded = new Set(unifiedExcludedBillIds(pairings, bills, debts, archived, divergentDebtIds));
  for (const item of audit.invalidLinks) if (item.billId) excluded.add(item.billId);
  // Converted aliases may be inactive or absent; always suppress the retained bill view.
  for (const [id, relation] of Object.entries(pairings)) if (relation?.canonical && relation.billId && !invalidDebtIds.has(id)) excluded.add(relation.billId);
  return { audit, legacyPairs, aliases: historicalBillIdsByDebtId(pairings), excludedBillIds: [...excluded], excludedDebtIds: [...invalidDebtIds] };
}
