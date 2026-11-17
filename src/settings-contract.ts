import type { UserOnboardingData } from './onboarding-domain';

export const PERSONAL_SETTINGS_FIELDS = [
  'currentStage', 'signupCompleted', 'onboardingCompleted', 'goals', 'referralSource',
  'consideredBeforeAi', 'managesWithPartner', 'worksWithProfessional', 'selectedPlan',
  'notifications', 'completedAt',
] as const;

/** A shared commit never confirms the personal fields from the attempted save. */
export function reconcileConfirmedPersonalSettings(
  shared: UserOnboardingData,
  profile: UserOnboardingData,
  householdRevision: number,
): UserOnboardingData {
  const result = { ...shared, settingsRevision: householdRevision,
    profileSettingsRevision: profile.settingsRevision ?? 0, updatedAt: profile.updatedAt };
  for (const field of PERSONAL_SETTINGS_FIELDS) {
    Object.assign(result, { [field]: profile[field] });
  }
  return result;
}

/** Keep a disputed value explicitly unconfirmed until an authoritative read succeeds. */
export function settingsFailureSnapshot(error: unknown, prior: UserOnboardingData): {
  data: UserOnboardingData;
  uncertain: boolean;
} {
  const failure = error as { name?: string; reconciledData?: UserOnboardingData } | null;
  const snapshot = failure?.reconciledData;
  if (snapshot?.userId === prior.userId && snapshot.householdId === prior.householdId) {
    return { data: snapshot, uncertain: false };
  }
  return { data: prior, uncertain: failure?.name === 'FinancialSettingsUncertainError' || failure?.name === 'FinancialSettingsConflictError' };
}

export const SHARED_SETTINGS_FIELDS = [
  'householdName', 'countryCode', 'currencyCode', 'householdTimeZone',
  'primaryIncomeName', 'primaryIncomeAmount', 'primaryGrossIncomeAmount', 'primaryPayFrequency',
  'primaryMonthlyIncome', 'additionalIncomes', 'strategy', 'extraMonthlyPayment',
  'obligationSchedules', 'debtPaymentSplitPlansByDebtId', 'billPaymentSplitPlansByBillId',
  'mortgageEscrowByDebtId', 'mortgageExtraPaymentByDebtId', 'loanBillPairingByDebtId',
  'recurringBillCategoryLabelByBillId', 'archivedPaidOffDebtIds',
] as const;
