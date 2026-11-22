import type { Session } from '@supabase/supabase-js';
import { Alert } from 'react-native';
import type { DebtItem, UserOnboardingData } from '../onboarding-domain';
import { FinancialSettingsConflictError, loadUserOnboardingData, saveUserOnboardingData } from '../onboarding-storage';
import { getNextMonthString, type DateOnly } from './calendar';
import { makeMoney, moneyFromMajor } from './money';
import type { LedgerTransaction } from './ledger';
import { historicalBillIdsByDebtId } from './loan-bill-pairing';
import { getScheduledObligationRows, resolveEffectiveDebtSchedule, type ScheduledObligationRow } from './payment-matching';
import { resolveRecurringBillDate, type RecurringBill } from './recurring-bills';
import { prepareObligationEditorSchedule, type ObligationDueDateEdit } from './obligation-editor-domain';
import {
  initializeObligationSchedule,
  validateObligationSchedule,
  type ObligationSchedule,
  type ObligationScheduleKey,
} from './obligation-schedule';
export { prepareObligationEditorSchedule };
export { shouldAskPaidToday } from './obligation-editor-domain';

/** Persist one schedule map entry through the existing revision-checked settings RPC. */
export async function saveObligationEditorSchedule(params: {
  current: UserOnboardingData;
  key: ObligationScheduleKey;
  schedule: ObligationSchedule;
  session: Session | null;
}): Promise<UserOnboardingData> {
  const { current, key, schedule, session } = params;
  validateObligationSchedule(schedule);
  if (JSON.stringify(current.obligationSchedules?.[key]) === JSON.stringify(schedule)) return current;
  const candidateFor = (data: UserOnboardingData): UserOnboardingData => ({
    ...data,
    obligationSchedules: { ...(data.obligationSchedules ?? {}), [key]: schedule },
  });
  try {
    return await saveUserOnboardingData(candidateFor(current));
  } catch (error) {
    if (!(error instanceof FinancialSettingsConflictError) &&
        !(error instanceof Error && error.name === 'FinancialSettingsConflictError')) throw error;
    if (!session) throw error;
    const fresh = await loadUserOnboardingData(session);
    const previous = current.obligationSchedules?.[key];
    const remote = fresh.obligationSchedules?.[key];
    if (JSON.stringify(remote) === JSON.stringify(schedule)) return fresh;
    if (JSON.stringify(previous) !== JSON.stringify(remote) && JSON.stringify(remote) !== JSON.stringify(schedule)) {
      throw new Error('This obligation schedule changed on another device. Reload before retrying.');
    }
    return await saveUserOnboardingData(candidateFor(fresh));
  }
}

/** Remove a completed recurring bill's schedule metadata through the revision-checked settings save. */
export async function removeObligationEditorSchedule(params: {
  current: UserOnboardingData;
  key: ObligationScheduleKey;
  session: Session | null;
}): Promise<UserOnboardingData> {
  const { current, key, session } = params;
  const prior = current.obligationSchedules?.[key];
  if (!prior) return current;
  const candidateFor = (data: UserOnboardingData): UserOnboardingData => {
    const schedules = { ...(data.obligationSchedules ?? {}) };
    delete schedules[key];
    return { ...data, obligationSchedules: schedules };
  };
  try {
    return await saveUserOnboardingData(candidateFor(current));
  } catch (error) {
    if (!(error instanceof FinancialSettingsConflictError) &&
        !(error instanceof Error && error.name === 'FinancialSettingsConflictError')) throw error;
    if (!session) throw error;
    const fresh = await loadUserOnboardingData(session);
    const remote = fresh.obligationSchedules?.[key];
    if (!remote) return fresh;
    if (JSON.stringify(prior) !== JSON.stringify(remote)) {
      throw new Error('This obligation schedule changed on another device. Reload before removing it.');
    }
    return await saveUserOnboardingData(candidateFor(fresh));
  }
}

export function obligationFirstDueDate(dueDay: number, today: DateOnly, currencyCode = 'USD'): DateOnly {
  return initializeObligationSchedule({ today, dueDay, amount: makeMoney(currencyCode, 0) }).firstDueDate;
}

/** Reuse reminder settlement matching before changing a cycle's due date. */
export async function chooseObligationDueDateEdit(params: {
  current: UserOnboardingData;
  today: DateOnly;
  dueDay: number;
  currencyCode: string;
  transactions: readonly LedgerTransaction[];
  recurringBills: readonly RecurringBill[];
} & ({ bill: RecurringBill } | { debt: DebtItem })): Promise<ObligationDueDateEdit> {
  const { current, today, dueDay, currencyCode, transactions, recurringBills } = params;
  const bill = 'bill' in params ? params.bill : undefined;
  const debt = 'debt' in params ? params.debt : undefined;
  const month = today.slice(0, 7);
  const nextMonth = getNextMonthString(month);
  const toDate = obligationFirstDueDate(dueDay, today, currencyCode);
  const historicalIds = historicalBillIdsByDebtId(current.loanBillPairingByDebtId);
  const billIds = debt ? historicalIds[debt.id] ?? [] : [];
  const key = bill ? `bill:${bill.id}` : `debt:${debt!.id}`;
  const persisted = bill
    ? current.obligationSchedules?.[`bill:${bill.id}`]
    : debt && resolveEffectiveDebtSchedule(current.obligationSchedules, debt.id, billIds);
  const applicableBills = bill ? [bill] : recurringBills.filter(item => billIds.includes(item.id));
  const legacyBill = applicableBills[0];
  const legacyDueDay = legacyBill?.dueDay ?? debt?.dueDay;
  if (!persisted && legacyDueDay == null) return {};
  const schedule = persisted ?? prepareObligationEditorSchedule({
    kind: bill ? 'bill' : 'debt', id: bill?.id ?? debt!.id, today, timeZone: current.householdTimeZone,
    dueDay: legacyDueDay!, legacyDueDay: legacyDueDay!,
    amount: legacyBill?.amount ?? moneyFromMajor(debt!.minimumPayment, currencyCode),
    createdAt: legacyBill?.createdAt ?? debt!.createdAt, isNew: false,
  });
  const lastTerm = schedule?.terms.at(-1);
  const rows = getScheduledObligationRows({
    debts: debt ? [debt] : [],
    recurringBills: applicableBills,
    transactions,
    asOfDate: today,
    currencyCode,
    schedules: { [key]: schedule },
    historicalBillIdsByDebtId: historicalIds,
  });
  const relevant = rows.filter(row => bill ? row.bill?.id === bill.id : row.debt?.id === debt?.id);
  const hasActivity = (row: ScheduledObligationRow) =>
    row.state.status !== 'unpaid' || row.state.withPendingMatch.matchedTransactions.length > 0;
  const protectedDueDays = Object.fromEntries(relevant
    .filter(row => row.dueCycleMonth > month && hasActivity(row) &&
      row.dueDate !== resolveRecurringBillDate(row.dueCycleMonth, dueDay))
    .map(row => [row.dueCycleMonth, Number(row.dueDate.slice(8, 10))]));
  const edit = Object.keys(protectedDueDays).length ? { protectedDueDays } : {};
  const nextDayThisMonth = resolveRecurringBillDate(month, dueDay);
  const currentCycle = relevant.find(row => row.dueCycleMonth === month);
  // A due day saved by an older app may already start this month. Allow the
  // immediately preceding occurrence to be moved only with confirmation.
  const carryover = lastTerm?.effectiveMonth === month && lastTerm.dueDay === dueDay
    ? relevant.find(row => getNextMonthString(row.dueCycleMonth) === month &&
      row.dueDate !== resolveRecurringBillDate(row.dueCycleMonth, dueDay))
    : undefined;
  const firstFutureCycle = lastTerm?.dueDay !== dueDay && schedule.firstDueDate.slice(0, 7) === nextMonth &&
    schedule.terms.length === 1 && !schedule.cycleDueDayOverrides && toDate.slice(0, 7) === month
    ? relevant.find(row => row.dueCycleMonth === nextMonth)
    : undefined;
  const cycle = currentCycle && currentCycle.dueDate !== nextDayThisMonth
    ? currentCycle : carryover ?? firstFutureCycle;
  const targetMonth = toDate.slice(0, 7);
  const displayDate = (date: DateOnly) => new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  const shortDate = (date: DateOnly) => new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));

  if (!cycle) {
    if (
      schedule.cycleDueDayOverrides?.[month] === null &&
      !schedule.acknowledgedPaidCycles.includes(month) &&
      protectedDueDays[month] === undefined
    ) {
      const candidateDate = resolveRecurringBillDate(month, dueDay);
      if (candidateDate >= schedule.firstDueDate) {
        if (candidateDate >= today) {
          return { ...edit, restoreSuppressedCycle: { month, dueDay } };
        }
        return new Promise(resolve => {
          Alert.alert(
            'Restore this month’s due date?',
            `This month’s due date was skipped. Restore ${displayDate(candidateDate)}, or keep this month skipped and apply day ${dueDay} starting next month?`,
            [
              { text: 'Keep skipped', style: 'cancel', onPress: () => resolve(edit) },
              { text: `Restore ${shortDate(candidateDate)}`, onPress: () => resolve({ ...edit, restoreSuppressedCycle: { month, dueDay } }) },
            ],
            { cancelable: false },
          );
        });
      }
    }
    return edit;
  }

  if (hasActivity(cycle) || schedule.acknowledgedPaidCycles.includes(targetMonth) ||
      protectedDueDays[targetMonth] !== undefined) return edit;

  const move = { fromMonth: cycle.dueCycleMonth, toDate };
  if (cycle.dueDate >= today) {
    if (cycle.dueCycleMonth === month && targetMonth > month) {
      return new Promise(resolve => {
        Alert.alert(
          'Skip this month’s due date?',
          `Moving the due day to day ${dueDay} moves the reminder from ${displayDate(cycle.dueDate)} to ${displayDate(toDate)}, skipping this month.`,
          [
            { text: `Keep ${shortDate(cycle.dueDate)}`, style: 'cancel', onPress: () => resolve(edit) },
            { text: `Move to ${shortDate(toDate)}`, onPress: () => resolve({ ...edit, cycleMove: move }) },
          ],
          { cancelable: false },
        );
      });
    }
    return { ...edit, cycleMove: move };
  }

  return new Promise(resolve => {
    Alert.alert(
      'Move overdue reminder?',
      `If the lender or merchant moved the payment, move the reminder from ${displayDate(cycle.dueDate)} to ${displayDate(toDate)}. Otherwise, keep the overdue reminder and use the new due day for future payments.`,
      [
        { text: 'Keep overdue', style: 'cancel', onPress: () => resolve(edit) },
        { text: 'Move reminder', onPress: () => resolve({ ...edit, cycleMove: move }) },
      ],
      { cancelable: false },
    );
  });
}

/** Ask only when a newly entered obligation is actually due today. */
export function confirmObligationPaidToday(): Promise<boolean | null> {
  return new Promise(resolve => {
    Alert.alert(
      'Already paid today?',
      'Mark this month’s due cycle as already paid? This records an acknowledgement only and does not create a transaction or change a balance.',
      [
        { text: 'Yes', onPress: () => resolve(true) },
        { text: 'No', onPress: () => resolve(false) },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: false },
    );
  });
}
