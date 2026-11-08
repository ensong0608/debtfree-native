import * as SecureStore from 'expo-secure-store';
import { createDefaultOnboardingData, type UserOnboardingData } from '../onboarding-domain';
import type { RecurringBill } from '../finance/recurring-bills';
import { makeMoney } from '../finance/money';
import { seedLocalAcceptanceFinanceRecords } from '../finance-storage';

export const LOCAL_ACCEPTANCE_OWNER_ID = 'local-acceptance-owner-v1';
const LOCAL_ACCEPTANCE_KEY = 'debtfree-local-acceptance-v2.owner';

export function isLocalAcceptanceEnabled(): boolean {
  return __DEV__ && process.env.EXPO_PUBLIC_ENABLE_LOCAL_ACCEPTANCE === 'true';
}

export function isLocalAcceptanceOwner(userId: string): boolean {
  return isLocalAcceptanceEnabled() && userId === LOCAL_ACCEPTANCE_OWNER_ID;
}

function makeSyntheticFixture(): UserOnboardingData {
  const now = new Date().toISOString();
  const data = createDefaultOnboardingData(LOCAL_ACCEPTANCE_OWNER_ID);
  return {
    ...data,
    householdId: 'hh-local-acceptance-owner-v1',
    currentStage: 'home',
    signupCompleted: true,
    onboardingCompleted: true,
    goals: [],
    countryCode: 'US',
    currencyCode: 'USD',
    householdTimeZone: 'America/Los_Angeles',
    primaryIncomeAmount: 4800,
    primaryPayFrequency: 'monthly',
    primaryMonthlyIncome: 4800,
    additionalIncomes: [],
    debts: [
      { id: 'fixture-card-01', name: 'Synthetic card', category: 'Credit card', balance: 1600, originalBalance: 2000, apr: 19.9, minimumPayment: 55, dueDay: 12, creditLimit: 5000, createdAt: now, updatedAt: now },
      { id: 'fixture-auto-01', name: 'Synthetic auto loan', category: 'Auto loan', balance: 12400, originalBalance: 15000, apr: 5.4, minimumPayment: 385, dueDay: 18, creditLimit: null, createdAt: now, updatedAt: now },
    ],
    strategy: 'snowball',
    extraMonthlyPayment: 150,
    loanBillPairingByDebtId: {},
  };
}

function makeSyntheticBill(): RecurringBill {
  const now = new Date().toISOString();
  return {
    id: 'fixture-auto-bill-01',
    name: 'Synthetic vehicle payment',
    category: 'other_bill',
    amount: makeMoney('USD', 38500),
    dueDay: 18,
    paymentMethod: 'debit',
    autoPost: false,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Loads or creates the reserved synthetic owner. Never reads an auth session or prototype fixture. */
export async function loadLocalAcceptanceFixture(): Promise<UserOnboardingData> {
  if (!isLocalAcceptanceEnabled()) throw new Error('Local acceptance harness is disabled outside an opted-in development build.');
  const raw = await SecureStore.getItemAsync(LOCAL_ACCEPTANCE_KEY);
  if (raw) {
    const saved = JSON.parse(raw) as UserOnboardingData;
    if (saved.userId !== LOCAL_ACCEPTANCE_OWNER_ID || saved.householdId !== 'hh-local-acceptance-owner-v1') {
      throw new Error('Local acceptance fixture owner check failed; stored data was left untouched.');
    }
    return saved;
  }
  const fixture = makeSyntheticFixture();
  await seedLocalAcceptanceFinanceRecords({ userId: LOCAL_ACCEPTANCE_OWNER_ID, transactions: [], recurringBills: [makeSyntheticBill()], reconciliationAnchors: [] });
  await SecureStore.setItemAsync(LOCAL_ACCEPTANCE_KEY, JSON.stringify(fixture), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return fixture;
}

export async function saveLocalAcceptanceFixture(data: UserOnboardingData): Promise<UserOnboardingData> {
  if (!isLocalAcceptanceOwner(data.userId) || data.householdId !== 'hh-local-acceptance-owner-v1') {
    throw new Error('Local acceptance owner mismatch; no fixture settings were saved.');
  }
  const next = { ...data, updatedAt: new Date().toISOString() };
  await SecureStore.setItemAsync(LOCAL_ACCEPTANCE_KEY, JSON.stringify(next), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return next;
}
