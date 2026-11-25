import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AmountText } from '../components/AmountText';
import { Alert, Keyboard, StyleSheet, TouchableWithoutFeedback, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Pressable, ScrollView, Text, TextInput, View, appearanceColor, useNativeAppearance } from '../components/NativeAppearance';
import { getAppearancePalette } from '../components/appearance-theme';
import * as Crypto from 'expo-crypto';
import { AppIcon, type AppIconName } from '../components/AppIcon';
import { Card, FinancialScreen, MultiBar, ui } from '../components/FinancialScreen';
import { SelectDropdown, type DropdownOption } from '../components/SelectDropdown';
import { DueDayPickerModal, formatShortDate } from '../components/DatePickerModal';
import { AdaptiveModal } from '../components/ModalOverlay';
import { DEFAULT_TAB_UI_PREFERENCES, useBudgetUiPreferences, useSetTabUiPreferences, type TabUiPreferences } from '../components/TabShellContext';
import {
  calculateTotalMonthlyIncome,
  acceptMoneyEdit,
  formatEditableMoney,
  formatCurrency,
  normalizeMonthlyIncome,
  PAY_FREQUENCY_OPTIONS,
  type DebtItem,
  type UserOnboardingData,
  type PayFrequency,
  type LoanBillPairing,
  type IrregularBillSchedule,
  type AdditionalIncomeSource,
  parseMoneyInput,
} from '../onboarding-domain';
import {
  calculateMonthlyCashflow,
  calculateBillMonthlyReserve,
  calculateCategoryBreakdown,
  summarizeMonthlyExpenses,
  buildMonthlyBudgetBreakdown,
  selectDebtPlanCommitment,
  summarizeAnnualCardFeesMonthly,
} from '../finance/budget';
import { makeMoney, moneyToMajor, parseMoney } from '../finance/money';
import { getCurrency } from '../finance/currencies';
import { createRecurringBillDeletionPreview, shouldDismissRecurringBillEditor, type RecurringBill, type RecurringBillCategory, type RecurringBillPaymentMethod } from '../finance/recurring-bills';
import { extractBillIdFromTxId, extractBillIdsFromMemo, getPaidMonthlyObligationKeys } from '../finance/payment-matching';
import { currentHouseholdDate, currentHouseholdMonth, getNextMonthString, getPreviousMonthString } from '../finance/calendar';
import { calculateTransactionBalanceDelta, isPaidOffAccountArchived, type LedgerTransaction } from '../finance/ledger';
import {
  chooseObligationDueDateEdit,
  confirmObligationPaidToday,
  obligationFirstDueDate,
  prepareObligationEditorSchedule,
} from '../finance/obligation-editor';
import { obligationScheduleKey, type ObligationSchedule, type ObligationScheduleKey } from '../finance/obligation-schedule';
import { SheetFormHeader, SheetModal } from '../components/SheetModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { InspireCornerArt, InspireQuote } from '../components/InspireArt';
import {
  auditLegacyLoanPairings,
  selectUnifiedBudgetLoans,
  hasUnresolvedLegacyLoanLinks,
  uniqueHistoricalBillIdByDebtId,
  unifiedExcludedBillIds,
  unifiedLoanBudgetCategory,
  withoutIncompatibleBillPairings,
} from '../finance/loan-bill-pairing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomInsetPadding } from '../components/bottom-inset';

const BUDGET_CATEGORY_COLORS: Readonly<Record<string, string>> = {
  debt: '#76DCB9', housing: '#60A5FA', transportation: '#F5C563', auto: '#F5C563',
  utilities: '#2DD4BF', subscription: '#A78BFA', insurance: '#EC4899', purchases: '#F08B78', charges: '#F08B78', other_bill: '#94A3B8',
};
const budgetCategoryKey = (key: string) => {
  const norm = (key.startsWith('custom:') ? key.slice(7) : key).trim().toLowerCase();
  if (norm === 'debt' || norm === 'debt_payments' || norm === 'debt plan' || norm.startsWith('debt')) return 'debt';
  if (norm === 'housing' || norm === 'rent' || norm === 'mortgage' || norm.startsWith('housing')) return 'housing';
  if (norm === 'transportation' || norm === 'auto' || norm.startsWith('trans')) return 'transportation';
  if (norm === 'utilities' || norm === 'utility' || norm.startsWith('util')) return 'utilities';
  if (norm === 'subscription' || norm === 'subscriptions' || norm.startsWith('subscript')) return 'subscription';
  if (norm === 'insurance' || norm.startsWith('insur')) return 'insurance';
  if (norm === 'charges' || norm === 'charge') return 'charges';
  if (norm === 'purchases' || norm === 'recorded purchases' || norm.startsWith('purch')) return 'purchases';
  if (norm === 'other_bill' || norm === 'other bills' || norm === 'other') return 'other_bill';
  return norm;
};
const budgetCategoryColor = (key: string) => BUDGET_CATEGORY_COLORS[budgetCategoryKey(key)] ?? BUDGET_CATEGORY_COLORS.other_bill;

const expenseCategoryIcon = (categoryKey: string): AppIconName => {
  const key = budgetCategoryKey(categoryKey);
  if (key === 'debt' || key === 'subscription') return 'creditCard';
  if (key === 'housing') return 'homeLoan';
  if (key === 'charges' || key === 'purchases') return 'progress';
  if (key === 'transportation' || key === 'auto') return 'auto';
  if (key === 'utilities') return 'bolt';
  if (key === 'insurance') return 'shield';
  return 'calendar';
};

const BILL_CATEGORIES: readonly DropdownOption<RecurringBillCategory>[] = [
  { value: 'utilities', label: 'Utilities', subtitle: 'Water, Electric, Gas, Internet', icon: 'calendar' },
  { value: 'subscription', label: 'Subscription', subtitle: 'Streaming, Software, Gym', icon: 'creditCard' },
  { value: 'housing', label: 'Home', subtitle: 'Rent, HOA, Maintenance', icon: 'homeLoan' },
  { value: 'insurance', label: 'Insurance', subtitle: 'Health, Auto, Home insurance', icon: 'calendar' },
  { value: 'other_bill', label: 'Other', subtitle: 'Name a reusable spending category', icon: 'calendar' },
];

const LOAN_CATEGORIES: readonly DropdownOption<'Mortgage' | 'Auto loan'>[] = [
  { value: 'Mortgage', label: 'Mortgage', icon: 'homeLoan' },
  { value: 'Auto loan', label: 'Auto loan', icon: 'auto' },
];

const SHORT_MONTH_YEAR_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const EMPTY_TRANSACTIONS: LedgerTransaction[] = [];
const EMPTY_BILLS: RecurringBill[] = [];
const EMPTY_HISTORICAL_BILL_IDS: Readonly<Record<string, readonly string[]>> = {};

export const BudgetScreen = memo(BudgetScreenInner);

function BudgetScreenInner({
  data,
  currencySymbol,
  currencyCode,
  householdTimeZone,
  transactions = EMPTY_TRANSACTIONS,
  recurringBills = EMPTY_BILLS,
  onSaveIncome,
  onSaveLoanBillPairings,
  onSaveRecurringBillCategoryLabels,
  onSaveVariableCategoryCaps,
  onSaveIrregularBillSchedules,
  onSettings,
  onAddRecurringBill,
  onDeleteRecurringBill,
  onOpenStrategy,
  onSaveObligationSchedule,
  onEditDebt,
  onAddLoan,
  onEditLoan,
  onOpenPurchase,
  historicalBillIdsByDebtId = EMPTY_HISTORICAL_BILL_IDS,
  error: saveError,
  canEdit = true,
}: {
  data: UserOnboardingData;
  currencySymbol: string;
  currencyCode: string;
  householdTimeZone?: string;
  transactions?: LedgerTransaction[];
  recurringBills?: RecurringBill[];
  onSaveIncome: (patch: Pick<UserOnboardingData, 'primaryIncomeName' | 'primaryIncomeAmount' | 'primaryGrossIncomeAmount' | 'primaryPayFrequency' | 'primaryMonthlyIncome' | 'additionalIncomes'>) => Promise<void>;
  onSaveLoanBillPairings: (pairings: Record<string, LoanBillPairing>) => Promise<void>;
  onSaveRecurringBillCategoryLabels: (labels: Record<string, string>) => Promise<void>;
  onSaveVariableCategoryCaps?: (caps: Record<string, number>) => Promise<void>;
  onSaveIrregularBillSchedules?: (schedules: Record<string, IrregularBillSchedule>) => Promise<void>;
  onSettings: () => void;
  onAddRecurringBill: (bill: RecurringBill) => Promise<{ outcome: 'confirmed' | 'pending' } | void> | { outcome: 'confirmed' | 'pending' } | void;
  onDeleteRecurringBill?: (billId: string, expectedSnapshotToken: string) => Promise<{
    status: 'confirmed' | 'pending' | 'partial';
    deletedTransactions: number;
    totalTransactions: number;
    billDeleted?: boolean;
    message?: string;
  }>;
  onOpenStrategy?: () => void;
  onSaveObligationSchedule: (key: ObligationScheduleKey, schedule: ObligationSchedule) => Promise<void>;
  onEditDebt?: (debtId: string) => void;
  onAddLoan?: (category: 'Mortgage' | 'Auto loan', prefill?: { name?: string; minimumPayment?: string; dueDay?: string }) => void;
  onEditLoan?: (debt: DebtItem) => void;
  onOpenPurchase?: (transactionId: string) => void;
  historicalBillIdsByDebtId?: Readonly<Record<string, readonly string[]>>;
  error: string;
  canEdit?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { isLight, isInspire, themeStyle, accentColor, palette, ctaBg, ctaFg } = useNativeAppearance();
  const { width: windowWidth } = useWindowDimensions();
  const { cardBorder: cardBorderColor, posInk: posInkColor, neg: negColor } = palette;
  const graphOutlineColor = isInspire ? palette.graphOutline : undefined;
  const budgetUi = useBudgetUiPreferences();
  const shellSetUiPreferences = useSetTabUiPreferences();
  const [localUiPreferences, setLocalUiPreferences] = useState<TabUiPreferences>(DEFAULT_TAB_UI_PREFERENCES);
  const uiPreferences = budgetUi ?? localUiPreferences;
  const setUiPreferences = shellSetUiPreferences ?? setLocalUiPreferences;
  const budgetSection = uiPreferences.budgetSection;
  const setBudgetSection = (value: 'Budget' | 'Expense') =>
    setUiPreferences(current => (current.budgetSection === value ? current : { ...current, budgetSection: value }));
  const [selectedSpendingMonth, setSpendingMonth] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => currentHouseholdMonth(householdTimeZone));
  useEffect(() => {
    const refresh = () => setCurrentMonth(currentHouseholdMonth(householdTimeZone));
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => clearInterval(timer);
  }, [householdTimeZone]);
  const spendingMonth = selectedSpendingMonth ?? currentMonth;
  const [showAddBillModal, setShowAddBillModal] = useState(false);
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [incomeExpanded, setIncomeExpanded] = useState(false);
  const [incomeEditorId, setIncomeEditorId] = useState<string | null>(null);
  const [incomeName, setIncomeName] = useState('');
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeGrossAmount, setIncomeGrossAmount] = useState('');
  const [incomeFrequency, setIncomeFrequency] = useState<PayFrequency | ''>('');
  const [incomeBusy, setIncomeBusy] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expandedExpenseCategory, setExpandedExpenseCategory] = useState<string | null>(null);

  const [capKey, setCapKey] = useState<string | null>(null);
  const [capAmount, setCapAmount] = useState('');
  const [capError, setCapError] = useState('');
  const [capBusy, setCapBusy] = useState(false);
  const [billFrequency, setBillFrequency] = useState<IrregularBillSchedule['frequency']>('monthly');

  // New Recurring Bill Form State
  const [newBillName, setNewBillName] = useState('');
  const [newBillAmount, setNewBillAmount] = useState('');
  const [newBillCategory, setNewBillCategory] = useState<RecurringBillCategory | null>(null);
  const [newBillCustomCategory, setNewBillCustomCategory] = useState('');
  const [newBillDueDay, setNewBillDueDay] = useState('15');
  const [newBillPaymentMethod, setNewBillPaymentMethod] = useState<RecurringBillPaymentMethod>('debit');
  const [newBillCreditAccountId, setNewBillCreditAccountId] = useState<string>(
    data.debts.find(d => d.category === 'Credit card' && !isPaidOffAccountArchived(d, data.archivedPaidOffDebtIds))?.id ?? ''
  );
  const [editingBill, setEditingBill] = useState<RecurringBill | null>(null);
  const [showBillCategoryPicker, setShowBillCategoryPicker] = useState(false);
  const [showBillDuePicker, setShowBillDuePicker] = useState(false);
  const draftBillIdRef = useRef<string | null>(null);
  const draftBillPaidTodayRef = useRef<Record<string, boolean>>({});
  const billSaveBusyRef = useRef(false);

  const [addBillError, setAddBillError] = useState('');
  const [confirmEndBill, setConfirmEndBill] = useState<{ bill: RecurringBill; snapshotToken: string; message: string } | null>(null);
  const [endingBillBusy, setEndingBillBusy] = useState(false);
  const [confirmRemoveIncome, setConfirmRemoveIncome] = useState(false);

  const closeBillModal = () => {
    setShowAddBillModal(false);
    setEditingBill(null);
    setShowBillCategoryPicker(false);
    setShowBillDuePicker(false);
    draftBillIdRef.current = null;
    draftBillPaidTodayRef.current = {};
  };

  const incomes = useMemo(() => [
    {
      id: 'primary',
      name: data.primaryIncomeName ?? 'Income',
      amount: data.primaryIncomeAmount,
      frequency: data.primaryPayFrequency,
      grossAmount: data.primaryGrossIncomeAmount,
    },
    ...data.additionalIncomes,
  ], [
    data.primaryIncomeName,
    data.primaryIncomeAmount,
    data.primaryPayFrequency,
    data.primaryGrossIncomeAmount,
    data.additionalIncomes,
  ]);
  const budgetDebtAccounts = useMemo(
    () => data.debts.filter(debt => !isPaidOffAccountArchived(debt, data.archivedPaidOffDebtIds)),
    [data.debts, data.archivedPaidOffDebtIds],
  );
  const {
    pairingAudit,
    budgetUnresolved,
    unifiedLoans,
    activeRecurringBills,
  } = useMemo(() => {
    const nextPairingAudit = auditLegacyLoanPairings({
      debts: data.debts,
      recurringBills,
      pairings: data.loanBillPairingByDebtId,
      currencyCode,
    });
    const nextBudgetUnresolved = hasUnresolvedLegacyLoanLinks(nextPairingAudit);
    const divergentDebtIds = [
      ...nextPairingAudit.divergentLinks.map(link => link.debt.id),
      ...nextPairingAudit.invalidLinks.map(item => item.debtId),
    ];
    const nextUnifiedLoans = selectUnifiedBudgetLoans(budgetDebtAccounts, data.archivedPaidOffDebtIds, divergentDebtIds);
    const excludedBillIdSet = new Set(unifiedExcludedBillIds(
      data.loanBillPairingByDebtId,
      recurringBills,
      data.debts,
      data.archivedPaidOffDebtIds,
      divergentDebtIds,
    ));
    const nextActiveRecurringBills = recurringBills.filter(bill => !excludedBillIdSet.has(bill.id));
    return {
      pairingAudit: nextPairingAudit,
      budgetUnresolved: nextBudgetUnresolved,
      unifiedLoans: nextUnifiedLoans,
      activeRecurringBills: nextActiveRecurringBills,
    };
  }, [data.debts, recurringBills, data.loanBillPairingByDebtId, data.archivedPaidOffDebtIds, budgetDebtAccounts, currencyCode]);
  const debtCommitment = useMemo(
    () => selectDebtPlanCommitment(budgetDebtAccounts, data.extraMonthlyPayment, currencyCode),
    [budgetDebtAccounts, data.extraMonthlyPayment, currencyCode],
  );
  const annualFeeReserve = useMemo(
    () => summarizeAnnualCardFeesMonthly(budgetDebtAccounts, currencyCode),
    [budgetDebtAccounts, currencyCode],
  );
  const { cardNames, allDebtById, allBillById } = useMemo(() => ({
    cardNames: new Map(data.debts.filter(debt => debt.category === 'Credit card').map(debt => [debt.id, debt.name])),
    allDebtById: new Map(data.debts.map(debt => [debt.id, debt])),
    allBillById: new Map(recurringBills.map(bill => [bill.id, bill])),
  }), [data.debts, recurringBills]);
  const paidObligations = useMemo(() => (
    budgetSection === 'Budget' && expandedCategory !== null
      ? getPaidMonthlyObligationKeys({
          month: spendingMonth,
          debts: [...unifiedLoans, ...debtCommitment.accounts],
          recurringBills: activeRecurringBills,
          transactions,
          currencyCode,
          schedules: data.obligationSchedules,
          historicalBillIdsByDebtId,
        })
      : null
  ), [
    budgetSection,
    expandedCategory,
    spendingMonth,
    unifiedLoans,
    debtCommitment.accounts,
    activeRecurringBills,
    transactions,
    currencyCode,
    data.obligationSchedules,
    historicalBillIdsByDebtId,
  ]);

  const income = useMemo(
    () => calculateTotalMonthlyIncome(
      data.primaryIncomeAmount,
      data.primaryPayFrequency,
      data.additionalIncomes,
      currencyCode,
    ),
    [data.primaryIncomeAmount, data.primaryPayFrequency, data.additionalIncomes, currencyCode],
  );

  const effectiveTimeZone = householdTimeZone || DEVICE_TIME_ZONE;

  const todayStr = currentHouseholdDate(effectiveTimeZone);
  const reserveBills = useMemo(() => activeRecurringBills.map(bill => ({ ...bill, amount: calculateBillMonthlyReserve(bill.amount, data.irregularBillScheduleByBillId?.[bill.id]?.frequency ?? 'monthly') })), [activeRecurringBills, data.irregularBillScheduleByBillId]);
  const cashflow = useMemo(
    () => calculateMonthlyCashflow({
      monthlyIncome: income,
      recurringBills: reserveBills,
      monthlyDebtPlanPayment: debtCommitment.total,
      unifiedLoans,
      currencyCode,
    }),
    [income, reserveBills, debtCommitment.total, unifiedLoans, currencyCode],
  );
  const expenseSummary = useMemo(
    () => summarizeMonthlyExpenses({
      month: spendingMonth,
      currencyCode,
      transactions,
      debts: data.debts,
      recurringBills,
      loanBillPairingByDebtId: data.loanBillPairingByDebtId,
      customCategoryLabelsByBillId: data.recurringBillCategoryLabelByBillId,
      archivedPaidOffDebtIds: data.archivedPaidOffDebtIds,
      historicalBillIdsByDebtId,
    }),
    [
      spendingMonth,
      currencyCode,
      transactions,
      data.debts,
      recurringBills,
      data.loanBillPairingByDebtId,
      data.recurringBillCategoryLabelByBillId,
      data.archivedPaidOffDebtIds,
      historicalBillIdsByDebtId,
    ],
  );

  const categoryBreakdown = useMemo(
    () => calculateCategoryBreakdown({
      recurringBills: reserveBills,
      customCategoryLabelsByBillId: data.recurringBillCategoryLabelByBillId,
      monthlyIncome: income,
      monthlyDebtPlanPayment: debtCommitment.total,
      unifiedLoans,
      currencyCode,
      debtAccountCount: debtCommitment.accounts.length,
    }),
    [
      reserveBills,
      data.recurringBillCategoryLabelByBillId,
      income,
      debtCommitment.total,
      unifiedLoans,
      currencyCode,
      debtCommitment.accounts.length,
    ],
  );

  const creditCards = useMemo(
    () => budgetDebtAccounts.filter(d => d.category === 'Credit card'),
    [budgetDebtAccounts],
  );
  const reusableCustomCategoryLabels = useMemo(
    () => ['Auto', ...Object.values(data.recurringBillCategoryLabelByBillId ?? {})].reduce<string[]>((labels, value) => {
      const trimmed = value.trim();
      const label = trimmed.toLocaleLowerCase() === 'transportation' ? 'Auto' : trimmed;
      if (label && !labels.some(existing => existing.toLocaleLowerCase() === label.toLocaleLowerCase())) labels.push(label);
      return labels;
    }, []),
    [data.recurringBillCategoryLabelByBillId],
  );

  const displayBreakdown = useMemo(
    () => buildMonthlyBudgetBreakdown({
      categories: categoryBreakdown,
      hasActiveDebt: debtCommitment.accounts.length > 0 || debtCommitment.extra > 0,
      monthlyIncome: income,
    }),
    [categoryBreakdown, debtCommitment.accounts.length, debtCommitment.extra, income],
  );

  const openIncomeEditor = (id: string | null = null) => {
    if (!canEdit) return;
    setIncomeEditorId(id ?? 'new');
    if (id === 'primary') {
      setIncomeName(data.primaryIncomeName ?? 'Income');
      setIncomeAmount(formatEditableMoney(data.primaryIncomeAmount, currencyCode));
      setIncomeGrossAmount(data.primaryGrossIncomeAmount == null ? '' : formatEditableMoney(data.primaryGrossIncomeAmount, currencyCode));
      setIncomeFrequency(data.primaryPayFrequency);
    } else {
      const source = id ? data.additionalIncomes.find(item => item.id === id) : null;
      setIncomeName(source?.name ?? '');
      setIncomeAmount(formatEditableMoney(source?.amount ?? 0, currencyCode));
      setIncomeGrossAmount(source?.grossAmount == null ? '' : formatEditableMoney(source.grossAmount, currencyCode));
      setIncomeFrequency(source?.frequency ?? '');
    }
    setAddBillError('');
    setShowIncomeModal(true);
  };

  const saveIncome = async () => {
    if (!canEdit) return;
    const amount = parseMoneyInput(incomeAmount, currencyCode);
    if (amount === null || amount <= 0) { setAddBillError('Enter an income amount greater than zero.'); return; }
    const grossAmount = incomeGrossAmount.trim() ? parseMoneyInput(incomeGrossAmount, currencyCode) : null;
    if (incomeGrossAmount.trim() && (grossAmount === null || grossAmount <= 0)) { setAddBillError('Enter a gross amount greater than zero, or leave it blank.'); return; }
    if (!incomeName.trim()) { setAddBillError('Enter a name for this income source.'); return; }
    if (!incomeFrequency) { setAddBillError('Select a pay frequency.'); return; }
    setIncomeBusy(true);
    setAddBillError('');
    try {
      if (incomeEditorId === 'primary') {
        await onSaveIncome({ primaryIncomeName: incomeName.trim(), primaryIncomeAmount: amount, primaryPayFrequency: incomeFrequency,
          primaryGrossIncomeAmount: grossAmount,
          primaryMonthlyIncome: normalizeMonthlyIncome(amount, incomeFrequency, currencyCode), additionalIncomes: data.additionalIncomes });
      } else {
        const source: AdditionalIncomeSource = { id: incomeEditorId === 'new' ? Crypto.randomUUID() : incomeEditorId!,
          name: incomeName.trim(), amount, frequency: incomeFrequency,
          monthlyAmount: normalizeMonthlyIncome(amount, incomeFrequency, currencyCode),
          grossAmount: grossAmount ?? undefined };
        const additionalIncomes = incomeEditorId === 'new'
          ? [...data.additionalIncomes, source]
          : data.additionalIncomes.map(item => item.id === source.id ? source : item);
        await onSaveIncome({ primaryIncomeAmount: data.primaryIncomeAmount, primaryPayFrequency: data.primaryPayFrequency,
          primaryMonthlyIncome: data.primaryMonthlyIncome, additionalIncomes });
      }
      setShowIncomeModal(false);
    } catch (error) { setAddBillError(error instanceof Error ? error.message : 'Unable to save income.'); }
    finally { setIncomeBusy(false); }
  };

  const removeIncome = async () => {
    if (!canEdit || !incomeEditorId || incomeEditorId === 'primary' || incomeEditorId === 'new') return;
    setIncomeBusy(true);
    try {
      await onSaveIncome({ primaryIncomeAmount: data.primaryIncomeAmount, primaryPayFrequency: data.primaryPayFrequency,
        primaryMonthlyIncome: data.primaryMonthlyIncome, additionalIncomes: data.additionalIncomes.filter(item => item.id !== incomeEditorId) });
      setShowIncomeModal(false);
    } catch (error) { setAddBillError(error instanceof Error ? error.message : 'Unable to remove income.'); }
    finally { setIncomeBusy(false); }
  };

  const openBillEditor = (bill: RecurringBill) => {
    const claimed = Object.values(data.loanBillPairingByDebtId ?? {}).some(relation => relation?.status === 'linked' && relation.billId === bill.id);
    if (claimed && !Object.values(uniqueHistoricalBillIdByDebtId(data.loanBillPairingByDebtId)).includes(bill.id)) { Alert.alert('Loan review required', 'Multiple saved identities claim this recurring item. Its history must be reviewed before editing.'); return; }
    const loanId = Object.entries(uniqueHistoricalBillIdByDebtId(data.loanBillPairingByDebtId)).find(([, id]) => id === bill.id)?.[0];
    if (loanId) {
      const loan = data.debts.find(item => item.id === loanId);
      if (loan && onEditLoan) onEditLoan(loan);
      else Alert.alert('Loan history preserved', 'Edit this obligation from Accounts.');
      return;
    }
    if (!canEdit) return;
    setBillFrequency(data.irregularBillScheduleByBillId?.[bill.id]?.frequency ?? 'monthly');
    setEditingBill(bill);
    draftBillIdRef.current = bill.id;
    draftBillPaidTodayRef.current = {};
    setNewBillName(bill.name);
    setNewBillAmount(formatEditableMoney(moneyToMajor(bill.amount), currencyCode));
    setNewBillCategory(bill.category);
    setNewBillCustomCategory(data.recurringBillCategoryLabelByBillId?.[bill.id] ?? '');
    setNewBillDueDay(String(bill.dueDay));
    setNewBillPaymentMethod(bill.paymentMethod);
    setNewBillCreditAccountId(bill.creditAccountId ?? '');
    setAddBillError('');
    setShowBillCategoryPicker(false);
    setShowBillDuePicker(false);
    setShowAddBillModal(true);
  };

  const requestEndBill = (bill: RecurringBill) => {
    if (!canEdit) return;
    const preview = createRecurringBillDeletionPreview({
      transactions, bill, debts: data.debts, ownerId: data.userId, asOfDate: todayStr,
    });
    if (preview.hasPendingLinkedTransaction) {
      setAddBillError('A linked transaction is still awaiting confirmation. Refresh financial records, review the updated details, and confirm again.');
      return;
    }
    const linkedFutureTransactions = preview.transactionsToDelete;
    const transactionLines = linkedFutureTransactions.length
      ? linkedFutureTransactions.map(tx => `• ${tx.date} · ${tx.payee} · ${formatCurrency(moneyToMajor(tx.amount), currencySymbol)}`).join('\n')
      : 'None.';
    const balanceEffects = new Map<string, number>();
    const unresolvedAccountIds = new Set<string>();
    for (const tx of linkedFutureTransactions) {
      const debt = tx.accountId ? data.debts.find(item => item.id === tx.accountId) : undefined;
      if (tx.accountId && !debt) { unresolvedAccountIds.add(tx.accountId); continue; }
      if (!debt) continue;
      const delta = calculateTransactionBalanceDelta(tx, debt.category);
      balanceEffects.set(debt.id, (balanceEffects.get(debt.id) ?? 0) - delta.minorUnits);
    }
    const balanceLines = [...balanceEffects.entries()].map(([debtId, minorUnits]) => {
      const debt = data.debts.find(item => item.id === debtId)!;
      const direction = minorUnits > 0 ? 'increase' : minorUnits < 0 ? 'decrease' : 'no change';
      return `• ${debt.name}: ${direction}${minorUnits === 0 ? '' : ` by ${formatCurrency(Math.abs(minorUnits) / 10 ** getCurrency(currencyCode).scale, currencySymbol)}`}`;
    }).join('\n');
    const message = [
      `End ${bill.name} and stop its future occurrences. The ${linkedFutureTransactions.length} future-dated linked ledger item(s) below, assigned to future cycles, will be processed one at a time with revision-checked deletion.`,
      transactionLines,
      balanceLines ? `Debt balance effects after confirmed deletions:\n${balanceLines}` : 'No linked debt-account balance effects.',
      unresolvedAccountIds.size ? 'At least one linked transaction refers to an account that is not loaded. The app will stop before making any changes and ask for a reload.' : '',
      `${preview.preservedPrepayments.length} payment${preview.preservedPrepayments.length === 1 ? '' : 's'} recorded on or before ${todayStr}${preview.preservedPrepayments.length ? ` (${preview.preservedPrepayments.map(tx => `${tx.date} · ${tx.payee}`).join(', ')})` : ''} and applied to future cycles will be preserved as history; their recorded balance effects will not be reversed.`,
      `${preview.preservedFutureDatedPastCycle.length} future-dated linked item(s) assigned to cycles on or before ${todayStr} will also be preserved. Past history and unrelated ledger items remain untouched.`,
      preview.hasPendingLinkedTransaction ? 'An unconfirmed linked transaction exists. Refresh financial records before ending this item.' : '',
      'This sequence is not atomic; a revision conflict or connection loss can leave a partial result, which the app will report.',
    ].filter(Boolean).join('\n\n');
    setConfirmEndBill({ bill, snapshotToken: preview.snapshotToken, message });
  };

  const handleSaveBill = async () => {
    if (editingBill && Object.values(data.loanBillPairingByDebtId ?? {}).some(relation => relation?.status === 'linked' && relation.billId === editingBill.id)) { setAddBillError('Edit this loan from Accounts so its history and schedule stay together.'); return; }
    if (!canEdit || billSaveBusyRef.current) return;
    setAddBillError('');
    const nameTrimmed = newBillName.trim();
    if (!nameTrimmed) {
      setAddBillError('Please enter a bill name.');
      return;
    }

    let parsedAmt = 0;
    try {
      const money = parseMoney(newBillAmount.trim(), currencyCode);
      parsedAmt = money.minorUnits;
      if (parsedAmt <= 0) throw new Error();
    } catch {
      setAddBillError('Please enter a valid bill amount greater than 0.');
      return;
    }

    const dayNum = Number(newBillDueDay);
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) {
      setAddBillError('Due day must be between 1 and 31.');
      return;
    }

    if (!newBillCategory) { setAddBillError('Please select a category.'); return; }
    if (newBillCategory === 'other_bill' && !newBillCustomCategory.trim()) { setAddBillError('Please enter a custom category name.'); return; }

    if (newBillPaymentMethod === 'credit' && !creditCards.some(cc => cc.id === newBillCreditAccountId)) {
      setAddBillError('Please select which active credit card this bill will be charged to.');
      return;
    }

    const newBill: RecurringBill = {
      id: editingBill?.id ?? (draftBillIdRef.current ??= Crypto.randomUUID()),
      name: nameTrimmed,
      category: newBillCategory,
      amount: makeMoney(currencyCode, parsedAmt),
      dueDay: dayNum,
      paymentMethod: newBillPaymentMethod,
      creditAccountId: newBillPaymentMethod === 'credit' ? newBillCreditAccountId : undefined,
      autoPost: editingBill?.autoPost ?? false, // Preserve the existing setting; new bills remain manual-confirmation only.
      active: true,
      createdAt: editingBill?.createdAt ?? new Date().toISOString(),
    };

    billSaveBusyRef.current = true;
    let billWriteConfirmed = false;
    let pairingCleanupWarning = '';
    try {
      const today = currentHouseholdDate(effectiveTimeZone);
      const key = obligationScheduleKey('bill', newBill.id);
      const priorSchedule = data.obligationSchedules?.[key];
      let paidToday = draftBillPaidTodayRef.current[newBill.id] ?? false;
      if (!editingBill && !priorSchedule && draftBillPaidTodayRef.current[newBill.id] === undefined &&
          obligationFirstDueDate(dayNum, today, currencyCode) === today) {
        const answer = await confirmObligationPaidToday();
        if (answer === null) return;
        paidToday = answer;
        draftBillPaidTodayRef.current[newBill.id] = answer;
      }
      const dateEdit = editingBill ? await chooseObligationDueDateEdit({
        current: data, today, dueDay: dayNum, currencyCode, transactions, recurringBills, bill: editingBill,
      }) : undefined;
      const schedule = prepareObligationEditorSchedule({
        kind: 'bill', id: newBill.id, today, timeZone: effectiveTimeZone,
        dueDay: dayNum, amount: newBill.amount,
        legacyDueDay: editingBill?.dueDay,
        legacyAmount: editingBill?.amount,
        createdAt: newBill.createdAt, isNew: !editingBill, paidToday, existing: priorSchedule, ...dateEdit,
      });
      // New bills persist the schedule first so a failed bill write can retry
      // under the same ID. Existing bill edits write their row first, then CAS
      // the future terms; a CAS failure leaves this editor open for retry.
      if (!editingBill) await onSaveObligationSchedule(key, schedule);
      const billResult = await onAddRecurringBill(newBill);
      billWriteConfirmed = billResult === undefined || billResult.outcome === 'confirmed';
      const categoryLabels = { ...(data.recurringBillCategoryLabelByBillId ?? {}) };
      const customLabel = newBill.category === 'other_bill' ? newBillCustomCategory.trim() : '';
      if (customLabel) categoryLabels[newBill.id] = customLabel;
      else delete categoryLabels[newBill.id];
      if (JSON.stringify(categoryLabels) !== JSON.stringify(data.recurringBillCategoryLabelByBillId ?? {})) {
        await onSaveRecurringBillCategoryLabels(categoryLabels);
      }
      let scheduleCleanupError = '';
      if (editingBill && billWriteConfirmed) {
        try { await onSaveObligationSchedule(key, schedule); }
        catch (error) { scheduleCleanupError = error instanceof Error ? error.message : String(error); }
        const pairings = withoutIncompatibleBillPairings(data.loanBillPairingByDebtId, newBill, data.debts);
        if (JSON.stringify(pairings) !== JSON.stringify(data.loanBillPairingByDebtId ?? {})) {
          try { await onSaveLoanBillPairings(pairings); }
          catch (error) {
            pairingCleanupWarning = `The bill change was saved, but its incompatible loan link could not be cleared: ${error instanceof Error ? error.message : String(error)}. The link remains preserved in settings and backup for recovery.`;
          }
        }
        if (scheduleCleanupError) {
          setAddBillError(`The bill change was confirmed, but its schedule update was not confirmed: ${scheduleCleanupError}.${pairingCleanupWarning ? ` ${pairingCleanupWarning}` : ''}`);
          return;
        }
      }
      if (!billWriteConfirmed) pairingCleanupWarning = 'The bill change is awaiting server confirmation. Its loan/bill link and schedule were preserved until that confirmation arrives.';
      if (onSaveIrregularBillSchedules) {
        const schedules = { ...(data.irregularBillScheduleByBillId ?? {}) };
        if (billFrequency === 'monthly') delete schedules[newBill.id];
        else schedules[newBill.id] = { ...schedules[newBill.id], frequency: billFrequency };
        await onSaveIrregularBillSchedules(schedules);
      }
      setNewBillName('');
      setNewBillAmount('');
      setNewBillCustomCategory('');
      setEditingBill(null);
      draftBillIdRef.current = null;
      delete draftBillPaidTodayRef.current[newBill.id];
      setShowAddBillModal(false);
      if (pairingCleanupWarning) Alert.alert('Bill saved', pairingCleanupWarning);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save recurring bill.';
      setAddBillError(`${billWriteConfirmed ? 'The bill change was confirmed, but follow-up settings could not be confirmed. ' : ''}${message}${pairingCleanupWarning ? ` ${pairingCleanupWarning}` : ''}`);
    } finally {
      billSaveBusyRef.current = false;
    }
  };

  const spendingMonthLabel = useMemo(
    () => SHORT_MONTH_YEAR_FMT.format(new Date(`${spendingMonth}-01T12:00:00`)),
    [spendingMonth],
  );
  const statusNotices = (
    <>
      {!canEdit ? (
        <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.tint }}>
          <Text style={[ui.small, { color: palette.text, fontWeight: '600' }]}>View-only access · You can inspect household income and budget categories, while edits are disabled for Viewers.</Text>
        </View>
      ) : null}

      {!!saveError && (
        <Text accessibilityRole="alert" style={ui.text}>
          {saveError}
        </Text>
      )}
    </>
  );

  const renderExpenseSegment = () => {
    const { cashOutflow, totalDebtPayments, unpaidCharges, netBalanceChange } = expenseSummary;
    const cashCategories = expenseSummary.cashBreakdown
      .filter(item => item.categoryKey !== 'charges' && item.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .map(item => ({
        ...item,
        details: expenseSummary.categories.find(category => category.categoryKey === item.categoryKey),
      }));
    const chargeCategory = expenseSummary.categories.find(category =>
      category.categoryKey === 'charges' && category.items.length > 0,
    );

    const expenseAccents = [
      getAppearancePalette(themeStyle, 'green', isLight).brand,
      getAppearancePalette(themeStyle, 'cobalt', isLight).brand,
      getAppearancePalette(themeStyle, 'amber', isLight).brand,
      getAppearancePalette(themeStyle, 'teal', isLight).brand,
      getAppearancePalette(themeStyle, 'cyan', isLight).brand,
      getAppearancePalette(themeStyle, 'indigo', isLight).brand,
      getAppearancePalette(themeStyle, 'violet', isLight).brand,
      getAppearancePalette(themeStyle, 'berry', isLight).brand,
      getAppearancePalette(themeStyle, 'coral', isLight).brand,
    ];
    const preferredAccentByCategory: Readonly<Record<string, string>> = {
      debt: expenseAccents[0],
      housing: expenseAccents[1],
      transportation: expenseAccents[2],
      utilities: expenseAccents[3],
      subscription: expenseAccents[6],
      insurance: expenseAccents[7],
      other_spending: expenseAccents[4],
      other_bill: expenseAccents[5],
    };
    const usedExpenseAccents = new Set<string>();
    const expenseColorByCategory = new Map<string, string>();
    for (const item of [...cashCategories].sort((a, b) => a.categoryKey.localeCompare(b.categoryKey))) {
      const preferred = preferredAccentByCategory[budgetCategoryKey(item.categoryKey)];
      const color = (preferred && !usedExpenseAccents.has(preferred) ? preferred : undefined)
        ?? expenseAccents.find(candidate => !usedExpenseAccents.has(candidate))
        ?? expenseAccents[usedExpenseAccents.size % expenseAccents.length];
      expenseColorByCategory.set(item.categoryKey, color);
      usedExpenseAccents.add(color);
    }

    const resolveExpenseTxDisplay = (tx: LedgerTransaction, accountOnly = false) => {
      const txDebt = tx.accountId ? allDebtById.get(tx.accountId) : undefined;
      const idBill = extractBillIdFromTxId(tx.id);
      const memoBills = extractBillIdsFromMemo(tx.memo);
      const txBill = (idBill ? allBillById.get(idBill) : undefined) ??
        [...memoBills].map(id => allBillById.get(id)).find(Boolean);
      const methodLabel = tx.accountId === null ? 'Checking / Debit' : (txDebt?.name ?? 'Account');
      const trimmedPayee = tx.payee.trim();
      const rowTitle = accountOnly ? methodLabel : txBill?.name
        ?? (trimmedPayee && !/^payment$/i.test(trimmedPayee) ? trimmedPayee : undefined)
        ?? txDebt?.name
        ?? (tx.accountId === null ? 'Checking / Debit' : 'Transaction');
      return { methodLabel, rowTitle };
    };

    const renderExpenseTransactions = (
      item: { categoryKey: string; items: readonly LedgerTransaction[] },
      paddingLeft = 40,
    ) => (
      <View style={{ paddingTop: 6, paddingLeft, paddingRight: 15 }}>
        {item.items.map(tx => {
          const accountOnly = item.categoryKey === 'debt' || item.categoryKey === 'charges';
          const { methodLabel, rowTitle } = resolveExpenseTxDisplay(tx, accountOnly);
          const dateLabel = formatShortDate(tx.date);
          const appliesTag = tx.appliesToDate && tx.appliesToDate.slice(0, 7) !== tx.date.slice(0, 7)
            ? ' · For ' + formatShortDate(tx.appliesToDate)
            : '';
          const rowDetail = (accountOnly ? dateLabel : methodLabel + ' · ' + dateLabel) + appliesTag;

          return (
            <Pressable
              key={tx.id}
              accessibilityRole={onOpenPurchase ? 'button' : undefined}
              accessibilityLabel={onOpenPurchase ? 'Open ' + rowTitle + ' transaction' : rowTitle}
              disabled={!onOpenPurchase}
              onPress={() => onOpenPurchase?.(tx.id)}
              style={[ui.row, ui.divider, { justifyContent: 'space-between', gap: 8 }]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={ui.text}>{rowTitle}</Text>
                <Text numberOfLines={1} style={ui.small}>{rowDetail}</Text>
              </View>
              <AmountText style={ui.value} value={formatCurrency(moneyToMajor(tx.amount), currencySymbol)} />
              {!accountOnly && onOpenPurchase ? <AppIcon name="chevronRight" size={14} color={palette.brand} /> : null}
            </Pressable>
          );
        })}
      </View>
    );

    const chartWidth = Math.max(240, Math.min(360, windowWidth - 48));
    const arcRadius = Math.min(92, (chartWidth - 40) / 2);
    const arcCenterX = chartWidth / 2;
    const arcCenterY = 102;
    const arcPath = (startAngle: number, endAngle: number) => {
      const startX = arcCenterX + arcRadius * Math.cos(startAngle);
      const startY = arcCenterY + arcRadius * Math.sin(startAngle);
      const endX = arcCenterX + arcRadius * Math.cos(endAngle);
      const endY = arcCenterY + arcRadius * Math.sin(endAngle);
      const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
      return 'M ' + startX.toFixed(2) + ' ' + startY.toFixed(2) +
        ' A ' + arcRadius.toFixed(2) + ' ' + arcRadius.toFixed(2) + ' 0 ' +
        largeArc + ' 1 ' + endX.toFixed(2) + ' ' + endY.toFixed(2);
    };
    const cashArcTotal = cashCategories.reduce((sum, item) => sum + item.amount, 0);
    let arcProgress = 0;
    const cashArcs = cashCategories.map(item => {
      const fraction = cashArcTotal > 0 ? item.amount / cashArcTotal : 0;
      const gap = cashCategories.length > 1 ? Math.min(0.018, Math.PI * fraction * 0.28) : 0;
      const startAngle = Math.PI + arcProgress * Math.PI + gap / 2;
      arcProgress = Math.min(1, arcProgress + fraction);
      const endAngle = Math.PI + arcProgress * Math.PI - gap / 2;
      return {
        categoryKey: item.categoryKey,
        color: expenseColorByCategory.get(item.categoryKey) ?? palette.brand,
        path: arcPath(startAngle, endAngle),
      };
    });

    const netBadgeText = netBalanceChange < 0
      ? 'Net ↓ ' + formatCurrency(Math.abs(netBalanceChange), currencySymbol)
      : netBalanceChange > 0
        ? 'Net ↑ +' + formatCurrency(netBalanceChange, currencySymbol)
        : 'Net ' + formatCurrency(0, currencySymbol);
    const netBadgeColor = netBalanceChange < 0 ? posInkColor : netBalanceChange > 0 ? negColor : palette.text;
    const netBadgeBackground = netBalanceChange < 0
      ? (isLight ? '#E8F6EF' : 'rgba(34,197,94,0.14)')
      : netBalanceChange > 0
        ? (isLight ? '#FFF0ED' : 'rgba(240,111,96,0.15)')
        : palette.raised;

    return (
      <>
        <View style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 18, backgroundColor: palette.raised, borderWidth: 1, borderColor: cardBorderColor }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous expense month" hitSlop={6} onPress={() => setSpendingMonth(getPreviousMonthString(spendingMonth))} style={{ minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name="chevronLeft" size={16} color={palette.brand} />
          </Pressable>
          <Text style={[ui.small, { color: palette.text, fontWeight: '700' }]}>{spendingMonthLabel}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next expense month" hitSlop={6} onPress={() => setSpendingMonth(getNextMonthString(spendingMonth))} style={{ minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name="chevronRight" size={16} color={palette.brand} />
          </Pressable>
        </View>
        {statusNotices}
        {(pairingAudit.divergentLinks.length > 0 || pairingAudit.invalidLinks.length > 0) ? (
          <View accessibilityRole="alert" style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#F5C563', backgroundColor: isLight ? '#FFF9E6' : 'rgba(245, 197, 99, 0.12)', gap: 4 }}>
            <Text style={[ui.small, { color: appearanceColor('#F5C563', isLight, accentColor, isInspire), fontWeight: '700' }]}>Legacy loan link review needed</Text>
            <Text style={[ui.small, { color: palette.text }]}>One or more legacy recurring bills differ from their linked loan account. Open Home → Legacy loan links to review before merging them.</Text>
          </View>
        ) : null}
        <Card style={{ paddingHorizontal: 0, paddingVertical: 12, borderRadius: 20, overflow: 'hidden', borderColor: cardBorderColor }}>
          <InspireCornerArt kind="hero-expense" borderRadius={20} />
          <View style={{ height: 118, alignItems: 'center', justifyContent: 'flex-start' }}>
            <Svg width={chartWidth} height={118} viewBox={'0 0 ' + chartWidth + ' 118'} accessible={false}>
              <Path d={arcPath(Math.PI, 2 * Math.PI)} fill="none" stroke={palette.raised} strokeWidth={18} strokeLinecap="butt" />
              {cashArcs.map(arc => (
                <Path key={arc.categoryKey} d={arc.path} fill="none" stroke={arc.color} strokeWidth={18} strokeLinecap="butt" />
              ))}
            </Svg>
            <View pointerEvents="none" style={{ position: 'absolute', top: 52, left: 0, right: 0, alignItems: 'center', gap: 1 }}>
              <Text style={{ fontSize: 11, lineHeight: 14, letterSpacing: 1.1, fontWeight: '800', color: palette.muted }}>CASH OUTFLOW</Text>
              <AmountText style={{ fontSize: 24, lineHeight: 30, fontWeight: '800', color: palette.text, maxWidth: Math.round((arcRadius - 12) * 1.85), textAlign: 'center' }} value={formatCurrency(cashOutflow, currencySymbol)} />
            </View>
          </View>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginHorizontal: 16, marginTop: 2, marginBottom: 2 }} />
          {cashCategories.length === 0 ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 18 }}>
              <Text style={ui.small}>{'No confirmed cash outflows recorded for ' + spendingMonthLabel + '.'}</Text>
            </View>
          ) : (
            cashCategories.map((item, index) => {
              const category = item.details;
              const color = expenseColorByCategory.get(item.categoryKey) ?? palette.brand;
              const isExpanded = expandedExpenseCategory === item.categoryKey;
              const drilldown = category ?? { categoryKey: item.categoryKey, items: [] as readonly LedgerTransaction[] };
              return (
                <View key={item.categoryKey} style={{ borderBottomWidth: index < cashCategories.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: palette.border, paddingVertical: 9, paddingHorizontal: 16, gap: 6 }}>
                  <Pressable accessibilityRole="button" accessibilityState={{ expanded: isExpanded }} accessibilityLabel={item.label + ', ' + (isExpanded ? 'hide' : 'show') + ' transactions'} onPress={() => setExpandedExpenseCategory(isExpanded ? null : item.categoryKey)} style={[ui.row, { justifyContent: 'space-between', gap: 8 }]}>
                    <View style={[ui.row, { gap: 9, flex: 1, minWidth: 0 }]}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[ui.heading, { fontSize: 16 }]} numberOfLines={1}>{category?.label ?? item.label}</Text>
                        <View style={[ui.row, { gap: 6, marginTop: 1, alignItems: 'center' }]}>
                          <Text numberOfLines={1} style={[ui.small, { flexShrink: 1 }]}>{category?.subtitle ?? 'Recorded transactions'}</Text>
                          {onSaveVariableCategoryCaps && canEdit && item.categoryKey !== 'debts' && item.categoryKey !== 'housing' && item.categoryKey !== 'auto' ? (
                            <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.label} cap`} hitSlop={6} onPress={() => { setCapKey(item.categoryKey); setCapAmount(data.variableCategoryCaps?.[item.categoryKey] != null ? String(data.variableCategoryCaps[item.categoryKey]) : ''); setCapError(''); }} style={{ paddingHorizontal: 7, paddingVertical: 1.5, borderRadius: 999, backgroundColor: palette.raised, borderWidth: 1, borderColor: palette.border }}>
                              <Text style={{ color: palette.brand, fontSize: 11, fontWeight: '700' }}>Cap</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', maxWidth: '42%', minWidth: 0 }}>
                      <AmountText style={[ui.value, { color: palette.text, textAlign: 'right' }]} value={formatCurrency(item.amount, currencySymbol)} />
                      <Text style={[ui.small, { color: palette.muted, marginTop: 2 }]}>{(cashOutflow > 0 ? Math.round((item.amount / cashOutflow) * 100) : 0) + '%'}</Text>
                    </View>
                    <AppIcon name={isExpanded ? 'chevronDown' : 'chevronRight'} size={15} color="#AAB3AD" />
                  </Pressable>
                  {data.variableCategoryCaps?.[item.categoryKey] != null && data.variableCategoryCaps[item.categoryKey] > 0 ? (() => {
                    const cap = data.variableCategoryCaps![item.categoryKey];
                    const remaining = cap - item.amount;
                    return <View style={{ gap: 4 }}><Text style={[ui.small, { color: remaining >= 0 ? posInkColor : '#F08B78' }]}>{`${formatCurrency(item.amount, currencySymbol)} / ${formatCurrency(cap, currencySymbol)} · ${remaining >= 0 ? formatCurrency(remaining, currencySymbol) + ' left' : '+' + formatCurrency(-remaining, currencySymbol)}`}</Text><View style={{ height: 6, borderRadius: 3, backgroundColor: palette.raised, overflow: 'hidden' }}><View style={{ height: '100%', width: `${Math.min(100, Math.max(0, item.amount / cap * 100))}%`, backgroundColor: remaining >= 0 ? posInkColor : '#F08B78' }} /></View></View>;
                  })() : null}
                  {isExpanded ? renderExpenseTransactions(drilldown) : null}
                </View>
              );
            })
          )}
        </Card>

        {expenseSummary.paidEarlyForMonth.length > 0 ? (
          <Card style={{ paddingHorizontal: 16, paddingVertical: 14, marginTop: 10, borderRadius: 20, gap: 6, borderColor: cardBorderColor }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingBottom: 4 }}>
              <Text style={{ fontSize: 11, letterSpacing: 1.1, fontWeight: '800', color: palette.muted }}>PAID EARLIER</Text>
              <Text numberOfLines={1} style={[ui.small, { color: palette.muted }]}>Counted in the month paid</Text>
            </View>
            {expenseSummary.paidEarlyForMonth.map((entry, index) => {
              const { tx } = entry;
              const { rowTitle } = resolveExpenseTxDisplay(tx);
              const detail = 'Paid ' + formatShortDate(tx.date) + ' · For ' + formatShortDate(tx.appliesToDate!);
              return (
                <Pressable
                  key={tx.id}
                  accessibilityRole={onOpenPurchase ? 'button' : undefined}
                  accessibilityLabel={onOpenPurchase ? 'Open ' + rowTitle + ' transaction' : rowTitle}
                  disabled={!onOpenPurchase}
                  onPress={() => onOpenPurchase?.(tx.id)}
                  style={[
                    ui.row,
                    {
                      justifyContent: 'space-between',
                      gap: 8,
                      paddingTop: index > 0 ? 8 : 2,
                      paddingBottom: index < expenseSummary.paidEarlyForMonth.length - 1 ? 4 : 0,
                      borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
                      borderTopColor: palette.border,
                    },
                  ]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={[ui.text, { color: palette.muted }]}>{rowTitle}</Text>
                    <Text numberOfLines={1} style={[ui.small, { color: palette.muted }]}>{detail}</Text>
                  </View>
                  <AmountText style={[ui.value, { color: palette.muted }]} value={formatCurrency(moneyToMajor(tx.amount), currencySymbol)} />
                  {onOpenPurchase ? <AppIcon name="chevronRight" size={14} color={palette.muted} /> : null}
                </Pressable>
              );
            })}
          </Card>
        ) : null}

        <Card style={{ paddingHorizontal: 16, paddingVertical: 16, marginTop: 10, borderRadius: 20, gap: 16, borderColor: cardBorderColor }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 12, letterSpacing: 1.1, fontWeight: '800', color: palette.muted }}>DEBT TUG-OF-WAR</Text>
            <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 15, backgroundColor: netBadgeBackground }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: netBadgeColor }}>{netBadgeText}</Text>
            </View>
          </View>
          <View style={{ height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: palette.raised, flexDirection: 'row', gap: 4 }}>
            {totalDebtPayments > 0 ? <View style={{ flex: totalDebtPayments, backgroundColor: posInkColor }} /> : null}
            {unpaidCharges > 0 ? <View style={{ flex: unpaidCharges, backgroundColor: negColor }} /> : null}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[ui.small, { color: palette.muted, fontWeight: '600' }]}>Paid to Debt</Text>
              <AmountText style={[ui.value, { color: posInkColor, marginTop: 3 }]} value={formatCurrency(totalDebtPayments, currencySymbol)} />
            </View>
            <Pressable accessibilityRole={chargeCategory ? 'button' : undefined} accessibilityState={chargeCategory ? { expanded: expandedExpenseCategory === 'charges' } : undefined} accessibilityLabel={chargeCategory ? 'New Card Charges, ' + (expandedExpenseCategory === 'charges' ? 'hide' : 'show') + ' transactions' : 'New Card Charges'} disabled={!chargeCategory} onPress={() => setExpandedExpenseCategory(expandedExpenseCategory === 'charges' ? null : 'charges')} style={{ flex: 1, minWidth: 0, alignItems: 'flex-end' }}>
              <Text style={[ui.small, { color: palette.muted, fontWeight: '600', textAlign: 'right' }]}>New Card Charges</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                <AmountText style={[ui.value, { color: negColor, textAlign: 'right' }]} value={(unpaidCharges > 0 ? '+' : '') + formatCurrency(unpaidCharges, currencySymbol)} />
                {chargeCategory ? <AppIcon name={expandedExpenseCategory === 'charges' ? 'chevronDown' : 'chevronRight'} size={14} color={negColor} /> : null}
              </View>
            </Pressable>
          </View>
          {chargeCategory && expandedExpenseCategory === 'charges' ? (
            <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, paddingTop: 8 }}>
              <Text style={[ui.small, { color: palette.muted, paddingHorizontal: 2 }]}>{chargeCategory.subtitle}</Text>
              {renderExpenseTransactions(chargeCategory, 0)}
            </View>
          ) : null}
        </Card>
        <View style={{ height: bottomInsetPadding(insets.bottom, 112) }} />
      </>
    );
  };

  return (
    <FinancialScreen
      title="Budget"
      segments={['Budget', 'Expense']}
      selected={budgetSection}
      onSelect={value => setBudgetSection(value === 'Expense' ? 'Expense' : 'Budget')}
      onSettings={onSettings}
      onAdd={!canEdit || showAddBillModal ? undefined : () => {
        setEditingBill(null);
        setBillFrequency('monthly');
        draftBillIdRef.current = Crypto.randomUUID();
        draftBillPaidTodayRef.current = {};
        setNewBillName('');
        setNewBillAmount('');
        setNewBillCustomCategory('');
        setNewBillDueDay('15');
        setNewBillCategory(null);
        setNewBillPaymentMethod('debit');
        setNewBillCreditAccountId(creditCards[0]?.id ?? '');
        setAddBillError('');
        setShowBillCategoryPicker(false);
        setShowBillDuePicker(false);
        setShowAddBillModal(true);
      }}
      addLabel="Add recurring expense"
      renderSegment={segment => (segment === 'Expense' ? renderExpenseSegment() : (
        <>
          {statusNotices}
          {/* Monthly Cashflow Overview */}
          <Card style={{ padding: 0, borderRadius: 20, overflow: 'hidden', borderColor: cardBorderColor }}>
            <InspireCornerArt kind="hero-budget" borderRadius={20} />
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: incomeExpanded }}
              accessibilityLabel={`Monthly Income, ${formatCurrency(income, currencySymbol)}`}
              accessibilityHint={incomeExpanded ? 'Hide income sources' : 'Show income sources'}
              onPress={() => setIncomeExpanded(value => !value)} style={{ padding: 16, gap: 12 }}>
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }]}>
                <View style={{ flexShrink: 1 }}>
                  <View style={[ui.row, { gap: 8, alignItems: 'center', flexWrap: 'wrap' }]}>
                    <Text style={[ui.small, { fontSize: 14, fontWeight: '600' }]}>Monthly Income</Text>
                    <View style={[ui.row, { gap: 4, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }]}>
                      <AppIcon name={incomeExpanded ? 'chevronDown' : canEdit ? 'edit' : 'chevronRight'} size={12} color={palette.text} />
                      <Text style={{ color: palette.text, fontSize: 12, fontWeight: '700' }}>
                        {incomeExpanded ? 'Done' : canEdit ? 'Edit income' : 'View sources'}
                      </Text>
                    </View>
                  </View>
                  <AmountText style={[ui.title, { fontSize: 36, marginTop: 2, letterSpacing: -1 }]} value={formatCurrency(income, currencySymbol)} />
                </View>
                <InspireQuote slot="budgetIncome" tiltDeg={-3} style={{ textAlign: 'right', maxWidth: 145, paddingTop: 4 }} />
              </View>

              {(() => {
                if (budgetUnresolved) return <View accessibilityRole="alert" style={{ gap: 6 }}><Text style={ui.heading}>Budget and available amount unavailable</Text><Text style={ui.small}>Resolve the saved loan identities on Home to calculate these totals without counting the same obligation twice.</Text></View>;
                const freePercent = income > 0 ? (cashflow.remainingFreeCashflow / income) * 100 : 0;
                 const isCritical = cashflow.isDeficit;
                const isTight = !isCritical && freePercent <= 30;
                const discretionaryColor = isCritical ? negColor : isTight ? appearanceColor('#F5C563', isLight, accentColor, isInspire) : posInkColor;
                const barSegments = [
                  ...displayBreakdown.filter(item => item.amount > 0).map(item => ({
                    percent: Math.max(income, cashflow.totalCommitments) > 0 ? (item.amount / Math.max(income, cashflow.totalCommitments)) * 100 : 0,
                    color: appearanceColor(budgetCategoryColor(item.categoryKey), isLight, accentColor, isInspire),
                  })),
                  ...(cashflow.remainingFreeCashflow > 0 && income > 0 ? [{
                    percent: (cashflow.remainingFreeCashflow / Math.max(income, cashflow.totalCommitments)) * 100,
                    color: discretionaryColor,
                  }] : []),
                ];

                return <>
                  <MultiBar segments={barSegments} />
                  <View style={[ui.row, { marginTop: 0, alignItems: 'stretch' }]}>
                    <View style={{ flex: 1, justifyContent: 'center' }}>
                      <Text style={[ui.small, { fontSize: 14, fontWeight: '600' }]}>Budget</Text>
                      <AmountText style={[ui.heading, { fontSize: 21, fontWeight: '800', marginTop: 2 }]} value={formatCurrency(cashflow.totalCommitments, currencySymbol)} />
                    </View>
                    <View style={{ width: 1, backgroundColor: palette.border, marginHorizontal: 12 }} />
                    <View style={[
                      { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
                      isCritical
                        ? { backgroundColor: isLight ? '#FFF0EB' : 'rgba(240, 139, 120, 0.12)', borderWidth: 1, borderColor: isLight ? '#F5C5B8' : 'rgba(240, 139, 120, 0.35)' }
                        : isTight
                          ? { backgroundColor: isLight ? '#FFF9E6' : 'rgba(245, 197, 99, 0.12)', borderWidth: 1, borderColor: isLight ? '#F7DE9C' : 'rgba(245, 197, 99, 0.35)' }
                          : { backgroundColor: isLight ? '#E6F4F0' : 'rgba(118, 220, 185, 0.12)', borderWidth: 1, borderColor: isLight ? '#A3D9C9' : 'rgba(118, 220, 185, 0.35)' }
                    ]}>
                       <Text style={[ui.small, { color: palette.text, fontSize: 14, fontWeight: '700' }]}>
                        {cashflow.isDeficit ? 'Over budget' : 'Available'}
                      </Text>
                      <AmountText style={[ui.heading, { color: discretionaryColor, fontSize: 21, fontWeight: '800', marginTop: 2 }]} value={formatCurrency(cashflow.remainingFreeCashflow, currencySymbol)} />
                    </View>
                  </View>
                </>;
              })()}
            </Pressable>

            {incomeExpanded ? (
              <View style={{ borderTopWidth: 1, borderTopColor: palette.border, marginHorizontal: 16, paddingTop: 10, paddingBottom: 16, gap: 4 }}>
                <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', minHeight: 40 }]}>
                  <Text style={[ui.heading, { fontSize: 15 }]}>Income sources</Text>
                  {canEdit ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="Add income source" onPress={() => openIncomeEditor()} style={ui.button}>
                      <Text style={[ui.buttonText, { color: palette.brand }]}>Add income</Text>
                    </Pressable>
                  ) : null}
                </View>
                {incomes.map(i => (
                  <Pressable key={i.id} accessibilityRole="button" accessibilityLabel={canEdit ? `Edit ${i.name}` : i.name} disabled={!canEdit} onPress={() => { if (canEdit) openIncomeEditor(i.id); }} style={[ui.divider, ui.row, { justifyContent: 'space-between', gap: 10 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={ui.text}>{i.name}</Text>
                      <Text style={ui.small}>
                        {`${formatCurrency(i.amount, currencySymbol)} · ${
                          PAY_FREQUENCY_OPTIONS.find(o => o.value === i.frequency)?.label
                        }`}
                      </Text>
                      {i.grossAmount != null ? <Text style={ui.small}>{`Gross ${formatCurrency(normalizeMonthlyIncome(i.grossAmount, i.frequency, currencyCode), currencySymbol)}`}</Text> : null}
                    </View>
                    <View style={[ui.row, { gap: 8, alignItems: 'center', maxWidth: '54%' }]}>
                      <AmountText style={[ui.value, { textAlign: 'right' }]} value={formatCurrency(normalizeMonthlyIncome(i.amount, i.frequency, currencyCode), currencySymbol)} />
                      {canEdit ? <AppIcon name="edit" size={14} color={palette.brand} /> : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Card>


          {(pairingAudit.divergentLinks.length > 0 || pairingAudit.invalidLinks.length > 0) ? (
            <View accessibilityRole="alert" style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#F5C563', backgroundColor: isLight ? '#FFF9E6' : 'rgba(245, 197, 99, 0.12)', gap: 4 }}>
              <Text style={[ui.small, { color: appearanceColor('#F5C563', isLight, accentColor, isInspire), fontWeight: '700' }]}>
                Legacy loan link review needed
              </Text>
              <Text style={[ui.small, { color: palette.text }]}>
                One or more legacy recurring bills differ from their linked loan account. Open Home → Legacy loan links to review before merging them.
              </Text>
            </View>
          ) : null}

          {/* Category Budget Breakdown */}
          <Card style={{ paddingHorizontal: 0, paddingTop: 14, paddingBottom: 6, borderRadius: 20, gap: 0, borderColor: cardBorderColor }}>
            <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={ui.heading}>Budget breakdown</Text>
              </View>
              <View style={[ui.row, { gap: 0 }]}>
                <Pressable accessibilityRole="button" accessibilityLabel="Previous spending month" onPress={() => setSpendingMonth(getPreviousMonthString(spendingMonth))} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><AppIcon name="chevronLeft" size={16} color={palette.brand} /></Pressable>
                <Text style={[ui.small, { color: palette.text, fontWeight: '600' }]}>{spendingMonthLabel}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Next spending month" onPress={() => setSpendingMonth(getNextMonthString(spendingMonth))} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><AppIcon name="chevronRight" size={16} color={palette.brand} /></Pressable>
              </View>
            </View>
            {/* Row event handlers call save functions after a tap; they do not read refs during render. */}
            {displayBreakdown.map((item, idx) => {
              const key = budgetCategoryKey(item.categoryKey);
              const isDebt = key === 'debt';
              const isHousing = key === 'housing';
              const isTransport = key === 'transportation' || key === 'auto';
              const isUtilities = key === 'utilities';
              const isSubscription = key === 'subscription';
              const isInsurance = key === 'insurance';

              const customCategoryKey = item.categoryKey.startsWith('custom:') ? item.categoryKey.slice('custom:'.length) : null;
              const categoryBills = !isDebt
                ? activeRecurringBills.filter(bill => {
                    if (!bill.active) return false;
                    const label = data.recurringBillCategoryLabelByBillId?.[bill.id]?.trim();
                    if (customCategoryKey !== null) {
                      const lower = label?.toLocaleLowerCase();
                      return bill.category === 'other_bill' && (
                        lower === customCategoryKey ||
                        (customCategoryKey === 'transportation' && lower === 'auto')
                      );
                    }
                    return bill.category === item.categoryKey && !label;
                  })
                : [];
              const matchingUnifiedLoans = !isDebt
                ? unifiedLoans.filter(loan => unifiedLoanBudgetCategory(loan.category) === item.categoryKey)
                : [];

              const icon: AppIconName =
                isDebt
                  ? 'creditCard'
                  : isHousing
                    ? 'homeLoan'
                    : isTransport
                      ? 'auto'
                      : isSubscription
                        ? 'creditCard'
                        : isUtilities
                          ? 'bolt'
                          : isInsurance
                            ? 'shield'
                            : 'calendar';

              const catColor = appearanceColor(budgetCategoryColor(item.categoryKey), isLight, accentColor, isInspire);

              return (
                <View key={item.categoryKey} style={{ borderBottomWidth: idx < displayBreakdown.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: palette.border, paddingVertical: 12, paddingHorizontal: 16, gap: 9 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: expandedCategory === item.categoryKey }}
                    accessibilityLabel={`${item.label}, ${expandedCategory === item.categoryKey ? 'hide' : 'show'} line items`}
                    onPress={() => setExpandedCategory(expandedCategory === item.categoryKey ? null : item.categoryKey)}
                    style={[ui.row, { justifyContent: 'space-between', gap: 8 }]}
                  >
                    <View style={[ui.row, { gap: 8, flex: 1 }]}>
                      <View style={[ui.iconCircle, { width: 34, height: 34, borderRadius: 17, borderWidth: 0, backgroundColor: catColor + '18' }]}>
                        <AppIcon name={icon} size={18} color={catColor} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={[ui.row, { gap: 6, alignItems: 'center', flexWrap: 'nowrap' }]}>
                          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} ellipsizeMode="tail" style={[ui.heading, { fontSize: 16, flexShrink: 1 }]}>{item.label}</Text>
                          <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: catColor + '18', flexShrink: 0 }}>
                            <Text numberOfLines={1} style={[ui.small, { color: catColor, fontWeight: '700', fontSize: 12 }]}>{budgetUnresolved ? 'N/A' : `${item.percentOfIncome}%`}</Text>
                          </View>
                        </View>
                        <Text numberOfLines={1} style={ui.small}>
                            {isDebt
                              ? 'Minimum + extra'
                              : item.count > 0
                                ? (matchingUnifiedLoans.length > 0
                                    ? `${item.count} active ${item.count === 1 ? 'item' : 'items'}`
                                    : `${item.count} active bill${item.count > 1 ? 's' : ''}`)
                                : 'No bills added yet · tap + to add one'}
                        </Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                      <AmountText style={[ui.value, { color: catColor, textAlign: 'right' }]} value={budgetUnresolved ? 'Review needed' : formatCurrency(item.amount, currencySymbol)} />
                    </View>
                    <AppIcon name={expandedCategory === item.categoryKey ? 'chevronDown' : 'chevronRight'} size={15} color="#AAB3AD" />
                  </Pressable>

                  <View
                    accessibilityLabel={budgetUnresolved ? 'Percentage unavailable until loan review' : item.label + ': ' + item.percentOfIncome + '% of income'}
                    style={{
                      height: 9,
                      borderRadius: 5,
                      overflow: 'hidden',
                      backgroundColor: palette.raised,
                      borderWidth: graphOutlineColor ? 1 : 0,
                      borderColor: graphOutlineColor,
                    }}
                  >
                    <View style={{ height: '100%', borderRadius: 5, backgroundColor: catColor, width: budgetUnresolved ? '0%' : `${Math.max(0, Math.min(100, item.percentOfIncome))}%` }} />
                  </View>

                  {expandedCategory === item.categoryKey ? (
                    <View style={{ paddingTop: 6, paddingLeft: 40, paddingRight: 15 }}>
                      {isDebt ? (
                        <>
                          {debtCommitment.accounts.map(debt => (
                            <Pressable
                              key={debt.id}
                              accessibilityRole={canEdit && onEditDebt ? 'button' : undefined}
                              accessibilityLabel={canEdit && onEditDebt ? `Edit ${debt.name}` : debt.name}
                              disabled={!canEdit || !onEditDebt}
                              onPress={() => { if (canEdit && onEditDebt) onEditDebt(debt.id); }}
                              style={[ui.row, ui.divider, { justifyContent: 'space-between', gap: 8 }]}
                            >
                               <View style={{ flex: 1 }}>
                                 <Text style={ui.text}>{debt.name}</Text>
                                 {paidObligations?.has(obligationScheduleKey('debt', debt.id)) ? <Text style={[ui.small, { color: posInkColor, fontWeight: '800' }]}>Paid</Text> : null}
                               </View>
                              <View style={[ui.row, { gap: 8, alignItems: 'center' }]}>
                                <AmountText style={ui.value} value={formatCurrency(debt.minimumPayment, currencySymbol)} />
                                {canEdit && onEditDebt ? <AppIcon name="edit" size={14} color={palette.brand} /> : null}
                              </View>
                            </Pressable>
                          ))}
                          <Pressable
                            accessibilityRole={canEdit && onOpenStrategy ? 'button' : undefined}
                            accessibilityLabel={canEdit && onOpenStrategy ? 'Edit extra monthly payment' : 'Extra monthly payment'}
                            disabled={!canEdit || !onOpenStrategy}
                            onPress={() => { if (canEdit && onOpenStrategy) onOpenStrategy(); }}
                            style={[ui.row, { justifyContent: 'space-between', paddingVertical: 8, gap: 8 }]}
                          >
                            <View style={{ flex: 1 }}><Text style={ui.text}>Extra monthly payment</Text><Text style={ui.small}>Added to minimum payments</Text></View>
                            <View style={[ui.row, { gap: 8, alignItems: 'center' }]}>
                              <Text style={ui.value}>{formatCurrency(debtCommitment.extra, currencySymbol)}</Text>
                              {canEdit && onOpenStrategy ? <AppIcon name="edit" size={14} color={palette.brand} /> : null}
                            </View>
                          </Pressable>
                          {!debtCommitment.accounts.length ? <Text style={ui.small}>No active cards or loans with balances.</Text> : null}
                        </>
                      ) : (
                        <>
                          {!matchingUnifiedLoans.length && !categoryBills.length ? (
                            <Text style={ui.small}>No active line items.</Text>
                          ) : null}
                          {matchingUnifiedLoans.map(loan => {
                            const editHandler = canEdit ? (onEditLoan ? () => onEditLoan(loan) : onEditDebt ? () => onEditDebt(loan.id) : undefined) : undefined;
                            return (
                              <Pressable
                                key={`loan:${loan.id}`}
                                accessibilityRole={editHandler ? 'button' : undefined}
                                accessibilityLabel={editHandler ? `Edit ${loan.name}` : loan.name}
                                disabled={!editHandler}
                                onPress={editHandler}
                                style={[ui.row, ui.divider, { justifyContent: 'space-between', gap: 8 }]}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text style={ui.text}>{loan.name}</Text>
                                  <Text style={ui.small}>
                                    {loan.dueDay !== null ? `Due day ${loan.dueDay}` : 'Due day not set'}
                                  </Text>
                                  {paidObligations?.has(obligationScheduleKey('debt', loan.id)) ? <Text style={[ui.small, { color: posInkColor, fontWeight: '800' }]}>Paid</Text> : null}
                                </View>
                                <View style={[ui.row, { gap: 8, alignItems: 'center' }]}>
                                  <AmountText style={ui.value} value={formatCurrency(loan.minimumPayment, currencySymbol)} />
                                  {editHandler ? <AppIcon name="edit" size={14} color={palette.brand} /> : null}
                                </View>
                              </Pressable>
                            );
                          })}
                          {categoryBills.map(bill => (
                            <Pressable
                              key={bill.id}
                              accessibilityRole={canEdit ? 'button' : undefined}
                              accessibilityLabel={canEdit ? `Edit ${bill.name}` : bill.name}
                              disabled={!canEdit}
                              onPress={() => { if (canEdit) openBillEditor(bill); }}
                              style={[ui.row, ui.divider, { justifyContent: 'space-between', gap: 8 }]}
                            >
                              <View style={{ flex: 1 }}>
                                <Text style={ui.text}>{bill.name}</Text>
                                <Text style={ui.small}>
                                  {`Due day ${bill.dueDay} · ${bill.paymentMethod === 'credit' ? cardNames.get(bill.creditAccountId ?? '') ?? 'Card unavailable' : 'Checking / Debit'}`}
                                </Text>
                                {paidObligations?.has(obligationScheduleKey('bill', bill.id)) ? <Text style={[ui.small, { color: posInkColor, fontWeight: '800' }]}>Paid</Text> : null}
                              </View>
                              <View style={[ui.row, { gap: 8, alignItems: 'center' }]}>
                                <View><Text style={ui.value}>{formatCurrency(moneyToMajor(bill.amount), currencySymbol)}</Text>{data.irregularBillScheduleByBillId?.[bill.id]?.frequency && data.irregularBillScheduleByBillId[bill.id].frequency !== 'monthly' ? <Text style={ui.small}>{formatCurrency(moneyToMajor(calculateBillMonthlyReserve(bill.amount, data.irregularBillScheduleByBillId[bill.id].frequency)), currencySymbol)}/mo reserve</Text> : null}</View>
                                {canEdit ? <AppIcon name="edit" size={14} color={palette.brand} /> : null}
                              </View>
                            </Pressable>
                          ))}
                        </>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
            <InspireQuote slot="budgetFooter" color="#0B89A8" style={{ textAlign: 'center', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 }} />
          </Card>
          {annualFeeReserve.totalAnnualFees > 0 ? (
            <Card style={{ paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16, gap: 4, borderColor: cardBorderColor }}>
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 10 }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[ui.heading, { fontSize: 15 }]}>Annual card fee reserve</Text>
                  <Text style={ui.small}>
                    {`${annualFeeReserve.cardCount} ${annualFeeReserve.cardCount === 1 ? 'card' : 'cards'} · ${formatCurrency(annualFeeReserve.totalAnnualFees, currencySymbol)}/yr annualized`}
                  </Text>
                </View>
                <AmountText
                  style={[ui.value, { fontSize: 16, color: palette.brand }]}
                  value={`${formatCurrency(annualFeeReserve.monthlySinkingReserve, currencySymbol)}/mo`}
                />
              </View>
            </Card>
          ) : null}
        </>
      ))}
    >
      {/* Add recurring spending modal */}
      {(() => {
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
        const parsedBillDueDay = Number.isInteger(Number(newBillDueDay)) && Number(newBillDueDay) >= 1 && Number(newBillDueDay) <= 31
          ? Number(newBillDueDay)
          : null;
        const selectedBillCategoryLabel = BILL_CATEGORIES.find(option => option.value === newBillCategory)?.label;
        const suggestedCustomLabels = reusableCustomCategoryLabels
          .filter(label => label.toLocaleLowerCase() !== newBillCustomCategory.trim().toLocaleLowerCase())
          .slice(0, 6);

        return (
          <>
            <SheetModal
              visible={showAddBillModal}
              onClose={closeBillModal}
              contentSized
              closeLabel="Close recurring item editor"
              footer={(
                <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface, gap: 8 }}>
                  {!!addBillError ? (
                    <Text accessibilityRole="alert" style={[ui.small, { color: '#F08B78', textAlign: 'center' }]}>
                      {addBillError}
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save recurring bill"
                    onPress={handleSaveBill}
                    style={{
                      minHeight: 48,
                      borderRadius: 12,
                      backgroundColor: ctaBg,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: ctaFg, fontSize: 15, fontWeight: '700' }}>Save</Text>
                  </Pressable>
                </View>
              )}
            >
              <View style={{ gap: 14 }}>
                <SheetFormHeader
                  centered
                  title={editingBill ? 'Edit recurring spending' : 'Add recurring spending'}
                  subtitle={currencyCode}
                  closeLabel="Close recurring item editor"
                  onClose={closeBillModal}
                />

                <View style={groupedCardStyle}>
                  <View style={[rowStyle, rowBorderStyle]}>
                    <Text style={[ui.text, { color: palette.muted }]}>Name *</Text>
                    <TextInput
                      accessibilityLabel="Bill name"
                      style={[inlineInputStyle, { flex: 1, minWidth: 120 }]}
                      placeholder="e.g. Electric bill"
                      placeholderTextColor={palette.muted}
                      value={newBillName}
                      onChangeText={setNewBillName}
                    />
                  </View>

                  <View style={[rowStyle, rowBorderStyle]}>
                    <Text style={[ui.text, { color: palette.muted }]}>Amount *</Text>
                    <View style={[ui.row, { flex: 1, justifyContent: 'flex-end', gap: 4 }]}>
                      <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>{currencySymbol}</Text>
                      <TextInput
                        accessibilityLabel="Bill amount"
                        style={[inlineInputStyle, { flex: 1, minWidth: 90 }]}
                        placeholder="0.00"
                        placeholderTextColor={palette.muted}
                        keyboardType="decimal-pad"
                        value={newBillAmount}
                        onChangeText={t => setNewBillAmount(prev => acceptMoneyEdit(prev, t, currencyCode))}
                      />
                    </View>
                  </View>

                  {onSaveIrregularBillSchedules ? <View style={[rowStyle, rowBorderStyle, { flexWrap: 'wrap', gap: 8 }]}><Text style={[ui.text, { color: palette.muted }]}>Frequency</Text><View style={[ui.row, { gap: 6, flexWrap: 'wrap' }]}>{([['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['semiannual', '6 mo'], ['annual', 'Annual']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: billFrequency === value }} onPress={() => setBillFrequency(value)} style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12, backgroundColor: billFrequency === value ? palette.brand : palette.raised }}><Text style={[ui.small, { color: billFrequency === value ? ctaFg : palette.text }]}>{label}</Text></Pressable>)}</View></View> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={selectedBillCategoryLabel ? `Category: ${selectedBillCategoryLabel}` : 'Category: Choose category'}
                    onPress={() => {
                      Keyboard.dismiss();
                      setShowBillCategoryPicker(true);
                    }}
                    style={[rowStyle, rowBorderStyle]}
                  >
                    <Text style={[ui.text, { color: palette.muted }]}>Category *</Text>
                    <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                      <Text style={[ui.text, { color: selectedBillCategoryLabel ? palette.text : palette.brand, fontWeight: '600' }]}>
                        {selectedBillCategoryLabel ?? 'Choose category'}
                      </Text>
                      <AppIcon name="chevronDown" size={16} color={palette.brand} />
                    </View>
                  </Pressable>

                  {newBillCategory === 'other_bill' ? (
                    <View style={[{ paddingVertical: 8, gap: 8 }, rowBorderStyle]}>
                      <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 12 }]}>
                        <Text style={[ui.text, { color: palette.muted }]}>Custom category *</Text>
                        <TextInput
                          accessibilityLabel="Custom recurring spending category"
                          style={[inlineInputStyle, { flex: 1, minWidth: 110 }]}
                          placeholder="e.g. Auto"
                          placeholderTextColor={palette.muted}
                          maxLength={40}
                          value={newBillCustomCategory}
                          onChangeText={setNewBillCustomCategory}
                        />
                      </View>
                      {suggestedCustomLabels.length ? (
                        <View style={[ui.row, { flexWrap: 'wrap', gap: 6 }]}>
                          {suggestedCustomLabels.map(label => (
                            <Pressable
                              key={label.toLocaleLowerCase()}
                              accessibilityRole="button"
                              accessibilityLabel={`Reuse ${label} category`}
                              onPress={() => setNewBillCustomCategory(label)}
                              style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: palette.tint, borderWidth: 1, borderColor: palette.border }}
                            >
                              <Text style={[ui.small, { color: palette.brand, fontWeight: '600' }]}>{label}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={rowBorderStyle}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={parsedBillDueDay ? `Due day: Day ${parsedBillDueDay}` : 'Due day: Choose day'}
                      onPress={() => {
                        Keyboard.dismiss();
                        setShowBillDuePicker(true);
                      }}
                      style={rowStyle}
                    >
                      <Text style={[ui.text, { color: palette.muted }]}>Due day *</Text>
                      <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                        <Text style={[ui.text, { color: parsedBillDueDay ? palette.text : palette.brand, fontWeight: '600' }]}>
                          {parsedBillDueDay ? `Day ${parsedBillDueDay}` : 'Choose day'}
                        </Text>
                        <AppIcon name="calendar" size={16} color={palette.brand} />
                      </View>
                    </Pressable>
                    {!editingBill && parsedBillDueDay !== null ? (
                      <Text style={[ui.small, { color: palette.muted, paddingBottom: 10 }]}>
                        {`First due date: ${obligationFirstDueDate(parsedBillDueDay, currentHouseholdDate(effectiveTimeZone), currencyCode)}`}
                      </Text>
                    ) : null}
                  </View>

                  <View style={[rowStyle, newBillPaymentMethod === 'credit' ? rowBorderStyle : undefined]}>
                    <Text style={[ui.text, { color: palette.muted }]}>Paid with *</Text>
                    <View style={[ui.row, { gap: 4, padding: 3, borderRadius: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }]}>
                      {([
                        { value: 'debit', label: 'Debit', a11y: 'Checking / Debit' },
                        { value: 'credit', label: 'Credit card', a11y: 'Credit card' },
                      ] as const).map(option => {
                        const active = newBillPaymentMethod === option.value;
                        return (
                          <Pressable
                            key={option.value}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={option.a11y}
                            onPress={() => {
                              setNewBillPaymentMethod(option.value);
                              if (option.value === 'credit' && !creditCards.some(cc => cc.id === newBillCreditAccountId)) {
                                setNewBillCreditAccountId(creditCards[0]?.id ?? '');
                              }
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
                              {option.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  {newBillPaymentMethod === 'credit' ? (
                    <View style={{ paddingVertical: 10 }}>
                      {creditCards.length > 0 ? (
                        <SelectDropdown
                          label="Charge to Credit Card *"
                          sheetTitle="Select Credit Card"
                          value={newBillCreditAccountId}
                          options={creditCards.map(cc => ({
                            value: cc.id,
                            label: cc.name,
                            subtitle: `Balance: ${formatCurrency(cc.balance, currencySymbol)}`,
                            icon: 'creditCard',
                          }))}
                          onSelect={setNewBillCreditAccountId}
                        />
                      ) : (
                        <Text style={[ui.small, { color: '#F08B78' }]}>
                          No credit cards entered yet. Add one in the Accounts tab first.
                        </Text>
                      )}
                    </View>
                  ) : null}
                </View>

                {editingBill && (() => {
                  const linkedDebtId = Object.entries(data.loanBillPairingByDebtId ?? {}).find(([, relation]) => relation?.status === 'linked' && relation.billId === editingBill.id)?.[0];
                  const linkedDebt = linkedDebtId ? data.debts.find(debt => debt.id === linkedDebtId) : undefined;
                  if (!linkedDebtId) return null;
                  return (
                    <View style={[groupedCardStyle, { paddingVertical: 12, gap: 6 }]}>
                      <Text style={ui.heading}>Loan payment link</Text>
                      <Text style={ui.small}>{linkedDebt ? `${linkedDebt.name} · ${linkedDebt.category} · minimum ${formatCurrency(linkedDebt.minimumPayment, currencySymbol)} / month` : 'This recurring item has a saved loan link whose account is unavailable.'}</Text>
                      <Text style={ui.small}>This link changes Budget commitment/reminder grouping only. It does not create a payment or change a debt balance.</Text>

                    </View>
                  );
                })()}

                {editingBill && onDeleteRecurringBill ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`End recurring item ${editingBill.name}`}
                    onPress={() => requestEndBill(editingBill)}
                    style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ color: '#F08B78', fontSize: 15, fontWeight: '600', textAlign: 'center' }}>End recurring item</Text>
                  </Pressable>
                ) : null}

                <AdaptiveModal visible={showBillCategoryPicker} transparent animationType="fade" onRequestClose={() => setShowBillCategoryPicker(false)}>
                  <TouchableWithoutFeedback onPress={() => setShowBillCategoryPicker(false)}>
                    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }}>
                      <TouchableWithoutFeedback>
                        <View style={{ backgroundColor: palette.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: palette.border, maxHeight: '72%', paddingBottom: bottomInsetPadding(insets.bottom, 16) }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: palette.border }}>
                            <Text style={{ fontSize: 17, fontWeight: '700', color: palette.text }}>Select Category</Text>
                            <Pressable accessibilityRole="button" accessibilityLabel="Close picker" onPress={() => setShowBillCategoryPicker(false)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                              <AppIcon name="close" size={20} color={palette.muted} />
                            </Pressable>
                          </View>
                          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ padding: 16, gap: 6 }} keyboardShouldPersistTaps="handled">
                             {[...(!editingBill && onAddLoan ? LOAN_CATEGORIES : []), ...BILL_CATEGORIES].map(option => {
                              const selected = option.value === newBillCategory;
                              return (
                                <Pressable
                                  key={option.value}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected }}
                                  onPress={() => {
                                     const category = option.value;
                                     if (category === 'Mortgage' || category === 'Auto loan') {
                                       closeBillModal();
                                       onAddLoan?.(category, {
                                         name: newBillName.trim(),
                                         minimumPayment: newBillAmount.trim(),
                                         dueDay: newBillDueDay.trim(),
                                       });
                                       return;
                                     }
                                     setNewBillCategory(category);
                                    setShowBillCategoryPicker(false);
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
                                    <AppIcon name={option.icon ?? 'calendar'} size={18} color={selected ? palette.brand : palette.muted} />
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
                  visible={showBillDuePicker}
                  value={parsedBillDueDay}
                  title="Select due day"
                  subtitle="Monthly recurring due date"
                  onSelect={day => {
                    if (day !== null) setNewBillDueDay(String(day));
                  }}
                  onClose={() => setShowBillDuePicker(false)}
                />
              </View>
            </SheetModal>
          </>
        );
      })()}

      <SheetModal visible={capKey !== null} onClose={() => setCapKey(null)} contentSized>
        <View style={{ gap: 10 }}><SheetFormHeader title="Monthly cap" closeLabel="Close cap editor" onClose={() => setCapKey(null)} /><TextInput accessibilityLabel="Monthly cap amount" style={[ui.input, { flex: 0 }]} keyboardType="decimal-pad" value={capAmount} onChangeText={value => setCapAmount(previous => acceptMoneyEdit(previous, value, currencyCode))} placeholder="0.00" placeholderTextColor={palette.muted} />{capError ? <Text accessibilityRole="alert" style={[ui.small, { color: '#F08B78' }]}>{capError}</Text> : null}<Pressable accessibilityRole="button" disabled={capBusy} onPress={() => { void (async () => { if (!capKey || !onSaveVariableCategoryCaps) return; const amount = capAmount.trim() ? parseMoneyInput(capAmount, currencyCode) : 0; if (amount == null || !Number.isFinite(amount) || amount < 0) { setCapError('Enter a valid amount.'); return; } setCapBusy(true); try { const caps = { ...(data.variableCategoryCaps ?? {}) }; if (amount === 0) delete caps[capKey]; else caps[capKey] = amount; await onSaveVariableCategoryCaps(caps); setCapKey(null); } catch (error) { setCapError(error instanceof Error ? error.message : 'Unable to save cap.'); } finally { setCapBusy(false); } })(); }} style={[ui.button, { alignItems: 'center' }]}><Text style={ui.buttonText}>{capBusy ? 'Saving?' : 'Save'}</Text></Pressable></View>
      </SheetModal>
      <SheetModal visible={showIncomeModal} onClose={() => setShowIncomeModal(false)} contentSized>
        <View style={{ gap: 8 }}>
          <SheetFormHeader title={incomeEditorId === 'new' ? 'Add income' : 'Edit income'}
            closeLabel="Close income editor" onClose={() => setShowIncomeModal(false)} />
            <Text style={ui.small}>Income source name *</Text>
            <TextInput accessibilityLabel="Income source name" style={[ui.input, { flex: 0 }]} value={incomeName} onChangeText={setIncomeName} maxLength={512} placeholder="Salary, side income" placeholderTextColor="#6E7571" />
          <Text style={ui.small}>{`Amount per pay period (${currencySymbol}) *`}</Text>
          <TextInput accessibilityLabel="Income amount" style={[ui.input, { flex: 0 }]} keyboardType="decimal-pad" value={incomeAmount} onChangeText={value => setIncomeAmount(previous => acceptMoneyEdit(previous, value, currencyCode))} placeholder="0.00" placeholderTextColor="#6E7571" />
          <Text style={ui.small}>Pay frequency *</Text>
          <SelectDropdown accessibilityLabel="Pay frequency" sheetTitle="Select pay frequency" placeholder="Select frequency" value={incomeFrequency} options={PAY_FREQUENCY_OPTIONS.map(option => ({ value: option.value, label: option.label }))} onSelect={setIncomeFrequency} />
          <Text style={ui.small}>{`Gross amount per pay period (${currencySymbol}) · optional`}</Text>
          <TextInput accessibilityLabel="Gross income amount" style={[ui.input, { flex: 0 }]} keyboardType="decimal-pad" value={incomeGrossAmount} onChangeText={value => setIncomeGrossAmount(previous => acceptMoneyEdit(previous, value, currencyCode))} placeholder="Before taxes and deductions" placeholderTextColor="#6E7571" />
          {incomeFrequency ? <View style={[ui.row, { justifyContent: 'space-between', paddingVertical: 6 }]}><Text style={ui.small}>Monthly equivalent</Text><Text style={[ui.small, { color: palette.text, fontWeight: '600' }]}>{formatCurrency(normalizeMonthlyIncome(parseMoneyInput(incomeAmount, currencyCode) || 0, incomeFrequency, currencyCode), currencySymbol)}</Text></View> : null}
          {!!addBillError ? <Text accessibilityRole="alert" style={[ui.small, { color: '#F08B78' }]}>{addBillError}</Text> : null}
          <View style={{ borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 12, marginTop: 4 }}><Pressable accessibilityRole="button" accessibilityLabel="Save income" disabled={incomeBusy || !incomeFrequency || !incomeName.trim() || !((parseMoneyInput(incomeAmount, currencyCode) ?? 0) > 0)} onPress={() => void saveIncome()} style={[ui.button, { backgroundColor: ctaBg, borderColor: ctaBg, alignItems: 'center', opacity: incomeBusy || !incomeFrequency || !incomeName.trim() || !((parseMoneyInput(incomeAmount, currencyCode) ?? 0) > 0) ? 0.45 : 1 }]}><Text style={[ui.buttonText, { color: ctaFg }]}>{incomeBusy ? 'Saving…' : incomeEditorId === 'new' ? 'Add income' : 'Save income'}</Text></Pressable></View>
          {incomeEditorId !== 'primary' && incomeEditorId !== 'new' ? <Pressable accessibilityRole="button" accessibilityLabel="Remove income source" disabled={incomeBusy} onPress={() => setConfirmRemoveIncome(true)} style={[ui.button, { marginTop: 8, alignItems: 'center' }]}><Text style={[ui.buttonText, { color: '#F08B78' }]}>Remove source</Text></Pressable> : null}
        </View>
      </SheetModal>

      <ConfirmModal
        visible={confirmEndBill !== null}
        title="End recurring item and remove future entries?"
        message={confirmEndBill?.message ?? ''}
        confirmLabel="End recurring item"
        busy={endingBillBusy}
        onCancel={() => setConfirmEndBill(null)}
        onConfirm={() => {
          const target = confirmEndBill;
          if (!target || !onDeleteRecurringBill || billSaveBusyRef.current) return;
          billSaveBusyRef.current = true;
          setEndingBillBusy(true);
          setAddBillError('');
          void onDeleteRecurringBill(target.bill.id, target.snapshotToken).then(outcome => {
            setConfirmEndBill(null);
            if (outcome.status === 'pending') Alert.alert('Removal pending confirmation', outcome.message ?? 'Server confirmation is still pending.');
            else if (outcome.status === 'partial') Alert.alert('Removal incomplete', outcome.message ?? `${outcome.deletedTransactions} of ${outcome.totalTransactions} future ledger items were confirmed deleted. Some work remains.`);
            else Alert.alert('Recurring item ended', outcome.message ?? `${outcome.deletedTransactions} future-cycle transaction(s) were confirmed deleted. Recorded prepayments and their balance effects were preserved.`);
            if (shouldDismissRecurringBillEditor(outcome)) {
              setShowAddBillModal(false);
              setEditingBill(null);
            }
          }).catch(err => {
            setConfirmEndBill(null);
            setAddBillError(err instanceof Error ? err.message : 'Unable to end this recurring item.');
          }).finally(() => {
            billSaveBusyRef.current = false;
            setEndingBillBusy(false);
          });
        }}
      />



      <ConfirmModal
        visible={confirmRemoveIncome}
        title="Remove income source?"
        message={`Remove ${data.additionalIncomes.find(item => item.id === incomeEditorId)?.name ?? 'this income source'}? It will no longer be included in your income totals.`}
        confirmLabel="Remove source"
        busy={incomeBusy}
        onCancel={() => setConfirmRemoveIncome(false)}
        onConfirm={() => {
          setConfirmRemoveIncome(false);
          void removeIncome();
        }}
      />
    </FinancialScreen>
  );
}
