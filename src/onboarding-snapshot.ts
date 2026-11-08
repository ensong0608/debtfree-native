import type { UserOnboardingData } from './onboarding-domain';

/** Accept settings snapshots monotonically without resurrecting omitted debt rows. */
export function acceptOnboardingSnapshot(
  current: UserOnboardingData | null,
  incoming: UserOnboardingData,
): UserOnboardingData {
  if (!current || current.userId !== incoming.userId) return incoming;
  if ((incoming.settingsRevision ?? 0) < (current.settingsRevision ?? 0)) return current;

  const currentDebts = new Map(current.debts.map(debt => [debt.id, debt]));
  const debts = incoming.debts.map(debt => {
    const previous = currentDebts.get(debt.id);
    if (!previous || previous.serverVersion === undefined) return debt;
    if (debt.serverVersion === undefined || debt.serverVersion < previous.serverVersion) return previous;
    return debt;
  });
  return debts === incoming.debts ? incoming : { ...incoming, debts };
}
