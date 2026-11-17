import { AdaptiveModal } from '../components/ModalOverlay';
import { ConfirmModal } from '../components/ConfirmModal';
import { transactionHasBillId } from '../finance/bill-identity';
import { useMemo, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { Alert, TouchableWithoutFeedback } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, ScrollView, Text, TextInput, View, appearanceColor, useNativeAppearance } from '../components/NativeAppearance';
import { AppIcon, type AppIconName } from '../components/AppIcon';
import { AmountText } from '../components/AmountText';
import { Card, FinancialScreen, ui } from '../components/FinancialScreen';
import { ObligationCalendar } from '../components/ObligationCalendar';
import { SelectDropdown, type DropdownOption } from '../components/SelectDropdown';
import { SheetFormHeader, SheetModal } from '../components/SheetModal';
import { formatCurrency, acceptMoneyEdit, type DebtItem } from '../onboarding-domain';
import {
  classifyCategoryDirection,
  calculateTransactionBalanceDelta,
  type LedgerTransaction,
  type TransactionCategory,
} from '../finance/ledger';
import { makeMoney, moneyFromMajor, moneyToMajor, parseMoney, addMoney, type Money } from '../finance/money';
import { currentHouseholdDate, currentHouseholdMonth, getNextMonthString, getPreviousMonthString, parseDateOnly, type DateOnly } from '../finance/calendar';
import { resolveRecurringBillDate, type RecurringBill } from '../finance/recurring-bills';
import { createDebtMinimumPaymentTransaction, getScheduledObligationRows, resolveEffectiveDebtSchedule, type ScheduledObligationRow } from '../finance/payment-matching';
import { getObligationCycle, type ObligationSchedules } from '../finance/obligation-schedule';
import { AnnualFeeSchedule, getAnnualFeeRows } from '../components/AnnualFeeSchedule';
import { clampDate, firstEligibleSplitTerm, getPlannedDebtInstallments, resolveDebtSplitPlanState, type DebtPaymentSplitPlansByDebtId, type BillPaymentSplitPlansByBillId } from '../finance/debt-payment-split';
import { getCurrency } from '../finance/currencies';
import { bottomInsetPadding } from '../components/bottom-inset';

const SHORT_MONTH_DAY_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const HISTORY_DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const LONG_MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

const normalizeDisplayName = (text: string) =>
  text.replace(/\b([A-Z]{4,})\b/g, w => w[0] + w.slice(1).toLowerCase());

const formatShortMonthDay = (isoDate: string) => {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  return SHORT_MONTH_DAY_FMT.format(new Date(Date.UTC(year, month - 1, day)));
};

const formatTransactionCategoryLabel = (category: TransactionCategory): string => {
  switch (category) {
    case 'payment':
      return 'Payment';
    case 'purchase':
      return 'Purchase';
    case 'subscription':
      return 'Subscription';
    case 'utilities':
      return 'Utilities';
    case 'interest':
      return 'Interest';
    case 'fee':
      return 'Fee';
    case 'annual_fee':
      return 'Annual Fee';
    case 'refund':
      return 'Refund';
    case 'credit_adjustment':
    case 'balance_adjustment':
      return 'Updated';
    case 'interest_adjustment':
      return 'Interest Adjusted';
    case 'debit_bill':
    case 'debit_spending':
      return 'Debit';
    default:
      return String(category).replace(/_/g, ' ');
  }
};

const formatTransactionSourceLabel = (source?: string): string => {
  if (source === 'recurring_bill') return 'Auto-Bill';
  if (source === 'reconciliation') return 'Reconciliation';
  if (source === 'manual') return 'Manual';
  return source ? source.replace(/_/g, ' ') : 'Manual';
};

const CATEGORY_CHOICES: { label: string; category: TransactionCategory; isDebt: boolean }[] = [
  { label: 'Payment', category: 'payment', isDebt: true },
  { label: 'Single purchase', category: 'purchase', isDebt: true },
  { label: 'Subscription', category: 'subscription', isDebt: true },
  { label: 'Utilities', category: 'utilities', isDebt: true },
  { label: 'Interest', category: 'interest', isDebt: true },
  { label: 'Fee / Annual Fee', category: 'fee', isDebt: true },
  { label: 'Refund', category: 'refund', isDebt: true },
  { label: 'Debit Bill (Checking)', category: 'debit_bill', isDebt: false },
  { label: 'Debit Spending (Checking)', category: 'debit_spending', isDebt: false },
];

const EMPTY_TRANSACTIONS: LedgerTransaction[] = [];
const EMPTY_BILLS: RecurringBill[] = [];
const EMPTY_STRING_LIST: readonly string[] = [];

export function TransactionsScreen({
  debts,
  transactions = EMPTY_TRANSACTIONS,
  currencySymbol = '$',
  currencyCode = 'USD',
  onSettings,
  onAddTransaction,
  onUpdateTransaction,
  onDeleteTransaction,
  recurringBills = EMPTY_BILLS,
  obligationSchedules,
  debtPaymentSplitPlansByDebtId = {},
  onSaveDebtPaymentSplitPlans,
  billPaymentSplitPlansByBillId = {},
  onSaveBillPaymentSplitPlans,
  loanBillPairs = {}, identityLoanBillPairs = {},
  historicalBillIdsByDebtId = {}, excludedObligationDebtIds = EMPTY_STRING_LIST,
  excludedObligationBillIds = EMPTY_STRING_LIST,
  householdTimeZone,
  canEdit = true,
  onRecordBillPayment,
  onConfirmAnnualFee,
  initialTransactionId,
  initialSection = 'History',
  onEditDismiss,
}: {
  initialTransactionId?: string | null;
  initialSection?: string;
  onEditDismiss?: () => void;
  debts: DebtItem[];
  transactions?: LedgerTransaction[];
  currencySymbol?: string;
  currencyCode?: string;
  onSettings: () => void;
  onAddTransaction?: (tx: LedgerTransaction) => unknown;
  onUpdateTransaction?: (tx: LedgerTransaction) => unknown;
  onUpdateTransactions?: (txs: LedgerTransaction[]) => unknown;
  onDeleteTransaction?: (txId: string) => unknown;
  recurringBills?: RecurringBill[];
  obligationSchedules?: ObligationSchedules;
  debtPaymentSplitPlansByDebtId?: DebtPaymentSplitPlansByDebtId;
  onSaveDebtPaymentSplitPlans?: (plans: DebtPaymentSplitPlansByDebtId) => Promise<void>;
  billPaymentSplitPlansByBillId?: BillPaymentSplitPlansByBillId;
  onSaveBillPaymentSplitPlans?: (plans: BillPaymentSplitPlansByBillId) => Promise<void>;
  loanBillPairs?: Readonly<Record<string, string>>;
  identityLoanBillPairs?: Readonly<Record<string, string>>;
  historicalBillIdsByDebtId?: Readonly<Record<string, readonly string[]>>;
  excludedObligationDebtIds?: readonly string[];
  excludedObligationBillIds?: readonly string[];
  householdTimeZone?: string;
  canEdit?: boolean;
  onRecordBillPayment?: (bill: RecurringBill, dueCycle: DateOnly, amount?: Money) => unknown;
  onConfirmAnnualFee?: (debtId: string, renewalDate: DateOnly) => Promise<{ outcome: 'confirmed' | 'pending' } | void> | { outcome: 'confirmed' | 'pending' } | void;
}) {
  const { isLight, palette, ctaBg, ctaFg } = useNativeAppearance();
  const insets = useSafeAreaInsets();
  const initialEditingTx = initialTransactionId
    ? transactions.find(tx => tx.id === initialTransactionId && tx.deletedAt === null) ?? null
    : null;
  const [tab, setTab] = useState(initialSection === 'Scheduled' ? 'Scheduled' : 'History');
  const [scheduledMonthOffset, setScheduledMonthOffset] = useState(0);
  const [scheduledDate, setScheduledDate] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('all');
  const [periodIdx, setPeriodIdx] = useState(0); // 0 = Current month, 1 = Previous month, 2 = All time
  const [typeIdx, setTypeIdx] = useState(0); // 0 = All Types, 1 = Payments, 2 = Charges/Fees, 3 = Debit Only
  const [draftAccountId, setDraftAccountId] = useState('all');
  const [draftPeriodIdx, setDraftPeriodIdx] = useState(0);
  const [draftTypeIdx, setDraftTypeIdx] = useState(0);
  const [sortAsc, setSortAsc] = useState(false); // false = newest first, true = oldest first
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // Add Transaction Form State
  const [newPayee, setNewPayee] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCategoryIdx, setNewCategoryIdx] = useState(0);
  const [newAccountId, setNewAccountId] = useState(debts[0]?.id ?? '');
  const [newDate, setNewDate] = useState(() => currentHouseholdDate(householdTimeZone));
  const [newAppliesToDate, setNewAppliesToDate] = useState('');
  const [newPrincipal, setNewPrincipal] = useState('');
  const [newInterest, setNewInterest] = useState('');
  const [newEscrow, setNewEscrow] = useState('');
  const [newFee, setNewFee] = useState('');
  const [savingTx, setSavingTx] = useState(false);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [addPicker, setAddPicker] = useState<'category' | 'debt' | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerMonth, setDatePickerMonth] = useState(() => currentHouseholdMonth(householdTimeZone));
  const [formError, setFormError] = useState('');
  const [billError, setBillError] = useState('');
  const [pendingBillCycle, setPendingBillCycle] = useState<string | null>(null);
  const [splitPlanRow, setSplitPlanRow] = useState<ScheduledObligationRow | null>(null);
  const [splitCount, setSplitCount] = useState<2 | 3 | 4>(2);
  const [extraDays, setExtraDays] = useState(['20', '25']);
  const [extraOffsets, setExtraOffsets] = useState<(0 | -1)[]>([0, 0]);
  const [expandedPlans, setExpandedPlans] = useState<Record<string, boolean>>({});
  const [splitDay1, setSplitDay1] = useState('1');
  const [splitDay2, setSplitDay2] = useState('15');
  const [splitMonthOffset1, setSplitMonthOffset1] = useState<0 | -1>(0);
  const [splitMonthOffset2, setSplitMonthOffset2] = useState<0 | -1>(0);
  const [savingSplitPlan, setSavingSplitPlan] = useState(false);

  const openSplitPlanModal = (row: ScheduledObligationRow) => {
    if (!canEdit) return;
    setBillError('');
    setSplitPlanRow(row);
    const isDebt = row.kind === 'debt';
    const entityId = isDebt ? row.debt?.id : row.bill?.id;
    const plan = entityId ? (isDebt ? debtPaymentSplitPlansByDebtId[entityId] : billPaymentSplitPlansByBillId[entityId]) : undefined;
    const existing = [...(plan?.terms ?? [])].reverse().find(term => term.effectiveMonth <= row.dueCycleMonth);
    setSplitCount(existing?.count ?? 2);
    setExtraDays([String(existing?.day3 ?? 20), String(existing?.day4 ?? 25)]);
    setExtraOffsets([existing?.monthOffset3 ?? 0, existing?.monthOffset4 ?? 0]);
    if (existing) {
      setSplitDay1(String(existing.day1));
      setSplitDay2(String(existing.day2));
      setSplitMonthOffset1(existing.monthOffset1 ?? 0);
      setSplitMonthOffset2(existing.monthOffset2 ?? 0);
    } else {
      const dueDayNum = Number(row.dueDate.slice(8, 10)) || 15;
      if (dueDayNum <= 10) {
        setSplitMonthOffset1(-1);
        setSplitDay1('20');
        setSplitMonthOffset2(0);
        setSplitDay2(String(Math.max(1, dueDayNum - 2)));
      } else {
        setSplitMonthOffset1(0);
        setSplitDay1('1');
        setSplitMonthOffset2(0);
        setSplitDay2(String(Math.max(2, Math.min(15, dueDayNum - 1))));
      }
    }
  };

  // Edit Transaction Form State
  const [editingTx, setEditingTx] = useState<LedgerTransaction | null>(initialEditingTx);
  const [editPayee, setEditPayee] = useState(initialEditingTx?.payee ?? '');
  const [editAmount, setEditAmount] = useState(initialEditingTx ? moneyToMajor(initialEditingTx.amount).toFixed(2) : '');
  const [editCategoryIdx, setEditCategoryIdx] = useState(() => initialEditingTx ? Math.max(0, CATEGORY_CHOICES.findIndex(item => item.category === initialEditingTx.category)) : 0);
  const [editAccountId, setEditAccountId] = useState<string | null>(initialEditingTx?.accountId ?? null);
  const [editDate, setEditDate] = useState(initialEditingTx?.date ?? '');
  const [editMemo, setEditMemo] = useState(initialEditingTx?.memo ?? '');
  const [editPrincipal, setEditPrincipal] = useState(initialEditingTx?.principalAmount ? moneyToMajor(initialEditingTx.principalAmount).toFixed(2) : '');
  const [editInterest, setEditInterest] = useState(initialEditingTx?.interestAmount ? moneyToMajor(initialEditingTx.interestAmount).toFixed(2) : '');
  const [editEscrow, setEditEscrow] = useState(initialEditingTx?.escrowAmount ? moneyToMajor(initialEditingTx.escrowAmount).toFixed(2) : '');
  const [editFee, setEditFee] = useState(initialEditingTx?.feeAmount ? moneyToMajor(initialEditingTx.feeAmount).toFixed(2) : '');
  const [editPicker, setEditPicker] = useState<'category' | 'debt' | null>(null);
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingTx, setDeletingTx] = useState(false);
  const [confirmDeleteTx, setConfirmDeleteTx] = useState<LedgerTransaction | null>(null);
  const [confirmRemoveSplitRow, setConfirmRemoveSplitRow] = useState<ScheduledObligationRow | null>(null);

  const todayStr = currentHouseholdDate(householdTimeZone);
  const currentMonthStr = currentHouseholdMonth(householdTimeZone);
  const prevMonthStr = getPreviousMonthString(currentMonthStr);

  const accountOptions = [
    { label: 'All accounts', id: 'all' },
    ...debts.map(d => ({ label: d.name, id: `debt:${d.id}` })),
    ...recurringBills.filter(b => !Object.values(identityLoanBillPairs).includes(b.id)).map(b => ({ label: b.name, id: `bill:${b.id}` })),
  ];
  const validAccountIds = new Set(accountOptions.map(option => option.id));
  const effectiveAccountId = accountId !== 'all' && validAccountIds.has(accountId) ? accountId : 'all';
  const effectiveDraftAccountId = draftAccountId !== 'all' && validAccountIds.has(draftAccountId) ? draftAccountId : 'all';
  const debtNamesById = new Map(debts.map(debt => [debt.id, debt.name]));
  const linkedDebtNameByBillId = new Map<string, string | undefined>(Object.entries(identityLoanBillPairs).map(([debtId, billId]) => [billId, debtNamesById.get(debtId)] as const));

  const periodFilterOptions = [
    { value: 0, label: 'Current month' },
    { value: 1, label: 'Previous month' },
    { value: 2, label: 'All time' },
  ] as const;
  const typeFilterOptions = [
    { value: 0, label: 'All types' },
    { value: 1, label: 'Payments' },
    { value: 2, label: 'Charges and fees' },
    { value: 3, label: 'Debit only' },
  ] as const;
  const openFilters = () => {
    setDraftPeriodIdx(periodIdx);
    setDraftAccountId(effectiveAccountId);
    setDraftTypeIdx(typeIdx);
    setShowFilters(true);
  };
  const filterRadio = (label: string, checked: boolean, onPress: () => void, key: string) => (
    <Pressable key={key} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked }} onPress={onPress}
      style={{ minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, backgroundColor: checked ? palette.tint : 'transparent' }}>
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: checked ? palette.brand : palette.muted, alignItems: 'center', justifyContent: 'center' }}>
        {checked ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: palette.brand }} /> : null}
      </View>
      <Text style={[ui.text, { flex: 1 }]}>{label}</Text>
    </Pressable>
  );

  const categoryDropdownOptions: readonly DropdownOption<number>[] = CATEGORY_CHOICES.map((c, idx) => ({
    value: idx,
    label: c.label,
    subtitle: c.isDebt ? 'Debt account transaction' : 'Checking cashflow ($0 debt)',
    icon: c.category === 'payment' ? 'check' : (c.isDebt ? 'creditCard' : 'calendar'),
  }));

  const debtAccountDropdownOptions: readonly DropdownOption<string>[] = debts.map(d => ({
    value: d.id,
    label: d.name,
    subtitle: `Balance: ${formatCurrency(d.balance, currencySymbol)}`,
    icon: 'creditCard',
  }));

  const selectedDebtId = newAccountId || debts[0]?.id || '';
  const selectedDebt = debts.find(debt => debt.id === selectedDebtId);
  const selectedDebtSchedule = selectedDebt ? resolveEffectiveDebtSchedule(obligationSchedules, selectedDebt.id, historicalBillIdsByDebtId?.[selectedDebt.id]) : undefined;
  const dueCycleOptions: readonly DropdownOption<string>[] = [
    { value: '', label: 'No due cycle', subtitle: 'Leave this payment unassigned to a due date' },
    ...(selectedDebt
      ? [0, 1, 2].flatMap(monthOffset => {
          let month = currentMonthStr;
          for (let offset = 0; offset < monthOffset; offset++) month = getNextMonthString(month);
          const cycle = selectedDebtSchedule ? getObligationCycle(selectedDebtSchedule, month) : undefined;
          if (cycle === null || (!selectedDebtSchedule && !selectedDebt.dueDay)) return [];
          const date = cycle?.dueDate ?? resolveRecurringBillDate(month, selectedDebt.dueDay!);
          const labelDate = new Date(`${date}T12:00:00`);
          const label = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(labelDate);
          return { value: date, label: `Due ${label}`, subtitle: selectedDebt.dueDay ? `Apply this payment to ${label}` : `Link this payment to the ${label} cycle` };
        })
      : []),
  ];


  // Filter transactions
  const filtered = transactions.filter(tx => {
    if (tx.deletedAt !== null) return false;

    // Period filter
    if (periodIdx === 0 && !tx.date.startsWith(currentMonthStr)) return false;
    if (periodIdx === 1 && !tx.date.startsWith(prevMonthStr)) return false;

    // Account filter
    const selectedAcc = { id: effectiveAccountId };
    const identifiedBill = recurringBills.some(b => transactionHasBillId(tx, b.id));
    if (selectedAcc.id === 'debit' && (tx.accountId !== null || identifiedBill)) return false;
    if (selectedAcc.id.startsWith('debt:')) {
      const debtId = selectedAcc.id.slice(5);
      if (tx.accountId !== debtId && !(tx.accountId === null && identityLoanBillPairs[debtId] && transactionHasBillId(tx, identityLoanBillPairs[debtId]))) return false;
    }
    if (selectedAcc.id.startsWith('bill:') && !transactionHasBillId(tx, selectedAcc.id.slice(5))) return false;

    // Type filter
    const dir = classifyCategoryDirection(tx.category);
    if (typeIdx === 1 && dir !== 'decrease_debt') return false; // Payments / refunds
    if (typeIdx === 2 && dir !== 'increase_debt') return false; // Charges / interest / fees
    if (typeIdx === 3 && dir !== 'cash_only') return false; // Debit only

    // Search query
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchPayee = tx.payee.toLowerCase().includes(q);
      const matchCategory = tx.category.toLowerCase().includes(q);
      const matchMemo = tx.memo ? tx.memo.toLowerCase().includes(q) : false;
      if (!matchPayee && !matchCategory && !matchMemo) return false;
    }

    return true;
  });

  const debtById = useMemo(() => new Map(debts.map(debt => [debt.id, debt])), [debts]);

  const scheduledAllRows = useMemo(
    () =>
      tab === 'Scheduled' || splitPlanRow !== null
        ? getScheduledObligationRows({
            debts: debts.filter(debt => !excludedObligationDebtIds.includes(debt.id)),
            recurringBills,
            transactions,
            asOfDate: todayStr,
            currencyCode,
            schedules: obligationSchedules,
            loanBillPairs,
            historicalBillIdsByDebtId,
            excludedBillIds: excludedObligationBillIds,
          })
        : [],
    [tab, splitPlanRow, debts, recurringBills, transactions, todayStr, currencyCode, obligationSchedules, loanBillPairs, historicalBillIdsByDebtId, excludedObligationDebtIds, excludedObligationBillIds],
  );

  const scheduledPlannedEvents = useMemo(
    () =>
      tab === 'Scheduled' && scheduledAllRows.length > 0
        ? getPlannedDebtInstallments({
            rows: scheduledAllRows,
            plans: debtPaymentSplitPlansByDebtId,
            billPlans: billPaymentSplitPlansByBillId,
            historicalBillIdsByDebtId,
            transactions,
            asOfDate: todayStr,
          })
        : [],
    [tab, scheduledAllRows, debtPaymentSplitPlansByDebtId, billPaymentSplitPlansByBillId, historicalBillIdsByDebtId, transactions, todayStr],
  );

  // Sort transactions by date
  const sorted = [...filtered].sort((a, b) => {
    if (sortAsc) return a.date.localeCompare(b.date);
    return b.date.localeCompare(a.date);
  });

  // Calculate summary metrics for the filtered period
  let totalPaymentsMinor = 0;
  let totalInterestFeesMinor = 0;
  for (const tx of filtered) {
    if (tx.category === 'payment' || tx.category === 'refund') {
      totalPaymentsMinor += tx.amount.minorUnits;
    }
    if (['interest', 'fee', 'annual_fee'].includes(tx.category)) {
      totalInterestFeesMinor += tx.amount.minorUnits;
    }
  }

  const handleSaveTransaction = async () => {
    if (!canEdit) return;
    setFormError('');
    if (!newAmount || parseFloat(newAmount) <= 0) {
      setFormError('Please enter a valid amount');
      return;
    }

    const catOption = CATEGORY_CHOICES[newCategoryIdx];
    let accountId: string | null = null;

    if (catOption.isDebt) {
      if (!selectedDebt) {
        setFormError(debts.length === 0 ? 'Please add a debt account on the Debt tab first' : 'Select a debt account for this transaction');
        return;
      }
      accountId = selectedDebt.id;
    }

    setSavingTx(true);
    try {
      const actualDate = parseDateOnly(newDate.trim());
      const appliesToDate = newAppliesToDate.trim() ? parseDateOnly(newAppliesToDate.trim()) : null;
      const moneyAmount = parseMoney(newAmount, currencyCode);

      const principalAmount = newPrincipal.trim() ? parseMoney(newPrincipal.trim(), currencyCode) : null;
      const interestAmount = newInterest.trim() ? parseMoney(newInterest.trim(), currencyCode) : null;
      const escrowAmount = newEscrow.trim() ? parseMoney(newEscrow.trim(), currencyCode) : null;
      const feeAmount = newFee.trim() ? parseMoney(newFee.trim(), currencyCode) : null;

      const tx: LedgerTransaction = {
        id: `tx:${Crypto.randomUUID()}`,
        accountId,
        date: actualDate,
        appliesToDate,
        amount: moneyAmount,
        category: catOption.category,
        payee: newPayee.trim() || (catOption.category === 'payment' ? 'Payment' : catOption.label),
        memo: `Manual entry (${catOption.label})`,
        source: 'manual',
        reconciled: false,
        createdAt: new Date().toISOString(),
        deletedAt: null,
        principalAmount,
        interestAmount,
        escrowAmount,
        feeAmount,
      };

      if (onAddTransaction) {
        const res = await onAddTransaction(tx);
        if (res && (res as { outcome?: string }).outcome === 'pending') {
          Alert.alert(
            'Saved Locally (Pending Confirmation)',
            'Transaction recorded locally. Confirmation will be verified upon connecting to the server.',
          );
        }
      }
      setShowAddForm(false);
      setShowMoreDetails(false);
      setAddPicker(null);
      setShowDatePicker(false);
      setNewPayee('');
      setNewAmount('');
      setNewAppliesToDate('');
      setNewPrincipal('');
      setNewInterest('');
      setNewEscrow('');
      setNewFee('');
    } catch (e) {
      const msg = (e as Error).message || 'Unable to save transaction';
      setFormError(msg);
      if (msg.includes('conflict') || msg.includes('Conflict')) {
        Alert.alert('Save Conflict', msg);
      }
    } finally {
      setSavingTx(false);
    }
  };

  const closeAddForm = () => {
    setShowAddForm(false);
    setShowMoreDetails(false);
    setAddPicker(null);
    setShowDatePicker(false);
    setFormError('');
  };

  const handleOpenEdit = (tx: LedgerTransaction) => {
    const isPaymentLike = tx.category === 'payment' && (!tx.payee || /^Payment to\b/i.test(tx.payee));
    const isBalanceAdj = tx.category === 'credit_adjustment' || tx.category === 'balance_adjustment' || /^Reconciliation credit adjustment$/i.test(tx.payee || '');
    setEditingTx(tx);
    setEditPayee(isPaymentLike ? 'Payment' : isBalanceAdj ? 'Balance Adjustment' : tx.payee);
    setEditAmount(moneyToMajor(tx.amount).toFixed(2));
    const catIdx = CATEGORY_CHOICES.findIndex(c => c.category === tx.category);
    setEditCategoryIdx(catIdx >= 0 ? catIdx : 0);
    setEditAccountId(tx.accountId);
    setEditDate(tx.date);
    setEditMemo(tx.memo || '');
    setEditPrincipal(tx.principalAmount ? moneyToMajor(tx.principalAmount).toFixed(2) : '');
    setEditInterest(tx.interestAmount ? moneyToMajor(tx.interestAmount).toFixed(2) : '');
    setEditEscrow(tx.escrowAmount ? moneyToMajor(tx.escrowAmount).toFixed(2) : '');
    setEditFee(tx.feeAmount ? moneyToMajor(tx.feeAmount).toFixed(2) : '');
    setEditPicker(null);
    setEditError('');
  };

  const handleSaveEdit = async () => {
    if (!canEdit || !editingTx || savingEdit) return;
    setEditError('');
    const parsedAmt = parseFloat(editAmount);
    if (Number.isNaN(parsedAmt) || parsedAmt <= 0) {
      setEditError('Please enter a valid amount');
      return;
    }
    const catOption = CATEGORY_CHOICES[editCategoryIdx];
    if (catOption.isDebt && !editAccountId) {
      setEditError(debts.length === 0 ? 'Please add a debt account on the Debt tab first' : 'Select a debt account for this transaction');
      return;
    }

    setSavingEdit(true);
    try {
      const actualDate = parseDateOnly(editDate.trim());
      const moneyAmount = parseMoney(editAmount, currencyCode);
      const principalAmount = editPrincipal.trim() ? parseMoney(editPrincipal.trim(), currencyCode) : null;
      const interestAmount = editInterest.trim() ? parseMoney(editInterest.trim(), currencyCode) : null;
      const escrowAmount = editEscrow.trim() ? parseMoney(editEscrow.trim(), currencyCode) : null;
      const feeAmount = editFee.trim() ? parseMoney(editFee.trim(), currencyCode) : null;

      const updatedTx: LedgerTransaction = {
        ...editingTx,
        accountId: catOption.isDebt ? editAccountId : null,
        date: actualDate,
        amount: moneyAmount,
        category: catOption.category,
        payee: editPayee.trim() || (catOption.category === 'payment' ? 'Payment' : catOption.label),
        memo: editMemo.trim() || undefined,
        principalAmount,
        interestAmount,
        escrowAmount,
        feeAmount,
      };

      if (onUpdateTransaction) {
        const res = await onUpdateTransaction(updatedTx);
        if (res && (res as { outcome?: string }).outcome === 'pending') {
          Alert.alert(
            'Updated Locally (Pending Confirmation)',
            'Transaction update saved locally. Confirmation will be verified upon connecting to the server.',
          );
        }
      }
      setEditingTx(null); onEditDismiss?.();
    } catch (e) {
      const msg = (e as Error).message || 'Unable to save transaction';
      setEditError(msg);
      if (msg.includes('conflict') || msg.includes('Conflict')) {
        Alert.alert('Update Conflict', msg);
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteTx = async () => {
    const target = confirmDeleteTx ?? editingTx;
    if (!canEdit || !target || deletingTx) return;
    setDeletingTx(true);
    try {
      if (onDeleteTransaction) {
        const res = await onDeleteTransaction(target.id);
        if (res && (res as { outcome?: string }).outcome === 'pending') {
          Alert.alert(
            'Deleted Locally (Pending Confirmation)',
            'Transaction deletion recorded locally. Confirmation will be verified upon connecting to the server.',
          );
        }
      } else if (onUpdateTransaction) {
        await onUpdateTransaction({
          ...target,
          deletedAt: new Date().toISOString(),
        });
      }
      setConfirmDeleteTx(null);
      setEditingTx(null); onEditDismiss?.();
    } catch (e) {
      const msg = (e as Error).message || 'Unable to delete transaction';
      setEditError(msg);
      setConfirmDeleteTx(null);
      if (msg.includes('conflict') || msg.includes('Conflict')) {
        Alert.alert('Delete Conflict', msg);
      }
    } finally {
      setDeletingTx(false);
    }
  };

  // Live Balance Preview Calculation for Edit Modal
  const editCatOption = CATEGORY_CHOICES[editCategoryIdx];
  const targetEditDebt = debts.find(d => d.id === editAccountId);
  let editCurrentBal = targetEditDebt ? targetEditDebt.balance : 0;
  let editAfterBal = editCurrentBal;

  if (targetEditDebt) {
    const curMoney = moneyFromMajor(targetEditDebt.balance, currencyCode);
    let previewMoney = curMoney;

    // 1. Revert original transaction if it targeted this debt and was active
    if (editingTx && editingTx.accountId === targetEditDebt.id && editingTx.deletedAt === null) {
      const origDelta = calculateTransactionBalanceDelta(editingTx, targetEditDebt.category);
      previewMoney = addMoney(previewMoney, makeMoney(currencyCode, -origDelta.minorUnits));
    }

    // 2. Apply newly configured amount and category
    const parsedAmt = parseFloat(editAmount);
    if (!Number.isNaN(parsedAmt) && parsedAmt > 0 && editCatOption.isDebt) {
      try {
        const newAmtMoney = parseMoney(editAmount, currencyCode);
        const pAmt = editPrincipal.trim() ? parseMoney(editPrincipal.trim(), currencyCode) : null;
        const iAmt = editInterest.trim() ? parseMoney(editInterest.trim(), currencyCode) : null;
        const eAmt = editEscrow.trim() ? parseMoney(editEscrow.trim(), currencyCode) : null;
        const fAmt = editFee.trim() ? parseMoney(editFee.trim(), currencyCode) : null;

        const candidateTx: LedgerTransaction = {
          ...editingTx!,
          accountId: targetEditDebt.id,
          amount: newAmtMoney,
          category: editCatOption.category,
          principalAmount: pAmt,
          interestAmount: iAmt,
          escrowAmount: eAmt,
          feeAmount: fAmt,
        };
        const newDelta = calculateTransactionBalanceDelta(candidateTx, targetEditDebt.category);
        previewMoney = addMoney(previewMoney, newDelta);
      } catch {
        // invalid input ignored for preview
      }
    }

    editAfterBal = moneyToMajor(previewMoney);
  }

  return (
    <FinancialScreen
      title="Transactions"
      segments={['History', 'Scheduled']}
      selected={tab}
      onSelect={nextTab => {
        if (nextTab !== tab) {
          setScheduledDate(null);
          if (nextTab === 'Scheduled') setScheduledMonthOffset(0);
        }
        setTab(nextTab);
        if (nextTab !== 'History') closeAddForm();
      }}
      onSettings={onSettings}
      onAdd={canEdit && !showAddForm ? () => { setFormError(''); setShowMoreDetails(false); setAddPicker(null); setShowAddForm(true); } : undefined}
      addLabel="Add Transaction"
    >
      {canEdit && showAddForm ? (
        <SheetModal
          visible={canEdit && showAddForm}
          onClose={closeAddForm}
          contentSized
          closeLabel="Dismiss form"
          footer={(
            <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 18, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface }}>
              <Pressable
                accessibilityRole="button"
                disabled={savingTx}
                onPress={handleSaveTransaction}
                style={[ui.button, { minHeight: 46, backgroundColor: ctaBg, borderColor: ctaBg, justifyContent: 'center', opacity: savingTx ? 0.65 : 1 }]}
              >
                <Text style={[ui.buttonText, { color: ctaFg, fontSize: 15, fontWeight: '700', textAlign: 'center' }]}>
                  {savingTx ? 'Saving\u2026' : 'Save Transaction'}
                </Text>
              </Pressable>
            </View>
          )}
        >
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
            <View style={{ width: 44, height: 44 }} accessible={false} />
            <Text accessibilityRole="header" style={{ color: palette.text, fontSize: 17, fontWeight: '700', textAlign: 'center', flex: 1 }}>Add transaction</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss form"
              hitSlop={10}
              onPress={closeAddForm}
              style={{ width: 44, height: 44, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
            >
              <AppIcon name="close" size={20} color={palette.muted} />
            </Pressable>
          </View>

          {!!formError && (
            <Text accessibilityRole="alert" style={[ui.small, { color: appearanceColor('#F08B78', isLight) }]}>{formError}</Text>
          )}

          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: isLight ? palette.surface : palette.raised, paddingHorizontal: 15, overflow: 'hidden' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Transaction category: ${CATEGORY_CHOICES[newCategoryIdx].label}`}
              accessibilityHint="Required"
              onPress={() => setAddPicker('category')}
              style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 }}
            >
              <Text style={{ color: palette.text, fontSize: 15, fontWeight: '500' }}>Transaction category *</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                <Text numberOfLines={1} style={{ color: palette.text, fontSize: 15, fontWeight: '500' }}>{CATEGORY_CHOICES[newCategoryIdx].label}</Text>
                <AppIcon name="chevronDown" size={14} color={palette.muted} />
              </View>
            </Pressable>

            {CATEGORY_CHOICES[newCategoryIdx].isDebt && debts.length > 0 ? (
              <>
                <View style={{ height: 1, backgroundColor: palette.border }} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Debt account: ${selectedDebt?.name ?? 'Select account'}`}
                  accessibilityHint="Required"
                  onPress={() => setAddPicker('debt')}
                  style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 }}
                >
                  <Text style={{ color: palette.text, fontSize: 15, fontWeight: '500' }}>Debt account *</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                    <Text numberOfLines={1} style={{ color: palette.text, fontSize: 15, fontWeight: '500' }}>{selectedDebt?.name ?? 'Select account'}</Text>
                    <AppIcon name="chevronDown" size={14} color={palette.muted} />
                  </View>
                </Pressable>
              </>
            ) : null}

            <View style={{ height: 1, backgroundColor: palette.border }} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Transaction date: ${newDate}`}
              accessibilityHint="Required"
              onPress={() => { setDatePickerMonth(newDate.slice(0, 7)); setShowDatePicker(true); }}
              style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 }}
            >
              <Text style={{ color: palette.text, fontSize: 15, fontWeight: '500' }}>Transaction date *</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Text style={{ color: palette.brand, fontSize: 15, fontWeight: '600' }}>
                  {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${newDate}T12:00:00`))}
                </Text>
                <AppIcon name="calendar" size={16} color={palette.brand} />
              </View>
            </Pressable>

            <View style={{ height: 1, backgroundColor: palette.border }} />
            <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 2 }}>
              <Text style={{ color: palette.text, fontSize: 15, fontWeight: '500' }}>Amount *</Text>
              <TextInput
                accessibilityLabel="Transaction amount"
                accessibilityHint="Required"
                placeholder="0.00"
                placeholderTextColor={palette.muted}
                keyboardType="decimal-pad"
                textAlign="right"
                value={newAmount}
                onChangeText={val => setNewAmount(acceptMoneyEdit(newAmount, val, currencyCode))}
                style={{ flex: 1, minWidth: 96, minHeight: 44, paddingVertical: 8, paddingHorizontal: 0, textAlign: 'right', color: palette.text, fontSize: 15, fontWeight: '600' }}
              />
            </View>

            <View style={{ height: 1, backgroundColor: palette.border }} />
            <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <Text style={{ color: palette.text, fontSize: 15, fontWeight: '500' }}>Add a note</Text>
                <Text style={{ color: palette.muted, fontSize: 12 }}>optional</Text>
              </View>
              <TextInput
                accessibilityLabel="Add a note"
                placeholder="Optional note"
                placeholderTextColor={palette.muted}
                textAlign="right"
                value={newPayee}
                onChangeText={setNewPayee}
                style={{ flex: 1, minWidth: 96, minHeight: 44, paddingVertical: 8, paddingHorizontal: 0, textAlign: 'right', color: palette.text, fontSize: 14 }}
              />
            </View>
          </View>

          {CATEGORY_CHOICES[newCategoryIdx].isDebt && selectedDebt && newAmount ? (() => {
            try {
              const amount = parseMoney(newAmount, currencyCode);
              if (moneyToMajor(amount) <= 0) return null;
              const preview: LedgerTransaction = {
                id: 'preview', accountId: selectedDebt.id, date: todayStr,
                appliesToDate: null, amount, category: CATEGORY_CHOICES[newCategoryIdx].category,
                payee: '', memo: '', source: 'manual', reconciled: false, createdAt: '', deletedAt: null,
                principalAmount: newPrincipal.trim() ? parseMoney(newPrincipal, currencyCode) : null,
                interestAmount: newInterest.trim() ? parseMoney(newInterest, currencyCode) : null,
                escrowAmount: newEscrow.trim() ? parseMoney(newEscrow, currencyCode) : null,
                feeAmount: newFee.trim() ? parseMoney(newFee, currencyCode) : null,
              };
              const after = addMoney(moneyFromMajor(selectedDebt.balance, currencyCode), calculateTransactionBalanceDelta(preview, selectedDebt.category));
              return <View style={[ui.row, { justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: palette.tint }]}>
                <View><Text style={ui.small}>Current balance</Text><Text style={ui.heading}>{formatCurrency(selectedDebt.balance, currencySymbol)}</Text></View>
                <AppIcon name="chevronRight" size={16} color={palette.brand} />
                <View style={{ alignItems: 'flex-end' }}><Text style={ui.small}>After saving</Text><Text style={ui.heading}>{formatCurrency(moneyToMajor(after), currencySymbol)}</Text></View>
              </View>;
            } catch { return null; }
          })() : null}

          {CATEGORY_CHOICES[newCategoryIdx].category === 'payment' ? (
            <View style={{ gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showMoreDetails }}
                onPress={() => setShowMoreDetails(prev => !prev)}
                style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}
              >
                <Text style={{ color: palette.brand, fontSize: 14, fontWeight: '600' }}>More details</Text>
                <AppIcon name={showMoreDetails ? 'chevronDown' : 'chevronRight'} size={15} color={palette.brand} />
              </Pressable>

              {showMoreDetails ? (
                <View style={{ gap: 10 }}>
                  <SelectDropdown
                    label="Applies to payment cycle (optional)"
                    sheetTitle="Choose Payment Due Cycle"
                    value={newAppliesToDate}
                    options={dueCycleOptions}
                    onSelect={setNewAppliesToDate}
                    placeholder="Choose a due cycle"
                  />

                  {selectedDebt && (selectedDebt.category === 'Mortgage' || selectedDebt.category === 'Auto loan') ? (
                    <View style={{ padding: 12, backgroundColor: palette.raised, borderRadius: 12, borderWidth: 1, borderColor: palette.border, gap: 6 }}>
                      <Text style={[ui.small, { color: appearanceColor('#76DCB9', isLight), fontWeight: '700' }]}>PAYMENT BREAKDOWN (OPTIONAL)</Text>
                      <Text style={[ui.small, { color: palette.muted, marginBottom: 4 }]}>
                        If unknown, full payment is recorded in cashflow while loan principal remains unchanged.
                      </Text>
                      <Text style={ui.small}>Principal reduction</Text>
                      <TextInput
                        placeholder="0.00"
                        placeholderTextColor={palette.muted}
                        keyboardType="decimal-pad"
                        value={newPrincipal}
                        onChangeText={val => setNewPrincipal(acceptMoneyEdit(newPrincipal, val, currencyCode))}
                        style={[ui.input, { backgroundColor: palette.surface, borderColor: palette.inputBorder, color: palette.text }]}
                      />
                      <Text style={[ui.small, { marginTop: 4 }]}>Interest paid</Text>
                      <TextInput
                        placeholder="0.00"
                        placeholderTextColor={palette.muted}
                        keyboardType="decimal-pad"
                        value={newInterest}
                        onChangeText={val => setNewInterest(acceptMoneyEdit(newInterest, val, currencyCode))}
                        style={[ui.input, { backgroundColor: palette.surface, borderColor: palette.inputBorder, color: palette.text }]}
                      />
                      {selectedDebt.category === 'Mortgage' ? (
                        <>
                          <Text style={[ui.small, { marginTop: 4 }]}>Escrow (taxes & insurance)</Text>
                          <TextInput
                            placeholder="0.00"
                            placeholderTextColor={palette.muted}
                            keyboardType="decimal-pad"
                            value={newEscrow}
                            onChangeText={val => setNewEscrow(acceptMoneyEdit(newEscrow, val, currencyCode))}
                            style={[ui.input, { backgroundColor: palette.surface, borderColor: palette.inputBorder, color: palette.text }]}
                          />
                        </>
                      ) : null}
                      <Text style={[ui.small, { marginTop: 4 }]}>Fees</Text>
                      <TextInput
                        placeholder="0.00"
                        placeholderTextColor={palette.muted}
                        keyboardType="decimal-pad"
                        value={newFee}
                        onChangeText={val => setNewFee(acceptMoneyEdit(newFee, val, currencyCode))}
                        style={[ui.input, { backgroundColor: palette.surface, borderColor: palette.inputBorder, color: palette.text }]}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          <AdaptiveModal visible={addPicker !== null} transparent animationType="fade" onRequestClose={() => setAddPicker(null)}>
            <TouchableWithoutFeedback onPress={() => setAddPicker(null)}>
              <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.72)', justifyContent: 'flex-end' }}>
                <TouchableWithoutFeedback>
                  <View style={{ backgroundColor: palette.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: palette.border, maxHeight: '75%', paddingBottom: bottomInsetPadding(insets.bottom, 16) }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: palette.border }}>
                      <Text style={{ fontSize: 17, fontWeight: '700', color: palette.text }}>
                        {addPicker === 'category' ? 'Select Transaction Category' : 'Select Target Debt Account'}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close picker"
                        onPress={() => setAddPicker(null)}
                        style={{ width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <AppIcon name="close" size={20} color={palette.muted} />
                      </Pressable>
                    </View>
                    <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10 }} keyboardShouldPersistTaps="handled">
                      {addPicker === 'category'
                        ? categoryDropdownOptions.map(option => {
                            const isSelected = option.value === newCategoryIdx;
                            return (
                              <Pressable
                                key={String(option.value)}
                                accessibilityRole="button"
                                accessibilityState={{ selected: isSelected }}
                                onPress={() => { setNewCategoryIdx(option.value); setAddPicker(null); }}
                                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, marginVertical: 3, ...(isSelected ? { backgroundColor: palette.tint, borderWidth: 1, borderColor: palette.border } : {}) }}
                              >
                                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                  {option.icon ? <AppIcon name={option.icon} size={20} color={isSelected ? palette.brand : palette.muted} style={{ marginRight: 12 }} /> : null}
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 15, fontWeight: isSelected ? '700' : '500', color: isSelected ? palette.brand : palette.text }}>{option.label}</Text>
                                    {option.subtitle ? <Text style={{ fontSize: 12, color: palette.muted, marginTop: 2 }}>{option.subtitle}</Text> : null}
                                  </View>
                                </View>
                                {isSelected ? <AppIcon name="check" size={20} color={palette.brand} /> : null}
                              </Pressable>
                            );
                          })
                        : debtAccountDropdownOptions.map(option => {
                            const isSelected = option.value === selectedDebtId;
                            return (
                              <Pressable
                                key={String(option.value)}
                                accessibilityRole="button"
                                accessibilityState={{ selected: isSelected }}
                                onPress={() => { setNewAccountId(option.value); setNewAppliesToDate(''); setAddPicker(null); }}
                                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, marginVertical: 3, ...(isSelected ? { backgroundColor: palette.tint, borderWidth: 1, borderColor: palette.border } : {}) }}
                              >
                                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                  {option.icon ? <AppIcon name={option.icon} size={20} color={isSelected ? palette.brand : palette.muted} style={{ marginRight: 12 }} /> : null}
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 15, fontWeight: isSelected ? '700' : '500', color: isSelected ? palette.brand : palette.text }}>{option.label}</Text>
                                    {option.subtitle ? <Text style={{ fontSize: 12, color: palette.muted, marginTop: 2 }}>{option.subtitle}</Text> : null}
                                  </View>
                                </View>
                                {isSelected ? <AppIcon name="check" size={20} color={palette.brand} /> : null}
                              </Pressable>
                            );
                          })}
                    </ScrollView>
                  </View>
                </TouchableWithoutFeedback>
              </View>
            </TouchableWithoutFeedback>
          </AdaptiveModal>

          <AdaptiveModal visible={showDatePicker} transparent animationType="slide" onRequestClose={() => setShowDatePicker(false)}>
            <TouchableWithoutFeedback onPress={() => setShowDatePicker(false)}>
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }}>
                <TouchableWithoutFeedback>
                  <View style={{ backgroundColor: palette.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: palette.border, padding: 18, paddingBottom: bottomInsetPadding(insets.bottom, 16) }}>
                    <View style={[ui.row, { justifyContent: 'space-between', marginBottom: 16 }]}>
                      <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => {
                        const [year, month] = datePickerMonth.split('-').map(Number);
                        const previous = new Date(year, month - 2, 1);
                        setDatePickerMonth(`${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`);
                      }} style={ui.button}><AppIcon name="chevronLeft" size={17} color={palette.brand} /></Pressable>
                      <Text style={ui.heading}>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(`${datePickerMonth}-01T12:00:00`))}</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => {
                        const [year, month] = datePickerMonth.split('-').map(Number);
                        const next = new Date(year, month, 1);
                        setDatePickerMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
                      }} style={ui.button}><AppIcon name="chevronRight" size={17} color={palette.brand} /></Pressable>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 }}>
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <Text key={`${day}-${index}`} style={[ui.small, { width: '13%', textAlign: 'center' }]}>{day}</Text>)}
                    </View>
                    {(() => {
                      const [year, month] = datePickerMonth.split('-').map(Number);
                      const offset = new Date(year, month - 1, 1).getDay();
                      const count = new Date(year, month, 0).getDate();
                      const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
                      while (cells.length % 7) cells.push(null);
                      const weeks = Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
                      return weeks.map((week, weekIndex) => (
                        <View key={`week-${weekIndex}`} style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 5 }}>
                          {week.map((day, dayIndex) => {
                            if (day === null) return <View key={`blank-${weekIndex}-${dayIndex}`} style={{ width: '13%', height: 42 }} />;
                            const value = `${datePickerMonth}-${String(day).padStart(2, '0')}`;
                            const selected = value === newDate;
                            return (
                              <Pressable key={value} accessibilityRole="button" accessibilityLabel={value} accessibilityState={{ selected }}
                                onPress={() => { setNewDate(parseDateOnly(value)); setShowDatePicker(false); }}
                                style={{ width: '13%', height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? palette.brand : 'transparent' }}>
                                <Text style={[ui.text, selected ? { color: palette.onBrand, fontWeight: '700' } : null]}>{day}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ));
                    })()}
                    <Pressable accessibilityRole="button" onPress={() => { setNewDate(todayStr); setShowDatePicker(false); }} style={[ui.button, { alignSelf: 'center', marginTop: 8 }]}>
                      <Text style={[ui.buttonText, { color: palette.brand }]}>Today</Text>
                    </Pressable>
                  </View>
                </TouchableWithoutFeedback>
              </View>
            </TouchableWithoutFeedback>
          </AdaptiveModal>
        </View>
        </SheetModal>
      ) : null}

      {tab === 'Scheduled' ? (
        <Card style={{ padding: 0, gap: 0, borderWidth: 0, borderRadius: 0, backgroundColor: 'transparent', shadowOpacity: 0, elevation: 0 }}>
          {!canEdit ? (
            <View style={{ marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.tint }}>
              <Text style={[ui.small, { color: palette.text, fontWeight: '600' }]}>View-only access · Payment recording and split plans are disabled for Viewers.</Text>
            </View>
          ) : null}
          {!!billError ? <Text accessibilityRole="alert" style={[ui.small, { color: appearanceColor('#F08B78', isLight), marginBottom: 8 }]}>{billError}</Text> : null}
          {(() => {
            const allRows = scheduledAllRows;
            let selectedMonth = currentMonthStr;
            for (let index = 0; index < scheduledMonthOffset; index += 1) selectedMonth = getNextMonthString(selectedMonth);
            const allPlannedEvents = scheduledPlannedEvents;
            const plannedEvents = allPlannedEvents.filter(event => event.date.slice(0, 7) === selectedMonth);
            const plannedObligationIdsInMonth = new Set(plannedEvents.map(event => event.obligationId));
            const monthRows = allRows.filter(row => row.dueCycleMonth === selectedMonth || plannedObligationIdsInMonth.has(row.id));
            const annualFeeRows = getAnnualFeeRows(debts, transactions).filter(row => row.dueDate.slice(0, 7) === selectedMonth);
            const visibleAnnualFeeRows = scheduledDate ? annualFeeRows.filter(row => row.dueDate === scheduledDate) : annualFeeRows;
            const matchingPlanObligationIdsOnDate = scheduledDate
              ? new Set(plannedEvents.filter(event => event.date === scheduledDate).map(event => event.obligationId))
              : null;
            const visibleRows = scheduledDate
              ? monthRows.filter(row => row.dueDate === scheduledDate || Boolean(matchingPlanObligationIdsOnDate?.has(row.id)))
              : monthRows;
            const sortedVisibleRows = [...visibleRows].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
            const monthLabel = LONG_MONTH_FMT.format(new Date(`${selectedMonth}-01T12:00:00`));
            const scale = getCurrency(currencyCode).scale;
            return <>
              <ObligationCalendar
                month={selectedMonth}
                rows={allRows.filter(row => row.dueCycleMonth === selectedMonth)}
                selectedDate={scheduledDate}
                onSelect={setScheduledDate}
                plannedDates={plannedEvents.map(event => event.date)}
                annualFeeDates={annualFeeRows.map(row => row.dueDate)}
                canPrevMonth={scheduledMonthOffset > 0}
                canNextMonth={scheduledMonthOffset < 11}
                onPrevMonth={() => { setScheduledDate(null); setScheduledMonthOffset(value => Math.max(0, value - 1)); }}
                onNextMonth={() => { setScheduledDate(null); setScheduledMonthOffset(value => Math.min(11, value + 1)); }}
              />
              {monthRows.map(row => {
                const isDebt = row.kind === 'debt';
                const entityId = isDebt ? row.debt?.id : row.bill?.id;
                const plan = entityId ? (isDebt ? debtPaymentSplitPlansByDebtId[entityId] : billPaymentSplitPlansByBillId[entityId]) : undefined;
                if (!plan) return null;
                const state = resolveDebtSplitPlanState(plan, row);
                if (state?.status === 'needs_review') {
                  const name = normalizeDisplayName(
                    isDebt
                      ? (row.debt?.name ?? row.name)
                      : ((row.bill?.id ? linkedDebtNameByBillId.get(row.bill.id) : undefined) ?? row.bill?.name ?? row.name),
                  );
                  return <Text key={`split-review:${row.id}`} accessibilityRole="alert" style={[ui.small, { color: '#F5C563', marginTop: 8 }]}>{name}: plan needs review. Selected days no longer fit before the actual due date; the full obligation remains due {formatShortMonthDay(row.dueDate)}.</Text>;
                }
                return null;
              })}
              {!sortedVisibleRows.length && !visibleAnnualFeeRows.length ? (
                <View style={{ paddingVertical: 24, alignItems: 'center', gap: 6 }}>
                  <AppIcon name="calendar" size={26} color={palette.muted} />
                  <Text style={ui.heading}>{scheduledDate ? 'No items on this date' : 'Nothing scheduled this month'}</Text>
                  <Text style={ui.small}>Choose another day or browse the next month.</Text>
                </View>
              ) : null}
              {sortedVisibleRows.length > 0 ? (
                <View style={{ marginTop: 12, gap: 8 }}>
                  <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 }]}>
                    <Text accessibilityRole="header" style={ui.heading}>{monthLabel}</Text>
                    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: isLight ? '#E5F8F8' : 'rgba(39, 238, 233, 0.14)', borderWidth: 1, borderColor: isLight ? '#A5E5E7' : 'rgba(39, 238, 233, 0.35)' }}>
                      <Text style={{ color: isLight ? '#087F85' : '#27EEE9', fontSize: 12, fontWeight: '700' }}>
                        {`${sortedVisibleRows.length} ${sortedVisibleRows.length === 1 ? 'item' : 'items'}`}
                      </Text>
                    </View>
                  </View>
                  <Card style={{ padding: 0, gap: 0, borderRadius: 16, overflow: 'hidden' }}>
                    {sortedVisibleRows.map((row, index) => {
                      const { bill, debt, dueDate: due, state } = row;
                      const match = state.confirmedMatch;
                      const isPending = state.status === 'pending_confirmation';
                      const isPastDue = due < todayStr && state.status !== 'paid';
                      const busyKey = `${row.kind}:${row.kind === 'debt' ? debt?.id : bill?.id}:${due}`;
                      const displayName = normalizeDisplayName(
                        row.kind === 'debt'
                          ? (debt?.name ?? row.name.replace(/\s+minimum$/i, ''))
                          : ((bill?.id ? linkedDebtNameByBillId.get(bill.id) : undefined) ?? bill?.name ?? row.name),
                      );
                      const entityId = row.kind === 'debt' ? debt?.id : bill?.id;
                      const hasPlan = Boolean(entityId && (row.kind === 'debt' ? debtPaymentSplitPlansByDebtId[entityId] : billPaymentSplitPlansByBillId[entityId]));
                      const canSplit = canEdit && ((row.kind === 'debt' && debt && onSaveDebtPaymentSplitPlans) || (row.kind === 'bill' && bill && onSaveBillPaymentSplitPlans));
                      const rowEvents = allPlannedEvents.filter(event => event.obligationId === row.id);
                      const isExpanded = expandedPlans[row.id] ?? true;
                      const confirmedPaidMinor = Math.max(0, row.requiredAmount.minorUnits - match.remainingAmount.minorUnits);
                      const rightAmountMoney = match.isPartiallyPaid ? match.remainingAmount : row.requiredAmount;

                      const recordPaymentAmount = async (amountToRecord: Money, lockKey: string) => {
                        if (!canEdit || pendingBillCycle !== null) return;
                        setPendingBillCycle(lockKey);
                        setBillError('');
                        try {
                          if (row.kind === 'debt' && debt && onAddTransaction) {
                            await onAddTransaction(createDebtMinimumPaymentTransaction({
                              id: `tx:${Crypto.randomUUID()}`,
                              debt,
                              today: todayStr,
                              dueDate: due,
                              amount: amountToRecord,
                              createdAt: new Date().toISOString(),
                            }));
                          } else if (row.kind === 'bill' && bill) {
                            await onRecordBillPayment?.(bill, due, amountToRecord);
                          }
                        } catch (error) {
                          setBillError(error instanceof Error ? error.message : 'Unable to record this payment.');
                        } finally {
                          setPendingBillCycle(null);
                        }
                      };

                      const statusText = match.isSatisfied
                        ? 'Paid'
                        : isPending
                          ? `Awaiting confirmation · ${formatCurrency(moneyToMajor(state.pendingAmount), currencySymbol)} pending`
                          : match.isPartiallyPaid
                            ? `Partial - ${formatCurrency(moneyToMajor(makeMoney(currencyCode, confirmedPaidMinor)), currencySymbol)}`
                            : isPastDue
                              ? 'Past due · Unpaid'
                              : 'Unpaid';
                      const statusColor = match.isSatisfied
                        ? appearanceColor('#76DCB9', isLight)
                        : isPending
                          ? appearanceColor('#F5C563', isLight)
                          : isPastDue
                            ? appearanceColor('#F08B78', isLight)
                            : match.isPartiallyPaid
                              ? appearanceColor('#F5C563', isLight)
                              : palette.muted;

                      return (
                        <View key={row.id} style={index > 0 ? { borderTopWidth: 1, borderTopColor: palette.border } : undefined}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, gap: 12 }}>
                            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: palette.tint, alignItems: 'center', justifyContent: 'center' }}>
                              <AppIcon name={row.kind === 'debt' ? 'creditCard' : 'calendar'} size={17} color={palette.brand} />
                            </View>
                            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                              <Text style={[ui.heading, { fontSize: 16 }]}>{displayName}</Text>
                              <Text style={ui.small}>
                                {`${isPastDue ? 'Past due ' : 'Due '}${formatShortMonthDay(due)} · ${row.kind === 'debt' ? 'Minimum payment' : bill?.paymentMethod === 'credit' ? 'Credit Card' : 'Debit Card'}`}
                              </Text>
                              <Text style={[ui.small, { color: statusColor, fontWeight: match.isSatisfied || isPending || isPastDue || match.isPartiallyPaid ? '600' : '400' }]}>
                                {statusText}
                              </Text>
                            </View>
                            <View style={{ alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                              <View style={{ alignItems: 'flex-end' }}>
                                <AmountText style={[ui.value, { fontSize: 16, textAlign: 'right' }]} value={formatCurrency(moneyToMajor(rightAmountMoney), currencySymbol)} />
                                {match.isPartiallyPaid ? (
                                  <Text style={[ui.small, { color: appearanceColor('#76DCB9', isLight) }]}>remaining</Text>
                                ) : null}
                              </View>
                              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                {canEdit && !match.isSatisfied && !isPending ? (
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Pay ${displayName} due ${due}`}
                                    disabled={(row.kind === 'debt' ? !onAddTransaction : !onRecordBillPayment) || pendingBillCycle !== null}
                                    onPress={() => void recordPaymentAmount(match.remainingAmount, busyKey)}
                                    style={{
                                      backgroundColor: ctaBg,
                                      borderColor: ctaBg,
                                      borderWidth: 1,
                                      minHeight: 32,
                                      paddingHorizontal: 14,
                                      paddingVertical: 5,
                                      borderRadius: 999,
                                      justifyContent: 'center',
                                      alignItems: 'center',
                                    }}
                                  >
                                    <Text style={{ color: ctaFg, fontSize: 13, fontWeight: '700' }}>
                                      {pendingBillCycle === busyKey ? 'Saving…' : 'Pay'}
                                    </Text>
                                  </Pressable>
                                ) : null}
                                {canSplit && !hasPlan ? (
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Split payment plan for ${displayName}`}
                                    onPress={() => openSplitPlanModal(row)}
                                    style={{
                                      backgroundColor: palette.tint,
                                      borderColor: palette.brand,
                                      borderWidth: 1,
                                      minHeight: 32,
                                      paddingHorizontal: 12,
                                      paddingVertical: 5,
                                      borderRadius: 999,
                                      justifyContent: 'center',
                                      alignItems: 'center',
                                    }}
                                  >
                                    <Text style={{ color: palette.brand, fontSize: 13, fontWeight: '700' }}>
                                      Split
                                    </Text>
                                  </Pressable>
                                ) : null}
                              </View>
                            </View>
                          </View>

                          {rowEvents.length > 0 ? (
                            <View style={{ marginHorizontal: 14, marginBottom: 12, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: isLight ? palette.canvas : palette.raised, overflow: 'hidden' }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 }}>
                                <Pressable
                                  accessibilityRole={canSplit ? 'button' : undefined}
                                  accessibilityLabel={`Edit split plan for ${displayName}`}
                                  disabled={!canSplit}
                                  onPress={() => { if (canSplit) openSplitPlanModal(row); }}
                                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 }}
                                >
                                  <Text style={[ui.small, { color: palette.text, fontWeight: '700' }]}>
                                    {`${rowEvents.length} installments`}
                                  </Text>
                                  {canSplit ? <AppIcon name="edit" size={13} color={palette.brand} /> : null}
                                </Pressable>
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityState={{ expanded: isExpanded }}
                                  accessibilityLabel={`${isExpanded ? 'Hide' : 'Show'} ${displayName} installments`}
                                  onPress={() => setExpandedPlans(previous => ({ ...previous, [row.id]: !isExpanded }))}
                                  hitSlop={6}
                                  style={{ paddingHorizontal: 6, paddingVertical: 2 }}
                                >
                                  <Text style={[ui.small, { color: palette.brand, fontWeight: '600' }]}>
                                    {isExpanded ? 'Hide' : 'Show'}
                                  </Text>
                                </Pressable>
                              </View>
                              {isExpanded ? rowEvents.map(event => {
                                const neededForTargetMinor = Math.max(0, event.cumulativeTargetMinor - confirmedPaidMinor);
                                const installmentPayMinor = Math.min(event.amountMinor, match.remainingAmount.minorUnits, neededForTargetMinor);
                                const instBusyKey = `${busyKey}:inst:${event.installment}`;
                                const canPayInstallment = canEdit && !match.isSatisfied && event.status !== 'covered' && event.status !== 'pending' && installmentPayMinor > 0;
                                const instStatusLabel = event.status === 'covered'
                                  ? 'Paid'
                                  : event.status === 'pending'
                                    ? 'Pending'
                                    : event.status === 'behind_plan'
                                      ? 'Behind plan'
                                      : 'Planned';
                                const instStatusColor = event.status === 'covered'
                                  ? appearanceColor('#76DCB9', isLight)
                                  : event.status === 'pending'
                                    ? appearanceColor('#F5C563', isLight)
                                    : event.status === 'behind_plan'
                                      ? appearanceColor('#F08B78', isLight)
                                      : palette.muted;
                                return (
                                  <Pressable
                                    key={`${event.date}:${event.installment}`}
                                    accessibilityRole={canSplit ? 'button' : undefined}
                                    accessibilityLabel={`Edit split plan for ${displayName}`}
                                    disabled={!canSplit}
                                    onPress={() => { if (canSplit) openSplitPlanModal(row); }}
                                    style={{
                                      flexDirection: 'row',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      paddingHorizontal: 12,
                                      paddingVertical: 9,
                                      gap: 10,
                                      borderTopWidth: 1,
                                      borderTopColor: palette.border,
                                    }}
                                  >
                                    <View style={{ flex: 1, minWidth: 0 }}>
                                      <Text style={[ui.text, { fontSize: 14, fontWeight: '600', color: palette.text }]}>
                                        {`Installment ${event.installment}`}
                                      </Text>
                                      <Text style={[ui.small, { color: instStatusColor }]}>
                                        {`${formatShortMonthDay(event.date)} · ${instStatusLabel}`}
                                      </Text>
                                    </View>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                      <AmountText style={[ui.value, { fontSize: 14 }]} value={formatCurrency(event.amountMinor / 10 ** scale, currencySymbol)} />
                                      {canPayInstallment ? (
                                        <Pressable
                                          accessibilityRole="button"
                                          accessibilityLabel={`Pay installment ${event.installment} for ${displayName}`}
                                          disabled={(row.kind === 'debt' ? !onAddTransaction : !onRecordBillPayment) || pendingBillCycle !== null}
                                          onPress={eventPress => {
                                            eventPress?.stopPropagation?.();
                                            void recordPaymentAmount(makeMoney(currencyCode, installmentPayMinor), instBusyKey);
                                          }}
                                          style={{
                                            backgroundColor: ctaBg,
                                            borderColor: ctaBg,
                                            borderWidth: 1,
                                            minHeight: 28,
                                            paddingHorizontal: 12,
                                            paddingVertical: 4,
                                            borderRadius: 999,
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                          }}
                                        >
                                          <Text style={{ color: ctaFg, fontSize: 12, fontWeight: '700' }}>
                                            {pendingBillCycle === instBusyKey ? 'Saving…' : 'Pay'}
                                          </Text>
                                        </Pressable>
                                      ) : null}
                                    </View>
                                  </Pressable>
                                );
                              }) : null}
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </Card>
                </View>
              ) : null}
              <AnnualFeeSchedule debts={debts} transactions={transactions} mode="scheduled" currencySymbol={currencySymbol} currentDate={todayStr} selectedMonth={selectedMonth} selectedDate={scheduledDate} onConfirmAnnualFee={onConfirmAnnualFee} readOnly={!canEdit} />
              <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: palette.border, gap: 8 }}>
                <Text style={ui.heading}>This month</Text>
                {[
                  ['Paid cycles', monthRows.filter(row => row.state.status === 'paid').length],
                  ['Unpaid cycles', monthRows.filter(row => row.state.status !== 'paid' && row.state.status !== 'pending_confirmation').length],
                  ['Pending cycles', monthRows.filter(row => row.state.status === 'pending_confirmation').length],
                ].map(([label, count]) => <View key={label} style={[ui.row, { justifyContent: 'space-between' }]}><Text style={ui.text}>{label}</Text><Text style={ui.value}>{count}</Text></View>)}
              </View>
            </>;
          })()}
        </Card>
      ) : (
        <>
          {!canEdit ? (
            <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.tint }}>
              <Text style={[ui.small, { color: palette.text, fontWeight: '600' }]}>View-only access · You can review transaction history, while edits and deletions are disabled for Viewers.</Text>
            </View>
          ) : null}
          <View style={[ui.row, { gap: 10, marginVertical: 4 }]}>
            <Card style={{ flex: 1, padding: 16, borderRadius: 14, gap: 4 }}>
              <View style={[ui.row, { gap: 5 }]}>
                <AppIcon name="trendDown" size={14} color={appearanceColor('#76DCB9', isLight)} />
                <Text numberOfLines={1} style={ui.small}>Payments</Text>
              </View>
              <AmountText style={[ui.heading, { fontSize: 20, color: appearanceColor('#76DCB9', isLight) }]} value={formatCurrency(moneyToMajor(makeMoney(currencyCode, totalPaymentsMinor)), currencySymbol)} />
            </Card>
            <Card style={{ flex: 1, padding: 16, borderRadius: 14, gap: 4 }}>
              <View style={[ui.row, { gap: 5 }]}>
                <AppIcon name="brandRise" size={14} color={appearanceColor('#F08B78', isLight)} />
                <Text numberOfLines={1} style={ui.small}>Interest & Fees</Text>
              </View>
              <AmountText style={[ui.heading, { fontSize: 20, color: appearanceColor('#F08B78', isLight) }]} value={formatCurrency(moneyToMajor(makeMoney(currencyCode, totalInterestFeesMinor)), currencySymbol)} />
            </Card>
          </View>

          <View style={[ui.row, { gap: 8, marginVertical: 2 }]}>
            <View style={[ui.inputWrap, { flex: 1, paddingHorizontal: 16 }]}>
              <AppIcon name="search" size={16} color={palette.muted} />
              <TextInput
                accessibilityLabel="Search transactions"
                placeholder="Search"
                placeholderTextColor={palette.muted}
                value={search}
                onChangeText={setSearch}
                style={[ui.input, { borderWidth: 0, paddingHorizontal: 0, paddingVertical: 8, flex: 1, fontSize: 15 }]}
              />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Filters" accessibilityState={{ expanded: showFilters }} onPress={openFilters} style={[ui.button, { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 0 }]}>
              <AppIcon name="filter" size={18} color={palette.brand} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={sortAsc ? 'Sort newest first' : 'Sort oldest first'}
              onPress={() => setSortAsc(prev => !prev)}
              style={[ui.button, { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 0 }]}
            >
              <AppIcon name="sort" size={18} color={palette.brand} />
            </Pressable>
          </View>

          <SheetModal visible={showFilters} onClose={() => setShowFilters(false)} height="92%" closeLabel="Cancel filters" footer={(
            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Apply filters" onPress={() => {
                setPeriodIdx(draftPeriodIdx);
                setAccountId(effectiveDraftAccountId);
                setTypeIdx(draftTypeIdx);
                setShowFilters(false);
              }} style={[ui.button, { flex: 1, minHeight: 44, backgroundColor: ctaBg, borderColor: ctaBg, justifyContent: 'center' }]}>
                <Text style={[ui.buttonText, { color: ctaFg, fontWeight: '700' }]}>Apply</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel filters" onPress={() => setShowFilters(false)} style={[ui.button, { flex: 1, minHeight: 44, justifyContent: 'center' }]}>
                <Text style={[ui.buttonText, { color: palette.brand }]}>Cancel</Text>
              </Pressable>
            </View>
          )}>
            <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }]}>
              <Text accessibilityRole="header" style={ui.title}>Filters</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close filters" onPress={() => setShowFilters(false)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <AppIcon name="close" size={20} color={palette.muted} />
              </Pressable>
            </View>
            <Text accessibilityRole="header" style={[ui.heading, { marginTop: 4 }]}>Period</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Transaction period" style={{ marginTop: 4 }}>
              {periodFilterOptions.map(option => filterRadio(option.label, draftPeriodIdx === option.value, () => setDraftPeriodIdx(option.value), `period:${option.value}`))}
            </View>
            <Text accessibilityRole="header" style={[ui.heading, { marginTop: 14 }]}>Account</Text>
            <ScrollView nestedScrollEnabled style={{ height: 132, marginTop: 4 }}>
              <View accessibilityRole="radiogroup" accessibilityLabel="Transaction account" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {accountOptions.map(option => <View key={option.id} style={{ width: '50%' }}>{filterRadio(option.label, effectiveDraftAccountId === option.id, () => setDraftAccountId(option.id), `account:${option.id}`)}</View>)}
              </View>
            </ScrollView>
            <Text accessibilityRole="header" style={[ui.heading, { marginTop: 14 }]}>Transaction type</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Transaction type" style={{ marginTop: 4 }}>
              {typeFilterOptions.map(option => filterRadio(option.label, draftTypeIdx === option.value, () => setDraftTypeIdx(option.value), `type:${option.value}`))}
            </View>
          </SheetModal>

          {sorted.length === 0 ? (
            <Card>
              <Text style={ui.heading}>No recorded transactions</Text>
              <Text style={ui.text}>
                No transactions match your search and filters.
              </Text>
            </Card>
          ) : (
            sorted.map(tx => {
              const dir = classifyCategoryDirection(tx.category);
              const targetDebt = tx.accountId ? debtById.get(tx.accountId) : undefined;
              const identifiedBill = recurringBills.find(bill => transactionHasBillId(tx, bill.id));
              const aliasDebtId = Object.entries(identityLoanBillPairs).find(([id, billId]) => (tx.accountId === null || tx.accountId === id) && transactionHasBillId(tx, billId))?.[0];
              const linkedDebtName = aliasDebtId ? debtNamesById.get(aliasDebtId) : undefined;
              const accountLabel = tx.accountId === null
                ? linkedDebtName ?? identifiedBill?.name ?? 'Checking'
                : targetDebt?.name || 'Debt Account';
              const isPayment = dir === 'decrease_debt';
              const isCharge = dir === 'increase_debt';
              const isPaymentLikePayee = isPayment && (!tx.payee || /^Payment\b/i.test(tx.payee) || tx.category === 'payment');
              const isBalanceAdj = tx.category === 'credit_adjustment' || tx.category === 'balance_adjustment' || /^Reconciliation credit adjustment$/i.test(tx.payee || '');
              const primaryLabel = isPaymentLikePayee ? 'Payment' : isBalanceAdj ? 'Balance Adjustment' : (tx.payee || accountLabel);
              const categoryLabel = formatTransactionCategoryLabel(tx.category);
              const amountFormatted = formatCurrency(moneyToMajor(tx.amount), currencySymbol);
              const formattedDate = HISTORY_DATE_FMT.format(new Date(`${tx.date}T12:00:00`));
              const badgeColor = isPayment
                ? appearanceColor('#76DCB9', isLight)
                : tx.category === 'interest' || tx.category === 'fee'
                ? appearanceColor('#F08B78', isLight)
                : targetDebt?.category === 'Mortgage'
                ? appearanceColor('#60A5FA', isLight)
                : targetDebt?.category === 'Auto loan'
                ? appearanceColor('#60A5FA', isLight)
                : tx.accountId === null
                ? appearanceColor('#F5C563', isLight)
                : appearanceColor('#A78BFA', isLight);
              const badgeIcon: AppIconName = targetDebt?.category === 'Mortgage'
                ? 'homeLoan'
                : targetDebt?.category === 'Auto loan'
                ? 'auto'
                : isPayment
                ? 'creditCard'
                : tx.category === 'interest' || tx.category === 'fee'
                ? 'progress'
                : tx.accountId === null
                ? 'grid'
                : 'creditCard';

              return (
                <Pressable
                  key={tx.id}
                  accessibilityRole="button"
                  accessibilityLabel={canEdit ? `Edit transaction ${primaryLabel}` : `View transaction ${primaryLabel}`}
                  onPress={() => handleOpenEdit(tx)}
                >
                  <Card style={{ paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16, gap: 10 }}>
                    <Text style={[ui.small, { fontSize: 13, fontWeight: '500', color: palette.muted }]}>{formattedDate}</Text>
                    <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 12 }]}>
                      <View style={[ui.row, { gap: 12, flex: 1, minWidth: 0, alignItems: 'center' }]}>
                        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: badgeColor + '18', alignItems: 'center', justifyContent: 'center' }}>
                          <AppIcon name={badgeIcon} size={19} color={badgeColor} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                          <Text numberOfLines={1} style={[ui.heading, { fontSize: 16 }]}>{primaryLabel}</Text>
                          <Text numberOfLines={1} style={[ui.small, { fontSize: 13 }]}>
                            {`${accountLabel} - ${categoryLabel}`}
                          </Text>
                        </View>
                      </View>
                      <View style={[ui.row, { gap: 8, alignItems: 'center', flexShrink: 0 }]}>
                        <View style={{ alignItems: 'flex-end', gap: 3 }}>
                          <AmountText
                            style={[ui.value, { fontSize: 16, fontWeight: '700', textAlign: 'right', color: isPayment ? appearanceColor('#76DCB9', isLight) : isCharge ? appearanceColor('#F08B78', isLight) : palette.text }]}
                            value={isPayment ? `-${amountFormatted}` : isCharge ? `+${amountFormatted}` : amountFormatted}
                          />
                          {tx.isPending ? (
                            <Text style={{ color: appearanceColor('#F5C563', isLight), fontSize: 13, fontWeight: '600' }}>Pending</Text>
                          ) : tx.source === 'recurring_bill' ? (
                            <View style={[ui.row, { gap: 4 }]}>
                              <AppIcon name="check" size={13} color={appearanceColor('#76DCB9', isLight)} />
                              <Text style={{ color: palette.muted, fontSize: 13, fontWeight: '500' }}>Auto-Bill</Text>
                            </View>
                          ) : tx.source === 'reconciliation' ? (
                            <Text style={{ color: appearanceColor('#F08B78', isLight), fontSize: 13, fontWeight: '500' }}>Reconciled</Text>
                          ) : isPayment ? (
                            <View style={[ui.row, { gap: 4 }]}>
                              <AppIcon name="check" size={13} color={appearanceColor('#76DCB9', isLight)} />
                              <Text style={{ color: palette.muted, fontSize: 13, fontWeight: '500' }}>Paid</Text>
                            </View>
                          ) : null}
                        </View>
                        <AppIcon name="chevronRight" size={16} color={palette.muted} />
                      </View>
                    </View>
                  </Card>
                </Pressable>
              );
            })
          )}
        </>
      )}

      <SheetModal visible={canEdit && !!splitPlanRow} onClose={() => setSplitPlanRow(null)} contentSized>
        <SheetFormHeader
          title={splitPlanRow ? `Plan ${normalizeDisplayName(splitPlanRow.kind === 'debt' ? (splitPlanRow.debt?.name ?? splitPlanRow.name.replace(/\s+minimum$/i, '')) : ((splitPlanRow.bill?.id ? linkedDebtNameByBillId.get(splitPlanRow.bill.id) : undefined) ?? splitPlanRow.bill?.name ?? splitPlanRow.name))} split` : 'Plan split'}
          onClose={() => setSplitPlanRow(null)}
          closeLabel="Close split plan"
        />
        <View accessibilityRole="radiogroup" style={[ui.row, { gap: 8, marginTop: 8 }]}>{([2, 3, 4] as const).map(count => <Pressable key={count} accessibilityRole="radio" accessibilityState={{ checked: splitCount === count }} onPress={() => setSplitCount(count)} style={[ui.button, { flex: 1, backgroundColor: splitCount === count ? ctaBg : palette.surface, borderColor: splitCount === count ? ctaBg : palette.border }]}><Text style={[ui.buttonText, { color: splitCount === count ? ctaFg : palette.text }]}>{count} installments</Text></Pressable>)}</View>
        <Text style={ui.small}>Choose calendar dates on or before the due date. Each installment can be set in the due month or the previous month. This plan is informational and never sends a payment.</Text>
        {!!billError ? <Text accessibilityRole="alert" style={[ui.small, { color: '#F08B78', marginTop: 8 }]}>{billError}</Text> : null}
        {splitPlanRow ? (() => {
          const isDebt = splitPlanRow.kind === 'debt';
          const entityId = isDebt ? splitPlanRow.debt?.id : splitPlanRow.bill?.id;
          const cycleMonth = splitPlanRow.dueCycleMonth;
          const prevMonth = getPreviousMonthString(cycleMonth);
          const days = [splitDay1, splitDay2, ...extraDays].slice(0, splitCount);
          const offsets = [splitMonthOffset1, splitMonthOffset2, ...extraOffsets].slice(0, splitCount);
          const previews = days.map((day, i) => { const n = Number(day); return day && Number.isInteger(n) && n >= 1 && n <= 31 ? clampDate(offsets[i] === -1 ? prevMonth : cycleMonth, n) : null; });
          const baseAmount = Math.floor(splitPlanRow.requiredAmount.minorUnits / splitCount);
          const scale = getCurrency(currencyCode).scale;
          const hasExisting = Boolean(entityId && (isDebt ? debtPaymentSplitPlansByDebtId[entityId] : billPaymentSplitPlansByBillId[entityId]));
          const datesInOrder = previews.every((date, i) => date !== null && (i === 0 || date > previews[i - 1]!));
          const datesBeforeDue = previews.every(date => date !== null && date <= splitPlanRow.dueDate);

          return (
            <>
              <View style={{ marginTop: 12, gap: 12 }}>
                {days.map((day, i) => <View key={i} style={{ gap: 6 }}>
                  <Text style={[ui.small, { fontWeight: '600' }]}>Installment {i + 1}</Text>
                  <View style={[ui.row, { gap: 8 }]}>
                    {([-1, 0] as const).map(offset => <Pressable key={offset} accessibilityRole="button" accessibilityLabel={`Installment ${i + 1} ${offset === -1 ? 'previous month' : 'due month'}`} onPress={() => { if (i === 0) setSplitMonthOffset1(offset); else if (i === 1) setSplitMonthOffset2(offset); else setExtraOffsets(values => values.map((value, j) => j === i - 2 ? offset : value)); }} style={[ui.button, { flex: 1, backgroundColor: offsets[i] === offset ? ctaBg : palette.surface, borderColor: offsets[i] === offset ? ctaBg : palette.border }]}><Text style={[ui.buttonText, { color: offsets[i] === offset ? ctaFg : palette.text }]}>{['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][Number((offset === -1 ? prevMonth : cycleMonth).slice(5, 7)) - 1]}</Text></Pressable>)}
                    <TextInput accessibilityLabel={`Installment ${i + 1} calendar day`} placeholder="Day" keyboardType="number-pad" value={day} onChangeText={value => { if (i === 0) setSplitDay1(value); else if (i === 1) setSplitDay2(value); else setExtraDays(values => values.map ( (old, j) => j === i - 2 ? value : old)); }} maxLength={2} style={[ui.input, { width: 80, textAlign: 'center', color: palette.text, borderColor: palette.border }]} />
                  </View>
                </View>)}
              </View>
              <View style={{ marginTop: 14, padding: 12, borderRadius: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, gap: 6 }}>
                <Text style={[ui.small, { fontWeight: '700' }]}>Actual installment schedule:</Text>
                {previews.map((date, i) => <View key={i} style={[ui.row, { justifyContent: 'space-between' }]}><Text style={ui.small}>Installment {i + 1} ({formatCurrency((i === splitCount - 1 ? splitPlanRow.requiredAmount.minorUnits - baseAmount * (splitCount - 1) : baseAmount) / 10 ** scale, currencySymbol)}):</Text><Text style={ui.small}>{date ? formatShortMonthDay(date) : 'Invalid day'}</Text></View>)}
                <View style={[ui.row, { justifyContent: 'space-between' }]}><Text style={ui.small}>Due date ({formatCurrency(splitPlanRow.requiredAmount.minorUnits / 10 ** scale, currencySymbol)}):</Text><Text style={ui.small}>{formatShortMonthDay(splitPlanRow.dueDate)}</Text></View>
                {!datesInOrder || !datesBeforeDue ? <Text accessibilityRole="alert" style={[ui.small, { color: '#F08B78' }]}>Dates must be strictly increasing and on or before the due date.</Text> : null}
              </View>

              <Pressable
                accessibilityRole="button"
                disabled={savingSplitPlan || !datesInOrder || !datesBeforeDue}
                onPress={async () => {
                  if (!splitPlanRow || !entityId) return;
                  const onSave = isDebt ? onSaveDebtPaymentSplitPlans : onSaveBillPaymentSplitPlans;
                  if (!onSave) return;
                  try {
                    const day1 = Number(splitDay1), day2 = Number(splitDay2);
                    const candidateRows = scheduledAllRows.filter(row =>
                      row.kind === splitPlanRow.kind &&
                      (isDebt ? row.debt?.id === entityId : row.bill?.id === entityId)
                    );
                    const term = firstEligibleSplitTerm({
                      debtId: isDebt ? entityId : undefined,
                      billId: !isDebt ? entityId : undefined,
                      day1,
                      day2,
                      monthOffset1: splitMonthOffset1,
                      monthOffset2: splitMonthOffset2,
                      current: splitPlanRow,
                      candidates: candidateRows,
                      today: todayStr,
                    });
                    const extendedTerm = splitCount === 2 ? term : { ...term, count: splitCount, day3: Number(extraDays[0]), monthOffset3: extraOffsets[0], ...(splitCount === 4 ? { day4: Number(extraDays[1]), monthOffset4: extraOffsets[1] } : {}) };
                    setSavingSplitPlan(true);
                    if (isDebt) {
                      const plans = { ...(debtPaymentSplitPlansByDebtId ?? {}) };
                      const existing = plans[entityId];
                      const terms = [...(existing?.terms ?? [])].filter(item => item.effectiveMonth !== term.effectiveMonth);
                      terms.push(extendedTerm);
                      terms.sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
                      await onSaveDebtPaymentSplitPlans?.({ ...plans, [entityId]: { terms } });
                    } else {
                      const plans = { ...(billPaymentSplitPlansByBillId ?? {}) };
                      const existing = plans[entityId];
                      const terms = [...(existing?.terms ?? [])].filter(item => item.effectiveMonth !== term.effectiveMonth);
                      terms.push(extendedTerm);
                      terms.sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
                      await onSaveBillPaymentSplitPlans?.({ ...plans, [entityId]: { terms } });
                    }
                    setSplitPlanRow(null);
                  } catch (error) {
                    setBillError(error instanceof Error ? error.message : 'Unable to save split plan.');
                  } finally {
                    setSavingSplitPlan(false);
                  }
                }}
                style={[ui.button, { backgroundColor: ctaBg, borderColor: ctaBg, marginTop: 16, justifyContent: 'center' }]}
              >
                <Text style={[ui.buttonText, { color: ctaFg }]}>{savingSplitPlan ? 'Saving…' : 'Save plan'}</Text>
              </Pressable>

              {hasExisting ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={savingSplitPlan}
                  onPress={() => {
                    if (splitPlanRow && entityId) {
                      setConfirmRemoveSplitRow(splitPlanRow);
                    }
                  }}
                  style={{ alignItems: 'center', padding: 12 }}
                >
                  <Text style={[ui.buttonText, { color: '#F08B78' }]}>Return to one monthly payment</Text>
                </Pressable>
              ) : null}
            </>
          );
        })() : null}
      </SheetModal>

      {/* Edit Transaction Modal */}
      {(() => {
        const groupedCardStyle = {
          borderRadius: 16,
          borderWidth: 1,
          borderColor: palette.border,
          backgroundColor: isLight ? palette.surface : palette.raised,
          paddingHorizontal: 14,
          overflow: 'hidden' as const,
        };
        const rowStyle = {
          minHeight: 48,
          paddingVertical: 6,
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
          <SheetModal
            visible={editingTx !== null}
            onClose={() => { setEditPicker(null); setEditingTx(null); onEditDismiss?.(); }}
            contentSized
            closeLabel="Close edit form"
            footer={canEdit ? (
              <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface, gap: 8 }}>
                {!!editError ? (
                  <Text accessibilityRole="alert" style={[ui.small, { color: appearanceColor('#F08B78', isLight), textAlign: 'center' }]}>
                    {editError}
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Delete transaction"
                    disabled={deletingTx || savingEdit}
                    onPress={() => { if (editingTx) setConfirmDeleteTx(editingTx); }}
                    style={{
                      flex: 1,
                      minHeight: 46,
                      borderRadius: 12,
                      backgroundColor: isLight ? '#FEE2E2' : '#3D2520',
                      borderColor: isLight ? '#FCA5A5' : '#8B4F42',
                      borderWidth: 1,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: deletingTx ? 0.65 : 1,
                    }}
                  >
                    <Text style={{ color: isLight ? '#DC2626' : '#F08B78', fontSize: 15, fontWeight: '700' }}>
                      {deletingTx ? 'Deleting…' : 'Delete'}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save Changes"
                    disabled={savingEdit || deletingTx}
                    onPress={() => void handleSaveEdit()}
                    style={{
                      flex: 1.5,
                      minHeight: 46,
                      borderRadius: 12,
                      backgroundColor: ctaBg,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: savingEdit ? 0.65 : 1,
                    }}
                  >
                    <Text style={{ color: ctaFg, fontSize: 15, fontWeight: '700' }}>
                      {savingEdit ? 'Saving…' : 'Save'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : undefined}
          >
            <View style={{ gap: 12 }}>
              <SheetFormHeader
                centered
                title={canEdit ? 'Edit Transaction' : 'Transaction Details'}
                onClose={() => { setEditPicker(null); setEditingTx(null); onEditDismiss?.(); }}
                closeLabel="Close edit form"
              />

              {!canEdit ? (
                <View style={{ backgroundColor: palette.tint, borderColor: palette.border, borderWidth: 1, borderRadius: 10, padding: 10 }}>
                  <Text style={ui.small}>View-only access: only household members or owners can edit or delete transactions.</Text>
                </View>
              ) : null}

              {editingTx?.isPending ? (
                <View style={{ backgroundColor: isLight ? '#FFF3CD' : '#2D281E', borderColor: appearanceColor('#F5C563', isLight), borderWidth: 1, borderRadius: 10, padding: 10 }}>
                  <Text style={[ui.small, { color: appearanceColor('#F5C563', isLight), fontWeight: '700' }]}>Pending Confirmation</Text>
                  <Text style={[ui.small, { color: isLight ? '#8A6200' : '#D4C9A8' }]}>This transaction has not yet been confirmed by the server.</Text>
                </View>
              ) : null}

              <View style={groupedCardStyle}>
                <Pressable
                  accessibilityRole="button"
                  disabled={!canEdit}
                  accessibilityLabel={`Category: ${editCatOption.label}`}
                  onPress={() => setEditPicker('category')}
                  style={[rowStyle, rowBorderStyle]}
                >
                  <Text style={[ui.text, { color: palette.muted }]}>Category *</Text>
                  <View style={[ui.row, { gap: 6, alignItems: 'center', flexShrink: 1 }]}>
                    <Text numberOfLines={1} style={[ui.text, { color: palette.text, fontWeight: '600' }]}>{editCatOption.label}</Text>
                    {canEdit ? <AppIcon name="chevronDown" size={14} color={palette.muted} /> : null}
                  </View>
                </Pressable>

                {editCatOption.isDebt && debts.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={!canEdit}
                    accessibilityLabel={`Debt account: ${targetEditDebt?.name ?? 'Select account'}`}
                    onPress={() => setEditPicker('debt')}
                    style={[rowStyle, rowBorderStyle]}
                  >
                    <Text style={[ui.text, { color: palette.muted }]}>Debt account *</Text>
                    <View style={[ui.row, { gap: 6, alignItems: 'center', flexShrink: 1 }]}>
                      <Text numberOfLines={1} style={[ui.text, { color: palette.text, fontWeight: '600' }]}>{targetEditDebt?.name ?? debts[0]?.name ?? 'Select account'}</Text>
                      {canEdit ? <AppIcon name="chevronDown" size={14} color={palette.muted} /> : null}
                    </View>
                  </Pressable>
                ) : null}

                <View style={[rowStyle, rowBorderStyle]}>
                  <Text style={[ui.text, { color: palette.muted }]}>Payee</Text>
                  <TextInput
                    accessibilityLabel="Payee or description"
                    placeholder="e.g. Target, Payment"
                    placeholderTextColor={palette.muted}
                    editable={canEdit}
                    value={editPayee}
                    onChangeText={setEditPayee}
                    style={[inlineInputStyle, { flex: 1, minWidth: 110 }]}
                  />
                </View>

                <View style={[rowStyle, rowBorderStyle]}>
                  <Text style={[ui.text, { color: palette.muted }]}>Amount *</Text>
                  <View style={[ui.row, { flex: 1, justifyContent: 'flex-end', gap: 4 }]}>
                    <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>{currencySymbol}</Text>
                    <TextInput
                      accessibilityLabel="Transaction amount"
                      accessibilityHint="Required"
                      placeholder="0.00"
                      placeholderTextColor={palette.muted}
                      keyboardType="decimal-pad"
                      editable={canEdit}
                      value={editAmount}
                      onChangeText={val => setEditAmount(acceptMoneyEdit(editAmount, val, currencyCode))}
                      style={[inlineInputStyle, { flex: 1, minWidth: 90 }]}
                    />
                  </View>
                </View>

                <View style={[rowStyle, rowBorderStyle]}>
                  <Text style={[ui.text, { color: palette.muted }]}>Date *</Text>
                  <TextInput
                    accessibilityLabel="Transaction date"
                    accessibilityHint="Required"
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={palette.muted}
                    editable={canEdit}
                    value={editDate}
                    onChangeText={setEditDate}
                    style={[inlineInputStyle, { flex: 1, minWidth: 110 }]}
                  />
                </View>

                <View style={rowStyle}>
                  <Text style={[ui.text, { color: palette.muted }]}>Note</Text>
                  <TextInput
                    accessibilityLabel="Transaction note"
                    placeholder="Optional note"
                    placeholderTextColor={palette.muted}
                    editable={canEdit}
                    value={editMemo}
                    onChangeText={setEditMemo}
                    style={[inlineInputStyle, { flex: 1, minWidth: 110, fontWeight: '500' }]}
                  />
                </View>
              </View>

              {editCatOption.category === 'payment' && targetEditDebt && (targetEditDebt.category === 'Mortgage' || targetEditDebt.category === 'Auto loan') ? (
                <View style={groupedCardStyle}>
                  <View style={[rowStyle, rowBorderStyle, { minHeight: 42 }]}>
                    <Text style={[ui.small, { color: appearanceColor('#76DCB9', isLight), fontWeight: '700' }]}>PAYMENT BREAKDOWN (OPTIONAL)</Text>
                  </View>
                  <View style={[rowStyle, rowBorderStyle]}>
                    <Text style={[ui.text, { color: palette.muted }]}>Principal</Text>
                    <TextInput
                      placeholder="0.00"
                      placeholderTextColor={palette.muted}
                      keyboardType="decimal-pad"
                      editable={canEdit}
                      value={editPrincipal}
                      onChangeText={val => setEditPrincipal(acceptMoneyEdit(editPrincipal, val, currencyCode))}
                      style={[inlineInputStyle, { flex: 1, minWidth: 90 }]}
                    />
                  </View>
                  <View style={[rowStyle, rowBorderStyle]}>
                    <Text style={[ui.text, { color: palette.muted }]}>Interest</Text>
                    <TextInput
                      placeholder="0.00"
                      placeholderTextColor={palette.muted}
                      keyboardType="decimal-pad"
                      editable={canEdit}
                      value={editInterest}
                      onChangeText={val => setEditInterest(acceptMoneyEdit(editInterest, val, currencyCode))}
                      style={[inlineInputStyle, { flex: 1, minWidth: 90 }]}
                    />
                  </View>
                  {targetEditDebt.category === 'Mortgage' ? (
                    <View style={[rowStyle, rowBorderStyle]}>
                      <Text style={[ui.text, { color: palette.muted }]}>Escrow</Text>
                      <TextInput
                        placeholder="0.00"
                        placeholderTextColor={palette.muted}
                        keyboardType="decimal-pad"
                        editable={canEdit}
                        value={editEscrow}
                        onChangeText={val => setEditEscrow(acceptMoneyEdit(editEscrow, val, currencyCode))}
                        style={[inlineInputStyle, { flex: 1, minWidth: 90 }]}
                      />
                    </View>
                  ) : null}
                  <View style={rowStyle}>
                    <Text style={[ui.text, { color: palette.muted }]}>Fees</Text>
                    <TextInput
                      placeholder="0.00"
                      placeholderTextColor={palette.muted}
                      keyboardType="decimal-pad"
                      editable={canEdit}
                      value={editFee}
                      onChangeText={val => setEditFee(acceptMoneyEdit(editFee, val, currencyCode))}
                      style={[inlineInputStyle, { flex: 1, minWidth: 90 }]}
                    />
                  </View>
                </View>
              ) : null}

              {editingTx ? (
                <View style={groupedCardStyle}>
                  {editingTx.appliesToDate ? (
                    <View style={[rowStyle, rowBorderStyle, { minHeight: 42 }]}>
                      <Text style={[ui.text, { color: palette.muted }]}>Due cycle</Text>
                      <Text style={[ui.text, { color: palette.text, fontWeight: '600' }]}>
                        {`Applied to ${editingTx.appliesToDate} Due`}
                      </Text>
                    </View>
                  ) : null}
                  <View style={[rowStyle, { minHeight: 42 }]}>
                    <Text style={[ui.text, { color: palette.muted }]}>Source</Text>
                    <Text style={[ui.text, { color: palette.text, fontWeight: '600' }]}>
                      {formatTransactionSourceLabel(editingTx.source)}
                    </Text>
                  </View>
                </View>
              ) : null}

              <View style={[ui.row, { justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: palette.tint }]}>
                <View>
                  <Text style={[ui.small, { fontWeight: '700', color: appearanceColor('#76DCB9', isLight) }]}>BALANCE PREVIEW</Text>
                  <Text style={[ui.text, { fontWeight: '600' }]}>{targetEditDebt ? targetEditDebt.name : 'Checking / Cashflow'}</Text>
                </View>
                {targetEditDebt ? (
                  <Text style={[ui.value, { fontSize: 15 }]}>
                    {formatCurrency(editCurrentBal, currencySymbol)} →{' '}
                    <Text style={{ color: editAfterBal <= editCurrentBal ? appearanceColor('#76DCB9', isLight) : appearanceColor('#F08B78', isLight) }}>
                      {formatCurrency(editAfterBal, currencySymbol)}
                    </Text>
                  </Text>
                ) : (
                  <Text style={ui.small}>$0 debt impact</Text>
                )}
              </View>
            </View>

            <AdaptiveModal visible={editPicker !== null} transparent animationType="fade" onRequestClose={() => setEditPicker(null)}>
              <TouchableWithoutFeedback onPress={() => setEditPicker(null)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.72)', justifyContent: 'flex-end' }}>
                  <TouchableWithoutFeedback>
                    <View style={{ backgroundColor: palette.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: palette.border, maxHeight: '75%', paddingBottom: bottomInsetPadding(insets.bottom, 16) }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: palette.border }}>
                        <Text style={{ fontSize: 17, fontWeight: '700', color: palette.text }}>
                          {editPicker === 'category' ? 'Select Transaction Category' : 'Select Target Debt Account'}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Close picker"
                          onPress={() => setEditPicker(null)}
                          style={{ width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
                        >
                          <AppIcon name="close" size={20} color={palette.muted} />
                        </Pressable>
                      </View>
                      <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10 }} keyboardShouldPersistTaps="handled">
                        {editPicker === 'category'
                          ? categoryDropdownOptions.map(option => {
                              const isSelected = option.value === editCategoryIdx;
                              return (
                                <Pressable
                                  key={String(option.value)}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: isSelected }}
                                  onPress={() => { setEditCategoryIdx(option.value); setEditPicker(null); }}
                                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, marginVertical: 3, ...(isSelected ? { backgroundColor: palette.tint, borderWidth: 1, borderColor: palette.border } : {}) }}
                                >
                                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                    {option.icon ? <AppIcon name={option.icon} size={20} color={isSelected ? palette.brand : palette.muted} style={{ marginRight: 12 }} /> : null}
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ fontSize: 15, fontWeight: isSelected ? '700' : '500', color: isSelected ? palette.brand : palette.text }}>{option.label}</Text>
                                      {option.subtitle ? <Text style={{ fontSize: 12, color: palette.muted, marginTop: 2 }}>{option.subtitle}</Text> : null}
                                    </View>
                                  </View>
                                  {isSelected ? <AppIcon name="check" size={20} color={palette.brand} /> : null}
                                </Pressable>
                              );
                            })
                          : debtAccountDropdownOptions.map(option => {
                              const isSelected = option.value === (editAccountId || debts[0]?.id || '');
                              return (
                                <Pressable
                                  key={String(option.value)}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: isSelected }}
                                  onPress={() => { setEditAccountId(option.value); setEditPicker(null); }}
                                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, marginVertical: 3, ...(isSelected ? { backgroundColor: palette.tint, borderWidth: 1, borderColor: palette.border } : {}) }}
                                >
                                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                    {option.icon ? <AppIcon name={option.icon} size={20} color={isSelected ? palette.brand : palette.muted} style={{ marginRight: 12 }} /> : null}
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ fontSize: 15, fontWeight: isSelected ? '700' : '500', color: isSelected ? palette.brand : palette.text }}>{option.label}</Text>
                                      {option.subtitle ? <Text style={{ fontSize: 12, color: palette.muted, marginTop: 2 }}>{option.subtitle}</Text> : null}
                                    </View>
                                  </View>
                                  {isSelected ? <AppIcon name="check" size={20} color={palette.brand} /> : null}
                                </Pressable>
                              );
                            })}
                      </ScrollView>
                    </View>
                  </TouchableWithoutFeedback>
                </View>
              </TouchableWithoutFeedback>
            </AdaptiveModal>
          </SheetModal>
        );
      })()}

      <ConfirmModal
        visible={confirmDeleteTx !== null}
        title="Delete transaction?"
        message={confirmDeleteTx ? `Delete ${confirmDeleteTx.payee || 'this transaction'} dated ${confirmDeleteTx.date}? This removes it from recorded activity and may change the account balance.` : ''}
        confirmLabel="Delete transaction"
        busy={deletingTx}
        onConfirm={() => void handleDeleteTx()}
        onCancel={() => setConfirmDeleteTx(null)}
      />

      <ConfirmModal
        visible={confirmRemoveSplitRow !== null}
        title="Return to one monthly payment?"
        message={confirmRemoveSplitRow ? `Remove the saved split plan for ${normalizeDisplayName(confirmRemoveSplitRow.name.replace(/\s+minimum$/i, ''))}? Its planned installments will be replaced by one monthly payment; the underlying obligation is unchanged.` : ''}
        confirmLabel="Remove split plan"
        busy={savingSplitPlan}
        onCancel={() => setConfirmRemoveSplitRow(null)}
        onConfirm={() => {
          const targetRow = confirmRemoveSplitRow;
          if (!targetRow) return;
          const isDebt = targetRow.kind === 'debt';
          const entityId = isDebt ? targetRow.debt?.id : targetRow.bill?.id;
          if (!entityId) return;
          void (async () => {
            setSavingSplitPlan(true);
            try {
              if (isDebt) {
                const plans = { ...(debtPaymentSplitPlansByDebtId ?? {}) };
                delete plans[entityId];
                await onSaveDebtPaymentSplitPlans?.(plans);
              } else {
                const plans = { ...(billPaymentSplitPlansByBillId ?? {}) };
                delete plans[entityId];
                await onSaveBillPaymentSplitPlans?.(plans);
              }
              setConfirmRemoveSplitRow(null);
              setSplitPlanRow(null);
            } catch (error) {
              setBillError(error instanceof Error ? error.message : 'Unable to remove split plan.');
              setConfirmRemoveSplitRow(null);
            } finally {
              setSavingSplitPlan(false);
            }
          })();
        }}
      />
    </FinancialScreen>
  );
}
