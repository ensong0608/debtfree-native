import type { Session } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import {
  type LedgerTransaction,
  type ReconciliationAnchor,
  type TransactionCategory,
  applyTransactionToBalance,
  classifyCategoryDirection,
} from './ledger';
import {
  type RecurringBill,
  createConfirmedRecurringBillTransaction,
} from './recurring-bills';
import {
  persistTransaction,
  persistRecurringBill,
  deleteRecurringBill,
  persistReconciliationAnchor,
  type FinanceMutationResult,
} from '../finance-storage';
import { makeMoney, moneyFromMajor, moneyToMajor, addMoney } from './money';
import { parseDateOnly, type DateOnly } from './calendar';
import { formatCurrency, type DebtItem, type UserOnboardingData } from '../onboarding-domain';
import { upsertUserDebt } from '../onboarding-storage';

export type TransactionCommandResult = {
  transactions: LedgerTransaction[];
  updatedOnboardingData?: UserOnboardingData;
  syncResult: FinanceMutationResult<LedgerTransaction>;
};

export async function executeAddTransaction(params: {
  session: Session | null;
  onboardingData: UserOnboardingData;
  transaction: LedgerTransaction;
  currentTransactions: LedgerTransaction[];
  currencyCode: string;
}): Promise<TransactionCommandResult> {
  const { session, onboardingData, transaction, currentTransactions, currencyCode } = params;
  const nextTransactions = [transaction, ...currentTransactions];

  const syncResult = await persistTransaction({
    session,
    userId: onboardingData.userId,
    transaction,
    allTransactions: nextTransactions,
  });

  let updatedData = onboardingData;

  if (transaction.accountId) {
    const targetDebt = onboardingData.debts.find(d => d.id === transaction.accountId);
    if (targetDebt) {
      const currentMoney = moneyFromMajor(targetDebt.balance, currencyCode);
      const updatedMoney = applyTransactionToBalance(currentMoney, transaction);
      // The atomic RPC owns the server balance mutation. Avoid a second, stale
      // client-side write that could double-apply or overwrite a concurrent result.
      if (syncResult.syncStatus === 'synced') {
        updatedData = {
          ...onboardingData,
          debts: onboardingData.debts.map(debt => debt.id === targetDebt.id
            ? {
                ...debt,
                balance: syncResult.accountBalance ?? moneyToMajor(updatedMoney),
                serverVersion: syncResult.accountVersion ?? debt.serverVersion,
              }
            : debt),
        };
      }
    }
  }

  return {
    transactions: syncResult.failureKind === 'rejected' ? currentTransactions : nextTransactions,
    updatedOnboardingData: updatedData,
    syncResult,
  };
}

export type ReconcileCommandResult = {
  transactions: LedgerTransaction[];
  reconciliationAnchors: ReconciliationAnchor[];
  updatedOnboardingData: UserOnboardingData;
};

export async function executeReconcileDebt(params: {
  session: Session | null;
  onboardingData: UserOnboardingData;
  item: DebtItem;
  verifiedBalance: number;
  reason: 'interest_adjustment' | 'balance_adjustment' | 'credit_adjustment';
  currencyCode: string;
  currencySymbol: string;
  currentTransactions: LedgerTransaction[];
  currentAnchors: ReconciliationAnchor[];
}): Promise<ReconcileCommandResult> {
  const {
    session,
    onboardingData,
    item,
    verifiedBalance,
    reason,
    currencyCode,
    currencySymbol,
    currentTransactions,
    currentAnchors,
  } = params;

  const oldMoney = moneyFromMajor(item.balance, currencyCode);
  const verifiedMoney = moneyFromMajor(verifiedBalance, currencyCode);
  const driftMinor = verifiedMoney.minorUnits - oldMoney.minorUnits;
  const verifiedMajor = moneyToMajor(verifiedMoney);
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayDate = parseDateOnly(todayStr);

  let nextTransactions = currentTransactions;
  let adjId: string | null = null;

  if (driftMinor !== 0) {
    const isPositive = driftMinor > 0;
    const category: TransactionCategory = isPositive
      ? (reason === 'interest_adjustment' ? 'interest_adjustment' : 'balance_adjustment')
      : 'credit_adjustment';

    const payee = reason === 'interest_adjustment'
      ? 'Interest reconciliation adjustment'
      : (isPositive ? 'Statement balance reconciliation' : 'Reconciliation credit adjustment');

    const memo = `Reconciled from ${formatCurrency(moneyToMajor(oldMoney), currencySymbol)} to ${formatCurrency(verifiedMajor, currencySymbol)} (${reason.replace('_', ' ')})`;
    adjId = Crypto.randomUUID();

    const adjTx: LedgerTransaction = {
      id: adjId,
      accountId: item.id,
      date: todayDate,
      amount: makeMoney(currencyCode, Math.abs(driftMinor)),
      category,
      payee,
      memo,
      source: 'reconciliation',
      reconciled: true,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };

    nextTransactions = [adjTx, ...currentTransactions];
    const transactionResult = await persistTransaction({
      session,
      userId: onboardingData.userId,
      transaction: adjTx,
      allTransactions: nextTransactions,
    });
    if (transactionResult.syncStatus !== 'synced') {
      throw transactionResult.error ?? new Error('Reconciliation transaction was not confirmed; reload before continuing.');
    }
  }

  const anchor: ReconciliationAnchor = {
    id: Crypto.randomUUID(),
    accountId: item.id,
    asOfDate: todayDate,
    verifiedBalance: verifiedMoney,
    note: reason,
    createdAt: new Date().toISOString(),
    createdAdjustmentId: adjId,
  };

  const nextAnchors = [anchor, ...currentAnchors];
  const anchorResult = await persistReconciliationAnchor({
    session,
    userId: onboardingData.userId,
    anchor,
    allAnchors: nextAnchors,
  });
  if (anchorResult.syncStatus !== 'synced') {
    throw anchorResult.error ?? new Error('Reconciliation anchor was not confirmed; reload before continuing.');
  }

  const { id, name, category, originalBalance, apr, minimumPayment, dueDay, creditLimit, serverVersion } = item;
  const updatedData = await upsertUserDebt(onboardingData, {
    id,
    name,
    category,
    balance: verifiedMajor,
    originalBalance,
    apr,
    minimumPayment,
    dueDay,
    creditLimit,
    serverVersion,
  });

  return {
    transactions: nextTransactions,
    reconciliationAnchors: nextAnchors,
    updatedOnboardingData: updatedData,
  };
}

export async function executeRecordBillPayment(params: {
  session: Session | null;
  onboardingData: UserOnboardingData;
  bill: RecurringBill;
  dueCycle: DateOnly;
  currencyCode: string;
  currentTransactions: LedgerTransaction[];
}): Promise<TransactionCommandResult> {
  const { session, onboardingData, bill, dueCycle, currencyCode, currentTransactions } = params;
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayDate = parseDateOnly(todayStr);

  const tx = createConfirmedRecurringBillTransaction({ bill, dueCycle, actualDate: todayDate });

  return executeAddTransaction({
    session,
    onboardingData,
    transaction: tx,
    currentTransactions,
    currencyCode,
  });
}

export async function executeAddRecurringBill(params: {
  session: Session | null;
  userId: string;
  bill: RecurringBill;
  currentBills: RecurringBill[];
}): Promise<{ bills: RecurringBill[]; syncResult: FinanceMutationResult<RecurringBill> }> {
  const { session, userId, bill, currentBills } = params;
  const nextBills = [bill, ...currentBills];
  const syncResult = await persistRecurringBill({
    session,
    userId,
    bill,
    allBills: nextBills,
  });
  return { bills: syncResult.failureKind === 'rejected' ? currentBills : nextBills, syncResult };
}

export async function executeDeleteRecurringBill(params: {
  session: Session | null;
  userId: string;
  billId: string;
  currentBills: RecurringBill[];
}): Promise<{ bills: RecurringBill[]; syncResult: FinanceMutationResult<string> }> {
  const { session, userId, billId, currentBills } = params;
  const nextBills = currentBills.filter(b => b.id !== billId);
  const syncResult = await deleteRecurringBill({
    session,
    userId,
    billId,
    allBills: currentBills,
  });
  return { bills: syncResult.failureKind === 'rejected' ? currentBills : nextBills, syncResult };
}

export async function executeUpdateTransaction(params: {
  session: Session | null;
  onboardingData: UserOnboardingData;
  transaction: LedgerTransaction;
  currentTransactions: LedgerTransaction[];
  currencyCode: string;
}): Promise<TransactionCommandResult> {
  const { session, onboardingData, transaction, currentTransactions, currencyCode } = params;
  const oldTx = currentTransactions.find(t => t.id === transaction.id);
  const nextTransactions = currentTransactions.map(t => t.id === transaction.id ? transaction : t);

  const syncResult = await persistTransaction({
    session,
    userId: onboardingData.userId,
    transaction,
    allTransactions: nextTransactions,
  });

  let updatedDebts = [...onboardingData.debts];

  // 1. Revert previous transaction if it affected a debt account and wasn't already soft-deleted
  if (oldTx && oldTx.accountId && oldTx.deletedAt === null) {
    const oldDebt = updatedDebts.find(d => d.id === oldTx.accountId);
    if (oldDebt) {
      const dir = classifyCategoryDirection(oldTx.category);
      if (dir === 'increase_debt') {
        const cur = moneyFromMajor(oldDebt.balance, currencyCode);
        const adj = addMoney(cur, makeMoney(currencyCode, -oldTx.amount.minorUnits));
        updatedDebts = updatedDebts.map(d => d.id === oldDebt.id ? { ...d, balance: moneyToMajor(adj) } : d);
      } else if (dir === 'decrease_debt') {
        const cur = moneyFromMajor(oldDebt.balance, currencyCode);
        const adj = addMoney(cur, oldTx.amount);
        updatedDebts = updatedDebts.map(d => d.id === oldDebt.id ? { ...d, balance: moneyToMajor(adj) } : d);
      }
    }
  }

  // 2. Apply new transaction if it affects a debt account and is not soft-deleted
  if (transaction.accountId && transaction.deletedAt === null) {
    const newDebt = updatedDebts.find(d => d.id === transaction.accountId);
    if (newDebt) {
      const cur = moneyFromMajor(newDebt.balance, currencyCode);
      const adj = applyTransactionToBalance(cur, transaction);
      updatedDebts = updatedDebts.map(d => d.id === newDebt.id ? {
        ...d,
        balance: syncResult.accountBalance ?? moneyToMajor(adj),
        serverVersion: syncResult.accountVersion ?? d.serverVersion,
      } : d);
    }
  }

  const updatedData: UserOnboardingData = {
    ...onboardingData,
    debts: updatedDebts,
  };

  return {
    transactions: syncResult.failureKind === 'rejected' ? currentTransactions : nextTransactions,
    updatedOnboardingData: updatedData,
    syncResult,
  };
}

export async function executeDeleteTransaction(params: {
  session: Session | null;
  onboardingData: UserOnboardingData;
  transactionId: string;
  currentTransactions: LedgerTransaction[];
  currencyCode: string;
}): Promise<TransactionCommandResult> {
  const { session, onboardingData, transactionId, currentTransactions, currencyCode } = params;
  const targetTx = currentTransactions.find(t => t.id === transactionId);
  if (!targetTx) {
    throw new Error(`Transaction with id '${transactionId}' not found`);
  }

  const softDeletedTx: LedgerTransaction = {
    ...targetTx,
    deletedAt: new Date().toISOString(),
  };

  return executeUpdateTransaction({
    session,
    onboardingData,
    transaction: softDeletedTx,
    currentTransactions,
    currencyCode,
  });
}
