import { settingsFailureSnapshot } from '../settings-contract';
import { BitLessMark } from '../components/BitLessMark';
import React, { useState, useRef, useEffect, useCallback, useMemo, type ReactNode, type ComponentRef } from 'react';
import {
  AppState,
  Keyboard,
  RefreshControl,
  ScrollView as NativeScrollView,
  Platform,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';
import { Pressable, ScrollView, Text, TextInput, View, useNativeAppearance } from '../components/NativeAppearance';
import Svg, { Path } from 'react-native-svg';
import * as SecureStore from 'expo-secure-store';
import * as ExpoCrypto from 'expo-crypto';
import type { Session } from '@supabase/supabase-js';
import { AppIcon } from '../components/AppIcon';
import { type DropdownOption } from '../components/SelectDropdown';
import {
  Card,
  SnapshotCard,
  ui,
} from '../components/FinancialScreen';
import { FiveTabShell } from '../FiveTabShell';
import { DebtScreen } from './DebtScreen';
import { TransactionsScreen } from './TransactionsScreen';
import { BudgetScreen } from './BudgetScreen';
import { ProgressScreen } from './ProgressScreen';
import { SettingsScreen } from './SettingsScreen';
import { WelcomeSheet } from '../components/WelcomeSheet';
import { ObligationPaySheet, type PayNowTarget } from '../components/ObligationPaySheet';
import { SheetFormHeader, SheetModal } from '../components/SheetModal';
import { AdaptiveModal } from '../components/ModalOverlay';
import { CalendarDatePickerModal, DueDayPickerModal, formatShortDate } from '../components/DatePickerModal';
import { InformationButton } from '../components/InformationSheet';
import { InspireHorizonBackground, InspireQuote } from '../components/InspireArt';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomInsetPadding } from '../components/bottom-inset';
import {
  acceptAprEdit,
  acceptMoneyEdit,
  activeDebts,
  calculateBalanceSnapshot,
  calculatePayoffPlan,
  estimateMinimumPayment,
  formatCurrency,
  formatEditableMoney,
  homeDebtFreeEstimateDate,
  parseMoneyInput,
  parsePercentInput,
  type DebtCategory,
  type DebtItem,
  type FlowStage,
  type PayoffPlanResult,
  type PayoffStrategy,
  type UserOnboardingData,
} from '../onboarding-domain';
import {
  deleteUserDebt,
  upsertUserDebt,
  saveUserOnboardingSettingsPatch,
  loadUserOnboardingData,
} from '../onboarding-storage';
import { type LedgerTransaction, type ReconciliationAnchor, classifyCategoryDirection, isPaidOffAccountArchived } from '../finance/ledger';
import { transactionHasBillId } from '../finance/bill-identity';
import { type RecurringBill } from '../finance/recurring-bills';
import {
  unifiedLoanRuntime,
  uniqueHistoricalBillIdByDebtId,
  canEditDebtCategoryWithPairings,
  validateDivergentLinkResolution,
  loansWithIncompleteSchedule,
  validatedLoanBillLinks,
  type DivergentLoanBillLink,
} from '../finance/loan-bill-pairing';
import { prepareUnifiedLoanSettings } from '../finance/unified-loan';
import { moneyToMajor, parseMoney, type Money } from '../finance/money';
import { getCurrency } from '../finance/currencies';
import { addCalendarDays, type DateOnly, currentHouseholdDate, parseDateOnly } from '../finance/calendar';
import {
  confirmObligationPaidToday,
  obligationFirstDueDate,
  prepareObligationEditorSchedule,
  removeObligationEditorSchedule,
  shouldAskPaidToday,
  saveObligationEditorSchedule,
} from '../finance/obligation-editor';
import { obligationScheduleKey } from '../finance/obligation-schedule';
import type { ObligationSchedule, ObligationScheduleKey } from '../finance/obligation-schedule';
import {
  calculateOverdueObligations,
  getScheduledObligationRows,
} from '../finance/payment-matching';
import { getPlannedDebtInstallments, resolveUnifiedDebtSplitPlans } from '../finance/debt-payment-split';
import {
  canEditHousehold,
  type HouseholdMembershipSummary,
} from '../household-context';

export const DEBT_CATEGORY_DROPDOWN_OPTIONS: readonly DropdownOption<DebtCategory>[] = [
  { value: 'Mortgage', label: 'Mortgage', subtitle: 'Home loan with separate escrow tracking', icon: 'homeLoan' },
  { value: 'Credit card', label: 'Credit card', subtitle: 'Revolving line of credit', icon: 'creditCard' },
  { value: 'Auto loan', label: 'Auto loan', subtitle: 'Vehicle financing', icon: 'auto' },
  { value: 'Student loan', label: 'Student loan', subtitle: 'Higher education loan', icon: 'debt' },
  { value: 'Personal loan', label: 'Personal loan', subtitle: 'Unsecured installment loan', icon: 'debt' },
  { value: 'Medical debt', label: 'Medical debt', subtitle: 'Healthcare balance', icon: 'debt' },
  { value: 'Other loan', label: 'Other loan', subtitle: 'General debt obligation', icon: 'debt' },
];

export type DebtDetailsDraft = {
  category: DebtCategory;
  name: string;
  balance: string;
  originalBalance: string;
  apr: string;
  minimumPayment: string;
  minimumMode: 'auto' | 'manual';
  mortgageEscrow: string;
  dueDay: string;
  creditLimit: string;
  annualFeeAmount: string;
  annualFeeNextDate: string;
};

function formatShortActivityDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed);
}

function getCategoryBadge(category?: string, isPayment?: boolean) {
  if (isPayment) {
    return { icon: 'creditCard' as const, bg: 'rgba(118, 220, 185, 0.14)', color: '#76DCB9' };
  }
  switch (category) {
    case 'utilities':
      return { icon: 'bolt' as const, bg: 'rgba(245, 197, 99, 0.14)', color: '#F5C563' };
    case 'housing':
    case 'Mortgage':
      return { icon: 'homeLoan' as const, bg: 'rgba(45, 212, 191, 0.14)', color: '#2DD4BF' };
    case 'insurance':
      return { icon: 'shield' as const, bg: 'rgba(236, 72, 153, 0.14)', color: '#EC4899' };
    case 'auto':
    case 'Auto loan':
      return { icon: 'auto' as const, bg: 'rgba(96, 165, 250, 0.14)', color: '#60A5FA' };
    case 'subscription':
      return { icon: 'grid' as const, bg: 'rgba(167, 139, 250, 0.14)', color: '#A78BFA' };
    case 'Credit card':
      return { icon: 'creditCard' as const, bg: 'rgba(96, 165, 250, 0.14)', color: '#60A5FA' };
    default:
      return { icon: 'calendar' as const, bg: 'rgba(96, 165, 250, 0.14)', color: '#60A5FA' };
  }
}

export type HomeScreenProps = {
  session: Session | null;
  onboardingData: UserOnboardingData;
  householdSummaries?: HouseholdMembershipSummary[];
  onSwitchHousehold?: (householdId: string) => Promise<void>;
  onRefreshHouseholdContexts?: () => Promise<HouseholdMembershipSummary[]>;
  onAcceptHouseholdInvite?: (tokenOrUrl: string) => Promise<void>;
  onUpdateOnboardingData: (data: UserOnboardingData) => void;
  transactions: LedgerTransaction[];
  recurringBills: RecurringBill[];
  reconciliationAnchors: ReconciliationAnchor[];
  currencyCode: string;
  currencySymbol: string;
  onSignOut: () => void | Promise<void>;
  onDeleteAccount?: () => Promise<void>;
  accountDeletionEnabled?: boolean;
  onChangeStage: (stage: FlowStage) => void;
  onAddTransaction: (tx: LedgerTransaction) => unknown;
  onUpdateTransaction?: (tx: LedgerTransaction) => unknown;
  onDeleteTransaction?: (txId: string) => unknown;
  onRecordBillPayment: (bill: RecurringBill, dueCycle: DateOnly, amount?: Money) => unknown;
  onConfirmAnnualFee: (debtId: string, renewalDate: DateOnly) => Promise<{ outcome: 'confirmed' | 'pending' }>;
  onReconcileDebt: (
    item: DebtItem,
    verifiedBalance: number,
    reason: 'interest_adjustment' | 'balance_adjustment' | 'credit_adjustment',
  ) => unknown;
  onAddRecurringBill: (bill: RecurringBill) => Promise<{ outcome: 'confirmed' | 'pending' } | void> | { outcome: 'confirmed' | 'pending' } | void;
  onDeleteRecurringBill: (billId: string, expectedSnapshotToken: string) => Promise<{
    status: 'confirmed' | 'pending' | 'partial';
    deletedTransactions: number;
    totalTransactions: number;
    billDeleted?: boolean;
    message?: string;
  }>;
  onSaveObligationSchedule: (key: ObligationScheduleKey, schedule: ObligationSchedule) => Promise<void>;
  onUpdateTransactions?: (txs: LedgerTransaction[]) => void;
  onUpdateRecurringBills?: (bills: RecurringBill[]) => void;
  onUpdateReconciliationAnchors?: (anchors: ReconciliationAnchor[]) => void;
  authBusy?: boolean;
  onReload: () => Promise<void>;
  reloading: boolean;
  financeRecordsVerified?: boolean;
  reloadFeedback?: { kind: 'success' | 'warning' | 'error'; message: string } | null;
};

export function HomeScreen({
  session,
  onboardingData,
  householdSummaries = [],
  onSwitchHousehold,
  onRefreshHouseholdContexts,
  onAcceptHouseholdInvite,
  onUpdateOnboardingData,
  transactions,
  recurringBills,
  reconciliationAnchors,
  currencyCode,
  currencySymbol,
  onSignOut,
  onDeleteAccount,
  accountDeletionEnabled = false,
  onAddTransaction,
  onUpdateTransaction,
  onDeleteTransaction,
  onRecordBillPayment,
  onConfirmAnnualFee,
  onReconcileDebt,
  onAddRecurringBill,
  onDeleteRecurringBill,
  onSaveObligationSchedule,
  onUpdateTransactions,
  onUpdateRecurringBills,
  onUpdateReconciliationAnchors,
  authBusy = false,
  onReload,
  reloading,
  financeRecordsVerified = false,
  reloadFeedback = null,
}: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const canEdit = session
    ? (onboardingData.householdContext ? canEditHousehold(onboardingData.householdContext) : false)
    : true;
  const reloadRef = useRef(onReload);
  const reloadingRef = useRef(reloading);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const refreshOwnerKey = `${session?.user.id ?? 'offline'}:${onboardingData.userId}:${onboardingData.householdId}:${currencyCode}`;
  const refreshOwnerRef = useRef(refreshOwnerKey);
  if (refreshOwnerRef.current !== refreshOwnerKey) {
    refreshOwnerRef.current = refreshOwnerKey;
    refreshPromiseRef.current = null;
  }
  reloadRef.current = onReload;
  reloadingRef.current = reloading;
  const refreshAccountData = useCallback((): Promise<void> => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    if (reloadingRef.current) return Promise.resolve();
    const requestedOwner = refreshOwnerRef.current;
    const reload = reloadRef.current;
    const promise = Promise.resolve().then(() => {
      if (refreshOwnerRef.current === requestedOwner) return reload();
    }).finally(() => {
      if (refreshPromiseRef.current === promise) refreshPromiseRef.current = null;
    });
    refreshPromiseRef.current = promise;
    return promise;
  }, []);
  const greetingName = [session?.user.user_metadata?.full_name, session?.user.user_metadata?.name, session?.user.user_metadata?.user_name, session?.user.email?.split('@')[0]]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim().split(/\s+/)[0] || 'there';
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState('');
  const [settingsUncertain, setSettingsUncertain] = useState(false);
  const [checkingSettings, setCheckingSettings] = useState(false);
  const settingsUncertainRef = useRef(false);
  const markSettingsUncertain = () => { settingsUncertainRef.current = true; setSettingsUncertain(true); };
  const requireConfirmedSettings = () => {
    if (settingsUncertainRef.current) throw new Error('Check the unconfirmed settings save before making another settings change.');
  };

  const [showSettings, setShowSettings] = useState(false);
  const [homeVisible, setHomeVisible] = useState(true);
  const [homeInformationOpen, setHomeInformationOpen] = useState(false);
  const homeScrollRef = useRef<ComponentRef<typeof NativeScrollView>>(null);
  const pairingReviewY = useRef(0);
  const upcomingSectionY = useRef(0);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [payUpcomingTarget, setPayUpcomingTarget] = useState<PayNowTarget | null>(null);
  const [welcomePending, setWelcomePending] = useState(false);
  const welcomeShownRef = useRef(false);
  const [appActive, setAppActive] = useState(AppState.currentState == null || AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);
  const savingRef = useRef(false);
  const latestOnboardingRef = useRef(onboardingData);
  latestOnboardingRef.current = onboardingData;
  const [pairingBusy, setPairingBusy] = useState(false);

  const [themePreference, setThemePreference] = useState<'System' | 'Dark' | 'Light' | 'Inspire'>('Dark');

  useEffect(() => {
    let active = true;
    const userId = session?.user?.id ?? onboardingData.userId;
    SecureStore.getItemAsync(`debtfree-pref-theme.${userId.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
      .then(savedTheme => {
        if (!active || !savedTheme) return;
        if (savedTheme === 'System' || savedTheme === 'Dark' || savedTheme === 'Light' || savedTheme === 'Inspire') {
          setThemePreference(savedTheme as 'System' | 'Dark' | 'Light' | 'Inspire');
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [session, onboardingData.userId]);

  // Add/Edit Debt form state
  const [editingDebtId, setEditingDebtId] = useState<string | null>(null);
  const draftDebtIdRef = useRef<string | null>(null);
  const draftDebtPaidTodayRef = useRef<Record<string, boolean>>({});
  const [showDebtForm, setShowDebtForm] = useState(false);
  const [debtCategory, setDebtCategory] = useState<DebtCategory>('Credit card');
  const [debtName, setDebtName] = useState('');
  const [debtBalance, setDebtBalance] = useState('');
  const [debtOriginalBalance, setDebtOriginalBalance] = useState('');
  const [debtApr, setDebtApr] = useState('');
  const [debtMinimum, setDebtMinimum] = useState('');
  const [mortgageEscrow, setMortgageEscrow] = useState('');
  const [debtDueDay, setDebtDueDay] = useState('');
  const [debtCreditLimit, setDebtCreditLimit] = useState('');
  const [debtAnnualFeeAmount, setDebtAnnualFeeAmount] = useState('');
  const [debtAnnualFeeNextDate, setDebtAnnualFeeNextDate] = useState('');
  const [debtMinimumMode, setDebtMinimumMode] = useState<'auto' | 'manual'>('auto');
  const [showDebtMoreDetails, setShowDebtMoreDetails] = useState(false);
  const [showDebtDuePicker, setShowDebtDuePicker] = useState(false);
  const [showDebtRenewalPicker, setShowDebtRenewalPicker] = useState(false);
  const [showDebtCategoryPicker, setShowDebtCategoryPicker] = useState(false);

  const plan: PayoffPlanResult = useMemo(
    () =>
      calculatePayoffPlan(
        onboardingData.debts,
        onboardingData.strategy,
        onboardingData.extraMonthlyPayment,
        new Date(),
        currencyCode,
        'UTC',
        onboardingData.archivedPaidOffDebtIds,
      ),
    [onboardingData.debts, onboardingData.strategy, onboardingData.extraMonthlyPayment, currencyCode, onboardingData.archivedPaidOffDebtIds],
  );

  const householdTimeZone =
    onboardingData?.householdTimeZone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';

  const todayKey = currentHouseholdDate(householdTimeZone);
  const loanRuntime = useMemo(() => unifiedLoanRuntime({ debts: onboardingData.debts, bills: recurringBills, pairings: onboardingData.loanBillPairingByDebtId, archived: onboardingData.archivedPaidOffDebtIds, currency: currencyCode }), [onboardingData.debts, recurringBills, onboardingData.loanBillPairingByDebtId, onboardingData.archivedPaidOffDebtIds, currencyCode]);
  const loanBillPairs = loanRuntime.legacyPairs;
  const historicalLoanBillIds = loanRuntime.aliases;
  const canonicalPlanAliases = useMemo(() => Object.fromEntries(Object.entries(loanRuntime.aliases).filter(([id]) => !loanRuntime.legacyPairs[id] && !loanRuntime.excludedDebtIds.includes(id))), [loanRuntime]);
  const effectiveDebtSplitPlans = useMemo(() => resolveUnifiedDebtSplitPlans(onboardingData.debtPaymentSplitPlansByDebtId, onboardingData.billPaymentSplitPlansByBillId, canonicalPlanAliases), [onboardingData.debtPaymentSplitPlansByDebtId, onboardingData.billPaymentSplitPlansByBillId, canonicalPlanAliases]);
  const identityLoanBillPairs = uniqueHistoricalBillIdByDebtId(onboardingData.loanBillPairingByDebtId);
  const pairingAudit = loanRuntime.audit;
  const scheduledDebtAccounts = useMemo(() => onboardingData.debts.filter(debt => !loanRuntime.excludedDebtIds.includes(debt.id)), [onboardingData.debts, loanRuntime]);
  const incompleteLoanSchedules = loansWithIncompleteSchedule(onboardingData.debts, onboardingData.archivedPaidOffDebtIds);
  const debtById = new Map(onboardingData.debts.map(debt => [debt.id, debt]));
  const linkedDebtByBillId = new Map(
    Object.entries(identityLoanBillPairs).map(([debtId, billId]) => [billId, debtById.get(debtId)]),
  );
  const archivedLinkedBillIds = loanRuntime.excludedBillIds;
  const windowEndKey = addCalendarDays(todayKey, 10);
  const criticalEndKey = addCalendarDays(todayKey, 3);

  const currencyScale = getCurrency(currencyCode).scale;

  type HomeUpcomingItem = {
    id: string;
    name: string;
    dueDate: DateOnly;
    amount: number;
    isPartiallyPaid: boolean;
    isPastDue: boolean;
    isCritical: boolean;
    totalPaid: number;
    settlementStatus: 'unpaid' | 'partially_paid' | 'pending_confirmation';
    isPendingConfirmation: boolean;
    pendingAmount: number;
    category?: string;
    installmentLabel?: string;
    payTarget: PayNowTarget;
  };

  const scheduledRows = useMemo(
    () =>
      getScheduledObligationRows({
        debts: scheduledDebtAccounts,
        recurringBills,
        transactions,
        asOfDate: todayKey,
        currencyCode,
        schedules: onboardingData.obligationSchedules,
        loanBillPairs,
        historicalBillIdsByDebtId: historicalLoanBillIds,
        excludedBillIds: archivedLinkedBillIds,
      }),
    [scheduledDebtAccounts, recurringBills, transactions, todayKey, currencyCode, onboardingData.obligationSchedules, loanBillPairs, historicalLoanBillIds, archivedLinkedBillIds],
  );

  const plannedInstallments = useMemo(
    () =>
      getPlannedDebtInstallments({
        rows: scheduledRows,
        plans: effectiveDebtSplitPlans,
        billPlans: onboardingData.billPaymentSplitPlansByBillId,
      historicalBillIdsByDebtId: historicalLoanBillIds,
        transactions,
        asOfDate: todayKey,
      }),
    [scheduledRows, effectiveDebtSplitPlans, onboardingData.billPaymentSplitPlansByBillId, historicalLoanBillIds, transactions, todayKey],
  );

  const installmentsByRowId = new Map<string, typeof plannedInstallments>();
  for (const event of plannedInstallments) {
    const existing = installmentsByRowId.get(event.obligationId);
    if (existing) existing.push(event);
    else installmentsByRowId.set(event.obligationId, [event]);
  }

  const allUpcomingCandidates: HomeUpcomingItem[] = [];
  for (const row of scheduledRows) {
    const match = row.state.confirmedMatch;
    if (row.state.status === 'paid' || match.isSatisfied) continue;
    const linkedDebt = row.kind === 'bill' && row.bill ? linkedDebtByBillId.get(row.bill.id) : undefined;
    const baseName = row.kind === 'debt'
      ? (row.debt?.name ?? row.name.replace(/\s+minimum$/i, ''))
      : (linkedDebt?.name ?? row.bill?.name ?? row.name);
    const category = row.kind === 'debt' ? row.debt?.category : (linkedDebt?.category ?? row.bill?.category);
    const accountId = row.kind === 'debt' ? row.debt?.id : row.bill?.creditAccountId;
    const totalPaidMajor = moneyToMajor(match.totalPaid);
    const pendingAmountMajor = moneyToMajor(row.state.pendingAmount);
    const isPendingConfirmation = row.state.status === 'pending_confirmation';
    const settlementStatus = row.state.status as 'unpaid' | 'partially_paid' | 'pending_confirmation';
    const rowEvents = installmentsByRowId.get(row.id) ?? [];

    if (rowEvents.length > 0) {
      const confirmedPaidMinor = Math.max(0, row.requiredAmount.minorUnits - match.remainingAmount.minorUnits);
      for (const event of rowEvents) {
        if (event.status === 'covered') continue;
        if (event.date > windowEndKey) continue;
        const neededForTargetMinor = Math.max(0, event.cumulativeTargetMinor - confirmedPaidMinor);
        const installmentRemainingMinor = Math.min(event.amountMinor, match.remainingAmount.minorUnits, neededForTargetMinor);
        if (installmentRemainingMinor <= 0 && event.status !== 'pending') continue;
        const isPastDue = event.date < todayKey;
        const isCritical = isPastDue || event.date <= criticalEndKey;
        const installmentAmountMajor = installmentRemainingMinor / 10 ** currencyScale;
        const installmentPaidMinor = Math.max(0, event.amountMinor - installmentRemainingMinor);
        const installmentPartial = installmentPaidMinor > 0 && installmentRemainingMinor > 0;
        allUpcomingCandidates.push({
          id: `${row.id}:inst:${event.installment}`,
          name: baseName,
          dueDate: event.date,
          amount: installmentAmountMajor,
          isPartiallyPaid: installmentPartial || match.isPartiallyPaid,
          isPastDue,
          isCritical,
          totalPaid: installmentPartial ? installmentPaidMinor / 10 ** currencyScale : totalPaidMajor,
          settlementStatus: event.status === 'pending' ? 'pending_confirmation' : (installmentPartial || match.isPartiallyPaid) ? 'partially_paid' : 'unpaid',
          isPendingConfirmation: event.status === 'pending' || isPendingConfirmation,
          pendingAmount: pendingAmountMajor,
          category,
          installmentLabel: `Installment ${event.installment}`,
          payTarget: {
            type: row.kind,
            name: baseName,
            dueDate: row.dueDate,
            requiredAmount: moneyToMajor(row.requiredAmount),
            overridePayAmount: installmentAmountMajor,
            installmentLabel: `Installment ${event.installment} (${event.date})`,
            accountId,
            bill: row.bill,
            debt: row.debt,
          },
        });
      }
      continue;
    }

    if (row.dueDate > windowEndKey) continue;
    const isPastDue = row.dueDate < todayKey;
    const isCritical = isPastDue || row.dueDate <= criticalEndKey;
    allUpcomingCandidates.push({
      id: row.id,
      name: baseName,
      dueDate: row.dueDate,
      amount: moneyToMajor(match.remainingAmount),
      isPartiallyPaid: match.isPartiallyPaid,
      isPastDue,
      isCritical,
      totalPaid: totalPaidMajor,
      settlementStatus,
      isPendingConfirmation,
      pendingAmount: pendingAmountMajor,
      category,
      payTarget: {
        type: row.kind,
        name: baseName,
        dueDate: row.dueDate,
        requiredAmount: moneyToMajor(row.requiredAmount),
        accountId,
        bill: row.bill,
        debt: row.debt,
      },
    });
  }

  const futureUpcomingItems = allUpcomingCandidates.filter(item => !item.isPastDue);
  const sortedUpcomingItems = [...allUpcomingCandidates].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  const upcomingItems = showAllUpcoming ? sortedUpcomingItems : sortedUpcomingItems.slice(0, 4);

  const overdueItems = calculateOverdueObligations({
    debts: scheduledDebtAccounts,
    recurringBills,
    transactions,
    asOfDate: todayKey,
    currencyCode,
    schedules: onboardingData.obligationSchedules,
    loanBillPairs,
    historicalBillIdsByDebtId: historicalLoanBillIds,
    excludedBillIds: archivedLinkedBillIds,
  });
  const pendingTxCount = transactions.filter(tx => tx.isPending && !tx.deletedAt).length;
  const pairingReviewCount = pairingAudit.divergentLinks.length + pairingAudit.invalidLinks.length;
  const hasWelcomeAttention = overdueItems.length > 0 || sortedUpcomingItems.length > 0 || pendingTxCount > 0 || pairingReviewCount > 0;

  useEffect(() => {
    if (!financeRecordsVerified || welcomeShownRef.current) return;
    const id = setTimeout(() => {
      if (welcomeShownRef.current) return;
      welcomeShownRef.current = true;
      if (hasWelcomeAttention) {
        setWelcomePending(true);
      }
    }, 0);
    return () => clearTimeout(id);
  }, [financeRecordsVerified, hasWelcomeAttention]);

  const clearErrors = () => setLocalError('');

  const openSettings = () => {
    clearErrors();
    setShowSettings(true);
  };

  const closeSettings = () => {
    setShowSettings(false);
  };

  const openNewDebtEditor = (
    category: DebtCategory = 'Credit card',
    prefill?: { name?: string; minimumPayment?: string; dueDay?: string },
  ) => {
    clearErrors();
    draftDebtIdRef.current = null;
    draftDebtPaidTodayRef.current = {};
    setEditingDebtId(null);
    setDebtCategory(category);
    setDebtName(prefill?.name ?? '');
    setDebtBalance('');
    setDebtOriginalBalance('');
    setDebtApr('');
    setDebtMinimum(prefill?.minimumPayment ?? '');
    setDebtMinimumMode(prefill?.minimumPayment?.trim() ? 'manual' : 'auto');
    setMortgageEscrow('');
    setDebtDueDay(prefill?.dueDay ?? '');
    setDebtCreditLimit('');
    setDebtAnnualFeeAmount('');
    setDebtAnnualFeeNextDate('');
    setShowDebtMoreDetails(false);
    setShowDebtDuePicker(false);
    setShowDebtRenewalPicker(false);
    setShowDebtCategoryPicker(false);
    setShowDebtForm(true);
  };

  const openEditDebtEditor = (item: DebtItem) => {
    clearErrors();
    draftDebtIdRef.current = null;
    draftDebtPaidTodayRef.current = {};
    setEditingDebtId(item.id);
    setDebtCategory(item.category);
    setDebtName(item.name);
    setDebtBalance(formatEditableMoney(item.balance, currencyCode));
    setDebtOriginalBalance(item.originalBalance !== null ? formatEditableMoney(item.originalBalance, currencyCode) : '');
    setDebtApr(String(item.apr));
    setDebtMinimum(formatEditableMoney(item.minimumPayment, currencyCode));
    setDebtMinimumMode('manual');
    setMortgageEscrow(onboardingData.mortgageEscrowByDebtId?.[item.id] !== undefined
      ? formatEditableMoney(onboardingData.mortgageEscrowByDebtId[item.id], currencyCode)
      : '');
    setDebtDueDay(item.dueDay !== null ? String(item.dueDay) : '');
    setDebtCreditLimit(item.creditLimit !== null ? formatEditableMoney(item.creditLimit, currencyCode) : '');
    setDebtAnnualFeeAmount(item.annualFeeAmount != null ? formatEditableMoney(item.annualFeeAmount, currencyCode) : '');
    setDebtAnnualFeeNextDate(item.annualFeeNextDueDate ?? '');
    setShowDebtMoreDetails(
      item.originalBalance !== null ||
      item.creditLimit !== null ||
      item.annualFeeAmount != null ||
      Boolean(item.annualFeeNextDueDate),
    );
    setShowDebtDuePicker(false);
    setShowDebtRenewalPicker(false);
    setShowDebtCategoryPicker(false);
    setShowDebtForm(true);
  };

  const closeDebtEditor = () => {
    clearErrors();
    setShowDebtForm(false);
    setEditingDebtId(null);
    setShowDebtDuePicker(false);
    setShowDebtRenewalPicker(false);
    setShowDebtCategoryPicker(false);
    draftDebtIdRef.current = null;
    draftDebtPaidTodayRef.current = {};
  };

  const saveDebtRecord = async (
    targetDebtId: string | null,
    draft: DebtDetailsDraft,
    { isDraftFlow }: { isDraftFlow: boolean },
  ): Promise<boolean> => {
    requireConfirmedSettings();
    if (savingRef.current) throw new Error('Another change is still saving. Try again in a moment.');
    const currentData = latestOnboardingRef.current;
    const existingDebt = targetDebtId ? currentData.debts.find(d => d.id === targetDebtId) : undefined;
    if (targetDebtId) {
      const allowed = canEditDebtCategoryWithPairings(currentData.loanBillPairingByDebtId, targetDebtId, draft.category, recurringBills);
      if (!allowed.valid) throw new Error(allowed.error);
    }
    const balanceNum = parseMoneyInput(draft.balance, currencyCode, true);
    const aprNum = parsePercentInput(draft.apr);
    const minNum = balanceNum === null || aprNum === null
      ? null
      : draft.minimumMode === 'auto'
        ? estimateMinimumPayment(balanceNum, aprNum, currencyCode)
        : parseMoneyInput(draft.minimumPayment, currencyCode);
    const escrowNum = draft.category === 'Mortgage' && draft.mortgageEscrow.trim()
      ? parseMoneyInput(draft.mortgageEscrow, currencyCode)
      : null;

    if (!draft.name.trim()) {
      throw new Error('Please enter a name for this debt account.');
    }
    if (balanceNum === null) {
      throw new Error('Please enter a valid balance.');
    }
    if (aprNum === null || aprNum < 0 || aprNum > 100) {
      throw new Error('Please enter a valid APR percentage between 0% and 100%.');
    }
    if (minNum === null || minNum < 0 || (balanceNum > 0 && minNum <= 0)) {
      throw new Error(balanceNum > 0
        ? 'Please enter a minimum monthly payment greater than zero for a positive balance.'
        : 'Please enter a valid minimum monthly payment.');
    }
    if (draft.category === 'Mortgage' && draft.mortgageEscrow.trim() && (escrowNum === null || escrowNum < 0 || escrowNum > minNum)) {
      throw new Error('Mortgage escrow must be a valid amount between zero and the monthly payment.');
    }

    const dueDayNum = draft.dueDay.trim() ? Number(draft.dueDay.trim()) : null;
    if (dueDayNum !== null && (!Number.isInteger(dueDayNum) || dueDayNum < 1 || dueDayNum > 31)) {
      throw new Error('Due day must be between 1 and 31.');
    }
    if (!existingDebt && balanceNum > 0 && (draft.category === 'Mortgage' || draft.category === 'Auto loan') && dueDayNum === null) {
      throw new Error('Please select a due day for this loan.');
    }

    const origNum = draft.originalBalance.trim() ? parseMoneyInput(draft.originalBalance, currencyCode) : null;
    if (draft.originalBalance.trim() && (origNum === null || origNum <= 0)) {
      throw new Error('Please enter a valid original balance greater than zero.');
    }
    const limitNum = draft.creditLimit.trim() ? parseMoneyInput(draft.creditLimit, currencyCode) : null;
    if (draft.creditLimit.trim() && (limitNum === null || limitNum <= 0)) {
      throw new Error('Please enter a valid credit limit greater than zero.');
    }
    const annualFeeNum = draft.annualFeeAmount.trim() ? parseMoneyInput(draft.annualFeeAmount, currencyCode) : null;
    let annualFeeDate: DateOnly | null = null;
    if (draft.annualFeeAmount.trim() && (annualFeeNum === null || annualFeeNum <= 0)) {
      throw new Error('Enter a valid annual fee amount greater than zero.');
    }
    if ((annualFeeNum == null) !== !draft.annualFeeNextDate.trim()) {
      throw new Error('Enter both the annual fee amount and next renewal date, or clear both.');
    }
    if (draft.annualFeeNextDate.trim()) {
      try { annualFeeDate = parseDateOnly(draft.annualFeeNextDate.trim()); }
      catch { throw new Error('Enter the next annual-fee date as YYYY-MM-DD.'); }
    }
    if (annualFeeNum != null && draft.category !== 'Credit card') {
      throw new Error('Remove the annual-fee details before changing this account from a credit card.');
    }

    const debtId = existingDebt?.id ?? (isDraftFlow ? (draftDebtIdRef.current ??= ExpoCrypto.randomUUID()) : targetDebtId!);
    const isDraftDebt = isDraftFlow && draftDebtIdRef.current === debtId;
    const today = currentHouseholdDate(householdTimeZone);
    const key = obligationScheduleKey('debt', debtId);
    const priorSchedule = currentData.obligationSchedules?.[key];
    let paidToday = isDraftFlow ? (draftDebtPaidTodayRef.current[debtId] ?? false) : false;
    savingRef.current = true;
    setSaving(true);

    try {
      if (dueDayNum !== null && (!isDraftFlow || draftDebtPaidTodayRef.current[debtId] === undefined) && shouldAskPaidToday({
        dueDay: dueDayNum, today, isNew: isDraftDebt, legacyDueDay: existingDebt?.dueDay, hasSchedule: Boolean(priorSchedule),
      })) {
        const answer = await confirmObligationPaidToday();
        if (answer === null) return false;
        paidToday = answer;
        if (isDraftFlow) draftDebtPaidTodayRef.current[debtId] = answer;
      }
      const debtInput = {
        id: debtId,
        name: draft.name.trim(),
        category: draft.category,
        balance: balanceNum,
        originalBalance: origNum,
        apr: aprNum,
        minimumPayment: minNum,
        dueDay: dueDayNum,
        creditLimit: limitNum,
        annualFeeAmount: annualFeeNum,
        annualFeeNextDueDate: annualFeeDate,
        serverVersion: existingDebt?.serverVersion,
      };
      const unified = draft.category === 'Mortgage' || draft.category === 'Auto loan';
      const loanSettings = unified ? prepareUnifiedLoanSettings({
        current: currentData,
        debt: {
          ...debtInput,
          createdAt: existingDebt?.createdAt ?? new Date().toISOString(),
          updatedAt: existingDebt?.updatedAt ?? existingDebt?.createdAt ?? new Date().toISOString(),
        },
        bills: recurringBills,
        today,
        currency: currencyCode,
        paidToday,
        escrow: escrowNum,
      }) : undefined;
      const legacyBill = recurringBills.find(bill => bill.id === currentData.loanBillPairingByDebtId?.[debtId]?.billId);
      const updated = await upsertUserDebt(currentData, debtInput, loanSettings, legacyBill);
      latestOnboardingRef.current = updated;
      onUpdateOnboardingData(updated);
      let settingsData = updated;
      if (!unified) {
      if (dueDayNum !== null) {
        const schedule = prepareObligationEditorSchedule({
          kind: 'debt', id: debtId, today, timeZone: householdTimeZone,
          dueDay: dueDayNum, amount: parseMoney(String(minNum), currencyCode),
          legacyDueDay: existingDebt?.dueDay ?? undefined,
          legacyAmount: existingDebt?.dueDay !== null && existingDebt?.dueDay !== undefined
            ? parseMoney(String(existingDebt.minimumPayment), currencyCode)
            : undefined,
          createdAt: existingDebt?.createdAt ?? settingsData.debts.find(d => d.id === debtId)?.createdAt ?? new Date().toISOString(),
          isNew: isDraftDebt, paidToday, existing: priorSchedule,
        });
        const savedSettings = await saveObligationEditorSchedule({ current: settingsData, key, schedule, session });
        settingsData = savedSettings;
        latestOnboardingRef.current = savedSettings;
        onUpdateOnboardingData(savedSettings);
      } else if (priorSchedule) {
        const savedSettings = await removeObligationEditorSchedule({ current: settingsData, key, session });
        settingsData = savedSettings;
        latestOnboardingRef.current = savedSettings;
        onUpdateOnboardingData(savedSettings);
      }
      }
      if (isDraftFlow) {
        draftDebtIdRef.current = null;
        delete draftDebtPaidTodayRef.current[debtId];
      }
      return true;
    } catch (error) {
      if (error instanceof Error && (error.name === 'FinancialSettingsUncertainError' || error.name === 'DebtWriteUncertainError' || error.name === 'DebtWriteConflictError')) markSettingsUncertain();
      throw error;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveDebt = async () => {
    clearErrors();
    try {
      const saved = await saveDebtRecord(editingDebtId, {
        category: debtCategory,
        name: debtName,
        balance: debtBalance,
        originalBalance: debtOriginalBalance,
        apr: debtApr,
        minimumPayment: debtMinimum,
        minimumMode: debtMinimumMode,
        mortgageEscrow,
        dueDay: debtDueDay,
        creditLimit: debtCreditLimit,
        annualFeeAmount: debtAnnualFeeAmount,
        annualFeeNextDate: debtAnnualFeeNextDate,
      }, { isDraftFlow: true });
      if (saved) {
        setShowDebtForm(false);
        setEditingDebtId(null);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to save debt account.');
    }
  };

  const handleSaveDebtDetails = async (debtId: string, draft: DebtDetailsDraft): Promise<boolean> => {
    clearErrors();
    return saveDebtRecord(debtId, draft, { isDraftFlow: false });
  };

  const handleDeleteDebt = async (debtId: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    clearErrors();
    try {
      const currentData = latestOnboardingRef.current;
      const localBillId = validatedLoanBillLinks(currentData.loanBillPairingByDebtId, recurringBills, currentData.debts)[debtId] ?? null;
      const relation = currentData.loanBillPairingByDebtId?.[debtId];
      if (relation?.status === 'linked' && relation.billId !== localBillId) throw new Error('This loan has historical bill references that cannot be safely validated for deletion. No records were removed.');
      const { data: updated, receipt } = await deleteUserDebt(currentData, debtId, localBillId);
      latestOnboardingRef.current = updated;
      onUpdateOnboardingData(updated);
      if (receipt) {
        const removedTransactionIds = new Set(transactions.filter(transaction =>
          transaction.accountId === debtId || Boolean(receipt.billId && transactionHasBillId(transaction, receipt.billId)),
        ).map(transaction => transaction.id));
        onUpdateTransactions?.(transactions.filter(transaction =>
          transaction.accountId !== debtId && !(receipt.billId && transactionHasBillId(transaction, receipt.billId)),
        ));
        if (receipt.billId) {
          onUpdateRecurringBills?.(recurringBills.filter(bill => bill.id !== receipt.billId));
        }
        onUpdateReconciliationAnchors?.(reconciliationAnchors.filter(anchor =>
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
      setLocalError(err instanceof Error ? err.message : 'Unable to delete debt account.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const reconcileSettingsSave = async () => {
    if (!session || checkingSettings) return;
    setCheckingSettings(true);
    try {
      const fresh = await loadUserOnboardingData(session, { householdId: onboardingData.householdId });
      if (fresh.userId !== onboardingData.userId || fresh.householdId !== onboardingData.householdId) throw new Error('The active household changed.');
      latestOnboardingRef.current = fresh;
      onUpdateOnboardingData(fresh);
      settingsUncertainRef.current = false;
      setSettingsUncertain(false);
      setLocalError('');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Unable to check this save. Try again when connected.');
    } finally { setCheckingSettings(false); }
  };

  const handleToggleHomeStrategy = async (nextStrategy: PayoffStrategy) => {
    requireConfirmedSettings();
    const currentData = latestOnboardingRef.current;
    if (currentData.strategy === nextStrategy) return;
    if (savingRef.current) {
      const error = new Error('Another change is still saving. Try again in a moment.');
      setLocalError(error.message);
      throw error;
    }
    const priorData = currentData;
    const optimistic = { ...priorData, strategy: nextStrategy };
    latestOnboardingRef.current = optimistic;
    // Optimistic update for responsive, instant UI feedback
    onUpdateOnboardingData(optimistic);
    clearErrors();
    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await saveUserOnboardingSettingsPatch(priorData, { strategy: nextStrategy }, session);
      latestOnboardingRef.current = updated;
      onUpdateOnboardingData(updated);
    } catch (err) {
      // Revert optimistic update on failure
      const outcome = settingsFailureSnapshot(err, priorData);
      if (outcome.uncertain) markSettingsUncertain();
      const reconciled = outcome.data;
      latestOnboardingRef.current = reconciled;
      onUpdateOnboardingData(reconciled);
      setLocalError(err instanceof Error ? err.message : 'Unable to update your strategy.');
      throw err;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveExtra = async (amount: number) => {
    requireConfirmedSettings();
    if (savingRef.current) {
      const error = new Error('Another change is still saving. Try again in a moment.');
      setLocalError(error.message);
      throw error;
    }
    const priorData = latestOnboardingRef.current;
    const optimistic = { ...priorData, extraMonthlyPayment: amount };
    latestOnboardingRef.current = optimistic;
    onUpdateOnboardingData(optimistic);
    clearErrors();
    savingRef.current = true;
    setSaving(true);
    setLocalError('');
    try {
      const updated = await saveUserOnboardingSettingsPatch(priorData, { extraMonthlyPayment: amount }, session);
      latestOnboardingRef.current = updated;
      onUpdateOnboardingData(updated);
    } catch (err) {
      const outcome = settingsFailureSnapshot(err, priorData);
      if (outcome.uncertain) markSettingsUncertain();
      const reconciled = outcome.data;
      latestOnboardingRef.current = reconciled;
      onUpdateOnboardingData(reconciled);
      setLocalError(err instanceof Error ? err.message : 'Unable to update extra payment.');
      throw err;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveMortgageExtra = async (debtId: string, amount: number) => {
    requireConfirmedSettings();
    if (savingRef.current) throw new Error('Another change is still saving. Try again in a moment.');
    const priorData = latestOnboardingRef.current;
    const candidate = {
      ...priorData,
      mortgageExtraPaymentByDebtId: { ...(priorData.mortgageExtraPaymentByDebtId ?? {}), [debtId]: amount },
    };
    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await saveUserOnboardingSettingsPatch(priorData, { mortgageExtraPaymentByDebtId: candidate.mortgageExtraPaymentByDebtId }, session);
      latestOnboardingRef.current = updated;
      onUpdateOnboardingData(updated);
    } catch (error) {
      const outcome = settingsFailureSnapshot(error, latestOnboardingRef.current);
      if (outcome.uncertain) markSettingsUncertain();
      const reconciled = outcome.data;
      latestOnboardingRef.current = reconciled; onUpdateOnboardingData(reconciled);
      throw error;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const saveBudgetSettings = async (patch: Partial<UserOnboardingData>) => {
    requireConfirmedSettings();
    if (savingRef.current) throw new Error('Another settings change is saving. Try again shortly.');
    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await saveUserOnboardingSettingsPatch(latestOnboardingRef.current, patch, session);
      latestOnboardingRef.current = updated;
      onUpdateOnboardingData(updated);
    } catch (error) {
      const outcome = settingsFailureSnapshot(error, latestOnboardingRef.current);
      if (outcome.uncertain) markSettingsUncertain();
      const reconciled = outcome.data;
      latestOnboardingRef.current = reconciled; onUpdateOnboardingData(reconciled);
      throw error;
    } finally { savingRef.current = false; setSaving(false); }
  };

  const handleSaveBudgetIncome = async (patch: Pick<UserOnboardingData, 'primaryIncomeName' | 'primaryIncomeAmount' | 'primaryGrossIncomeAmount' | 'primaryPayFrequency' | 'primaryMonthlyIncome' | 'additionalIncomes'>) => {
    await saveBudgetSettings(patch);
  };

  const handleSaveLoanBillPairings = async (loanBillPairingByDebtId: NonNullable<UserOnboardingData['loanBillPairingByDebtId']>) => {
    for (const [id, relation] of Object.entries(latestOnboardingRef.current.loanBillPairingByDebtId ?? {})) {
      if (relation?.status === 'linked' && (loanBillPairingByDebtId[id]?.status !== 'linked' || loanBillPairingByDebtId[id]?.billId !== relation.billId)) throw new Error('Historical loan identity cannot be detached. Use the shared loan editor.');
    }
    await saveBudgetSettings({ loanBillPairingByDebtId });
  };
  const handleSaveRecurringBillCategoryLabels = async (recurringBillCategoryLabelByBillId: NonNullable<UserOnboardingData['recurringBillCategoryLabelByBillId']>) => {
    await saveBudgetSettings({ recurringBillCategoryLabelByBillId });
  };
  const handleSaveDebtPaymentSplitPlans = async (debtPaymentSplitPlansByDebtId: NonNullable<UserOnboardingData['debtPaymentSplitPlansByDebtId']>) => {
    const billPaymentSplitPlansByBillId = { ...(latestOnboardingRef.current.billPaymentSplitPlansByBillId ?? {}) };
    for (const billIds of Object.values(canonicalPlanAliases)) for (const id of billIds) delete billPaymentSplitPlansByBillId[id];
    await saveBudgetSettings({ debtPaymentSplitPlansByDebtId, billPaymentSplitPlansByBillId });
  };
  const handleSaveBillPaymentSplitPlans = async (billPaymentSplitPlansByBillId: NonNullable<UserOnboardingData['billPaymentSplitPlansByBillId']>) => {
    await saveBudgetSettings({ billPaymentSplitPlansByBillId });
  };

  const handleResolveDivergentLink = async (link: DivergentLoanBillLink, mode: 'use_loan' | 'use_bill') => {
    if (!canEdit || pairingBusy || savingRef.current) return;
    if (settingsUncertainRef.current) { setLocalError('Check the unconfirmed settings save before resolving another loan.'); return; }
    clearErrors();
    const current = latestOnboardingRef.current;
    const liveDebt = current.debts.find(item => item.id === link.debt.id);
    const liveBill = recurringBills.find(item => item.id === link.bill.id);
    if (!liveDebt || !liveBill) { setLocalError('Reload to review the current loan terms.'); return; }
    const validation = validateDivergentLinkResolution({ link: { ...link, debt: liveDebt, bill: liveBill }, mode, currencyCode, mortgageEscrowByDebtId: current.mortgageEscrowByDebtId });
    if (!validation.valid) { setLocalError(validation.error); return; }
    setPairingBusy(true);
    savingRef.current = true;
    try {
      const debt = { ...liveDebt, minimumPayment: validation.minimumPayment, dueDay: validation.dueDay };
      const settings = prepareUnifiedLoanSettings({ current, debt, bills: recurringBills, today: currentHouseholdDate(householdTimeZone), currency: currencyCode, resolveLegacy: true });
      const updated = await upsertUserDebt(current, debt, settings, liveBill);
      latestOnboardingRef.current = updated;
      onUpdateOnboardingData(updated);
    } catch (error) {
      if (error instanceof Error && (error.name === 'FinancialSettingsUncertainError' || error.name === 'DebtWriteUncertainError' || error.name === 'DebtWriteConflictError')) markSettingsUncertain();
      setLocalError(error instanceof Error ? error.message : 'Unable to verify the loan conversion.');
    }
    finally { savingRef.current = false; setPairingBusy(false); }
  };

  const parsedDraftBalance = parseMoneyInput(debtBalance, currencyCode, true);
  const parsedDraftApr = parsePercentInput(debtApr);
  const autoEstimatedMin = parsedDraftBalance !== null && parsedDraftBalance > 0
    ? estimateMinimumPayment(parsedDraftBalance, parsedDraftApr !== null && parsedDraftApr >= 0 ? parsedDraftApr : 0, currencyCode)
    : 0;
  const parsedDebtDueDay = debtDueDay.trim() ? Number(debtDueDay.trim()) : null;
  const isCreditCardDebt = debtCategory === 'Credit card' || onboardingData.debts.find(item => item.id === editingDebtId)?.category === 'Credit card';

  const debtEditor: ReactNode = showDebtForm ? (
    <HomeAppearance>{({ isLight, palette, ctaBg, ctaFg }) => {
      const groupedCardStyle = {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: isLight ? palette.canvas : palette.raised,
        paddingHorizontal: 14,
      };
      const rowStyle = {
        minHeight: 50,
        paddingVertical: 8,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        gap: 12,
      };
      const rowBorderStyle = { borderBottomWidth: 1, borderBottomColor: palette.border };
      const inlineInputStyle = {
        minHeight: 40,
        paddingVertical: 6,
        paddingHorizontal: 0,
        textAlign: 'right' as const,
        color: palette.text,
        fontSize: 15,
        fontWeight: '600' as const,
      };
      return (
        <>
          <SheetModal
            visible={showDebtForm}
            onClose={closeDebtEditor}
            contentSized
            closeLabel="Close debt editor"
            footer={(
              <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface, gap: 8 }}>
                {!!localError ? (
                  <Text style={[styles.errorText, { marginTop: 0, textAlign: 'center' }]} accessibilityRole="alert">
                    {localError}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save debt account"
                  disabled={saving}
                  style={{
                    minHeight: 48,
                    borderRadius: 12,
                    backgroundColor: ctaBg,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: saving ? 0.5 : 1,
                  }}
                  onPress={() => void handleSaveDebt()}
                >
                  <Text style={{ color: ctaFg, fontSize: 15, fontWeight: '700' }}>
                    {saving ? 'Saving\u2026' : 'Save'}
                  </Text>
                </Pressable>
              </View>
            )}
          >
            <View style={{ gap: 14 }}>
              <SheetFormHeader
                centered
                title={editingDebtId ? 'Edit Debt Account' : 'Add Debt Account'}
                subtitle={currencyCode}
                closeLabel="Close debt editor"
                onClose={closeDebtEditor}
              />

              <View style={groupedCardStyle}>
                <View style={[rowStyle, rowBorderStyle, { minHeight: 44 }]}>
                  <Text style={[ui.heading, { fontSize: 15 }]}>Debt details</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Account type: ${debtCategory}`}
                  onPress={() => {
                    Keyboard.dismiss();
                    setShowDebtCategoryPicker(true);
                  }}
                  style={[rowStyle, rowBorderStyle]}
                >
                  <Text style={[ui.text, { color: palette.muted }]}>Account type *</Text>
                  <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                    <Text style={[ui.text, { color: palette.text, fontWeight: '600' }]}>{debtCategory}</Text>
                    <AppIcon name="chevronDown" size={16} color={palette.brand} />
                  </View>
                </Pressable>
                <View style={rowStyle}>
                  <Text style={[ui.text, { color: palette.muted }]}>Account name *</Text>
                  <TextInput
                    accessibilityLabel="Debt name"
                    accessibilityHint="Required"
                    style={[inlineInputStyle, { flex: 1, minWidth: 110 }]}
                    value={debtName}
                    onChangeText={setDebtName}
                    placeholder="e.g., Chase Sapphire"
                    placeholderTextColor={palette.muted}
                  />
                </View>
              </View>

              <View style={groupedCardStyle}>
                <View style={[rowStyle, rowBorderStyle, { minHeight: 44 }]}>
                  <Text style={[ui.heading, { fontSize: 15 }]}>Payment & Terms</Text>
                </View>
                <View style={[rowStyle, rowBorderStyle]}>
                  <Text style={[ui.text, { color: palette.muted }]}>Current balance *</Text>
                  <View style={[ui.row, { flex: 1, justifyContent: 'flex-end', gap: 4 }]}>
                    <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>{currencySymbol}</Text>
                    <TextInput
                      accessibilityLabel="Current balance"
                      accessibilityHint="Required"
                      style={[inlineInputStyle, { flex: 1, minWidth: 90 }]}
                      keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                      value={debtBalance}
                      onChangeText={text => setDebtBalance(prev => acceptMoneyEdit(prev, text, currencyCode, true))}
                      placeholder="0.00"
                      placeholderTextColor={palette.muted}
                    />
                  </View>
                </View>
                <View style={[rowStyle, rowBorderStyle]}>
                  <Text style={[ui.text, { color: palette.muted }]}>APR *</Text>
                  <View style={[ui.row, { flex: 1, justifyContent: 'flex-end', gap: 4 }]}>
                    <TextInput
                      accessibilityLabel="APR percentage"
                      accessibilityHint="Required"
                      style={[inlineInputStyle, { flex: 1, minWidth: 72 }]}
                      keyboardType="decimal-pad"
                      value={debtApr}
                      onChangeText={text => setDebtApr(prev => acceptAprEdit(prev, text))}
                      placeholder="0.00"
                      placeholderTextColor={palette.muted}
                    />
                    <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>%</Text>
                  </View>
                </View>
                <View style={[{ paddingVertical: 10, gap: 8 }, rowBorderStyle]}>
                  <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                    <Text style={[ui.text, { color: palette.muted }]}>Minimum payment *</Text>
                    <View style={[ui.row, { gap: 4, padding: 3, borderRadius: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }]}>
                      {(['auto', 'manual'] as const).map(mode => {
                        const active = debtMinimumMode === mode;
                        return (
                          <Pressable
                            key={mode}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={`Minimum payment ${mode}`}
                            onPress={() => {
                              if (mode === 'manual' && !debtMinimum.trim() && autoEstimatedMin > 0) {
                                setDebtMinimum(formatEditableMoney(autoEstimatedMin, currencyCode));
                              }
                              setDebtMinimumMode(mode);
                            }}
                            style={{
                              minHeight: 32,
                              paddingHorizontal: 10,
                              borderRadius: 7,
                              justifyContent: 'center',
                              backgroundColor: active ? palette.tint : 'transparent',
                            }}
                          >
                            <Text style={{ fontSize: 12, fontWeight: '700', color: active ? palette.brand : palette.muted }}>
                              {mode === 'auto' ? 'Auto' : 'Manual'}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  {debtMinimumMode === 'auto' ? (
                    <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', minHeight: 32 }]}>
                      <Text style={[ui.small, { color: palette.muted }]}>Estimated minimum</Text>
                      <Text style={[ui.text, { color: palette.text, fontWeight: '700' }]}>
                        {autoEstimatedMin > 0 ? formatCurrency(autoEstimatedMin, currencySymbol) : formatCurrency(0, currencySymbol)}
                      </Text>
                    </View>
                  ) : (
                    <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', minHeight: 40 }]}>
                      <Text style={[ui.small, { color: palette.muted }]}>Monthly minimum</Text>
                      <View style={[ui.row, { flex: 1, justifyContent: 'flex-end', gap: 4 }]}>
                        <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>{currencySymbol}</Text>
                        <TextInput
                          accessibilityLabel="Minimum monthly payment"
                          accessibilityHint="Required"
                          style={[inlineInputStyle, { flex: 1, minWidth: 90 }]}
                          keyboardType="decimal-pad"
                          value={debtMinimum}
                          onChangeText={text => setDebtMinimum(prev => acceptMoneyEdit(prev, text, currencyCode))}
                          placeholder="0.00"
                          placeholderTextColor={palette.muted}
                        />
                      </View>
                    </View>
                  )}
                </View>
                {debtCategory === 'Mortgage' ? (
                  <View style={[rowStyle, rowBorderStyle]}>
                    <Text style={[ui.text, { color: palette.muted }]}>Monthly escrow</Text>
                    <View style={[ui.row, { flex: 1, justifyContent: 'flex-end', gap: 4 }]}>
                      <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>{currencySymbol}</Text>
                      <TextInput
                        accessibilityLabel="Mortgage monthly escrow"
                        style={[inlineInputStyle, { flex: 1, minWidth: 90 }]}
                        keyboardType="decimal-pad"
                        value={mortgageEscrow}
                        onChangeText={text => setMortgageEscrow(prev => acceptMoneyEdit(prev, text, currencyCode))}
                        placeholder="Optional"
                        placeholderTextColor={palette.muted}
                      />
                    </View>
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={parsedDebtDueDay ? `Due day: Day ${parsedDebtDueDay}` : 'Due day: Choose day'}
                  onPress={() => {
                    Keyboard.dismiss();
                    setShowDebtDuePicker(true);
                  }}
                  style={rowStyle}
                >
                  <Text style={[ui.text, { color: palette.muted }]}>Due day</Text>
                  <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                    <Text style={[ui.text, { color: parsedDebtDueDay ? palette.text : palette.brand, fontWeight: '600' }]}>
                      {parsedDebtDueDay ? `Day ${parsedDebtDueDay}` : 'Choose day'}
                    </Text>
                    <AppIcon name="calendar" size={16} color={palette.brand} />
                  </View>
                </Pressable>
                {!editingDebtId && parsedDebtDueDay !== null && Number.isInteger(parsedDebtDueDay) && parsedDebtDueDay >= 1 && parsedDebtDueDay <= 31 ? (
                  <Text style={[ui.small, { color: palette.muted, paddingBottom: 10 }]}>
                    {`First due date: ${obligationFirstDueDate(parsedDebtDueDay, currentHouseholdDate(householdTimeZone), currencyCode)}`}
                  </Text>
                ) : null}
              </View>

              <View style={{ gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showDebtMoreDetails }}
                  onPress={() => setShowDebtMoreDetails(prev => !prev)}
                  style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}
                >
                  <Text style={{ color: palette.brand, fontSize: 14, fontWeight: '600' }}>More details</Text>
                  <AppIcon name={showDebtMoreDetails ? 'chevronDown' : 'chevronRight'} size={15} color={palette.brand} />
                </Pressable>

                {showDebtMoreDetails ? (
                  <View style={groupedCardStyle}>
                    <View style={[rowStyle, rowBorderStyle]}>
                      <Text style={[ui.text, { color: palette.muted }]}>Original balance</Text>
                      <View style={[ui.row, { flex: 1, justifyContent: 'flex-end', gap: 4 }]}>
                        <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>{currencySymbol}</Text>
                        <TextInput
                          accessibilityLabel="Original balance"
                          style={[inlineInputStyle, { flex: 1, minWidth: 90 }]}
                          keyboardType="decimal-pad"
                          value={debtOriginalBalance}
                          onChangeText={text => setDebtOriginalBalance(prev => acceptMoneyEdit(prev, text, currencyCode))}
                          placeholder="Optional"
                          placeholderTextColor={palette.muted}
                        />
                      </View>
                    </View>
                    <View style={[rowStyle, isCreditCardDebt ? rowBorderStyle : undefined]}>
                      <Text style={[ui.text, { color: palette.muted }]}>Credit limit</Text>
                      <View style={[ui.row, { flex: 1, justifyContent: 'flex-end', gap: 4 }]}>
                        <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>{currencySymbol}</Text>
                        <TextInput
                          accessibilityLabel="Credit limit"
                          style={[inlineInputStyle, { flex: 1, minWidth: 90 }]}
                          keyboardType="decimal-pad"
                          value={debtCreditLimit}
                          onChangeText={text => setDebtCreditLimit(prev => acceptMoneyEdit(prev, text, currencyCode))}
                          placeholder="Optional"
                          placeholderTextColor={palette.muted}
                        />
                      </View>
                    </View>
                    {isCreditCardDebt ? (
                      <>
                        <View style={[rowStyle, rowBorderStyle]}>
                          <Text style={[ui.text, { color: palette.muted }]}>Annual fee</Text>
                          <View style={[ui.row, { flex: 1, justifyContent: 'flex-end', gap: 4 }]}>
                            <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>{currencySymbol}</Text>
                            <TextInput
                              accessibilityLabel="Annual credit-card fee"
                              style={[inlineInputStyle, { flex: 1, minWidth: 90 }]}
                              keyboardType="decimal-pad"
                              value={debtAnnualFeeAmount}
                              onChangeText={text => setDebtAnnualFeeAmount(prev => acceptMoneyEdit(prev, text, currencyCode))}
                              placeholder="Optional"
                              placeholderTextColor={palette.muted}
                            />
                          </View>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={debtAnnualFeeNextDate ? `Next renewal: ${formatShortDate(debtAnnualFeeNextDate)}` : 'Next renewal: Choose date'}
                          onPress={() => {
                            Keyboard.dismiss();
                            setShowDebtRenewalPicker(true);
                          }}
                          style={rowStyle}
                        >
                          <Text style={[ui.text, { color: palette.muted }]}>Next renewal</Text>
                          <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                            <Text style={[ui.text, { color: debtAnnualFeeNextDate ? palette.text : palette.brand, fontWeight: '600' }]}>
                              {debtAnnualFeeNextDate ? formatShortDate(debtAnnualFeeNextDate) : 'Choose date'}
                            </Text>
                            <AppIcon name="calendar" size={16} color={palette.brand} />
                          </View>
                        </Pressable>
                      </>
                    ) : null}
                  </View>
                ) : null}
              </View>

              <AdaptiveModal visible={showDebtCategoryPicker} transparent animationType="fade" onRequestClose={() => setShowDebtCategoryPicker(false)}>
                <TouchableWithoutFeedback onPress={() => setShowDebtCategoryPicker(false)}>
                  <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }}>
                    <TouchableWithoutFeedback>
                      <View style={{ backgroundColor: palette.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: palette.border, maxHeight: '72%', paddingBottom: bottomInsetPadding(insets.bottom, 16) }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: palette.border }}>
                          <Text style={{ fontSize: 17, fontWeight: '700', color: palette.text }}>Select Debt Category</Text>
                          <Pressable accessibilityRole="button" accessibilityLabel="Close picker" onPress={() => setShowDebtCategoryPicker(false)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                            <AppIcon name="close" size={20} color={palette.muted} />
                          </Pressable>
                        </View>
                        <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ padding: 16, gap: 6 }} keyboardShouldPersistTaps="handled">
                          {DEBT_CATEGORY_DROPDOWN_OPTIONS.map(option => {
                            const selected = option.value === debtCategory;
                            return (
                              <Pressable
                                key={option.value}
                                accessibilityRole="button"
                                accessibilityState={{ selected }}
                                onPress={() => {
                                  setDebtCategory(option.value);
                                  setShowDebtCategoryPicker(false);
                                }}
                                style={{
                                  minHeight: 52,
                                  paddingHorizontal: 14,
                                  paddingVertical: 10,
                                  borderRadius: 12,
                                  borderWidth: 1,
                                  borderColor: selected ? palette.brand : 'transparent',
                                  backgroundColor: selected ? palette.tint : 'transparent',
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 10,
                                }}
                              >
                                <View style={[ui.row, { gap: 10, flex: 1 }]}>
                                  {option.icon ? <AppIcon name={option.icon} size={18} color={selected ? palette.brand : palette.muted} /> : null}
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ color: selected ? palette.brand : palette.text, fontSize: 15, fontWeight: '600' }}>{option.label}</Text>
                                    {option.subtitle ? <Text style={[ui.small, { color: palette.muted }]}>{option.subtitle}</Text> : null}
                                  </View>
                                </View>
                                {selected ? <AppIcon name="check" size={18} color={palette.brand} /> : null}
                              </Pressable>
                            );
                          })}
                        </ScrollView>
                      </View>
                    </TouchableWithoutFeedback>
                  </View>
                </TouchableWithoutFeedback>
              </AdaptiveModal>

              <DueDayPickerModal
                visible={showDebtDuePicker}
                value={parsedDebtDueDay}
                title="Select due day"
                subtitle="Monthly payment due date"
                allowClear
                onSelect={day => setDebtDueDay(day === null ? '' : String(day))}
                onClose={() => setShowDebtDuePicker(false)}
              />

              <CalendarDatePickerModal
                visible={showDebtRenewalPicker}
                value={debtAnnualFeeNextDate}
                timeZone={householdTimeZone}
                title="Annual fee next renewal"
                allowClear
                onSelect={date => setDebtAnnualFeeNextDate(date)}
                onClose={() => setShowDebtRenewalPicker(false)}
              />
            </View>
          </SheetModal>
        </>
      );
    }}</HomeAppearance>
  ) : null;

  return (
    <FiveTabShell
      userId={session?.user.id ?? onboardingData.userId}
      key={session?.user.id ?? onboardingData.userId}
      themePreference={themePreference}
      onRefresh={refreshAccountData}
      refreshing={reloading}
      refreshFeedback={reloadFeedback}
      settingsSaveWarning={settingsUncertain ? { checking: checkingSettings, onCheck: () => { void reconcileSettingsSave(); } } : undefined}
      settingsVisible={showSettings}
      onCloseSettings={closeSettings}
      onHomeVisibilityChange={setHomeVisible}
      overlay={debtEditor}
      settings={close => (
        <SettingsScreen
          session={session}
          onboardingData={onboardingData}
          householdSummaries={householdSummaries}
          onSwitchHousehold={onSwitchHousehold}
          onRefreshHouseholdContexts={onRefreshHouseholdContexts}
          onAcceptHouseholdInvite={onAcceptHouseholdInvite}
          transactions={transactions}
          recurringBills={recurringBills}
          reconciliationAnchors={reconciliationAnchors}
          currencyCode={currencyCode}
          currencySymbol={currencySymbol}
          themePreference={themePreference}
          onSelectTheme={setThemePreference}
          authBusy={authBusy}
          onClose={close}
          onUpdateOnboardingData={onUpdateOnboardingData}
          settingsUncertain={settingsUncertain}
          onSettingsUncertain={markSettingsUncertain}
          onUpdateTransactions={onUpdateTransactions}
          onUpdateRecurringBills={onUpdateRecurringBills}
          onUpdateReconciliationAnchors={onUpdateReconciliationAnchors}
          onSignOut={onSignOut}
          onDeleteAccount={onDeleteAccount}
          accountDeletionEnabled={accountDeletionEnabled}
        />
      )}
      debt={(targetDebtId: string | null, clearTarget: () => void, section: string, resetKey: number) => (
        <DebtScreen
          key={resetKey}
          debts={onboardingData.debts}
          archivedPaidOffDebtIds={onboardingData.archivedPaidOffDebtIds}
          initialSelectedId={targetDebtId}
          initialSection={section}
          onDismiss={() => { clearTarget(); setShowDebtForm(false); setEditingDebtId(null); }}
          plan={plan}
          currencySymbol={currencySymbol}
          currencyCode={currencyCode}
          transactions={transactions}
          reconciliationAnchors={reconciliationAnchors}
          editor={null}
          editorOpen={showDebtForm}
          error={localError}
          canEdit={canEdit}
          onAdd={() => openNewDebtEditor('Credit card')}
          onEdit={openEditDebtEditor}
          onSaveDebtDetails={handleSaveDebtDetails}
          onRemove={item => { void handleDeleteDebt(item.id); }}
          onReconcile={onReconcileDebt}
          onSettings={openSettings}
          strategy={onboardingData.strategy}
          extraMonthlyPayment={onboardingData.extraMonthlyPayment}
          onStrategy={handleToggleHomeStrategy}
          onExtra={handleSaveExtra}
          mortgageEscrowByDebtId={onboardingData.mortgageEscrowByDebtId}
          mortgageExtraPaymentByDebtId={onboardingData.mortgageExtraPaymentByDebtId}
          onMortgageExtra={handleSaveMortgageExtra}
          recurringBills={recurringBills}
          loanBillPairings={onboardingData.loanBillPairingByDebtId ?? {}}
          onSaveLoanBillPairings={handleSaveLoanBillPairings}
          obligationSchedules={onboardingData.obligationSchedules}
          householdTimeZone={householdTimeZone}
          onAddTransaction={onAddTransaction}
          onRecordBillPayment={onRecordBillPayment}
        />
      )}
      transactions={(targetTransactionId: string | null, clearTarget: () => void, section: string) => (
        <TransactionsScreen
          key={`${section}:${targetTransactionId ?? 'none'}`}
          initialTransactionId={targetTransactionId}
          initialSection={section}
          onEditDismiss={clearTarget}
          debts={onboardingData.debts}
          transactions={transactions}
          recurringBills={recurringBills}
          obligationSchedules={onboardingData.obligationSchedules}
          debtPaymentSplitPlansByDebtId={effectiveDebtSplitPlans}
          onSaveDebtPaymentSplitPlans={handleSaveDebtPaymentSplitPlans}
          billPaymentSplitPlansByBillId={onboardingData.billPaymentSplitPlansByBillId}
          onSaveBillPaymentSplitPlans={handleSaveBillPaymentSplitPlans}
          loanBillPairs={loanBillPairs}
          identityLoanBillPairs={identityLoanBillPairs}
          historicalBillIdsByDebtId={historicalLoanBillIds}
          excludedObligationDebtIds={loanRuntime.excludedDebtIds}
          excludedObligationBillIds={archivedLinkedBillIds}
          householdTimeZone={householdTimeZone}
          currencySymbol={currencySymbol}
          currencyCode={currencyCode}
          canEdit={canEdit}
          onRecordBillPayment={onRecordBillPayment}
          onConfirmAnnualFee={onConfirmAnnualFee}
          onAddTransaction={onAddTransaction}
          onUpdateTransaction={onUpdateTransaction}
          onUpdateTransactions={onUpdateTransactions}
          onDeleteTransaction={onDeleteTransaction}
          onSettings={openSettings}
        />
      )}
      budget={(navigate: (tab: any, section?: string) => void) => (
        <BudgetScreen
          data={onboardingData}
          currencySymbol={currencySymbol}
          currencyCode={currencyCode}
          householdTimeZone={householdTimeZone}
          transactions={transactions}
          recurringBills={recurringBills}
          canEdit={canEdit}
          onAddRecurringBill={onAddRecurringBill}
          onDeleteRecurringBill={onDeleteRecurringBill}
          onOpenStrategy={() => navigate('debt', 'Strategy')}
          onSaveObligationSchedule={onSaveObligationSchedule}
          onEditDebt={debtId => navigate('debt', debtId)}
          onAddLoan={(category, prefill) => openNewDebtEditor(category, prefill)}
          onEditLoan={openEditDebtEditor}
          onSaveIncome={handleSaveBudgetIncome}
          onSaveLoanBillPairings={handleSaveLoanBillPairings}
          onSaveRecurringBillCategoryLabels={handleSaveRecurringBillCategoryLabels}
          onSettings={openSettings}
          error={localError}
        />
      )}
      progress={(navigate: (tab: any, section?: string) => void) => (
        <ProgressScreen
          debts={onboardingData.debts}
          archivedPaidOffDebtIds={onboardingData.archivedPaidOffDebtIds}
          transactions={transactions}
          currencySymbol={currencySymbol}
          currencyCode={currencyCode}
          strategy={plan.strategy}
          plannedMonthlyPayment={plan.monthlyTotalPayment}
          householdTimeZone={householdTimeZone}
          onSettings={openSettings}
          onSelectDebt={debtId => navigate('debt', debtId)}
          onOpenStrategy={() => navigate('debt', 'Strategy')}
        />
      )}
      home={(navigate: (tab: any, section?: string) => void) => (
        <HomeAppearance>{({ palette, isLight, isInspire, ctaBg, ctaFg }) => {
          const activeAccountDebts = activeDebts(onboardingData.debts).filter(
            item => !isPaidOffAccountArchived(item, onboardingData.archivedPaidOffDebtIds),
          );
          const hasAutoDebt = activeAccountDebts.some(d => d.category === 'Auto loan');
          const rawEstimateDate = homeDebtFreeEstimateDate(plan.debtFreeDateLabel);
          const displayEstimateDate = /^[A-Za-z]{3}\s+\d{4}$/.test(rawEstimateDate)
            ? rawEstimateDate.toUpperCase()
            : rawEstimateDate;
          const activeBalanceStats = calculateBalanceSnapshot(activeAccountDebts);
          const freedomPercent = Math.max(0, Math.min(100, activeBalanceStats.percent));
          const debtNameById = Object.fromEntries(onboardingData.debts.map(d => [d.id, d.name]));
          const recentTxs = transactions.filter(t => t.deletedAt === null).slice(0, 3);
          const inspireBarColors = ['#14B8A6', '#06B6D4', '#38BDF8', '#60A5FA', '#A78BFA', '#F472B6', '#FBBF24'];
          const inspireStrategyTints = ['#FFF8E5', '#F3EEFF', '#E8F8FC'];
          const criticalColor = isLight ? '#D94436' : '#F08B78';
          const criticalBg = isLight ? 'rgba(217, 68, 54, 0.10)' : 'rgba(240, 139, 120, 0.14)';
          return (
        <View style={[styles.root, { backgroundColor: palette.canvas }]}>
          <WelcomeSheet
            visible={welcomePending && homeVisible && appActive && !showSettings && !showDebtForm && !homeInformationOpen && payUpcomingTarget === null}
            onClose={() => setWelcomePending(false)}
            name={greetingName}
            timeZone={householdTimeZone}
            overdue={overdueItems}
            upcoming={futureUpcomingItems}
            pendingCount={pendingTxCount}
            status={reloading ? 'Refreshing your data...' : localError || (reloadFeedback?.kind !== 'success' ? reloadFeedback?.message : '') || (!financeRecordsVerified ? 'Financial data is not yet verified. Attention items may be incomplete.' : '')}
            dataVerified={financeRecordsVerified}
            pairingCount={pairingReviewCount}
            onUpcoming={() => {
              setWelcomePending(false);
              if (sortedUpcomingItems.length > 0) {
                homeScrollRef.current?.scrollTo({ y: upcomingSectionY.current, animated: true });
              } else {
                navigate('transactions', 'Scheduled');
              }
            }}
            onPending={() => { setWelcomePending(false); navigate('transactions', 'History'); }}
            onPairing={() => { setWelcomePending(false); homeScrollRef.current?.scrollTo({ y: pairingReviewY.current, animated: true }); }}
          />
          <ObligationPaySheet
            target={payUpcomingTarget}
            onClose={() => setPayUpcomingTarget(null)}
            transactions={transactions}
            loanBillPairs={loanBillPairs}
            historicalBillIdsByDebtId={historicalLoanBillIds}
            householdTimeZone={householdTimeZone}
            currencyCode={currencyCode}
            currencySymbol={currencySymbol}
            onRecordBillPayment={onRecordBillPayment}
            onAddTransaction={onAddTransaction}
            onUpdateTransaction={onUpdateTransaction}
            readOnly={!canEdit}
          />
          <View style={[styles.homeHeader, { backgroundColor: palette.canvas, borderBottomColor: palette.border, paddingVertical: 10 }]}>
            <View style={styles.logoBrand} accessible accessibilityRole="header" accessibilityLabel="BitLess">
              <BitLessMark />
              <Text style={[styles.logoText, { fontSize: 22 }]}>BitLess</Text>
            </View>
            <View style={styles.homeHeaderActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open settings"
                style={[ui.iconButton, { backgroundColor: palette.surface, borderColor: palette.border, width: 40, height: 40, borderRadius: 20 }]}
                onPress={openSettings}
              >
                <AppIcon name="settings" size={20} color={palette.brand} />
              </Pressable>
            </View>
          </View>

          <ScrollView ref={homeScrollRef} contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={reloading} onRefresh={refreshAccountData} />}>
            <View style={{ marginBottom: 2 }}>
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                <Text style={[ui.title, { fontSize: 24, letterSpacing: -0.5, fontWeight: '700' }]}>
                  {`Hi, ${greetingName}`}
                </Text>
                {!canEdit ? (
                  <View style={[ui.badge, { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1 }]}>
                    <Text style={[ui.badgeText, { color: palette.muted }]}>View-only</Text>
                  </View>
                ) : null}
              </View>
              <InspireQuote slot="greeting" color="#0B89A8" style={{ marginTop: 2 }} />
            </View>
            {localError ? (
              <View accessibilityRole="alert" style={{ marginTop: 4, padding: 12, borderRadius: 12, backgroundColor: 'rgba(240, 139, 120, 0.12)' }}>
                <Text style={[ui.small, { color: '#F08B78' }]}>{localError}</Text>
              </View>
            ) : null}
            {reloadFeedback && reloadFeedback.kind !== 'success' ? (
              <View
                accessibilityRole={reloadFeedback.kind === 'error' ? 'alert' : 'text'}
                style={{ marginTop: 4, padding: 12, borderRadius: 12, backgroundColor: reloadFeedback.kind === 'error' ? 'rgba(240, 139, 120, 0.12)' : '#302B20' }}
              >
                <Text style={[ui.small, { color: reloadFeedback.kind === 'error' ? '#F08B78' : '#F2C94C' }]}>
                  {reloadFeedback.message}
                </Text>
              </View>
            ) : null}
            <Card style={{ padding: 18, gap: 14, borderRadius: 18, overflow: 'hidden', ...(isInspire ? { backgroundColor: '#DDF6F6', borderColor: '#BBE6EE' } : null) }}>
              {isInspire ? <InspireHorizonBackground borderRadius={18} /> : null}
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <View style={[ui.row, { gap: 4, alignItems: 'center' }]}>
                    <Text accessibilityRole="header" style={[ui.heading, { fontSize: 19 }]}>Debt-Free Date</Text>
                    <InformationButton onVisibilityChange={setHomeInformationOpen} label="Debt-Free Estimate" detail="Your estimated debt-free date based on your current balances, APRs, and repayment strategy." />
                  </View>
                  <Text style={[ui.small, { color: palette.muted }]}>
                    {hasAutoDebt ? 'Cards / Loans & Auto' : 'Cards & Loans'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: isInspire ? 'rgba(255,255,255,0.85)' : isLight ? '#F1F5F9' : palette.raised, borderWidth: 1, borderColor: palette.border }}>
                    <Text style={{ color: palette.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6 }}>ESTIMATE</Text>
                  </View>
                  <InspireQuote slot="heroCorner" tiltDeg={-3} color="#0E6F88" style={{ textAlign: 'right', fontSize: 11.5, lineHeight: 14 }} />
                </View>
              </View>

              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 0 }]}>
                <View style={{ flex: 1, minWidth: 0, paddingRight: 14 }}>
                  <Text style={{ color: palette.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.7 }} numberOfLines={2}>
                    {displayEstimateDate}
                  </Text>
                </View>
                <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: isInspire ? '#8CCAD6' : palette.border }} />
                <View style={{ paddingLeft: 18, minWidth: 92, alignItems: 'flex-start' }}>
                  <Text style={{ color: palette.text, fontSize: 28, fontWeight: '800', lineHeight: 32 }}>
                    {plan.monthsToPayoff ?? '—'}
                  </Text>
                  <Text style={{ color: palette.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, lineHeight: 16 }}>
                    {'MONTHS\nTO GO'}
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 6 }}>
                {[0, 1, 2, 3, 4, 5, 6].map(segmentIdx => {
                  const segFill = Math.max(0, Math.min(1, (freedomPercent / 100) * 7 - segmentIdx));
                  const segColor = isInspire ? inspireBarColors[segmentIdx % inspireBarColors.length] : ctaBg;
                  return (
                    <View
                      key={segmentIdx}
                      style={{
                        flex: 1,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: isInspire ? 'rgba(255,255,255,0.72)' : isLight ? '#CBD5E1' : palette.raised,
                        overflow: 'hidden',
                      }}
                    >
                      {segFill > 0 ? (
                        <View style={{ width: `${segFill * 100}%`, height: '100%', backgroundColor: segColor, borderRadius: 5 }} />
                      ) : null}
                    </View>
                  );
                })}
              </View>

              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                {isInspire ? (
                  <InspireQuote slot="heroFooter" color="#0E6F88" style={{ flex: 1, fontSize: 12.5 }} />
                ) : (
                  <Text style={[ui.small, { flex: 1, color: palette.muted }]}>Keep building your freedom.</Text>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Change payoff strategy. Currently ${onboardingData.strategy === 'avalanche' ? 'Avalanche' : 'Snowball'}`}
                  style={[
                    ui.row,
                    isInspire
                      ? { gap: 4, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBE6EC' }
                      : { gap: 4, alignItems: 'center', paddingVertical: 4 },
                  ]}
                  onPress={() => navigate('debt', 'Strategy')}
                >
                  <Text style={{ color: palette.brand, fontSize: 13, fontWeight: '700' }}>
                    {onboardingData.strategy === 'avalanche' ? 'Avalanche' : 'Snowball'}
                  </Text>
                  <AppIcon name="chevronRight" size={14} color={palette.brand} />
                </Pressable>
              </View>
            </Card>
            {(pairingAudit.divergentLinks.length > 0 || pairingAudit.invalidLinks.length > 0) ? (
              <View onLayout={event => { pairingReviewY.current = event.nativeEvent.layout.y; }}>
                <Card>
                  <Text style={ui.heading}>Legacy loan links to review</Text>
                  <Text style={ui.text}>Mortgage and Auto loans now live in both Accounts and Budget as one obligation. Review mismatched or stale legacy links below so neither record is overwritten automatically.</Text>
                  {!canEdit ? (
                    <Text style={ui.small}>Only household members or owners can resolve legacy loan links.</Text>
                  ) : (
                    <>
                      {pairingAudit.divergentLinks.map(link => (
                        <View key={`div:${link.debt.id}`} style={[ui.divider, { gap: 8 }]}>
                          <Text style={ui.heading}>{link.debt.name} · {link.debt.category}</Text>
                          <Text style={ui.small}>
                            {`Loan: ${formatCurrency(link.debt.minimumPayment, currencySymbol)} / month${link.debt.dueDay !== null ? ` · due day ${link.debt.dueDay}` : ' · no due day'}`}
                          </Text>
                          <Text style={ui.small}>
                            {`Legacy bill (${link.bill.name}): ${formatCurrency(moneyToMajor(link.bill.amount), currencySymbol)} / month · due day ${link.bill.dueDay}`}
                          </Text>
                          <View style={[ui.row, { flexWrap: 'wrap', gap: 8 }]}>
                            {link.debt.dueDay !== null && link.debt.minimumPayment > 0 ? (
                              <Pressable
                                accessibilityRole="button"
                                disabled={!canEdit || pairingBusy}
                                onPress={() => void handleResolveDivergentLink(link, 'use_loan')}
                                style={ui.button}
                              >
                                <Text style={[ui.buttonText, { color: palette.brand }]}>Use loan terms</Text>
                              </Pressable>
                            ) : null}
                            <Pressable
                              accessibilityRole="button"
                              disabled={!canEdit || pairingBusy}
                              onPress={() => void handleResolveDivergentLink(link, 'use_bill')}
                              style={ui.button}
                            >
                              <Text style={[ui.buttonText, { color: palette.brand }]}>Use bill terms</Text>
                            </Pressable>

                          </View>
                        </View>
                      ))}
                      {pairingAudit.invalidLinks.map(item => (
                        <View key={`inv:${item.debtId}`} style={[ui.divider, { gap: 8 }]}>
                          <Text style={ui.heading}>{item.debt?.name ?? item.bill?.name ?? 'Saved loan link'}</Text>
                          <Text style={ui.small}>
                            {item.reason === 'missing_debt'
                              ? 'This legacy link points to a loan account that is no longer available.'
                              : item.reason === 'missing_bill' || item.reason === 'inactive_bill'
                                ? 'This legacy link points to a recurring bill that is missing or ended.'
                                : item.reason === 'duplicate_bill'
                                  ? 'Multiple loans point to the same legacy recurring bill and cannot be unified automatically.'
                                  : 'This legacy link points to an incompatible recurring item.'}
                          </Text>

                        </View>
                      ))}
                    </>
                  )}
                </Card>
              </View>
            ) : null}
            {incompleteLoanSchedules.length > 0 ? <Card><Text style={ui.heading}>Loan due dates needed</Text><Text style={ui.small}>These accounts are included in Budget but cannot appear in payment reminders until a due day is set.</Text>{incompleteLoanSchedules.map(debt => <Pressable key={debt.id} accessibilityRole="button" disabled={!canEdit} onPress={() => openEditDebtEditor(debt)} style={ui.button}><Text style={ui.buttonText}>{debt.name} - Set due day</Text></Pressable>)}</Card> : null}
            <SnapshotCard debts={onboardingData.debts.filter(item => !isPaidOffAccountArchived(item, onboardingData.archivedPaidOffDebtIds))} currencySymbol={currencySymbol} onInformationVisibilityChange={setHomeInformationOpen} />
            <Card style={{ padding: 16, gap: isInspire ? 6 : 2 }}>
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }]}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text accessibilityRole="header" style={ui.heading}>Payoff Strategy</Text>
                  <Text style={ui.small}>
                    {`${onboardingData.strategy === 'avalanche' ? 'Avalanche' : 'Snowball'} · Cards & Loans`}
                  </Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="See all payoff strategy details" style={[ui.row, { gap: 4, alignItems: 'center', paddingVertical: 4 }]} onPress={() => navigate('debt', 'Strategy')}>
                  <Text style={[ui.buttonText, { color: palette.text, fontWeight: '600' }]}>See all</Text>
                  <AppIcon name="chevronRight" size={14} color={palette.muted} />
                </Pressable>
              </View>
              {plan.payoffOrder.length ? plan.payoffOrder.slice(0, 3).map((item, idx) => {
                const badge = getCategoryBadge(item.category);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open payoff strategy details for ${item.name}`}
                    onPress={() => navigate('debt', 'Strategy')}
                    style={[
                      !isInspire && idx > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border } : null,
                      ui.row,
                      isInspire
                        ? { justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 10, borderRadius: 12, backgroundColor: inspireStrategyTints[idx % inspireStrategyTints.length] }
                        : { justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
                    ]}
                  >
                    <View style={[ui.row, { flex: 1, minWidth: 0, alignItems: 'center', gap: 10 }]}>
                      <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: isInspire ? '#FFFFFF' : isLight ? '#F1F5F9' : palette.raised, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: isInspire ? palette.brand : palette.muted, fontSize: 13, fontWeight: '700' }}>{idx + 1}</Text>
                      </View>
                      <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: badge.bg, alignItems: 'center', justifyContent: 'center' }}>
                        <AppIcon name={badge.icon} size={18} color={badge.color} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[ui.heading, { fontSize: 16 }]} numberOfLines={1}>{item.name}</Text>
                        <Text style={ui.small}>{`${item.apr.toFixed(2)}% APR`}</Text>
                      </View>
                    </View>
                    <View style={{ backgroundColor: isInspire ? '#FFFFFF' : palette.tint, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 }}>
                      <Text style={{ color: palette.brand, fontSize: 13, fontWeight: '600' }}>{item.projectedPayoffLabel}</Text>
                    </View>
                  </Pressable>
                );
              }) : <Text style={[ui.small, { paddingVertical: 10 }]}>Add an active debt account to see its payoff order.</Text>}
            </Card>
            {/* Upcoming */}
            {upcomingItems.length > 0 && <View onLayout={event => { upcomingSectionY.current = event.nativeEvent.layout.y; }}><Card style={{ padding: 16, gap: 2 }}>
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }]}>
                <Text accessibilityRole="header" style={ui.heading}>Upcoming</Text>
                {sortedUpcomingItems.length > 4 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={showAllUpcoming ? 'Show fewer upcoming bills' : 'Show all upcoming bills'}
                    style={[ui.row, { gap: 4, alignItems: 'center', paddingVertical: 4 }]}
                    onPress={() => setShowAllUpcoming(value => !value)}
                  >
                    <Text style={[ui.buttonText, { color: palette.brand, fontWeight: '600' }]}>
                      {showAllUpcoming ? 'Show less' : `See all (${sortedUpcomingItems.length})`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {upcomingItems.map((item, idx) => {
                  const badge = getCategoryBadge(item.category);
                  const isPrimaryPay = !item.isPendingConfirmation && idx === 0;
                  const statusLabel = item.settlementStatus === 'pending_confirmation'
                    ? 'Pending'
                    : item.isPartiallyPaid
                      ? `Partial - ${formatCurrency(item.totalPaid, currencySymbol)}`
                      : 'Unpaid';
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole={canEdit ? 'button' : undefined}
                      accessibilityLabel={`Pay ${item.name} due ${item.dueDate}`}
                      disabled={!canEdit}
                      onPress={() => { if (canEdit) setPayUpcomingTarget(item.payTarget); }}
                      style={[
                        idx > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border } : null,
                        ui.row,
                        { justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, gap: 10 },
                      ]}
                    >
                      <View style={[ui.row, { flex: 1, minWidth: 0, alignItems: 'center', gap: 12 }]}>
                        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: item.isCritical ? criticalBg : badge.bg, alignItems: 'center', justifyContent: 'center' }}>
                          <AppIcon name={badge.icon} size={18} color={item.isCritical ? criticalColor : badge.color} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={[ui.row, { gap: 6, alignItems: 'center', flexWrap: 'wrap' }]}>
                            <Text style={[ui.heading, { fontSize: 16 }]} numberOfLines={1}>{item.name}</Text>
                            {item.isCritical ? (
                              <View style={[ui.badge, { backgroundColor: criticalBg, borderColor: criticalColor, borderWidth: 1, paddingVertical: 2, paddingHorizontal: 6 }]}>
                                <Text style={[ui.badgeText, { color: criticalColor, fontSize: 12 }]}>
                                  {item.isPastDue ? 'Past Due' : 'Due Soon'}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={[ui.small, item.isCritical ? { color: criticalColor } : null]}>
                            {`${formatShortActivityDate(item.dueDate)}${item.installmentLabel ? ` · ${item.installmentLabel}` : ''} · ${statusLabel}`}
                          </Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={[ui.value, { fontSize: 16 }, item.isCritical ? { color: criticalColor } : null]}>
                            {formatCurrency(item.amount, currencySymbol)}
                          </Text>
                          {item.isPartiallyPaid ? (
                            <Text style={[ui.small, { color: isLight ? '#0a8554' : '#76DCB9' }]}>remaining</Text>
                          ) : null}
                        </View>
                        {canEdit ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Pay ${item.name}`}
                            onPress={() => setPayUpcomingTarget(item.payTarget)}
                            hitSlop={4}
                            style={{
                              backgroundColor: isPrimaryPay ? ctaBg : palette.tint,
                              borderColor: isPrimaryPay ? ctaBg : item.isPendingConfirmation ? palette.border : palette.brand,
                              borderWidth: 1,
                              minHeight: 34,
                              paddingHorizontal: 14,
                              paddingVertical: 5,
                              borderRadius: 999,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Text style={{ color: isPrimaryPay ? ctaFg : palette.brand, fontWeight: '700', fontSize: 13 }}>
                              {item.isPendingConfirmation ? 'Details' : 'Pay'}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
            </Card></View>}

            {/* Recent Activity */}
            <Card style={{ padding: 16, gap: 2 }}>
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }]}>
                <Text accessibilityRole="header" style={ui.heading}>Recent Activity</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="See all recent activity"
                  style={[ui.row, { gap: 4, alignItems: 'center', paddingVertical: 4 }]}
                  onPress={() => navigate('transactions')}
                >
                  <Text style={[ui.buttonText, { color: palette.text, fontWeight: '600' }]}>See all</Text>
                  <AppIcon name="chevronRight" size={14} color={palette.muted} />
                </Pressable>
              </View>
              {recentTxs.length === 0 ? (
                <Text style={ui.text}>No recorded activity yet.</Text>
              ) : (
                recentTxs.map((tx, idx) => {
                    const dir = classifyCategoryDirection(tx.category);
                    const isPayment = dir === 'decrease_debt';
                    const rawAccountLabel = tx.accountId ? debtNameById[tx.accountId] : undefined;
                    const isPaymentLikePayee = isPayment && (!tx.payee || /^Payment\b/i.test(tx.payee) || tx.category === 'payment');
                    const isBalanceAdj = tx.category === 'credit_adjustment' || tx.category === 'balance_adjustment' || /^Reconciliation credit adjustment$/i.test(tx.payee || '');
                    const titleLabel = isPaymentLikePayee ? 'Payment' : isBalanceAdj ? 'Balance Adjustment' : (tx.payee || (isPayment ? 'Payment' : 'Charge'));
                    const subtitleLabel = rawAccountLabel || (isPayment ? 'Payment' : 'Charge');
                    const amountColor = isPayment ? (isLight ? '#0a8554' : '#86E3B8') : (isLight ? '#c53b27' : '#F08B78');
                    return (
                      <Pressable
                        key={tx.id}
                        accessibilityRole="button"
                        accessibilityLabel={`View transaction ${titleLabel}`}
                        onPress={() => navigate('transactions')}
                        style={[
                          idx > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border } : null,
                          ui.row,
                          { justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
                        ]}
                      >
                        <View style={[ui.row, { flex: 1, minWidth: 0, alignItems: 'center', gap: 12 }]}>
                          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: isPayment ? 'rgba(134, 227, 184, 0.14)' : 'rgba(240, 139, 120, 0.14)', alignItems: 'center', justifyContent: 'center' }}>
                            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={amountColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                              <Path d={isPayment ? 'M12 5v14M18 13l-6 6-6-6' : 'M12 19V5M6 11l6-6 6 6'} />
                            </Svg>
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={[ui.row, { gap: 6, alignItems: 'center', flexWrap: 'wrap' }]}>
                              <Text style={[ui.heading, { fontSize: 16 }]} numberOfLines={1}>{titleLabel}</Text>
                              {tx.isPending ? (
                                <View style={[ui.badge, { backgroundColor: 'rgba(245, 197, 99, 0.15)', borderColor: 'rgba(245, 197, 99, 0.3)', borderWidth: 1, paddingVertical: 2, paddingHorizontal: 6 }]}>
                                  <Text style={[ui.badgeText, { color: '#F5C563', fontSize: 12 }]}>Pending</Text>
                                </View>
                              ) : null}
                            </View>
                            <Text style={ui.small} numberOfLines={1}>{subtitleLabel}</Text>
                          </View>
                        </View>
                        <View style={{ alignItems: 'flex-end', minWidth: 0, flexShrink: 0, gap: 2 }}>
                          <Text style={[ui.value, { fontSize: 16, color: amountColor }]}>
                            {isPayment ? `−${formatCurrency(moneyToMajor(tx.amount), currencySymbol)}` : `+${formatCurrency(moneyToMajor(tx.amount), currencySymbol)}`}
                          </Text>
                          <Text style={ui.small}>{formatShortActivityDate(tx.date)}</Text>
                        </View>
                      </Pressable>
                    );
                  })
              )}
            </Card>
          </ScrollView>
        </View>
          );
        }}</HomeAppearance>
      )}
    />
  );
}

function HomeAppearance({ children }: { children: (appearance: ReturnType<typeof useNativeAppearance>) => ReactNode }) {
  return <>{children(useNativeAppearance())}</>;
}

const styles = StyleSheet.create({
  quietSection: { paddingHorizontal: 16, paddingVertical: 10, borderWidth: 0, borderRadius: 0, backgroundColor: 'transparent', elevation: 0, shadowOpacity: 0 },
  root: {
    flex: 1,
    backgroundColor: '#0C0E0D',
  },
  estimateCard: {
    backgroundColor: '#141816',
    borderColor: '#222A25',
  },
  estimateDate: {
    fontSize: 30,
    letterSpacing: -0.9,
  },
  flex1: {
    flex: 1,
  },
  homeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: '#121614',
    borderBottomWidth: 1,
    borderBottomColor: '#222A25',
  },
  logoBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#1C2721',
    borderWidth: 1,
    borderColor: '#28372E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F1F5F2',
    letterSpacing: -0.3,
  },
  logoTextAccent: {
    color: '#76DCB9',
  },
  homeHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#1C2420',
    borderWidth: 1,
    borderColor: '#28372E',
  },
  headerActionPillText: {
    color: '#76DCB9',
    fontSize: 12,
    fontWeight: '600',
  },
  homeContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 14,
  },
  inlineEditorCard: {
    backgroundColor: '#141816',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#222A25',
    padding: 14,
    marginTop: 8,
    marginBottom: 4,
  },
  fieldLabelSmall: {
    color: '#A6B2AA',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  textInputField: {
    fontSize: 14,
  },
  choiceGrid2: {
    flexDirection: 'row',
    gap: 8,
  },
  subtleActionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#28372E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtleActionBtnText: {
    color: '#A6B2AA',
    fontSize: 14,
    fontWeight: '600',
  },
  saveInlineBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#76DCB9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveInlineBtnText: {
    color: '#0C0E0D',
    fontSize: 14,
    fontWeight: '700',
  },
  errorText: {
    color: '#F08B78',
    fontSize: 12,
    marginTop: 6,
  },
  disabledButton: {
    opacity: 0.5,
  },
});
