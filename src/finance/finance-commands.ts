import type { Session } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import {
  type LedgerTransaction,
  type ReconciliationAnchor,
  type TransactionCategory,
  applyTransactionToBalance,
  calculateTransactionBalanceDelta,
} from './ledger';
import {
  type RecurringBill,
  createConfirmedRecurringBillTransaction,
} from './recurring-bills';
import {
  persistTransaction,
  updateTransaction,
  deleteTransaction,
  reconcileDebtAtomic,
  persistRecurringBill,
  deleteRecurringBill,
  type FinanceMutationResult,
  type FinanceSyncStatus,
} from '../finance-storage';
import { makeMoney, moneyFromMajor, moneyToMajor, addMoney } from './money';
import { parseDateOnly, type DateOnly } from './calendar';
import { formatCurrency, type DebtItem, type UserOnboardingData } from '../onboarding-domain';
import { cacheConfirmedDebts } from '../onboarding-storage';

export type TransactionCommandResult = {
  transactions: LedgerTransaction[];
  updatedOnboardingData?: UserOnboardingData;
  syncResult: FinanceMutationResult<LedgerTransaction>;
  outcome: 'confirmed' | 'pending' | 'rejected';
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
  const targetDebt = transaction.accountId
    ? onboardingData.debts.find(d => d.id === transaction.accountId)
    : undefined;

  const syncResult = await persistTransaction({
    session,
    userId: onboardingData.userId,
    transaction,
    allTransactions: nextTransactions,
    expectedVersion: targetDebt?.serverVersion,
  });

  if (syncResult.failureKind === 'rejected') {
    throw syncResult.error ?? new Error('Transaction was rejected by server.');
  }

  const confirmedTx: LedgerTransaction = syncResult.syncStatus === 'synced'
    ? {
        ...transaction,
        updatedAt: syncResult.data.updatedAt ?? syncResult.data.createdAt,
        isPending: false,
      }
    : {
        ...transaction,
        isPending: true,
      };

  const finalTransactions = [confirmedTx, ...currentTransactions.filter(t => t.id !== transaction.id)];

  let updatedData = onboardingData;

  if (transaction.accountId && targetDebt) {
    const currentMoney = moneyFromMajor(targetDebt.balance, currencyCode);
    const updatedMoney = applyTransactionToBalance(currentMoney, transaction, targetDebt.category);
    updatedData = {
      ...onboardingData,
      debts: onboardingData.debts.map(debt => debt.id === targetDebt.id
        ? {
            ...debt,
            balance: syncResult.syncStatus === 'synced' && syncResult.accountBalance !== undefined
              ? syncResult.accountBalance
              : moneyToMajor(updatedMoney),
            serverVersion: syncResult.accountVersion ?? debt.serverVersion,
          }
        : debt),
    };
  }

  return {
    transactions: finalTransactions,
    updatedOnboardingData: updatedData,
    syncResult: {
      ...syncResult,
      data: confirmedTx,
    },
    outcome: syncResult.outcome,
  };
}

export type ReconcileCommandResult = {
  transactions: LedgerTransaction[];
  reconciliationAnchors: ReconciliationAnchor[];
  updatedOnboardingData: UserOnboardingData;
  outcome: 'confirmed' | 'pending' | 'rejected';
  syncStatus: FinanceSyncStatus;
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
  let adjTx: LedgerTransaction | null = null;
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

    adjTx = {
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

  // Atomically persist adjustment transaction, reconciliation anchor, and balance update
  const reconcileRes = await reconcileDebtAtomic({
    session,
    userId: onboardingData.userId,
    accountId: item.id,
    verifiedBalance: verifiedMajor,
    asOfDate: todayDate,
    reason,
    anchor,
    adjustmentTx: adjTx,
    allTransactions: nextTransactions,
    allAnchors: nextAnchors,
    expectedVersion: item.serverVersion,
  });

  if (reconcileRes.failureKind === 'rejected') {
    throw reconcileRes.error ?? new Error('Reconciliation was rejected by server.');
  }

  const { id } = item;
  const finalBalance = reconcileRes.newBalance;
  const finalVersion = reconcileRes.newVersion ?? item.serverVersion;

  const updatedDebts = onboardingData.debts.map(d => d.id === id ? {
    ...d,
    balance: finalBalance,
    serverVersion: finalVersion,
  } : d);

  const updatedData: UserOnboardingData = {
    ...onboardingData,
    debts: updatedDebts,
  };

  // Reconciliation RPC already updated this debt atomically. Never issue a second
  // client debt update: it would increment the version again and risk stale writes.
  if (reconcileRes.outcome === 'confirmed') {
    await cacheConfirmedDebts(updatedData);
  }

  return {
    transactions: adjTx ? [{ ...adjTx, isPending: reconcileRes.outcome !== 'confirmed' }, ...currentTransactions] : currentTransactions,
    reconciliationAnchors: nextAnchors,
    updatedOnboardingData: updatedData,
    outcome: reconcileRes.outcome,
    syncStatus: reconcileRes.syncStatus,
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
  if (syncResult.failureKind === 'rejected') {
    throw syncResult.error ?? new Error('Recurring bill creation was rejected by server.');
  }
  return { bills: nextBills, syncResult };
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
  if (syncResult.failureKind === 'rejected') {
    throw syncResult.error ?? new Error('Recurring bill deletion was rejected by server.');
  }
  return { bills: nextBills, syncResult };
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

  const oldDebt = oldTx?.accountId ? onboardingData.debts.find(d => d.id === oldTx.accountId) : undefined;
  const newDebt = transaction.accountId ? onboardingData.debts.find(d => d.id === transaction.accountId) : undefined;

  const syncResult = await updateTransaction({
    session,
    userId: onboardingData.userId,
    transaction,
    allTransactions: currentTransactions.map(t => t.id === transaction.id ? transaction : t),
    expectedVersion: newDebt?.serverVersion,
    expectedOldAccountVersion: oldDebt?.serverVersion,
    expectedTxVersion: oldTx?.updatedAt ?? oldTx?.createdAt,
  });

  if (syncResult.failureKind === 'rejected') {
    throw syncResult.error ?? new Error('Transaction update was rejected by server.');
  }

  const updatedTx: LedgerTransaction = syncResult.syncStatus === 'synced'
    ? {
        ...transaction,
        updatedAt: syncResult.data.updatedAt ?? transaction.updatedAt ?? new Date().toISOString(),
        isPending: false,
      }
    : {
        ...transaction,
        isPending: true,
      };

  const nextTransactions = currentTransactions.map(t => t.id === transaction.id ? updatedTx : t);

  let updatedDebts = [...onboardingData.debts];

  const isSameAccount = Boolean(oldTx?.accountId && transaction.accountId && oldTx.accountId === transaction.accountId);

  if (isSameAccount && oldDebt) {
    // Same-account edit: calculate net delta between the new and old transaction
    const oldDelta = (oldTx && oldTx.deletedAt === null)
      ? calculateTransactionBalanceDelta(oldTx, oldDebt.category)
      : makeMoney(currencyCode, 0);
    const newDelta = (transaction.deletedAt === null)
      ? calculateTransactionBalanceDelta(transaction, oldDebt.category)
      : makeMoney(currencyCode, 0);
    const netDeltaMinor = newDelta.minorUnits - oldDelta.minorUnits;
    const curMoney = moneyFromMajor(oldDebt.balance, currencyCode);
    const provMoney = addMoney(curMoney, makeMoney(currencyCode, netDeltaMinor));

    updatedDebts = updatedDebts.map(d => d.id === oldDebt.id ? {
      ...d,
      balance: syncResult.syncStatus === 'synced' && syncResult.accountBalance !== undefined
        ? syncResult.accountBalance
        : moneyToMajor(provMoney),
      serverVersion: syncResult.accountVersion ?? d.serverVersion,
    } : d);
  } else {
    // Cross-account or single-account change
    // 1. Revert previous transaction if it affected a debt account and wasn't already soft-deleted
    if (oldTx && oldTx.accountId && oldTx.deletedAt === null && oldDebt) {
      const oldDelta = calculateTransactionBalanceDelta(oldTx, oldDebt.category);
      const cur = moneyFromMajor(oldDebt.balance, currencyCode);
      const adj = addMoney(cur, makeMoney(currencyCode, -oldDelta.minorUnits));
      updatedDebts = updatedDebts.map(d => d.id === oldDebt.id ? {
        ...d,
        balance: syncResult.syncStatus === 'synced' && syncResult.oldAccountId === oldDebt.id && syncResult.oldAccountBalance !== undefined
          ? syncResult.oldAccountBalance
          : moneyToMajor(adj),
        serverVersion: syncResult.oldAccountId === oldDebt.id && syncResult.oldAccountVersion !== undefined
          ? syncResult.oldAccountVersion
          : d.serverVersion,
      } : d);
    }

    // 2. Apply new transaction if it affects a debt account and is not soft-deleted
    if (transaction.accountId && transaction.deletedAt === null && newDebt) {
      const newDelta = calculateTransactionBalanceDelta(transaction, newDebt.category);
      const cur = moneyFromMajor(newDebt.balance, currencyCode);
      const adj = addMoney(cur, newDelta);
      updatedDebts = updatedDebts.map(d => d.id === newDebt.id ? {
        ...d,
        balance: syncResult.syncStatus === 'synced' && syncResult.accountBalance !== undefined
          ? syncResult.accountBalance
          : moneyToMajor(adj),
        serverVersion: syncResult.accountVersion ?? d.serverVersion,
      } : d);
    }
  }

  const updatedData: UserOnboardingData = {
    ...onboardingData,
    debts: updatedDebts,
  };

  return {
    transactions: nextTransactions,
    updatedOnboardingData: updatedData,
    syncResult: {
      ...syncResult,
      data: updatedTx,
    },
    outcome: syncResult.outcome,
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
  const targetDebt = targetTx.accountId ? onboardingData.debts.find(d => d.id === targetTx.accountId) : undefined;

  const syncResult = await deleteTransaction({
    session,
    userId: onboardingData.userId,
    transactionId,
    allTransactions: currentTransactions.map(t => t.id === transactionId ? { ...t, deletedAt: new Date().toISOString() } : t),
    expectedVersion: targetDebt?.serverVersion,
    expectedTxVersion: targetTx.updatedAt ?? targetTx.createdAt,
  });

  if (syncResult.failureKind === 'rejected') {
    throw syncResult.error ?? new Error('Transaction deletion was rejected by server.');
  }

  const softDeletedTx: LedgerTransaction = {
    ...targetTx,
    deletedAt: targetTx.deletedAt ?? new Date().toISOString(),
    updatedAt: syncResult.syncStatus === 'synced' ? (syncResult.updatedAt ?? targetTx.updatedAt ?? new Date().toISOString()) : targetTx.updatedAt,
    isPending: syncResult.syncStatus !== 'synced',
  };

  const nextTransactions = currentTransactions.map(t => t.id === transactionId ? softDeletedTx : t);

  let updatedDebts = [...onboardingData.debts];

  if (targetTx.accountId && targetTx.deletedAt === null) {
    if (targetDebt) {
      const delta = calculateTransactionBalanceDelta(targetTx, targetDebt.category);
      const cur = moneyFromMajor(targetDebt.balance, currencyCode);
      const adj = addMoney(cur, makeMoney(currencyCode, -delta.minorUnits));
      updatedDebts = updatedDebts.map(d => d.id === targetDebt.id ? {
        ...d,
        balance: syncResult.syncStatus === 'synced' && syncResult.accountBalance !== undefined
          ? syncResult.accountBalance
          : moneyToMajor(adj),
        serverVersion: syncResult.accountVersion ?? d.serverVersion,
      } : d);
    }
  }

  const updatedData: UserOnboardingData = {
    ...onboardingData,
    debts: updatedDebts,
  };

  return {
    transactions: nextTransactions,
    updatedOnboardingData: updatedData,
    syncResult: {
      data: softDeletedTx,
      syncStatus: syncResult.syncStatus,
      outcome: syncResult.outcome,
      failureKind: syncResult.failureKind,
      error: syncResult.error,
      accountBalance: syncResult.accountBalance,
      accountVersion: syncResult.accountVersion,
      updatedAt: syncResult.updatedAt,
    },
    outcome: syncResult.outcome,
  };
}
