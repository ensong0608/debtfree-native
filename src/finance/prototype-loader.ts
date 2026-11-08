// Pre-loaded prototype household dataset from prototype backup (version 6, 2026-11-06)
// Automatically generated from attached backup: debtfree-household-backup-2026-11-06.json

// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import type { UserOnboardingData, DebtItem } from '../onboarding-domain.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import type { LedgerTransaction, ReconciliationAnchor, TransactionCategory } from './ledger.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import type { RecurringBill, RecurringBillCategory, RecurringBillPaymentMethod } from './recurring-bills.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { makeMoney } from './money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { parseDateOnly } from './calendar.ts';


export const PROTOTYPE_DEBTS: readonly DebtItem[] = [
  {
    "id": "import-1785365723944-36-0.05328801057687482",
    "name": "Citi Costco",
    "category": "Credit card",
    "balance": 9836.57,
    "originalBalance": 10904.15,
    "apr": 22.99,
    "minimumPayment": 295.69,
    "dueDay": 28,
    "creditLimit": 35500,
    "createdAt": "2026-07-29T22:55:23.945Z",
    "updatedAt": "2026-07-29T22:55:23.945Z",
    "serverVersion": 1
  },
  {
    "id": "import-1785365723945-37-0.24615651721857368",
    "name": "Citi Card Double Cash",
    "category": "Credit card",
    "balance": 4200.1,
    "originalBalance": 4371.84,
    "apr": 21.74,
    "minimumPayment": 121.52,
    "dueDay": 1,
    "creditLimit": 20800,
    "createdAt": "2026-07-29T22:55:23.945Z",
    "updatedAt": "2026-07-29T22:55:23.945Z",
    "serverVersion": 1
  },
  {
    "id": "import-1785365723945-38-0.4221078021792871",
    "name": "Chase Freed",
    "category": "Credit card",
    "balance": 4618.93,
    "originalBalance": 5306.36,
    "apr": 21.24,
    "minimumPayment": 136.77,
    "dueDay": 27,
    "creditLimit": 30700,
    "createdAt": "2026-07-29T22:55:23.945Z",
    "updatedAt": "2026-07-29T22:55:23.945Z",
    "serverVersion": 1
  },
  {
    "id": "import-1785365723945-39-0.7714638280179676",
    "name": "Wells Fargo",
    "category": "Credit card",
    "balance": 4660.62,
    "originalBalance": 5102.44,
    "apr": 23.49,
    "minimumPayment": 143.76,
    "dueDay": 1,
    "creditLimit": 15000,
    "createdAt": "2026-07-29T22:55:23.945Z",
    "updatedAt": "2026-07-29T22:55:23.945Z",
    "serverVersion": 1
  },
  {
    "id": "import-1785365723945-40-0.4631453422839056",
    "name": "Booking",
    "category": "Credit card",
    "balance": 0,
    "originalBalance": 1973.87,
    "apr": 29.24,
    "minimumPayment": 67.84,
    "dueDay": 27,
    "creditLimit": 8650,
    "createdAt": "2026-07-29T22:55:23.945Z",
    "updatedAt": "2026-07-29T22:55:23.945Z",
    "serverVersion": 1
  },
  {
    "id": "import-1785365723945-41-0.3022637629802222",
    "name": "USBConnect",
    "category": "Credit card",
    "balance": 2050.57,
    "originalBalance": 1867.91,
    "apr": 0,
    "minimumPayment": 25,
    "dueDay": 22,
    "creditLimit": 6000,
    "createdAt": "2026-07-29T22:55:23.945Z",
    "updatedAt": "2026-07-29T22:55:23.945Z",
    "serverVersion": 1
  },
  {
    "id": "import-1785365723945-42-0.6215360066313965",
    "name": "Discover",
    "category": "Credit card",
    "balance": 3000,
    "originalBalance": 8186.62,
    "apr": 26.74,
    "minimumPayment": 96.85,
    "dueDay": 1,
    "creditLimit": 14800,
    "createdAt": "2026-07-29T22:55:23.945Z",
    "updatedAt": "2026-07-29T22:55:23.945Z",
    "serverVersion": 1
  },
  {
    "id": "import-1785365723945-43-0.5990263625744449",
    "name": "Citi1",
    "category": "Credit card",
    "balance": 0,
    "originalBalance": 4336.02,
    "apr": 27.49,
    "minimumPayment": 500,
    "dueDay": 8,
    "creditLimit": 12000,
    "createdAt": "2026-07-29T22:55:23.945Z",
    "updatedAt": "2026-07-29T22:55:23.945Z",
    "serverVersion": 1
  },
  {
    "id": "import-1785365723945-44-0.8725362454324684",
    "name": "Citi Cash",
    "category": "Credit card",
    "balance": 5285.56,
    "originalBalance": 5761.52,
    "apr": 25.74,
    "minimumPayment": 173.6,
    "dueDay": 2,
    "creditLimit": 16500,
    "createdAt": "2026-07-29T22:55:23.946Z",
    "updatedAt": "2026-07-29T22:55:23.946Z",
    "serverVersion": 1
  },
  {
    "id": "import-1785365723946-45-0.6813676636311186",
    "name": "PenFed",
    "category": "Credit card",
    "balance": 4008.52,
    "originalBalance": 4128.02,
    "apr": 17.99,
    "minimumPayment": 103.93,
    "dueDay": 17,
    "creditLimit": 7500,
    "createdAt": "2026-07-29T22:55:23.946Z",
    "updatedAt": "2026-07-29T22:55:23.946Z",
    "serverVersion": 1
  },
  {
    "id": "import-1785365723946-46-0.4012598057415113",
    "name": "Chase Freedom-Bodin",
    "category": "Credit card",
    "balance": 0,
    "originalBalance": 1225.85,
    "apr": 20.99,
    "minimumPayment": 300,
    "dueDay": 28,
    "creditLimit": 2000,
    "createdAt": "2026-07-29T22:55:23.946Z",
    "updatedAt": "2026-07-29T22:55:23.946Z",
    "serverVersion": 1
  },
  {
    "id": "import-1785365723946-47-0.42258261186803714",
    "name": "Chase Prime",
    "category": "Credit card",
    "balance": 6888.92,
    "originalBalance": 7039.75,
    "apr": 23.49,
    "minimumPayment": 206.97,
    "dueDay": 2,
    "creditLimit": 18000,
    "createdAt": "2026-07-29T22:55:23.946Z",
    "updatedAt": "2026-07-29T22:55:23.946Z",
    "serverVersion": 1
  },
  {
    "id": "import-1785365723946-48-0.8043749052016425",
    "name": "1Key",
    "category": "Credit card",
    "balance": 0,
    "originalBalance": 401.42,
    "apr": 29.26,
    "minimumPayment": 25,
    "dueDay": 13,
    "creditLimit": 6000,
    "createdAt": "2026-07-29T22:55:23.946Z",
    "updatedAt": "2026-07-29T22:55:23.946Z",
    "serverVersion": 1
  },
  {
    "id": "4a340d15-f376-4486-a2c0-859dc5a98e4a",
    "name": "House",
    "category": "Mortgage",
    "balance": 312700.58,
    "originalBalance": 349200,
    "apr": 3.625,
    "minimumPayment": 2210.9,
    "dueDay": 1,
    "creditLimit": null,
    "createdAt": "2026-07-29T22:55:23.945Z",
    "updatedAt": "2026-11-02T17:45:38.182Z",
    "serverVersion": 1
  },
  {
    "id": "c639c62d-6add-4a66-bfba-535c302b3d15",
    "name": "Honda HR-V",
    "category": "Auto loan",
    "balance": 19751.94,
    "originalBalance": 40304.38,
    "apr": 5.85,
    "minimumPayment": 587.3,
    "dueDay": 20,
    "creditLimit": null,
    "createdAt": "2026-07-29T22:55:23.945Z",
    "updatedAt": "2026-11-02T17:45:38.182Z",
    "serverVersion": 1
  }
] as const;

export const PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA: UserOnboardingData = {
  version: 1,
  userId: 'test-user-preview',
  householdId: 'hh-papi-mama',
  currentStage: 'home',
  signupCompleted: true,
  onboardingCompleted: true,
  goals: ['Pay down my credit card debt', 'Track recurring bills', 'Become debt-free'],
  referralSource: 'AI assistant (ChatGPT, Gemini, etc.)',
  consideredBeforeAi: null,
  countryCode: 'US',
  currencyCode: 'USD',
  managesWithPartner: true,
  worksWithProfessional: false,
  primaryIncomeAmount: 3700,
  primaryPayFrequency: 'monthly',
  primaryMonthlyIncome: 3700,
  additionalIncomes: [
    {
      id: 'inc-mama',
      name: 'Mama',
      amount: 4100,
      frequency: 'monthly',
      monthlyAmount: 4100,
    },
  ],
  selectedPlan: 'premium',
  homeStatus: 'Own',
  vehicleStatus: 'Finance',
  debts: [...PROTOTYPE_DEBTS],
  strategy: 'avalanche',
  extraMonthlyPayment: 3000,
  notifications: {
    upcomingReminders: true,
    overdueAlerts: true,
    milestonesAndProgress: true,
    permissionRequested: true,
    osPermissionStatus: 'granted',
  },
  completedAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-06T18:15:21.243Z',
};

const RAW_RECURRING_BILLS = [
  {
    "id": "rb-recurring_2026-11_1789594774948-2-0_26582255922921816",
    "name": "House",
    "category": "housing",
    "amount": 221090,
    "dueDay": 1,
    "paymentMethod": "debit",
    "autoPost": false,
    "active": true,
    "createdAt": "2026-11-02T01:14:55.154Z"
  },
  {
    "id": "rb-recurring_2026-11_1789594774948-3-0_9625455718492124",
    "name": "HOA",
    "category": "housing",
    "amount": 16300,
    "dueDay": 1,
    "paymentMethod": "debit",
    "autoPost": false,
    "active": true,
    "createdAt": "2026-11-02T01:14:55.154Z"
  },
  {
    "id": "rb-recurring_2026-11_1789594774948-4-0_6493149265052414",
    "name": "Ameritas",
    "category": "insurance",
    "amount": 17980,
    "dueDay": 19,
    "paymentMethod": "debit",
    "autoPost": false,
    "active": true,
    "createdAt": "2026-11-02T01:14:55.154Z"
  },
  {
    "id": "rb-recurring_2026-11_1789594774948-5-0_014870677081699757",
    "name": "Honda HRV",
    "category": "other_bill",
    "amount": 58730,
    "dueDay": 28,
    "paymentMethod": "debit",
    "autoPost": false,
    "active": true,
    "createdAt": "2026-11-02T01:14:55.154Z"
  },
  {
    "id": "rb-recurring_2026-11_1789594774948-6-0_00249590620590856",
    "name": "OpenAI GPT",
    "category": "subscription",
    "amount": 2000,
    "dueDay": 13,
    "paymentMethod": "credit",
    "creditAccountId": "import-1785365723945-41-0.3022637629802222",
    "autoPost": true,
    "active": true,
    "createdAt": "2026-11-02T01:14:55.154Z"
  },
  {
    "id": "rb-recurring_2026-11_1789594774948-7-0_7059224840408725",
    "name": "Torbox",
    "category": "subscription",
    "amount": 300,
    "dueDay": 20,
    "paymentMethod": "credit",
    "creditAccountId": "import-1785365723945-37-0.24615651721857368",
    "autoPost": false,
    "active": true,
    "createdAt": "2026-11-02T01:14:55.154Z"
  },
  {
    "id": "rb-recurring_2026-11_1789594774948-8-0_8836366419971207",
    "name": "Phone",
    "category": "subscription",
    "amount": 13973,
    "dueDay": 9,
    "paymentMethod": "credit",
    "creditAccountId": "import-1785365723945-41-0.3022637629802222",
    "autoPost": false,
    "active": true,
    "createdAt": "2026-11-02T01:14:55.154Z"
  },
  {
    "id": "rb-recurring_2026-11_1791047843637-0_4023147987421465",
    "name": "Netflix",
    "category": "subscription",
    "amount": 2699,
    "dueDay": 5,
    "paymentMethod": "credit",
    "creditAccountId": "import-1785365723945-41-0.3022637629802222",
    "autoPost": false,
    "active": true,
    "createdAt": "2026-11-02T01:14:55.154Z"
  }
] as const;

export const PROTOTYPE_RECURRING_BILLS: RecurringBill[] = (RAW_RECURRING_BILLS as readonly any[]).map(b => ({
  id: b.id,
  name: b.name,
  category: b.category as RecurringBillCategory,
  amount: makeMoney('USD', b.amount),
  dueDay: b.dueDay,
  paymentMethod: b.paymentMethod as RecurringBillPaymentMethod,
  creditAccountId: b.creditAccountId || undefined,
  autoPost: b.autoPost,
  active: b.active,
  createdAt: b.createdAt,
}));

const RAW_TRANSACTIONS = [
  {
    "id": "bill:rb_recurring_2026_11_1789594774948_3_0_9625455718492124:2026-11-01",
    "accountId": null,
    "date": "2026-11-01",
    "appliesToDate": "2026-11-01",
    "amount": 16300,
    "category": "debit_bill",
    "payee": "HOA",
    "memo": "Payment for 2026-11-01 [bill:rb_recurring_2026_11_1789594774948_3_0_9625455718492124]",
    "source": "recurring_bill",
    "reconciled": true,
    "createdAt": "2026-11-01T00:00:00.000Z",
    "deletedAt": null
  },
  {
    "id": "bill:rb_recurring_2026_11_1789594774948_2_0_26582255922921816:2026-11-01",
    "accountId": null,
    "date": "2026-11-01",
    "appliesToDate": "2026-11-01",
    "amount": 221090,
    "category": "debit_bill",
    "payee": "House",
    "memo": "Payment for 2026-11-01 [bill:rb_recurring_2026_11_1789594774948_2_0_26582255922921816]",
    "source": "recurring_bill",
    "reconciled": true,
    "createdAt": "2026-11-01T00:00:00.000Z",
    "deletedAt": null
  },
  {
    "id": "transaction-1786493223896-0.03056199227768508",
    "accountId": "import-1785365723944-36-0.05328801057687482",
    "date": "2026-08-05",
    "amount": 32500,
    "category": "payment",
    "payee": "Citi - Costco",
    "memo": "Recommended Min payment",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-08-12T00:07:03.896Z",
    "deletedAt": null
  },
  {
    "id": "transaction-1786493259442-0.7118182303943417",
    "accountId": "import-1785365723945-37-0.24615651721857368",
    "date": "2026-08-06",
    "amount": 11100,
    "category": "payment",
    "payee": "Citi - Double Cash",
    "memo": "Recommended Min payment",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-08-12T00:07:39.442Z",
    "deletedAt": null
  },
  {
    "id": "transaction-1786493547874-0-0.17479488981951896",
    "accountId": "import-1785365723945-38-0.4221078021792871",
    "date": "2026-08-11",
    "amount": 5254,
    "category": "payment",
    "payee": "Chase - Freedom",
    "memo": "Recommended Minimum Payment",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-08-12T00:12:27.874Z",
    "deletedAt": null
  },
  {
    "id": "transaction-1786493547874-1-0.16550119256403484",
    "accountId": "import-1785365723945-39-0.7714638280179676",
    "date": "2026-08-11",
    "amount": 14200,
    "category": "payment",
    "payee": "Wells Fargo",
    "memo": "Recommended Minimum Payment",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-08-12T00:12:27.874Z",
    "deletedAt": null
  },
  {
    "id": "transaction-1786493547874-3-0.7390563394761137",
    "accountId": "import-1785365723945-41-0.3022637629802222",
    "date": "2026-08-11",
    "amount": 125861,
    "category": "payment",
    "payee": "USBConnect",
    "memo": "???? not sure about this",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-08-12T00:12:27.874Z",
    "deletedAt": null
  },
  {
    "id": "transaction-1786493547877-4-0.5598496068776426",
    "accountId": "import-1785365723945-42-0.6215360066313965",
    "date": "2026-08-11",
    "amount": 4362,
    "category": "payment",
    "payee": "Discover",
    "memo": "Recommended Minimum Payment",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-08-12T00:12:27.874Z",
    "deletedAt": null
  },
  {
    "id": "transaction-1786493547877-5-0.007517232361591297",
    "accountId": "import-1785365723945-44-0.8725362454324684",
    "date": "2026-08-11",
    "amount": 17336,
    "category": "payment",
    "payee": "Citi - Cash",
    "memo": "Minimum PYMT",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-08-12T00:12:27.874Z",
    "deletedAt": null
  },
  {
    "id": "transaction-1786493547877-6-0.8058451995103209",
    "accountId": "import-1785365723946-46-0.4012598057415113",
    "date": "2026-08-11",
    "amount": 22585,
    "category": "payment",
    "payee": "Chase Freedom-Bodin",
    "memo": "Minimum PYMT",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-08-12T00:12:27.874Z",
    "deletedAt": null
  },
  {
    "id": "transaction-1786493547877-7-0.2665773174089905",
    "accountId": "import-1785365723946-47-0.42258261186803714",
    "date": "2026-08-11",
    "amount": 1503,
    "category": "payment",
    "payee": "Chase Prime",
    "memo": "Minimum PYMT",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-08-12T00:12:27.874Z",
    "deletedAt": null
  },
  {
    "id": "3225e7ad-1eeb-47e6-bf03-fdb6b5aa10ea",
    "accountId": "import-1785365723945-40-0.4631453422839056",
    "date": "2026-08-12",
    "amount": 110000,
    "category": "payment",
    "payee": "Booking",
    "memo": "",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-08-12T23:22:00.802Z",
    "deletedAt": null
  },
  {
    "id": "bdeea6e6-14cf-466f-815e-8621745e31f3",
    "accountId": "import-1785365723946-48-0.8043749052016425",
    "date": "2026-08-22",
    "amount": 40142,
    "category": "payment",
    "payee": "1Key",
    "memo": "Marked paid off from Debts",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-08-23T01:38:38.417Z",
    "deletedAt": null
  },
  {
    "id": "25580c21-444b-481a-baca-866d73442b56",
    "accountId": "import-1785365723945-40-0.4631453422839056",
    "date": "2026-08-22",
    "amount": 87387,
    "category": "payment",
    "payee": "Booking",
    "memo": "Marked paid off from Debts",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-08-23T01:38:54.999Z",
    "deletedAt": null
  },
  {
    "id": "9201f0b0-a1bc-4b42-9077-402597ba775a",
    "accountId": "import-1785365723944-36-0.05328801057687482",
    "date": "2026-09-13",
    "amount": 19156,
    "category": "payment",
    "payee": "Citi Costco",
    "memo": "Sept pymt",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-09-14T03:12:42.388Z",
    "deletedAt": null
  },
  {
    "id": "b69a4694-5df4-4588-9a5e-ef25a29bce36",
    "accountId": "import-1785365723945-43-0.5990263625744449",
    "date": "2026-09-13",
    "amount": 175154,
    "category": "payment",
    "payee": "Citi1",
    "memo": "Recommended payoff payment",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-09-14T03:16:35.000Z",
    "deletedAt": null
  },
  {
    "id": "3136c5b8-9803-417e-afc3-1d4baffa1352",
    "accountId": "import-1785365723946-46-0.4012598057415113",
    "date": "2026-09-19",
    "amount": 100000,
    "category": "payment",
    "payee": "Chase Freedom-Bodin",
    "memo": "Recommended payoff payment",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-09-19T17:24:45.689Z",
    "deletedAt": null
  },
  {
    "id": "0e6e4c0e-db29-4203-b9fa-1d22d33d4ff1",
    "accountId": "import-1785365723945-44-0.8725362454324684",
    "date": "2026-09-19",
    "amount": 4244,
    "category": "payment",
    "payee": "Citi Cash",
    "memo": "Recommended payoff payment",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-09-19T17:26:51.873Z",
    "deletedAt": null
  },
  {
    "id": "61631369-6035-42a7-8965-427ac2cc905a",
    "accountId": "import-1785365723945-43-0.5990263625744449",
    "date": "2026-09-19",
    "amount": 108448,
    "category": "payment",
    "payee": "Citi1",
    "memo": "Recommended payoff payment",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-09-19T17:30:10.125Z",
    "deletedAt": null
  },
  {
    "id": "6503acf6-02cd-4ae7-806b-92f96a020cc7",
    "accountId": "import-1785365723945-43-0.5990263625744449",
    "date": "2026-09-29",
    "amount": 150000,
    "category": "payment",
    "payee": "Citi1",
    "memo": "Marked paid off from Debts",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-09-30T03:55:02.431Z",
    "deletedAt": null
  },
  {
    "id": "b82aa20c-e3de-4927-b788-48f5aa2fc46e",
    "accountId": "import-1785365723945-42-0.6215360066313965",
    "date": "2026-10-03",
    "amount": 200000,
    "category": "payment",
    "payee": "Discover",
    "memo": "",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-10-03T16:36:16.766Z",
    "deletedAt": null
  },
  {
    "id": "381e3d71-a789-4932-a2f8-bc96540868ab",
    "accountId": "import-1785365723945-38-0.4221078021792871",
    "date": "2026-10-03",
    "amount": 40000,
    "category": "payment",
    "payee": "Chase Freed",
    "memo": "",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-10-03T16:45:01.321Z",
    "deletedAt": null
  },
  {
    "id": "a5170ad0-375e-4eb3-864f-6993bb525a35",
    "accountId": "import-1785365723944-36-0.05328801057687482",
    "date": "2026-10-03",
    "amount": 50000,
    "category": "payment",
    "payee": "Citi Costco",
    "memo": "",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-10-03T16:53:55.698Z",
    "deletedAt": null
  },
  {
    "id": "21a8fb96-6cdb-4fa2-aeef-27cbc0df1153",
    "accountId": "import-1785365723945-37-0.24615651721857368",
    "date": "2026-10-05",
    "amount": 8268,
    "category": "purchase",
    "payee": "Citi Card Double Cash - Papi",
    "memo": "",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-10-08T17:02:49.316Z",
    "deletedAt": null
  },
  {
    "id": "a214f983-2d9f-439c-bb7c-bfcd98d30324",
    "accountId": "import-1785365723945-41-0.3022637629802222",
    "date": "2026-10-20",
    "amount": 30000,
    "category": "payment",
    "payee": "USBConnect",
    "memo": "",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-10-30T04:33:43.230Z",
    "deletedAt": null
  },
  {
    "id": "6c1c3b34-64d4-4e0f-b2fc-bdb105d5821d",
    "accountId": "import-1785365723945-44-0.8725362454324684",
    "date": "2026-10-21",
    "amount": 35000,
    "category": "payment",
    "payee": "Citi Cash",
    "memo": "",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-10-30T04:39:10.089Z",
    "deletedAt": null
  },
  {
    "id": "ff28ddcd-61b2-4471-b64b-f7fb46ba9407",
    "accountId": "import-1785365723946-45-0.6813676636311186",
    "date": "2026-10-16",
    "amount": 15000,
    "category": "payment",
    "payee": "PenFed",
    "memo": "",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-10-30T04:40:21.515Z",
    "deletedAt": null
  },
  {
    "id": "11c3f752-407b-4448-adea-e164d2181b88",
    "accountId": "import-1785365723945-42-0.6215360066313965",
    "date": "2026-10-30",
    "appliesToDate": "2026-11-01",
    "amount": 182122,
    "category": "payment",
    "payee": "Discover",
    "memo": "",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-10-30T17:52:51.214Z",
    "deletedAt": null
  },
  {
    "id": "dd21cb19-f930-484f-911b-a49b3e59af8a",
    "accountId": "import-1785365723945-41-0.3022637629802222",
    "date": "2026-10-30",
    "amount": 1082,
    "category": "purchase",
    "payee": "USBConnect",
    "memo": "Conoco",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-10-31T16:54:26.276Z",
    "deletedAt": null
  },
  {
    "id": "43c18739-ee36-4c42-930a-099ff57d4a7c",
    "accountId": "import-1785365723945-37-0.24615651721857368",
    "date": "2026-10-05",
    "amount": 15000,
    "category": "payment",
    "payee": "Citi Card Double Cash",
    "memo": "",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-10-31T17:17:37.892Z",
    "deletedAt": null
  },
  {
    "id": "9dac1d4c-ce7b-4ccc-8751-b732c56226bf",
    "accountId": "import-1785365723945-37-0.24615651721857368",
    "date": "2026-09-17",
    "amount": 1052,
    "category": "payment",
    "payee": "Citi Card Double Cash",
    "memo": "",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-10-31T17:26:39.346Z",
    "deletedAt": null
  },
  {
    "id": "638241e4-7495-4f4c-bd2f-81c044f02d27",
    "accountId": "import-1785365723946-47-0.42258261186803714",
    "date": "2026-09-21",
    "amount": 20697,
    "category": "payment",
    "payee": "Chase Prime",
    "memo": "",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-10-31T17:27:56.389Z",
    "deletedAt": null
  },
  {
    "id": "677ac12f-8477-4d6a-bd2c-1a6cfc0b9459",
    "accountId": "import-1785365723945-44-0.8725362454324684",
    "date": "2026-09-18",
    "amount": 17360,
    "category": "payment",
    "payee": "Citi Cash",
    "memo": "",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-10-31T17:28:04.393Z",
    "deletedAt": null
  },
  {
    "id": "02e5c0bf-a2fe-4932-86ae-15698c89230b",
    "accountId": "import-1785365723945-39-0.7714638280179676",
    "date": "2026-09-30",
    "amount": 14376,
    "category": "payment",
    "payee": "Wells Fargo",
    "memo": "",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-10-31T18:11:31.766Z",
    "deletedAt": null
  },
  {
    "id": "049f621a-c9db-4bf3-ba58-348910412fda",
    "accountId": "import-1785365723945-41-0.3022637629802222",
    "date": "2026-10-31",
    "amount": 11500,
    "category": "purchase",
    "payee": "USBConnect",
    "memo": "Juan's Flaming Fajitas",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-10-31T20:26:37.154Z",
    "deletedAt": null
  },
  {
    "id": "128ca525-5deb-4a22-af50-66e2d1669c4f",
    "accountId": "import-1785365723946-45-0.6813676636311186",
    "date": "2026-11-02",
    "appliesToDate": "2026-11-17",
    "amount": 15000,
    "category": "payment",
    "payee": "PenFed",
    "memo": "For 11/17 due",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-11-02T16:47:55.540Z",
    "deletedAt": null
  },
  {
    "id": "89ec0770-a44b-4539-b0af-216db9a1b2b2",
    "accountId": "import-1785365723945-41-0.3022637629802222",
    "date": "2026-11-02",
    "appliesToDate": "2026-11-22",
    "amount": 38000,
    "category": "payment",
    "payee": "USBConnect",
    "memo": "For 11/22 due",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-11-02T16:54:33.087Z",
    "deletedAt": null
  },
  {
    "id": "5021115a-f56e-40cc-bef1-dfbd8e8d7cac",
    "accountId": "import-1785365723945-39-0.7714638280179676",
    "date": "2026-10-21",
    "appliesToDate": "2026-11-01",
    "amount": 20000,
    "category": "payment",
    "payee": "Wells Fargo",
    "memo": "",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-11-02T20:20:17.991Z",
    "deletedAt": null
  },
  {
    "id": "272bfcab-329c-44eb-b1e5-ada2ef76b4d0",
    "accountId": "import-1785365723946-47-0.42258261186803714",
    "date": "2026-10-25",
    "amount": 25000,
    "category": "payment",
    "payee": "Chase Prime",
    "memo": "",
    "source": "manual",
    "reconciled": true,
    "createdAt": "2026-11-02T20:23:10.587Z",
    "deletedAt": null
  },
  {
    "id": "7e49cde7-d919-423a-8448-33fa6455a83f",
    "accountId": "import-1785365723945-41-0.3022637629802222",
    "date": "2026-11-02",
    "amount": 1341,
    "category": "purchase",
    "payee": "USBConnect",
    "memo": "PosterPhoto-LL",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-11-02T20:46:24.884Z",
    "deletedAt": null
  },
  {
    "id": "1f4f9d28-9ef4-415a-aec8-85b217fb5150",
    "accountId": "import-1785365723945-41-0.3022637629802222",
    "date": "2026-11-02",
    "amount": 493,
    "category": "purchase",
    "payee": "USBConnect",
    "memo": "Gemini",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-11-03T18:02:32.358Z",
    "deletedAt": null
  },
  {
    "id": "61f5e4ea-441a-4155-9978-52a48daef3c2",
    "accountId": "import-1785365723945-38-0.4221078021792871",
    "date": "2026-11-03",
    "appliesToDate": "2026-11-27",
    "amount": 40000,
    "category": "payment",
    "payee": "Chase Freed",
    "memo": "For 11/27 due",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-11-03T19:40:47.904Z",
    "deletedAt": null
  },
  {
    "id": "0eef8227-5a5e-452b-84bc-cb7d9e95516e",
    "accountId": "import-1785365723944-36-0.05328801057687482",
    "date": "2026-11-03",
    "amount": 19597,
    "category": "interest",
    "payee": "Citi Costco",
    "memo": "",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-11-04T17:38:56.176Z",
    "deletedAt": null
  },
  {
    "id": "e9c63092-08b7-4440-bf28-ccf8e046417f",
    "accountId": "import-1785365723944-36-0.05328801057687482",
    "date": "2026-11-04",
    "appliesToDate": "2026-11-28",
    "amount": 50000,
    "category": "payment",
    "payee": "Citi Costco",
    "memo": "For 11/28 due",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-11-04T17:39:36.690Z",
    "deletedAt": null
  },
  {
    "id": "20a3c2bc-6b14-4ee5-b941-f6cf370d2347",
    "accountId": "import-1785365723945-41-0.3022637629802222",
    "date": "2026-11-05",
    "appliesToDate": "2026-11-05",
    "amount": 2699,
    "category": "purchase",
    "payee": "USBConnect",
    "memo": "Netflix subscription [bill:rb_recurring_2026_11_1791047843637_0_4023147987421465]",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-11-05T08:30:00.086Z",
    "deletedAt": null
  },
  {
    "id": "228e9539-4338-4af3-93c0-ef88ae33b965",
    "accountId": "import-1785365723945-37-0.24615651721857368",
    "date": "2026-11-05",
    "amount": 7787,
    "category": "fee",
    "payee": "Citi Card Double Cash",
    "memo": "Actual interest",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-11-05T18:52:11.671Z",
    "deletedAt": null
  },
  {
    "id": "552763f2-97f1-4c3b-9e82-0355e063f23e",
    "accountId": "import-1785365723945-37-0.24615651721857368",
    "date": "2026-11-05",
    "appliesToDate": "2026-11-01",
    "amount": 20000,
    "category": "payment",
    "payee": "Citi Card Double Cash",
    "memo": "For 12/1 due",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-11-05T19:00:23.419Z",
    "deletedAt": null
  },
  {
    "id": "5454a776-8c21-4eb3-a10a-f240124023c7",
    "accountId": "import-1785365723946-47-0.42258261186803714",
    "date": "2026-11-05",
    "amount": 14056,
    "category": "interest",
    "payee": "Chase Prime",
    "memo": "",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-11-06T17:58:50.217Z",
    "deletedAt": null
  },
  {
    "id": "514bbb2a-36b2-4d47-96ca-430bab784792",
    "accountId": "import-1785365723946-47-0.42258261186803714",
    "date": "2026-11-06",
    "appliesToDate": "2026-11-02",
    "amount": 25000,
    "category": "payment",
    "payee": "Chase Prime",
    "memo": "For 12/2 due",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-11-06T18:00:43.158Z",
    "deletedAt": null
  },
  {
    "id": "7ded8824-64c4-46c4-bb23-041e2846116b",
    "accountId": "import-1785365723945-44-0.8725362454324684",
    "date": "2026-11-05",
    "amount": 11573,
    "category": "interest",
    "payee": "Citi Cash",
    "memo": "",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-11-06T18:12:49.500Z",
    "deletedAt": null
  },
  {
    "id": "b26ca7d4-039b-4947-ae5d-029d307a0867",
    "accountId": "import-1785365723945-44-0.8725362454324684",
    "date": "2026-11-06",
    "appliesToDate": "2026-11-02",
    "amount": 35000,
    "category": "payment",
    "payee": "Citi Cash",
    "memo": "For 12/2 due",
    "source": "manual",
    "reconciled": false,
    "createdAt": "2026-11-06T18:15:21.088Z",
    "deletedAt": null
  }
] as const;

export const PROTOTYPE_TRANSACTIONS: LedgerTransaction[] = RAW_TRANSACTIONS.map(t => ({
  id: t.id,
  accountId: t.accountId,
  date: parseDateOnly(t.date),
  amount: makeMoney('USD', t.amount),
  category: t.category as TransactionCategory,
  payee: t.payee,
  memo: t.memo,
  source: 'manual',
  reconciled: t.reconciled,
  createdAt: t.createdAt,
  deletedAt: null,
}));

const RAW_RECONCILIATION_ANCHORS = [
  {
    "id": "a5b37413-0ea1-43e3-b0ae-ac07c811cb94",
    "accountId": "import-1785365723944-36-0.05328801057687482",
    "asOfDate": "2026-10-19",
    "verifiedBalance": 1014060,
    "createdAt": "2026-10-20T04:06:49.017Z",
    "coveredTransactionIds": [
      "transaction-1785631110322-0.3322924716647314",
      "transaction-1786493223896-0.03056199227768508",
      "9201f0b0-a1bc-4b42-9077-402597ba775a",
      "a5170ad0-375e-4eb3-864f-6993bb525a35"
    ]
  },
  {
    "id": "bedfa7cf-f41b-482e-a92b-ff793154377b",
    "accountId": "import-1785365723945-37-0.24615651721857368",
    "asOfDate": "2026-11-05",
    "verifiedBalance": 440010,
    "createdAt": "2026-11-05T18:51:05.761Z",
    "coveredTransactionIds": [
      "transaction-1785631280542-0.5871404601448764",
      "transaction-1785631487667-0.5788577779737428",
      "transaction-1786493259442-0.7118182303943417",
      "21a8fb96-6cdb-4fa2-aeef-27cbc0df1153",
      "aa21426b-364b-4692-9482-0aa1f673e544",
      "43c18739-ee36-4c42-930a-099ff57d4a7c",
      "a0565cde-674b-435c-8b73-ffc04afd9900",
      "5bda352d-9c91-430c-9afb-3b3ec922c6f7",
      "ea3b7186-c4dd-4352-b04f-9e5e0aa6e799",
      "044f9af7-d7ff-4bdf-95d0-a02ed543805b",
      "e66a3b2c-8926-4288-9213-79c750a9a647",
      "9dac1d4c-ce7b-4ccc-8751-b732c56226bf"
    ]
  },
  {
    "id": "779ea2f4-fba4-441a-b76f-d5753fe37e74",
    "accountId": "import-1785365723945-38-0.4221078021792871",
    "asOfDate": "2026-11-02",
    "verifiedBalance": 501893,
    "createdAt": "2026-11-03T19:38:40.412Z",
    "coveredTransactionIds": [
      "transaction-1786493547874-0-0.17479488981951896",
      "381e3d71-a789-4932-a2f8-bc96540868ab"
    ]
  },
  {
    "id": "2dba6088-878e-46cc-8874-d3e0f103d305",
    "accountId": "import-1785365723945-39-0.7714638280179676",
    "asOfDate": "2026-10-31",
    "verifiedBalance": 486062,
    "createdAt": "2026-11-02T20:56:44.832Z",
    "coveredTransactionIds": [
      "transaction-1786493547874-1-0.16550119256403484",
      "ec9c3aac-bf33-4c33-93de-24858d750a4c",
      "b30cbb59-45e4-4ef3-a035-6e1c8d1d33e1",
      "fc8cd737-5a1f-4687-aba6-493b1bef920d",
      "fa155936-6277-4085-8308-590c6bba7868",
      "02e5c0bf-a2fe-4932-86ae-15698c89230b",
      "5021115a-f56e-40cc-bef1-dfbd8e8d7cac"
    ]
  },
  {
    "id": "f7d4e8ac-29b1-4e43-a4d6-8429f7cfc4f3",
    "accountId": "import-1785365723945-41-0.3022637629802222",
    "asOfDate": "2026-10-24",
    "verifiedBalance": 225942,
    "createdAt": "2026-10-24T22:05:12.726Z",
    "coveredTransactionIds": [
      "transaction-1786493547874-3-0.7390563394761137"
    ]
  },
  {
    "id": "378b7b91-f532-457f-ac20-c45e9c6527d9",
    "accountId": "import-1785365723945-42-0.6215360066313965",
    "asOfDate": "2026-10-16",
    "verifiedBalance": 482122,
    "createdAt": "2026-10-16T20:18:27.370Z",
    "coveredTransactionIds": [
      "transaction-1786493547877-4-0.5598496068776426",
      "b82aa20c-e3de-4927-b788-48f5aa2fc46e",
      "2ecd7a9e-db1b-459b-ae7a-23859dc98ea1"
    ]
  },
  {
    "id": "d17b9e1d-f539-4d7a-adb9-11fda7489e44",
    "accountId": "import-1785365723945-44-0.8725362454324684",
    "asOfDate": "2026-10-26",
    "verifiedBalance": 551983,
    "createdAt": "2026-10-27T03:11:18.891Z",
    "coveredTransactionIds": [
      "transaction-1786493547877-5-0.007517232361591297",
      "0e6e4c0e-db29-4203-b9fa-1d22d33d4ff1"
    ]
  },
  {
    "id": "01d1c780-66a9-4738-a55b-96cd004a15a2",
    "accountId": "import-1785365723946-45-0.6813676636311186",
    "asOfDate": "2026-10-22",
    "verifiedBalance": 415852,
    "createdAt": "2026-10-23T03:34:22.925Z",
    "coveredTransactionIds": []
  },
  {
    "id": "0a5689b1-6206-48aa-8d60-910bf16ea1ce",
    "accountId": "import-1785365723946-47-0.42258261186803714",
    "asOfDate": "2026-11-02",
    "verifiedBalance": 699836,
    "createdAt": "2026-11-02T20:23:56.931Z",
    "coveredTransactionIds": [
      "transaction-1786493547877-7-0.2665773174089905",
      "923fe4dd-6710-496a-af90-c48b626ec6a1",
      "638241e4-7495-4f4c-bd2f-81c044f02d27",
      "272bfcab-329c-44eb-b1e5-ada2ef76b4d0"
    ]
  }
] as const;

export const PROTOTYPE_RECONCILIATION_ANCHORS: ReconciliationAnchor[] = RAW_RECONCILIATION_ANCHORS.map(a => ({
  id: a.id,
  accountId: a.accountId,
  asOfDate: parseDateOnly(a.asOfDate),
  verifiedBalance: makeMoney('USD', a.verifiedBalance),
  createdAt: a.createdAt,
  coveredTransactionIds: a.coveredTransactionIds,
}));

/** Convert an uploaded prototype backup JSON into native data structures. */
export function convertPrototypeBackup(
  rawBackup: unknown,
  targetUserId = 'test-user-preview',
): {
  onboardingData: UserOnboardingData;
  recurringBills: RecurringBill[];
  transactions: LedgerTransaction[];
  reconciliationAnchors: ReconciliationAnchor[];
} {
  const root = rawBackup as Record<string, unknown>;
  const payload = (root.payload ?? root) as Record<string, unknown>;
  if (!payload || !Array.isArray(payload.accounts)) {
    throw new Error('Invalid prototype backup: expected payload with accounts array.');
  }

  const rawAccounts = payload.accounts as Record<string, unknown>[];
  const rawTxList = Array.isArray(payload.transactions)
    ? (payload.transactions as Record<string, unknown>[]).filter(t => !t.deletedAt)
    : [];

  const convertedDebts: DebtItem[] = [];
  rawAccounts.forEach(a => {
    const accountId = String(a.id);
    const txs = rawTxList.filter(t => t.accountId === accountId);
    const latestTxWithBalance = [...txs].reverse().find(t => typeof t.balanceAfter === 'number');
    const currentBalance = latestTxWithBalance && typeof latestTxWithBalance.balanceAfter === 'number'
      ? latestTxWithBalance.balanceAfter
      : Number(a.balance ?? 0);
    const dueDay = a.dueDate && typeof a.dueDate === 'string'
      ? parseInt(a.dueDate.split('-')[2] || '1', 10)
      : 1;
    const minCycles = Array.isArray(a.minimumCycles) ? a.minimumCycles : [];
    const latestCycle = minCycles[minCycles.length - 1] as Record<string, unknown> | undefined;
    const minPayment = (accountId.includes('42-') && latestCycle && typeof latestCycle.amount === 'number')
      ? latestCycle.amount
      : Number(a.minimum ?? 25);

    convertedDebts.push({
      id: accountId,
      name: String(a.name ?? 'Account'),
      category: a.type === 'Credit card' ? 'Credit card' : 'Other loan',
      balance: Math.round(currentBalance * 100) / 100,
      originalBalance: a.baselineBalance ? Math.round(Number(a.baselineBalance) * 100) / 100 : null,
      apr: Number(a.apr ?? 0),
      minimumPayment: Math.round(minPayment * 100) / 100,
      dueDay: Number.isFinite(dueDay) && dueDay >= 1 && dueDay <= 31 ? dueDay : 1,
      creditLimit: a.creditLimit ? Math.round(Number(a.creditLimit) * 100) / 100 : null,
      createdAt: typeof a.createdAt === 'string' ? a.createdAt : new Date().toISOString(),
      updatedAt: typeof a.createdAt === 'string' ? a.createdAt : new Date().toISOString(),
      serverVersion: 1,
    });
  });

  const monthlyPlan = payload.monthlyPlan as Record<string, unknown> | undefined;
  if (monthlyPlan && Array.isArray(monthlyPlan.loanTrackers)) {
    monthlyPlan.loanTrackers.forEach((l: Record<string, unknown>) => {
      const dueDay = l.dueDate && typeof l.dueDate === 'string'
        ? parseInt(l.dueDate.split('-')[2] || '1', 10)
        : 1;
      convertedDebts.push({
        id: String(l.id),
        name: String(l.name ?? 'Loan'),
        category: l.kind === 'house' ? 'Mortgage' : 'Auto loan',
        balance: Math.round(Number(l.remainingAmount ?? 0) * 100) / 100,
        originalBalance: l.originalAmount ? Math.round(Number(l.originalAmount) * 100) / 100 : null,
        apr: Number(l.apr ?? 0),
        minimumPayment: Math.round(Number(l.monthlyPayment ?? 0) * 100) / 100,
        dueDay: Number.isFinite(dueDay) && dueDay >= 1 && dueDay <= 31 ? dueDay : 1,
        creditLimit: null,
        createdAt: '2026-07-29T22:55:23.945Z',
        updatedAt: '2026-11-02T17:45:38.182Z',
        serverVersion: 1,
      });
    });
  }

  // Monthly budgets
  const monthlyBudgets = payload.monthlyBudgets as Record<string, unknown> | undefined;
  const novItems = (monthlyBudgets && Array.isArray(monthlyBudgets['2026-11'])
    ? monthlyBudgets['2026-11']
    : []) as Record<string, unknown>[];

  const convertedBills: RecurringBill[] = novItems
    .filter(b => b.kind === 'expense')
    .map(b => {
      let cat: RecurringBillCategory = 'other_bill';
      if (b.category === 'Housing') cat = 'housing';
      else if (b.category === 'Insurance') cat = 'insurance';
      else if (b.category === 'Subscriptions') cat = 'subscription';
      else if (b.category === 'Utilities') cat = 'utilities';

      return {
        id: 'rb-' + String(b.id).replace(/[^a-zA-Z0-9_-]/g, '_'),
        name: String(b.name ?? 'Recurring Bill'),
        category: cat,
        amount: makeMoney('USD', Math.round(Number(b.amount ?? 0) * 100)),
        dueDay: Number(b.dueDay ?? 1),
        paymentMethod: (b.paymentMethod === 'credit' ? 'credit' : 'debit') as RecurringBillPaymentMethod,
        creditAccountId: b.creditAccountId ? String(b.creditAccountId) : undefined,
        autoPost: Boolean(b.autoPay),
        active: true,
        createdAt: typeof b.createdAt === 'string' ? b.createdAt : new Date().toISOString(),
      };
    });

  const coveredIds = new Set<string>();
  const convertedAnchors: ReconciliationAnchor[] = [];
  rawAccounts.forEach(a => {
    const recon = a.reconciliation as Record<string, unknown> | undefined;
    if (recon) {
      if (Array.isArray(recon.coveredTransactionIds)) {
        recon.coveredTransactionIds.forEach((id: unknown) => coveredIds.add(String(id)));
      }
      convertedAnchors.push({
        id: String(recon.adjustmentId ?? ('recon-' + a.id)),
        accountId: String(a.id),
        asOfDate: parseDateOnly(String(recon.date || '2026-10-31')),
        verifiedBalance: makeMoney('USD', Math.round(Number(recon.balance ?? 0) * 100)),
        createdAt: typeof recon.createdAt === 'string' ? recon.createdAt : new Date().toISOString(),
        coveredTransactionIds: Array.isArray(recon.coveredTransactionIds)
          ? (recon.coveredTransactionIds as string[])
          : [],
      });
    }
  });

  const convertedTxs: LedgerTransaction[] = rawTxList.map(t => {
    let cat: TransactionCategory = 'payment';
    if (t.type === 'charge') cat = 'purchase';
    else if (t.type === 'fee') cat = (t.category === 'Interest' ? 'interest' : 'fee');

    return {
      id: String(t.id),
      accountId: t.accountId ? String(t.accountId) : null,
      date: parseDateOnly(String(t.date || '2026-11-01')),
      amount: makeMoney('USD', Math.round(Number(t.amount ?? 0) * 100)),
      category: cat,
      payee: String(t.payeeName ?? t.title ?? 'Transaction'),
      memo: typeof t.memo === 'string' ? t.memo : '',
      source: 'manual',
      reconciled: coveredIds.has(String(t.id)),
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
      deletedAt: null,
    };
  });

  const extraMonthlyPayment = monthlyPlan && typeof monthlyPlan.payoffExtraPayment === 'number'
    ? monthlyPlan.payoffExtraPayment
    : (typeof payload.extra === 'number' ? payload.extra : 3000);

  const onboardingData: UserOnboardingData = {
    version: 1,
    userId: targetUserId,
    householdId: 'hh-papi-mama',
    currentStage: 'home',
    signupCompleted: true,
    onboardingCompleted: true,
    goals: ['Pay down my credit card debt', 'Track recurring bills', 'Become debt-free'],
    referralSource: 'AI assistant (ChatGPT, Gemini, etc.)',
    consideredBeforeAi: null,
    countryCode: 'US',
    currencyCode: 'USD',
    managesWithPartner: true,
    worksWithProfessional: false,
    primaryIncomeAmount: 3700,
    primaryPayFrequency: 'monthly',
    primaryMonthlyIncome: 3700,
    additionalIncomes: [
      {
        id: 'inc-mama',
        name: 'Mama',
        amount: 4100,
        frequency: 'monthly',
        monthlyAmount: 4100,
      },
    ],
    selectedPlan: 'premium',
    homeStatus: 'Own',
    vehicleStatus: 'Finance',
    debts: convertedDebts,
    strategy: payload.strategy === 'snowball' ? 'snowball' : 'avalanche',
    extraMonthlyPayment: Math.round(extraMonthlyPayment * 100) / 100,
    notifications: {
      upcomingReminders: true,
      overdueAlerts: true,
      milestonesAndProgress: true,
      permissionRequested: true,
      osPermissionStatus: 'granted',
    },
    completedAt: '2026-11-01T00:00:00Z',
    updatedAt: new Date().toISOString(),
  };

  return {
    onboardingData,
    recurringBills: convertedBills,
    transactions: convertedTxs,
    reconciliationAnchors: convertedAnchors,
  };
}
