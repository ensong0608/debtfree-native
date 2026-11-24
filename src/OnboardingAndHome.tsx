import { resolveAuthenticatedStage } from './onboarding-domain';
import { isEmailPasswordAuthEnabled } from './auth';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { View, Text, TextInput, Pressable, ScrollView, NativeAppearanceProvider, useNativeAppearance, type AppearancePalette } from './components/NativeAppearance';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import type { Session } from '@supabase/supabase-js';
import {
  AI_REFERRAL_SOURCE,
  CURRENCY_OPTIONS, resolveCurrencyOption, acceptMoneyEdit, acceptAprEdit, formatEditableMoney,
  COUNTRY_OPTIONS,
  DEBT_CATEGORIES,
  PAY_FREQUENCY_OPTIONS,
  REFERRAL_SOURCES,
  SIGNUP_GOALS,
  calculateTotalMonthlyIncome,
  comparePayoffStrategies,
  formatCurrency,
  homeDebtFreeEstimateDate,
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
  type HomeOwnershipStatus,
  type PayFrequency,
  type PayoffStrategy,
  type UserOnboardingData,
  type VehicleOwnershipStatus,
} from './onboarding-domain';
import {
  deleteUserDebt,
  loadUserOnboardingData,
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
import { transactionHasBillId } from './finance/bill-identity';
import { createRecurringBillDeletionPreview, type RecurringBill } from './finance/recurring-bills';
import { annualFeeTransactionId, createAnnualFeeTransaction, nextAnnualFeeRenewalDate } from './finance/annual-fees';
import { validatedLoanBillLinks, withoutDeletedBillPairings, withoutIncompatibleDebtPairing, canEditDebtCategoryWithPairings, unifiedLoanRuntime } from './finance/loan-bill-pairing';
import { prepareUnifiedLoanSettings } from './finance/unified-loan';
import { parseMoney, type Money } from './finance/money';
import { type DateOnly, currentHouseholdDate } from './finance/calendar';
import {
  chooseObligationDueDateEdit,
  confirmObligationPaidToday,
  obligationFirstDueDate,
  prepareObligationEditorSchedule,
  shouldAskPaidToday,
  saveObligationEditorSchedule,
  removeObligationEditorSchedule,
} from './finance/obligation-editor';
import { obligationScheduleKey } from './finance/obligation-schedule';
import { getScheduledObligationRows } from './finance/payment-matching';
import { cancelAllLocalNotifications, syncLocalObligationNotifications } from './notifications';
import type { ObligationSchedule, ObligationScheduleKey } from './finance/obligation-schedule';
import {
  loadFinanceRecords,
} from './finance-storage';
import {
  PROTOTYPE_RECURRING_BILLS,
  PROTOTYPE_TRANSACTIONS,
  PROTOTYPE_RECONCILIATION_ANCHORS,
} from './finance/prototype-loader';
import type { HouseholdMembershipSummary } from './household-context';

type Props = {
  session: Session | null;
  onboardingData: UserOnboardingData | null;
  householdSummaries?: HouseholdMembershipSummary[];
  onSwitchHousehold?: (householdId: string) => Promise<void>;
  onRefreshHouseholdContexts?: () => Promise<HouseholdMembershipSummary[]>;
  onAcceptHouseholdInvite?: (tokenOrUrl: string) => Promise<void>;
  stage: FlowStage;
  onChangeStage: (next: FlowStage) => void;
  onUpdateOnboardingData: (next: UserOnboardingData) => void;
  onGoogleSignIn: () => Promise<Session | null>;
  onAppleSignIn: () => Promise<Session | null>;
  onEmailSignIn: (email: string, password: string) => Promise<boolean>;
  onEmailSignUp: (email: string, password: string) => Promise<boolean>;
  onSignOut: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  accountDeletionEnabled: boolean;
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
  const styles = createStyles(useNativeAppearance().palette);
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
  const { palette } = useNativeAppearance();
  const styles = createStyles(palette);
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
          <AppIcon name="back" size={22} color={palette.text} />
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
  const { palette } = useNativeAppearance();
  const styles = createStyles(palette);
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
          <AppIcon name="check" size={compact ? 12 : 14} color={palette.brand} />
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

export function DebtFreeFlow(props: Props) {
  return <NativeAppearanceProvider userId={props.session?.user.id}><DebtFreeFlowContent {...props} /></NativeAppearanceProvider>;
}

function DebtFreeFlowContent({
  session,
  onboardingData,
  householdSummaries = [],
  onSwitchHousehold,
  onRefreshHouseholdContexts,
  onAcceptHouseholdInvite,
  stage,
  onChangeStage,
  onUpdateOnboardingData,
  onGoogleSignIn,
  onAppleSignIn,
  onEmailSignIn,
  onEmailSignUp,
  onSignOut,
  onDeleteAccount,
  accountDeletionEnabled,
  onTestUserSignIn,
  appleAvailable,
  configured,
  configProblem,
  authBusy,
  authError,
  authNotice,
  onClearAuthError,
}: Props) {
  const { palette } = useNativeAppearance();
  const styles = createStyles(palette);
  const [signInMode, setSignInMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => { setPassword(''); }, [session?.user.id]);
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
  const debtFormKeyRef = useRef(0);
  const [debtFormSeed, setDebtFormSeed] = useState<{ key: number; draft: OnboardingDebtDraft }>({
    key: 0,
    draft: {
      category: 'Credit card',
      name: '',
      balance: '',
      originalBalance: '',
      apr: '',
      minimum: '',
      dueDay: '',
      creditLimit: '',
    },
  });

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
  const financeRecordsVerified = verifiedFinanceScope === `${session?.user?.id ?? 'offline'}:${onboardingData?.userId ?? 'none'}:${onboardingData?.householdId ?? 'none'}:${currencyCode}`;

  const [notificationRefresh, setNotificationRefresh] = useState<number>(0);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setNotificationRefresh(value => value + 1);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!onboardingData || stage !== 'home' || (session && session.user.id !== onboardingData.userId)) {
      void cancelAllLocalNotifications();
      return;
    }
    if (!financeRecordsVerified) {
      void cancelAllLocalNotifications();
      return;
    }
    const runtime = unifiedLoanRuntime({ debts: onboardingData.debts, bills: recurringBills, pairings: onboardingData.loanBillPairingByDebtId, archived: onboardingData.archivedPaidOffDebtIds, currency: currencyCode });
    const archived = new Set(onboardingData.archivedPaidOffDebtIds ?? []);
    const rows = getScheduledObligationRows({
      debts: onboardingData.debts.filter(debt => !runtime.excludedDebtIds.includes(debt.id) && !archived.has(debt.id)),
      recurringBills, transactions, asOfDate: currentHouseholdDate(onboardingData.householdTimeZone), currencyCode,
      schedules: onboardingData.obligationSchedules, loanBillPairs: runtime.legacyPairs,
      excludedBillIds: runtime.excludedBillIds, historicalBillIdsByDebtId: runtime.aliases,
    });
    void syncLocalObligationNotifications(rows, onboardingData.notifications);
  }, [onboardingData, stage, session, financeRecordsVerified, recurringBills, transactions, currencyCode, notificationRefresh]);

  const financeScopeResetKey = `${session?.user?.id ?? 'offline'}:${onboardingData?.userId ?? 'none'}:${onboardingData?.householdId ?? 'none'}:${currencyCode}:${isPrototypeHousehold}`;
  const [prevFinanceScopeResetKey, setPrevFinanceScopeResetKey] = useState(financeScopeResetKey);
  if (prevFinanceScopeResetKey !== financeScopeResetKey) {
    setPrevFinanceScopeResetKey(financeScopeResetKey);
    if (!isPrototypeHousehold) {
      setVerifiedFinanceScope('');
      setReloadFeedback(null);
      setTransactions([]);
      setRecurringBills([]);
      setReconciliationAnchors([]);
    }
  }

  // Load finance records from remote/cache on session/user ready
  const onboardingHouseholdContext = onboardingData?.householdContext;
  useEffect(() => {
    if (!onboardingData?.userId) return;
    let isCancelled = false;
    loadFinanceRecords({
      session,
      userId: onboardingData.userId,
      currency: currencyCode,
      householdContext: onboardingHouseholdContext,
    }).then(records => {
      if (isCancelled) return;
      if (records.syncStatus === 'synced' || records.syncStatus === 'cached_offline') {
        const completeSnapshot = records.snapshotStatus === 'authoritative';
        setVerifiedFinanceScope(completeSnapshot ? `${session?.user?.id ?? 'offline'}:${onboardingData.userId}:${onboardingData.householdId}:${currencyCode}` : '');
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
  }, [session, onboardingData?.userId, onboardingData?.householdId, onboardingHouseholdContext, currencyCode, isPrototypeHousehold]);

  const [reloading, setReloading] = useState(false);
  const accountRefreshScopeKey = `${session?.user.id ?? 'offline'}:${onboardingData?.userId ?? 'none'}:${onboardingData?.householdId ?? 'none'}:${currencyCode}`;
  const accountRefreshScope = useMemo(() => ({ key: accountRefreshScopeKey }), [accountRefreshScopeKey]);
  const activeAccountRefresh = useRef<{ scope: { key: string } } | null>(null);
  const refreshMounted = useRef(true);
  useEffect(() => {
    refreshMounted.current = true;
    return () => { refreshMounted.current = false; activeAccountRefresh.current = null; };
  }, []);
  useEffect(() => {
    if (activeAccountRefresh.current?.scope !== accountRefreshScope) {
      activeAccountRefresh.current = null;
      setReloading(false);
    }
  }, [accountRefreshScope]);
  const handleReloadAppData = async () => {
    if (!onboardingData || (session && session.user.id !== onboardingData.userId)) return;
    const scope = accountRefreshScope;
    if (activeAccountRefresh.current?.scope === scope) return;
    const request = { scope };
    activeAccountRefresh.current = request;
    const isCurrent = () => refreshMounted.current && accountRefreshScope === scope && activeAccountRefresh.current === request;
    const REFRESH_TIMEOUT_MS = 15_000;
    const deadline = Date.now() + REFRESH_TIMEOUT_MS;
    class RefreshTimeoutError extends Error {}
    const withRefreshTimeout = <T,>(promise: Promise<T>): Promise<T> => {
      const remainingMs = Math.max(1000, deadline - Date.now());
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new RefreshTimeoutError('Refresh timed out. Please check your connection and try again.'));
        }, remainingMs);
      });
      return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutId !== null) clearTimeout(timeoutId);
      });
    };
    setReloading(true);
    setVerifiedFinanceScope('');
    setLocalError('');
    setReloadFeedback(null);
    try {
      let refreshedData = onboardingData;
      let settingsError: Error | null = null;
      if (session) {
        try {
          refreshedData = await withRefreshTimeout(
            loadUserOnboardingData(session, { householdId: onboardingData.householdId }),
          );
          if (!isCurrent()) return;
          if (refreshedData.userId !== onboardingData.userId || refreshedData.householdId !== onboardingData.householdId) {
            throw new Error('The signed-in account changed. Sign in again to reload.');
          }
          onUpdateOnboardingData(refreshedData);
        } catch (error) {
          if (!isCurrent()) return;
          if (error instanceof RefreshTimeoutError) throw error;
          if (error instanceof Error && error.message.includes('signed-in account changed')) throw error;
          settingsError = error instanceof Error ? error : new Error(String(error));
        }
      }
      if (!isCurrent()) return;
      const records = await withRefreshTimeout(
        loadFinanceRecords({ session, userId: refreshedData.userId, currency: resolveCurrencyOption(refreshedData).code, householdContext: refreshedData.householdContext }),
      );
      if (!isCurrent()) return;
      const hasServerSnapshot = records.snapshotStatus === 'authoritative' || records.snapshotStatus === 'authoritative_with_pending_writes';
      if (hasServerSnapshot) {
        setTransactions(records.transactions);
        setRecurringBills(records.recurringBills);
        setReconciliationAnchors(records.reconciliationAnchors);
      }
      const completeSnapshot = records.snapshotStatus === 'authoritative' && settingsError === null;
      setVerifiedFinanceScope(completeSnapshot ? `${session?.user?.id ?? 'offline'}:${refreshedData.userId}:${refreshedData.householdId}:${resolveCurrencyOption(refreshedData).code}` : '');
      if (settingsError) {
        setReloadFeedback({ kind: 'error', message: 'Account data refresh was incomplete. Settings and debts could not be refreshed; existing financial records were kept unless a server snapshot was available.' });
      } else if (records.snapshotStatus === 'authoritative') {
        setReloadFeedback(null);
      } else if (records.snapshotStatus === 'authoritative_with_pending_writes') {
        setReloadFeedback({
          kind: 'warning',
          message: `${records.pendingWriteCount} local financial change${records.pendingWriteCount === 1 ? '' : 's'} still await confirmation. Server records were refreshed, but this snapshot is not fully verified.`,
        });
      } else if (records.error || records.failureKind) {
        setReloadFeedback({ kind: 'error', message: 'Account data refresh failed. Existing financial records remain on screen; saved offline data was not used to replace them.' });
      } else {
        setReloadFeedback({ kind: 'warning', message: 'Showing saved offline data. It has not been verified against the server.' });
      }
    } catch (err) {
      if (!isCurrent()) return;
      setReloadFeedback({
        kind: 'error',
        message: err instanceof Error
          ? `Account data refresh failed: ${err.message}. Existing financial records remain on screen.`
          : 'Account data refresh failed. Existing financial records remain on screen.',
      });
    } finally {
      if (activeAccountRefresh.current === request) {
        activeAccountRefresh.current = null;
      }
      if (refreshMounted.current && activeAccountRefresh.current === null) {
        setReloading(false);
      }
    }
  };

  const handleAddRecurringBill = async (bill: RecurringBill) => {
    if (!onboardingData) throw new Error('Onboarding settings are unavailable. Reload and retry.');
    if (Object.values(onboardingData.loanBillPairingByDebtId ?? {}).some(relation => relation?.status === 'linked' && relation.billId === bill.id)) throw new Error('Edit this loan from Accounts or Budget. Its historical bill is not independently editable.');
    try {
      const res = await executeAddRecurringBill({
        session,
        userId: onboardingData.userId,
        householdContext: onboardingData.householdContext,
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
    if (Object.values(freshData.loanBillPairingByDebtId ?? {}).some(relation => relation?.status === 'linked' && relation.billId === billId)) throw new Error('This recurring item belongs to a loan history. Remove the loan through its account confirmation; no records were changed.');
    const freshRecords = await loadFinanceRecords({ session, userId: freshData.userId, currency: resolveCurrencyOption(freshData).code, householdContext: freshData.householdContext });
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
      const latestRecords = await loadFinanceRecords({ session, userId: latestData.userId, currency: resolveCurrencyOption(latestData).code, householdContext: latestData.householdContext });
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
        householdContext: currentData.householdContext,
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
        const billPaymentSplitPlansByBillId = { ...(cleanupData.billPaymentSplitPlansByBillId ?? {}) };
        delete billPaymentSplitPlansByBillId[billId];
        if (Object.keys(billPaymentSplitPlansByBillId).length !== Object.keys(cleanupData.billPaymentSplitPlansByBillId ?? {}).length) {
          try {
            cleanupData = await saveUserOnboardingSettingsPatch(cleanupData, { billPaymentSplitPlansByBillId }, session!);
            onUpdateOnboardingData(cleanupData);
          } catch (error) {
            cleanupFailures.push(`Bill split plan cleanup: ${error instanceof Error ? error.message : String(error)}`);
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
      return { outcome: res.outcome, syncStatus: res.syncResult.syncStatus, updatedOnboardingData: res.updatedOnboardingData };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to record transaction.';
      setLocalError(msg);
      throw err;
    }
  };

  const handleConfirmAnnualFee = async (debtId: string, renewalDate: DateOnly): Promise<{ outcome: 'confirmed' | 'pending' }> => {
    if (!onboardingData) throw new Error('Financial data is unavailable. Reload and retry.');
    const debt = onboardingData.debts.find(item => item.id === debtId);
    if (!debt || debt.category !== 'Credit card' || debt.annualFeeNextDueDate !== renewalDate || debt.annualFeeAmount == null) {
      throw new Error('The annual-fee schedule changed. Reload and retry.');
    }
    const transactionId = annualFeeTransactionId(debtId, renewalDate);
    const matchingTransactions = transactions.filter(tx => tx.id === transactionId);
    if (matchingTransactions.some(tx => tx.deletedAt !== null)) {
      throw new Error('This renewal has a deleted fee record. Review the transaction history before recording it again.');
    }
    const existingTransaction = matchingTransactions.find(tx => tx.deletedAt === null);
    if (existingTransaction?.isPending) return { outcome: 'pending' };

    let currentData = onboardingData;
    if (!existingTransaction) {
      const transaction = createAnnualFeeTransaction({
        debt,
        renewalDate,
        actualDate: currentHouseholdDate(onboardingData.householdTimeZone),
        currencyCode,
      });
      const result = await executeAddTransaction({
        session,
        onboardingData,
        transaction,
        currentTransactions: transactions,
        currencyCode,
      });
      setTransactions(result.transactions);
      if (result.updatedOnboardingData) {
        currentData = result.updatedOnboardingData;
        onUpdateOnboardingData(currentData);
      }
      if (result.outcome !== 'confirmed') return { outcome: 'pending' };
    }

    const currentDebt = currentData.debts.find(item => item.id === debtId);
    if (!currentDebt) throw new Error('The credit-card account is unavailable. Reload and retry.');
    const nextDueDate = nextAnnualFeeRenewalDate(renewalDate);
    if (currentDebt.annualFeeNextDueDate === nextDueDate) return { outcome: 'confirmed' };
    if (currentDebt.annualFeeNextDueDate !== renewalDate) throw new Error('The annual-fee renewal date changed. Reload and retry.');
    const updated = await upsertUserDebt(currentData, { ...currentDebt, annualFeeNextDueDate: nextDueDate });
    onUpdateOnboardingData(updated);
    return { outcome: 'confirmed' };
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

  const { payoffPlan, strategyComparison } = useMemo(() => {
    if (!onboardingData || stage === 'home') return { payoffPlan: null, strategyComparison: null };
    const parsedExtra = parseMoneyInput(extraPaymentInput, currencyCode);
    const effectiveExtra =
      stage === 'onboard_4' && parsedExtra !== null
        ? parsedExtra
        : onboardingData.extraMonthlyPayment;
    const tz = onboardingData.householdTimeZone ?? 'UTC';
    const comparison = comparePayoffStrategies(onboardingData.debts, onboardingData.strategy, effectiveExtra, new Date(), currencyCode, tz, onboardingData.archivedPaidOffDebtIds);
    return { payoffPlan: comparison.activePlan, strategyComparison: comparison };
  }, [onboardingData, extraPaymentInput, stage, currencyCode]);

  const clearErrors = useCallback(() => {
    setLocalError('');
    if (authError) onClearAuthError();
  }, [authError, onClearAuthError]);

  const persistAndMove = async (
    patch: Partial<UserOnboardingData>,
    nextStage: FlowStage,
  ) => {
    if (!onboardingData || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setLocalError('');
    try {
      const isSharedMember = Boolean(onboardingData.householdContext && onboardingData.householdContext.role !== 'owner');
      const candidate = {
        ...onboardingData,
        ...patch,
        ...(isSharedMember ? { countryCode: onboardingData.countryCode, currencyCode: onboardingData.currencyCode } : {}),
        currentStage: nextStage,
      };
      const destination = resolveAuthenticatedStage(candidate);
      const updated = await saveUserOnboardingData({ ...candidate, currentStage: destination }, { personalOnly: isSharedMember });
      onUpdateOnboardingData(updated);
      onChangeStage(destination);
    } catch (err) {
      const reconciled = (err as { reconciledData?: UserOnboardingData })?.reconciledData;
      if (reconciled) onUpdateOnboardingData(reconciled);
      setLocalError(err instanceof Error ? err.message : 'Unable to save your progress. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const openNewDebtEditor = (category: DebtCategory) => {
    clearErrors();
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
    debtFormKeyRef.current += 1;
    setDebtFormSeed({
      key: debtFormKeyRef.current,
      draft: {
        category,
        name:
          category === 'Mortgage'
            ? 'Home Mortgage'
            : category === 'Auto loan'
              ? 'Auto Loan'
              : '',
        balance: '',
        originalBalance: '',
        apr: '',
        minimum: '',
        dueDay: '',
        creditLimit: '',
      },
    });
    setShowDebtForm(true);
  };

  const openEditDebtEditor = (item: DebtItem) => {
    clearErrors();
    setEditingDebtId(item.id);
    draftDebtIdRef.current = null;
    draftDebtPaidTodayRef.current = {};
    debtFormKeyRef.current += 1;
    setDebtFormSeed({
      key: debtFormKeyRef.current,
      draft: {
        category: item.category,
        name: item.name,
        balance: formatEditableMoney(item.balance, currencyCode),
        originalBalance: item.originalBalance !== null ? formatEditableMoney(item.originalBalance, currencyCode) : '',
        apr: String(item.apr),
        minimum: formatEditableMoney(item.minimumPayment, currencyCode),
        dueDay: item.dueDay !== null ? String(item.dueDay) : '',
        creditLimit: item.creditLimit !== null ? formatEditableMoney(item.creditLimit, currencyCode) : '',
      },
    });
    setShowDebtForm(true);
  };

  const handleSaveDebt = useCallback(async (draft: OnboardingDebtDraft) => {
    if (!onboardingData || savingRef.current) return;
    clearErrors();
    const validation = validateDebtDraft({
      name: draft.name,
      category: draft.category,
      balanceRaw: draft.balance,
      originalBalanceRaw: draft.originalBalance,
      aprRaw: draft.apr,
      minimumPaymentRaw: draft.minimum,
      dueDayRaw: draft.dueDay,
      creditLimitRaw: draft.creditLimit,
    }, currencyCode);
    if (!validation.valid) {
      setLocalError(validation.error);
      return;
    }
    if (!editingDebtId && validation.debt.balance > 0 &&
        (validation.debt.category === 'Mortgage' || validation.debt.category === 'Auto loan') &&
        validation.debt.dueDay === null) {
      setLocalError('Please select a due day for this loan.');
      return;
    }

    const debtId = editingDebtId ?? (draftDebtIdRef.current ??= Crypto.randomUUID());
    const isDraftDebt = draftDebtIdRef.current === debtId;
    const existingDebt = onboardingData.debts.find(d => d.id === debtId);
    const dueDay = validation.debt.dueDay;
    if (existingDebt) {
      const allowed = canEditDebtCategoryWithPairings(onboardingData.loanBillPairingByDebtId, debtId, validation.debt.category, recurringBills);
      if (!allowed.valid) { setLocalError(allowed.error); return; }
    }
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

      const dateEdit = existingDebt && dueDay !== null ? await chooseObligationDueDateEdit({
        current: onboardingData, today, dueDay, currencyCode, transactions, recurringBills, debt: existingDebt,
      }) : undefined;
      const debtUnchanged = Boolean(existingDebt && existingDebt.name === validation.debt.name &&
        existingDebt.category === validation.debt.category && existingDebt.balance === validation.debt.balance &&
        existingDebt.originalBalance === validation.debt.originalBalance && existingDebt.apr === validation.debt.apr &&
        existingDebt.minimumPayment === validation.debt.minimumPayment && existingDebt.dueDay === validation.debt.dueDay &&
        existingDebt.creditLimit === validation.debt.creditLimit);
      const debtInput = { id: debtId, ...validation.debt };
      const unified = debtInput.category === 'Mortgage' || debtInput.category === 'Auto loan';
      const loanSettings = unified ? prepareUnifiedLoanSettings({
        current: onboardingData,
        debt: {
          ...debtInput,
          createdAt: existingDebt?.createdAt ?? new Date().toISOString(),
          updatedAt: existingDebt?.updatedAt ?? existingDebt?.createdAt ?? new Date().toISOString(),
        },
        bills: recurringBills,
        today,
        currency: currencyCode,
        paidToday,
        dateEdit,
      }) : undefined;
      const updated = !unified && debtUnchanged ? onboardingData : await upsertUserDebt(onboardingData, debtInput, loanSettings, recurringBills.find(bill => bill.id === onboardingData.loanBillPairingByDebtId?.[debtId]?.billId));
      onUpdateOnboardingData(updated);
      let settingsData = updated;
      if (!unified) {
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
          isNew: isDraftDebt, paidToday, existing: priorSchedule, ...dateEdit,
        });
        const settings = await saveObligationEditorSchedule({ current: settingsData, key, schedule, session });
        settingsData = settings;
        onUpdateOnboardingData(settings);
      }
      }
      setShowDebtForm(false);
      setEditingDebtId(null);
      draftDebtIdRef.current = null;
      delete draftDebtPaidTodayRef.current[debtId];
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to save debt account.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [clearErrors, currencyCode, editingDebtId, onboardingData, onUpdateOnboardingData, recurringBills, session, transactions]);

  const handleDeleteDebt = async (debtId: string) => {
    if (!onboardingData || savingRef.current) return;
    clearErrors();
    savingRef.current = true;
    setSaving(true);
    try {
      const localBillId = validatedLoanBillLinks(onboardingData.loanBillPairingByDebtId, recurringBills, onboardingData.debts)[debtId] ?? null;
      const relation = onboardingData.loanBillPairingByDebtId?.[debtId];
      if (relation?.status === 'linked' && relation.billId !== localBillId) throw new Error('Historical bill ownership cannot be safely validated for deletion. No records were removed.');
      const { data: updated, receipt } = await deleteUserDebt(onboardingData, debtId, localBillId);
      onUpdateOnboardingData(updated);
      if (receipt) {
        const removedTransactionIds = new Set(transactions.filter(transaction =>
          transaction.accountId === debtId || Boolean(receipt.billId && transactionHasBillId(transaction, receipt.billId)),
        ).map(transaction => transaction.id));
        setTransactions(current => current.filter(transaction =>
          transaction.accountId !== debtId && !(receipt.billId && transactionHasBillId(transaction, receipt.billId)),
        ));
        if (receipt.billId) setRecurringBills(current => current.filter(bill => bill.id !== receipt.billId));
        setReconciliationAnchors(current => current.filter(anchor =>
          anchor.accountId !== debtId && !(anchor.createdAdjustmentId && removedTransactionIds.has(anchor.createdAdjustmentId)),
        ));
      }
      if (editingDebtId === debtId) {
        setShowDebtForm(false);
        setEditingDebtId(null);
        draftDebtIdRef.current = null;
        delete draftDebtPaidTodayRef.current[debtId];
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
      <SafeAreaView style={[styles.root, { backgroundColor: palette.canvas }]} edges={['top', 'bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.welcomeScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.logoRow}>
            <View style={styles.logoBrand} accessible accessibilityRole="header" accessibilityLabel="DebtFree">
              <View style={styles.brandMark}>
                <AppIcon name="brandRise" size={16} color={palette.onBrand} />
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
                <AppIcon name="trendDown" size={14} color="#86E3B8" />
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
                style={[styles.primaryButton, { backgroundColor: palette.tint, borderColor: palette.brand, borderWidth: 1, marginTop: 10 }]}
                onPress={onTestUserSignIn}
              >
                <Text style={[styles.primaryButtonText, { color: palette.brand }]}>
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

            {process.env.EXPO_PUBLIC_TERMS_URL && process.env.EXPO_PUBLIC_PRIVACY_URL ? (
              <View style={{ alignItems: 'center', marginTop: 14 }}>
                <Text style={styles.legalNote}>By continuing, you agree to our Terms and acknowledge our Privacy Policy.</Text>
                <View style={{ flexDirection: 'row', gap: 18, marginTop: 8 }}>
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel="Read Terms of Service"
                    onPress={() => { void WebBrowser.openBrowserAsync(process.env.EXPO_PUBLIC_TERMS_URL!).catch(() => setLocalError('Unable to open the Terms of Service page.')); }}
                  >
                    <Text style={styles.linkText}>Terms of Service</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel="Read Privacy Policy"
                    onPress={() => { void WebBrowser.openBrowserAsync(process.env.EXPO_PUBLIC_PRIVACY_URL!).catch(() => setLocalError('Unable to open the Privacy Policy page.')); }}
                  >
                    <Text style={styles.linkText}>Privacy Policy</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
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
      <SafeAreaView style={[styles.root, { backgroundColor: palette.canvas }]} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Step"
          step={1}
          total={4}
          onBack={() => {
            clearErrors();
            onChangeStage('welcome');
          }}
        />
        <ScrollView automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
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
                The sign-in service has not been configured yet.
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

          {configured && isEmailPasswordAuthEnabled() && !isSignedIn ? (
            <View>
              <Text style={styles.fieldLabel}>Email *</Text>
              <TextInput accessibilityLabel="Email" value={email} onChangeText={setEmail}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress"
                editable={!authBusy} style={styles.bigFieldInput} />
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Password *</Text>
              <TextInput accessibilityLabel="Password" value={password} onChangeText={setPassword}
                autoCapitalize="none" autoCorrect={false} secureTextEntry textContentType="password"
                editable={!authBusy} style={styles.bigFieldInput} />
              <Pressable accessibilityRole="button" accessibilityLabel={signInMode ? 'Sign in' : 'Create account'}
                accessibilityState={{ disabled: authBusy, busy: authBusy }} disabled={authBusy}
                style={[styles.primaryButton, { marginTop: 16 }, authBusy && styles.disabledButton]}
                onPress={() => {
                  clearErrors();
                  void (signInMode ? onEmailSignIn(email, password) : onEmailSignUp(email, password))
                    .then(success => { if (success) setPassword(''); });
                }}>
                <Text style={styles.primaryButtonText}>{signInMode ? 'Sign in' : 'Create account'}</Text>
              </Pressable>
              <View style={styles.hlineRow}><View style={styles.hlineBar} /><Text style={styles.hlineLabel}>OR</Text><View style={styles.hlineBar} /></View>
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
              <ActivityIndicator color={palette.brand} />
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
              style={[styles.providerButton, { backgroundColor: palette.tint, borderColor: palette.brand, borderWidth: 1, marginTop: 12 }]}
              onPress={onTestUserSignIn}
            >
              <AppIcon name="brandRise" size={16} color={palette.brand} />
              <Text style={[styles.providerButtonText, { color: palette.brand, fontWeight: 'bold' }]}>
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
                setPassword('');
                setSignInMode(prev => !prev);
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

        {isSignedIn ? <View style={styles.footer}>
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
                  onboardingData ? resolveAuthenticatedStage(onboardingData) : 'signup_2',
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
        </View> : null}
      </SafeAreaView>
    );
  }

  // Require loaded onboardingData for all authenticated steps (signup_2..home)
  if (!onboardingData) {
    return (
      <SafeAreaView style={[styles.root, styles.centered, { backgroundColor: palette.canvas }]} edges={['top', 'bottom', 'left', 'right']}>
        <ActivityIndicator size="large" color={palette.brand} />
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
      <SafeAreaView style={[styles.root, { backgroundColor: palette.canvas }]} edges={['top', 'bottom', 'left', 'right']}>
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
              What brings you to DebtFree? *
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
              <ActivityIndicator color={palette.onBrand} />
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
      <SafeAreaView style={[styles.root, { backgroundColor: palette.canvas }]} edges={['top', 'bottom', 'left', 'right']}>
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
              How did you hear about DebtFree? *
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
                Were you considering DebtFree before asking an AI assistant? *
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
              <ActivityIndicator color={palette.onBrand} />
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
      <SafeAreaView style={[styles.root, { backgroundColor: palette.canvas }]} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Step"
          step={4}
          total={4}
          onBack={() => {
            clearErrors();
            onChangeStage('signup_3');
          }}
        />
        <ScrollView automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
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
            <AppIcon name="chevronDown" size={16} color={palette.brand} />
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
            <AppIcon name="chevronDown" size={16} color={palette.brand} />
          </Pressable>
          {showCurrencyPicker ? (
            <View style={styles.countryDropdown}>
              <TextInput accessibilityLabel="Search currencies" style={styles.textInputField} value={currencySearch} onChangeText={setCurrencySearch} placeholder="Search currency code" placeholderTextColor={palette.muted} />
              {CURRENCY_OPTIONS.filter(opt => (opt.code + ' ' + opt.label + ' ' + opt.symbol).toLowerCase().includes(currencySearch.toLowerCase())).map(opt => (
                <ChoiceButton key={opt.code} label={opt.code + ' (' + opt.symbol + ')'} selected={currencyCode === opt.code} onPress={() => { try { assertCurrencyChangeAllowed(onboardingData, opt.code, { transactions, recurringBills, reconciliationAnchors, complete: financeRecordsVerified }); onUpdateOnboardingData({ ...onboardingData, currencyCode: opt.code }); setLocalError(''); setShowCurrencyPicker(false); setCurrencySearch(''); } catch (error) { setLocalError(error instanceof Error ? error.message : 'Cannot change currency.'); } }} />
              ))}
            </View>
          ) : null}

          <Text style={styles.fieldLabel}>Do you manage finances with a partner? *</Text>
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
            Do you work with a financial professional? *
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
              Next, we’ll personalize your debt payoff plan in four short steps.
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
              <ActivityIndicator color={palette.onBrand} />
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
        'onboard_3',
      );
    };

    return (
      <SafeAreaView style={[styles.root, { backgroundColor: palette.canvas }]} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Setup"
          step={1}
          total={4}
          onBack={() => {
            clearErrors();
            onChangeStage('signup_4');
          }}
        />
        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
            <View style={styles.introBox}>
              <Text style={styles.introTitle} accessibilityRole="header">
                Let’s start with your income
              </Text>
              <Text style={styles.introSubtitle}>
                Enter your take-home income after taxes.
              </Text>
            </View>

            <Text style={styles.fieldLabel}>
              {onboardingData.primaryPayFrequency === 'weekly'
                ? 'Weekly take-home income *'
                : onboardingData.primaryPayFrequency === 'biweekly'
                  ? 'Biweekly take-home income *'
                  : onboardingData.primaryPayFrequency === 'twice_monthly'
                    ? 'Twice-monthly take-home income *'
                    : 'Monthly take-home income *'}
            </Text>
            <View style={styles.bigFieldBox}>
              <Text style={styles.bigFieldPrefix}>{currencySymbol}</Text>
              <TextInput
                accessibilityLabel="Take-home income amount" accessibilityHint="Required"
                style={styles.bigFieldInput}
                keyboardType="decimal-pad"
                value={incomeInput}
                onChangeText={text => {
                  clearErrors();
                  setIncomeInput(prev => acceptMoneyEdit(prev, text, currencyCode));
                }}
                placeholder="5,200.00"
                placeholderTextColor={palette.muted}
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
                <Text style={styles.fieldLabelSmall}>Source name *</Text>
                <TextInput
                  accessibilityLabel="Additional income source name" accessibilityHint="Required"
                  style={styles.textInputField}
                  value={extraIncomeName}
                  onChangeText={setExtraIncomeName}
                  placeholder="Partner salary or side income"
                  placeholderTextColor={palette.muted}
                />
                <Text style={styles.fieldLabelSmall}>Take-home amount *</Text>
                <TextInput
                  accessibilityLabel="Additional income amount" accessibilityHint="Required"
                  style={styles.textInputField}
                  keyboardType="decimal-pad"
                  value={extraIncomeAmount}
                  onChangeText={text => setExtraIncomeAmount(prev => acceptMoneyEdit(prev, text, currencyCode))}
                  placeholder="1500.00"
                  placeholderTextColor={palette.muted}
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
                <AppIcon name="add" size={18} color={palette.brand} />
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
              <ActivityIndicator color={palette.onBrand} />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 08: ONBOARDING SETUP 2 OF 4 — ADD YOUR DEBTS (onboard_03.png)
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
      <SafeAreaView style={[styles.root, { backgroundColor: palette.canvas }]} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Setup"
          step={2}
          total={4}
          onBack={() => {
            clearErrors();
            onChangeStage('onboard_1');
          }}
        />
        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
            <View style={[styles.introBox, styles.introCompact]}>
              <Text style={[styles.introTitle, styles.introTitleCompact]} accessibilityRole="header">
                Let’s add your debts
              </Text>
              <Text style={styles.introSubtitle}>
                Tell us what you own or pay for. We’ll only add a debt when a balance is owed.
              </Text>
            </View>

            <Text style={styles.splitLabel}>Your home</Text>
            <View style={styles.splitGrid3}>
              {(['Own', 'Rent', 'Other'] as HomeOwnershipStatus[]).map(status => (
                <ChoiceButton
                  key={status}
                  label={status}
                  compact
                  flex
                  selected={onboardingData.homeStatus === status}
                  onPress={() => {
                    clearErrors();
                    onUpdateOnboardingData({ ...onboardingData, homeStatus: status });
                  }}
                />
              ))}
            </View>

            <Text style={[styles.splitLabel, { marginTop: 14 }]}>Your vehicle</Text>
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
                <View style={styles.iconCircle}><AppIcon name="homeLoan" size={18} color={palette.brand} /></View>
                <View style={styles.flex1}>
                  <Text style={styles.twoRowTitle}>Home / Mortgage</Text>
                  <Text style={styles.twoRowSub}>{mortgageDebt
                    ? `${mortgageDebt.name} · ${formatCurrency(mortgageDebt.balance, currencyCode)} · ${mortgageDebt.apr}% APR`
                    : 'Balance, APR & monthly payment'}</Text>
                </View>
              </View>
              <View style={[styles.selectCircle, Boolean(mortgageDebt) && styles.selectCircleSelected]}>
                <AppIcon name={mortgageDebt ? 'check' : 'plus'} size={11} color={palette.onBrand} />
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
                  <AppIcon name="auto" size={18} color={palette.brand} />
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.twoRowTitle}>Auto loan</Text>
                  <Text style={styles.twoRowSub}>
                    {autoLoanDebt
                      ? `${autoLoanDebt.name} · ${formatCurrency(autoLoanDebt.balance, currencyCode)} · ${autoLoanDebt.apr}% APR`
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
                  color={palette.onBrand}
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
                  <AppIcon name="creditCard" size={18} color={palette.brand} />
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.twoRowTitle}>Credit cards & other loans</Text>
                  <Text style={styles.twoRowSub}>
                    {otherDebts.length > 0
                      ? `${otherDebts.length} account${otherDebts.length === 1 ? '' : 's'} added · Tap to add another`
                      : 'Add each account'}
                  </Text>
                </View>
              </View>
              <AppIcon name="add" size={20} color={palette.brand} />
            </Pressable>

            {/* Inline Debt Form */}
            {showDebtForm ? (
              <OnboardingDebtFormCard
                key={debtFormSeed.key}
                initialDraft={debtFormSeed.draft}
                editingDebtId={editingDebtId}
                currencyCode={currencyCode}
                currencySymbol={currencySymbol}
                householdTimeZone={onboardingData.householdTimeZone}
                saving={saving}
                styles={styles}
                mutedColor={palette.muted}
                onBrandColor={palette.onBrand}
                onCancel={() => {
                  clearErrors();
                  setShowDebtForm(false);
                  setEditingDebtId(null);
                  draftDebtIdRef.current = null;
                  draftDebtPaidTodayRef.current = {};
                }}
                onSave={handleSaveDebt}
              />
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
                        {`${item.name} · ${item.category}`}
                      </Text>
                      <Text style={styles.addedItemSub}>
                        {`${formatCurrency(item.balance, currencyCode)} balance · ${item.apr}% APR · ${formatCurrency(item.minimumPayment, currencyCode)}/mo min${
                          item.dueDay ? ` · Due day ${item.dueDay}` : ''
                        }`}
                      </Text>
                    </View>
                    <View style={styles.addedItemActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${item.name}`}
                        disabled={saving}
                        onPress={() => openEditDebtEditor(item)}
                      >
                        <Text style={styles.editActionText}>Edit</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.name}`}
                        disabled={saving}
                        onPress={() => void handleDeleteDebt(item.id)}
                      >
                        <Text style={[styles.removeActionText, saving && styles.disabledButton]}>Remove</Text>
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
              <ActivityIndicator color={palette.onBrand} />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 09: ONBOARDING SETUP 3 OF 4 — PAYOFF STRATEGY (onboard_04.png)
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
      <SafeAreaView style={[styles.root, { backgroundColor: palette.canvas }]} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Setup"
          step={3}
          total={4}
          onBack={() => {
            clearErrors();
            onChangeStage('onboard_3');
          }}
        />
        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
            <View style={[styles.introBox, styles.introCompact]}>
              <Text style={[styles.introTitle, styles.introTitleCompact]} accessibilityRole="header">
                Choose your payoff strategy
              </Text>
              <Text style={styles.introSubtitle}>
                You can change this later.
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
                  <AppIcon name="snowball" size={18} color={palette.brand} />
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
                  <AppIcon name="check" size={11} color={palette.onBrand} />
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
                  <AppIcon name="avalanche" size={18} color={palette.brand} />
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
                  <AppIcon name="check" size={11} color={palette.onBrand} />
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
                placeholderTextColor={palette.muted}
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
                  )} · Tracked-account forecast: ${payoffPlan.debtFreeDateLabel}${
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
              <ActivityIndicator color={palette.onBrand} />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 10: ONBOARDING COMPLETE (background notifications are not available)
  // ============================================================================
  if (stage === 'onboard_5') {
    const completeOnboarding = () => {
      if (savingRef.current) return;
      clearErrors();
      void persistAndMove(
        {
          onboardingCompleted: true,
          completedAt: new Date().toISOString(),
          notifications: {
            ...onboardingData.notifications,
            permissionRequested: false,
            osPermissionStatus: 'unavailable',
          },
        },
        'home',
      );
    };

    return (
      <SafeAreaView style={[styles.root, { backgroundColor: palette.canvas }]} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader label="Setup" step={4} total={4} onBack={() => onChangeStage('onboard_4')} />
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <View style={[styles.introBox, styles.introCompact]}>
            <Text style={[styles.introTitle, styles.introTitleCompact]} accessibilityRole="header">Your payoff plan is ready</Text>
            <Text style={styles.introSubtitle}>Review your tracked-account forecast below. You can adjust accounts or extra payments anytime.</Text>
          </View>

          {payoffPlan && strategyComparison ? (
            <View style={{ gap: 10 }}>
              <View style={styles.strategyPreviewCard}>
                <Text style={styles.strategyPreviewHeading}>
                  {`Payoff Plan Summary · ${onboardingData.strategy === 'avalanche' ? 'Avalanche' : 'Snowball'}`}
                </Text>
                <View style={styles.summaryRowBox}>
                  <Text style={styles.summaryRowLabel}>Estimated payoff</Text>
                  <Text style={styles.summaryRowValue}>
                    {payoffPlan.monthsToPayoff === null
                      ? payoffPlan.debtFreeDateLabel
                      : `${homeDebtFreeEstimateDate(payoffPlan.debtFreeDateLabel)} (${payoffPlan.monthsToPayoff} mo)`}
                  </Text>
                </View>
                <View style={styles.summaryRowBox}>
                  <Text style={styles.summaryRowLabel}>Monthly commitment</Text>
                  <Text style={styles.summaryRowValue}>
                    {`${formatCurrency(payoffPlan.monthlyTotalPayment, currencyCode)}/mo`}
                  </Text>
                </View>
                {strategyComparison.interestSavedVsMinimums !== null && (strategyComparison.interestSavedVsMinimums > 0 || (strategyComparison.monthsSavedVsMinimums ?? 0) > 0) ? (
                  <View style={[styles.calloutTeal, { marginTop: 10 }]}>
                    <Text style={styles.calloutTealText}>
                      {`Saves ${formatCurrency(strategyComparison.interestSavedVsMinimums, currencyCode)} in interest and ${strategyComparison.monthsSavedVsMinimums ?? 0} months vs. minimums only.`}
                    </Text>
                  </View>
                ) : strategyComparison.minimumsOnly.stalled && !payoffPlan.stalled ? (
                  <View style={[styles.calloutTeal, { marginTop: 10 }]}>
                    <Text style={styles.calloutTealText}>
                      Minimum payments alone would not clear these balances — your extra monthly commitment puts you on track for payoff.
                    </Text>
                  </View>
                ) : null}
              </View>

              {payoffPlan.payoffOrder.length > 1 ? (
                <View style={styles.strategyPreviewCard}>
                  <Text style={styles.strategyPreviewHeading}>SNOWBALL VS. AVALANCHE</Text>
                  <Text style={styles.strategyPreviewLine}>
                    {`Snowball: ${strategyComparison.snowball.monthsToPayoff ?? '—'} mo · ${formatCurrency(strategyComparison.snowball.totalInterest, currencyCode)} interest`}
                  </Text>
                  <Text style={styles.strategyPreviewLine}>
                    {`Avalanche: ${strategyComparison.avalanche.monthsToPayoff ?? '—'} mo · ${formatCurrency(strategyComparison.avalanche.totalInterest, currencyCode)} interest`}
                  </Text>
                  {strategyComparison.avalancheInterestSavingsVsSnowball !== null ? (
                    <Text style={[styles.strategyPreviewLine, { marginTop: 4, fontWeight: '700' }]}>
                      {strategyComparison.avalancheInterestSavingsVsSnowball > 0
                        ? `Avalanche saves ${formatCurrency(strategyComparison.avalancheInterestSavingsVsSnowball, currencyCode)} more interest${strategyComparison.avalancheMonthsSavedVsSnowball ? ` (${strategyComparison.avalancheMonthsSavedVsSnowball} mo faster)` : ''}.`
                        : 'Both methods result in the same total interest for your accounts.'}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={[styles.calloutTeal, { marginTop: 14 }]}>
            <Text style={styles.calloutTealText}>
              Upcoming bills and account status are available in the app. Background notifications are not available yet.
            </Text>
          </View>
          {!!localError ? <Text style={styles.errorText} accessibilityRole="alert">{localError}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          <Pressable accessibilityRole="button" accessibilityLabel="Finish setup" disabled={saving} style={[styles.primaryButton, saving && styles.disabledButton]} onPress={completeOnboarding}>
            {saving ? <ActivityIndicator color={palette.onBrand} /> : <Text style={styles.primaryButtonText}>Finish setup</Text>}
          </Pressable>
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
      householdSummaries={householdSummaries}
      onSwitchHousehold={onSwitchHousehold}
      onRefreshHouseholdContexts={onRefreshHouseholdContexts}
      onAcceptHouseholdInvite={onAcceptHouseholdInvite}
      onUpdateOnboardingData={onUpdateOnboardingData}
      transactions={transactions}
      recurringBills={recurringBills}
      reconciliationAnchors={reconciliationAnchors}
      currencyCode={currencyCode}
      currencySymbol={currencySymbol}
      onSignOut={onSignOut}
      onDeleteAccount={onDeleteAccount}
      accountDeletionEnabled={accountDeletionEnabled}
      onChangeStage={onChangeStage}
      onAddTransaction={handleAddTransaction}
      onUpdateTransaction={handleUpdateTransaction}
      onDeleteTransaction={handleDeleteTransaction}
      onRecordBillPayment={handleRecordBillPayment}
      onConfirmAnnualFee={handleConfirmAnnualFee}
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
      financeRecordsVerified={financeRecordsVerified}
      reloadFeedback={reloadFeedback}
    />
  );
}

type OnboardingDebtDraft = {
  category: DebtCategory;
  name: string;
  balance: string;
  originalBalance: string;
  apr: string;
  minimum: string;
  dueDay: string;
  creditLimit: string;
};

const OnboardingDebtFormCard = memo(function OnboardingDebtFormCard({
  initialDraft,
  editingDebtId,
  currencyCode,
  currencySymbol,
  householdTimeZone,
  saving,
  styles,
  mutedColor,
  onBrandColor,
  onCancel,
  onSave,
}: {
  initialDraft: OnboardingDebtDraft;
  editingDebtId: string | null;
  currencyCode: string;
  currencySymbol: string;
  householdTimeZone?: string;
  saving: boolean;
  styles: ReturnType<typeof createStyles>;
  mutedColor: string;
  onBrandColor: string;
  onCancel: () => void;
  onSave: (draft: OnboardingDebtDraft) => Promise<void>;
}) {
  const [debtCategory, setDebtCategory] = useState<DebtCategory>(initialDraft.category);
  const [debtName, setDebtName] = useState(initialDraft.name);
  const [debtBalance, setDebtBalance] = useState(initialDraft.balance);
  const [debtOriginalBalance, setDebtOriginalBalance] = useState(initialDraft.originalBalance);
  const [debtApr, setDebtApr] = useState(initialDraft.apr);
  const [debtMinimum, setDebtMinimum] = useState(initialDraft.minimum);
  const [debtDueDay, setDebtDueDay] = useState(initialDraft.dueDay);
  const [debtCreditLimit, setDebtCreditLimit] = useState(initialDraft.creditLimit);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const busy = saving || submitting;

  const handleSubmit = () => {
    if (busy || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    void onSave({
      category: debtCategory,
      name: debtName,
      balance: debtBalance,
      originalBalance: debtOriginalBalance,
      apr: debtApr,
      minimum: debtMinimum,
      dueDay: debtDueDay,
      creditLimit: debtCreditLimit,
    }).finally(() => {
      submittingRef.current = false;
      setSubmitting(false);
    });
  };

  return (
    <View style={styles.inlineEditorCard}>
      <Text style={styles.inlineEditorTitle}>
        {editingDebtId ? 'Edit debt account' : `Add ${debtCategory}`}
      </Text>

      <SelectDropdown
        label="Account category *"
        sheetTitle="Select Debt Category"
        value={debtCategory}
        options={DEBT_CATEGORY_DROPDOWN_OPTIONS}
        onSelect={setDebtCategory}
      />

      <Text style={styles.fieldLabelSmall}>Debt name *</Text>
      <TextInput
        accessibilityLabel="Debt name" accessibilityHint="Required"
        style={styles.textInputField}
        value={debtName}
        onChangeText={setDebtName}
        placeholder="e.g., Chase Freedom, Auto Loan"
        placeholderTextColor={mutedColor}
      />

      <View style={styles.choiceGrid2}>
        <View style={styles.flex1}>
          <Text style={styles.fieldLabelSmall}>Current balance ({currencySymbol}) *</Text>
          <TextInput
            accessibilityLabel="Current balance" accessibilityHint="Required"
            style={styles.textInputField}
            keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric"}
            value={debtBalance}
            onChangeText={text => setDebtBalance(prev => acceptMoneyEdit(prev, text, currencyCode, true))}
            placeholder="4200.00"
            placeholderTextColor={mutedColor}
          />
        </View>
        <View style={styles.flex1}>
          <Text style={styles.fieldLabelSmall}>APR (%) *</Text>
          <TextInput
            accessibilityLabel="APR percentage" accessibilityHint="Required"
            style={styles.textInputField}
            keyboardType="decimal-pad"
            value={debtApr}
            onChangeText={text => setDebtApr(prev => acceptAprEdit(prev, text))}
            placeholder="19.99"
            placeholderTextColor={mutedColor}
          />
        </View>
      </View>

      <View style={styles.choiceGrid2}>
        <View style={styles.flex1}>
          <Text style={styles.fieldLabelSmall}>Minimum payment ({currencySymbol}/mo) *</Text>
          <TextInput
            accessibilityLabel="Minimum monthly payment" accessibilityHint="Required"
            style={styles.textInputField}
            keyboardType="decimal-pad"
            value={debtMinimum}
            onChangeText={text => setDebtMinimum(prev => acceptMoneyEdit(prev, text, currencyCode))}
            placeholder="125.00"
            placeholderTextColor={mutedColor}
          />
        </View>
        <View style={styles.flex1}>
          <Text style={styles.fieldLabelSmall}>Due day (1–31, optional)</Text>
          <TextInput
            accessibilityLabel="Due day of month"
            style={styles.textInputField}
            keyboardType="number-pad"
            value={debtDueDay}
            onChangeText={setDebtDueDay}
            placeholder="15"
            placeholderTextColor={mutedColor}
          />
        </View>
      </View>

      {!editingDebtId && Number.isInteger(Number(debtDueDay)) && Number(debtDueDay) >= 1 && Number(debtDueDay) <= 31 ? (
        <Text style={styles.fieldLabelSmall}>{`First due date: ${obligationFirstDueDate(Number(debtDueDay), currentHouseholdDate(householdTimeZone), currencyCode)}`}</Text>
      ) : null}

      <Text style={styles.fieldLabelSmall}>
        Original balance ({currencySymbol}, optional)
      </Text>
      <TextInput
        accessibilityLabel="Original balance"
        style={styles.textInputField}
        keyboardType="decimal-pad"
        value={debtOriginalBalance}
        onChangeText={text => setDebtOriginalBalance(prev => acceptMoneyEdit(prev, text, currencyCode))}
        placeholder="25000.00"
        placeholderTextColor={mutedColor}
      />

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
            placeholderTextColor={mutedColor}
          />
        </>
      ) : null}

      <View style={[styles.choiceGrid2, { marginTop: 14 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel debt form"
          disabled={busy}
          style={[styles.subtleActionBtn, busy && styles.disabledButton]}
          onPress={onCancel}
        >
          <Text style={styles.subtleActionBtnText}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save debt account"
          disabled={busy}
          style={[styles.saveInlineBtn, busy && styles.disabledButton]}
          onPress={handleSubmit}
        >
          {busy ? (
            <ActivityIndicator color={onBrandColor} size="small" />
          ) : (
            <Text style={styles.saveInlineBtnText}>Save debt</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
});

const createStyles = (palette: AppearancePalette) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.canvas,
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
    color: palette.text,
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
    backgroundColor: palette.raised,
  },
  progressSegmentDone: {
    backgroundColor: palette.brand,
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
    backgroundColor: palette.raised,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
  },
  logoText: {
    fontSize: 22,
    fontWeight: '800',
    color: palette.text,
    letterSpacing: -0.8,
  },
  logoTextAccent: {
    color: palette.muted,
  },
  topSignInLink: {
    color: palette.muted,
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
    borderColor: palette.border,
  },
  orbitArcTeal: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 16,
    borderColor: 'transparent',
    borderTopColor: palette.border,
    borderRightColor: palette.border,
    transform: [{ rotate: '-28deg' }],
  },
  orbitArcTerracotta: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 16,
    borderColor: 'transparent',
    borderBottomColor: palette.border,
    transform: [{ rotate: '-28deg' }],
  },
  orbitCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBigText: {
    fontSize: 33,
    fontWeight: '800',
    color: palette.text,
    letterSpacing: -1,
  },
  heroMiniText: {
    fontSize: 11,
    color: palette.muted,
    marginTop: 2,
  },
  floatingCard: {
    position: 'absolute',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
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
    color: palette.text,
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
    color: palette.muted,
    marginTop: 3,
  },
  welcomeCopy: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 6,
  },
  badgeSmall: {
    backgroundColor: palette.surface,
    borderRadius: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginBottom: 16,
  },
  badgeSmallText: {
    fontSize: 10,
    fontWeight: '800',
    color: palette.muted,
    letterSpacing: 0.7,
  },
  welcomeTitle: {
    fontSize: 29,
    lineHeight: 34,
    fontWeight: '800',
    color: palette.text,
    textAlign: 'center',
    letterSpacing: -0.8,
    marginBottom: 12,
  },
  welcomeSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: palette.muted,
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
    color: palette.text,
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
    color: palette.muted,
    textAlign: 'center',
    maxWidth: 310,
  },
  // Buttons & Footer
  footer: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 42,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.canvas,
  },
  primaryButton: {
    minHeight: 51,
    borderRadius: 9,
    backgroundColor: palette.brand,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryButtonHot: {
    backgroundColor: palette.brand,
  },
  primaryButtonText: {
    color: palette.onBrand,
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
    color: palette.muted,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 11,
  },
  linkText: {
    fontSize: 12,
    color: palette.muted,
    fontWeight: '700',
  },
  inlineLinkWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legalNote: {
    fontSize: 11,
    color: palette.brand,
    textAlign: 'center',
    marginTop: 14,
  },
  // Provider buttons (Step 1 of 4)
  providerButton: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 9,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
    marginBottom: 9,
    backgroundColor: palette.surface,
    paddingHorizontal: 14,
  },
  providerButtonConnected: {
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  providerButtonPassive: {
    opacity: 0.85,
  },
  providerButtonText: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '700',
  },
  googleLetterIcon: {
    fontSize: 17,
    fontWeight: '800',
    color: palette.muted,
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
    backgroundColor: palette.text,
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
    backgroundColor: palette.text,
    borderRadius: 6,
    marginRight: -2,
  },
  appleMarkLobeRight: {
    width: 9,
    height: 13,
    backgroundColor: palette.text,
    borderRadius: 6,
  },
  appleMarkBite: {
    position: 'absolute',
    right: -2,
    top: 3,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: palette.surface,
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
    backgroundColor: palette.raised,
  },
  hlineLabel: {
    color: palette.brand,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  // Choices & Grids
  choice: {
    minHeight: 43,
    width: '100%',
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 9,
    backgroundColor: palette.surface,
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
    borderColor: palette.brand,
    backgroundColor: palette.tint,
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
    color: palette.text,
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
  },
  choiceTextCompact: {
    fontSize: 11,
  },
  choiceTextSelected: {
    color: palette.text,
  },
  choiceGrid2: {
    flexDirection: 'row',
    gap: 8,
  },
  splitLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.muted,
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
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 9,
    marginTop: 13,
  },
  calloutTealText: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  calloutOrange: {
    padding: 12,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 9,
    marginTop: 13,
  },
  calloutOrangeTitle: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
  calloutOrangeText: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  // Fields & Labels
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.muted,
    marginTop: 16,
    marginBottom: 7,
  },
  fieldLabelSmall: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.muted,
    marginTop: 10,
    marginBottom: 5,
  },
  countrySelector: {
    width: 112,
    minHeight: 54,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 9,
    backgroundColor: palette.surface,
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
    borderColor: palette.border,
    borderRadius: 9,
    backgroundColor: palette.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  bigFieldPrefix: {
    fontSize: 23,
    fontWeight: '700',
    color: palette.text,
    marginRight: 6,
  },
  bigFieldInput: {
    flex: 1,
    fontSize: 23,
    fontWeight: '700',
    color: palette.text,
    paddingVertical: 10,
  },
  fieldMutedUnit: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },
  helpText: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 16,
    color: palette.muted,
  },
  sectionTitle: {
    fontSize: 13,
    color: palette.text,
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
    borderColor: palette.border,
    borderRadius: 10,
    padding: 13,
  },
  smallAddText: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  // Two-Row Cards (Step 3 & Step 4)
  twoRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 13,
    backgroundColor: palette.surface,
    marginBottom: 9,
    minHeight: 56,
  },
  twoRowCardSelected: {
    borderColor: palette.border,
    backgroundColor: palette.surface,
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
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  twoRowTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.text,
  },
  twoRowSub: {
    fontSize: 11,
    color: palette.muted,
    marginTop: 3,
  },
  selectCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectCircleSelected: {
    backgroundColor: palette.brand,
    borderColor: palette.brand,
  },
  // Inline Editor & Added Items
  inlineEditorCard: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 11,
    padding: 14,
    marginVertical: 10,
  },
  inlineEditorTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.text,
    marginBottom: 6,
  },
  categoryPillsRow: {
    gap: 6,
    paddingVertical: 4,
  },
  textInputField: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    backgroundColor: palette.surface,
    paddingHorizontal: 12,
    fontSize: 14,
    color: palette.text,
  },
  subtleActionBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtleActionBtnText: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '600',
  },
  saveInlineBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: palette.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveInlineBtnText: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '700',
  },
  addedItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 9,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  addedItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.text,
  },
  addedItemSub: {
    fontSize: 11,
    color: palette.muted,
    marginTop: 3,
  },
  addedItemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  editActionText: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  removeActionText: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  summaryRowBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.surface,
    borderRadius: 9,
    padding: 12,
    marginTop: 10,
  },
  summaryRowLabel: {
    fontSize: 12,
    color: palette.muted,
    fontWeight: '600',
  },
  summaryRowValue: {
    fontSize: 15,
    color: palette.text,
    fontWeight: '800',
  },
  // Strategy Preview (Step 4)
  strategyPreviewCard: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 9,
    padding: 12,
    marginTop: 14,
  },
  strategyPreviewHeading: {
    fontSize: 12,
    fontWeight: '800',
    color: palette.muted,
    marginBottom: 4,
  },
  strategyPreviewLine: {
    fontSize: 12,
    color: palette.text,
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
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    gap: 12,
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.text,
  },
  toggleSub: {
    fontSize: 11,
    color: palette.muted,
    marginTop: 4,
    lineHeight: 16,
  },
  toggleTrack: {
    width: 39,
    height: 23,
    borderRadius: 12,
    backgroundColor: palette.raised,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  toggleTrackOn: {
    backgroundColor: palette.raised,
  },
  toggleThumb: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    backgroundColor: palette.raised,
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
    backgroundColor: palette.raised,
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
    borderBottomColor: palette.border,
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
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  headerActionPillText: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  headerSignOutPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  headerSignOutPillText: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  homeContent: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 34,
  },
  homeHeroCard: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
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
    color: palette.muted,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  homeTotalDebtAmount: {
    fontSize: 28,
    fontWeight: '800',
    color: palette.text,
    letterSpacing: -0.6,
  },
  homeHeroSub: {
    fontSize: 11,
    color: palette.muted,
    marginTop: 2,
  },
  homeProgressBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 4,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeProgressPercent: {
    fontSize: 16,
    fontWeight: '800',
    color: palette.text,
  },
  homeProgressCaption: {
    fontSize: 9,
    color: palette.muted,
  },
  homeStatsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  homeStatCell: {
    flex: 1,
    backgroundColor: palette.canvas,
    borderRadius: 9,
    padding: 10,
    borderWidth: 1,
    borderColor: palette.border,
  },
  homeStatLabel: {
    fontSize: 10,
    color: palette.muted,
    fontWeight: '600',
  },
  homeStatValue: {
    fontSize: 15,
    fontWeight: '800',
    color: palette.text,
    marginTop: 2,
  },
  homeStatMicro: {
    fontSize: 10,
    color: palette.muted,
    marginTop: 2,
  },
  priorityCard: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  priorityTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: palette.text,
  },
  prioritySub: {
    fontSize: 11,
    color: palette.muted,
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
    color: palette.muted,
  },
  priorityMetricValue: {
    fontSize: 12,
    fontWeight: '800',
    color: palette.text,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 10,
  },
  homeDebtCard: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
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
    backgroundColor: palette.surface,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  priorityOrderPillText: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  homeDebtName: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.text,
  },
  homeDebtMeta: {
    fontSize: 11,
    color: palette.muted,
    marginTop: 2,
  },
  homeDebtBalance: {
    fontSize: 15,
    fontWeight: '800',
    color: palette.text,
  },
  homeDebtFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  homeDebtPlanText: {
    fontSize: 11,
    color: palette.muted,
    fontWeight: '600',
  },
});




