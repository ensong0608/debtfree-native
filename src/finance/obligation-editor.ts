import type { Session } from '@supabase/supabase-js';
import { Alert } from 'react-native';
import type { UserOnboardingData } from '../onboarding-domain';
import { FinancialSettingsConflictError, loadUserOnboardingData, saveUserOnboardingData } from '../onboarding-storage';
import { type DateOnly } from './calendar';
import { makeMoney, type Money } from './money';
import {
  initializeObligationSchedule,
  obligationScheduleKey,
  validateObligationSchedule,
  type ObligationSchedule,
  type ObligationScheduleKey,
} from './obligation-schedule';
export { prepareObligationEditorSchedule, shouldAskPaidToday } from './obligation-editor-domain';

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
