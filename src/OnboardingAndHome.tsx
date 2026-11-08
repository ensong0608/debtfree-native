import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import type { Session } from '@supabase/supabase-js';
import {
  AI_REFERRAL_SOURCE,
  CURRENCY_OPTIONS, resolveCurrencyOption, activeDebts, acceptMoneyEdit, acceptAprEdit, formatEditableMoney,
  COUNTRY_OPTIONS,
  DEBT_CATEGORIES,
  PAY_FREQUENCY_OPTIONS,
  REFERRAL_SOURCES,
  SIGNUP_GOALS,
  calculatePayoffPlan,
  calculateTotalMonthlyIncome,
  formatCurrency,
  normalizeMonthlyIncome,
  parseMoneyInput,
  validateDebtDraft,
  validateDebtsStep,
  validateExtraPaymentInput,
  validateIncomeStep,
  validateSignUpStep2,
  validateSignUpStep3,
  validateSignUpStep4,
  type AdditionalIncomeSource,
  type CountryCode,
  type DebtCategory,
  type DebtItem,
  type FlowStage,
  type PayFrequency,
  type PayoffStrategy,
  type PremiumPlanChoice,
  type UserOnboardingData,
  type VehicleOwnershipStatus,
} from './onboarding-domain';
import {
  deleteUserDebt,
  loadUserOnboardingData,
  requestNativeNotificationPermission,
  saveUserOnboardingData,
  saveUserOnboardingSettingsPatch,
  upsertUserDebt,
} from './onboarding-storage';
import { assertCurrencyChangeAllowed } from './debt-storage-domain';
import { AppIcon } from './components/AppIcon';
import { SelectDropdown, type DropdownOption } from './components/SelectDropdown';
import { HomeScreen } from './screens/HomeScreen';
import {
  executeAddTransaction,
  executeUpdateTransaction,
  executeDeleteTransaction,
  executeReconcileDebt,
  executeRecordBillPayment,
  executeAddRecurringBill,
  executeDeleteRecurringBill,
} from './finance/finance-commands';
import { type LedgerTransaction, type ReconciliationAnchor } from './finance/ledger';
import { createRecurringBillDeletionPreview, type RecurringBill } from './finance/recurring-bills';
import { createOnboardingLoanBill, onboardingLoanBillSaveAction, withoutDeletedBillPairings, withoutDeletedDebtPairing, withoutIncompatibleDebtPairing } from './finance/loan-bill-pairing';
import { parseMoney, moneyToMajor, type Money } from './finance/money';
import { type DateOnly, currentHouseholdDate } from './finance/calendar';
import {
  confirmObligationPaidToday,
  obligationFirstDueDate,
  prepareObligationEditorSchedule,
  shouldAskPaidToday,
  saveObligationEditorSchedule,
  removeObligationEditorSchedule,
} from './finance/obligation-editor';
import { getObligationCycle, obligationScheduleKey } from './finance/obligation-schedule';
import type { ObligationSchedule, ObligationScheduleKey } from './finance/obligation-schedule';
import {
  loadFinanceRecords,
} from './finance-storage';
import {
  PROTOTYPE_RECURRING_BILLS,
  PROTOTYPE_TRANSACTIONS,
  PROTOTYPE_RECONCILIATION_ANCHORS,
} from './finance/prototype-loader';

type Props = {
  session: Session | null;
  onboardingData: UserOnboardingData | null;
  stage: FlowStage;
  onChangeStage: (next: FlowStage) => void;
  onUpdateOnboardingData: (next: UserOnboardingData) => void;
  onGoogleSignIn: () => Promise<Session | null>;
  onAppleSignIn: () => Promise<Session | null>;
  onSignOut: () => Promise<void>;
  onTestUserSignIn?: () => void;
  appleAvailable: boolean;
  configured: boolean;
  configProblem: string | null;
  authBusy: boolean;
  authError: string;
  authNotice: string;
  onClearAuthError: () => void;
};

function AppleMark() {
  return (
    <View style={styles.appleMarkBox}>
      <View style={styles.appleMarkLeaf} />
      <View style={styles.appleMarkBody}>
        <View style={styles.appleMarkLobeLeft} />
        <View style={styles.appleMarkLobeRight} />
        <View style={styles.appleMarkBite} />
      </View>
    </View>
  );
}

function ProgressHeader({
  label,
  step,
  total,
  onBack,
}: {
  label: string;
  step: number;
  total: number;
  onBack?: () => void;
}) {
  return (
    <View style={styles.topBar}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          style={styles.backButton}
          onPress={onBack}
        >
          <AppIcon name="back" size={22} color="#F1F1F0" />
        </Pressable>
      ) : null}
      <Text style={styles.stepText} accessibilityRole="header">
        {`${label} ${step} of ${total}`}
      </Text>
      <View style={styles.progressRow} accessible accessibilityLabel={`${label} ${step} of ${total}`}>
        {Array.from({ length: total }, (_, idx) => (
          <View
            key={idx}
            style={[styles.progressSegment, idx < step && styles.progressSegmentDone]}
          />
        ))}
      </View>
    </View>
  );
}

function ChoiceButton({
  label,
  selected,
  onPress,
  compact = false,
  flex = false,
  pill = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  compact?: boolean;
  flex?: boolean;
  pill?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[
        styles.choice,
        compact && styles.choiceCompact,
        flex && styles.choiceFlex,
        pill && styles.choicePill,
        pill && selected && styles.choicePillSelected,
        selected && styles.choiceSelected,
      ]}
      onPress={onPress}
    >
      {selected ? (
        <View style={[styles.choiceCheck, compact && styles.choiceCheckCompact]}>
          <AppIcon name="check" size={compact ? 12 : 14} color="#FF9367" />
        </View>
      ) : null}
      <Text
        style={[
          styles.choiceText,
          compact && styles.choiceTextCompact,
          selected && styles.choiceTextSelected,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const DEBT_CATEGORY_DROPDOWN_OPTIONS: readonly DropdownOption<DebtCategory>[] = DEBT_CATEGORIES.map(cat => ({
  value: cat,
  label: cat,
  icon: cat === 'Credit card' ? 'creditCard' : (cat === 'Auto loan' ? 'auto' : undefined),
  subtitle: cat === 'Credit card' ? 'Revolving card balance' : (cat === 'Auto loan' ? 'Vehicle loan' : 'Fixed installment loan'),
}));

export function DebtFreeFlow({
  session,
  onboardingData,
  stage,
  onChangeStage,
  onUpdateOnboardingData,
  onGoogleSignIn,
  onAppleSignIn,
  onSignOut,
  onTestUserSignIn,
  appleAvailable,
  configured,
  configProblem,
  authBusy,
  authError,
  authNotice,
  onClearAuthError,
}: Props) {
  const [signInMode, setSignInMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState('');
  const savingRef = useRef(false);

  // Step 4 Country picker toggle
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');

  // Onboarding Step 1 (Income) local text state
  const [incomeInput, setIncomeInput] = useState(() =>
    onboardingData && onboardingData.primaryIncomeAmount > 0
      ? formatEditableMoney(onboardingData.primaryIncomeAmount, resolveCurrencyOption(onboardingData).code)
      : '5200',
  );
  const [showAddIncomeForm, setShowAddIncomeForm] = useState(false);
  const [extraIncomeName, setExtraIncomeName] = useState('');
  const [extraIncomeAmount, setExtraIncomeAmount] = useState('');
  const [extraIncomeFreq, setExtraIncomeFreq] = useState<PayFrequency>('monthly');

  // Onboarding Step 3 / Home (Add/Edit Debt) form state
  const [editingDebtId, setEditingDebtId] = useState<string | null>(null);
  // Keep a new debt's identity stable across failed/uncertain saves and retries.
  const draftDebtIdRef = useRef<string | null>(null);
  const draftDebtPaidTodayRef = useRef<Record<string, boolean>>({});
  const [showDebtForm, setShowDebtForm] = useState(false);
  const [debtCategory, setDebtCategory] = useState<DebtCategory>('Credit card');
  const [debtName, setDebtName] = useState('');
  const [debtBalance, setDebtBalance] = useState('');
  const [debtOriginalBalance, setDebtOriginalBalance] = useState('');
  const [debtApr, setDebtApr] = useState('');
  const [debtMinimum, setDebtMinimum] = useState('');
  const [debtDueDay, setDebtDueDay] = useState('');
  const [debtCreditLimit, setDebtCreditLimit] = useState('');
  const [onboardingBillRecovery, setOnboardingBillRecovery] = useState<
    null | 'needed' | 'loading' | 'pending' | 'confirmed' | 'retry' | 'conflict' | 'error'
  >(null);

  // Onboarding Step 4 (Payoff strategy) extra monthly payment input
  const [extraPaymentInput, setExtraPaymentInput] = useState(() =>
    onboardingData ? formatEditableMoney(onboardingData.extraMonthlyPayment, resolveCurrencyOption(onboardingData).code) : '150',
  );

  const countryInfo = useMemo(() => {
    const code = onboardingData?.countryCode ?? 'US';
    return COUNTRY_OPTIONS.find(c => c.code === code) ?? COUNTRY_OPTIONS[0];
  }, [onboardingData?.countryCode]);

  const currency = resolveCurrencyOption(onboardingData);
  const currencySymbol = currency.symbol;
  const currencyCode = currency.code;

  // Transactions, Recurring Bills, and Reconciliation State (T-024, T-025, T-026)
  const isPrototypeHousehold = onboardingData?.householdId === 'hh-papi-mama' || onboardingData?.userId === 'test-user-preview';

  const [transactions, setTransactions] = useState<LedgerTransaction[]>(() =>
    isPrototypeHousehold ? PROTOTYPE_TRANSACTIONS : [],
  );

  const [recurringBills, setRecurringBills] = useState<RecurringBill[]>(() => {
    return isPrototypeHousehold ? PROTOTYPE_RECURRING_BILLS : [];
  });

  const [reconciliationAnchors, setReconciliationAnchors] = useState<ReconciliationAnchor[]>(() => {
    if (isPrototypeHousehold) {
      return PROTOTYPE_RECONCILIATION_ANCHORS;
    }
    return [];
  });
  const [verifiedFinanceScope, setVerifiedFinanceScope] = useState('');
  const [reloadFeedback, setReloadFeedback] = useState<{
    kind: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const financeRecordsVerified = verifiedFinanceScope === `${session?.user?.id ?? 'offline'}:${onboardingData?.userId ?? 'none'}:${currencyCode}`;

  // Load finance records from remote/cache on session/user ready
  useEffect(() => {
    if (!onboardingData?.userId) return;
    let isCancelled = false;
    loadFinanceRecords({
      session,
      userId: onboardingData.userId,
      currency: currencyCode,
    }).then(records => {
      if (isCancelled) return;
      if (records.syncStatus === 'synced' || records.syncStatus === 'cached_offline') {
        const completeSnapshot = records.snapshotStatus === 'authoritative';
        setVerifiedFinanceScope(completeSnapshot ? `${session?.user?.id ?? 'offline'}:${onboardingData.userId}:${currencyCode}` : '');
        if (records.snapshotStatus === 'authoritative') {
          setReloadFeedback(null);
        } else if (records.snapshotStatus === 'authoritative_with_pending_writes') {
          setReloadFeedback({ kind: 'warning', message: 'Server records loaded. Some local financial changes are still awaiting confirmation.' });
        } else {
          setReloadFeedback({
            kind: records.error ? 'error' : 'warning',
            message: records.error
              ? 'Unable to verify with the server. Showing saved data from this device.'
              : 'Showing saved offline data. This financial snapshot is not verified against the server.',
          });
        }
        if (isPrototypeHousehold) {
          if (records.transactions.length > 0) setTransactions(records.transactions);
          if (records.recurringBills.length > 0) setRecurringBills(records.recurringBills);
          if (records.reconciliationAnchors.length > 0) setReconciliationAnchors(records.reconciliationAnchors);
        } else {
          setTransactions(records.transactions);
          setRecurringBills(records.recurringBills);
          setReconciliationAnchors(records.reconciliationAnchors);
        }
      }
    }).catch(() => {
      if (!isCancelled) setReloadFeedback({ kind: 'error', message: 'Unable to load financial records. Existing data remains on this device.' });
    });
    return () => { isCancelled = true; };
  }, [session, onboardingData?.userId, currencyCode, isPrototypeHousehold]);

  const [reloading, setReloading] = useState(false);
  const handleReloadAppData = async () => {
    if (!onboardingData || reloading) return;
    setReloading(true);
    setVerifiedFinanceScope('');
    setLocalError('');
    setReloadFeedback(null);
    try {
      let refreshedData = onboardingData;
      let settingsError: Error | null = null;
      if (session) {
        try {
          refreshedData = await loadUserOnboardingData(session);
          if (refreshedData.userId !== onboardingData.userId) {
            throw new Error('The signed-in account changed. Sign in again to reload.');
          }
          onUpdateOnboardingData(refreshedData);
        } catch (error) {
          if (error instanceof Error && error.message.includes('signed-in account changed')) throw error;
          settingsError = error instanceof Error ? error : new Error(String(error));
        }
      }
      const records = await loadFinanceRecords({ session, userId: refreshedData.userId, currency: resolveCurrencyOption(refreshedData).code });
      const hasServerSnapshot = records.snapshotStatus === 'authoritative' || records.snapshotStatus === 'authoritative_with_pending_writes';
      if (hasServerSnapshot) {
        setTransactions(records.transactions);
        setRecurringBills(records.recurringBills);
        setReconciliationAnchors(records.reconciliationAnchors);
      }
      const completeSnapshot = records.snapshotStatus === 'authoritative' && settingsError === null;
      setVerifiedFinanceScope(completeSnapshot ? `${session?.user?.id ?? 'offline'}:${refreshedData.userId}:${resolveCurrencyOption(refreshedData).code}` : '');
      if (settingsError) {
        setReloadFeedback({ kind: 'error', message: 'Reload was incomplete. Settings and debts could not be refreshed; existing financial records were kept unless a server snapshot was available.' });
      } else if (records.snapshotStatus === 'authoritative') {
        setReloadFeedback({ kind: 'success', message: 'App data refreshed from the server.' });
      } else if (records.snapshotStatus === 'authoritative_with_pending_writes') {
        setReloadFeedback({
          kind: 'warning',
          message: `${records.pendingWriteCount} local financial change${records.pendingWriteCount === 1 ? '' : 's'} still await confirmation. Server records were refreshed, but this snapshot is not fully verified.`,
        });
      } else if (records.error || records.failureKind) {
        setReloadFeedback({ kind: 'error', message: 'Reload failed. Existing financial records remain on screen; saved offline data was not used to replace them.' });
      } else {
        setReloadFeedback({ kind: 'warning', message: 'Showing saved offline data. It has not been verified against the server.' });
      }
    } catch (err) {
      setReloadFeedback({
        kind: 'error',
        message: err instanceof Error
          ? `Reload failed: ${err.message}. Existing financial records remain on screen.`
          : 'Reload failed. Existing financial records remain on screen.',
      });
    } finally {
      setReloading(false);
    }
  };

  const handleAddRecurringBill = async (bill: RecurringBill) => {
    if (!onboardingData) throw new Error('Onboarding settings are unavailable. Reload and retry.');
    try {
      const res = await executeAddRecurringBill({
        session,
        userId: onboardingData.userId,
        bill,
        currentBills: recurringBills,
      });
      setRecurringBills(res.bills);
      return { outcome: res.syncResult.outcome === 'confirmed' ? 'confirmed' as const : 'pending' as const };
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to add recurring bill.');
      throw err;
    }
  };

  const handleDeleteRecurringBill = async (billId: string, expectedSnapshotToken: string) => {
    if (!onboardingData) throw new Error('Onboarding settings are unavailable. Reload and retry.');
    if (!session || session.user.id !== onboardingData.userId) throw new Error('The signed-in owner could not be verified. Reconnect and review the bill before retrying; nothing was changed.');
    const freshData = await loadUserOnboardingData(session);
    if (freshData.userId !== session.user.id) throw new Error('The refreshed owner does not match this session. Review the bill again; nothing was changed.');
    const freshRecords = await loadFinanceRecords({ session, userId: freshData.userId, currency: resolveCurrencyOption(freshData).code });
    if (freshRecords.snapshotStatus !== 'authoritative' || freshRecords.pendingWriteCount !== 0 || freshRecords.syncStatus !== 'synced') {
      throw new Error('A complete authoritative finance snapshot is unavailable. Reload financial records and review the bill again; nothing was changed.');
    }
    const today = currentHouseholdDate(freshData.householdTimeZone);
    const freshBill = freshRecords.recurringBills.find(bill => bill.id === billId);
    if (!freshBill || !freshBill.active) throw new Error('This recurring item changed or is no longer active. Review the refreshed bill before retrying; nothing was changed.');
    const freshPreview = createRecurringBillDeletionPreview({
      transactions: freshRecords.transactions, bill: freshBill, debts: freshData.debts,
      ownerId: freshData.userId, asOfDate: today,
    });
    if (freshPreview.snapshotToken !== expectedSnapshotToken) {
      setTransactions(freshRecords.transactions);
      setRecurringBills(freshRecords.recurringBills);
      onUpdateOnboardingData(freshData);
      throw new Error('The bill, linked transactions, or debt revisions changed after confirmation. Nothing was deleted. Review the refreshed details and confirm again.');
    }
    if (freshPreview.hasPendingLinkedTransaction) throw new Error('A linked transaction is still awaiting confirmation. Reload financial records and review the bill again; nothing was changed.');
    const futureTransactions = freshPreview.transactionsToDelete;
    const preservedHistorySummary = `${freshPreview.preservedPrepayments.length} recorded prepayment(s) applied to future cycles and ${freshPreview.preservedFutureDatedPastCycle.length} future-dated item(s) assigned to past cycles were preserved; no balance effects were reversed.`;
    const unresolvedAccountTransaction = futureTransactions.find(tx => tx.accountId && !freshData.debts.some(debt => debt.id === tx.accountId));
    if (unresolvedAccountTransaction) {
      throw new Error(`The linked future transaction dated ${unresolvedAccountTransaction.date} refers to an account that is not loaded. Reload finance records before deletion; no rows were changed.`);
    }
    let currentData = freshData;
    let currentTransactions = freshRecords.transactions;
    setTransactions(currentTransactions);
    setRecurringBills(freshRecords.recurringBills);
    onUpdateOnboardingData(currentData);
    let confirmedTransactionCount = 0;
    try {
      for (const transaction of futureTransactions) {
        const result = await executeDeleteTransaction({
          session,
          onboardingData: currentData,
          transactionId: transaction.id,
          currentTransactions,
          currencyCode,
        });
        currentData = result.updatedOnboardingData ?? currentData;
        currentTransactions = result.transactions;
        setTransactions(currentTransactions);
        onUpdateOnboardingData(currentData);
        if (result.outcome !== 'confirmed') {
          return {
            status: confirmedTransactionCount > 0 ? 'partial' as const : 'pending' as const,
            deletedTransactions: confirmedTransactionCount,
            totalTransactions: futureTransactions.length,
            message: `${confirmedTransactionCount} of ${futureTransactions.length} future-dated linked ledger items were confirmed deleted. The ${transaction.date} item (${transaction.payee}) is awaiting server confirmation; the recurring item was not ended and no later rows were attempted. ${preservedHistorySummary} Unrelated transactions were preserved.`,
          };
        }
        confirmedTransactionCount += 1;
      }
      // Re-read immediately before ending the bill. This catches transactions or
      // balance revisions that changed while the transaction deletions ran.
      const latestData = await loadUserOnboardingData(session);
      const latestRecords = await loadFinanceRecords({ session, userId: latestData.userId, currency: resolveCurrencyOption(latestData).code });
      if (latestData.userId !== session.user.id || latestRecords.snapshotStatus !== 'authoritative' || latestRecords.pendingWriteCount !== 0 || latestRecords.syncStatus !== 'synced') {
        throw new Error('A complete authoritative finance snapshot is unavailable after processing linked transactions. The recurring item was not ended; reload and review again.');
      }
      const latestBill = latestRecords.recurringBills.find(bill => bill.id === billId);
      if (!latestBill || !latestBill.active) throw new Error('The recurring item changed while linked transactions were processed. Review the refreshed bill before retrying.');
      const expectedRemainder = createRecurringBillDeletionPreview({
        transactions: currentTransactions, bill: freshBill, debts: currentData.debts,
        ownerId: currentData.userId, asOfDate: today,
      });
      const latestRemainder = createRecurringBillDeletionPreview({
        transactions: latestRecords.transactions, bill: latestBill, debts: latestData.debts,
        ownerId: latestData.userId, asOfDate: today,
      });
      if (expectedRemainder.snapshotToken !== latestRemainder.snapshotToken) {
        setTransactions(latestRecords.transactions);
        setRecurringBills(latestRecords.recurringBills);
        onUpdateOnboardingData(latestData);
        throw new Error('Linked transactions, the bill revision, or a debt balance revision changed during processing. The recurring item was not ended; review the refreshed details and confirm again.');
      }
      currentData = latestData;
      currentTransactions = latestRecords.transactions;
      setTransactions(currentTransactions);
      setRecurringBills(latestRecords.recurringBills);
      onUpdateOnboardingData(currentData);
      const result = await executeDeleteRecurringBill({
        session,
        userId: currentData.userId,
        billId,
        currentBills: latestRecords.recurringBills,
      });
      setRecurringBills(result.bills);
      if (result.syncResult.outcome === 'confirmed') {
        const scheduleKey = obligationScheduleKey('bill', billId);
        let cleanupData = currentData;
        const cleanupFailures: string[] = [];
        try {
          cleanupData = await removeObligationEditorSchedule({ current: cleanupData, key: scheduleKey, session });
          onUpdateOnboardingData(cleanupData);
        } catch (error) {
          cleanupFailures.push(`Schedule cleanup: ${error instanceof Error ? error.message : String(error)}`);
        }
        const loanBillPairingByDebtId = withoutDeletedBillPairings(cleanupData.loanBillPairingByDebtId, billId);
        if (Object.keys(loanBillPairingByDebtId).length !== Object.keys(cleanupData.loanBillPairingByDebtId ?? {}).length) {
          try {
            cleanupData = await saveUserOnboardingSettingsPatch(cleanupData, { loanBillPairingByDebtId }, session!);
            onUpdateOnboardingData(cleanupData);
          } catch (error) {
            cleanupFailures.push(`Loan/bill link cleanup: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        const recurringBillCategoryLabelByBillId = { ...(cleanupData.recurringBillCategoryLabelByBillId ?? {}) };
        delete recurringBillCategoryLabelByBillId[billId];
        if (Object.keys(recurringBillCategoryLabelByBillId).length !== Object.keys(cleanupData.recurringBillCategoryLabelByBillId ?? {}).length) {
          try {
            cleanupData = await saveUserOnboardingSettingsPatch(cleanupData, { recurringBillCategoryLabelByBillId }, session!);
            onUpdateOnboardingData(cleanupData);
          } catch (error) {
            cleanupFailures.push(`Custom category cleanup: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (cleanupFailures.length) {
          return {
            status: 'partial' as const,
            deletedTransactions: confirmedTransactionCount,
            totalTransactions: futureTransactions.length,
            billDeleted: true,
            message: `Recurring item deletion and ${confirmedTransactionCount} of ${futureTransactions.length} linked future transaction deletion(s) were confirmed. Cleanup was not atomic; ${cleanupFailures.join('; ')}. Remaining metadata is preserved in settings and backup for recovery. ${preservedHistorySummary}`,
          };
        }
        return { status: 'confirmed' as const, deletedTransactions: confirmedTransactionCount, totalTransactions: futureTransactions.length, billDeleted: true, message: `The recurring item ended. ${confirmedTransactionCount} future-cycle transaction(s) were confirmed deleted. ${preservedHistorySummary} Unrelated transactions were preserved.` };
      }
      return {
        status: 'pending' as const,
        deletedTransactions: confirmedTransactionCount,
        totalTransactions: futureTransactions.length,
        billDeleted: false,
        message: `${confirmedTransactionCount} of ${futureTransactions.length} future-dated linked ledger items were confirmed deleted. The recurring item's server deletion is pending; its schedule settings were kept for review. ${preservedHistorySummary} Unrelated transactions were preserved.`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to end recurring bill.';
      setLocalError(message);
      if (confirmedTransactionCount > 0) {
        return {
          status: 'partial' as const,
          deletedTransactions: confirmedTransactionCount,
          totalTransactions: futureTransactions.length,
          billDeleted: false,
          message: `${confirmedTransactionCount} of ${futureTransactions.length} future-dated linked ledger items were confirmed deleted. Processing stopped: ${message}. The recurring item remains active. ${preservedHistorySummary} Unrelated transactions were preserved.`,
        };
      }
      throw err;
    }
  };

  const handleSaveObligationSchedule = async (key: ObligationScheduleKey, schedule: ObligationSchedule) => {
    if (!onboardingData) throw new Error('Onboarding settings are unavailable. Reload and retry.');
    const saved = await saveObligationEditorSchedule({ current: onboardingData, key, schedule, session });
    onUpdateOnboardingData(saved);
  };

  const handleAddTransaction = async (tx: LedgerTransaction) => {
    if (!onboardingData) return { outcome: 'rejected' as const, syncStatus: 'cached_offline' as const };
    try {
      const res = await executeAddTransaction({
        session,
        onboardingData,
        transaction: tx,
        currentTransactions: transactions,
        currencyCode,
      });
      setTransactions(res.transactions);
      if (res.updatedOnboardingData) {
        onUpdateOnboardingData(res.updatedOnboardingData);
      }
      return { outcome: res.outcome, syncStatus: res.syncResult.syncStatus };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to record transaction.';
      setLocalError(msg);
      throw err;
    }
  };

  const handleUpdateTransaction = async (tx: LedgerTransaction) => {
    if (!onboardingData) return { outcome: 'rejected' as const, syncStatus: 'cached_offline' as const };
    try {
      const res = await executeUpdateTransaction({
        session,
        onboardingData,
        transaction: tx,
        currentTransactions: transactions,
        currencyCode,
      });
      setTransactions(res.transactions);
      if (res.updatedOnboardingData) {
        onUpdateOnboardingData(res.updatedOnboardingData);
      }
      return { outcome: res.outcome, syncStatus: res.syncResult.syncStatus };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to update transaction.';
      setLocalError(msg);
      throw err;
    }
  };

  const handleDeleteTransaction = async (txId: string) => {
    if (!onboardingData) return { outcome: 'rejected' as const, syncStatus: 'cached_offline' as const };
    try {
      const res = await executeDeleteTransaction({
        session,
        onboardingData,
        transactionId: txId,
        currentTransactions: transactions,
        currencyCode,
      });
      setTransactions(res.transactions);
      if (res.updatedOnboardingData) {
        onUpdateOnboardingData(res.updatedOnboardingData);
      }
      return { outcome: res.outcome, syncStatus: res.syncResult.syncStatus };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to delete transaction.';
      setLocalError(msg);
      throw err;
    }
  };

  const handleRecordBillPayment = async (bill: RecurringBill, dueCycle: DateOnly, amount?: Money) => {
    if (!onboardingData) return { outcome: 'rejected' as const, syncStatus: 'cached_offline' as const };
    try {
      const res = await executeRecordBillPayment({
        session,
        onboardingData,
        bill,
        dueCycle,
        amount,
        currencyCode,
        currentTransactions: transactions,
        householdTimeZone: onboardingData.householdTimeZone,
      });
      setTransactions(res.transactions);
      if (res.updatedOnboardingData) {
        onUpdateOnboardingData(res.updatedOnboardingData);
      }
      return { outcome: res.outcome, syncStatus: res.syncResult.syncStatus };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to record bill payment.';
      setLocalError(msg);
      throw err;
    }
  };

  const handleReconcileDebt = async (
    item: DebtItem,
    verifiedBalance: number,
    reason: 'interest_adjustment' | 'balance_adjustment' | 'credit_adjustment',
  ) => {
    if (!onboardingData) return { outcome: 'rejected' as const, syncStatus: 'cached_offline' as const };
    try {
      const res = await executeReconcileDebt({
        session,
        onboardingData,
        item,
        verifiedBalance,
        reason,
        currencyCode,
        currencySymbol,
        currentTransactions: transactions,
        currentAnchors: reconciliationAnchors,
      });
      setTransactions(res.transactions);
      setReconciliationAnchors(res.reconciliationAnchors);
      onUpdateOnboardingData(res.updatedOnboardingData);
      return { outcome: res.outcome, syncStatus: res.syncStatus };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reconcile debt.';
      setLocalError(msg);
      throw err;
    }
  };

  const payoffPlan = useMemo(() => {
    if (!onboardingData) return null;
    const parsedExtra = parseMoneyInput(extraPaymentInput, currencyCode);
    const effectiveExtra =
      stage === 'onboard_4' && parsedExtra !== null
        ? parsedExtra
        : onboardingData.extraMonthlyPayment;
    return calculatePayoffPlan(onboardingData.debts, onboardingData.strategy, effectiveExtra, new Date(), currencyCode);
  }, [onboardingData, extraPaymentInput, stage, currencyCode]);

  const clearErrors = () => {
    setLocalError('');
    if (authError) onClearAuthError();
  };

  const persistAndMove = async (
    patch: Partial<UserOnboardingData>,
    nextStage: FlowStage,
  ) => {
    if (!onboardingData || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setLocalError('');
    try {
      const updated = await saveUserOnboardingData({
        ...onboardingData,
        ...patch,
        currentStage: nextStage,
      });
      onUpdateOnboardingData(updated);
      onChangeStage(nextStage);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to save your progress. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const openNewDebtEditor = (category: DebtCategory) => {
    clearErrors();
    setOnboardingBillRecovery(null);
    const existingForUniqueType =
      category === 'Mortgage' || category === 'Auto loan'
        ? onboardingData?.debts.find(d => d.category === category)
        : undefined;

    if (existingForUniqueType) {
      openEditDebtEditor(existingForUniqueType);
      return;
    }

    setEditingDebtId(null);
    draftDebtIdRef.current = Crypto.randomUUID();
    draftDebtPaidTodayRef.current = {};
    setDebtCategory(category);
    setDebtName(
      category === 'Mortgage'
        ? 'Home Mortgage'
        : category === 'Auto loan'
          ? 'Auto Loan'
          : '',
    );
    setDebtBalance('');
    setDebtOriginalBalance('');
    setDebtApr('');
    setDebtMinimum('');
    setDebtDueDay('');
    setDebtCreditLimit('');
    setShowDebtForm(true);
  };

  const openEditDebtEditor = (item: DebtItem) => {
    clearErrors();
    setOnboardingBillRecovery(null);
    setEditingDebtId(item.id);
    draftDebtIdRef.current = null;
    draftDebtPaidTodayRef.current = {};
    setDebtCategory(item.category);
    setDebtName(item.name);
    setDebtBalance(formatEditableMoney(item.balance, currencyCode));
    setDebtOriginalBalance(item.originalBalance !== null ? formatEditableMoney(item.originalBalance, currencyCode) : '');
    setDebtApr(String(item.apr));
    setDebtMinimum(formatEditableMoney(item.minimumPayment, currencyCode));
    setDebtDueDay(item.dueDay !== null ? String(item.dueDay) : '');
    setDebtCreditLimit(item.creditLimit !== null ? formatEditableMoney(item.creditLimit, currencyCode) : '');
    setShowDebtForm(true);
  };

  const handleSaveDebt = async () => {
    if (!onboardingData || savingRef.current) return;
    clearErrors();
    const validation = validateDebtDraft({
      name: debtName,
      category: debtCategory,
      balanceRaw: debtBalance,
      originalBalanceRaw: debtOriginalBalance,
      aprRaw: debtApr,
      minimumPaymentRaw: debtMinimum,
      dueDayRaw: debtDueDay,
      creditLimitRaw: debtCreditLimit,
    }, currencyCode);
    if (!validation.valid) {
      setLocalError(validation.error);
      return;
    }

    const debtId = editingDebtId ?? (draftDebtIdRef.current ??= Crypto.randomUUID());
    const isDraftDebt = draftDebtIdRef.current === debtId;
    const existingDebt = onboardingData.debts.find(d => d.id === debtId);
    const dueDay = validation.debt.dueDay;
    const shouldCreateOnboardingBill = stage === 'onboard_3' && !onboardingData.onboardingCompleted &&
      (validation.debt.category === 'Mortgage' || validation.debt.category === 'Auto loan') && validation.debt.balance > 0;
    // Prevent duplicate rapid creation of identical debt name + category when not editing
    if (
      !editingDebtId &&
      onboardingData.debts.some(
        d =>
          d.id !== debtId &&
          d.name.toLowerCase() === validation.debt.name.toLowerCase() &&
          d.category === validation.debt.category,
      )
    ) {
      setLocalError(`"${validation.debt.name}" is already in your debt list.`);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const today = currentHouseholdDate(onboardingData.householdTimeZone);
    if (shouldCreateOnboardingBill && dueDay === null) {
      setLocalError('Enter the monthly due day so the linked recurring payment can keep its correct schedule.');
      return;
    }
      const key = obligationScheduleKey('debt', debtId);
      const priorSchedule = onboardingData.obligationSchedules?.[key];
      let paidToday = draftDebtPaidTodayRef.current[debtId] ?? false;
      if (dueDay !== null && draftDebtPaidTodayRef.current[debtId] === undefined && shouldAskPaidToday({
        dueDay, today, isNew: isDraftDebt, legacyDueDay: existingDebt?.dueDay, hasSchedule: Boolean(priorSchedule),
      })) {
        const answer = await confirmObligationPaidToday();
        if (answer === null) return;
        paidToday = answer;
        draftDebtPaidTodayRef.current[debtId] = answer;
      }

      const debtUnchanged = Boolean(existingDebt && existingDebt.name === validation.debt.name &&
        existingDebt.category === validation.debt.category && existingDebt.balance === validation.debt.balance &&
        existingDebt.originalBalance === validation.debt.originalBalance && existingDebt.apr === validation.debt.apr &&
        existingDebt.minimumPayment === validation.debt.minimumPayment && existingDebt.dueDay === validation.debt.dueDay &&
        existingDebt.creditLimit === validation.debt.creditLimit);
      const updated = debtUnchanged ? onboardingData : await upsertUserDebt(onboardingData, {
        id: debtId,
        ...validation.debt,
      });
      onUpdateOnboardingData(updated);
      let settingsData = updated;
      const savedDebt = updated.debts.find(debt => debt.id === debtId);
      const nextPairings = savedDebt
        ? withoutIncompatibleDebtPairing(updated.loanBillPairingByDebtId, savedDebt, recurringBills)
        : updated.loanBillPairingByDebtId;
      if (JSON.stringify(nextPairings) !== JSON.stringify(updated.loanBillPairingByDebtId ?? {})) {
        try {
          if (!session) throw new Error('Signed-in session is unavailable for settings cleanup.');
          settingsData = await saveUserOnboardingSettingsPatch(updated, { loanBillPairingByDebtId: nextPairings }, session);
          onUpdateOnboardingData(settingsData);
        } catch (error) {
          setLocalError(`Debt account saved, but its now-incompatible loan/bill link could not be cleared: ${error instanceof Error ? error.message : String(error)}. It remains preserved in settings and backup for recovery.`);
        }
      }
      if (dueDay !== null) {
        const schedule = prepareObligationEditorSchedule({
          kind: 'debt', id: debtId, today, timeZone: onboardingData.householdTimeZone,
          dueDay, amount: parseMoney(String(validation.debt.minimumPayment), currencyCode),
          legacyDueDay: existingDebt?.dueDay ?? undefined,
          legacyAmount: existingDebt?.dueDay !== null && existingDebt?.dueDay !== undefined
            ? parseMoney(String(existingDebt.minimumPayment), currencyCode)
            : undefined,
          createdAt: existingDebt?.createdAt ?? settingsData.debts.find(d => d.id === debtId)?.createdAt ?? new Date().toISOString(),
          isNew: isDraftDebt, paidToday, existing: priorSchedule,
        });
        const settings = await saveObligationEditorSchedule({ current: settingsData, key, schedule, session });
        settingsData = settings;
        onUpdateOnboardingData(settings);
      }
      if (shouldCreateOnboardingBill && savedDebt && dueDay !== null) {
        const bill = createOnboardingLoanBill(savedDebt, currencyCode, savedDebt.createdAt);
        const billScheduleKey = obligationScheduleKey('bill', bill.id);
        const currentBillSchedule = settingsData.obligationSchedules?.[billScheduleKey];
        const debtCycle = settingsData.obligationSchedules?.[key]
          ? getObligationCycle(settingsData.obligationSchedules[key], today.slice(0, 7))
          : null;
        const billSchedule = prepareObligationEditorSchedule({
          kind: 'bill', id: bill.id, today, timeZone: onboardingData.householdTimeZone,
          dueDay, amount: bill.amount, createdAt: bill.createdAt, isNew: !currentBillSchedule,
          paidToday: Boolean(debtCycle?.dueDate === today && debtCycle.acknowledgedPaid), existing: currentBillSchedule,
        });
        settingsData = await saveObligationEditorSchedule({ current: settingsData, key: billScheduleKey, schedule: billSchedule, session });
        onUpdateOnboardingData(settingsData);

        const existingBill = recurringBills.find(item => item.id === bill.id);
        const billSaveAction = onboardingLoanBillSaveAction({ existingBill, desiredBill: bill, authoritativeSnapshot: financeRecordsVerified });
        if (billSaveAction === 'wait_for_recovery') {
          setOnboardingBillRecovery('needed');
          setLocalError('The recurring item needs a safe server readback before another bill write. Use Refresh bill status below; no bill write was replayed.');
          return;
        }
        if (billSaveAction === 'conflict') {
          setOnboardingBillRecovery('conflict');
          setLocalError('The server has a recurring item with this account ID, but its details differ from this draft. No bill was changed. Refresh status again or resolve the server record before saving this linked payment.');
          return;
        }
        let billOutcome: 'confirmed' | 'pending';
        if (billSaveAction === 'reuse_confirmed') {
          billOutcome = 'confirmed';
        } else {
          // This is an explicit Save after a complete authoritative readback proved the ID absent.
          setOnboardingBillRecovery('needed');
          billOutcome = (await handleAddRecurringBill(bill)).outcome;
        }
        if (billOutcome !== 'confirmed') {
          setOnboardingBillRecovery('needed');
          setLocalError('The linked recurring item is still awaiting server confirmation. Refresh bill status below before retrying; no payment or debt balance change was created.');
          return;
        }
        setOnboardingBillRecovery(current => current ? 'confirmed' : null);
        const existingPairing = settingsData.loanBillPairingByDebtId?.[debtId];
        if (existingPairing?.status !== 'linked' || existingPairing.billId !== bill.id) {
          if (!session) throw new Error('Signed-in session is unavailable to confirm the loan payment link. The debt and recurring item are saved; retry from this onboarding step.');
          settingsData = await saveUserOnboardingSettingsPatch(settingsData, {
            loanBillPairingByDebtId: { ...(settingsData.loanBillPairingByDebtId ?? {}), [debtId]: { status: 'linked', billId: bill.id } },
          }, session);
          onUpdateOnboardingData(settingsData);
        }
      }
      setShowDebtForm(false);
      setEditingDebtId(null);
      draftDebtIdRef.current = null;
      delete draftDebtPaidTodayRef.current[debtId];
      setOnboardingBillRecovery(null);
    } catch (err) {
      if (shouldCreateOnboardingBill) setOnboardingBillRecovery(current => current ?? 'needed');
      setLocalError(err instanceof Error ? err.message : 'Unable to save debt account.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleRefreshOnboardingBillStatus = async () => {
    if (!onboardingData || onboardingBillRecovery === 'loading') return;
    if (!session || session.user.id !== onboardingData.userId) {
      setOnboardingBillRecovery('error');
      setLocalError('A matching signed-in session is required to refresh this bill. Reconnect, then refresh status again; no write was sent.');
      return;
    }
    setOnboardingBillRecovery('loading');
    setLocalError('');
    setVerifiedFinanceScope('');
    try {
      const freshData = await loadUserOnboardingData(session);
      if (freshData.userId !== session.user.id || freshData.userId !== onboardingData.userId) {
        throw new Error('The refreshed onboarding owner does not match this signed-in account. No changes were made.');
      }
      const freshRecords = await loadFinanceRecords({
        session,
        userId: freshData.userId,
        currency: resolveCurrencyOption(freshData).code,
      });
      onUpdateOnboardingData(freshData);
      if (freshRecords.snapshotStatus === 'authoritative' || freshRecords.snapshotStatus === 'authoritative_with_pending_writes') {
        setTransactions(freshRecords.transactions);
        setRecurringBills(freshRecords.recurringBills);
        setReconciliationAnchors(freshRecords.reconciliationAnchors);
      }
      const complete = freshRecords.snapshotStatus === 'authoritative' &&
        freshRecords.pendingWriteCount === 0 && freshRecords.syncStatus === 'synced';
      setVerifiedFinanceScope(complete
        ? `${session.user.id}:${freshData.userId}:${resolveCurrencyOption(freshData).code}`
        : '');
      if (!complete) {
        setOnboardingBillRecovery(freshRecords.failureKind ? 'error' : 'pending');
        setLocalError(freshRecords.error
          ? `Server readback failed: ${freshRecords.error.message}. The current form and draft ID are preserved; retry Refresh bill status when connected.`
          : freshRecords.pendingWriteCount > 0
            ? `${freshRecords.pendingWriteCount} financial change(s) still await confirmation. The server snapshot is not complete; retry Refresh bill status before saving the linked payment.`
            : 'A complete authoritative finance snapshot is unavailable. The current form and draft ID are preserved; retry Refresh bill status when connected.');
        return;
      }
      const debtId = draftDebtIdRef.current ?? editingDebtId;
      const freshDebt = debtId ? freshData.debts.find(debt => debt.id === debtId) : undefined;
      const draftValidation = validateDebtDraft({
        name: debtName, category: debtCategory, balanceRaw: debtBalance,
        originalBalanceRaw: debtOriginalBalance, aprRaw: debtApr,
        minimumPaymentRaw: debtMinimum, dueDayRaw: debtDueDay,
        creditLimitRaw: debtCreditLimit,
      }, resolveCurrencyOption(freshData).code);
      const expectedBill = freshDebt && draftValidation.valid
        ? createOnboardingLoanBill({ ...freshDebt, ...draftValidation.debt }, resolveCurrencyOption(freshData).code, freshDebt.createdAt)
        : null;
      const serverBill = debtId ? freshRecords.recurringBills.find(bill => bill.id === debtId) : undefined;
      if (!freshDebt) {
        setOnboardingBillRecovery('retry');
        setLocalError('The authoritative refresh completed, but the debt row is absent. Review the preserved form and press Save to retry with the same draft ID.');
      } else if (!draftValidation.valid) {
        setOnboardingBillRecovery('error');
        setLocalError(`The authoritative refresh completed, but the current form needs correction: ${draftValidation.error}. Your draft ID and paid-today answer are preserved.`);
      } else if (!expectedBill) {
        setOnboardingBillRecovery('error');
        setLocalError('The authoritative refresh completed, but the linked recurring item could not be compared safely. Correct the form or refresh again; no bill was changed.');
      } else {
        const action = onboardingLoanBillSaveAction({ existingBill: serverBill, desiredBill: expectedBill, authoritativeSnapshot: true });
        if (action === 'reuse_confirmed') {
          setOnboardingBillRecovery('confirmed');
          setLocalError('Server readback confirmed the recurring item matches this debt. Press Save to finish or confirm its link; no bill write is needed.');
        } else if (action === 'persist') {
          setOnboardingBillRecovery('retry');
          setLocalError('The authoritative server snapshot contains no recurring item with this draft ID. Press Save to retry once; the same ID will be used.');
        } else if (action === 'conflict') {
          setOnboardingBillRecovery('conflict');
          setLocalError('The server has a recurring item with this account ID, but its details differ from the saved debt. No bill was changed. Resolve that server record before saving this linked payment.');
        } else {
          setOnboardingBillRecovery('pending');
          setLocalError('The server returned a row without enough confirmation metadata to safely reuse it. Refresh status again or recover the record before saving.');
        }
      }
    } catch (error) {
      setOnboardingBillRecovery('error');
      setLocalError(`Authoritative readback failed: ${error instanceof Error ? error.message : String(error)}. The current form and draft ID are preserved; retry Refresh bill status when connected.`);
    }
  };

  const handleDeleteDebt = async (debtId: string) => {
    if (!onboardingData || savingRef.current) return;
    clearErrors();
    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await deleteUserDebt(onboardingData, debtId);
      onUpdateOnboardingData(updated);
      const loanBillPairingByDebtId = withoutDeletedDebtPairing(updated.loanBillPairingByDebtId, debtId);
      const mortgageEscrowByDebtId = { ...(updated.mortgageEscrowByDebtId ?? {}) };
      const mortgageExtraPaymentByDebtId = { ...(updated.mortgageExtraPaymentByDebtId ?? {}) };
      const obligationSchedules = { ...(updated.obligationSchedules ?? {}) };
      delete mortgageEscrowByDebtId[debtId];
      delete mortgageExtraPaymentByDebtId[debtId];
      delete obligationSchedules[obligationScheduleKey('debt', debtId)];
      const cleanupPatch: Partial<UserOnboardingData> = {
        ...(Object.keys(loanBillPairingByDebtId).length !== Object.keys(updated.loanBillPairingByDebtId ?? {}).length ? { loanBillPairingByDebtId } : {}),
        ...(Object.keys(mortgageEscrowByDebtId).length !== Object.keys(updated.mortgageEscrowByDebtId ?? {}).length ? { mortgageEscrowByDebtId } : {}),
        ...(Object.keys(mortgageExtraPaymentByDebtId).length !== Object.keys(updated.mortgageExtraPaymentByDebtId ?? {}).length ? { mortgageExtraPaymentByDebtId } : {}),
        ...(Object.keys(obligationSchedules).length !== Object.keys(updated.obligationSchedules ?? {}).length ? { obligationSchedules } : {}),
      };
      if (Object.keys(cleanupPatch).length) {
        try {
          if (!session) throw new Error('Signed-in session is unavailable for settings cleanup.');
          onUpdateOnboardingData(await saveUserOnboardingSettingsPatch(updated, cleanupPatch, session));
        } catch (error) {
          setLocalError(`Debt deletion was confirmed, but related settings cleanup could not be confirmed: ${error instanceof Error ? error.message : String(error)}. Export preserves the remaining metadata for recovery.`);
        }
      }
      if (editingDebtId === debtId) {
        setShowDebtForm(false);
        setEditingDebtId(null);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to remove debt account.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // ============================================================================
  // SCREEN 01: WELCOME SCREEN (signup_01.png)
  // ============================================================================
  if (stage === 'welcome') {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.welcomeScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.logoRow}>
            <View style={styles.logoBrand} accessible accessibilityRole="header" accessibilityLabel="DebtFree">
              <View style={styles.brandMark}>
                <AppIcon name="brandRise" size={16} color="#FFFFFF" />
              </View>
              <Text style={styles.logoText}>
                Debt<Text style={styles.logoTextAccent}>Free</Text>
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              hitSlop={10}
              onPress={() => {
                clearErrors();
                setSignInMode(true);
                onChangeStage('signup_1');
              }}
            >
              <Text style={styles.topSignInLink}>SIGN IN</Text>
            </Pressable>
          </View>

          <View style={styles.heroSection}>
            <View style={[styles.floatingCard, styles.floatingCardLeft]}>
              <Text style={styles.floatingCardLabel}>Monthly payments</Text>
              <Text style={styles.floatingCardValue}>$1,250</Text>
            </View>

            <View style={styles.orbitContainer}>
              <View style={styles.orbitBase} />
              <View style={styles.orbitArcTeal} />
              <View style={styles.orbitArcTerracotta} />
              <View style={styles.orbitCenter}>
                <Text style={styles.heroBigText}>42%</Text>
                <Text style={styles.heroMiniText}>debt payoff progress</Text>
              </View>
            </View>

            <View style={[styles.floatingCard, styles.floatingCardRight]}>
              <Text style={styles.floatingCardLabel}>{"You're making progress"}</Text>
              <View style={styles.floatingCardValueRow}>
                <AppIcon name="trendDown" size={14} color="#73D9C6" />
                <Text style={[styles.floatingCardValue, { marginTop: 0 }]}>$325 this month</Text>
              </View>
            </View>
          </View>

          <View style={styles.welcomeCopy}>
            <View style={styles.badgeSmall}>
              <Text style={styles.badgeSmallText}>BUILT FOR YOUR DEBT-FREE JOURNEY</Text>
            </View>
            <Text style={styles.welcomeTitle} accessibilityRole="header">
              {'Take control.\nPay off debt.'}
            </Text>
            <Text style={styles.welcomeSubtitle}>
              Bring your balances, bills and payoff plan together in one clear place.
            </Text>
          </View>

          <View style={styles.spacer} />

          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Get started"
              style={[styles.primaryButton, styles.primaryButtonHot]}
              onPress={() => {
                clearErrors();
                setSignInMode(false);
                onChangeStage('signup_1');
              }}
            >
              <Text style={styles.primaryButtonText}>Get started</Text>
            </Pressable>

            {onTestUserSignIn ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Preview app with prototype household"
                style={[styles.primaryButton, { backgroundColor: '#1E2C28', borderColor: '#81DFD2', borderWidth: 1, marginTop: 10 }]}
                onPress={onTestUserSignIn}
              >
                <Text style={[styles.primaryButtonText, { color: '#81DFD2' }]}>
                  Preview Prototype Household (Skip Sign-in)
                </Text>
              </Pressable>
            ) : null}

            <View style={styles.footerInlineRow}>
              <Text style={styles.footerNoteText}>Already have an account? </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign in to existing account"
                onPress={() => {
                  clearErrors();
                  setSignInMode(true);
                  onChangeStage('signup_1');
                }}
              >
                <Text style={styles.linkText}>Sign in</Text>
              </Pressable>
            </View>

            <Text style={styles.legalNote}>
              By continuing you agree to our Terms & Privacy Policy.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 02: SIGN-UP STEP 1 OF 4 — CREATE ACCOUNT / SIGN IN (signup_02.png)
  // ============================================================================
  if (stage === 'signup_1') {
    const googleDisabled = authBusy || !configured;
    const isSignedIn = Boolean(session?.user);

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Step"
          step={1}
          total={4}
          onBack={() => {
            clearErrors();
            onChangeStage('welcome');
          }}
        />
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <View style={styles.introBox}>
            <Text style={styles.introTitle} accessibilityRole="header">
              {signInMode ? 'Welcome back' : 'Create your account'}
            </Text>
            <Text style={styles.introSubtitle}>
              Securely sign in to save your balances and progress across devices.
            </Text>
          </View>

          {!configured ? (
            <View style={styles.calloutOrange}>
              <Text style={styles.calloutOrangeText} accessibilityRole="alert">
                A separate test sign-in service has not been configured yet.
              </Text>
              {__DEV__ && !!configProblem ? (
                <Text style={styles.helpText}>{configProblem}</Text>
              ) : null}
            </View>
          ) : null}

          {!!authNotice ? (
            <View style={styles.calloutTeal}>
              <Text style={styles.calloutTealText} accessibilityLiveRegion="polite">
                {authNotice}
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              authBusy
                ? 'Signing in with Google'
                : isSignedIn
                  ? 'Connected with Google — tap to switch account'
                  : 'Continue with Google'
            }
            accessibilityState={{ disabled: googleDisabled, busy: authBusy }}
            disabled={googleDisabled}
            style={[
              styles.providerButton,
              isSignedIn && styles.providerButtonConnected,
              googleDisabled && styles.disabledButton,
            ]}
            onPress={() => {
              clearErrors();
              void onGoogleSignIn();
            }}
          >
            {authBusy ? (
              <ActivityIndicator color="#58CBD0" />
            ) : (
              <>
                <Text style={styles.googleLetterIcon}>G</Text>
                <Text style={styles.providerButtonText}>
                  {isSignedIn ? 'Connected with Google' : 'Continue with Google'}
                </Text>
              </>
            )}
          </Pressable>

          {appleAvailable && configured ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
              cornerRadius={9}
              style={[styles.appleNativeButton, authBusy && styles.disabledButton]}
              onPress={() => {
                if (!authBusy) {
                  clearErrors();
                  void onAppleSignIn();
                }
              }}
            />
          ) : (
            <View style={[styles.providerButton, styles.providerButtonPassive]}>
              <AppleMark />
              <Text style={styles.providerButtonText}>Continue with Apple</Text>
            </View>
          )}

          {onTestUserSignIn ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Preview app with prototype household"
              style={[styles.providerButton, { backgroundColor: '#1E2C28', borderColor: '#81DFD2', borderWidth: 1, marginTop: 12 }]}
              onPress={onTestUserSignIn}
            >
              <AppIcon name="brandRise" size={16} color="#81DFD2" />
              <Text style={[styles.providerButtonText, { color: '#81DFD2', fontWeight: 'bold' }]}>
                Preview Prototype Household (Skip Auth)
              </Text>
            </Pressable>
          ) : null}

          <Text style={[styles.helpText, styles.textCenter]}>
            Apple sign-in appears only on supported devices.
          </Text>

          <View style={styles.hlineRow}>
            <View style={styles.hlineBar} />
            <Text style={styles.hlineLabel}>SECURE SIGN-IN</Text>
            <View style={styles.hlineBar} />
          </View>

          <View style={styles.calloutTeal}>
            <Text style={styles.calloutTealText}>
              Your financial details remain private. You decide what to add to DebtFree.
            </Text>
          </View>

          <View style={[styles.footerInlineRow, { marginTop: 24 }]}>
            <Text style={styles.helpText}>
              {signInMode ? 'Need to set up a new account? ' : 'Already have an account? '}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={signInMode ? 'Switch to Create account' : 'Switch to Sign in'}
              onPress={() => {
                clearErrors();
                setSignInMode(prev => !prev);
                if (!isSignedIn && !authBusy && configured) {
                  void onGoogleSignIn();
                }
              }}
            >
              <Text style={styles.linkText}>{signInMode ? 'Create account' : 'Sign in'}</Text>
            </Pressable>
          </View>

          {!!authError || !!localError ? (
            <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="assertive">
              {localError || authError}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue"
            accessibilityState={{ disabled: googleDisabled, busy: authBusy }}
            disabled={googleDisabled}
            style={[styles.primaryButton, googleDisabled && styles.disabledButton]}
            onPress={() => {
              clearErrors();
              if (isSignedIn) {
                onChangeStage(
                  onboardingData?.onboardingCompleted ? 'home' : 'signup_2',
                );
              } else {
                void onGoogleSignIn();
              }
            }}
          >
            <Text style={styles.primaryButtonText}>Continue</Text>
          </Pressable>
          <Text style={styles.footerNoteText}>
            Connect an account to continue. No bank connection required.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Require loaded onboardingData for all authenticated steps (signup_2..home)
  if (!onboardingData) {
    return (
      <SafeAreaView style={[styles.root, styles.centered]} edges={['top', 'bottom', 'left', 'right']}>
        <ActivityIndicator size="large" color="#58CBD0" />
        <Text style={[styles.helpText, { marginTop: 12 }]}>Loading your account setup…</Text>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 03: SIGN-UP STEP 2 OF 4 — YOUR GOALS (signup_03.png)
  // ============================================================================
  if (stage === 'signup_2') {
    const toggleGoal = (goal: string) => {
      clearErrors();
      const exists = onboardingData.goals.includes(goal);
      const nextGoals = exists
        ? onboardingData.goals.filter(g => g !== goal)
        : [...onboardingData.goals, goal];
      onUpdateOnboardingData({ ...onboardingData, goals: nextGoals });
    };

    const handleContinueStep2 = () => {
      const err = validateSignUpStep2(onboardingData.goals);
      if (err) {
        setLocalError(err);
        return;
      }
      void persistAndMove({ goals: onboardingData.goals }, 'signup_3');
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Step"
          step={2}
          total={4}
          onBack={() => {
            clearErrors();
            onChangeStage('signup_1');
          }}
        />
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <View style={styles.introBox}>
            <Text style={styles.introTitle} accessibilityRole="header">
              What brings you to DebtFree?
            </Text>
            <Text style={styles.introSubtitle}>
              Choose what matters most. We’ll use it to tailor your experience.
            </Text>
          </View>

          {SIGNUP_GOALS.map(goal => (
            <ChoiceButton
              key={goal}
              label={goal}
              selected={onboardingData.goals.includes(goal)}
              onPress={() => toggleGoal(goal)}
            />
          ))}

          <Text style={[styles.helpText, styles.textCenter, { marginTop: 12 }]}>
            You can select more than one.
          </Text>

          {!!localError ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {localError}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleContinueStep2}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 04: SIGN-UP STEP 3 OF 4 — HOW YOU FOUND US (signup_04.png)
  // ============================================================================
  if (stage === 'signup_3') {
    const isAiSelected = onboardingData.referralSource === AI_REFERRAL_SOURCE;

    const handleContinueStep3 = () => {
      const err = validateSignUpStep3(
        onboardingData.referralSource,
        onboardingData.consideredBeforeAi,
      );
      if (err) {
        setLocalError(err);
        return;
      }
      void persistAndMove(
        {
          referralSource: onboardingData.referralSource,
          consideredBeforeAi: isAiSelected ? onboardingData.consideredBeforeAi : null,
        },
        'signup_4',
      );
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Step"
          step={3}
          total={4}
          onBack={() => {
            clearErrors();
            onChangeStage('signup_2');
          }}
        />
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <View style={[styles.introBox, styles.introCompact]}>
            <Text style={[styles.introTitle, styles.introTitleCompact]} accessibilityRole="header">
              How did you hear about DebtFree?
            </Text>
            <Text style={styles.introSubtitle}>
              Your answer helps us understand what brought you here.
            </Text>
          </View>

          {REFERRAL_SOURCES.map(source => (
            <ChoiceButton
              key={source}
              label={source}
              selected={onboardingData.referralSource === source}
              onPress={() => {
                clearErrors();
                onUpdateOnboardingData({
                  ...onboardingData,
                  referralSource: source,
                  consideredBeforeAi:
                    source === AI_REFERRAL_SOURCE
                      ? onboardingData.consideredBeforeAi ?? 'no'
                      : null,
                });
              }}
            />
          ))}

          {isAiSelected ? (
            <View style={styles.calloutOrange}>
              <Text style={styles.calloutOrangeTitle}>If you chose AI</Text>
              <Text style={styles.calloutOrangeText}>
                Were you considering DebtFree before asking an AI assistant?
              </Text>
              <View style={[styles.choiceGrid2, { marginTop: 10 }]}>
                <ChoiceButton
                  label="Yes"
                  flex
                  selected={onboardingData.consideredBeforeAi === 'yes'}
                  onPress={() => {
                    clearErrors();
                    onUpdateOnboardingData({ ...onboardingData, consideredBeforeAi: 'yes' });
                  }}
                />
                <ChoiceButton
                  label="No"
                  flex
                  selected={onboardingData.consideredBeforeAi === 'no'}
                  onPress={() => {
                    clearErrors();
                    onUpdateOnboardingData({ ...onboardingData, consideredBeforeAi: 'no' });
                  }}
                />
              </View>
            </View>
          ) : null}

          {!!localError ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {localError}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleContinueStep3}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 05: SIGN-UP STEP 4 OF 4 — ABOUT YOU (signup_05.png)
  // ============================================================================
  if (stage === 'signup_4') {
    const handleStartOnboarding = () => {
      const err = validateSignUpStep4(
        onboardingData.managesWithPartner,
        onboardingData.worksWithProfessional,
      );
      if (err) {
        setLocalError(err);
        return;
      }
      void persistAndMove(
        {
          countryCode: onboardingData.countryCode,
          currencyCode,
          managesWithPartner: onboardingData.managesWithPartner,
          worksWithProfessional: onboardingData.worksWithProfessional,
          signupCompleted: true,
        },
        'onboard_1',
      );
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Step"
          step={4}
          total={4}
          onBack={() => {
            clearErrors();
            onChangeStage('signup_3');
          }}
        />
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <View style={styles.introBox}>
            <Text style={styles.introTitle} accessibilityRole="header">
              Tell us about yourself
            </Text>
            <Text style={styles.introSubtitle}>
              A few details help us build the right setup for you.
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Country and currency: ${countryInfo.label}`}
            style={styles.countrySelector}
            onPress={() => setShowCountryPicker(prev => !prev)}
          >
            <Text style={styles.countryFlagText}>{countryInfo.flag}</Text>
            <AppIcon name="chevronDown" size={16} color="#AAAAAA" />
          </Pressable>

          {showCountryPicker ? (
            <View style={styles.countryDropdown}>
              {COUNTRY_OPTIONS.map(opt => (
                <ChoiceButton
                  key={opt.code}
                  label={`${opt.flag}  ${opt.label}`}
                  selected={onboardingData.countryCode === opt.code}
                  onPress={() => {
                    onUpdateOnboardingData({
                      ...onboardingData,
                      countryCode: opt.code as CountryCode,
                      currencyCode: onboardingData.currencyCode ?? (onboardingData.debts.length || onboardingData.primaryIncomeAmount || onboardingData.additionalIncomes.length || onboardingData.extraMonthlyPayment ? currencyCode : opt.currency),
                    });
                    setShowCountryPicker(false);
                  }}
                />
              ))}
            </View>
          ) : null}

          <Text style={styles.fieldLabel}>Currency</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose currency" style={styles.countrySelector} onPress={() => setShowCurrencyPicker(prev => !prev)}>
            <Text style={styles.choiceText}>{currency.code} ({currency.symbol})</Text>
            <AppIcon name="chevronDown" size={16} color="#AAAAAA" />
          </Pressable>
          {showCurrencyPicker ? (
            <View style={styles.countryDropdown}>
              <TextInput accessibilityLabel="Search currencies" style={styles.textInputField} value={currencySearch} onChangeText={setCurrencySearch} placeholder="Search currency code" placeholderTextColor="#6E7571" />
              {CURRENCY_OPTIONS.filter(opt => (opt.code + ' ' + opt.label + ' ' + opt.symbol).toLowerCase().includes(currencySearch.toLowerCase())).map(opt => (
                <ChoiceButton key={opt.code} label={opt.code + ' (' + opt.symbol + ')'} selected={currencyCode === opt.code} onPress={() => { try { assertCurrencyChangeAllowed(onboardingData, opt.code, { transactions, recurringBills, reconciliationAnchors, complete: financeRecordsVerified }); onUpdateOnboardingData({ ...onboardingData, currencyCode: opt.code }); setLocalError(''); setShowCurrencyPicker(false); setCurrencySearch(''); } catch (error) { setLocalError(error instanceof Error ? error.message : 'Cannot change currency.'); } }} />
              ))}
            </View>
          ) : null}

          <Text style={styles.fieldLabel}>Do you manage finances with a partner?</Text>
          <View style={styles.choiceGrid2}>
            <ChoiceButton
              label="Yes"
              flex
              selected={onboardingData.managesWithPartner === true}
              onPress={() => {
                clearErrors();
                onUpdateOnboardingData({ ...onboardingData, managesWithPartner: true });
              }}
            />
            <ChoiceButton
              label="No"
              flex
              selected={onboardingData.managesWithPartner === false}
              onPress={() => {
                clearErrors();
                onUpdateOnboardingData({ ...onboardingData, managesWithPartner: false });
              }}
            />
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 24 }]}>
            Do you work with a financial professional?
          </Text>
          <View style={styles.choiceGrid2}>
            <ChoiceButton
              label="Yes"
              flex
              selected={onboardingData.worksWithProfessional === true}
              onPress={() => {
                clearErrors();
                onUpdateOnboardingData({ ...onboardingData, worksWithProfessional: true });
              }}
            />
            <ChoiceButton
              label="No"
              flex
              selected={onboardingData.worksWithProfessional === false}
              onPress={() => {
                clearErrors();
                onUpdateOnboardingData({ ...onboardingData, worksWithProfessional: false });
              }}
            />
          </View>

          <View style={[styles.calloutTeal, { marginTop: 28 }]}>
            <Text style={styles.calloutTealText}>
              Next, we’ll personalize your debt payoff plan in five short steps.
            </Text>
          </View>

          {!!localError ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {localError}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start onboarding"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleStartOnboarding}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Start onboarding</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 06: ONBOARDING SETUP 1 OF 5 — INCOME (onboard_01.png)
  // ============================================================================
  if (stage === 'onboard_1') {
    const parsedPrimary = parseMoneyInput(incomeInput, currencyCode) ?? 0;
    const primaryMonthly = normalizeMonthlyIncome(
      parsedPrimary,
      onboardingData.primaryPayFrequency,
      currencyCode,
    );
    const totalMonthlyIncome = calculateTotalMonthlyIncome(
      parsedPrimary,
      onboardingData.primaryPayFrequency,
      onboardingData.additionalIncomes,
      currencyCode,
    );

    const handleAddExtraIncome = () => {
      clearErrors();
      const nameTrimmed = extraIncomeName.trim();
      if (!nameTrimmed) {
        setLocalError('Enter a name for the additional income source (for example, Partner income).');
        return;
      }
      const parsedAmt = parseMoneyInput(extraIncomeAmount, currencyCode);
      if (parsedAmt === null || parsedAmt <= 0) {
        setLocalError('Enter an income amount greater than $0.');
        return;
      }
      const newSource: AdditionalIncomeSource = {
        id: Crypto.randomUUID(),
        name: nameTrimmed,
        amount: parsedAmt,
        frequency: extraIncomeFreq,
        monthlyAmount: normalizeMonthlyIncome(parsedAmt, extraIncomeFreq, currencyCode),
      };
      onUpdateOnboardingData({
        ...onboardingData,
        additionalIncomes: [...onboardingData.additionalIncomes, newSource],
      });
      setExtraIncomeName('');
      setExtraIncomeAmount('');
      setExtraIncomeFreq('monthly');
      setShowAddIncomeForm(false);
    };

    const handleRemoveExtraIncome = (id: string) => {
      clearErrors();
      onUpdateOnboardingData({
        ...onboardingData,
        additionalIncomes: onboardingData.additionalIncomes.filter(s => s.id !== id),
      });
    };

    const handleContinueIncome = () => {
      const check = validateIncomeStep(incomeInput, onboardingData.additionalIncomes, currencyCode);
      if (!check.valid) {
        setLocalError(check.error);
        return;
      }
      const monthly = normalizeMonthlyIncome(
        check.primaryAmount,
        onboardingData.primaryPayFrequency,
        currencyCode,
      );
      void persistAndMove(
        {
          primaryIncomeAmount: check.primaryAmount,
          primaryPayFrequency: onboardingData.primaryPayFrequency,
          primaryMonthlyIncome: monthly,
          additionalIncomes: onboardingData.additionalIncomes,
        },
        'onboard_2',
      );
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Setup"
          step={1}
          total={5}
          onBack={() => {
            clearErrors();
            onChangeStage('signup_4');
          }}
        />
        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
            <View style={styles.introBox}>
              <Text style={styles.introTitle} accessibilityRole="header">
                Let’s start with your income
              </Text>
              <Text style={styles.introSubtitle}>
                What is your monthly take-home income, after taxes?
              </Text>
            </View>

            <Text style={styles.fieldLabel}>Monthly take-home income</Text>
            <View style={styles.bigFieldBox}>
              <Text style={styles.bigFieldPrefix}>{currencySymbol}</Text>
              <TextInput
                accessibilityLabel="Take-home income amount"
                style={styles.bigFieldInput}
                keyboardType="decimal-pad"
                value={incomeInput}
                onChangeText={text => {
                  clearErrors();
                  setIncomeInput(prev => acceptMoneyEdit(prev, text, currencyCode));
                }}
                placeholder="5,200.00"
                placeholderTextColor="#6E7571"
              />
              <Text style={styles.fieldMutedUnit}>{currencyCode}</Text>
            </View>
            <Text style={styles.helpText}>
              {onboardingData.primaryPayFrequency === 'monthly'
                ? `Monthly equivalent: ${formatCurrency(primaryMonthly, currencyCode)}`
                : `${formatCurrency(parsedPrimary, currencyCode)} (${
                    PAY_FREQUENCY_OPTIONS.find(o => o.value === onboardingData.primaryPayFrequency)
                      ?.label ?? ''
                  }) = ${formatCurrency(primaryMonthly, currencyCode)} / month`}
            </Text>

            <Text style={styles.fieldLabel}>How often are you paid?</Text>
            <View style={styles.choiceGrid2}>
              {PAY_FREQUENCY_OPTIONS.slice(0, 2).map(opt => (
                <ChoiceButton
                  key={opt.value}
                  label={opt.label}
                  flex
                  selected={onboardingData.primaryPayFrequency === opt.value}
                  onPress={() => {
                    clearErrors();
                    onUpdateOnboardingData({
                      ...onboardingData,
                      primaryPayFrequency: opt.value,
                    });
                  }}
                />
              ))}
            </View>
            <View style={[styles.choiceGrid2, { marginTop: 8 }]}>
              {PAY_FREQUENCY_OPTIONS.slice(2, 4).map(opt => (
                <ChoiceButton
                  key={opt.value}
                  label={opt.label}
                  flex
                  selected={onboardingData.primaryPayFrequency === opt.value}
                  onPress={() => {
                    clearErrors();
                    onUpdateOnboardingData({
                      ...onboardingData,
                      primaryPayFrequency: opt.value,
                    });
                  }}
                />
              ))}
            </View>

            <Text style={styles.sectionTitle}>Other household income</Text>
            {onboardingData.additionalIncomes.map(source => (
              <View key={source.id} style={styles.addedItemCard}>
                <View style={styles.flex1}>
                  <Text style={styles.addedItemTitle}>{source.name}</Text>
                  <Text style={styles.addedItemSub}>
                    {`${formatCurrency(source.amount, currencyCode)} (${
                      PAY_FREQUENCY_OPTIONS.find(f => f.value === source.frequency)?.label ??
                      source.frequency
                    }) → ${formatCurrency(
                      normalizeMonthlyIncome(source.amount, source.frequency, currencyCode),
                      currencyCode,
                    )}/mo`}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${source.name}`}
                  onPress={() => handleRemoveExtraIncome(source.id)}
                >
                  <Text style={styles.removeActionText}>Remove</Text>
                </Pressable>
              </View>
            ))}

            {showAddIncomeForm ? (
              <View style={styles.inlineEditorCard}>
                <Text style={styles.inlineEditorTitle}>Add household income source</Text>
                <Text style={styles.fieldLabelSmall}>Source name</Text>
                <TextInput
                  accessibilityLabel="Additional income source name"
                  style={styles.textInputField}
                  value={extraIncomeName}
                  onChangeText={setExtraIncomeName}
                  placeholder="Partner salary or side income"
                  placeholderTextColor="#6E7571"
                />
                <Text style={styles.fieldLabelSmall}>Take-home amount</Text>
                <TextInput
                  accessibilityLabel="Additional income amount"
                  style={styles.textInputField}
                  keyboardType="decimal-pad"
                  value={extraIncomeAmount}
                  onChangeText={text => setExtraIncomeAmount(prev => acceptMoneyEdit(prev, text, currencyCode))}
                  placeholder="1500.00"
                  placeholderTextColor="#6E7571"
                />
                <Text style={styles.fieldLabelSmall}>Frequency</Text>
                <View style={styles.choiceGrid2}>
                  {PAY_FREQUENCY_OPTIONS.slice(0, 2).map(opt => (
                    <ChoiceButton
                      key={opt.value}
                      label={opt.label}
                      compact
                      flex
                      selected={extraIncomeFreq === opt.value}
                      onPress={() => setExtraIncomeFreq(opt.value)}
                    />
                  ))}
                </View>
                <View style={[styles.choiceGrid2, { marginTop: 6 }]}>
                  {PAY_FREQUENCY_OPTIONS.slice(2, 4).map(opt => (
                    <ChoiceButton
                      key={opt.value}
                      label={opt.label}
                      compact
                      flex
                      selected={extraIncomeFreq === opt.value}
                      onPress={() => setExtraIncomeFreq(opt.value)}
                    />
                  ))}
                </View>
                <View style={[styles.choiceGrid2, { marginTop: 12 }]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel adding income"
                    style={styles.subtleActionBtn}
                    onPress={() => setShowAddIncomeForm(false)}
                  >
                    <Text style={styles.subtleActionBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save income source"
                    style={styles.saveInlineBtn}
                    onPress={handleAddExtraIncome}
                  >
                    <Text style={styles.saveInlineBtnText}>Add income</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add another income source"
                style={styles.smallAddButton}
                onPress={() => {
                  clearErrors();
                  setShowAddIncomeForm(true);
                }}
              >
                <AppIcon name="add" size={18} color="#81D8CF" />
                <Text style={styles.smallAddText}>Add another income source</Text>
              </Pressable>
            )}

            {onboardingData.additionalIncomes.length > 0 ? (
              <View style={styles.summaryRowBox}>
                <Text style={styles.summaryRowLabel}>Total monthly household income</Text>
                <Text style={styles.summaryRowValue}>
                  {formatCurrency(totalMonthlyIncome, currencyCode)}
                </Text>
              </View>
            ) : null}

            <View style={styles.calloutTeal}>
              <Text style={styles.calloutTealText}>
                Income helps estimate what you might be able to put toward debt. You remain in
                control of your payment amounts.
              </Text>
            </View>

            {!!localError ? (
              <Text style={styles.errorText} accessibilityRole="alert">
                {localError}
              </Text>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleContinueIncome}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 07: ONBOARDING SETUP 2 OF 5 — CHOOSE PREMIUM (onboard_02.png)
  // ============================================================================
  if (stage === 'onboard_2') {
    const selectPlan = (plan: PremiumPlanChoice) => {
      clearErrors();
      onUpdateOnboardingData({ ...onboardingData, selectedPlan: plan });
    };

    const handleContinuePremium = () => {
      void persistAndMove({ selectedPlan: onboardingData.selectedPlan }, 'onboard_3');
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Setup"
          step={2}
          total={5}
          onBack={() => {
            clearErrors();
            onChangeStage('onboard_1');
          }}
        />
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <View style={[styles.introBox, styles.introCompact]}>
            <Text style={[styles.introTitle, styles.introTitleCompact]} accessibilityRole="header">
              Choose how you’d like to track
            </Text>
            <Text style={styles.introSubtitle}>
              Start with manual tracking or add optional bank account syncing.
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: onboardingData.selectedPlan === 'premium' }}
            accessibilityLabel="DebtFree Premium"
            style={[
              styles.planCard,
              onboardingData.selectedPlan === 'premium' && styles.planCardSelected,
            ]}
            onPress={() => selectPlan('premium')}
          >
            <View style={styles.planHead}>
              <Text style={styles.planTitle}>DebtFree Premium</Text>
              <View style={styles.planChip}>
                <Text style={styles.planChipText}>
                  {onboardingData.selectedPlan === 'premium' ? 'SELECTED' : 'MANUAL'}
                </Text>
              </View>
            </View>
            <Text style={styles.planDescription}>
              Stay in control with simple manual updates.
            </Text>
            <View style={styles.planBulletRow}>
              <AppIcon name="check" size={13} color="#7DD3C9" style={styles.planBulletIcon} />
              <Text style={styles.planBulletText}>Track debts and payments</Text>
            </View>
            <View style={styles.planBulletRow}>
              <AppIcon name="check" size={13} color="#7DD3C9" style={styles.planBulletIcon} />
              <Text style={styles.planBulletText}>Snowball & Avalanche strategies</Text>
            </View>
            <View style={styles.planBulletRow}>
              <AppIcon name="check" size={13} color="#7DD3C9" style={styles.planBulletIcon} />
              <Text style={styles.planBulletText}>Budget, progress and reminders</Text>
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: onboardingData.selectedPlan === 'premium_bank_sync' }}
            accessibilityLabel="Premium plus Bank Sync"
            style={[
              styles.planCard,
              onboardingData.selectedPlan === 'premium_bank_sync' && styles.planCardSelected,
            ]}
            onPress={() => selectPlan('premium_bank_sync')}
          >
            <View style={styles.planHead}>
              <Text style={styles.planTitle}>Premium + Bank Sync</Text>
              <View style={styles.planChip}>
                <Text style={styles.planChipText}>
                  {onboardingData.selectedPlan === 'premium_bank_sync' ? 'SELECTED' : 'OPTIONAL'}
                </Text>
              </View>
            </View>
            <Text style={styles.planDescription}>
              Everything in Premium, plus account connections.
            </Text>
            <View style={styles.planBulletRow}>
              <AppIcon name="check" size={13} color="#7DD3C9" style={styles.planBulletIcon} />
              <Text style={styles.planBulletText}>Automatic balance updates</Text>
            </View>
            <View style={styles.planBulletRow}>
              <AppIcon name="check" size={13} color="#7DD3C9" style={styles.planBulletIcon} />
              <Text style={styles.planBulletText}>Sync supported bank accounts</Text>
            </View>
            <View style={styles.planBulletRow}>
              <AppIcon name="check" size={13} color="#7DD3C9" style={styles.planBulletIcon} />
              <Text style={styles.planBulletText}>Review imported activity</Text>
            </View>
          </Pressable>

          <Text style={[styles.helpText, styles.textCenter]}>
            Pricing will be shown before purchase. Bank connection requires your permission.
          </Text>

          {onboardingData.selectedPlan === 'premium_bank_sync' ? (
            <View style={styles.calloutOrange}>
              <Text style={styles.calloutOrangeTitle}>Sandbox preview note</Text>
              <Text style={styles.calloutOrangeText}>
                Live store billing and bank-sync aggregation are not enabled in this test build. No
                charge or bank connection will occur now — your preference is saved and you can
                continue setting up your debts manually.
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue with Premium"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleContinuePremium}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue with Premium</Text>
            )}
          </Pressable>
          <Text style={styles.footerNoteText}>
            You can choose syncing later. No account is connected now.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 08: ONBOARDING SETUP 3 OF 5 — ADD YOUR DEBTS (onboard_03.png)
  // ============================================================================
  if (stage === 'onboard_3') {
    const mortgageDebt = onboardingData.debts.find(d => d.category === 'Mortgage');
    const autoLoanDebt = onboardingData.debts.find(d => d.category === 'Auto loan');
    const otherDebts = onboardingData.debts.filter(
      d => d.category !== 'Mortgage' && d.category !== 'Auto loan',
    );

    const handleVehicleStatus = (status: VehicleOwnershipStatus) => {
      clearErrors();
      onUpdateOnboardingData({ ...onboardingData, vehicleStatus: status });
      if (status === 'Finance' && !autoLoanDebt) {
        openNewDebtEditor('Auto loan');
      }
    };

    const handleContinueDebts = () => {
      const unlinkedLoan = onboardingData.debts.find(debt => {
        if ((debt.category !== 'Mortgage' && debt.category !== 'Auto loan') || debt.balance <= 0) return false;
        const relation = onboardingData.loanBillPairingByDebtId?.[debt.id];
        return relation?.status !== 'linked' || !recurringBills.some(bill => bill.id === relation.billId && bill.active);
      });
      if (unlinkedLoan) {
        setLocalError(`${unlinkedLoan.name} still needs its linked recurring payment confirmed. Reopen its editor, refresh bill status, and retry or resolve the server record before continuing setup.`);
        return;
      }
      const err = validateDebtsStep(
        onboardingData.homeStatus,
        onboardingData.vehicleStatus,
        onboardingData.debts,
      );
      if (err) {
        setLocalError(err);
        return;
      }
      void persistAndMove(
        {
          homeStatus: onboardingData.homeStatus,
          vehicleStatus: onboardingData.vehicleStatus,
          debts: onboardingData.debts,
        },
        'onboard_4',
      );
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Setup"
          step={3}
          total={5}
          onBack={() => {
            clearErrors();
            onChangeStage('onboard_2');
          }}
        />
        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
            <View style={[styles.introBox, styles.introCompact]}>
              <Text style={[styles.introTitle, styles.introTitleCompact]} accessibilityRole="header">
                Let’s add your debts
              </Text>
              <Text style={styles.introSubtitle}>
                Tell us what you own or pay for. We’ll only add a debt when a balance is owed.
              </Text>
            </View>

            <Text style={styles.splitLabel}>Your vehicle</Text>
            <View style={styles.splitGrid4}>
              {(['Finance', 'Lease', 'Own', 'None'] as VehicleOwnershipStatus[]).map(status => (
                <ChoiceButton
                  key={status}
                  label={status}
                  compact
                  flex
                  selected={onboardingData.vehicleStatus === status}
                  onPress={() => handleVehicleStatus(status)}
                />
              ))}
            </View>

            <Text style={styles.sectionTitle}>Accounts to add</Text>

            {/* Home / Mortgage Row */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Home mortgage — Balance, APR and payment"
              style={[styles.twoRowCard, Boolean(mortgageDebt) && styles.twoRowCardSelected]}
              onPress={() => openNewDebtEditor('Mortgage')}
            >
              <View style={styles.twoRowLeft}>
                <View style={styles.iconCircle}><AppIcon name="homeLoan" size={18} color="#91DED7" /></View>
                <View style={styles.flex1}>
                  <Text style={styles.twoRowTitle}>Home / Mortgage</Text>
                  <Text style={styles.twoRowSub}>{mortgageDebt
                    ? `${mortgageDebt.name} · ${formatCurrency(mortgageDebt.balance, currencyCode)} · ${mortgageDebt.apr}% APR`
                    : 'Balance, APR & monthly payment'}</Text>
                </View>
              </View>
              <View style={[styles.selectCircle, Boolean(mortgageDebt) && styles.selectCircleSelected]}>
                <AppIcon name={mortgageDebt ? 'check' : 'plus'} size={11} color="#FFFFFF" />
              </View>
            </Pressable>

            {/* Auto Loan Row */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Auto loan — Balance, APR and payment"
              style={[
                styles.twoRowCard,
                (onboardingData.vehicleStatus === 'Finance' || Boolean(autoLoanDebt)) &&
                  styles.twoRowCardSelected,
              ]}
              onPress={() => openNewDebtEditor('Auto loan')}
            >
              <View style={styles.twoRowLeft}>
                <View style={styles.iconCircle}>
                  <AppIcon name="auto" size={18} color="#91DED7" />
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.twoRowTitle}>Auto loan</Text>
                  <Text style={styles.twoRowSub}>
                    {autoLoanDebt
                      ? `${autoLoanDebt.name} Â· ${formatCurrency(autoLoanDebt.balance, currencyCode)} Â· ${autoLoanDebt.apr}% APR`
                      : 'Balance, APR & payment'}
                  </Text>
                </View>
              </View>
              <View
                style={[
                  styles.selectCircle,
                  (onboardingData.vehicleStatus === 'Finance' || Boolean(autoLoanDebt)) &&
                    styles.selectCircleSelected,
                ]}
              >
                <AppIcon
                  name={Boolean(autoLoanDebt) || onboardingData.vehicleStatus === 'Finance' ? 'check' : 'plus'}
                  size={11}
                  color="#FFFFFF"
                />
              </View>
            </Pressable>

            {/* Credit cards & other loans Row */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Credit cards and other loans — Add each account"
              style={[
                styles.twoRowCard,
                otherDebts.length > 0 && styles.twoRowCardSelected,
              ]}
              onPress={() => openNewDebtEditor('Credit card')}
            >
              <View style={styles.twoRowLeft}>
                <View style={styles.iconCircle}>
                  <AppIcon name="creditCard" size={18} color="#91DED7" />
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.twoRowTitle}>Credit cards & other loans</Text>
                  <Text style={styles.twoRowSub}>
                    {otherDebts.length > 0
                      ? `${otherDebts.length} account${otherDebts.length === 1 ? '' : 's'} added Â· Tap to add another`
                      : 'Add each account'}
                  </Text>
                </View>
              </View>
              <AppIcon name="add" size={20} color="#8EE2D5" />
            </Pressable>

            {/* Inline Debt Form */}
            {showDebtForm ? (
              <View style={styles.inlineEditorCard}>
                <Text style={styles.inlineEditorTitle}>
                  {editingDebtId ? 'Edit debt account' : `Add ${debtCategory}`}
                </Text>

                <SelectDropdown
                  label="Account category"
                  sheetTitle="Select Debt Category"
                  value={debtCategory}
                  options={DEBT_CATEGORY_DROPDOWN_OPTIONS}
                  onSelect={setDebtCategory}
                />

                <Text style={styles.fieldLabelSmall}>Debt name</Text>
                <TextInput
                  accessibilityLabel="Debt name"
                  style={styles.textInputField}
                  value={debtName}
                  onChangeText={setDebtName}
                  placeholder="e.g., Chase Freedom, Auto Loan"
                  placeholderTextColor="#6E7571"
                />

                <View style={styles.choiceGrid2}>
                  <View style={styles.flex1}>
                    <Text style={styles.fieldLabelSmall}>Current balance ({currencySymbol})</Text>
                    <TextInput
                      accessibilityLabel="Current balance"
                      style={styles.textInputField}
                      keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric"}
                      value={debtBalance}
                      onChangeText={text => setDebtBalance(prev => acceptMoneyEdit(prev, text, currencyCode, true))}
                      placeholder="4200.00"
                      placeholderTextColor="#6E7571"
                    />
                  </View>
                  <View style={styles.flex1}>
                    <Text style={styles.fieldLabelSmall}>APR (%)</Text>
                    <TextInput
                      accessibilityLabel="APR percentage"
                      style={styles.textInputField}
                      keyboardType="decimal-pad"
                      value={debtApr}
                      onChangeText={text => setDebtApr(prev => acceptAprEdit(prev, text))}
                      placeholder="19.99"
                      placeholderTextColor="#6E7571"
                    />
                  </View>
                </View>

                <View style={styles.choiceGrid2}>
                  <View style={styles.flex1}>
                    <Text style={styles.fieldLabelSmall}>Minimum payment ({currencySymbol}/mo)</Text>
                    <TextInput
                      accessibilityLabel="Minimum monthly payment"
                      style={styles.textInputField}
                      keyboardType="decimal-pad"
                      value={debtMinimum}
                      onChangeText={text => setDebtMinimum(prev => acceptMoneyEdit(prev, text, currencyCode))}
                      placeholder="125.00"
                      placeholderTextColor="#6E7571"
                    />
                  </View>
                  <View style={styles.flex1}>
                  <Text style={styles.fieldLabelSmall}>{!onboardingData.onboardingCompleted && (debtCategory === 'Mortgage' || debtCategory === 'Auto loan') ? 'Monthly due day (1–31, required)' : 'Due day (1–31, optional)'}</Text>
                    <TextInput
                      accessibilityLabel="Due day of month"
                      style={styles.textInputField}
                      keyboardType="number-pad"
                      value={debtDueDay}
                      onChangeText={setDebtDueDay}
                      placeholder="15"
                      placeholderTextColor="#6E7571"
                    />
                  </View>
                </View>

                {!editingDebtId && Number.isInteger(Number(debtDueDay)) && Number(debtDueDay) >= 1 && Number(debtDueDay) <= 31 ? (
                  <Text style={styles.fieldLabelSmall}>{`First due date: ${obligationFirstDueDate(Number(debtDueDay), currentHouseholdDate(onboardingData.householdTimeZone), currencyCode)}`}</Text>
                ) : null}

                {debtCategory === 'Credit card' ? (
                  <>
                    <Text style={styles.fieldLabelSmall}>Credit limit ({currencySymbol}, optional)</Text>
                    <TextInput
                      accessibilityLabel="Credit limit"
                      style={styles.textInputField}
                      keyboardType="decimal-pad"
                      value={debtCreditLimit}
                      onChangeText={text => setDebtCreditLimit(prev => acceptMoneyEdit(prev, text, currencyCode))}
                      placeholder="10000.00"
                      placeholderTextColor="#6E7571"
                    />
                  </>
                ) : (
                  <>
                    <Text style={styles.fieldLabelSmall}>
                      Original loan balance ({currencySymbol}, optional)
                    </Text>
                    <TextInput
                      accessibilityLabel="Original loan balance"
                      style={styles.textInputField}
                      keyboardType="decimal-pad"
                      value={debtOriginalBalance}
                      onChangeText={text => setDebtOriginalBalance(prev => acceptMoneyEdit(prev, text, currencyCode))}
                      placeholder="25000.00"
                      placeholderTextColor="#6E7571"
                    />
                  </>
                )}

                {onboardingBillRecovery ? (
                  <View style={[styles.calloutOrange, { marginTop: 12 }]}>
                    <Text style={styles.calloutOrangeTitle}>
                      {onboardingBillRecovery === 'loading' ? 'Checking server status' :
                        onboardingBillRecovery === 'confirmed' ? 'Recurring item confirmed' :
                          onboardingBillRecovery === 'retry' ? 'Safe retry available' :
                            onboardingBillRecovery === 'conflict' ? 'Server record conflict' :
                              onboardingBillRecovery === 'error' ? 'Readback error' :
                                'Confirmation still pending'}
                    </Text>
                    <Text style={styles.calloutOrangeText}>
                      {onboardingBillRecovery === 'loading'
                        ? 'Reading your authenticated onboarding and finance records. Your form, draft ID, and paid-today answer are being kept.'
                        : onboardingBillRecovery === 'confirmed'
                          ? 'The server row matches this draft. Press Save to finish the link; no recurring item will be recreated.'
                          : onboardingBillRecovery === 'retry'
                            ? 'A complete server snapshot found no row for this draft ID. Press Save to retry once with the same ID.'
                            : onboardingBillRecovery === 'conflict'
                              ? `A server row exists with this ID but has different details. No bill will be overwritten or duplicated. Adjust the draft to the server row shown here, then Save to reuse it, or recover the server record. ${(() => { const row = recurringBills.find(bill => bill.id === (draftDebtIdRef.current ?? editingDebtId)); return row ? `Server row: ${row.name}, ${formatCurrency(moneyToMajor(row.amount), currencyCode)} monthly, due day ${row.dueDay}.` : ''; })()}`
                              : onboardingBillRecovery === 'error'
                                ? 'The server could not be verified. Retry this readback when connected; no mutation was replayed.'
                                : 'The server state is not yet conclusive. Refresh again before retrying Save; no mutation was replayed.'}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Refresh bill status from server"
                      disabled={onboardingBillRecovery === 'loading' || saving}
                      style={[styles.subtleActionBtn, { marginTop: 10, alignSelf: 'flex-start' }, (onboardingBillRecovery === 'loading' || saving) && styles.disabledButton]}
                      onPress={() => void handleRefreshOnboardingBillStatus()}
                    >
                      {onboardingBillRecovery === 'loading'
                        ? <ActivityIndicator color="#FFFFFF" size="small" />
                        : <Text style={styles.subtleActionBtnText}>Refresh bill status</Text>}
                    </Pressable>
                  </View>
                ) : null}

                <View style={[styles.choiceGrid2, { marginTop: 14 }]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel debt form"
                    style={styles.subtleActionBtn}
                    onPress={() => {
                      clearErrors();
                      setShowDebtForm(false);
                      setEditingDebtId(null);
                      draftDebtIdRef.current = null;
                      draftDebtPaidTodayRef.current = {};
                      setOnboardingBillRecovery(null);
                    }}
                  >
                    <Text style={styles.subtleActionBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save debt account"
                    disabled={saving}
                    style={[styles.saveInlineBtn, saving && styles.disabledButton]}
                    onPress={() => void handleSaveDebt()}
                  >
                    {saving ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.saveInlineBtnText}>Save debt</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : null}

            {/* Added Debts List */}
            {onboardingData.debts.length > 0 ? (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.sectionTitle}>
                  Added accounts ({onboardingData.debts.length})
                </Text>
                {onboardingData.debts.map(item => (
                  <View key={item.id} style={styles.addedItemCard}>
                    <View style={styles.flex1}>
                      <Text style={styles.addedItemTitle}>
                        {`${item.name} Â· ${item.category}`}
                      </Text>
                      <Text style={styles.addedItemSub}>
                        {`${formatCurrency(item.balance, currencyCode)} balance Â· ${item.apr}% APR Â· ${formatCurrency(item.minimumPayment, currencyCode)}/mo min${
                          item.dueDay ? ` Â· Due day ${item.dueDay}` : ''
                        }`}
                      </Text>
                    </View>
                    <View style={styles.addedItemActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${item.name}`}
                        onPress={() => openEditDebtEditor(item)}
                      >
                        <Text style={styles.editActionText}>Edit</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.name}`}
                        onPress={() => void handleDeleteDebt(item.id)}
                      >
                        <Text style={styles.removeActionText}>Remove</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            <Text style={styles.helpText}>
              Rent and vehicles owned outright are not counted as debt.
            </Text>

            {!!localError ? (
              <Text style={styles.errorText} accessibilityRole="alert">
                {localError}
              </Text>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleContinueDebts}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 09: ONBOARDING SETUP 4 OF 5 — PAYOFF STRATEGY (onboard_04.png)
  // ============================================================================
  if (stage === 'onboard_4') {
    const selectStrategy = (strategy: PayoffStrategy) => {
      clearErrors();
      onUpdateOnboardingData({ ...onboardingData, strategy });
    };

    const handleContinueStrategy = () => {
      const check = validateExtraPaymentInput(extraPaymentInput, currencyCode);
      if (!check.valid) {
        setLocalError(check.error);
        return;
      }
      void persistAndMove(
        {
          strategy: onboardingData.strategy,
          extraMonthlyPayment: check.extraMonthlyPayment,
        },
        'onboard_5',
      );
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Setup"
          step={4}
          total={5}
          onBack={() => {
            clearErrors();
            onChangeStage('onboard_3');
          }}
        />
        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
            <View style={[styles.introBox, styles.introCompact]}>
              <Text style={[styles.introTitle, styles.introTitleCompact]} accessibilityRole="header">
                Choose your payoff strategy
              </Text>
              <Text style={styles.introSubtitle}>
                Pick the approach that fits you. You can change it later.
              </Text>
            </View>

            {/* Debt Snowball */}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: onboardingData.strategy === 'snowball' }}
              accessibilityLabel="Debt Snowball — Pay off the smallest balance first"
              style={[
                styles.twoRowCard,
                { padding: 14 },
                onboardingData.strategy === 'snowball' && styles.twoRowCardSelected,
              ]}
              onPress={() => selectStrategy('snowball')}
            >
              <View style={styles.twoRowLeft}>
                <View style={styles.iconCircle}>
                  <AppIcon name="snowball" size={18} color="#91DED7" />
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.twoRowTitle}>Debt Snowball</Text>
                  <Text style={styles.twoRowSub}>Pay off the smallest balance first</Text>
                </View>
              </View>
              <View
                style={[
                  styles.selectCircle,
                  onboardingData.strategy === 'snowball' && styles.selectCircleSelected,
                ]}
              >
                {onboardingData.strategy === 'snowball' ? (
                  <AppIcon name="check" size={11} color="#FFFFFF" />
                ) : null}
              </View>
            </Pressable>

            {/* Debt Avalanche */}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: onboardingData.strategy === 'avalanche' }}
              accessibilityLabel="Debt Avalanche — Target the highest interest rate"
              style={[
                styles.twoRowCard,
                { padding: 14 },
                onboardingData.strategy === 'avalanche' && styles.twoRowCardSelected,
              ]}
              onPress={() => selectStrategy('avalanche')}
            >
              <View style={styles.twoRowLeft}>
                <View style={styles.iconCircle}>
                  <AppIcon name="avalanche" size={18} color="#91DED7" />
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.twoRowTitle}>Debt Avalanche</Text>
                  <Text style={styles.twoRowSub}>Target the highest interest rate</Text>
                </View>
              </View>
              <View
                style={[
                  styles.selectCircle,
                  onboardingData.strategy === 'avalanche' && styles.selectCircleSelected,
                ]}
              >
                {onboardingData.strategy === 'avalanche' ? (
                  <AppIcon name="check" size={11} color="#FFFFFF" />
                ) : null}
              </View>
            </Pressable>

            <Text style={[styles.fieldLabel, { marginTop: 22 }]}>
              Estimated extra payment per month
            </Text>
            <View style={styles.bigFieldBox}>
              <Text style={styles.bigFieldPrefix}>{currencySymbol}</Text>
              <TextInput
                accessibilityLabel="Estimated extra payment per month"
                style={styles.bigFieldInput}
                keyboardType="decimal-pad"
                value={extraPaymentInput}
                onChangeText={text => {
                  clearErrors();
                  setExtraPaymentInput(prev => acceptMoneyEdit(prev, text, currencyCode));
                }}
                placeholder="150.00"
                placeholderTextColor="#6E7571"
              />
              <Text style={styles.fieldMutedUnit}>/ month</Text>
            </View>
            <Text style={styles.helpText}>
              Enter $0 if you don’t plan to make extra payments.
            </Text>

            {payoffPlan && payoffPlan.payoffOrder.length > 0 ? (
              <View style={styles.strategyPreviewCard}>
                <Text style={styles.strategyPreviewHeading}>
                  {onboardingData.strategy === 'snowball'
                    ? 'Snowball plan preview'
                    : 'Avalanche plan preview'}
                </Text>
                <Text style={styles.strategyPreviewLine}>
                  {`First target: ${payoffPlan.firstTarget?.name ?? 'None'} (${formatCurrency(
                    payoffPlan.firstTarget?.firstMonthPayment ?? 0,
                    currencyCode,
                  )}/mo)`}
                </Text>
                <Text style={styles.strategyPreviewLine}>
                  {`Total monthly plan: ${formatCurrency(
                    payoffPlan.monthlyTotalPayment,
                    currencyCode,
                  )} Â· Tracked-account forecast: ${payoffPlan.debtFreeDateLabel}${
                    payoffPlan.monthsToPayoff !== null
                      ? ` (${payoffPlan.monthsToPayoff} mo)`
                      : ''
                  }`}
                </Text>
              </View>
            ) : null}

            <View style={[styles.calloutTeal, { marginTop: 18 }]}>
              <Text style={styles.calloutTealText}>
                We’ll use your debts and extra payment estimate to prepare a payoff plan. This
                won’t schedule or send payments.
              </Text>
            </View>

            {!!localError ? (
              <Text style={styles.errorText} accessibilityRole="alert">
                {localError}
              </Text>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleContinueStrategy}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 10: ONBOARDING SETUP 5 OF 5 — NOTIFICATIONS (onboard_05.png)
  // ============================================================================
  if (stage === 'onboard_5') {
    const prefs = onboardingData.notifications;

    const toggleNotificationPref = (
      key: 'upcomingReminders' | 'overdueAlerts' | 'milestonesAndProgress',
    ) => {
      clearErrors();
      onUpdateOnboardingData({
        ...onboardingData,
        notifications: {
          ...prefs,
          [key]: !prefs[key],
        },
      });
    };

    const completeOnboarding = async (requestOsPermission: boolean) => {
      if (savingRef.current) return;
      clearErrors();
      let osStatus = prefs.osPermissionStatus;
      if (requestOsPermission) {
        osStatus = await requestNativeNotificationPermission();
      }
      const now = new Date().toISOString();
      await persistAndMove(
        {
          onboardingCompleted: true,
          completedAt: now,
          notifications: {
            ...prefs,
            permissionRequested: requestOsPermission,
            osPermissionStatus: osStatus,
          },
        },
        'home',
      );
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Setup"
          step={5}
          total={5}
          onBack={() => {
            clearErrors();
            onChangeStage('onboard_4');
          }}
        />
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <View style={[styles.introBox, styles.introCompact]}>
            <Text style={[styles.introTitle, styles.introTitleCompact]} accessibilityRole="header">
              Stay on track
            </Text>
            <Text style={styles.introSubtitle}>
              Choose the alerts that would help you most.
            </Text>
          </View>

          <View style={styles.notifyArtWrap}>
            <View style={styles.bellBox}>
              <AppIcon name="bell" size={34} color="#79D9CD" />
            </View>
          </View>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: prefs.upcomingReminders }}
            accessibilityLabel="Upcoming payment reminders"
            style={styles.toggleRow}
            onPress={() => toggleNotificationPref('upcomingReminders')}
          >
            <View style={styles.flex1}>
              <Text style={styles.toggleTitle}>Upcoming payment reminders</Text>
              <Text style={styles.toggleSub}>Get a heads-up before bills are due</Text>
            </View>
            <View style={[styles.toggleTrack, prefs.upcomingReminders && styles.toggleTrackOn]}>
              <View style={[styles.toggleThumb, prefs.upcomingReminders && styles.toggleThumbOn]} />
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: prefs.overdueAlerts }}
            accessibilityLabel="Past-due alerts"
            style={styles.toggleRow}
            onPress={() => toggleNotificationPref('overdueAlerts')}
          >
            <View style={styles.flex1}>
              <Text style={styles.toggleTitle}>Past-due alerts</Text>
              <Text style={styles.toggleSub}>Know when a bill needs attention</Text>
            </View>
            <View style={[styles.toggleTrack, prefs.overdueAlerts && styles.toggleTrackOn]}>
              <View style={[styles.toggleThumb, prefs.overdueAlerts && styles.toggleThumbOn]} />
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: prefs.milestonesAndProgress }}
            accessibilityLabel="Milestones and progress"
            style={styles.toggleRow}
            onPress={() => toggleNotificationPref('milestonesAndProgress')}
          >
            <View style={styles.flex1}>
              <Text style={styles.toggleTitle}>Milestones & progress</Text>
              <Text style={styles.toggleSub}>Celebrate payoff achievements</Text>
            </View>
            <View style={[styles.toggleTrack, prefs.milestonesAndProgress && styles.toggleTrackOn]}>
              <View
                style={[styles.toggleThumb, prefs.milestonesAndProgress && styles.toggleThumbOn]}
              />
            </View>
          </Pressable>

          <View style={[styles.calloutTeal, { marginTop: 24 }]}>
            <Text style={styles.calloutTealText}>
              We’ll ask your device for notification permission only after you choose to enable
              alerts.
            </Text>
          </View>

          {!!localError ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {localError}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enable notifications"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={() => void completeOnboarding(true)}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Enable notifications</Text>
            )}
          </Pressable>

          <View style={styles.footerInlineRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Not now"
              disabled={saving}
              onPress={() => void completeOnboarding(false)}
            >
              <Text style={styles.linkText}>Not now</Text>
            </Pressable>
            <Text style={styles.footerNoteText}>  Â·  You can change this in Settings.</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 11: HOME DASHBOARD (stage === 'home')
  // ============================================================================
  return (
    <HomeScreen
      session={session}
      onboardingData={onboardingData}
      onUpdateOnboardingData={onUpdateOnboardingData}
      transactions={transactions}
      recurringBills={recurringBills}
      reconciliationAnchors={reconciliationAnchors}
      currencyCode={currencyCode}
      currencySymbol={currencySymbol}
      onSignOut={onSignOut}
      onChangeStage={onChangeStage}
      onAddTransaction={handleAddTransaction}
      onUpdateTransaction={handleUpdateTransaction}
      onDeleteTransaction={handleDeleteTransaction}
      onRecordBillPayment={handleRecordBillPayment}
      onReconcileDebt={handleReconcileDebt}
      onAddRecurringBill={handleAddRecurringBill}
      onDeleteRecurringBill={handleDeleteRecurringBill}
      onSaveObligationSchedule={handleSaveObligationSchedule}
      onUpdateTransactions={setTransactions}
      onUpdateRecurringBills={setRecurringBills}
      onUpdateReconciliationAnchors={setReconciliationAnchors}
      authBusy={authBusy}
      onReload={handleReloadAppData}
      reloading={reloading}
      reloadFeedback={reloadFeedback}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1F201F',
  },
  flex1: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  spacer: {
    flex: 1,
    minHeight: 16,
  },
  textCenter: {
    textAlign: 'center',
  },
  // Top Bar & Segmented Progress
  topBar: {
    height: 74,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    paddingHorizontal: 24,
  },
  backButton: {
    position: 'absolute',
    left: 22,
    top: 18,
    width: 36,
    height: 36,
    justifyContent: 'center',
  },
  stepText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F9F9F6',
    letterSpacing: 0.1,
  },
  progressRow: {
    position: 'absolute',
    bottom: 2,
    left: 26,
    right: 26,
    height: 3,
    flexDirection: 'row',
    gap: 4,
  },
  progressSegment: {
    flex: 1,
    height: 3,
    borderRadius: 5,
    backgroundColor: '#414743',
  },
  progressSegmentDone: {
    backgroundColor: '#AD5637',
  },
  // Welcome Screen
  welcomeScroll: {
    flexGrow: 1,
    paddingBottom: 12,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 20,
  },
  logoBrand: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandMark: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#369B97',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
  },
  logoText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F9F9F6',
    letterSpacing: -0.8,
  },
  logoTextAccent: {
    color: '#50C7C0',
  },
  topSignInLink: {
    color: '#58CBD0',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  heroSection: {
    height: 280,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginTop: 8,
  },
  orbitContainer: {
    width: 164,
    height: 164,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  orbitBase: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 16,
    borderColor: '#3B3E3A',
  },
  orbitArcTeal: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 16,
    borderColor: 'transparent',
    borderTopColor: '#58CCC5',
    borderRightColor: '#58CCC5',
    transform: [{ rotate: '-28deg' }],
  },
  orbitArcTerracotta: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 16,
    borderColor: 'transparent',
    borderBottomColor: '#AD5637',
    transform: [{ rotate: '-28deg' }],
  },
  orbitCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBigText: {
    fontSize: 33,
    fontWeight: '800',
    color: '#F9F9F6',
    letterSpacing: -1,
  },
  heroMiniText: {
    fontSize: 11,
    color: '#B7C6C0',
    marginTop: 2,
  },
  floatingCard: {
    position: 'absolute',
    backgroundColor: '#2A2C2B',
    borderWidth: 1,
    borderColor: '#414743',
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 9,
    zIndex: 2,
  },
  floatingCardLeft: {
    left: 24,
    top: 46,
  },
  floatingCardRight: {
    right: 18,
    bottom: 34,
  },
  floatingCardLabel: {
    fontSize: 11,
    color: '#E8EDE9',
  },
  floatingCardValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  floatingCardValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#73D9C6',
    marginTop: 3,
  },
  welcomeCopy: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 6,
  },
  badgeSmall: {
    backgroundColor: '#303C38',
    borderRadius: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginBottom: 16,
  },
  badgeSmallText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#81DFD2',
    letterSpacing: 0.7,
  },
  welcomeTitle: {
    fontSize: 29,
    lineHeight: 34,
    fontWeight: '800',
    color: '#F9F9F6',
    textAlign: 'center',
    letterSpacing: -0.8,
    marginBottom: 12,
  },
  welcomeSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: '#ADB8AF',
    textAlign: 'center',
    maxWidth: 310,
  },
  // Step Content & Intro
  stepContent: {
    paddingHorizontal: 25,
    paddingTop: 22,
    paddingBottom: 24,
  },
  introBox: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 22,
  },
  introCompact: {
    paddingTop: 2,
    paddingBottom: 18,
  },
  introTitle: {
    fontSize: 23,
    lineHeight: 29,
    fontWeight: '700',
    color: '#F9F9F6',
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: 11,
  },
  introTitleCompact: {
    fontSize: 22,
  },
  introSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: '#B5B9B5',
    textAlign: 'center',
    maxWidth: 310,
  },
  // Buttons & Footer
  footer: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 42,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
    backgroundColor: '#1F201F',
  },
  primaryButton: {
    minHeight: 51,
    borderRadius: 9,
    backgroundColor: '#A34F34',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryButtonHot: {
    backgroundColor: '#FA6E2B',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  disabledButton: {
    opacity: 0.55,
  },
  footerInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 13,
  },
  footerNoteText: {
    fontSize: 11,
    color: '#9DA5A0',
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 11,
  },
  linkText: {
    fontSize: 12,
    color: '#58CBD0',
    fontWeight: '700',
  },
  inlineLinkWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legalNote: {
    fontSize: 11,
    color: '#747D77',
    textAlign: 'center',
    marginTop: 14,
  },
  // Provider buttons (Step 1 of 4)
  providerButton: {
    borderWidth: 1,
    borderColor: '#474D49',
    borderRadius: 9,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
    marginBottom: 9,
    backgroundColor: '#232524',
    paddingHorizontal: 14,
  },
  providerButtonConnected: {
    borderColor: '#35645B',
    backgroundColor: '#243531',
  },
  providerButtonPassive: {
    opacity: 0.85,
  },
  providerButtonText: {
    color: '#F9F9F6',
    fontSize: 13,
    fontWeight: '700',
  },
  googleLetterIcon: {
    fontSize: 17,
    fontWeight: '800',
    color: '#4285F4',
  },
  appleMarkBox: {
    width: 18,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appleMarkLeaf: {
    width: 5,
    height: 5,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 5,
    borderBottomRightRadius: 5,
    marginLeft: 2,
    marginBottom: 1,
    transform: [{ rotate: '15deg' }],
  },
  appleMarkBody: {
    width: 15,
    height: 13,
    flexDirection: 'row',
    justifyContent: 'center',
    position: 'relative',
  },
  appleMarkLobeLeft: {
    width: 9,
    height: 13,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    marginRight: -2,
  },
  appleMarkLobeRight: {
    width: 9,
    height: 13,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
  },
  appleMarkBite: {
    position: 'absolute',
    right: -2,
    top: 3,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#232524',
  },
  appleNativeButton: {
    width: '100%',
    height: 46,
    marginBottom: 9,
  },
  hlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 17,
  },
  hlineBar: {
    flex: 1,
    height: 1,
    backgroundColor: '#454947',
  },
  hlineLabel: {
    color: '#707872',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  // Choices & Grids
  choice: {
    minHeight: 43,
    width: '100%',
    borderWidth: 1,
    borderColor: '#5E635F',
    borderRadius: 9,
    backgroundColor: '#272928',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 8,
    position: 'relative',
  },
  choiceCompact: {
    minHeight: 36,
    paddingVertical: 7,
    paddingHorizontal: 8,
    marginBottom: 0,
  },
  choiceFlex: {
    flex: 1,
    width: undefined,
    marginBottom: 0,
  },
  choicePill: {
    width: undefined,
    paddingHorizontal: 14,
    marginBottom: 0,
  },
  choicePillSelected: {
    paddingLeft: 24,
  },
  choiceSelected: {
    borderWidth: 1.5,
    borderColor: '#BA6748',
    backgroundColor: '#392B24',
  },
  choiceCheck: {
    position: 'absolute',
    left: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceCheckCompact: {
    left: 7,
  },
  choiceText: {
    color: '#F5F5F3',
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
  },
  choiceTextCompact: {
    fontSize: 11,
  },
  choiceTextSelected: {
    color: '#FFFFFF',
  },
  choiceGrid2: {
    flexDirection: 'row',
    gap: 8,
  },
  splitLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B3BBB5',
    marginTop: 6,
    marginBottom: 8,
  },
  splitGrid3: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  splitGrid4: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 14,
  },
  // Callouts
  calloutTeal: {
    padding: 12,
    backgroundColor: '#243531',
    borderWidth: 1,
    borderColor: '#35645B',
    borderRadius: 9,
    marginTop: 13,
  },
  calloutTealText: {
    color: '#B8DDD4',
    fontSize: 12,
    lineHeight: 18,
  },
  calloutOrange: {
    padding: 12,
    backgroundColor: '#332921',
    borderWidth: 1,
    borderColor: '#6F4939',
    borderRadius: 9,
    marginTop: 13,
  },
  calloutOrangeTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
  calloutOrangeText: {
    color: '#E5C6B4',
    fontSize: 12,
    lineHeight: 18,
  },
  // Fields & Labels
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B1B4B0',
    marginTop: 16,
    marginBottom: 7,
  },
  fieldLabelSmall: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B1B4B0',
    marginTop: 10,
    marginBottom: 5,
  },
  countrySelector: {
    width: 112,
    minHeight: 54,
    borderWidth: 1,
    borderColor: '#555B57',
    borderRadius: 9,
    backgroundColor: '#222423',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  countryFlagText: {
    fontSize: 22,
  },
  countryDropdown: {
    marginBottom: 12,
  },
  bigFieldBox: {
    width: '100%',
    minHeight: 60,
    borderWidth: 1,
    borderColor: '#555B57',
    borderRadius: 9,
    backgroundColor: '#222423',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  bigFieldPrefix: {
    fontSize: 23,
    fontWeight: '700',
    color: '#FBFBF9',
    marginRight: 6,
  },
  bigFieldInput: {
    flex: 1,
    fontSize: 23,
    fontWeight: '700',
    color: '#FBFBF9',
    paddingVertical: 10,
  },
  fieldMutedUnit: {
    color: '#9DA6A0',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },
  helpText: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 16,
    color: '#929B95',
  },
  sectionTitle: {
    fontSize: 13,
    color: '#E9EBEA',
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 10,
  },
  smallAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#62736C',
    borderRadius: 10,
    padding: 13,
  },
  smallAddText: {
    color: '#81D8CF',
    fontSize: 12,
    fontWeight: '700',
  },
  // Plan Cards (Step 2 of 5)
  planCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: '#515853',
    backgroundColor: '#262927',
    borderRadius: 12,
    marginBottom: 11,
  },
  planCardSelected: {
    backgroundColor: '#322922',
    borderColor: '#B85B39',
  },
  planHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  planTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#F9F9F6',
  },
  planChip: {
    backgroundColor: '#3A4C45',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  planChipText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#96DBCC',
    letterSpacing: 0.4,
  },
  planDescription: {
    fontSize: 11,
    color: '#B8C0B9',
    marginBottom: 8,
    lineHeight: 16,
  },
  planBulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 3,
  },
  planBulletIcon: {
    marginRight: 7,
  },
  planBulletText: {
    fontSize: 11,
    color: '#EBEEEB',
  },
  // Two-Row Cards (Step 3 & Step 4)
  twoRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#454C47',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 13,
    backgroundColor: '#282A28',
    marginBottom: 9,
    minHeight: 56,
  },
  twoRowCardSelected: {
    borderColor: '#BA684A',
    backgroundColor: '#362A26',
  },
  twoRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 8,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#344743',
    alignItems: 'center',
    justifyContent: 'center',
  },
  twoRowTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F9F9F6',
  },
  twoRowSub: {
    fontSize: 11,
    color: '#ADB4AD',
    marginTop: 3,
  },
  selectCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#626B64',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectCircleSelected: {
    backgroundColor: '#AA563B',
    borderColor: '#AA563B',
  },
  // Inline Editor & Added Items
  inlineEditorCard: {
    backgroundColor: '#262927',
    borderWidth: 1,
    borderColor: '#555B57',
    borderRadius: 11,
    padding: 14,
    marginVertical: 10,
  },
  inlineEditorTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F9F9F6',
    marginBottom: 6,
  },
  categoryPillsRow: {
    gap: 6,
    paddingVertical: 4,
  },
  textInputField: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#555B57',
    borderRadius: 8,
    backgroundColor: '#222423',
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#FBFBF9',
  },
  subtleActionBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#2D302E',
    borderWidth: 1,
    borderColor: '#5D6660',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtleActionBtnText: {
    color: '#E5E7E5',
    fontSize: 13,
    fontWeight: '600',
  },
  saveInlineBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#A34F34',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveInlineBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  addedItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#262927',
    borderWidth: 1,
    borderColor: '#414743',
    borderRadius: 9,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  addedItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F9F9F6',
  },
  addedItemSub: {
    fontSize: 11,
    color: '#AAB3AC',
    marginTop: 3,
  },
  addedItemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  editActionText: {
    color: '#58CBD0',
    fontSize: 12,
    fontWeight: '700',
  },
  removeActionText: {
    color: '#FF8A75',
    fontSize: 12,
    fontWeight: '700',
  },
  summaryRowBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#283330',
    borderRadius: 9,
    padding: 12,
    marginTop: 10,
  },
  summaryRowLabel: {
    fontSize: 12,
    color: '#B8DDD4',
    fontWeight: '600',
  },
  summaryRowValue: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  // Strategy Preview (Step 4)
  strategyPreviewCard: {
    backgroundColor: '#283330',
    borderWidth: 1,
    borderColor: '#3E6B62',
    borderRadius: 9,
    padding: 12,
    marginTop: 14,
  },
  strategyPreviewHeading: {
    fontSize: 12,
    fontWeight: '800',
    color: '#80D8CF',
    marginBottom: 4,
  },
  strategyPreviewLine: {
    fontSize: 12,
    color: '#E9EBEA',
    lineHeight: 18,
  },
  // Notifications (Step 5)
  notifyArtWrap: {
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 12,
  },
  bellBox: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: '#293B36',
    borderWidth: 1,
    borderColor: '#3E6B62',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#333A35',
    gap: 12,
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F9F9F6',
  },
  toggleSub: {
    fontSize: 11,
    color: '#AAB3AC',
    marginTop: 4,
    lineHeight: 16,
  },
  toggleTrack: {
    width: 39,
    height: 23,
    borderRadius: 12,
    backgroundColor: '#454A46',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  toggleTrackOn: {
    backgroundColor: '#388B80',
  },
  toggleThumb: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    backgroundColor: '#C9CECA',
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
    backgroundColor: '#FFFFFF',
  },
  // Error text
  errorText: {
    color: '#FF8A75',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 18,
    fontWeight: '600',
  },
  // Home Dashboard
  homeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2E3330',
  },
  homeHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: '#2A2F2C',
    borderWidth: 1,
    borderColor: '#454C47',
  },
  headerActionPillText: {
    color: '#81DFD2',
    fontSize: 11,
    fontWeight: '700',
  },
  headerSignOutPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: '#392B24',
    borderWidth: 1,
    borderColor: '#BA6748',
  },
  headerSignOutPillText: {
    color: '#FF9367',
    fontSize: 11,
    fontWeight: '700',
  },
  homeContent: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 34,
  },
  homeHeroCard: {
    backgroundColor: '#262927',
    borderWidth: 1,
    borderColor: '#414743',
    borderRadius: 14,
    padding: 16,
  },
  homeHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  overlineTeal: {
    fontSize: 10,
    fontWeight: '800',
    color: '#7BD5CD',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  homeTotalDebtAmount: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.6,
  },
  homeHeroSub: {
    fontSize: 11,
    color: '#AAB3AC',
    marginTop: 2,
  },
  homeProgressBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 4,
    borderColor: '#58CCC5',
    backgroundColor: '#243531',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeProgressPercent: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  homeProgressCaption: {
    fontSize: 9,
    color: '#81DFD2',
  },
  homeStatsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  homeStatCell: {
    flex: 1,
    backgroundColor: '#202321',
    borderRadius: 9,
    padding: 10,
    borderWidth: 1,
    borderColor: '#343A36',
  },
  homeStatLabel: {
    fontSize: 10,
    color: '#9DA5A0',
    fontWeight: '600',
  },
  homeStatValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#D9F7EA',
    marginTop: 2,
  },
  homeStatMicro: {
    fontSize: 10,
    color: '#89928D',
    marginTop: 2,
  },
  priorityCard: {
    backgroundColor: '#362A26',
    borderWidth: 1,
    borderColor: '#BA684A',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  priorityTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  prioritySub: {
    fontSize: 11,
    color: '#E5C6B4',
    marginTop: 3,
    marginBottom: 8,
  },
  priorityMetricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  priorityMetricLabel: {
    fontSize: 11,
    color: '#E5C6B4',
  },
  priorityMetricValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 10,
  },
  homeDebtCard: {
    backgroundColor: '#262927',
    borderWidth: 1,
    borderColor: '#414743',
    borderRadius: 11,
    padding: 13,
    marginBottom: 9,
  },
  homeDebtHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  priorityOrderPill: {
    backgroundColor: '#344743',
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  priorityOrderPillText: {
    color: '#91DED7',
    fontSize: 11,
    fontWeight: '800',
  },
  homeDebtName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F9F9F6',
  },
  homeDebtMeta: {
    fontSize: 11,
    color: '#AAB3AC',
    marginTop: 2,
  },
  homeDebtBalance: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  homeDebtFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#333A35',
  },
  homeDebtPlanText: {
    fontSize: 11,
    color: '#81DFD2',
    fontWeight: '600',
  },
});




