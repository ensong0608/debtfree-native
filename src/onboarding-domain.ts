// @ts-ignore TS5097
import type { ObligationSchedules } from './finance/obligation-schedule.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { CURRENCIES, getCurrency, type CurrencyScale } from './finance/currencies.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { classifyMoneyEdit, parseMoney, parseApr, makeMoney, multiplyMoneyRatio, addMoney } from './finance/money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { householdDate, monthlyPaymentDate, parseDateOnly, type DateOnly } from './finance/calendar.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import type { DataContext } from './finance/contracts.ts';
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
  'Manage debt with my partner',
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
};

/** Explicitly reviewed relationship between a mortgage/auto loan and its payment bill. */
export type LoanBillPairing = Readonly<{
  status: 'linked' | 'separate' | 'dismissed';
  billId?: string;
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
  primaryIncomeAmount: number;
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
  /** Server-validated revision for settings held in auth metadata; absent on legacy profiles. */
  settingsRevision?: number;
  obligationSchedules?: ObligationSchedules;
  /** User-entered monthly escrow component for mortgage payments; missing means unknown. */
  mortgageEscrowByDebtId?: Record<string, number>;
  /** Independently entered monthly extra payment for each mortgage projection. */
  mortgageExtraPaymentByDebtId?: Record<string, number>;
  /** User-confirmed loan-to-recurring-bill relationships and review choices. */
  loanBillPairingByDebtId?: Record<string, LoanBillPairing>;
  /** Reusable display labels for recurring bills stored with the compatible other_bill enum. */
  recurringBillCategoryLabelByBillId?: Record<string, string>;
};

/** Round a numeric dollar amount to two decimal places using integer-cent precision. */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
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
  const source = parseMoney(String(amount), currencyCode);
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
  const monthly = (amount: number, frequency: PayFrequency) => parseMoney(String(normalizeMonthlyIncome(amount, frequency, currencyCode)), currencyCode);
  const total = additionalIncomes.reduce((sum, item) => addMoney(sum, monthly(item.amount, item.frequency)), monthly(primaryAmount, primaryFrequency));
  return total.minorUnits / 10 ** getCurrency(currencyCode).scale;
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
      upcomingReminders: true,
      overdueAlerts: true,
      milestonesAndProgress: false,
      permissionRequested: false,
      osPermissionStatus: 'undetermined',
    },
    completedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Determine which screen an authenticated user should see when opening or signing into the app. */
export function resolveAuthenticatedStage(data: UserOnboardingData): FlowStage {
  if (data.onboardingCompleted) return 'home';
  const validStages: FlowStage[] = [
    'signup_2',
    'signup_3',
    'signup_4',
    'onboard_1',
    'onboard_2',
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
/** Home shows the date alone; the estimate badge and subtitle already explain the forecast scope. */
export function homeDebtFreeEstimateDate(label: string): string {
  return label.replace(/^Entered debts projected paid off:\s*/, '');
}
export function calculatePayoffPlan(debts: DebtItem[], strategy: PayoffStrategy, extraMonthlyPayment: number, baseDate: Date = new Date(), currencyCode = 'USD', householdTimeZone = 'UTC'): PayoffPlanResult {
  const scale = 10 ** getCurrency(currencyCode).scale;
  const toMinor = (n: number) => Math.round(n * scale);
  const money = (n: number) => makeMoney(currencyCode, toMinor(n));
  const ordered = sortDebtsByStrategy(debts, strategy, currencyCode);
  const totalDebt = ordered.reduce((sum, d) => sum + toMinor(d.balance), 0) / scale;
  const totalStartingDebt = activeDebts(debts).reduce((sum, d) => sum + toMinor(Math.max(0, d.balance, d.originalBalance ?? d.balance)), 0) / scale;
  const hasOpenObligations = ordered.length > 0;
  const totalMinimums = ordered.reduce((sum, d) => sum + toMinor(d.minimumPayment), 0) / scale;
  const safeExtra = toMinor(extraMonthlyPayment) / scale;
  const context: DataContext = { householdId: 'local', source: { id: 'onboarding', kind: 'manual' }, asOf: null, coverage: { status: 'unknown' } };
  let result: PayoffResult;
  try {
    const accounts: PayoffAccountInput[] = debts.map(d => ({ accountId: d.id, inclusion: isActiveDebtItem(d) ? 'accelerated' : 'excluded', balance: money(d.balance), aprThousandths: Math.round(d.apr * 1000), scheduledMinimum: money(d.minimumPayment) }));
    result = calculatePayoff({ accounts: { status: 'available', data: accounts, context }, assumptions: { firstPaymentDate: defaultFirstPaymentDate(baseDate, householdTimeZone), requestedDay: 1, householdTimeZone }, strategy, currency: currencyCode, extraMonthlyPayment: money(extraMonthlyPayment) });
  } catch (error) { result = { status: 'invalidInput', reason: error instanceof Error ? error.message : 'Invalid input' }; }
  const common = 'schedule' in result ? result : null;
  const labels: Record<Exclude<PayoffResult['status'], 'paidOff'>, string> = { paymentShortfall: 'Payment shortfall', notAmortizingUnderAssumptions: 'Not amortizing under current assumptions', horizonReached: 'Projection horizon reached', insufficientData: 'Insufficient data for projection', invalidInput: 'Invalid projection input' };
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
    return { ...d, firstMonthPayment: monthlySchedule[0]?.payment ?? 0, monthsToPayoff: summary?.payoffMonth ?? null, projectedPayoffLabel: summary?.payoffDate ? formatDateOnlyMonthYear(summary.payoffDate) : 'Payoff date unavailable', monthlySchedule };
  });

  const excludedDebts = debts.filter(d => !isActiveDebtItem(d) && d.balance > 0);
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
  // A known-zero set of *entered* accounts does not establish complete household coverage.
  const displayStatus = hasOpenObligations ? result.status : 'insufficientData';
  const displayPayoffLabel = !hasOpenObligations
    ? (activeDebts(debts).length ? 'No balance owed on entered accounts' : 'Add accounts to estimate payoff')
    : result.status === 'paidOff'
      ? (result.monthsToPayoff === 0 ? 'No outstanding tracked debt'
        : result.coverageScope === 'verified-household'
          ? `Projected payoff: ${formatDateOnlyMonthYear(result.payoffDate!)}`
          : `Entered debts projected paid off: ${formatDateOnlyMonthYear(result.payoffDate!)}`)
      : labels[result.status];
  return { strategy, status: displayStatus, unusedBudget: result.status === 'paidOff' ? result.unusedBudget.minorUnits / scale : (lastPeriod?.unusedBudget.minorUnits ?? 0) / scale, totalDebt, totalStartingDebt, progressPercent: totalStartingDebt > 0 ? Math.max(0, Math.min(100, Math.round((totalStartingDebt - totalDebt) / totalStartingDebt * 100))) : 0, totalMinimums, extraMonthlyPayment: safeExtra, monthlyTotalPayment: !hasOpenObligations ? 0 : common ? common.monthlyCommitment.minorUnits / scale : totalMinimums + safeExtra, totalInterest: result.status === 'paidOff' ? result.totalInterest.minorUnits / scale : result.status === 'paymentShortfall' || result.status === 'notAmortizingUnderAssumptions' || result.status === 'horizonReached' ? result.partialInterest.minorUnits / scale : 0, monthsToPayoff: hasOpenObligations && result.status === 'paidOff' ? result.monthsToPayoff : null, debtFreeDateLabel: displayPayoffLabel, stalled: displayStatus !== 'paidOff', firstTarget: payoffOrder[0] ?? null, payoffOrder, allProjections: [...payoffOrder, ...excludedProjections] };
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
