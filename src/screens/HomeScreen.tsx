import React, { useState, useRef, useEffect, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
} from 'react-native';
import { Pressable, ScrollView, Text, TextInput, View } from '../components/NativeAppearance';
import * as SecureStore from 'expo-secure-store';
import * as ExpoCrypto from 'expo-crypto';
import type { Session } from '@supabase/supabase-js';
import { AppIcon } from '../components/AppIcon';
import { SelectDropdown, type DropdownOption } from '../components/SelectDropdown';
import {
  Bar,
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
import { SheetFormHeader } from '../components/SheetModal';
import {
  acceptAprEdit,
  acceptMoneyEdit,
  activeDebts,
  calculatePayoffPlan,
  formatCurrency,
  formatEditableMoney,
  homeDebtFreeEstimateDate,
  type DebtCategory,
  type DebtItem,
  type FlowStage,
  type LoanBillPairing,
  type PayoffPlanResult,
  type PayoffStrategy,
  type UserOnboardingData,
} from '../onboarding-domain';
import {
  saveUserOnboardingData,
  deleteUserDebt,
  upsertUserDebt,
  FinancialSettingsConflictError,
  loadUserOnboardingData,
  saveUserOnboardingSettingsPatch,
} from '../onboarding-storage';
import { type LedgerTransaction, type ReconciliationAnchor, classifyCategoryDirection } from '../finance/ledger';
import { getActiveRecurringBills, resolveRecurringBillDate, type RecurringBill } from '../finance/recurring-bills';
import { activeLoanBillLinks, compatibleLoanBills, loansNeedingPairingReview, suggestLoanBills, withoutDeletedDebtPairing, withoutIncompatibleDebtPairing } from '../finance/loan-bill-pairing';
import { makeMoney, moneyToMajor, parseMoney, type Money } from '../finance/money';
import { getCurrency } from '../finance/currencies';
import { addCalendarDays, type DateOnly, currentHouseholdDate, getNextMonthString } from '../finance/calendar';
import {
  confirmObligationPaidToday,
  obligationFirstDueDate,
  prepareObligationEditorSchedule,
  shouldAskPaidToday,
  saveObligationEditorSchedule,
} from '../finance/obligation-editor';
import { getObligationCycle, obligationScheduleKey } from '../finance/obligation-schedule';
import type { ObligationSchedule, ObligationScheduleKey } from '../finance/obligation-schedule';
import {
  calculateOverdueObligations,
  getObligationPaymentState,
  type PaymentObligation,
} from '../finance/payment-matching';

const DEBT_CATEGORY_DROPDOWN_OPTIONS: readonly DropdownOption<DebtCategory>[] = [
  { value: 'Mortgage', label: 'Mortgage', subtitle: 'Home loan with separate escrow tracking', icon: 'homeLoan' },
  { value: 'Credit card', label: 'Credit card', subtitle: 'Revolving line of credit', icon: 'creditCard' },
  { value: 'Auto loan', label: 'Auto loan', subtitle: 'Vehicle financing', icon: 'auto' },
  { value: 'Student loan', label: 'Student loan', subtitle: 'Higher education loan', icon: 'debt' },
  { value: 'Personal loan', label: 'Personal loan', subtitle: 'Unsecured installment loan', icon: 'debt' },
  { value: 'Medical debt', label: 'Medical debt', subtitle: 'Healthcare balance', icon: 'debt' },
  { value: 'Other loan', label: 'Other loan', subtitle: 'General debt obligation', icon: 'debt' },
];

export type HomeScreenProps = {
  session: Session | null;
  onboardingData: UserOnboardingData;
  onUpdateOnboardingData: (data: UserOnboardingData) => void;
  transactions: LedgerTransaction[];
  recurringBills: RecurringBill[];
  reconciliationAnchors: ReconciliationAnchor[];
  currencyCode: string;
  currencySymbol: string;
  onSignOut: () => void | Promise<void>;
  onChangeStage: (stage: FlowStage) => void;
  onAddTransaction: (tx: LedgerTransaction) => unknown;
  onUpdateTransaction?: (tx: LedgerTransaction) => unknown;
  onDeleteTransaction?: (txId: string) => unknown;
  onRecordBillPayment: (bill: RecurringBill, dueCycle: DateOnly, amount?: Money) => unknown;
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
  reloadFeedback?: { kind: 'success' | 'warning' | 'error'; message: string } | null;
};

export function HomeScreen({
  session,
  onboardingData,
  onUpdateOnboardingData,
  transactions,
  recurringBills,
  reconciliationAnchors,
  currencyCode,
  currencySymbol,
  onSignOut,
  onChangeStage,
  onAddTransaction,
  onUpdateTransaction,
  onDeleteTransaction,
  onRecordBillPayment,
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
  reloadFeedback = null,
}: HomeScreenProps) {
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const savingRef = useRef(false);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingBillChoice, setPairingBillChoice] = useState<Record<string, string>>({});

  const [themePreference, setThemePreference] = useState<'System' | 'Dark' | 'Light'>('Dark');

  useEffect(() => {
    let active = true;
    const userId = session?.user?.id ?? onboardingData.userId;
    SecureStore.getItemAsync(`debtfree-pref-theme.${userId.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
      .then(savedTheme => {
        if (!active || !savedTheme) return;
        if (savedTheme === 'System' || savedTheme === 'Dark' || savedTheme === 'Light') {
          setThemePreference(savedTheme as 'System' | 'Dark' | 'Light');
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

  const plan: PayoffPlanResult = calculatePayoffPlan(
    onboardingData.debts,
    onboardingData.strategy,
    onboardingData.extraMonthlyPayment,
    new Date(),
    currencyCode,
  );

  const householdTimeZone =
    onboardingData?.householdTimeZone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';

  const todayKey = currentHouseholdDate(householdTimeZone);
  const loanBillPairs = activeLoanBillLinks(onboardingData.loanBillPairingByDebtId, recurringBills, onboardingData.debts);
  const loanIdByBillId = Object.fromEntries(Object.entries(loanBillPairs).map(([debtId, billId]) => [billId, debtId]));
  const currentMonthKey = todayKey.slice(0, 7);
  const windowEndKey = addCalendarDays(todayKey, 14);

  const currencyScale = getCurrency(currencyCode).scale;

  // Shared past-due calculation engine (guarantees Home and Budget agree 100%)
  const overdueObligations = calculateOverdueObligations({
    debts: onboardingData.debts,
    recurringBills,
    transactions,
    asOfDate: todayKey,
    currencyCode,
    schedules: onboardingData.obligationSchedules,
    loanBillPairs,
  });

  const overdueUpcomingItems = overdueObligations.map(item => ({
    id: item.id,
    name: item.name,
    dueDate: item.dueDate,
    amount: moneyToMajor(item.remainingAmount),
    isPartiallyPaid: item.isPartiallyPaid,
    isPastDue: true,
    totalPaid: moneyToMajor(item.totalPaid),
    settlementStatus: item.settlementStatus,
    isPendingConfirmation: item.settlementStatus === 'pending_confirmation',
    pendingAmount: moneyToMajor(item.pendingAmount),
  }));

  const futureUpcomingItems = [
    ...getActiveRecurringBills(recurringBills).flatMap(bill => {
      const items: {
        id: string;
        name: string;
        dueDate: DateOnly;
        amount: number;
        isPartiallyPaid: boolean;
        isPastDue: boolean;
        totalPaid: number;
        settlementStatus: 'unpaid' | 'partially_paid' | 'pending_confirmation';
        isPendingConfirmation: boolean;
        pendingAmount: number;
      }[] = [];

      const schedule = onboardingData.obligationSchedules?.[obligationScheduleKey('bill', bill.id)];
      let month = schedule && schedule.firstDueDate.slice(0, 7) > currentMonthKey ? schedule.firstDueDate.slice(0, 7) : currentMonthKey;
      for (let attempt = 0; attempt < 3; attempt++, month = getNextMonthString(month)) {
        const cycle = schedule ? getObligationCycle(schedule, month) : null;
        if (schedule && (!cycle || cycle.acknowledgedPaid)) continue;
        const dueDate = cycle?.dueDate ?? resolveRecurringBillDate(month, bill.dueDay);
        if (dueDate < todayKey) continue;
        if (dueDate > windowEndKey) break;
        const obligation: PaymentObligation = {
          id: bill.id,
          kind: 'bill',
          name: bill.name,
          dueDate,
          dueCycleMonth: month,
          requiredAmount: cycle?.amount ?? bill.amount,
          accountId: bill.creditAccountId,
          billId: bill.id,
          linkedDebtId: loanIdByBillId[bill.id],
          bill,
        };
        const state = getObligationPaymentState(obligation, transactions, currencyCode);
        const match = state.confirmedMatch;
        if (state.status !== 'paid') {
          items.push({
            id: `${bill.id}:${dueDate}`,
            name: bill.name,
            dueDate,
            amount: moneyToMajor(match.remainingAmount),
            isPartiallyPaid: match.isPartiallyPaid,
            isPastDue: false,
            totalPaid: moneyToMajor(match.totalPaid),
            settlementStatus: state.status as 'unpaid' | 'partially_paid' | 'pending_confirmation',
            isPendingConfirmation: state.status === 'pending_confirmation',
            pendingAmount: moneyToMajor(state.pendingAmount),
          });
        }
      }

      return items;
    }),
    ...activeDebts(onboardingData.debts).filter(debt => !loanBillPairs[debt.id] && debt.balance > 0 && debt.dueDay !== null && (onboardingData.obligationSchedules?.[obligationScheduleKey('debt', debt.id)] || debt.minimumPayment > 0)).flatMap(debt => {
      const items: {
        id: string;
        name: string;
        dueDate: DateOnly;
        amount: number;
        isPartiallyPaid: boolean;
        isPastDue: boolean;
        totalPaid: number;
        settlementStatus: 'unpaid' | 'partially_paid' | 'pending_confirmation';
        isPendingConfirmation: boolean;
        pendingAmount: number;
      }[] = [];

      const schedule = onboardingData.obligationSchedules?.[obligationScheduleKey('debt', debt.id)];
      const requiredMoney = makeMoney(currencyCode, Math.round(debt.minimumPayment * 10 ** currencyScale));
      let month = schedule && schedule.firstDueDate.slice(0, 7) > currentMonthKey ? schedule.firstDueDate.slice(0, 7) : currentMonthKey;
      for (let attempt = 0; attempt < 3; attempt++, month = getNextMonthString(month)) {
        const cycle = schedule ? getObligationCycle(schedule, month) : null;
        if (schedule && (!cycle || cycle.acknowledgedPaid)) continue;
        const dueDate = cycle?.dueDate ?? resolveRecurringBillDate(month, debt.dueDay!);
        if (dueDate < todayKey) continue;
        if (dueDate > windowEndKey) break;
        const obligation: PaymentObligation = {
          id: `minimum:${debt.id}`,
          kind: 'debt',
          name: `${debt.name} minimum`,
          dueDate,
          dueCycleMonth: month,
          requiredAmount: cycle?.amount ?? requiredMoney,
          accountId: debt.id,
          debt,
        };
        const state = getObligationPaymentState(obligation, transactions, currencyCode);
        const match = state.confirmedMatch;
        if (state.status !== 'paid') {
          items.push({
            id: `minimum:${debt.id}:${dueDate}`,
            name: `${debt.name} minimum`,
            dueDate,
            amount: moneyToMajor(match.remainingAmount),
            isPartiallyPaid: match.isPartiallyPaid,
            isPastDue: false,
            totalPaid: moneyToMajor(match.totalPaid),
            settlementStatus: state.status as 'unpaid' | 'partially_paid' | 'pending_confirmation',
            isPendingConfirmation: state.status === 'pending_confirmation',
            pendingAmount: moneyToMajor(state.pendingAmount),
          });
        }
      }

      return items;
    }),
  ];

  const upcomingItems = [
    ...overdueUpcomingItems,
    ...futureUpcomingItems,
  ].sort((a, b) => {
    if (a.isPastDue !== b.isPastDue) return a.isPastDue ? -1 : 1;
    return a.dueDate.localeCompare(b.dueDate);
  }).slice(0, 4);

  const clearErrors = () => setLocalError('');

  const editSetup = () => {
    clearErrors();
    onChangeStage('onboard_1');
  };

  const openSettings = () => {
    clearErrors();
    setShowSettings(true);
  };

  const closeSettings = () => {
    setShowSettings(false);
  };

  const openNewDebtEditor = (category: DebtCategory = 'Credit card') => {
    clearErrors();
    draftDebtIdRef.current = null;
    draftDebtPaidTodayRef.current = {};
    setEditingDebtId(null);
    setDebtCategory(category);
    setDebtName('');
    setDebtBalance('');
    setDebtOriginalBalance('');
    setDebtApr('');
    setDebtMinimum('');
    setMortgageEscrow('');
    setDebtDueDay('');
    setDebtCreditLimit('');
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
    setMortgageEscrow(onboardingData.mortgageEscrowByDebtId?.[item.id] !== undefined
      ? formatEditableMoney(onboardingData.mortgageEscrowByDebtId[item.id], currencyCode)
      : '');
    setDebtDueDay(item.dueDay !== null ? String(item.dueDay) : '');
    setDebtCreditLimit(item.creditLimit !== null ? formatEditableMoney(item.creditLimit, currencyCode) : '');
    setShowDebtForm(true);
  };

  const handleSaveDebt = async () => {
    if (savingRef.current) return;
    clearErrors();

    const existingDebt = editingDebtId ? onboardingData.debts.find(d => d.id === editingDebtId) : undefined;
    const balanceNum = parseFloat(debtBalance);
    const aprNum = parseFloat(debtApr);
    const minNum = parseFloat(debtMinimum);
    const escrowNum = debtCategory === 'Mortgage' && mortgageEscrow.trim() ? parseFloat(mortgageEscrow) : null;

    if (!debtName.trim()) {
      setLocalError('Please enter a name for this debt account.');
      return;
    }
    if (isNaN(balanceNum)) {
      setLocalError('Please enter a valid balance.');
      return;
    }
    if (isNaN(aprNum) || aprNum < 0) {
      setLocalError('Please enter a valid APR percentage.');
      return;
    }
    if (isNaN(minNum) || minNum < 0) {
      setLocalError('Please enter a valid minimum monthly payment.');
      return;
    }
    if (debtCategory === 'Mortgage' && mortgageEscrow.trim() && (escrowNum === null || !Number.isFinite(escrowNum) || escrowNum < 0 || escrowNum > minNum)) {
      setLocalError('Mortgage escrow must be a valid amount between zero and the monthly payment.');
      return;
    }

    const dueDayNum = debtDueDay.trim() ? Number(debtDueDay.trim()) : null;
    if (dueDayNum !== null && (!Number.isInteger(dueDayNum) || dueDayNum < 1 || dueDayNum > 31)) {
      setLocalError('Due day must be between 1 and 31.');
      return;
    }

    const origNum = debtOriginalBalance.trim() ? parseFloat(debtOriginalBalance.trim()) : null;
    const limitNum = debtCreditLimit.trim() ? parseFloat(debtCreditLimit.trim()) : null;

    const debtId = existingDebt?.id ?? (draftDebtIdRef.current ??= ExpoCrypto.randomUUID());
    const isDraftDebt = draftDebtIdRef.current === debtId;
    const today = currentHouseholdDate(householdTimeZone);
    const key = obligationScheduleKey('debt', debtId);
    const priorSchedule = onboardingData.obligationSchedules?.[key];
    let paidToday = draftDebtPaidTodayRef.current[debtId] ?? false;
    savingRef.current = true;
    setSaving(true);

    try {
      if (dueDayNum !== null && draftDebtPaidTodayRef.current[debtId] === undefined && shouldAskPaidToday({
        dueDay: dueDayNum, today, isNew: isDraftDebt, legacyDueDay: existingDebt?.dueDay, hasSchedule: Boolean(priorSchedule),
      })) {
        const answer = await confirmObligationPaidToday();
        if (answer === null) return;
        paidToday = answer;
        draftDebtPaidTodayRef.current[debtId] = answer;
      }
      const updated = await upsertUserDebt(onboardingData, {
        id: debtId,
        name: debtName.trim(),
        category: debtCategory,
        balance: balanceNum,
        originalBalance: origNum,
        apr: aprNum,
        minimumPayment: minNum,
        dueDay: dueDayNum,
        creditLimit: limitNum,
        serverVersion: existingDebt?.serverVersion,
      });
      onUpdateOnboardingData(updated);
      let settingsData = updated;
      const savedDebt = updated.debts.find(debt => debt.id === debtId);
      const nextPairings = savedDebt
        ? withoutIncompatibleDebtPairing(updated.loanBillPairingByDebtId, savedDebt, recurringBills)
        : updated.loanBillPairingByDebtId;
      if (JSON.stringify(nextPairings) !== JSON.stringify(updated.loanBillPairingByDebtId ?? {})) {
        try {
          const savedPairings = await saveUserOnboardingSettingsPatch(updated, { loanBillPairingByDebtId: nextPairings }, session!);
          settingsData = savedPairings;
          onUpdateOnboardingData(savedPairings);
        } catch (error) {
          setLocalError(`Debt account saved, but its now-incompatible loan/bill link could not be cleared: ${error instanceof Error ? error.message : String(error)}. It remains preserved in settings and backup for recovery.`);
        }
      }
      if (debtCategory === 'Mortgage' || existingDebt?.category === 'Mortgage') {
        const mortgageEscrowByDebtId = { ...(settingsData.mortgageEscrowByDebtId ?? {}) };
        const mortgageExtraPaymentByDebtId = { ...(settingsData.mortgageExtraPaymentByDebtId ?? {}) };
        if (debtCategory === 'Mortgage' && escrowNum !== null) mortgageEscrowByDebtId[debtId] = escrowNum;
        else delete mortgageEscrowByDebtId[debtId];
        if (debtCategory !== 'Mortgage') delete mortgageExtraPaymentByDebtId[debtId];
        const savedMortgageTerms = await saveUserOnboardingSettingsPatch(settingsData, { mortgageEscrowByDebtId, mortgageExtraPaymentByDebtId }, session!);
        settingsData = savedMortgageTerms;
        onUpdateOnboardingData(savedMortgageTerms);
      }
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
        onUpdateOnboardingData(savedSettings);
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
  };

  const handleDeleteDebt = async (debtId: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    clearErrors();
    try {
      const updated = await deleteUserDebt(onboardingData, debtId);
      onUpdateOnboardingData(updated);
      const mortgageEscrowByDebtId = { ...(updated.mortgageEscrowByDebtId ?? {}) };
      const mortgageExtraPaymentByDebtId = { ...(updated.mortgageExtraPaymentByDebtId ?? {}) };
      const obligationSchedules = { ...(updated.obligationSchedules ?? {}) };
      delete mortgageEscrowByDebtId[debtId];
      delete mortgageExtraPaymentByDebtId[debtId];
      const debtScheduleKey = obligationScheduleKey('debt', debtId);
      delete obligationSchedules[debtScheduleKey];
      const loanBillPairingByDebtId = withoutDeletedDebtPairing(updated.loanBillPairingByDebtId, debtId);
      const cleanupPatch: Partial<UserOnboardingData> = {
        ...(Object.keys(mortgageEscrowByDebtId).length !== Object.keys(updated.mortgageEscrowByDebtId ?? {}).length ? { mortgageEscrowByDebtId } : {}),
        ...(Object.keys(mortgageExtraPaymentByDebtId).length !== Object.keys(updated.mortgageExtraPaymentByDebtId ?? {}).length ? { mortgageExtraPaymentByDebtId } : {}),
        ...(Object.keys(obligationSchedules).length !== Object.keys(updated.obligationSchedules ?? {}).length ? { obligationSchedules } : {}),
        ...(Object.keys(loanBillPairingByDebtId).length !== Object.keys(updated.loanBillPairingByDebtId ?? {}).length ? { loanBillPairingByDebtId } : {}),
      };
      if (Object.keys(cleanupPatch).length) {
        try { onUpdateOnboardingData(await saveUserOnboardingSettingsPatch(updated, cleanupPatch, session!)); }
        catch (error) { setLocalError(`Debt deletion was confirmed, but related settings cleanup could not be confirmed: ${error instanceof Error ? error.message : String(error)}. Export preserves the remaining metadata for recovery.`); }
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to delete debt account.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleToggleHomeStrategy = async (nextStrategy: PayoffStrategy) => {
    if (onboardingData.strategy === nextStrategy) return;
    if (savingRef.current) {
      const error = new Error('Another change is still saving. Try again in a moment.');
      setLocalError(error.message);
      throw error;
    }
    const priorData = onboardingData;
    // Optimistic update for responsive, instant UI feedback
    onUpdateOnboardingData({ ...priorData, strategy: nextStrategy });
    clearErrors();
    savingRef.current = true;
    setSaving(true);
    try {
      let candidate = { ...priorData, strategy: nextStrategy };
      let updated: UserOnboardingData;
      try {
        updated = await saveUserOnboardingData(candidate);
      } catch (err) {
        if (
          session &&
          (err instanceof FinancialSettingsConflictError ||
            (err instanceof Error && err.name === 'FinancialSettingsConflictError'))
        ) {
          // Self-heal revision mismatch by loading fresh authoritative server data and retrying
          const fresh = await loadUserOnboardingData(session);
          candidate = { ...fresh, strategy: nextStrategy };
          updated = await saveUserOnboardingData(candidate);
        } else {
          throw err;
        }
      }
      onUpdateOnboardingData(updated);
    } catch (err) {
      // Revert optimistic update on failure
      onUpdateOnboardingData(priorData);
      setLocalError(err instanceof Error ? err.message : 'Unable to update your strategy.');
      throw err;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveExtra = async (amount: number) => {
    if (savingRef.current) {
      const error = new Error('Another change is still saving. Try again in a moment.');
      setLocalError(error.message);
      throw error;
    }
    const priorData = onboardingData;
    onUpdateOnboardingData({ ...priorData, extraMonthlyPayment: amount });
    clearErrors();
    savingRef.current = true;
    setSaving(true);
    setLocalError('');
    try {
      let candidate = { ...priorData, extraMonthlyPayment: amount };
      let updated: UserOnboardingData;
      try {
        updated = await saveUserOnboardingData(candidate);
      } catch (err) {
        if (
          session &&
          (err instanceof FinancialSettingsConflictError ||
            (err instanceof Error && err.name === 'FinancialSettingsConflictError'))
        ) {
          const fresh = await loadUserOnboardingData(session);
          candidate = { ...fresh, extraMonthlyPayment: amount };
          updated = await saveUserOnboardingData(candidate);
        } else {
          throw err;
        }
      }
      onUpdateOnboardingData(updated);
    } catch (err) {
      onUpdateOnboardingData(priorData);
      setLocalError(err instanceof Error ? err.message : 'Unable to update extra payment.');
      throw err;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveMortgageExtra = async (debtId: string, amount: number) => {
    if (savingRef.current) throw new Error('Another change is still saving. Try again in a moment.');
    const priorData = onboardingData;
    const candidate = {
      ...priorData,
      mortgageExtraPaymentByDebtId: { ...(priorData.mortgageExtraPaymentByDebtId ?? {}), [debtId]: amount },
    };
    savingRef.current = true;
    setSaving(true);
    try {
      let updated: UserOnboardingData;
      try {
        updated = await saveUserOnboardingData(candidate);
      } catch (error) {
        if (session && (error instanceof FinancialSettingsConflictError || (error instanceof Error && error.name === 'FinancialSettingsConflictError'))) {
          const fresh = await loadUserOnboardingData(session);
          updated = await saveUserOnboardingData({
            ...fresh,
            mortgageExtraPaymentByDebtId: { ...(fresh.mortgageExtraPaymentByDebtId ?? {}), [debtId]: amount },
          });
        } else {
          throw error;
        }
      }
      onUpdateOnboardingData(updated);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const saveBudgetSettings = async (patch: Partial<UserOnboardingData>) => {
    if (savingRef.current) throw new Error('Another settings change is saving. Try again shortly.');
    const base = onboardingData;
    const canonical = (value: unknown): string => {
      if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
      const object = value as Record<string, unknown>;
      return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
    };
    savingRef.current = true;
    setSaving(true);
    try {
      let updated: UserOnboardingData;
      try {
        updated = await saveUserOnboardingData({ ...onboardingData, ...patch });
      } catch (error) {
        if (!session || !(error instanceof FinancialSettingsConflictError || (error instanceof Error && error.name === 'FinancialSettingsConflictError'))) throw error;
        const fresh = await loadUserOnboardingData(session);
        const changedTarget = (Object.keys(patch) as (keyof UserOnboardingData)[]).some(key => canonical(fresh[key]) !== canonical(base[key]));
        if (changedTarget) throw new FinancialSettingsConflictError();
        updated = await saveUserOnboardingData({ ...fresh, ...patch });
      }
      onUpdateOnboardingData(updated);
    } finally { savingRef.current = false; setSaving(false); }
  };

  const handleSaveBudgetIncome = async (patch: Pick<UserOnboardingData, 'primaryIncomeAmount' | 'primaryPayFrequency' | 'primaryMonthlyIncome' | 'additionalIncomes'>) => {
    await saveBudgetSettings(patch);
  };

  const handleSaveLoanBillPairings = async (loanBillPairingByDebtId: NonNullable<UserOnboardingData['loanBillPairingByDebtId']>) => {
    await saveBudgetSettings({ loanBillPairingByDebtId });
  };
  const handleSaveRecurringBillCategoryLabels = async (recurringBillCategoryLabelByBillId: NonNullable<UserOnboardingData['recurringBillCategoryLabelByBillId']>) => {
    await saveBudgetSettings({ recurringBillCategoryLabelByBillId });
  };

  const handleReviewLoanPairing = async (debtId: string, relation: LoanBillPairing | null) => {
    if (pairingBusy) return;
    const pairings = { ...(onboardingData.loanBillPairingByDebtId ?? {}) };
    if (relation) pairings[debtId] = relation; else delete pairings[debtId];
    setPairingBusy(true);
    try { await handleSaveLoanBillPairings(pairings); }
    catch (error) { setLocalError(error instanceof Error ? error.message : 'Unable to save this loan link.'); }
    finally { setPairingBusy(false); }
  };

  const debtEditor: ReactNode = showDebtForm ? (
    <View style={styles.inlineEditorCard}>
      <SheetFormHeader title={editingDebtId ? 'Edit debt account' : `Add ${debtCategory}`} closeLabel="Close debt editor"
        onClose={() => { clearErrors(); setShowDebtForm(false); setEditingDebtId(null); draftDebtIdRef.current = null; draftDebtPaidTodayRef.current = {}; }} />
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
        style={[ui.input, styles.textInputField]}
        value={debtName}
        onChangeText={setDebtName}
        placeholder="e.g., Chase Sapphire"
        placeholderTextColor="#6E7571"
      />
      <View style={styles.choiceGrid2}>
        <View style={styles.flex1}>
          <Text style={styles.fieldLabelSmall}>Current balance ({currencySymbol})</Text>
          <TextInput
            accessibilityLabel="Current balance"
            style={[ui.input, styles.textInputField]}
            keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
            value={debtBalance}
            onChangeText={text => setDebtBalance(prev => acceptMoneyEdit(prev, text, currencyCode, true))}
            placeholder="3500.00"
            placeholderTextColor="#6E7571"
          />
        </View>
        <View style={styles.flex1}>
          <Text style={styles.fieldLabelSmall}>APR (%)</Text>
          <TextInput
            accessibilityLabel="APR percentage"
            style={[ui.input, styles.textInputField]}
            keyboardType="decimal-pad"
            value={debtApr}
            onChangeText={text => setDebtApr(prev => acceptAprEdit(prev, text))}
            placeholder="21.99"
            placeholderTextColor="#6E7571"
          />
        </View>
      </View>
      <View style={styles.choiceGrid2}>
        <View style={styles.flex1}>
          <Text style={styles.fieldLabelSmall}>Minimum payment ({currencySymbol}/mo)</Text>
          <TextInput
            accessibilityLabel="Minimum monthly payment"
            style={[ui.input, styles.textInputField]}
            keyboardType="decimal-pad"
            value={debtMinimum}
            onChangeText={text => setDebtMinimum(prev => acceptMoneyEdit(prev, text, currencyCode))}
            placeholder="95.00"
            placeholderTextColor="#6E7571"
          />
        </View>
        <View style={styles.flex1}>
          <Text style={styles.fieldLabelSmall}>Due day (1–31)</Text>
          <TextInput
            accessibilityLabel="Due day"
            style={[ui.input, styles.textInputField]}
            keyboardType="number-pad"
            value={debtDueDay}
            onChangeText={setDebtDueDay}
            placeholder="15"
            placeholderTextColor="#6E7571"
          />
        </View>
      </View>
      {debtCategory === 'Mortgage' ? <View>
        <Text style={styles.fieldLabelSmall}>Monthly escrow included in payment</Text>
        <TextInput
          accessibilityLabel="Mortgage monthly escrow"
          style={[ui.input, styles.textInputField]}
          keyboardType="decimal-pad"
          value={mortgageEscrow}
          onChangeText={text => setMortgageEscrow(prev => acceptMoneyEdit(prev, text, currencyCode))}
          placeholder="Enter known escrow amount"
          placeholderTextColor="#6E7571"
        />
        <Text style={styles.fieldLabelSmall}>Required for a mortgage payoff estimate that separates taxes and insurance from principal and interest.</Text>
      </View> : null}
      {!editingDebtId && Number.isInteger(Number(debtDueDay)) && Number(debtDueDay) >= 1 && Number(debtDueDay) <= 31 ? (
        <Text style={styles.fieldLabelSmall}>{`First due date: ${obligationFirstDueDate(Number(debtDueDay), currentHouseholdDate(householdTimeZone), currencyCode)}`}</Text>
      ) : null}
      <View style={styles.choiceGrid2}>
        <View style={styles.flex1}>
          <Text style={styles.fieldLabelSmall}>Original balance (optional)</Text>
          <TextInput
            accessibilityLabel="Original balance"
            style={[ui.input, styles.textInputField]}
            keyboardType="decimal-pad"
            value={debtOriginalBalance}
            onChangeText={text => setDebtOriginalBalance(prev => acceptMoneyEdit(prev, text, currencyCode))}
            placeholder="Optional"
            placeholderTextColor="#6E7571"
          />
        </View>
        <View style={styles.flex1}>
          <Text style={styles.fieldLabelSmall}>Credit limit (optional)</Text>
          <TextInput
            accessibilityLabel="Credit limit"
            style={[ui.input, styles.textInputField]}
            keyboardType="decimal-pad"
            value={debtCreditLimit}
            onChangeText={text => setDebtCreditLimit(prev => acceptMoneyEdit(prev, text, currencyCode))}
            placeholder="Optional"
            placeholderTextColor="#6E7571"
          />
        </View>
      </View>
      {!!localError ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {localError}
        </Text>
      ) : null}
      <View style={[styles.choiceGrid2, { marginTop: 12 }]}>
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
          <Text style={styles.saveInlineBtnText}>Save debt</Text>
        </Pressable>
      </View>
    </View>
  ) : null;

  return (
    <FiveTabShell
      userId={session?.user.id ?? onboardingData.userId}
      key={session?.user.id ?? onboardingData.userId}
      themePreference={themePreference}
      settingsVisible={showSettings}
      onCloseSettings={closeSettings}
      settings={close => (
        <SettingsScreen
          session={session}
          onboardingData={onboardingData}
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
          onUpdateTransactions={onUpdateTransactions}
          onUpdateRecurringBills={onUpdateRecurringBills}
          onUpdateReconciliationAnchors={onUpdateReconciliationAnchors}
          onSignOut={onSignOut}
          onEditSetup={editSetup}
        />
      )}
      debt={(targetDebtId: string | null, clearTarget: () => void, section: string, resetKey: number) => (
        <DebtScreen
          key={resetKey}
          debts={onboardingData.debts}
          initialSelectedId={targetDebtId}
          initialSection={section}
          onDismiss={() => { clearTarget(); setShowDebtForm(false); setEditingDebtId(null); }}
          plan={plan}
          currencySymbol={currencySymbol}
          currencyCode={currencyCode}
          transactions={transactions}
          reconciliationAnchors={reconciliationAnchors}
          editor={debtEditor}
          error={localError}
          onAdd={() => openNewDebtEditor('Credit card')}
          onEdit={openEditDebtEditor}
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
        />
      )}
      transactions={(targetTransactionId: string | null, clearTarget: () => void, section: string) => (
        <TransactionsScreen
          initialTransactionId={targetTransactionId}
          initialSection={section}
          onEditDismiss={clearTarget}
          debts={onboardingData.debts}
          transactions={transactions}
          recurringBills={recurringBills}
          obligationSchedules={onboardingData.obligationSchedules}
          loanBillPairs={loanBillPairs}
          householdTimeZone={householdTimeZone}
          currencySymbol={currencySymbol}
          currencyCode={currencyCode}
          onRecordBillPayment={onRecordBillPayment}
          onAddTransaction={onAddTransaction}
          onUpdateTransaction={onUpdateTransaction}
          onDeleteTransaction={onDeleteTransaction}
          onSettings={openSettings}
        />
      )}
      budget={(navigate: (tab: any, section?: string) => void) => (
        <BudgetScreen
          data={onboardingData}
          plan={plan}
          currencySymbol={currencySymbol}
          currencyCode={currencyCode}
          householdTimeZone={householdTimeZone}
          transactions={transactions}
          recurringBills={recurringBills}
          reconciliationAnchors={reconciliationAnchors}
          onAddRecurringBill={onAddRecurringBill}
          onDeleteRecurringBill={onDeleteRecurringBill}
          onOpenStrategy={() => navigate('debt', 'Strategy')}
          onSaveObligationSchedule={onSaveObligationSchedule}
          onEditDebt={debtId => navigate('debt', debtId)}
          onRecordBillPayment={onRecordBillPayment}
          onAddTransaction={onAddTransaction}
          onUpdateTransaction={onUpdateTransaction}
          onUpdateTransactions={onUpdateTransactions}
          onSaveIncome={handleSaveBudgetIncome}
          onSaveLoanBillPairings={handleSaveLoanBillPairings}
          onSaveRecurringBillCategoryLabels={handleSaveRecurringBillCategoryLabels}
          onSettings={openSettings}
          onStrategy={handleToggleHomeStrategy}
          onExtra={handleSaveExtra}
          error={localError}
        />
      )}
      progress={(navigate: (tab: any, section?: string) => void) => (
        <ProgressScreen
          debts={onboardingData.debts}
          transactions={transactions}
          currencySymbol={currencySymbol}
          currencyCode={currencyCode}
          strategy={plan.strategy}
          householdTimeZone={householdTimeZone}
          onSettings={openSettings}
          onSelectDebt={debtId => navigate('debt', debtId)}
        />
      )}
      home={(navigate: (tab: any, section?: string) => void) => (
        <View style={styles.root}>
          <View style={styles.homeHeader}>
            <View style={styles.logoBrand} accessible accessibilityRole="header" accessibilityLabel="DebtFree Home">
              <View style={styles.brandMark}>
                <AppIcon name="brandRise" size={16} color="#FFFFFF" />
              </View>
              <Text style={styles.logoText}>
                Debt<Text style={styles.logoTextAccent}>Free</Text>
              </Text>
            </View>
            <View style={styles.homeHeaderActions}>
              {__DEV__ && <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit setup"
                style={styles.headerActionPill}
                onPress={editSetup}
              >
                <Text style={styles.headerActionPillText}>Edit Setup</Text>
              </Pressable>}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reload app data"
                accessibilityState={{ disabled: reloading }}
                disabled={reloading}
                style={ui.iconButton}
                onPress={() => void onReload()}
              >
                {reloading ? <ActivityIndicator size="small" color="#81DFD2" /> : <AppIcon name="reset" size={18} color="#81DFD2" />}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open settings"
                style={ui.iconButton}
                onPress={openSettings}
              >
                <AppIcon name="settings" size={20} color="#81DFD2" />
              </Pressable>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={false}>
            <Text style={ui.title}>{`Hi, ${session?.user.user_metadata?.full_name?.split(' ')[0] || session?.user.email?.split('@')[0] || 'there'}`}</Text>
            <Text style={ui.text}>Your debt-free journey</Text>
            {localError ? (
              <View accessibilityRole="alert" style={{ marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: '#38221E' }}>
                <Text style={[ui.small, { color: '#FF9B82' }]}>{localError}</Text>
              </View>
            ) : null}
            {reloadFeedback ? (
              <View
                accessibilityRole={reloadFeedback.kind === 'error' ? 'alert' : 'text'}
                style={{ marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: reloadFeedback.kind === 'success' ? '#1E2C28' : reloadFeedback.kind === 'error' ? '#38221E' : '#302B20' }}
              >
                <Text style={[ui.small, { color: reloadFeedback.kind === 'success' ? '#73D882' : reloadFeedback.kind === 'error' ? '#FF9B82' : '#F2C94C' }]}>
                  {reloadFeedback.message}
                </Text>
              </View>
            ) : null}
            <Card style={styles.estimateCard}>
              <View style={[ui.row, { justifyContent: 'space-between' }]}>
                <Text style={ui.heading}>Debt-free estimate</Text>
                <View style={ui.badge}><Text style={ui.badgeText}>ESTIMATE</Text></View>
              </View>
              <Text style={ui.text}>Projected from your active payoff plan</Text>
              <View style={[ui.row, { alignItems: 'stretch', marginTop: 4 }]}>
                <View style={{ flex: 1, justifyContent: 'center' }}>
                  <Text style={[ui.title, styles.estimateDate]}>{homeDebtFreeEstimateDate(plan.debtFreeDateLabel)}</Text>
                </View>
                <View style={{ width: 1, backgroundColor: '#414743', marginHorizontal: 16 }} />
                <View style={{ minWidth: 92, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={ui.heading}>{plan.monthsToPayoff ?? '—'}</Text>
                  <Text style={ui.small}>months to go</Text>
                </View>
              </View>
              <Bar percent={plan.progressPercent} />
            </Card>
            {loansNeedingPairingReview(onboardingData.debts, recurringBills, onboardingData.loanBillPairingByDebtId).length ? <Card>
              <Text style={ui.heading}>Needs attention</Text>
              <Text style={ui.text}>Review a possible existing loan payment. Linking records only relates the two items; it creates no payment and does not change a balance.</Text>
              {loansNeedingPairingReview(onboardingData.debts, recurringBills, onboardingData.loanBillPairingByDebtId).map(debt => {
                const candidates = compatibleLoanBills(debt, recurringBills).filter(candidate =>
                  !Object.entries(loanBillPairs).some(([otherDebtId, billId]) => otherDebtId !== debt.id && billId === candidate.id));
                const suggestion = suggestLoanBills(debt, recurringBills)[0];
                const suggested = suggestion && candidates.some(candidate => candidate.id === suggestion.id) ? suggestion : undefined;
                const selectedBillId = candidates.some(candidate => candidate.id === pairingBillChoice[debt.id])
                  ? pairingBillChoice[debt.id] : (suggested?.id ?? candidates[0]?.id ?? '');
                return <View key={debt.id} style={[ui.divider, { gap: 8 }]}>
                  <Text style={ui.heading}>{debt.name} · {debt.category}</Text>
                  {candidates.length ? <>
                    {suggested ? <Text style={ui.small}>{`Suggested: ${suggested.name} · confirm before linking`}</Text> : <Text style={ui.small}>Choose the recurring payment for this loan.</Text>}
                    <SelectDropdown label="Recurring spending" sheetTitle="Choose recurring payment" value={selectedBillId}
                      options={candidates.map(row => ({ value: row.id, label: row.name }))}
                      onSelect={id => setPairingBillChoice(current => ({ ...current, [debt.id]: id }))} />
                    <View style={[ui.row, { flexWrap: 'wrap' }]}>
                      <Pressable accessibilityRole="button" disabled={pairingBusy || !selectedBillId} onPress={() => void handleReviewLoanPairing(debt.id, { status: 'linked', billId: selectedBillId })} style={ui.button}><Text style={ui.buttonText}>Confirm link</Text></Pressable>
                      <Pressable accessibilityRole="button" disabled={pairingBusy} onPress={() => void handleReviewLoanPairing(debt.id, { status: 'separate' })} style={ui.button}><Text style={ui.buttonText}>Keep separate</Text></Pressable>
                      <Pressable accessibilityRole="button" disabled={pairingBusy} onPress={() => void handleReviewLoanPairing(debt.id, { status: 'dismissed' })} style={ui.button}><Text style={ui.buttonText}>Dismiss</Text></Pressable>
                    </View>
                  </> : <>
                    <Text style={ui.small}>No eligible recurring payment is available to review yet.</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="Add recurring spending for loan review" onPress={() => navigate('budget')} style={ui.button}><Text style={ui.buttonText}>Add recurring spending</Text></Pressable>
                  </>}
                </View>;
              })}
            </Card> : null}
            <SnapshotCard debts={onboardingData.debts} currencySymbol={currencySymbol} />
            <Card>
              <View style={[ui.row, { justifyContent: 'space-between' }]}>
                <Text style={ui.heading}>Payoff strategy</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="See all payoff strategy details" style={[ui.row, { gap: 4 }]} onPress={() => navigate('debt', 'Strategy')}>
                  <Text style={ui.buttonText}>See all</Text><AppIcon name="chevronRight" size={12} color="#81DFD2" />
                </Pressable>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Open payoff strategy details" onPress={() => navigate('debt', 'Strategy')}>
                <Text style={ui.text}>{onboardingData.strategy === 'avalanche' ? 'Avalanche' : 'Snowball'} · Active debt accounts</Text>
              </Pressable>
              {plan.payoffOrder.length ? plan.payoffOrder.map((item, idx) => (
                <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Open payoff strategy details for ${item.name}`} onPress={() => navigate('debt', 'Strategy')} style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}>
                  <View style={[ui.row, { flex: 1 }]}><View style={ui.badge}><Text style={ui.badgeText}>#{idx + 1}</Text></View><View style={{ flex: 1 }}><Text style={ui.heading}>{item.name}</Text><Text style={ui.small}>{`${item.apr}% APR · ${formatCurrency(item.balance, currencySymbol)} balance`}</Text></View></View>
                  <View style={{ alignItems: 'flex-end' }}><Text style={ui.value}>{formatCurrency(item.firstMonthPayment, currencySymbol)}/mo</Text><Text style={ui.small}>{item.projectedPayoffLabel}</Text></View>
                </Pressable>
              )) : <Text style={ui.small}>Add an active debt account to see its payoff order.</Text>}
            </Card>
            {/* Recent Activity */}
            <Card>
              <View style={[ui.row, { justifyContent: 'space-between' }]}>
                <Text style={ui.heading}>Recent activity</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="See all recent activity"
                  style={[ui.row, { gap: 4 }]}
                  onPress={() => navigate('transactions')}
                >
                  <Text style={ui.buttonText}>See all</Text>
                  <AppIcon name="chevronRight" size={12} color="#81DFD2" />
                </Pressable>
              </View>
              {transactions.filter(t => t.deletedAt === null).length === 0 ? (
                <Text style={ui.text}>No recorded activity yet. Use the Transactions tab to log payments and purchases.</Text>
              ) : (
                transactions
                  .filter(t => t.deletedAt === null)
                  .slice(0, 3)
                  .map(tx => {
                    const dir = classifyCategoryDirection(tx.category);
                    const isPayment = dir === 'decrease_debt';
                    return (
                      <View key={tx.id} style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}>
                        <View style={{ flex: 1 }}>
                          <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                            <Text style={ui.heading}>{tx.payee}</Text>
                            {tx.isPending ? (
                              <View style={[ui.badge, { backgroundColor: '#38321E', borderColor: '#F2C94C', borderWidth: 1, paddingVertical: 1, paddingHorizontal: 5 }]}>
                                <Text style={[ui.badgeText, { color: '#F2C94C', fontSize: 9 }]}>Pending</Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={ui.small}>{`${tx.date} · ${tx.category.replace('_', ' ')}`}</Text>
                        </View>
                        <Text style={[ui.value, { color: isPayment ? '#81DFD2' : '#E3A088' }]}>
                          {isPayment ? `-${formatCurrency(moneyToMajor(tx.amount), currencySymbol)}` : `+${formatCurrency(moneyToMajor(tx.amount), currencySymbol)}`}
                        </Text>
                      </View>
                    );
                  })
              )}
            </Card>

            {/* Upcoming bills appear only when an unsettled item is due soon. */}
            {upcomingItems.length > 0 && <Card>
              <View style={[ui.row, { justifyContent: 'space-between' }]}>
                <Text style={ui.heading}>Upcoming recurring bills</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="See all upcoming bills"
                  style={[ui.row, { gap: 4 }]}
                  onPress={() => navigate('transactions', 'Upcoming')}
                >
                  <Text style={ui.buttonText}>See all</Text>
                  <AppIcon name="chevronRight" size={12} color="#81DFD2" />
                </Pressable>
              </View>
              {upcomingItems.map(item => (
                <View key={item.id} style={[ui.divider, ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                  <View style={{ flex: 1 }}>
                    <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                      <Text style={ui.heading}>{item.name}</Text>
                      {item.isPastDue ? (
                        <View style={[ui.badge, { backgroundColor: '#38221E', borderColor: '#FF7A59', borderWidth: 1, paddingVertical: 1, paddingHorizontal: 5 }]}>
                          <Text style={[ui.badgeText, { color: '#FF7A59', fontSize: 9 }]}>Past Due</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[ui.small, item.isPastDue ? { color: '#FF7A59' } : null]}>
                      {`${item.isPastDue ? 'Past due since ' : 'Due '}${item.dueDate} · ${item.settlementStatus === 'pending_confirmation' ? 'Awaiting confirmation' : item.settlementStatus === 'partially_paid' ? 'Partially paid' : 'Unpaid'}`}
                    </Text>
                    {item.isPendingConfirmation ? (
                      <Text style={[ui.small, { color: '#F2C94C' }]}>
                        {`${formatCurrency(item.pendingAmount, currencySymbol)} awaiting confirmation`}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[ui.value, item.isPastDue ? { color: '#FF7A59' } : null]}>
                      {formatCurrency(item.amount, currencySymbol)}
                    </Text>
                    {item.isPartiallyPaid ? (
                      <Text style={[ui.small, { color: '#81DFD2' }]}>remaining</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </Card>}
          </ScrollView>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1F201F',
  },
  estimateCard: {
    backgroundColor: '#24322D',
    borderColor: '#3B5A4F',
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
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: '#242926',
    borderBottomWidth: 1,
    borderBottomColor: '#353D38',
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
    backgroundColor: '#0F5132',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F9F9F6',
    letterSpacing: -0.3,
  },
  logoTextAccent: {
    color: '#81DFD2',
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
    backgroundColor: '#353D39',
    borderWidth: 1,
    borderColor: '#414743',
  },
  headerActionPillText: {
    color: '#81DFD2',
    fontSize: 12,
    fontWeight: '600',
  },
  homeContent: {
    padding: 18,
    paddingBottom: 40,
    gap: 16,
  },
  inlineEditorCard: {
    backgroundColor: '#242926',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#353D38',
    padding: 14,
    marginTop: 8,
    marginBottom: 4,
  },
  fieldLabelSmall: {
    color: '#AAB3AD',
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
    borderColor: '#383D39',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtleActionBtnText: {
    color: '#AAB3AD',
    fontSize: 14,
    fontWeight: '600',
  },
  saveInlineBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#81DFD2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveInlineBtnText: {
    color: '#1B1E1C',
    fontSize: 14,
    fontWeight: '700',
  },
  errorText: {
    color: '#E3A088',
    fontSize: 12,
    marginTop: 6,
  },
  disabledButton: {
    opacity: 0.5,
  },
});
