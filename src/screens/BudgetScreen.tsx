import { useEffect, useRef, useState } from 'react';
import { AmountText } from '../components/AmountText';
import { Alert, Keyboard, StyleSheet, TouchableWithoutFeedback, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Pressable, ScrollView, Text, TextInput, View, appearanceColor, useNativeAppearance } from '../components/NativeAppearance';
import { getAppearancePalette } from '../components/appearance-theme';
import * as Crypto from 'expo-crypto';
import { AppIcon, type AppIconName } from '../components/AppIcon';
import { Card, FinancialScreen, MultiBar, ui } from '../components/FinancialScreen';
import { SelectDropdown, type DropdownOption } from '../components/SelectDropdown';
import { DueDayPickerModal, formatShortDate } from '../components/DatePickerModal';
import { AdaptiveModal } from '../components/ModalOverlay';
import { DEFAULT_TAB_UI_PREFERENCES, useTabShell, type TabUiPreferences } from '../components/TabShellContext';
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
  type AdditionalIncomeSource,
  parseMoneyInput,
} from '../onboarding-domain';
import {
  calculateMonthlyCashflow,
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
import { InformationButton } from '../components/InformationSheet';
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

export function BudgetScreen({
  data,
  currencySymbol,
  currencyCode,
  householdTimeZone,
  transactions = [],
  recurringBills = [],
  onSaveIncome,
  onSaveLoanBillPairings,
  onSaveRecurringBillCategoryLabels,
  onSettings,
  onAddRecurringBill,
  onDeleteRecurringBill,
  onOpenStrategy,
  onSaveObligationSchedule,
  onEditDebt,
  onAddLoan,
  onEditLoan,
  onOpenPurchase,
  historicalBillIdsByDebtId = {},
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
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const { cardBorder: cardBorderColor, posInk: posInkColor, neg: negColor } = palette;
  const graphOutlineColor = isInspire ? palette.graphOutline : undefined;
  const shell = useTabShell();
  const [localUiPreferences, setLocalUiPreferences] = useState<TabUiPreferences>(DEFAULT_TAB_UI_PREFERENCES);
  const uiPreferences = shell?.uiPreferences ?? localUiPreferences;
  const setUiPreferences = shell?.setUiPreferences ?? setLocalUiPreferences;
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

  const incomes = [
    {
      id: 'primary',
      name: data.primaryIncomeName ?? 'Income',
      amount: data.primaryIncomeAmount,
      frequency: data.primaryPayFrequency,
      grossAmount: data.primaryGrossIncomeAmount,
    },
    ...data.additionalIncomes,
  ];
  const budgetDebtAccounts = data.debts.filter(debt => !isPaidOffAccountArchived(debt, data.archivedPaidOffDebtIds));
  const pairingAudit = auditLegacyLoanPairings({
    debts: data.debts,
    recurringBills,
    pairings: data.loanBillPairingByDebtId,
    currencyCode,
  });
  const budgetUnresolved = hasUnresolvedLegacyLoanLinks(pairingAudit);
  const divergentDebtIds = [...pairingAudit.divergentLinks.map(link => link.debt.id), ...pairingAudit.invalidLinks.map(item => item.debtId)];
  const unifiedLoans = selectUnifiedBudgetLoans(budgetDebtAccounts, data.archivedPaidOffDebtIds, divergentDebtIds);
  const excludedBillIdSet = new Set(unifiedExcludedBillIds(
    data.loanBillPairingByDebtId,
    recurringBills,
    data.debts,
    data.archivedPaidOffDebtIds,
    divergentDebtIds,
  ));
  const activeRecurringBills = recurringBills.filter(bill => !excludedBillIdSet.has(bill.id));
  const debtCommitment = selectDebtPlanCommitment(budgetDebtAccounts, data.extraMonthlyPayment, currencyCode);
  const annualFeeReserve = summarizeAnnualCardFeesMonthly(budgetDebtAccounts, currencyCode);
  const cardNames = new Map(data.debts.filter(debt => debt.category === 'Credit card').map(debt => [debt.id, debt.name]));
  const allDebtById = new Map(data.debts.map(debt => [debt.id, debt]));
  const allBillById = new Map(recurringBills.map(bill => [bill.id, bill]));
  const paidObligations = budgetSection === 'Budget' && expandedCategory !== null
    ? getPaidMonthlyObligationKeys({
        month: spendingMonth,
        debts: [...unifiedLoans, ...debtCommitment.accounts],
        recurringBills: activeRecurringBills,
        transactions,
        currencyCode,
        schedules: data.obligationSchedules,
        historicalBillIdsByDebtId,
      })
    : null;

  const income = calculateTotalMonthlyIncome(
    data.primaryIncomeAmount,
    data.primaryPayFrequency,
    data.additionalIncomes,
    currencyCode,
  );

  const effectiveTimeZone =
    householdTimeZone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';

  const todayStr = currentHouseholdDate(effectiveTimeZone);
  const cashflow = calculateMonthlyCashflow({
    monthlyIncome: income,
    recurringBills: activeRecurringBills,
    monthlyDebtPlanPayment: debtCommitment.total,
    unifiedLoans,
    currencyCode,
  });
  const expenseSummary = summarizeMonthlyExpenses({
    month: spendingMonth,
    currencyCode,
    transactions,
    debts: data.debts,
    recurringBills,
    loanBillPairingByDebtId: data.loanBillPairingByDebtId,
    customCategoryLabelsByBillId: data.recurringBillCategoryLabelByBillId,
    archivedPaidOffDebtIds: data.archivedPaidOffDebtIds,
    historicalBillIdsByDebtId,
  });

  const categoryBreakdown = calculateCategoryBreakdown({
    recurringBills: activeRecurringBills,
    customCategoryLabelsByBillId: data.recurringBillCategoryLabelByBillId,
    monthlyIncome: income,
    monthlyDebtPlanPayment: debtCommitment.total,
    unifiedLoans,
    currencyCode,
    debtAccountCount: debtCommitment.accounts.length,
  });

  const creditCards = budgetDebtAccounts.filter(d => d.category === 'Credit card');
  const reusableCustomCategoryLabels = ['Auto', ...Object.values(data.recurringBillCategoryLabelByBillId ?? {})].reduce<string[]>((labels, value) => {
    const trimmed = value.trim();
    const label = trimmed.toLocaleLowerCase() === 'transportation' ? 'Auto' : trimmed;
    if (label && !labels.some(existing => existing.toLocaleLowerCase() === label.toLocaleLowerCase())) labels.push(label);
    return labels;
  }, []);

  const displayBreakdown = buildMonthlyBudgetBreakdown({
    categories: categoryBreakdown,
    hasActiveDebt: debtCommitment.accounts.length > 0 || debtCommitment.extra > 0,
    monthlyIncome: income,
  });

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

  const spendingMonthLabel = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(`${spendingMonth}-01T12:00:00`));
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
    const { cashOutflow, totalDebtPayments, others, unpaidCharges, netBalanceChange } = expenseSummary;
    const netDirection = netBalanceChange < 0 ? '↓ −' : netBalanceChange > 0 ? '↑ +' : '';
    const expenseColor = (key: string) => {
      if (key === 'debt') return posInkColor;
      if (key === 'housing') return palette.accentInk;
      if (key === 'charges') return negColor;
      return appearanceColor(budgetCategoryColor(key), isLight, accentColor, isInspire);
    };

    // Five summary metrics using distinct app accent colors (excluding Graphite Slate).
    const tealAccent = getAppearancePalette(themeStyle, 'teal', isLight);
    const cobaltAccent = getAppearancePalette(themeStyle, 'cobalt', isLight);
    const violetAccent = getAppearancePalette(themeStyle, 'violet', isLight);
    const berryAccent = getAppearancePalette(themeStyle, 'berry', isLight);
    const amberAccent = getAppearancePalette(themeStyle, 'amber', isLight);

    const metrics: readonly {
      key: string;
      label: string;
      shortLabel: string;
      amount: number;
      prefix?: string;
      icon: AppIconName;
      brandColor: string;
      inkColor: string;
      tintBg: string;
      detail: string;
      isNetRow?: boolean;
    }[] = [
      {
        key: 'actualCashFlow',
        label: 'Actual Cash Flow',
        shortLabel: 'Actual Cash\nFlow',
        amount: cashOutflow,
        icon: 'cash',
        brandColor: tealAccent.brand,
        inkColor: tealAccent.accentInk,
        tintBg: tealAccent.selection,
        detail: 'Cash to Debt Payments plus Others for this month. Shows total actual cash paid out.',
      },
      {
        key: 'cashToDebtPayments',
        label: 'Cash to Debt Payments',
        shortLabel: 'Cash to Debt\nPayments',
        amount: totalDebtPayments,
        icon: 'layers',
        brandColor: cobaltAccent.brand,
        inkColor: cobaltAccent.accentInk,
        tintBg: cobaltAccent.selection,
        detail: 'Recorded payments to credit cards and loans, including the full amount of each Home and Auto payment.',
      },
      {
        key: 'others',
        label: 'Others',
        shortLabel: 'Others',
        amount: others,
        icon: 'box',
        brandColor: violetAccent.brand,
        inkColor: violetAccent.accentInk,
        tintBg: violetAccent.selection,
        detail: 'Paid expenses such as subscriptions, utilities, groceries, and other settled charges. Includes recorded recurring bill payments, even when paid by card.',
      },
      {
        key: 'charges',
        label: 'Charges',
        shortLabel: 'Charges',
        amount: unpaidCharges,
        icon: 'creditCard',
        brandColor: berryAccent.brand,
        inkColor: berryAccent.accentInk,
        tintBg: berryAccent.selection,
        detail: 'Recorded unpaid charges, including unpaid subscription charges. A recorded payment for a recurring bill puts that expense in Others. An ordinary card payment does not identify which individual purchases it settled.',
      },
      {
        key: 'netBalanceChange',
        label: 'Net Balance Change',
        shortLabel: 'Net Balance\nChange',
        amount: Math.abs(netBalanceChange),
        prefix: netDirection,
        icon: netBalanceChange > 0 ? 'brandRise' : 'trendDown',
        brandColor: amberAccent.brand,
        inkColor: amberAccent.accentInk,
        tintBg: amberAccent.selection,
        detail: 'Unpaid Charges minus Cash to Debt Payments. Home and Auto count at the full payment amount. This is the Expense calculation, so it includes interest and escrow within those payments.',
        isNetRow: true,
      },
    ];

    // Donut slices follow the 5 summary metrics clockwise: Actual Cash Flow, Net Balance Change,
    // Cash to Debt Payments, Others, Charges.
    const donutMetricOrder = [metrics[0], metrics[4], metrics[1], metrics[2], metrics[3]];
    const activeSlices = donutMetricOrder.filter(item => item.amount > 0);
    const zeroMetrics = metrics.filter(item => item.amount === 0);
    const sliceTotal = activeSlices.reduce((sum, item) => sum + item.amount, 0);

    const compactCallouts = windowWidth < 320 || fontScale >= 1.35;
    const chartWidth = Math.max(288, Math.min(376, windowWidth - 52));
    const outerRadius = Math.round(chartWidth * 0.26);
    const ringStroke = Math.round(outerRadius * 0.29);
    const r = outerRadius - ringStroke / 2;
    const circumference = 2 * Math.PI * r;
    const innerCircleSize = Math.round((r - ringStroke / 2) * 1.88);
    const netCenterColor = netBalanceChange < 0 ? posInkColor : netBalanceChange > 0 ? negColor : palette.text;

    let offset = 0;
    let angleCursor = -Math.PI / 2;
    const arcs = activeSlices.map(item => {
      const fraction = sliceTotal > 0 ? item.amount / sliceTotal : 0;
      const sweep = fraction * 2 * Math.PI;
      const startAngle = angleCursor;
      const endAngle = angleCursor + sweep;
      const midAngle = startAngle + sweep / 2;
      const length = fraction * circumference;
      const arc = {
        ...item,
        fraction,
        pct: fraction * 100,
        offset,
        length,
        startAngle,
        endAngle,
        midAngle,
      };
      offset += length;
      angleCursor += sweep;
      return arc;
    });

    // Sort by unclamped vertical position sin(midAngle) so adjacent top-left slices never cross lines.
    const leftSideRaw = arcs
      .filter(a => Math.cos(a.midAngle) < -0.05)
      .sort((a, b) => Math.sin(a.midAngle) - Math.sin(b.midAngle));
    const rightSideRaw = arcs
      .filter(a => Math.cos(a.midAngle) >= -0.05)
      .sort((a, b) => Math.sin(a.midAngle) - Math.sin(b.midAngle));
    const chartHeight = Math.round(outerRadius * 2 + 94);
    const cx = chartWidth / 2;
    const cy = chartHeight / 2;

    const placeSide = (sideArcs: typeof arcs, isRight: boolean) => {
      const topBound = 54;
      const bottomBound = chartHeight - 24;
      const count = sideArcs.length;
      if (count === 0) return [];
      const minStep = count >= 3 ? Math.min(68, Math.floor((bottomBound - topBound) / (count - 1))) : 80;

      const sorted = sideArcs.map((arc, idx) => {
        let lineY = Math.max(topBound, Math.min(bottomBound, cy + (outerRadius + 36) * Math.sin(arc.midAngle)));
        if (count === 3) {
          lineY = idx === 0 ? topBound : idx === 1 ? Math.round(topBound + 76) : bottomBound;
        } else if (count === 2) {
          lineY = idx === 0 ? Math.round(cy - outerRadius * 0.72) : bottomBound;
        }
        return { ...arc, lineY };
      });

      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].lineY - sorted[i - 1].lineY < minStep) {
          sorted[i].lineY = sorted[i - 1].lineY + minStep;
        }
      }
      if (sorted[sorted.length - 1].lineY > bottomBound) {
        const overflow = sorted[sorted.length - 1].lineY - bottomBound;
        sorted[sorted.length - 1].lineY -= overflow;
        for (let i = sorted.length - 2; i >= 0; i--) {
          if (sorted[i + 1].lineY - sorted[i].lineY < minStep) {
            sorted[i].lineY = sorted[i + 1].lineY - minStep;
          }
        }
      }

      return sorted.map(item => {
        const lineY = Math.max(topBound, Math.min(bottomBound, item.lineY));
        const dy = Math.abs(lineY - cy);
        const ringClearX = dy < outerRadius + 8 ? Math.sqrt(Math.max(0, (outerRadius + 8) ** 2 - dy ** 2)) : outerRadius * 0.44;
        const elbowX = isRight ? cx + ringClearX + 8 : cx - ringClearX - 8;
        const colWidth = Math.max(82, Math.floor(isRight ? chartWidth - elbowX + 10 : elbowX + 10));
        const targetAngle = Math.atan2(lineY - cy, isRight ? outerRadius : -outerRadius);
        const normalizedTarget = targetAngle < -Math.PI / 2 ? targetAngle + 2 * Math.PI : targetAngle;
        const margin = Math.min(0.18, (item.endAngle - item.startAngle) * 0.3);
        const dotAngle = Math.max(item.startAngle + margin, Math.min(item.endAngle - margin, normalizedTarget));
        const dotX = cx + r * Math.cos(dotAngle);
        const dotY = cy + r * Math.sin(dotAngle);
        const lineCount = item.shortLabel.includes('\n') ? 2 : 1;
        return {
          ...item,
          lineY,
          elbowX,
          colWidth,
          dotX,
          dotY,
          labelTop: lineY - (lineCount === 2 ? 48 : 35),
        };
      });
    };

    const leftCallouts = placeSide(leftSideRaw, false);
    const rightCallouts = placeSide(rightSideRaw, true);

    return (
      <>
        {statusNotices}
        <Card style={{ paddingHorizontal: 10, paddingVertical: 14, borderRadius: 20, gap: 8, overflow: 'hidden', borderColor: cardBorderColor }}>
          <InspireCornerArt kind="hero-expense" borderRadius={20} />
          <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingHorizontal: 6 }]}>
            <Text accessibilityRole="header" style={ui.heading}>Expense summary</Text>
            <Text style={[ui.small, { fontWeight: '600' }]}>{spendingMonthLabel}</Text>
          </View>

          {compactCallouts ? (
            <View style={{ alignItems: 'center', gap: 10 }}>
              <View style={{ width: 176, height: 176, alignItems: 'center', justifyContent: 'center' }}>
                <Svg width={176} height={176} viewBox="0 0 176 176" style={StyleSheet.absoluteFill} accessible={false}>
                  <Circle cx={88} cy={88} r={72} fill="none" stroke={isLight ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.06)'} strokeWidth={28} />
                  {arcs.map(arc => (
                    <Circle
                      key={arc.key}
                      cx={88}
                      cy={88}
                      r={68}
                      fill="none"
                      stroke={arc.brandColor}
                      strokeWidth={22}
                      rotation={-90}
                      origin="88,88"
                      strokeDasharray={arcs.length > 1 ? [arc.length * (68 / r), circumference * (68 / r)] : undefined}
                      strokeDashoffset={-(arc.offset * (68 / r))}
                    />
                  ))}
                  {arcs.length > 0 ? (
                    <Circle cx={88} cy={88} r={62.5} fill="none" stroke="#000000" strokeOpacity={isLight ? 0.08 : 0.28} strokeWidth={11} />
                  ) : null}
                </Svg>
                <View style={{
                  width: 106,
                  height: 106,
                  borderRadius: 53,
                  backgroundColor: palette.surface,
                  borderWidth: 1.2,
                  borderColor: isLight ? palette.border : 'rgba(255,255,255,0.14)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 6,
                }}>
                  <Text style={[ui.small, { fontSize: 11, lineHeight: 13.5, fontWeight: '600', textAlign: 'center', color: palette.text }]}>
                    {'Net Balance\nChange'}
                  </Text>
                  <AmountText
                    style={{ fontSize: 16, fontWeight: '800', color: netCenterColor, textAlign: 'center', marginTop: 2 }}
                    value={netDirection + formatCurrency(Math.abs(netBalanceChange), currencySymbol)}
                  />
                </View>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, paddingHorizontal: 4 }}>
                {metrics.map(metric => {
                  const pct = sliceTotal > 0 && metric.amount > 0 ? (metric.amount / sliceTotal) * 100 : 0;
                  return (
                    <View key={metric.key} style={[ui.row, { gap: 4 }]}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: metric.brandColor }} />
                      <Text style={[ui.small, { fontSize: 11, color: palette.text, fontWeight: '600' }]}>
                        {`${metric.label}: ${(metric.prefix ?? '') + formatCurrency(metric.amount, currencySymbol)}${pct > 0 ? ` (${pct.toFixed(1)}%)` : ''}`}
                      </Text>
                      <InformationButton label={metric.label} detail={metric.detail} size={13} />
                    </View>
                  );
                })}
              </View>
            </View>
          ) : (
            <View style={{ width: chartWidth, height: chartHeight, alignSelf: 'center', position: 'relative' }}>
              <Svg width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} accessible={false}>
                <Circle
                  cx={cx}
                  cy={cy}
                  r={outerRadius + 2}
                  fill="none"
                  stroke={isLight ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.06)'}
                  strokeWidth={6}
                />
                <Circle cx={cx} cy={cy} r={r} fill="none" stroke={palette.raised} strokeWidth={ringStroke} />
                {arcs.map(arc => (
                  <Circle
                    key={arc.key}
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill="none"
                    stroke={arc.brandColor}
                    strokeWidth={ringStroke}
                    rotation={-90}
                    origin={`${cx},${cy}`}
                    strokeDasharray={arcs.length > 1 ? [arc.length, circumference] : undefined}
                    strokeDashoffset={-arc.offset}
                  />
                ))}
                {arcs.length > 0 ? (
                  <Circle
                    cx={cx}
                    cy={cy}
                    r={r - ringStroke * 0.25}
                    fill="none"
                    stroke="#000000"
                    strokeOpacity={isLight ? 0.08 : 0.28}
                    strokeWidth={ringStroke * 0.48}
                  />
                ) : null}
                {leftCallouts.map(item => (
                  <Path
                    key={`line-${item.key}`}
                    d={`M ${item.dotX.toFixed(1)} ${item.dotY.toFixed(1)} L ${item.elbowX.toFixed(1)} ${item.lineY.toFixed(1)} L 2 ${item.lineY.toFixed(1)}`}
                    fill="none"
                    stroke={item.brandColor}
                    strokeWidth={1.4}
                  />
                ))}
                {rightCallouts.map(item => (
                  <Path
                    key={`line-${item.key}`}
                    d={`M ${item.dotX.toFixed(1)} ${item.dotY.toFixed(1)} L ${item.elbowX.toFixed(1)} ${item.lineY.toFixed(1)} L ${(chartWidth - 2).toFixed(1)} ${item.lineY.toFixed(1)}`}
                    fill="none"
                    stroke={item.brandColor}
                    strokeWidth={1.4}
                  />
                ))}
                {[...leftCallouts, ...rightCallouts].map(item => (
                  <Circle
                    key={`dot-${item.key}`}
                    cx={item.dotX}
                    cy={item.dotY}
                    r={3.6}
                    fill="#FFFFFF"
                    stroke={item.brandColor}
                    strokeWidth={1.6}
                  />
                ))}
              </Svg>

              <View
                style={{
                  position: 'absolute',
                  left: cx - innerCircleSize / 2,
                  top: cy - innerCircleSize / 2,
                  width: innerCircleSize,
                  height: innerCircleSize,
                  borderRadius: innerCircleSize / 2,
                  backgroundColor: palette.surface,
                  borderWidth: 1.2,
                  borderColor: isLight ? palette.border : 'rgba(255,255,255,0.14)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 8,
                  shadowColor: '#000000',
                  shadowOpacity: isLight ? 0.1 : 0.35,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 3 },
                  elevation: 4,
                }}
              >
                <Text style={{ fontSize: 12, lineHeight: 14.5, fontWeight: '600', color: palette.text, textAlign: 'center' }}>
                  {'Net Balance\nChange'}
                </Text>
                <AmountText
                  style={{ fontSize: 17.5, fontWeight: '800', color: netCenterColor, textAlign: 'center', marginTop: 3 }}
                  value={netDirection + formatCurrency(Math.abs(netBalanceChange), currencySymbol)}
                />
              </View>

              {leftCallouts.map(item => (
                <View
                  key={`callout-${item.key}`}
                  style={{
                    position: 'absolute',
                    left: 2,
                    top: item.labelTop,
                    width: item.colWidth,
                    alignItems: 'flex-start',
                  }}
                >
                  <View style={[ui.row, { gap: 4, alignItems: 'center', maxWidth: '100%' }]}>
                    <Text numberOfLines={2} style={{ fontSize: 10.2, lineHeight: 12, fontWeight: '600', color: palette.text, textAlign: 'left', flexShrink: 1 }}>
                      {item.shortLabel}
                    </Text>
                    <InformationButton label={item.label} detail={item.detail} size={13} />
                  </View>
                  <AmountText
                    style={{ fontSize: 13.2, fontWeight: '800', color: palette.text, textAlign: 'left', marginTop: 2 }}
                    value={formatCurrency(item.amount, currencySymbol)}
                  />
                  <Text style={{ fontSize: 12.6, fontWeight: '800', color: item.inkColor, textAlign: 'left', marginTop: 8 }}>
                    {`${item.pct.toFixed(1)}%`}
                  </Text>
                </View>
              ))}

              {rightCallouts.map(item => (
                <View
                  key={`callout-${item.key}`}
                  style={{
                    position: 'absolute',
                    right: 2,
                    top: item.labelTop,
                    width: item.colWidth,
                    alignItems: 'flex-end',
                  }}
                >
                  <View style={[ui.row, { gap: 4, alignItems: 'center', justifyContent: 'flex-end', maxWidth: '100%' }]}>
                    <InformationButton label={item.label} detail={item.detail} size={13} />
                    <Text numberOfLines={2} style={{ fontSize: 10.2, lineHeight: 12, fontWeight: '600', color: palette.text, textAlign: 'right', flexShrink: 1 }}>
                      {item.shortLabel}
                    </Text>
                  </View>
                  <AmountText
                    style={{ fontSize: 13.2, fontWeight: '800', color: palette.text, textAlign: 'right', marginTop: 2 }}
                    value={formatCurrency(item.amount, currencySymbol)}
                  />
                  <Text style={{ fontSize: 12.6, fontWeight: '800', color: item.inkColor, textAlign: 'right', marginTop: 8 }}>
                    {`${item.pct.toFixed(1)}%`}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {!compactCallouts && zeroMetrics.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, paddingHorizontal: 6, paddingTop: 2 }}>
              {zeroMetrics.map(metric => (
                <View key={metric.key} style={[ui.row, { gap: 4 }]}>
                  <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: metric.brandColor }} />
                  <Text style={[ui.small, { fontSize: 11, color: palette.muted, fontWeight: '600' }]}>
                    {`${metric.label} ${formatCurrency(0, currencySymbol)}`}
                  </Text>
                  <InformationButton label={metric.label} detail={metric.detail} size={13} />
                </View>
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

        <Card style={{ paddingHorizontal: 0, paddingTop: 14, paddingBottom: 6, borderRadius: 20, gap: 0, borderColor: cardBorderColor }}>
          <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={ui.heading}>Breakdown</Text>
            </View>
            <View style={[ui.row, { gap: 0 }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous expense month" hitSlop={6} onPress={() => setSpendingMonth(getPreviousMonthString(spendingMonth))} style={{ minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' }}><AppIcon name="chevronLeft" size={16} color={palette.brand} /></Pressable>
              <Text style={[ui.small, { color: palette.text, fontWeight: '600' }]}>{spendingMonthLabel}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Next expense month" hitSlop={6} onPress={() => setSpendingMonth(getNextMonthString(spendingMonth))} style={{ minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' }}><AppIcon name="chevronRight" size={16} color={palette.brand} /></Pressable>
            </View>
          </View>

          {expenseSummary.categories.length === 0 ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 18 }}>
              <Text style={ui.small}>{`No confirmed payments or charges recorded for ${spendingMonthLabel}.`}</Text>
            </View>
          ) : (
            expenseSummary.categories.map((item, idx) => {
              const catColor = expenseColor(item.categoryKey);
              const icon = expenseCategoryIcon(item.categoryKey);
              const isExpanded = expandedExpenseCategory === item.categoryKey;

              return (
                <View key={item.categoryKey} style={{ borderBottomWidth: idx < expenseSummary.categories.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: palette.border, paddingVertical: 9, paddingHorizontal: 16, gap: 6 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isExpanded }}
                    accessibilityLabel={`${item.label}, ${isExpanded ? 'hide' : 'show'} transactions`}
                    onPress={() => setExpandedExpenseCategory(isExpanded ? null : item.categoryKey)}
                    style={[ui.row, { justifyContent: 'space-between', gap: 8 }]}
                  >
                    <View style={[ui.row, { gap: 8, flex: 1 }]}>
                      <View style={[ui.iconCircle, { width: 34, height: 34, borderRadius: 17, borderWidth: 0, backgroundColor: catColor + '18' }]}>
                        <AppIcon name={icon} size={18} color={catColor} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={[ui.row, { gap: 6, alignItems: 'baseline' }]}>
                          <Text style={[ui.heading, { fontSize: 16, flexShrink: 1 }]}>{item.label}</Text>
                        </View>
                        <Text style={ui.small}>{item.subtitle}</Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', maxWidth: '45%', minWidth: 0, flexShrink: 1 }}>
                      <AmountText style={[ui.value, { color: catColor, textAlign: 'right' }]} value={formatCurrency(item.amount, currencySymbol)} />
                    </View>
                    <AppIcon name={isExpanded ? 'chevronDown' : 'chevronRight'} size={15} color="#AAB3AD" />
                  </Pressable>

                  {isExpanded ? (
                    <View style={{ paddingTop: 6, paddingLeft: 40, paddingRight: 15 }}>
                      {item.items.map(tx => {
                        const txDebt = tx.accountId ? allDebtById.get(tx.accountId) : undefined;
                        const idBill = extractBillIdFromTxId(tx.id);
                        const memoBills = extractBillIdsFromMemo(tx.memo);
                        const txBill = (idBill ? allBillById.get(idBill) : undefined) ??
                          [...memoBills].map(id => allBillById.get(id)).find(Boolean);
                        const accountOnly = item.categoryKey === 'debt' || item.categoryKey === 'charges';
                        const methodLabel = tx.accountId === null ? 'Checking / Debit' : (txDebt?.name ?? 'Account');
                        const trimmedPayee = tx.payee.trim();
                        const rowTitle = accountOnly ? methodLabel : txBill?.name
                          ?? (trimmedPayee && !/^payment$/i.test(trimmedPayee) ? trimmedPayee : undefined)
                          ?? txDebt?.name
                          ?? (tx.accountId === null ? 'Checking / Debit' : 'Transaction');
                        const dateLabel = formatShortDate(tx.date);
                        const rowDetail = accountOnly ? dateLabel : `${methodLabel} · ${dateLabel}`;

                        return (
                          <Pressable
                            key={tx.id}
                            accessibilityRole={onOpenPurchase ? 'button' : undefined}
                            accessibilityLabel={onOpenPurchase ? `Open ${rowTitle} transaction` : rowTitle}
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
                  ) : null}
                </View>
              );
            })
          )}
        </Card>
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
                      <View style={{ flex: 1 }}>
                        <View style={[ui.row, { gap: 6, alignItems: 'baseline' }]}>
                          <Text style={[ui.heading, { fontSize: 16, flexShrink: 1 }]}>{item.label}</Text>
                          <Text style={[ui.small, { color: catColor, fontWeight: '700', fontSize: 13 }]}>{budgetUnresolved ? 'N/A' : item.percentOfIncome + '%'}</Text>
                        </View>
                        <Text style={ui.small}>
                            {isDebt
                              ? 'Card minimums + extra'
                              : item.count > 0
                                ? (matchingUnifiedLoans.length > 0
                                    ? `${item.count} active ${item.count === 1 ? 'item' : 'items'}`
                                    : `${item.count} active bill${item.count > 1 ? 's' : ''}`)
                                : 'No bills added'}
                        </Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', maxWidth: '45%', minWidth: 0, flexShrink: 1 }}>
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
                                <Text style={ui.value}>{formatCurrency(moneyToMajor(bill.amount), currencySymbol)}</Text>
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
                    <Text style={[ui.text, { color: palette.muted }]}>Monthly amount *</Text>
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
