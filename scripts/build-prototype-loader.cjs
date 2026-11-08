const fs = require('fs');
const path = require('path');

const backupPath = 'C:/Users/lawre/.t3/userdata/attachments/fa64d219-11e5-4d0a-b7fc-5ba5c8f6add4-c0119a08-96ec-4833-bf11-fe5729d568b3-json.json';
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const payload = backup.payload;

const debts = [];
payload.accounts.forEach(a => {
  const txs = (payload.transactions || []).filter(t => t.accountId === a.id && !t.deletedAt);
  const latestTxWithBalance = [...txs].reverse().find(t => typeof t.balanceAfter === 'number');
  const currentBalance = latestTxWithBalance ? latestTxWithBalance.balanceAfter : a.balance;
  const dueDay = a.dueDate ? parseInt(a.dueDate.split('-')[2], 10) : 1;
  const latestCycle = a.minimumCycles ? a.minimumCycles[a.minimumCycles.length - 1] : null;
  const minPayment = (a.id === 'import-1785365723945-42-0.6215360066313965' && latestCycle) ? latestCycle.amount : a.minimum;

  debts.push({
    id: a.id,
    name: a.name,
    category: a.type === 'Credit card' ? 'Credit card' : 'Other loan',
    balance: Math.round(currentBalance * 100) / 100,
    originalBalance: a.baselineBalance ? Math.round(a.baselineBalance * 100) / 100 : null,
    apr: a.apr,
    minimumPayment: Math.round(minPayment * 100) / 100,
    dueDay: dueDay,
    creditLimit: a.creditLimit ? Math.round(a.creditLimit * 100) / 100 : null,
    createdAt: a.createdAt,
    updatedAt: a.createdAt,
    serverVersion: 1,
  });
});

if (payload.monthlyPlan && payload.monthlyPlan.loanTrackers) {
  payload.monthlyPlan.loanTrackers.forEach(l => {
    const dueDay = l.dueDate ? parseInt(l.dueDate.split('-')[2], 10) : 1;
    debts.push({
      id: l.id,
      name: l.name,
      category: l.kind === 'house' ? 'Mortgage' : 'Auto loan',
      balance: Math.round(l.remainingAmount * 100) / 100,
      originalBalance: l.originalAmount ? Math.round(l.originalAmount * 100) / 100 : null,
      apr: l.apr,
      minimumPayment: Math.round(l.monthlyPayment * 100) / 100,
      dueDay: dueDay,
      creditLimit: null,
      createdAt: '2026-07-29T22:55:23.945Z',
      updatedAt: '2026-11-02T17:45:38.182Z',
      serverVersion: 1,
    });
  });
}

// 2. Bills (from 2026-11)
const billsRaw = (payload.monthlyBudgets['2026-11'] || []).filter(b => b.kind === 'expense');
const recurringBills = billsRaw.map(b => {
  let cat = 'other_bill';
  if (b.category === 'Housing') cat = 'housing';
  else if (b.category === 'Insurance') cat = 'insurance';
  else if (b.category === 'Subscriptions') cat = 'subscription';
  else if (b.category === 'Utilities') cat = 'utilities';

  return {
    id: 'rb-' + b.id.replace(/[^a-zA-Z0-9_-]/g, '_'),
    name: b.name,
    category: cat,
    amount: Math.round(b.amount * 100), // minorUnits in cents
    dueDay: b.dueDay || 1,
    paymentMethod: b.paymentMethod || 'debit',
    creditAccountId: b.creditAccountId || undefined,
    autoPost: Boolean(b.autoPay),
    active: true,
    createdAt: b.createdAt || '2026-11-01T00:00:00.000Z',
  };
});

// 3. Transactions
const nonDeletedTx = (payload.transactions || []).filter(t => !t.deletedAt);
const covered = new Set();
payload.accounts.forEach(a => {
  if (a.reconciliation && a.reconciliation.coveredTransactionIds) {
    a.reconciliation.coveredTransactionIds.forEach(id => covered.add(id));
  }
});

const transactions = nonDeletedTx.map(t => {
  let cat = 'payment';
  if (t.type === 'charge') cat = 'purchase';
  else if (t.type === 'fee') cat = (t.category === 'Interest' ? 'interest' : 'fee');

  let memo = t.memo || '';
  let appliesToDate = undefined;

  // Link known prototype payments to their respective bill and debt cycles
  if (t.id === '20a3c2bc-6b14-4ee5-b941-f6cf370d2347') {
    memo = 'Netflix subscription [bill:rb_recurring_2026_11_1791047843637_0_4023147987421465]';
    appliesToDate = '2026-11-05';
  } else if (t.id === '552763f2-97f1-4c3b-9e82-0355e063f23e') {
    appliesToDate = '2026-11-01';
  } else if (t.id === 'b26ca7d4-039b-4947-ae5d-029d307a0867') {
    appliesToDate = '2026-11-02';
  } else if (t.id === '514bbb2a-36b2-4d47-96ca-430bab784792') {
    appliesToDate = '2026-11-02';
  } else if (t.id === '11c3f752-407b-4448-adea-e164d2181b88') {
    appliesToDate = '2026-11-01';
  } else if (t.id === '5021115a-f56e-40cc-bef1-dfbd8e8d7cac') {
    appliesToDate = '2026-11-01';
  } else if (t.id === '128ca525-5deb-4a22-af50-66e2d1669c4f') {
    appliesToDate = '2026-11-17';
  } else if (t.id === '89ec0770-a44b-4539-b0af-216db9a1b2b2') {
    appliesToDate = '2026-11-22';
  } else if (t.id === '61f5e4ea-441a-4155-9978-52a48daef3c2') {
    appliesToDate = '2026-11-27';
  } else if (t.id === 'e9c63092-08b7-4440-bf28-ccf8e046417f') {
    appliesToDate = '2026-11-28';
  }

  return {
    id: t.id,
    accountId: t.accountId || null,
    date: t.date,
    appliesToDate: appliesToDate,
    amount: Math.round(t.amount * 100), // minorUnits
    category: cat,
    payee: t.payeeName || t.title || 'Payment',
    memo: memo,
    source: 'manual',
    reconciled: covered.has(t.id),
    createdAt: t.createdAt || '2026-11-01T00:00:00.000Z',
    deletedAt: null,
  };
});

// Add confirmed November payments for House and HOA debit bills so they are fully satisfied
transactions.unshift({
  id: 'bill:rb_recurring_2026_11_1789594774948_2_0_26582255922921816:2026-11-01',
  accountId: null,
  date: '2026-11-01',
  appliesToDate: '2026-11-01',
  amount: 221090, // $2,210.90
  category: 'debit_bill',
  payee: 'House',
  memo: 'Payment for 2026-11-01 [bill:rb_recurring_2026_11_1789594774948_2_0_26582255922921816]',
  source: 'recurring_bill',
  reconciled: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  deletedAt: null,
});

transactions.unshift({
  id: 'bill:rb_recurring_2026_11_1789594774948_3_0_9625455718492124:2026-11-01',
  accountId: null,
  date: '2026-11-01',
  appliesToDate: '2026-11-01',
  amount: 16300, // $163.00
  category: 'debit_bill',
  payee: 'HOA',
  memo: 'Payment for 2026-11-01 [bill:rb_recurring_2026_11_1789594774948_3_0_9625455718492124]',
  source: 'recurring_bill',
  reconciled: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  deletedAt: null,
});

// 4. Reconciliation Anchors
const reconciliationAnchors = [];
payload.accounts.forEach(a => {
  if (a.reconciliation) {
    reconciliationAnchors.push({
      id: a.reconciliation.adjustmentId || ('recon-' + a.id),
      accountId: a.id,
      asOfDate: a.reconciliation.date,
      verifiedBalance: Math.round(a.reconciliation.balance * 100), // minor units
      createdAt: a.reconciliation.createdAt,
      coveredTransactionIds: a.reconciliation.coveredTransactionIds || [],
    });
  }
});

const fileContent = `// Pre-loaded prototype household dataset from prototype backup (version 6, 2026-11-06)
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


export const PROTOTYPE_DEBTS: readonly DebtItem[] = ${JSON.stringify(debts, null, 2)} as const;

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

const RAW_RECURRING_BILLS = ${JSON.stringify(recurringBills, null, 2)} as const;

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

const RAW_TRANSACTIONS = ${JSON.stringify(transactions, null, 2)} as const;

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

const RAW_RECONCILIATION_ANCHORS = ${JSON.stringify(reconciliationAnchors, null, 2)} as const;

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

  const rawAccounts = payload.accounts as Array<Record<string, unknown>>;
  const rawTxList = Array.isArray(payload.transactions)
    ? (payload.transactions as Array<Record<string, unknown>>).filter(t => !t.deletedAt)
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
    : []) as Array<Record<string, unknown>>;

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
`;

fs.writeFileSync('C:/Users/lawre/OneDrive/Desktop/DF_App_Development/debtfree-native/src/finance/prototype-loader.ts', fileContent, 'utf8');
console.log('Successfully generated src/finance/prototype-loader.ts');
