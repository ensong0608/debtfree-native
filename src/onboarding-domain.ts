// @ts-ignore TS5097
import type { ObligationSchedules } from './finance/obligation-schedule.ts';
// @ts-ignore TS5097
import type { DebtPaymentSplitPlansByDebtId, BillPaymentSplitPlansByBillId } from './finance/debt-payment-split.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { CURRENCIES, getCurrency, type CurrencyScale } from './finance/currencies.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { classifyMoneyEdit, parseMoney, parseApr, makeMoney, moneyFromMajor, multiplyMoneyRatio, addMoney } from './finance/money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { calendarDaysBetween, daysInMonth, getNextMonthString, householdDate, monthlyPaymentDate, parseDateOnly, type DateOnly } from './finance/calendar.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import type { DataContext } from './finance/contracts.ts';
import type { HouseholdContext } from './household-context';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { calculatePayoff, type PayoffResult, type PayoffAccountInput } from './finance/payoff.ts';
/**
 * Pure domain types, validation rules, income normalization, and Snowball/Avalanche
 * payoff calculation engine for the DebtFree Native Sign-Up, Onboarding, and Home flows.
 */

export type FlowStage =
  | 'welcome'
  | 'signup_1'
  | 'signup_2'
  | 'signup_3'
  | 'signup_4'
  | 'onboard_1'
  | 'onboard_2'
  | 'onboard_3'
  | 'onboard_4'
  | 'onboard_5'
  | 'home';

export const SIGNUP_GOALS = [
  'Pay down my credit card debt',
  'Build a monthly budget',
  'Keep up with upcoming bills',
  'See when I can be debt-free',
  'Stay motivated with milestones',
] as const;

export type SignupGoal = (typeof SIGNUP_GOALS)[number];

export const REFERRAL_SOURCES = [
  'Google or Bing',
  'Friend or family',
  'Reddit or social media',
  'App Store',
  'AI assistant (ChatGPT, Gemini, etc.)',
  'Other',
] as const;

export type ReferralSource = (typeof REFERRAL_SOURCES)[number];

export const AI_REFERRAL_SOURCE: ReferralSource = 'AI assistant (ChatGPT, Gemini, etc.)';

export const COUNTRY_OPTIONS = [
  { code: 'US', flag: '🇺🇸', currency: 'USD', symbol: '$', label: 'United States (USD)' },
  { code: 'CA', flag: '🇨🇦', currency: 'CAD', symbol: 'CA$', label: 'Canada (CAD)' },
  { code: 'GB', flag: '🇬🇧', currency: 'GBP', symbol: '£', label: 'United Kingdom (GBP)' },
  { code: 'AU', flag: '🇦🇺', currency: 'AUD', symbol: 'A$', label: 'Australia (AUD)' },
] as const;

export type CountryCode = (typeof COUNTRY_OPTIONS)[number]['code'];

export type PayFrequency = 'biweekly' | 'monthly' | 'weekly' | 'twice_monthly';

export const PAY_FREQUENCY_OPTIONS: { value: PayFrequency; label: string }[] = [
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'twice_monthly', label: 'Twice a month' },
];

export type AdditionalIncomeSource = {
  id: string;
  name: string;
  amount: number;
  frequency: PayFrequency;
  monthlyAmount: number;
  /** Optional pre-tax amount for income-ratio calculations; existing amount remains take-home. */
  grossAmount?: number | null;
};

/** Explicitly reviewed relationship between a mortgage/auto loan and its payment bill. */
export type LoanBillPairing = Readonly<{
  status: 'linked' | 'separate' | 'dismissed';
  billId?: string;
  /** Loan owns future terms; bill ID remains a historical alias. */
  canonical?: boolean;
}>;

export type PremiumPlanChoice = 'premium' | 'premium_bank_sync';

export type HomeOwnershipStatus = 'Own' | 'Rent' | 'Other';
export type VehicleOwnershipStatus = 'Finance' | 'Lease' | 'Own' | 'None';

export type DebtCategory =
  | 'Mortgage'
  | 'Auto loan'
  | 'Credit card'
  | 'Personal loan'
  | 'Student loan'
  | 'Medical debt'
  | 'Other loan';

export const ACTIVE_DEBT_CATEGORIES: DebtCategory[] = ['Credit card', 'Personal loan', 'Auto loan', 'Student loan', 'Medical debt', 'Other loan'];
export const DEBT_CATEGORIES = ACTIVE_DEBT_CATEGORIES;

export type DebtItem = {
  id: string;
  name: string;
  category: DebtCategory;
  balance: number;
  originalBalance: number | null;
  apr: number;
  minimumPayment: number;
  dueDay: number | null;
  creditLimit: number | null;
  /** Expected yearly card fee and its next renewal date; neither implies a charge was posted. */
  annualFeeAmount?: number | null;
  annualFeeNextDueDate?: DateOnly | null;
  createdAt: string;
  updatedAt: string;
  /** Server-validated monotonic revision of a persisted debt row. */
  serverVersion?: number;
};

export function isActiveDebtItem(d: DebtItem): boolean { return d.category !== 'Mortgage'; }
export function activeDebts(debts: readonly DebtItem[]): DebtItem[] { return debts.filter(isActiveDebtItem); }
export function categoryDebts(debts: readonly DebtItem[], category: string): DebtItem[] {
  if (category === 'All Debts') return [...debts];
  if (category === 'Home') return debts.filter(d => d.category === 'Mortgage');
  if (category === 'Auto') return debts.filter(d => d.category === 'Auto loan');
  if (category === 'Home & Auto') return debts.filter(d => d.category === 'Mortgage' || d.category === 'Auto loan');
  return debts.filter(d => d.category !== 'Mortgage' && d.category !== 'Auto loan');
}
export type PayoffStrategy = 'snowball' | 'avalanche';

export type NotificationPreferences = {
  upcomingReminders: boolean;
  overdueAlerts: boolean;
  milestonesAndProgress: boolean;
  permissionRequested: boolean;
  osPermissionStatus: 'undetermined' | 'granted' | 'denied' | 'unavailable';
};

export type UserOnboardingData = {
  version: 1;
  userId: string;
  householdId: string;
  /** Server-refreshed authorization context; never persisted as household settings or trusted from cache. */
  householdContext?: HouseholdContext;
  householdName?: string;
  currentStage: FlowStage;
  signupCompleted: boolean;
  onboardingCompleted: boolean;
  // Sign-Up Step 2
  goals: string[];
  // Sign-Up Step 3
  referralSource: string;
  consideredBeforeAi: 'yes' | 'no' | null;
  // Sign-Up Step 4
  countryCode: CountryCode;
  currencyCode?: string;
  householdTimeZone?: string;
  managesWithPartner: boolean | null;
  worksWithProfessional: boolean | null;
  // Onboarding Step 1 (Income)
  primaryIncomeName?: string;
  primaryIncomeAmount: number;
  /** Optional pre-tax amount per pay period; uses primaryPayFrequency. */
  primaryGrossIncomeAmount?: number | null;
  primaryPayFrequency: PayFrequency;
  primaryMonthlyIncome: number;
  additionalIncomes: AdditionalIncomeSource[];
  // Onboarding Step 2 (Premium)
  selectedPlan: PremiumPlanChoice;
  // Onboarding Step 3 (Debts)
  homeStatus: HomeOwnershipStatus;
  vehicleStatus: VehicleOwnershipStatus;
  debts: DebtItem[];
  // Onboarding Step 4 (Payoff Strategy)
  strategy: PayoffStrategy;
  extraMonthlyPayment: number;
  // Onboarding Step 5 (Notifications)
  notifications: NotificationPreferences;
  completedAt: string | null;
  updatedAt: string;
  /** Server-validated revision for settings held by the active household. */
  settingsRevision?: number;
  /** Per-user profile revision; shared household settings use settingsRevision. */
  profileSettingsRevision?: number;
  obligationSchedules?: ObligationSchedules;
  /** Optional informational split-payment plans; never payment instructions or ledger entries. */
  debtPaymentSplitPlansByDebtId?: DebtPaymentSplitPlansByDebtId;
  /** Optional informational bill split-payment plans; never payment instructions or ledger entries. */
  billPaymentSplitPlansByBillId?: BillPaymentSplitPlansByBillId;
  /** User-entered monthly escrow component for mortgage payments; missing means unknown. */
  mortgageEscrowByDebtId?: Record<string, number>;
  /** Independently entered monthly extra payment for each mortgage projection. */
  mortgageExtraPaymentByDebtId?: Record<string, number>;
  /** User-confirmed loan-to-recurring-bill relationships and review choices. */
  loanBillPairingByDebtId?: Record<string, LoanBillPairing>;
  /** Reusable display labels for recurring bills stored with the compatible other_bill enum. */
  recurringBillCategoryLabelByBillId?: Record<string, string>;
  /** Server-maintained debt identities archived after a confirmed payment reaches zero. */
  archivedPaidOffDebtIds?: string[];
};

/** Round a numeric dollar amount to two decimal places using integer-cent precision. */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Auto-estimated minimum monthly payment: 1% of principal + monthly interest (min $25, capped at payoff). */
export function estimateMinimumPayment(balance: number, apr: number, currencyCode = 'USD'): number {
  if (!Number.isFinite(balance) || balance <= 0) return 0;
  const currencyScale = getCurrency(currencyCode).scale;
  const factor = 10 ** currencyScale;
  const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * factor) / factor;
  const safeApr = Number.isFinite(apr) && apr > 0 ? apr : 0;
  const monthlyInterest = (balance * safeApr) / 1200;
  const floor = currencyScale === 0 ? 2500 : 25;
  return Math.min(roundCurrency(balance + monthlyInterest), Math.max(floor, roundCurrency(balance * 0.01 + monthlyInterest)));
}

const currencySymbols: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$', JPY: '¥', CHF: 'CHF', CNY: 'CN¥', INR: '₹', KWD: 'KWD', CLF: 'CLF' };
export const CURRENCY_OPTIONS: { code: string; scale: CurrencyScale; symbol: string; label: string }[] = CURRENCIES.map(c => ({ ...c, symbol: currencySymbols[c.code] ?? c.code, label: c.code }));
export function resolveCurrencyOption(data?: Partial<UserOnboardingData> | null) {
  return CURRENCY_OPTIONS.find(c => c.code === data?.currencyCode) ?? CURRENCY_OPTIONS.find(c => c.code === COUNTRY_OPTIONS.find(country => country.code === data?.countryCode)?.currency) ?? CURRENCY_OPTIONS[0];
}
function cleanMoney(raw: string, currencyCode: string): string {
  let text = raw.trim();
  const symbol = CURRENCY_OPTIONS.find(c => c.code === currencyCode)?.symbol;
  if (symbol && text.startsWith(symbol)) text = text.slice(symbol.length).trim();
  return text.replace(/,/g, '');
}
export function acceptMoneyEdit(previous: string, next: string, currencyCode = 'USD', signed = false): string {
  const candidate = cleanMoney(next, currencyCode);
  try { return classifyMoneyEdit(candidate, currencyCode, signed) === 'invalid' ? previous : candidate; } catch { return previous; }
}
export function formatEditableMoney(amount: number, currencyCode = 'USD'): string { return amount.toFixed(getCurrency(currencyCode).scale); }
export function parseMoneyInput(raw: string, currencyCode = 'USD', signed = false): number | null {
  try { return parseMoney(cleanMoney(raw, currencyCode), currencyCode, signed).minorUnits / 10 ** getCurrency(currencyCode).scale; } catch { return null; }
}
export function parsePercentInput(raw: string): number | null {
  try { return parseApr(raw.trim().replace(/%$/, '').trim()) / 1000; } catch { return null; }
}
export function acceptAprEdit(previous: string, next: string): string {
  if (next === '') return next;
  if (!/^\d+(?:\.\d{0,3})?$/.test(next)) return previous;
  return parsePercentInput(next.endsWith('.') ? next.slice(0, -1) : next) === null ? previous : next;
}
export function formatCurrency(amount: number, symbolOrCurrency = '$', decimals?: number): string {
  const option = CURRENCY_OPTIONS.find(c => c.code === symbolOrCurrency) ?? CURRENCY_OPTIONS.find(c => c.symbol === symbolOrCurrency);
  const symbol = option?.symbol ?? symbolOrCurrency;
  const digits = decimals ?? option?.scale ?? 2;
  const safe = Number.isFinite(amount) ? Math.round((Math.abs(amount) + Number.EPSILON) * 10 ** digits) / 10 ** digits : 0;
  const [whole, fraction] = safe.toFixed(digits).split('.');
  const formatted = symbol + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (digits ? '.' + fraction : '');
  return amount < 0 ? '-' + formatted : formatted;
}

/** Convert an income paycheck/period amount to its monthly equivalent. */
export function normalizeMonthlyIncome(amount: number, frequency: PayFrequency, currencyCode = 'USD'): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const source = moneyFromMajor(amount, currencyCode);
  const [numerator, denominator] = frequency === 'weekly' ? [52, 12] : frequency === 'biweekly' ? [26, 12] : frequency === 'twice_monthly' ? [2, 1] : [1, 1];
  return multiplyMoneyRatio(source, BigInt(numerator), BigInt(denominator)).minorUnits / 10 ** getCurrency(currencyCode).scale;
}

/** Total monthly household take-home income across primary and additional income sources. */
export function calculateTotalMonthlyIncome(
  primaryAmount: number,
  primaryFrequency: PayFrequency,
  additionalIncomes: AdditionalIncomeSource[],
  currencyCode = 'USD',
): number {
  const monthly = (amount: number, frequency: PayFrequency) => moneyFromMajor(normalizeMonthlyIncome(amount, frequency, currencyCode), currencyCode);
  const total = additionalIncomes.reduce((sum, item) => addMoney(sum, monthly(item.amount, item.frequency)), monthly(primaryAmount, primaryFrequency));
  return total.minorUnits / 10 ** getCurrency(currencyCode).scale;
}

/** Return gross monthly income only when every active take-home source has a gross amount. */
export function calculateTotalGrossMonthlyIncome(
  primaryNetAmount: number,
  primaryGrossAmount: number | null | undefined,
  primaryFrequency: PayFrequency,
  additionalIncomes: readonly AdditionalIncomeSource[],
  currencyCode = 'USD',
): number | null {
  const activeSources = [
    ...(primaryNetAmount > 0 ? [{ amount: primaryGrossAmount, frequency: primaryFrequency }] : []),
    ...additionalIncomes.filter(source => source.amount > 0).map(source => ({ amount: source.grossAmount, frequency: source.frequency })),
  ];
  if (activeSources.length === 0 || activeSources.some(source => source.amount == null || !Number.isFinite(source.amount) || source.amount <= 0)) return null;
  return activeSources.reduce((sum, source) => addMoney(sum,
    moneyFromMajor(normalizeMonthlyIncome(source.amount!, source.frequency, currencyCode), currencyCode)),
  makeMoney(currencyCode, 0)).minorUnits / 10 ** getCurrency(currencyCode).scale;
}

export function createDefaultOnboardingData(userId: string): UserOnboardingData {
  return {
    version: 1,
    userId,
    householdId: `hh-${userId.slice(0, 12)}`,
    currentStage: 'signup_2',
    signupCompleted: false,
    onboardingCompleted: false,
    goals: ['Pay down my credit card debt'],
    referralSource: '',
    consideredBeforeAi: null,
    countryCode: 'US',
    managesWithPartner: null,
    worksWithProfessional: null,
    primaryIncomeAmount: 0,
    primaryPayFrequency: 'biweekly',
    primaryMonthlyIncome: 0,
    additionalIncomes: [],
    selectedPlan: 'premium',
    homeStatus: 'Rent',
    vehicleStatus: 'Own',
    debts: [],
    strategy: 'snowball',
    extraMonthlyPayment: 0,
    notifications: {
      upcomingReminders: false,
      overdueAlerts: false,
      milestonesAndProgress: false,
      permissionRequested: false,
      osPermissionStatus: 'unavailable',
    },
    completedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Determine which screen an authenticated user should see when opening or signing into the app. */
export function resolveAuthenticatedStage(data: UserOnboardingData): FlowStage {
  if (data.onboardingCompleted) return 'home';
  // Personal signup questions still belong to the user, but a verified member
  // must not be sent through the owner's financial household setup.
  const context = data.householdContext;
  if (data.signupCompleted && context?.userId === data.userId && context.householdId === data.householdId
      && (context.role === 'member' || context.role === 'viewer')) return 'home';
  // Existing onboarding records may still point at the retired Premium / Bank Sync choice screen.
  if (data.currentStage === 'onboard_2') return 'onboard_3';
  const validStages: FlowStage[] = [
    'signup_2',
    'signup_3',
    'signup_4',
    'onboard_1',
    'onboard_3',
    'onboard_4',
    'onboard_5',
  ];
  if (validStages.includes(data.currentStage)) {
    return data.currentStage;
  }
  return data.signupCompleted ? 'onboard_1' : 'signup_2';
}

export function validateSignUpStep2(goals: string[]): string | null {
  if (!Array.isArray(goals) || goals.length === 0) {
    return 'Select at least one goal to continue.';
  }
  return null;
}

export function validateSignUpStep3(
  referralSource: string,
  consideredBeforeAi: 'yes' | 'no' | null,
): string | null {
  if (!referralSource.trim()) {
    return 'Select how you heard about DebtFree to continue.';
  }
  if (referralSource === AI_REFERRAL_SOURCE && consideredBeforeAi === null) {
    return 'Please choose whether you were considering DebtFree before asking an AI assistant.';
  }
  return null;
}

export function validateSignUpStep4(
  managesWithPartner: boolean | null,
  worksWithProfessional: boolean | null,
): string | null {
  if (managesWithPartner === null) {
    return 'Please select whether you manage finances with a partner.';
  }
  if (worksWithProfessional === null) {
    return 'Please select whether you work with a financial professional.';
  }
  return null;
}

export function validateIncomeStep(
  primaryAmountRaw: string,
  additionalIncomes: { name: string; amount: number }[],
  currencyCode = 'USD',
): { valid: true; primaryAmount: number } | { valid: false; error: string } {
  const parsed = parseMoneyInput(primaryAmountRaw, currencyCode);
  if (parsed === null || parsed <= 0) {
    return { valid: false, error: 'Enter a valid take-home income amount greater than $0.' };
  }
  for (let i = 0; i < additionalIncomes.length; i++) {
    const item = additionalIncomes[i];
    if (!item.name.trim()) {
      return { valid: false, error: `Enter a name for additional income source #${i + 1}.` };
    }
    if (!Number.isFinite(item.amount) || item.amount <= 0) {
      return { valid: false, error: `Enter an amount greater than $0 for "${item.name.trim()}".` };
    }
  }
  return { valid: true, primaryAmount: parsed };
}

export type DebtDraftInput = {
  name: string;
  category: DebtCategory;
  balanceRaw: string;
  originalBalanceRaw?: string;
  aprRaw: string;
  minimumPaymentRaw: string;
  dueDayRaw?: string;
  creditLimitRaw?: string;
};

export function validateDebtDraft(
  draft: DebtDraftInput,
  currencyCode = 'USD',
): { valid: true; debt: Omit<DebtItem, 'id' | 'createdAt' | 'updatedAt'> } | { valid: false; error: string } {
  const name = draft.name.trim();
  if (!name) {
    return { valid: false, error: 'Enter a name for this debt (for example, Chase Sapphire or Auto Loan).' };
  }
  // Signed credit balances and zero-balance accounts must remain representable.
  const balance = parseMoneyInput(draft.balanceRaw, currencyCode, true);
  if (balance === null) {
    return { valid: false, error: 'Enter a valid current balance (negative for a credit).' };
  }
  const apr = parsePercentInput(draft.aprRaw);
  if (apr === null) {
    return { valid: false, error: 'Enter a valid APR percentage between 0% and 100%.' };
  }
  const minimumPayment = parseMoneyInput(draft.minimumPaymentRaw, currencyCode);
  if (minimumPayment === null || minimumPayment < 0 || (balance > 0 && minimumPayment === 0)) {
    return { valid: false, error: balance > 0
      ? 'Enter a minimum monthly payment greater than zero for an amount owed.'
      : 'Enter a valid minimum payment of zero or more.' };
  }

  let originalBalance: number | null = null;
  if (draft.originalBalanceRaw && draft.originalBalanceRaw.trim() !== '') {
    const parsedOrig = parseMoneyInput(draft.originalBalanceRaw, currencyCode);
    if (parsedOrig === null || parsedOrig <= 0) {
      return { valid: false, error: 'Enter a valid original loan balance greater than $0.' };
    }
    originalBalance = parsedOrig;
  } else if (balance > 0 && (draft.category === 'Mortgage' || draft.category === 'Auto loan')) {
    originalBalance = balance;
  }

  let dueDay: number | null = null;
  if (draft.dueDayRaw && draft.dueDayRaw.trim() !== '') {
    const cleanedDay = draft.dueDayRaw.trim();
    if (!/^\d+$/.test(cleanedDay)) {
      return { valid: false, error: 'Enter a due day between 1 and 31.' };
    }
    const dayNum = Number(cleanedDay);
    if (dayNum < 1 || dayNum > 31) {
      return { valid: false, error: 'Due day must be between 1 and 31.' };
    }
    dueDay = dayNum;
  }
  if ((draft.category === 'Mortgage' || draft.category === 'Auto loan') && balance > 0 && dueDay === null) {
    return { valid: false, error: 'Select a monthly due day (1–31) for an active Mortgage or Auto loan.' };
  }

  let creditLimit: number | null = null;
  if (draft.creditLimitRaw && draft.creditLimitRaw.trim() !== '') {
    const parsedLimit = parseMoneyInput(draft.creditLimitRaw, currencyCode);
    if (parsedLimit === null || parsedLimit <= 0) {
      return { valid: false, error: 'Enter a valid credit limit greater than $0.' };
    }
    creditLimit = parsedLimit;
  }

  return {
    valid: true,
    debt: {
      name,
      category: draft.category,
      balance,
      originalBalance,
      apr,
      minimumPayment,
      dueDay,
      creditLimit,
    },
  };
}

export function validateDebtsStep(
  homeStatus: HomeOwnershipStatus,
  vehicleStatus: VehicleOwnershipStatus,
  debts: DebtItem[],
): string | null {
  if (vehicleStatus === 'Finance' && !debts.some(d => d.category === 'Auto loan')) {
    return 'You selected that you finance a vehicle. Please add your Auto loan details or update Your vehicle selection.';
  }
  if (debts.length === 0) {
    return 'Add at least one debt account to continue.';
  }
  return null;
}

export function validateExtraPaymentInput(
  raw: string,
  currencyCode = 'USD',
): { valid: true; extraMonthlyPayment: number } | { valid: false; error: string } {
  const trimmed = raw.replace(/[$,\s]/g, '').trim();
  if (trimmed === '') {
    return { valid: true, extraMonthlyPayment: 0 };
  }
  const parsed = parseMoneyInput(raw, currencyCode);
  if (parsed === null || parsed < 0) {
    return { valid: false, error: 'Enter a valid extra monthly payment of $0 or more.' };
  }
  return { valid: true, extraMonthlyPayment: parsed };
}

/** Current entered-balance comparison, not a payment or milestone ledger. */
export function calculateBalanceSnapshot(debts: readonly DebtItem[]) {
  // Each account's obligation is floored separately, so credits never cancel others.
  const balance = debts.reduce((sum, item) => sum + Math.max(0, item.balance), 0);
  const starting = debts.reduce((sum, item) => sum + Math.max(0, item.balance, item.originalBalance ?? item.balance), 0);
  return { balance, paid: starting - balance, percent: starting > 0 ? (starting - balance) / starting * 100 : 0 };
}

/** Sort debts according to Debt Snowball (smallest balance first) or Debt Avalanche (highest APR first). */
export function sortDebtsByStrategy(debts: DebtItem[], strategy: PayoffStrategy, currencyCode = 'USD'): DebtItem[] {
  const scale = 10 ** getCurrency(currencyCode).scale;
  return activeDebts(debts).filter(d => d.balance > 0).sort((a, b) => {
    const balance = Math.round(a.balance * scale) - Math.round(b.balance * scale);
    const apr = Math.round(b.apr * 1000) - Math.round(a.apr * 1000);
    return (strategy === 'snowball' ? balance || apr : apr || balance) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

export type DebtPayoffProjection = {
  id: string;
  name: string;
  category: DebtCategory;
  balance: number;
  originalBalance: number | null;
  apr: number;
  minimumPayment: number;
  firstMonthPayment: number;
  monthsToPayoff: number | null;
  projectedPayoffLabel: string;
  dueDay: number | null;
  monthlySchedule: PayoffScheduleRow[];
};

export type PayoffScheduleRow = {
  month: string;
  payment: number;
  interest: number;
  balance: number;
};

export type PayoffPlanResult = {
  strategy: PayoffStrategy;
  status: PayoffResult['status'];
  unusedBudget: number;
  totalDebt: number;
  totalStartingDebt: number;
  progressPercent: number;
  totalMinimums: number;
  extraMonthlyPayment: number;
  monthlyTotalPayment: number;
  totalInterest: number;
  monthsToPayoff: number | null;
  debtFreeDateLabel: string;
  stalled: boolean;
  firstTarget: DebtPayoffProjection | null;
  payoffOrder: DebtPayoffProjection[];
  allProjections?: DebtPayoffProjection[];
};

export function formatMonthOffsetLabel(monthsFromNow: number, baseDate: Date = new Date()): string {
  const target = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + monthsFromNow, 1));
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][target.getUTCMonth()] + ' ' + target.getUTCFullYear();
}
export function defaultFirstPaymentDate(baseDate: Date = new Date(), householdTimeZone = 'UTC'): DateOnly {
  const local = householdDate(baseDate, householdTimeZone);
  return monthlyPaymentDate(parseDateOnly(local.slice(0, 7) + '-01'), 1, 1);
}
export function formatDateOnlyMonthYear(date: DateOnly): string {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(date.slice(5, 7)) - 1] + ' ' + date.slice(0, 4);
}
export type OneTimeCycleResolution = Readonly<{
  period: number;
  cycleDate: DateOnly;
  cycleLabel: string;
  clampedToFirstCycle: boolean;
}>;
/**
 * Map a calendar date onto the monthly payoff engine's 1-based cycle index.
 * Dates in or before the first projected payment month clamp to cycle 1; the
 * engine accrues interest monthly, so intra-month day differences are not modeled.
 */
export function resolveOneTimePaymentPeriod(
  oneTimeDate: DateOnly,
  baseDate: Date = new Date(),
  householdTimeZone = 'UTC',
): OneTimeCycleResolution {
  const validDate = parseDateOnly(oneTimeDate);
  const firstPaymentDate = defaultFirstPaymentDate(baseDate, householdTimeZone);
  const firstYear = Number(firstPaymentDate.slice(0, 4));
  const firstMonth = Number(firstPaymentDate.slice(5, 7));
  const selectedYear = Number(validDate.slice(0, 4));
  const selectedMonth = Number(validDate.slice(5, 7));
  const monthDiff = (selectedYear - firstYear) * 12 + (selectedMonth - firstMonth);
  const clampedToFirstCycle = monthDiff < 0;
  const period = Math.max(1, monthDiff + 1);
  const cycleDate = monthlyPaymentDate(firstPaymentDate, 1, period - 1);
  return {
    period,
    cycleDate,
    cycleLabel: formatDateOnlyMonthYear(cycleDate),
    clampedToFirstCycle,
  };
}
/** Home shows the date alone; the estimate badge and subtitle already explain the forecast scope. */
export function homeDebtFreeEstimateDate(label: string): string {
  return label.replace(/^Entered debts projected paid off:\s*/, '');
}
function runPayoffPlan(
  debts: readonly DebtItem[],
  strategy: PayoffStrategy,
  extraMonthlyPayment: number,
  baseDate: Date = new Date(),
  currencyCode = 'USD',
  householdTimeZone = 'UTC',
  archivedPaidOffDebtIds: readonly string[] = [],
  extraFirstMonthPayment = 0,
  inclusionByDebtId?: Readonly<Record<string, PayoffAccountInput['inclusion']>>,
  extraOneTimePayment = 0,
  extraOneTimePeriod = 1,
): { plan: PayoffPlanResult; raw: PayoffResult; inclusionById: Map<string, PayoffAccountInput['inclusion']> } {
  const scale = 10 ** getCurrency(currencyCode).scale;
  const archived = new Set(archivedPaidOffDebtIds);
  const activeDebtRecords = debts.filter(debt => !(archived.has(debt.id) && debt.balance === 0));
  const toMinor = (n: number) => Math.round(n * scale);
  const money = (n: number) => makeMoney(currencyCode, toMinor(n));
  const inclusionById = new Map<string, PayoffAccountInput['inclusion']>();
  for (const d of activeDebtRecords) {
    inclusionById.set(d.id, inclusionByDebtId?.[d.id] ?? (isActiveDebtItem(d) ? 'accelerated' : 'excluded'));
  }
  const baseOrdered = sortDebtsByStrategy(activeDebtRecords, strategy, currencyCode).filter(
    d => inclusionById.get(d.id) !== 'excluded',
  );
  const ordered = inclusionByDebtId
    ? [
        ...baseOrdered.filter(d => inclusionById.get(d.id) === 'accelerated'),
        ...baseOrdered.filter(d => inclusionById.get(d.id) === 'minimum-only'),
      ]
    : baseOrdered;
  const totalDebt = ordered.reduce((sum, d) => sum + toMinor(d.balance), 0) / scale;
  const allNonMortgageDebts = activeDebts(debts);
  const totalStartingDebt = allNonMortgageDebts.reduce((sum, d) => sum + toMinor(Math.max(0, d.balance, d.originalBalance ?? d.balance)), 0) / scale;
  const hasOpenObligations = ordered.length > 0;
  const totalMinimums = ordered.reduce((sum, d) => sum + toMinor(d.minimumPayment), 0) / scale;
  const safeExtra = toMinor(extraMonthlyPayment) / scale;
  const context: DataContext = { householdId: 'local', source: { id: 'onboarding', kind: 'manual' }, asOf: null, coverage: { status: 'unknown' } };
  let result: PayoffResult;
  try {
    const accounts: PayoffAccountInput[] = activeDebtRecords.map(d => ({
      accountId: d.id,
      inclusion: inclusionById.get(d.id) ?? 'excluded',
      balance: money(d.balance),
      aprThousandths: Math.round(d.apr * 1000),
      scheduledMinimum: money(d.minimumPayment),
    }));
    result = calculatePayoff({
      accounts: { status: 'available', data: accounts, context },
      assumptions: { firstPaymentDate: defaultFirstPaymentDate(baseDate, householdTimeZone), requestedDay: 1, householdTimeZone },
      strategy,
      currency: currencyCode,
      extraMonthlyPayment: money(extraMonthlyPayment),
      extraFirstMonthPayment: money(extraFirstMonthPayment),
      extraOneTimePayment: money(extraOneTimePayment),
      extraOneTimePeriod,
    });
  } catch (error) { result = { status: 'invalidInput', reason: error instanceof Error ? error.message : 'Invalid input' }; }
  const common = 'schedule' in result ? result : null;
  const labels: Record<Exclude<PayoffResult['status'], 'paidOff'>, string> = {
    paymentShortfall: 'Payment shortfall',
    notAmortizingUnderAssumptions: 'Not amortizing under current assumptions',
    horizonReached: 'Projection horizon reached',
    insufficientData: 'Insufficient data for projection',
    invalidInput: 'Invalid projection input',
  };
  const payoffOrder: DebtPayoffProjection[] = ordered.map(d => {
    const summary = common?.accounts.find(a => a.accountId === d.id);
    const monthlySchedule: PayoffScheduleRow[] = (common?.schedule ?? [])
      .filter(period => summary?.payoffMonth == null || period.period <= summary.payoffMonth)
      .map(period => {
        const row = period.accounts.find(a => a.accountId === d.id);
        return {
          month: formatDateOnlyMonthYear(period.paymentDate),
          payment: (row?.totalPaid.minorUnits ?? 0) / scale,
          interest: (row?.interestAccrued.minorUnits ?? 0) / scale,
          balance: (row?.closingObligation.minorUnits ?? 0) / scale,
        };
      });
    return {
      ...d,
      firstMonthPayment: monthlySchedule[0]?.payment ?? 0,
      monthsToPayoff: summary?.payoffMonth ?? null,
      projectedPayoffLabel: summary?.payoffDate ? formatDateOnlyMonthYear(summary.payoffDate) : 'Payoff date unavailable',
      monthlySchedule,
    };
  });

  const excludedDebts = activeDebtRecords.filter(d => inclusionById.get(d.id) === 'excluded' && d.balance > 0);
  const excludedProjections: DebtPayoffProjection[] = excludedDebts.map(d => {
    const summary = common?.accounts.find(a => a.accountId === d.id);
    const monthlySchedule: PayoffScheduleRow[] = (common?.schedule ?? [])
      .filter(period => summary?.payoffMonth == null || period.period <= summary.payoffMonth)
      .map(period => {
        const row = period.accounts.find(a => a.accountId === d.id);
        return {
          month: formatDateOnlyMonthYear(period.paymentDate),
          payment: (row?.totalPaid.minorUnits ?? 0) / scale,
          interest: (row?.interestAccrued.minorUnits ?? 0) / scale,
          balance: (row?.closingObligation.minorUnits ?? 0) / scale,
        };
      });
    return {
      ...d,
      firstMonthPayment: monthlySchedule[0]?.payment ?? d.minimumPayment,
      monthsToPayoff: summary?.payoffMonth ?? null,
      projectedPayoffLabel: summary?.payoffDate ? formatDateOnlyMonthYear(summary.payoffDate) : 'Payoff date unavailable',
      monthlySchedule,
    };
  });

  const lastPeriod = common?.schedule[common.schedule.length - 1];
  const hasEnteredDebts = debts.length > 0;
  const allEnteredPaidOff =
    hasEnteredDebts &&
    !hasOpenObligations &&
    (archived.size > 0 || totalStartingDebt > 0) &&
    !debts.some(d => d.balance < 0);
  const displayStatus: PayoffResult['status'] = allEnteredPaidOff
    ? 'paidOff'
    : hasOpenObligations
      ? result.status
      : 'insufficientData';
  const displayPayoffLabel = allEnteredPaidOff
    ? (allNonMortgageDebts.length ? 'Debt-free — $0 owed' : 'No non-mortgage debt owed')
    : !hasOpenObligations
      ? (activeDebts(activeDebtRecords).length ? 'No balance owed on entered accounts' : 'Add accounts to estimate payoff')
      : result.status === 'paidOff'
        ? (result.monthsToPayoff === 0 ? 'No outstanding tracked debt'
          : result.coverageScope === 'verified-household'
            ? `Projected payoff: ${formatDateOnlyMonthYear(result.payoffDate!)}`
            : `Entered debts projected paid off: ${formatDateOnlyMonthYear(result.payoffDate!)}`)
        : labels[result.status];
  const progressPercent = allEnteredPaidOff && allNonMortgageDebts.length > 0
    ? 100
    : totalStartingDebt > 0
      ? Math.max(0, Math.min(100, Math.round((totalStartingDebt - totalDebt) / totalStartingDebt * 100)))
      : 0;
  return {
    raw: result,
    inclusionById,
    plan: {
      strategy,
      status: displayStatus,
      unusedBudget: allEnteredPaidOff ? safeExtra : result.status === 'paidOff' ? result.unusedBudget.minorUnits / scale : (lastPeriod?.unusedBudget.minorUnits ?? 0) / scale,
      totalDebt,
      totalStartingDebt,
      progressPercent,
      totalMinimums,
      extraMonthlyPayment: safeExtra,
      monthlyTotalPayment: !hasOpenObligations ? 0 : common ? common.monthlyCommitment.minorUnits / scale : totalMinimums + safeExtra,
      totalInterest: result.status === 'paidOff' ? result.totalInterest.minorUnits / scale : result.status === 'paymentShortfall' || result.status === 'notAmortizingUnderAssumptions' || result.status === 'horizonReached' ? result.partialInterest.minorUnits / scale : 0,
      monthsToPayoff: allEnteredPaidOff ? 0 : (hasOpenObligations && result.status === 'paidOff' ? result.monthsToPayoff : null),
      debtFreeDateLabel: displayPayoffLabel,
      stalled: displayStatus !== 'paidOff',
      firstTarget: payoffOrder[0] ?? null,
      payoffOrder,
      allProjections: [...payoffOrder, ...excludedProjections],
    },
  };
}

export function calculatePayoffPlan(debts: DebtItem[], strategy: PayoffStrategy, extraMonthlyPayment: number, baseDate: Date = new Date(), currencyCode = 'USD', householdTimeZone = 'UTC', archivedPaidOffDebtIds: readonly string[] = [], extraFirstMonthPayment = 0, extraOneTimePayment = 0, extraOneTimePeriod = 1): PayoffPlanResult {
  return runPayoffPlan(debts, strategy, extraMonthlyPayment, baseDate, currencyCode, householdTimeZone, archivedPaidOffDebtIds, extraFirstMonthPayment, undefined, extraOneTimePayment, extraOneTimePeriod).plan;
}

export type ScenarioPaymentAccount = Readonly<{
  accountId: string;
  name: string;
  category: DebtCategory;
  inclusion: 'accelerated' | 'minimum-only';
  openingBalance: number;
  interestAccrued: number;
  minimumPaid: number;
  extraPaid: number;
  scenarioExtraPaid: number;
  minimumRolloverPaid: number;
  totalPaid: number;
  closingBalance: number;
  paidOff: boolean;
}>;

export type ScenarioPeriodSummary = Readonly<{
  period: number;
  paymentDate: DateOnly;
  monthLabel: string;
  totalPaid: number;
  totalMinimumPaid: number;
  totalExtraPaid: number;
  scenarioExtraPaid: number;
  minimumRolloverPaid: number;
  unusedBudget: number;
  paidOffCount: number;
  primaryTargetName: string | null;
  allocations: readonly ScenarioPaymentAccount[];
}>;

export type ExtraPaymentScenarioResult = Readonly<{
  mode: 'oneTime' | 'monthly';
  scenarioAmount: number;
  baselineExtraMonthlyPayment: number;
  totalScenarioMonthlyExtra: number;
  baseline: PayoffPlanResult;
  projected: PayoffPlanResult;
  firstPayment: ScenarioPeriodSummary | null;
  nextPayment: ScenarioPeriodSummary | null;
  monthsSaved: number | null;
  interestSaved: number | null;
  oneTimeExtraAmount?: number;
  oneTimePeriod?: number;
  oneTimeCycleDate?: DateOnly;
  oneTimeCycleLabel?: string;
  oneTimeClampedToFirstCycle?: boolean;
  oneTimePayment?: ScenarioPeriodSummary | null;
}>;

export type StrategyScenarioInput = Readonly<{
  debts: readonly DebtItem[];
  strategy: PayoffStrategy;
  baselineExtraMonthlyPayment: number;
  monthlyExtraAmount: number;
  oneTimeExtraAmount?: number;
  oneTimeDate?: DateOnly;
  baseDate?: Date;
  currencyCode?: string;
  householdTimeZone?: string;
  archivedPaidOffDebtIds?: readonly string[];
  inclusionByDebtId?: Readonly<Record<string, PayoffAccountInput['inclusion']>>;
}>;

function runScenarioComparison(params: {
  debts: readonly DebtItem[];
  strategy: PayoffStrategy;
  baselineExtraMonthlyPayment: number;
  monthlyExtraAmount: number;
  oneTimeExtraAmount: number;
  mode: 'oneTime' | 'monthly';
  scenarioAmount: number;
  oneTimeDate?: DateOnly;
  baseDate: Date;
  currencyCode: string;
  householdTimeZone: string;
  archivedPaidOffDebtIds: readonly string[];
  inclusionByDebtId?: Readonly<Record<string, PayoffAccountInput['inclusion']>>;
}): ExtraPaymentScenarioResult {
  const {
    debts,
    strategy,
    baselineExtraMonthlyPayment,
    monthlyExtraAmount,
    oneTimeExtraAmount,
    mode,
    scenarioAmount,
    oneTimeDate,
    baseDate,
    currencyCode,
    householdTimeZone,
    archivedPaidOffDebtIds,
    inclusionByDebtId,
  } = params;
  const scale = 10 ** getCurrency(currencyCode).scale;
  const toMinor = (value: number) => Math.round(value * scale);
  const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * scale) / scale;
  const safeBaselineExtra = Math.max(0, roundCurrency(Number.isFinite(baselineExtraMonthlyPayment) ? baselineExtraMonthlyPayment : 0));
  const safeScenarioAmount = Math.max(0, roundCurrency(Number.isFinite(scenarioAmount) ? scenarioAmount : 0));
  const safeMonthlyExtra = Math.max(0, roundCurrency(Number.isFinite(monthlyExtraAmount) ? monthlyExtraAmount : 0));
  const safeOneTimeExtra = Math.max(0, roundCurrency(Number.isFinite(oneTimeExtraAmount) ? oneTimeExtraAmount : 0));
  const cycleInfo = oneTimeDate
    ? resolveOneTimePaymentPeriod(oneTimeDate, baseDate, householdTimeZone)
    : (() => {
        const firstDate = defaultFirstPaymentDate(baseDate, householdTimeZone);
        return {
          period: 1,
          cycleDate: firstDate,
          cycleLabel: formatDateOnlyMonthYear(firstDate),
          clampedToFirstCycle: false,
        };
      })();

  const baselineRun = runPayoffPlan(
    debts,
    strategy,
    safeBaselineExtra,
    baseDate,
    currencyCode,
    householdTimeZone,
    archivedPaidOffDebtIds,
    0,
    inclusionByDebtId,
  );
  const projectedRun = runPayoffPlan(
    debts,
    strategy,
    safeMonthlyExtra,
    baseDate,
    currencyCode,
    householdTimeZone,
    archivedPaidOffDebtIds,
    0,
    inclusionByDebtId,
    safeOneTimeExtra,
    cycleInfo.period,
  );

  const debtById = new Map(debts.map(d => [d.id, d]));
  const projectedSchedule = 'schedule' in projectedRun.raw ? projectedRun.raw.schedule : [];

  const summarizePeriod = (periodIndex: number): ScenarioPeriodSummary | null => {
    const period = projectedSchedule[periodIndex];
    if (!period) return null;
    const receiving = period.accounts.filter(acc => {
      const inclusion = projectedRun.inclusionById.get(acc.accountId);
      return (inclusion === 'accelerated' || inclusion === 'minimum-only') && acc.totalPaid.minorUnits > 0 && debtById.has(acc.accountId);
    });
    receiving.sort((a, b) => {
      const aInc = projectedRun.inclusionById.get(a.accountId);
      const bInc = projectedRun.inclusionById.get(b.accountId);
      if (aInc !== bInc) return aInc === 'accelerated' ? -1 : 1;
      const aDebt = debtById.get(a.accountId)!;
      const bDebt = debtById.get(b.accountId)!;
      const balDiff = a.openingObligation.minorUnits - b.openingObligation.minorUnits;
      const aprDiff = Math.round(bDebt.apr * 1000) - Math.round(aDebt.apr * 1000);
      return (strategy === 'snowball' ? (balDiff || aprDiff) : (aprDiff || balDiff)) || (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0);
    });

    const periodNumber = periodIndex + 1;
    let remainingScenarioExtraMinor = toMinor(safeMonthlyExtra)
      + (periodNumber === cycleInfo.period ? toMinor(safeOneTimeExtra) : 0);
    let periodScenarioExtraMinor = 0;
    let periodRolloverExtraMinor = 0;

    const allocations: ScenarioPaymentAccount[] = receiving.map(acc => {
      const debt = debtById.get(acc.accountId)!;
      const inclusion = projectedRun.inclusionById.get(acc.accountId) === 'minimum-only' ? 'minimum-only' : 'accelerated';
      const extraMinor = acc.extraPaid.minorUnits;
      const scenarioExtraMinor = Math.min(extraMinor, remainingScenarioExtraMinor);
      remainingScenarioExtraMinor -= scenarioExtraMinor;
      const rolloverExtraMinor = extraMinor - scenarioExtraMinor;
      periodScenarioExtraMinor += scenarioExtraMinor;
      periodRolloverExtraMinor += rolloverExtraMinor;
      return {
        accountId: acc.accountId,
        name: debt.name,
        category: debt.category,
        inclusion,
        openingBalance: acc.openingObligation.minorUnits / scale,
        interestAccrued: acc.interestAccrued.minorUnits / scale,
        minimumPaid: acc.minimumPaid.minorUnits / scale,
        extraPaid: extraMinor / scale,
        scenarioExtraPaid: scenarioExtraMinor / scale,
        minimumRolloverPaid: rolloverExtraMinor / scale,
        totalPaid: acc.totalPaid.minorUnits / scale,
        closingBalance: acc.closingObligation.minorUnits / scale,
        paidOff: acc.openingObligation.minorUnits > 0 && acc.closingObligation.minorUnits === 0,
      };
    });

    const firstExtraAcc = receiving.find(acc => acc.extraPaid.minorUnits > 0);
    const primaryTargetName = (firstExtraAcc ? debtById.get(firstExtraAcc.accountId)?.name : null)
      ?? allocations.find(a => a.inclusion === 'accelerated')?.name
      ?? allocations[0]?.name
      ?? null;

    return {
      period: period.period,
      paymentDate: period.paymentDate,
      monthLabel: formatDateOnlyMonthYear(period.paymentDate),
      totalPaid: period.totalPaid.minorUnits / scale,
      totalMinimumPaid: period.totalMinimumPaid.minorUnits / scale,
      totalExtraPaid: period.totalExtraPaid.minorUnits / scale,
      scenarioExtraPaid: periodScenarioExtraMinor / scale,
      minimumRolloverPaid: periodRolloverExtraMinor / scale,
      unusedBudget: period.unusedBudget.minorUnits / scale,
      paidOffCount: allocations.filter(a => a.paidOff).length,
      primaryTargetName,
      allocations,
    };
  };

  const bothPaidOff = baselineRun.plan.status === 'paidOff'
    && projectedRun.plan.status === 'paidOff'
    && baselineRun.plan.monthsToPayoff !== null
    && projectedRun.plan.monthsToPayoff !== null;
  const monthsSaved = bothPaidOff
    ? baselineRun.plan.monthsToPayoff! - projectedRun.plan.monthsToPayoff!
    : null;
  const interestSaved = bothPaidOff
    ? roundCurrency(baselineRun.plan.totalInterest - projectedRun.plan.totalInterest)
    : null;

  return {
    mode,
    scenarioAmount: safeScenarioAmount,
    baselineExtraMonthlyPayment: safeBaselineExtra,
    totalScenarioMonthlyExtra: safeMonthlyExtra,
    baseline: baselineRun.plan,
    projected: projectedRun.plan,
    firstPayment: summarizePeriod(0),
    nextPayment: summarizePeriod(1),
    monthsSaved,
    interestSaved,
    oneTimeExtraAmount: safeOneTimeExtra,
    oneTimePeriod: cycleInfo.period,
    oneTimeCycleDate: cycleInfo.cycleDate,
    oneTimeCycleLabel: cycleInfo.cycleLabel,
    oneTimeClampedToFirstCycle: cycleInfo.clampedToFirstCycle,
    oneTimePayment: safeOneTimeExtra > 0 ? summarizePeriod(cycleInfo.period - 1) : null,
  };
}

export function calculateExtraPaymentScenario(
  debts: readonly DebtItem[],
  strategy: PayoffStrategy,
  baselineExtraMonthlyPayment: number,
  scenarioAmount: number,
  mode: 'oneTime' | 'monthly',
  baseDate: Date = new Date(),
  currencyCode = 'USD',
  householdTimeZone = 'UTC',
  archivedPaidOffDebtIds: readonly string[] = [],
  inclusionByDebtId?: Readonly<Record<string, PayoffAccountInput['inclusion']>>,
): ExtraPaymentScenarioResult {
  return runScenarioComparison({
    debts,
    strategy,
    baselineExtraMonthlyPayment,
    monthlyExtraAmount: mode === 'monthly' ? scenarioAmount : 0,
    oneTimeExtraAmount: mode === 'oneTime' ? scenarioAmount : 0,
    mode,
    scenarioAmount,
    baseDate,
    currencyCode,
    householdTimeZone,
    archivedPaidOffDebtIds,
    inclusionByDebtId,
  });
}

export function calculateStrategyScenario(input: StrategyScenarioInput): ExtraPaymentScenarioResult {
  const monthlyExtraAmount = input.monthlyExtraAmount;
  const oneTimeExtraAmount = input.oneTimeExtraAmount ?? 0;
  return runScenarioComparison({
    debts: input.debts,
    strategy: input.strategy,
    baselineExtraMonthlyPayment: input.baselineExtraMonthlyPayment,
    monthlyExtraAmount,
    oneTimeExtraAmount,
    mode: oneTimeExtraAmount > 0 && monthlyExtraAmount === input.baselineExtraMonthlyPayment ? 'oneTime' : 'monthly',
    scenarioAmount: monthlyExtraAmount,
    oneTimeDate: input.oneTimeDate,
    baseDate: input.baseDate ?? new Date(),
    currencyCode: input.currencyCode ?? 'USD',
    householdTimeZone: input.householdTimeZone ?? 'UTC',
    archivedPaidOffDebtIds: input.archivedPaidOffDebtIds ?? [],
    inclusionByDebtId: input.inclusionByDebtId,
  });
}

export type IndependentMortgageProjection = Readonly<{
  debt: DebtItem;
  escrow: number;
  extraMonthlyPayment: number;
  plan: PayoffPlanResult;
  projection: DebtPayoffProjection;
}>;

/** Project each mortgage in its own amortization pool, excluding entered escrow. */
export function calculateIndependentMortgageProjections(
  debts: readonly DebtItem[], strategy: PayoffStrategy, escrowByDebtId: Readonly<Record<string, number>>,
  extraByDebtId: Readonly<Record<string, number>>, baseDate = new Date(), currencyCode = 'USD', householdTimeZone = 'UTC',
): IndependentMortgageProjection[] {
  return debts.flatMap(debt => {
    if (debt.category !== 'Mortgage' || debt.balance <= 0) return [];
    const escrow = escrowByDebtId[debt.id];
    const extra = extraByDebtId[debt.id] ?? 0;
    if (escrow === undefined || !Number.isFinite(escrow) || escrow < 0 || escrow > debt.minimumPayment ||
        !Number.isFinite(extra) || extra < 0 || debt.minimumPayment - escrow + extra <= 0) return [];
    const amortizingAccount = { ...debt, category: 'Auto loan' as const, minimumPayment: debt.minimumPayment - escrow };
    const plan = calculatePayoffPlan([amortizingAccount], strategy, extra, baseDate, currencyCode, householdTimeZone);
    const projection = plan.payoffOrder[0];
    return projection ? [{ debt, escrow, extraMonthlyPayment: extra, plan, projection }] : [];
  });
}

export type InterestBurnSummary = Readonly<{
  activeBalance: number;
  weightedAvgApr: number;
  monthlyInterestBurn: number;
  dailyInterestBurn: number;
}>;

/** Weighted average APR and monthly/daily interest burn across positive-balance debts. */
export function summarizeInterestBurn(
  debts: readonly DebtItem[],
  options: { includeMortgages?: boolean; currencyCode?: string } = {},
): InterestBurnSummary {
  const currencyCode = options.currencyCode ?? 'USD';
  const factor = 10 ** getCurrency(currencyCode).scale;
  const roundToCurrency = (value: number) => Math.round((value + Number.EPSILON) * factor) / factor;
  const eligible = debts.filter(
    debt =>
      Number.isFinite(debt.balance) &&
      debt.balance > 0 &&
      (options.includeMortgages ? true : isActiveDebtItem(debt)),
  );
  const activeBalance = roundToCurrency(eligible.reduce((sum, debt) => sum + debt.balance, 0));
  if (activeBalance <= 0) {
    return { activeBalance: 0, weightedAvgApr: 0, monthlyInterestBurn: 0, dailyInterestBurn: 0 };
  }
  let weightedAprNumerator = 0;
  let monthlyBurn = 0;
  let dailyBurn = 0;
  for (const debt of eligible) {
    const apr = Number.isFinite(debt.apr) && debt.apr > 0 ? debt.apr : 0;
    weightedAprNumerator += debt.balance * apr;
    monthlyBurn += (debt.balance * (apr / 100)) / 12;
    dailyBurn += (debt.balance * (apr / 100)) / 365;
  }
  return {
    activeBalance,
    weightedAvgApr: Math.round(((weightedAprNumerator / activeBalance) + Number.EPSILON) * 100) / 100,
    monthlyInterestBurn: roundToCurrency(monthlyBurn),
    dailyInterestBurn: roundToCurrency(dailyBurn),
  };
}

export type StrategyVariantSummary = Readonly<{
  strategy: PayoffStrategy;
  monthsToPayoff: number | null;
  debtFreeDateLabel: string;
  totalInterest: number;
  monthlyTotalPayment: number;
  firstTargetName: string | null;
}>;

export type StrategyComparisonSummary = Readonly<{
  minimumsOnly: Readonly<{
    monthsToPayoff: number | null;
    debtFreeDateLabel: string;
    totalInterest: number;
    monthlyTotalPayment: number;
    stalled: boolean;
  }>;
  activePlan: PayoffPlanResult;
  monthsSavedVsMinimums: number | null;
  interestSavedVsMinimums: number | null;
  snowball: StrategyVariantSummary;
  avalanche: StrategyVariantSummary;
  avalancheInterestSavingsVsSnowball: number | null;
  avalancheMonthsSavedVsSnowball: number | null;
}>;

function toVariantSummary(plan: PayoffPlanResult): StrategyVariantSummary {
  return {
    strategy: plan.strategy,
    monthsToPayoff: plan.monthsToPayoff,
    debtFreeDateLabel: plan.debtFreeDateLabel,
    totalInterest: plan.totalInterest,
    monthlyTotalPayment: plan.monthlyTotalPayment,
    firstTargetName: plan.firstTarget?.name ?? null,
  };
}

/** Compare active payoff plan against minimums-only baseline and Snowball vs. Avalanche. */
export function comparePayoffStrategies(
  debts: DebtItem[],
  strategy: PayoffStrategy,
  extraMonthlyPayment: number,
  baseDate: Date = new Date(),
  currencyCode = 'USD',
  householdTimeZone = 'UTC',
  archivedPaidOffDebtIds: readonly string[] = [],
  extraOneTimePayment = 0,
  extraOneTimePeriod = 1,
): StrategyComparisonSummary {
  const factor = 10 ** getCurrency(currencyCode).scale;
  const roundToCurrency = (value: number) => Math.round((value + Number.EPSILON) * factor) / factor;
  const minimumsPlan = calculatePayoffPlan(
    debts,
    strategy,
    0,
    baseDate,
    currencyCode,
    householdTimeZone,
    archivedPaidOffDebtIds,
  );
  const snowballPlan = calculatePayoffPlan(
    debts,
    'snowball',
    extraMonthlyPayment,
    baseDate,
    currencyCode,
    householdTimeZone,
    archivedPaidOffDebtIds,
    0,
    extraOneTimePayment,
    extraOneTimePeriod,
  );
  const avalanchePlan = calculatePayoffPlan(
    debts,
    'avalanche',
    extraMonthlyPayment,
    baseDate,
    currencyCode,
    householdTimeZone,
    archivedPaidOffDebtIds,
    0,
    extraOneTimePayment,
    extraOneTimePeriod,
  );
  const activePlan = strategy === 'snowball' ? snowballPlan : avalanchePlan;
  const bothActiveAndMinPaidOff =
    minimumsPlan.status === 'paidOff' &&
    activePlan.status === 'paidOff' &&
    minimumsPlan.monthsToPayoff !== null &&
    activePlan.monthsToPayoff !== null;
  const monthsSavedVsMinimums = bothActiveAndMinPaidOff
    ? Math.max(0, (minimumsPlan.monthsToPayoff ?? 0) - (activePlan.monthsToPayoff ?? 0))
    : null;
  const interestSavedVsMinimums = bothActiveAndMinPaidOff
    ? roundToCurrency(Math.max(0, minimumsPlan.totalInterest - activePlan.totalInterest))
    : null;
  const bothMethodsPaidOff =
    snowballPlan.status === 'paidOff' &&
    avalanchePlan.status === 'paidOff' &&
    snowballPlan.monthsToPayoff !== null &&
    avalanchePlan.monthsToPayoff !== null;
  const avalancheInterestSavingsVsSnowball = bothMethodsPaidOff
    ? roundToCurrency(snowballPlan.totalInterest - avalanchePlan.totalInterest)
    : null;
  const avalancheMonthsSavedVsSnowball = bothMethodsPaidOff
    ? (snowballPlan.monthsToPayoff ?? 0) - (avalanchePlan.monthsToPayoff ?? 0)
    : null;

  return {
    minimumsOnly: {
      monthsToPayoff: minimumsPlan.monthsToPayoff,
      debtFreeDateLabel: minimumsPlan.debtFreeDateLabel,
      totalInterest: minimumsPlan.totalInterest,
      monthlyTotalPayment: minimumsPlan.monthlyTotalPayment,
      stalled: minimumsPlan.stalled,
    },
    activePlan,
    monthsSavedVsMinimums,
    interestSavedVsMinimums,
    snowball: toVariantSummary(snowballPlan),
    avalanche: toVariantSummary(avalanchePlan),
    avalancheInterestSavingsVsSnowball,
    avalancheMonthsSavedVsSnowball,
  };
}

export type LoanInterestMethod = 'monthly' | 'daily_simple';

export type LoanPaymentSplitSuggestion = Readonly<{
  principal: number;
  interest: number;
  escrow: number;
}>;

/** Estimate an optional P/I/(Escrow) breakdown for explicit user prefill on Mortgage/Auto payments. */
export function suggestLoanPaymentSplit(params: {
  balance: number;
  aprPercent: number;
  paymentAmount: number;
  escrowAmount?: number;
  currencyCode?: string;
  interestMethod?: LoanInterestMethod;
  daysElapsed?: number;
  dayCountBasis?: number;
}): LoanPaymentSplitSuggestion {
  const currencyCode = params.currencyCode ?? 'USD';
  const factor = 10 ** getCurrency(currencyCode).scale;
  const roundToCurrency = (value: number) => Math.round((value + Number.EPSILON) * factor) / factor;
  const safePayment = Number.isFinite(params.paymentAmount) && params.paymentAmount > 0 ? roundToCurrency(params.paymentAmount) : 0;
  if (safePayment <= 0) return { principal: 0, interest: 0, escrow: 0 };
  const safeEscrowRaw = Number.isFinite(params.escrowAmount) && (params.escrowAmount ?? 0) > 0 ? roundToCurrency(params.escrowAmount!) : 0;
  const escrow = Math.min(safePayment, safeEscrowRaw);
  const afterEscrow = Math.max(0, roundToCurrency(safePayment - escrow));
  const safeBalance = Number.isFinite(params.balance) && params.balance > 0 ? params.balance : 0;
  const safeApr = Number.isFinite(params.aprPercent) && params.aprPercent > 0 ? params.aprPercent : 0;
  let accruedInterest: number;
  if (params.interestMethod === 'daily_simple') {
    const safeDays = Number.isFinite(params.daysElapsed) && (params.daysElapsed ?? 0) > 0 ? params.daysElapsed! : 0;
    const safeBasis = Number.isFinite(params.dayCountBasis) && (params.dayCountBasis ?? 0) > 0 ? params.dayCountBasis! : 365;
    accruedInterest = roundToCurrency(((safeBalance * (safeApr / 100)) / safeBasis) * safeDays);
  } else {
    accruedInterest = roundToCurrency((safeBalance * (safeApr / 100)) / 12);
  }
  const interest = Math.min(afterEscrow, accruedInterest);
  const principal = Math.min(Math.max(0, roundToCurrency(afterEscrow - interest)), roundToCurrency(safeBalance));
  return { principal, interest, escrow };
}

/** Unrounded daily interest accrual on a loan balance (`(balance * apr / 100) / dayCountBasis`). */
export function calculateDailyInterestCost(balance: number, aprPercent: number, dayCountBasis = 365): number {
  if (!Number.isFinite(balance) || balance <= 0 || !Number.isFinite(aprPercent) || aprPercent <= 0 || !Number.isFinite(dayCountBasis) || dayCountBasis <= 0) {
    return 0;
  }
  return (balance * (aprPercent / 100)) / dayCountBasis;
}

/** Find the most recent confirmed payment date on or before `onOrBeforeDate` for a loan or its linked bills. */
export function findPreviousLoanPaymentDate(params: {
  debtId: string;
  transactions: readonly {
    id: string;
    accountId: string | null;
    date: DateOnly;
    category: string;
    deletedAt: string | null;
    isPending?: boolean;
    memo?: string | null;
  }[];
  onOrBeforeDate: DateOnly;
  excludeTransactionId?: string;
  linkedBillIds?: readonly string[];
}): DateOnly | null {
  const cutoff = parseDateOnly(params.onOrBeforeDate);
  const billIds = params.linkedBillIds ?? [];
  let latest: DateOnly | null = null;
  for (const tx of params.transactions) {
    if (tx.deletedAt !== null || tx.isPending || tx.id === params.excludeTransactionId || tx.date > cutoff) {
      continue;
    }
    const directMatch = tx.accountId === params.debtId && tx.category === 'payment';
    const linkedBillMatch =
      billIds.length > 0
      && tx.accountId === null
      && (tx.category === 'debit_bill' || tx.category === 'payment')
      && billIds.some(billId => tx.id.startsWith(`bill:${billId}:`) || (tx.memo ?? '').includes(`[bill:${billId}]`));
    if (!directMatch && !linkedBillMatch) continue;
    if (latest === null || tx.date > latest) {
      latest = tx.date;
    }
  }
  return latest;
}

/** Resolve the next upcoming due date on or after `today` and strictly after `lastPaymentDate`. */
export function resolveNextAutoDueDate(params: {
  dueDay: number | null;
  today: DateOnly;
  lastPaymentDate?: DateOnly | null;
}): DateOnly | null {
  const { dueDay } = params;
  if (dueDay === null || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    return null;
  }
  const today = parseDateOnly(params.today);
  const lastPayment = params.lastPaymentDate ? parseDateOnly(params.lastPaymentDate) : null;
  let month = today.slice(0, 7);
  for (let step = 0; step < 24; step += 1) {
    const year = Number(month.slice(0, 4));
    const monthNum = Number(month.slice(5, 7));
    const day = Math.min(dueDay, daysInMonth(year, monthNum));
    const candidate = parseDateOnly(`${String(year).padStart(4, '0')}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    if (candidate >= today && (lastPayment === null || candidate > lastPayment)) {
      return candidate;
    }
    month = getNextMonthString(month);
  }
  return null;
}

export type AutoLoanSplitEstimate = Readonly<{
  suggestion: LoanPaymentSplitSuggestion;
  method: LoanInterestMethod;
  daysElapsed: number | null;
  lastPaymentDate: DateOnly | null;
  dailyInterestCost: number;
}>;

/** Resolve Auto loan P/I split using Actual/365 daily simple interest when a prior payment exists, else monthly fallback. */
export function resolveAutoLoanSplitSuggestion(params: {
  debt: Pick<DebtItem, 'id' | 'balance' | 'apr'>;
  paymentAmount: number;
  paymentDate: DateOnly;
  transactions: readonly {
    id: string;
    accountId: string | null;
    date: DateOnly;
    category: string;
    deletedAt: string | null;
    isPending?: boolean;
    memo?: string | null;
  }[];
  currencyCode?: string;
  preferredMethod?: LoanInterestMethod;
  excludeTransactionId?: string;
  linkedBillIds?: readonly string[];
  dayCountBasis?: number;
}): AutoLoanSplitEstimate {
  const dailyInterestCost = calculateDailyInterestCost(params.debt.balance, params.debt.apr, params.dayCountBasis);
  const lastPaymentDate = findPreviousLoanPaymentDate({
    debtId: params.debt.id,
    transactions: params.transactions,
    onOrBeforeDate: params.paymentDate,
    excludeTransactionId: params.excludeTransactionId,
    linkedBillIds: params.linkedBillIds,
  });
  const rawDays = lastPaymentDate ? Math.max(0, calendarDaysBetween(lastPaymentDate, params.paymentDate)) : null;
  const method: LoanInterestMethod = params.preferredMethod === 'monthly'
    ? 'monthly'
    : rawDays !== null
      ? 'daily_simple'
      : 'monthly';
  const suggestion = suggestLoanPaymentSplit({
    balance: params.debt.balance,
    aprPercent: params.debt.apr,
    paymentAmount: params.paymentAmount,
    currencyCode: params.currencyCode,
    interestMethod: method,
    daysElapsed: method === 'daily_simple' ? (rawDays ?? 0) : undefined,
    dayCountBasis: params.dayCountBasis,
  });
  return {
    suggestion,
    method,
    daysElapsed: method === 'daily_simple' ? rawDays : null,
    lastPaymentDate,
    dailyInterestCost,
  };
}

/** Whether a debt account has complete inputs for an auto-estimated P/I/(Escrow) split. */
export function canSuggestLoanPaymentSplit(
  debt: Pick<DebtItem, 'category' | 'balance' | 'apr'>,
  escrowAmount?: number,
): boolean {
  if (!Number.isFinite(debt.balance) || debt.balance <= 0 || !Number.isFinite(debt.apr) || debt.apr < 0) {
    return false;
  }
  if (debt.category === 'Mortgage') {
    return escrowAmount !== undefined && Number.isFinite(escrowAmount) && escrowAmount >= 0;
  }
  if (debt.category === 'Auto loan') {
    return true;
  }
  return false;
}

/** Projected remaining loan balance after applying an explicit principal reduction. */
export function projectedLoanBalanceAfterPrincipal(
  balance: number,
  principal: number,
  currencyCode = 'USD',
): number {
  const factor = 10 ** getCurrency(currencyCode).scale;
  const safeBalance = Number.isFinite(balance) && balance > 0 ? balance : 0;
  const safePrincipal = Number.isFinite(principal) && principal > 0 ? principal : 0;
  return Math.max(0, Math.round((safeBalance - safePrincipal + Number.EPSILON) * factor) / factor);
}
