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

export const DEBT_CATEGORIES: DebtCategory[] = [
  'Credit card',
  'Personal loan',
  'Auto loan',
  'Mortgage',
  'Student loan',
  'Medical debt',
  'Other loan',
];

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
};

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
};

/** Round a numeric dollar amount to two decimal places using integer-cent precision. */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Parse a user-entered currency string (e.g. "$5,200.50" or "150") into a finite 2-decimal number or null. */
export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '').trim();
  if (!cleaned) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return roundCents(parsed);
}

/** Parse a user-entered APR percentage string (e.g. "19.99" or "0") into a finite number in [0, 100] or null. */
export function parsePercentInput(raw: string): number | null {
  const cleaned = raw.replace(/[%\s]/g, '').trim();
  if (!cleaned) return null;
  if (!/^\d+(\.\d{0,3})?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return Math.round((parsed + Number.EPSILON) * 1000) / 1000;
}

/** Format a number as currency (e.g. "$5,200.00"). */
export function formatCurrency(amount: number, symbol = '$', decimals = 2): string {
  const safe = Number.isFinite(amount) ? roundCents(amount) : 0;
  const negative = safe < 0;
  const abs = Math.abs(safe);
  const fixed = abs.toFixed(decimals);
  const [whole, fraction] = fixed.split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const formatted = decimals > 0 ? `${symbol}${withCommas}.${fraction}` : `${symbol}${withCommas}`;
  return negative ? `-${formatted}` : formatted;
}

/** Convert an income paycheck/period amount to its monthly equivalent. */
export function normalizeMonthlyIncome(amount: number, frequency: PayFrequency): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  switch (frequency) {
    case 'weekly':
      return roundCents((amount * 52) / 12);
    case 'biweekly':
      return roundCents((amount * 26) / 12);
    case 'twice_monthly':
      return roundCents(amount * 2);
    case 'monthly':
    default:
      return roundCents(amount);
  }
}

/** Total monthly household take-home income across primary and additional income sources. */
export function calculateTotalMonthlyIncome(
  primaryAmount: number,
  primaryFrequency: PayFrequency,
  additionalIncomes: AdditionalIncomeSource[],
): number {
  const primaryMonthly = normalizeMonthlyIncome(primaryAmount, primaryFrequency);
  const extraMonthly = additionalIncomes.reduce(
    (sum, item) => sum + normalizeMonthlyIncome(item.amount, item.frequency),
    0,
  );
  return roundCents(primaryMonthly + extraMonthly);
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
): { valid: true; primaryAmount: number } | { valid: false; error: string } {
  const parsed = parseMoneyInput(primaryAmountRaw);
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
): { valid: true; debt: Omit<DebtItem, 'id' | 'createdAt' | 'updatedAt'> } | { valid: false; error: string } {
  const name = draft.name.trim();
  if (!name) {
    return { valid: false, error: 'Enter a name for this debt (for example, Chase Sapphire or Auto Loan).' };
  }
  const balance = parseMoneyInput(draft.balanceRaw);
  if (balance === null || balance <= 0) {
    return { valid: false, error: 'Enter a current balance greater than $0.' };
  }
  const apr = parsePercentInput(draft.aprRaw);
  if (apr === null) {
    return { valid: false, error: 'Enter a valid APR percentage between 0% and 100%.' };
  }
  const minimumPayment = parseMoneyInput(draft.minimumPaymentRaw);
  if (minimumPayment === null || minimumPayment <= 0) {
    return { valid: false, error: 'Enter a minimum monthly payment greater than $0.' };
  }

  let originalBalance: number | null = null;
  if (draft.originalBalanceRaw && draft.originalBalanceRaw.trim() !== '') {
    const parsedOrig = parseMoneyInput(draft.originalBalanceRaw);
    if (parsedOrig === null || parsedOrig <= 0) {
      return { valid: false, error: 'Enter a valid original loan balance greater than $0.' };
    }
    originalBalance = parsedOrig;
  } else if (draft.category === 'Mortgage' || draft.category === 'Auto loan') {
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
    const parsedLimit = parseMoneyInput(draft.creditLimitRaw);
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
  if (homeStatus === 'Own' && !debts.some(d => d.category === 'Mortgage')) {
    return 'You selected that you own a home with a mortgage. Please add your Mortgage details or switch Your home to Rent/Other.';
  }
  if (vehicleStatus === 'Finance' && !debts.some(d => d.category === 'Auto loan')) {
    return 'You selected that you finance a vehicle. Please add your Auto loan details or update Your vehicle selection.';
  }
  if (debts.length === 0) {
    return 'Add at least one debt account to build your payoff plan.';
  }
  return null;
}

export function validateExtraPaymentInput(
  raw: string,
): { valid: true; extraMonthlyPayment: number } | { valid: false; error: string } {
  const trimmed = raw.replace(/[$,\s]/g, '').trim();
  if (trimmed === '') {
    return { valid: true, extraMonthlyPayment: 0 };
  }
  const parsed = parseMoneyInput(raw);
  if (parsed === null || parsed < 0) {
    return { valid: false, error: 'Enter a valid extra monthly payment of $0 or more.' };
  }
  return { valid: true, extraMonthlyPayment: parsed };
}

/** Sort debts according to Debt Snowball (smallest balance first) or Debt Avalanche (highest APR first). */
export function sortDebtsByStrategy(debts: DebtItem[], strategy: PayoffStrategy): DebtItem[] {
  return [...debts]
    .filter(d => d.balance > 0)
    .sort((a, b) => {
      if (strategy === 'snowball') {
        return a.balance - b.balance || b.apr - a.apr || a.name.localeCompare(b.name);
      }
      return b.apr - a.apr || a.balance - b.balance || a.name.localeCompare(b.name);
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
};

export type PayoffPlanResult = {
  strategy: PayoffStrategy;
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
};

const MAX_PROJECTION_MONTHS = 600;

export function formatMonthOffsetLabel(monthsFromNow: number, baseDate: Date = new Date()): string {
  const target = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + monthsFromNow, 1));
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${monthNames[target.getUTCMonth()]} ${target.getUTCFullYear()}`;
}

/**
 * Authoritative month-by-month debt payoff simulation supporting both Debt Snowball and Debt Avalanche.
 * Uses integer-cent math at each step to prevent floating-point drift.
 */
export function calculatePayoffPlan(
  debts: DebtItem[],
  strategy: PayoffStrategy,
  extraMonthlyPayment: number,
  baseDate: Date = new Date(),
): PayoffPlanResult {
  const ordered = sortDebtsByStrategy(debts, strategy);
  const safeExtra = Math.max(0, roundCents(extraMonthlyPayment));
  const totalDebt = roundCents(ordered.reduce((sum, d) => sum + d.balance, 0));
  const totalStartingDebt = roundCents(
    ordered.reduce((sum, d) => sum + Math.max(d.balance, d.originalBalance ?? d.balance), 0),
  );
  const progressPercent =
    totalStartingDebt > 0
      ? Math.max(0, Math.min(100, Math.round(((totalStartingDebt - totalDebt) / totalStartingDebt) * 100)))
      : 0;
  const totalMinimums = roundCents(ordered.reduce((sum, d) => sum + d.minimumPayment, 0));
  const monthlyTotalPayment = roundCents(totalMinimums + safeExtra);

  if (ordered.length === 0) {
    return {
      strategy,
      totalDebt: 0,
      totalStartingDebt: 0,
      progressPercent: 100,
      totalMinimums: 0,
      extraMonthlyPayment: safeExtra,
      monthlyTotalPayment: safeExtra,
      totalInterest: 0,
      monthsToPayoff: 0,
      debtFreeDateLabel: 'Debt-free now',
      stalled: false,
      firstTarget: null,
      payoffOrder: [],
    };
  }

  const balances = new Map<string, number>(ordered.map(d => [d.id, roundCents(d.balance)]));
  const payoffMonthById = new Map<string, number>();
  const firstMonthPaymentById = new Map<string, number>();
  let totalInterest = 0;
  let stalled = false;

  for (let month = 1; month <= MAX_PROJECTION_MONTHS; month++) {
    const startRemaining = roundCents([...balances.values()].reduce((s, b) => s + b, 0));
    if (startRemaining <= 0.005) break;

    let monthInterest = 0;
    for (const d of ordered) {
      const bal = balances.get(d.id) ?? 0;
      if (bal <= 0.005) continue;
      const interest = roundCents((bal * (d.apr / 100)) / 12);
      balances.set(d.id, roundCents(bal + interest));
      monthInterest = roundCents(monthInterest + interest);
    }
    totalInterest = roundCents(totalInterest + monthInterest);

    let availableBudget = monthlyTotalPayment;
    const monthPayments = new Map<string, number>();

    // Step 1: pay required minimums on all open debts
    for (const d of ordered) {
      const bal = balances.get(d.id) ?? 0;
      if (bal <= 0.005) continue;
      const minPay = roundCents(Math.min(bal, d.minimumPayment, availableBudget));
      if (minPay > 0) {
        balances.set(d.id, roundCents(bal - minPay));
        monthPayments.set(d.id, minPay);
        availableBudget = roundCents(availableBudget - minPay);
      }
    }

    // Step 2: roll any extra + freed-up minimums into priority order (Snowball or Avalanche)
    const activePriority = sortDebtsByStrategy(
      ordered.map(d => ({ ...d, balance: balances.get(d.id) ?? 0 })),
      strategy,
    );
    for (const d of activePriority) {
      if (availableBudget <= 0.005) break;
      const bal = balances.get(d.id) ?? 0;
      if (bal <= 0.005) continue;
      const extraPay = roundCents(Math.min(bal, availableBudget));
      if (extraPay > 0) {
        balances.set(d.id, roundCents(bal - extraPay));
        monthPayments.set(d.id, roundCents((monthPayments.get(d.id) ?? 0) + extraPay));
        availableBudget = roundCents(availableBudget - extraPay);
      }
    }

    if (month === 1) {
      for (const d of ordered) {
        firstMonthPaymentById.set(d.id, roundCents(monthPayments.get(d.id) ?? 0));
      }
    }

    for (const d of ordered) {
      const bal = balances.get(d.id) ?? 0;
      if (bal <= 0.005 && !payoffMonthById.has(d.id)) {
        balances.set(d.id, 0);
        payoffMonthById.set(d.id, month);
      }
    }

    const endRemaining = roundCents([...balances.values()].reduce((s, b) => s + b, 0));
    if (endRemaining <= 0.005) {
      break;
    }
    if (endRemaining >= startRemaining - 0.005) {
      stalled = true;
      break;
    }
    if (month === MAX_PROJECTION_MONTHS && endRemaining > 0.005) {
      stalled = true;
    }
  }

  const maxMonth = payoffMonthById.size === ordered.length
    ? Math.max(...payoffMonthById.values())
    : null;

  const payoffOrder: DebtPayoffProjection[] = ordered.map(d => {
    const m = payoffMonthById.get(d.id) ?? null;
    return {
      id: d.id,
      name: d.name,
      category: d.category,
      balance: d.balance,
      originalBalance: d.originalBalance,
      apr: d.apr,
      minimumPayment: d.minimumPayment,
      firstMonthPayment: firstMonthPaymentById.get(d.id) ?? d.minimumPayment,
      monthsToPayoff: m,
      projectedPayoffLabel: m !== null ? formatMonthOffsetLabel(m, baseDate) : 'Needs higher payment',
      dueDay: d.dueDay,
    };
  });

  return {
    strategy,
    totalDebt,
    totalStartingDebt,
    progressPercent,
    totalMinimums,
    extraMonthlyPayment: safeExtra,
    monthlyTotalPayment,
    totalInterest,
    monthsToPayoff: stalled ? null : maxMonth,
    debtFreeDateLabel:
      !stalled && maxMonth !== null
        ? formatMonthOffsetLabel(maxMonth, baseDate)
        : 'Increase monthly payment to amortize',
    stalled,
    firstTarget: payoffOrder[0] ?? null,
    payoffOrder,
  };
}
