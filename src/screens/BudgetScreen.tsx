import { useEffect, useRef, useState } from 'react';
import { AmountText } from '../components/AmountText';
import { Alert, Keyboard, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import { Pressable, ScrollView, Text, TextInput, View, appearanceColor, useNativeAppearance } from '../components/NativeAppearance';
import * as Crypto from 'expo-crypto';
import { AppIcon, type AppIconName } from '../components/AppIcon';
import { Card, FinancialScreen, MultiBar, ui } from '../components/FinancialScreen';
import { SelectDropdown, type DropdownOption } from '../components/SelectDropdown';
import { DueDayPickerModal } from '../components/DatePickerModal';
import { AdaptiveModal } from '../components/ModalOverlay';
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
import { calculateMonthlyCashflow, calculateCategoryBreakdown, summarizeSinglePurchases, buildMonthlyBudgetBreakdown, selectCardDebtCommitment } from '../finance/budget';
import { makeMoney, moneyToMajor, parseMoney } from '../finance/money';
import { getCurrency } from '../finance/currencies';
import { createRecurringBillDeletionPreview, shouldDismissRecurringBillEditor, type RecurringBill, type RecurringBillCategory, type RecurringBillPaymentMethod } from '../finance/recurring-bills';
import { currentHouseholdDate, currentHouseholdMonth, getNextMonthString, getPreviousMonthString } from '../finance/calendar';
import { calculateTransactionBalanceDelta, isPaidOffAccountArchived, type LedgerTransaction } from '../finance/ledger';
import {
  confirmObligationPaidToday,
  obligationFirstDueDate,
  prepareObligationEditorSchedule,
} from '../finance/obligation-editor';
import { obligationScheduleKey, type ObligationSchedule, type ObligationScheduleKey } from '../finance/obligation-schedule';
import { SheetFormHeader, SheetModal } from '../components/SheetModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { InspireQuote } from '../components/InspireArt';
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
  utilities: '#2DD4BF', subscription: '#A78BFA', insurance: '#EC4899', purchases: '#F08B78', other_bill: '#94A3B8',
};
const budgetCategoryKey = (key: string) => {
  const norm = (key.startsWith('custom:') ? key.slice(7) : key).trim().toLowerCase();
  if (norm === 'debt' || norm === 'debt_payments' || norm === 'debt plan' || norm.startsWith('debt')) return 'debt';
  if (norm === 'housing' || norm === 'rent' || norm === 'mortgage' || norm.startsWith('housing')) return 'housing';
  if (norm === 'transportation' || norm === 'auto' || norm.startsWith('trans')) return 'transportation';
  if (norm === 'utilities' || norm === 'utility' || norm.startsWith('util')) return 'utilities';
  if (norm === 'subscription' || norm === 'subscriptions' || norm.startsWith('subscript')) return 'subscription';
  if (norm === 'insurance' || norm.startsWith('insur')) return 'insurance';
  if (norm === 'purchases' || norm === 'recorded purchases' || norm.startsWith('purch')) return 'purchases';
  if (norm === 'other_bill' || norm === 'other bills' || norm === 'other') return 'other_bill';
  return norm;
};
const budgetCategoryColor = (key: string) => BUDGET_CATEGORY_COLORS[budgetCategoryKey(key)] ?? BUDGET_CATEGORY_COLORS.other_bill;

const BILL_CATEGORIES: readonly DropdownOption<RecurringBillCategory>[] = [
  { value: 'utilities', label: 'Utilities', subtitle: 'Water, Electric, Gas, Internet', icon: 'calendar' },
  { value: 'subscription', label: 'Subscription', subtitle: 'Streaming, Software, Gym', icon: 'creditCard' },
  { value: 'housing', label: 'Housing / Rent', subtitle: 'Rent, HOA, Maintenance', icon: 'homeLoan' },
  { value: 'insurance', label: 'Insurance', subtitle: 'Health, Auto, Home insurance', icon: 'calendar' },
  { value: 'other_bill', label: 'Other', subtitle: 'Name a reusable spending category', icon: 'calendar' },
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
  error: string;
  canEdit?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { isLight, palette, ctaBg, ctaFg } = useNativeAppearance();
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
  const cardCommitment = selectCardDebtCommitment(budgetDebtAccounts, data.extraMonthlyPayment, currencyCode);

  const income = calculateTotalMonthlyIncome(
    data.primaryIncomeAmount,
    data.primaryPayFrequency,
    data.additionalIncomes,
    currencyCode,
  );

  const cashflow = calculateMonthlyCashflow({
    monthlyIncome: income,
    recurringBills: activeRecurringBills,
    monthlyDebtPlanPayment: cardCommitment.total,
    unifiedLoans,
    currencyCode,
  });

  const categoryBreakdown = calculateCategoryBreakdown({
    recurringBills: activeRecurringBills,
    customCategoryLabelsByBillId: data.recurringBillCategoryLabelByBillId,
    monthlyIncome: income,
    monthlyDebtPlanPayment: cardCommitment.total,
    unifiedLoans,
    currencyCode,
    debtAccountCount: cardCommitment.cards.length,
  });

  const creditCards = budgetDebtAccounts.filter(d => d.category === 'Credit card');
  const reusableCustomCategoryLabels = ['Transportation', ...Object.values(data.recurringBillCategoryLabelByBillId ?? {})].reduce<string[]>((labels, value) => {
    const label = value.trim();
    if (label && !labels.some(existing => existing.toLocaleLowerCase() === label.toLocaleLowerCase())) labels.push(label);
    return labels;
  }, []);

  const effectiveTimeZone =
    householdTimeZone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';

  const todayStr = currentHouseholdDate(effectiveTimeZone);
  const singlePurchases = summarizeSinglePurchases(transactions, spendingMonth, currencyCode);
  const displayBreakdown = buildMonthlyBudgetBreakdown({
    categories: categoryBreakdown,
    hasActiveDebt: cardCommitment.cards.length > 0 || cardCommitment.extra > 0,
    purchases: { total: singlePurchases.total, count: singlePurchases.items.length },
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
      const schedule = prepareObligationEditorSchedule({
        kind: 'bill', id: newBill.id, today, timeZone: effectiveTimeZone,
        dueDay: dayNum, amount: newBill.amount,
        legacyDueDay: editingBill?.dueDay,
        legacyAmount: editingBill?.amount,
        createdAt: newBill.createdAt, isNew: !editingBill, paidToday, existing: priorSchedule,
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

  return (
    <FinancialScreen
      title="Budget"
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
      addLabel="Add Monthly Expense"
    >
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
                          placeholder="e.g. Transportation"
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
                            {!editingBill && onAddLoan ? (
                              <View style={{ gap: 6, marginBottom: 8 }}>
                                <Text style={[ui.small, { fontWeight: '700', paddingHorizontal: 4, color: palette.muted }]}>
                                  Loans (Synced with Accounts)
                                </Text>
                                {([
                                  {
                                    category: 'Mortgage' as const,
                                    label: 'Mortgage',
                                    subtitle: 'Housing & Rent · Balance, APR & escrow tracked in Accounts',
                                    icon: 'homeLoan' as const,
                                  },
                                  {
                                    category: 'Auto loan' as const,
                                    label: 'Auto loan',
                                    subtitle: 'Transportation · Balance, APR & payoff tracked in Accounts',
                                    icon: 'auto' as const,
                                  },
                                ] as const).map(loanOption => (
                                  <Pressable
                                    key={loanOption.category}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${loanOption.label}, ${loanOption.subtitle}`}
                                    onPress={() => {
                                      const prefill = {
                                        name: newBillName.trim(),
                                        minimumPayment: newBillAmount.trim(),
                                        dueDay: newBillDueDay.trim(),
                                      };
                                      closeBillModal();
                                      onAddLoan(loanOption.category, prefill);
                                    }}
                                    style={{
                                      minHeight: 52,
                                      paddingHorizontal: 14,
                                      paddingVertical: 10,
                                      borderRadius: 12,
                                      borderWidth: 1,
                                      borderColor: palette.border,
                                      backgroundColor: palette.tint,
                                      flexDirection: 'row',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      gap: 10,
                                    }}
                                  >
                                    <View style={[ui.row, { gap: 10, flex: 1 }]}>
                                      <AppIcon name={loanOption.icon} size={18} color={palette.brand} />
                                      <View style={{ flex: 1 }}>
                                        <Text style={{ color: palette.text, fontSize: 15, fontWeight: '600' }}>{loanOption.label}</Text>
                                        <Text style={[ui.small, { color: palette.muted }]}>{loanOption.subtitle}</Text>
                                      </View>
                                    </View>
                                    <AppIcon name="chevronRight" size={16} color={palette.brand} />
                                  </Pressable>
                                ))}
                                <Text style={[ui.small, { fontWeight: '700', paddingHorizontal: 4, paddingTop: 6, color: palette.muted }]}>
                                  Recurring Expenses
                                </Text>
                              </View>
                            ) : null}
                            {BILL_CATEGORIES.map(option => {
                              const selected = option.value === newBillCategory;
                              return (
                                <Pressable
                                  key={option.value}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected }}
                                  onPress={() => {
                                    setNewBillCategory(option.value);
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

        <>
          {/* Monthly Cashflow Overview */}
          <Card style={{ padding: 16, borderRadius: 20, gap: 12 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: incomeExpanded }}
              accessibilityLabel={incomeExpanded ? (canEdit ? 'Done editing income' : 'Hide income sources') : (canEdit ? 'Edit income' : 'View income sources')}
              onPress={() => setIncomeExpanded(value => !value)}
              style={{ gap: 12 }}
            >
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }]}>
                <View style={{ flexShrink: 1 }}>
                  <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                    <Text style={[ui.small, { fontSize: 14, fontWeight: '600' }]}>Monthly Income</Text>
                    <AppIcon name={incomeExpanded ? 'chevronDown' : canEdit ? 'edit' : 'chevronRight'} size={14} color={palette.brand} />
                  </View>
                  <AmountText style={[ui.title, { fontSize: 36, marginTop: 2, letterSpacing: -1 }]} value={formatCurrency(income, currencySymbol)} />
                </View>
                <InspireQuote slot="budgetIncome" tiltDeg={-3} color="#0B89A8" style={{ textAlign: 'right', maxWidth: 145, paddingTop: 4 }} />
              </View>

              {(() => {
                if (budgetUnresolved) return <View accessibilityRole="alert" style={{ gap: 6 }}><Text style={ui.heading}>Budget and available amount unavailable</Text><Text style={ui.small}>Resolve the saved loan identities on Home to calculate these totals without counting the same obligation twice.</Text></View>;
                const freePercent = income > 0 ? (cashflow.remainingFreeCashflow / income) * 100 : 0;
                const isCritical = cashflow.isDeficit || freePercent < 10;
                const isTight = !isCritical && freePercent <= 30;
                const discretionaryColor = isCritical ? appearanceColor('#F08B78', isLight) : isTight ? appearanceColor('#F5C563', isLight) : appearanceColor('#76DCB9', isLight);
                const barSegments = [
                  ...categoryBreakdown.filter(item => item.amount > 0).map(item => ({
                    percent: Math.max(income, cashflow.totalCommitments) > 0 ? (item.amount / Math.max(income, cashflow.totalCommitments)) * 100 : 0,
                    color: appearanceColor(budgetCategoryColor(item.categoryKey), isLight),
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
                      <Text style={[ui.heading, { fontSize: 21, fontWeight: '800', marginTop: 2 }]}>{formatCurrency(cashflow.totalCommitments, currencySymbol)}</Text>
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
                      <Text style={[ui.small, { color: discretionaryColor, fontSize: 14, fontWeight: '700' }]}>
                        {cashflow.isDeficit ? 'Over budget' : 'Available'}
                      </Text>
                      <Text style={[ui.heading, { color: discretionaryColor, fontSize: 21, fontWeight: '800', marginTop: 2 }]}>
                        {formatCurrency(cashflow.remainingFreeCashflow, currencySymbol)}
                      </Text>
                    </View>
                  </View>
                </>;
              })()}
            </Pressable>

            {incomeExpanded ? (
              <View style={{ borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 10, gap: 4 }}>
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
              <Text style={[ui.small, { color: appearanceColor('#F5C563', isLight), fontWeight: '700' }]}>
                Legacy loan link review needed
              </Text>
              <Text style={[ui.small, { color: palette.text }]}>
                One or more legacy recurring bills differ from their linked loan account. Open Home → Legacy loan links to review before merging them.
              </Text>
            </View>
          ) : null}

          {/* Category Budget Breakdown */}
          <Card style={{ paddingHorizontal: 0, paddingTop: 14, paddingBottom: 6, borderRadius: 20, gap: 0 }}>
            <View style={[ui.row, { justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border }]}>
              <Text style={ui.heading}>Budget breakdown</Text>
              <View style={[ui.row, { gap: 0 }]}>
                <Pressable accessibilityRole="button" accessibilityLabel="Previous spending month" onPress={() => setSpendingMonth(getPreviousMonthString(spendingMonth))} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><AppIcon name="chevronLeft" size={16} color={palette.brand} /></Pressable>
                <Text style={[ui.small, { color: palette.text, fontWeight: '600' }]}>{new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(`${spendingMonth}-01T12:00:00`))}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Next spending month" onPress={() => setSpendingMonth(getNextMonthString(spendingMonth))} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><AppIcon name="chevronRight" size={16} color={palette.brand} /></Pressable>
              </View>
            </View>
            {/* Row event handlers call save functions after a tap; they do not read refs during render. */}
            {/* eslint-disable-next-line react-hooks/refs -- The callback only creates row UI and user-event handlers. */}
            {displayBreakdown.map((item, idx) => {
              const key = budgetCategoryKey(item.categoryKey);
              const isDebt = key === 'debt';
              const isPurchases = key === 'purchases';
              const isHousing = key === 'housing';
              const isTransport = key === 'transportation' || key === 'auto';
              const isUtilities = key === 'utilities';
              const isSubscription = key === 'subscription';
              const isInsurance = key === 'insurance';

              const customCategoryKey = item.categoryKey.startsWith('custom:') ? item.categoryKey.slice('custom:'.length) : null;
              const categoryBills = (!isDebt && !isPurchases)
                ? activeRecurringBills.filter(bill => {
                    if (!bill.active) return false;
                    const label = data.recurringBillCategoryLabelByBillId?.[bill.id]?.trim();
                    if (customCategoryKey !== null) return bill.category === 'other_bill' && label?.toLocaleLowerCase() === customCategoryKey;
                    return bill.category === item.categoryKey && !label;
                  })
                : [];
              const matchingUnifiedLoans = (!isDebt && !isPurchases)
                ? unifiedLoans.filter(loan => unifiedLoanBudgetCategory(loan.category) === item.categoryKey)
                : [];

              const icon: AppIconName =
                isDebt
                  ? 'creditCard'
                  : isPurchases
                    ? 'grid'
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

              const catColor = appearanceColor(budgetCategoryColor(item.categoryKey), isLight);

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
                            : isPurchases
                              ? `${item.count} recorded purchase${item.count === 1 ? '' : 's'} this month`
                            : item.count > 0
                              ? (matchingUnifiedLoans.length > 0
                                  ? `${item.count} active ${item.count === 1 ? 'item' : 'items'} (includes ${matchingUnifiedLoans.length} synced loan${matchingUnifiedLoans.length === 1 ? '' : 's'})`
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

                  <View accessibilityLabel={budgetUnresolved ? 'Percentage unavailable until loan review' : item.label + ': ' + item.percentOfIncome + '% of income'} style={{ height: 9, borderRadius: 5, overflow: 'hidden', backgroundColor: palette.raised }}>
                    <View style={{ height: 9, borderRadius: 5, backgroundColor: catColor, width: budgetUnresolved ? '0%' : `${Math.max(0, Math.min(100, item.percentOfIncome))}%` }} />
                  </View>

                  {expandedCategory === item.categoryKey ? (
                    <View style={{ paddingTop: 6, paddingLeft: 40, paddingRight: 15 }}>
                      {isDebt ? (
                        <>
                          {cardCommitment.cards.map(debt => (
                            <Pressable
                              key={debt.id}
                              accessibilityRole={canEdit && onEditDebt ? 'button' : undefined}
                              accessibilityLabel={canEdit && onEditDebt ? `Edit ${debt.name}` : debt.name}
                              disabled={!canEdit || !onEditDebt}
                              onPress={() => { if (canEdit && onEditDebt) onEditDebt(debt.id); }}
                              style={[ui.row, ui.divider, { justifyContent: 'space-between', gap: 8 }]}
                            >
                              <Text style={[ui.text, { flex: 1 }]}>{debt.name}</Text>
                              <View style={[ui.row, { gap: 8, alignItems: 'center' }]}>
                                <Text style={ui.value}>{formatCurrency(debt.minimumPayment, currencySymbol)}/mo</Text>
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
                              <Text style={ui.value}>{formatCurrency(cardCommitment.extra, currencySymbol)}</Text>
                              {canEdit && onOpenStrategy ? <AppIcon name="edit" size={14} color={palette.brand} /> : null}
                            </View>
                          </Pressable>
                          {!cardCommitment.cards.length ? <Text style={ui.small}>No cards with outstanding balances.</Text> : null}
                        </>
                      ) : isPurchases ? (
                        <View>
                          {singlePurchases.items.map(tx => <View key={tx.id} style={[ui.row, ui.divider, { justifyContent: 'space-between' }]}>
                            <View style={{ flex: 1 }}><Text style={ui.text}>{tx.payee || 'Purchase'}</Text><Text style={ui.small}>{tx.date}</Text></View>
                            <Text style={ui.value}>{formatCurrency(moneyToMajor(tx.amount), currencySymbol)}</Text>
                          </View>)}
                        </View>
                      ) : (
                        <>
                          {!matchingUnifiedLoans.length && !categoryBills.length ? (
                            <Text style={ui.small}>No active line items.</Text>
                          ) : null}
                          {matchingUnifiedLoans.map(loan => {
                            const escrow = loan.category === 'Mortgage' ? data.mortgageEscrowByDebtId?.[loan.id] : undefined;
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
                                    {`${loan.category} · Synced with Accounts · ${loan.dueDay !== null ? `Due day ${loan.dueDay}` : 'Due day not set'}${escrow !== undefined ? ` · Escrow ${formatCurrency(escrow, currencySymbol)}` : ''}`}
                                  </Text>
                                </View>
                                <View style={[ui.row, { gap: 8, alignItems: 'center' }]}>
                                  <Text style={ui.value}>{formatCurrency(loan.minimumPayment, currencySymbol)}/mo</Text>
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
                                <Text style={ui.small}>{`Due day ${bill.dueDay} · ${bill.paymentMethod === 'credit' ? 'Credit Card' : 'Debit Card'}`}</Text>
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
        </>

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
