import { useEffect, useRef, useState } from 'react';
import { Alert, Modal } from 'react-native';
import { Pressable, ScrollView, Text, TextInput, View } from '../components/NativeAppearance';
import * as Crypto from 'expo-crypto';
import { AppIcon, type AppIconName } from '../components/AppIcon';
import { Bar, Card, FinancialScreen, ui } from '../components/FinancialScreen';
import { SelectDropdown, type DropdownOption } from '../components/SelectDropdown';
import {
  calculateTotalMonthlyIncome,
  acceptMoneyEdit,
  validateExtraPaymentInput,
  formatEditableMoney,
  formatCurrency,
  normalizeMonthlyIncome,
  PAY_FREQUENCY_OPTIONS,
  type PayoffPlanResult,
  type PayoffStrategy,
  type UserOnboardingData,
  type DebtItem,
  type PayFrequency,
  type LoanBillPairing,
  type AdditionalIncomeSource,
  parseMoneyInput,
} from '../onboarding-domain';
import { calculateMonthlyCashflow, calculateCategoryBreakdown, summarizeSinglePurchases, buildMonthlyBudgetBreakdown } from '../finance/budget';
import { makeMoney, moneyFromMajor, moneyToMajor, parseMoney, type Money } from '../finance/money';
import { getCurrency } from '../finance/currencies';
import { createRecurringBillDeletionPreview, getActiveRecurringBills, resolveRecurringBillDate, shouldDismissRecurringBillEditor, type RecurringBill, type RecurringBillCategory, type RecurringBillPaymentMethod } from '../finance/recurring-bills';
import { type DateOnly, currentHouseholdDate, currentHouseholdMonth, getNextMonthString, getPreviousMonthString } from '../finance/calendar';
import { calculateTransactionBalanceDelta, type LedgerTransaction, type ReconciliationAnchor } from '../finance/ledger';
import {
  confirmObligationPaidToday,
  obligationFirstDueDate,
  prepareObligationEditorSchedule,
} from '../finance/obligation-editor';
import { getObligationCycle, obligationScheduleKey, type ObligationSchedule, type ObligationScheduleKey } from '../finance/obligation-schedule';
import { activeLoanBillLinks } from '../finance/loan-bill-pairing';
import { SheetFormHeader, SheetModal } from '../components/SheetModal';
import { withoutIncompatibleBillPairings } from '../finance/loan-bill-pairing';
import {
  calculateOverdueObligations,
  getObligationPaymentState,
  findUnassignedPaymentsForObligation,
  type PaymentObligation,
  type OverdueObligationItem,
} from '../finance/payment-matching';

const BILL_CATEGORIES: readonly DropdownOption<RecurringBillCategory>[] = [
  { value: 'utilities', label: 'Utilities', subtitle: 'Water, Electric, Gas, Internet', icon: 'calendar' },
  { value: 'subscription', label: 'Subscription', subtitle: 'Streaming, Software, Gym', icon: 'creditCard' },
  { value: 'housing', label: 'Housing / Rent', subtitle: 'Rent, HOA, Maintenance', icon: 'homeLoan' },
  { value: 'insurance', label: 'Insurance', subtitle: 'Health, Auto, Home insurance', icon: 'calendar' },
  { value: 'other_bill', label: 'Other', subtitle: 'Name a reusable spending category', icon: 'calendar' },
];

type PayNowTarget = {
  type: 'bill' | 'debt';
  name: string;
  dueDate: DateOnly;
  requiredAmount: number;
  accountId?: string;
  bill?: RecurringBill;
  debt?: DebtItem;
};

export function BudgetScreen({
  data,
  plan,
  currencySymbol,
  currencyCode,
  householdTimeZone,
  transactions = [],
  recurringBills = [],
  reconciliationAnchors = [],
  onSaveIncome,
  onSaveLoanBillPairings,
  onSaveRecurringBillCategoryLabels,
  onStrategy,
  onExtra,
  onSettings,
  onAddRecurringBill,
  onDeleteRecurringBill,
  onOpenStrategy,
  onSaveObligationSchedule,
  onEditDebt,
  onRecordBillPayment,
  onAddTransaction,
  onUpdateTransaction,
  onUpdateTransactions,
  error: saveError,
}: {
  data: UserOnboardingData;
  plan: PayoffPlanResult;
  currencySymbol: string;
  currencyCode: string;
  householdTimeZone?: string;
  transactions?: LedgerTransaction[];
  recurringBills?: RecurringBill[];
  reconciliationAnchors?: ReconciliationAnchor[];
  onSaveIncome: (patch: Pick<UserOnboardingData, 'primaryIncomeAmount' | 'primaryPayFrequency' | 'primaryMonthlyIncome' | 'additionalIncomes'>) => Promise<void>;
  onSaveLoanBillPairings: (pairings: Record<string, LoanBillPairing>) => Promise<void>;
  onSaveRecurringBillCategoryLabels: (labels: Record<string, string>) => Promise<void>;
  onStrategy: (strategy: PayoffStrategy) => Promise<void>;
  onExtra: (amount: number) => Promise<void>;
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
  onRecordBillPayment?: (bill: RecurringBill, dueCycle: DateOnly, amount?: Money) => unknown;
  onAddTransaction?: (tx: LedgerTransaction) => unknown;
  onUpdateTransaction?: (tx: LedgerTransaction) => unknown;
  onUpdateTransactions?: (txs: LedgerTransaction[]) => unknown;
  error: string;
}) {
  const [tab] = useState<string>('Budget');
  const [spendingMonth, setSpendingMonth] = useState(() => currentHouseholdMonth(householdTimeZone));
  const [extra, setExtra] = useState(formatEditableMoney(data.extraMonthlyPayment, currencyCode));
  const [strategyError, setStrategyError] = useState('');
  const [strategyBusy, setStrategyBusy] = useState(false);
  const [extraBusy, setExtraBusy] = useState(false);
  const [showAddBillModal, setShowAddBillModal] = useState(false);
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [incomeEditorId, setIncomeEditorId] = useState<string | null>(null);
  const [incomeName, setIncomeName] = useState('');
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeFrequency, setIncomeFrequency] = useState<PayFrequency>('monthly');
  const [incomeBusy, setIncomeBusy] = useState(false);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  // Pay Now Modal State
  const [payNowTarget, setPayNowTarget] = useState<PayNowTarget | null>(null);
  const [payNowBusy, setPayNowBusy] = useState(false);
  const [payNowError, setPayNowError] = useState('');

  // New Recurring Bill Form State
  const [newBillName, setNewBillName] = useState('');
  const [newBillAmount, setNewBillAmount] = useState('');
  const [newBillCategory, setNewBillCategory] = useState<RecurringBillCategory>('utilities');
  const [newBillCustomCategory, setNewBillCustomCategory] = useState('');
  const [newBillDueDay, setNewBillDueDay] = useState('15');
  const [newBillPaymentMethod, setNewBillPaymentMethod] = useState<RecurringBillPaymentMethod>('debit');
  const [newBillCreditAccountId, setNewBillCreditAccountId] = useState<string>(
    data.debts.find(d => d.category === 'Credit card')?.id ?? ''
  );
  const [editingBill, setEditingBill] = useState<RecurringBill | null>(null);
  const draftBillIdRef = useRef<string | null>(null);
  const draftBillPaidTodayRef = useRef<Record<string, boolean>>({});
  const billSaveBusyRef = useRef(false);

  useEffect(() => {
    setExtra(formatEditableMoney(data.extraMonthlyPayment, currencyCode));
  }, [data.extraMonthlyPayment, currencyCode]);

  const handleSelectStrategy = async (strategy: PayoffStrategy) => {
    if (strategyBusy || data.strategy === strategy) return;
    setStrategyBusy(true);
    setStrategyError('');
    try {
      await onStrategy(strategy);
    } catch (err) {
      setStrategyError(err instanceof Error ? err.message : 'Unable to save payoff strategy.');
    } finally {
      setStrategyBusy(false);
    }
  };

  const handleSaveExtra = async (amount: number) => {
    if (extraBusy) return;
    setExtraBusy(true);
    setStrategyError('');
    try {
      await onExtra(amount);
    } catch (err) {
      setStrategyError(err instanceof Error ? err.message : 'Unable to save extra payment.');
    } finally {
      setExtraBusy(false);
    }
  };
  const [addBillError, setAddBillError] = useState('');

  const incomes = [
    {
      id: 'primary',
      name: 'Primary income',
      amount: data.primaryIncomeAmount,
      frequency: data.primaryPayFrequency,
    },
    ...data.additionalIncomes,
  ];
  const linkedPairs = activeLoanBillLinks(data.loanBillPairingByDebtId, recurringBills, data.debts);
  const pairedDebtMinimums = Object.keys(linkedPairs).reduce(
    (sum, id) => { const debt = data.debts.find(candidate => candidate.id === id); return sum + (debt?.category === 'Auto loan' && debt.balance > 0 ? debt.minimumPayment : 0); }, 0,
  );

  const income = calculateTotalMonthlyIncome(
    data.primaryIncomeAmount,
    data.primaryPayFrequency,
    data.additionalIncomes,
    currencyCode,
  );

  const cashflow = calculateMonthlyCashflow({
    monthlyIncome: income,
    recurringBills,
    monthlyDebtPlanPayment: plan.monthlyTotalPayment,
    currencyCode,
    pairedDebtMinimums,
  });

  const categoryBreakdown = calculateCategoryBreakdown({
    recurringBills,
    customCategoryLabelsByBillId: data.recurringBillCategoryLabelByBillId,
    monthlyIncome: income,
    monthlyDebtPlanPayment: plan.monthlyTotalPayment,
    currencyCode,
    pairedDebtMinimums,
    debtAccountCount: data.debts.filter(debt => debt.category !== 'Mortgage' && debt.balance > 0).length,
  });

  const creditCards = data.debts.filter(d => d.category === 'Credit card');
  const reusableCustomCategoryLabels = Object.values(data.recurringBillCategoryLabelByBillId ?? {}).reduce<string[]>((labels, value) => {
    const label = value.trim();
    if (label && !labels.some(existing => existing.toLocaleLowerCase() === label.toLocaleLowerCase())) labels.push(label);
    return labels;
  }, []);

  const effectiveTimeZone =
    householdTimeZone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';

  const currentMonthStr = currentHouseholdMonth(effectiveTimeZone);
  const todayStr = currentHouseholdDate(effectiveTimeZone);
  const singlePurchases = summarizeSinglePurchases(transactions, spendingMonth, currencyCode);
  const displayBreakdown = buildMonthlyBudgetBreakdown({
    categories: categoryBreakdown,
    hasActiveDebt: data.debts.some(debt => debt.category !== 'Mortgage' && debt.balance > 0),
    purchases: { total: singlePurchases.total, count: singlePurchases.items.length },
    monthlyIncome: income,
  });
  const activeRecurringBills = getActiveRecurringBills(recurringBills);

  const openIncomeEditor = (id: string | null = null) => {
    setIncomeEditorId(id ?? 'new');
    if (id === 'primary') {
      setIncomeName('Primary income');
      setIncomeAmount(formatEditableMoney(data.primaryIncomeAmount, currencyCode));
      setIncomeFrequency(data.primaryPayFrequency);
    } else {
      const source = id ? data.additionalIncomes.find(item => item.id === id) : null;
      setIncomeName(source?.name ?? '');
      setIncomeAmount(formatEditableMoney(source?.amount ?? 0, currencyCode));
      setIncomeFrequency(source?.frequency ?? 'monthly');
    }
    setAddBillError('');
    setShowIncomeModal(true);
  };

  const saveIncome = async () => {
    const amount = parseMoneyInput(incomeAmount, currencyCode);
    if (amount === null || amount <= 0) { setAddBillError('Enter an income amount greater than zero.'); return; }
    if (incomeEditorId !== 'primary' && !incomeName.trim()) { setAddBillError('Enter a name for this income source.'); return; }
    setIncomeBusy(true);
    setAddBillError('');
    try {
      if (incomeEditorId === 'primary') {
        await onSaveIncome({ primaryIncomeAmount: amount, primaryPayFrequency: incomeFrequency,
          primaryMonthlyIncome: normalizeMonthlyIncome(amount, incomeFrequency, currencyCode), additionalIncomes: data.additionalIncomes });
      } else {
        const source: AdditionalIncomeSource = { id: incomeEditorId === 'new' ? Crypto.randomUUID() : incomeEditorId!,
          name: incomeName.trim(), amount, frequency: incomeFrequency,
          monthlyAmount: normalizeMonthlyIncome(amount, incomeFrequency, currencyCode) };
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
    if (!incomeEditorId || incomeEditorId === 'primary' || incomeEditorId === 'new') return;
    setIncomeBusy(true);
    try {
      await onSaveIncome({ primaryIncomeAmount: data.primaryIncomeAmount, primaryPayFrequency: data.primaryPayFrequency,
        primaryMonthlyIncome: data.primaryMonthlyIncome, additionalIncomes: data.additionalIncomes.filter(item => item.id !== incomeEditorId) });
      setShowIncomeModal(false);
    } catch (error) { setAddBillError(error instanceof Error ? error.message : 'Unable to remove income.'); }
    finally { setIncomeBusy(false); }
  };

  const savePairing = async (debtId: string, relation: LoanBillPairing | null) => {
    if (pairingBusy) return;
    if (relation?.status === 'linked' && Object.entries(data.loanBillPairingByDebtId ?? {}).some(([otherDebtId, existing]) => otherDebtId !== debtId && existing?.status === 'linked' && existing.billId === relation.billId)) {
      setAddBillError('This recurring bill is already linked to another loan.');
      return;
    }
    setPairingBusy(true);
    try {
      const pairings = { ...(data.loanBillPairingByDebtId ?? {}) };
      if (relation) pairings[debtId] = relation; else delete pairings[debtId];
      await onSaveLoanBillPairings(pairings);
    } catch (error) { setAddBillError(error instanceof Error ? error.message : 'Unable to save this loan link.'); }
    finally { setPairingBusy(false); }
  };

  const payNowObligation: PaymentObligation | null = payNowTarget
    ? {
        id: payNowTarget.type === 'bill' ? (payNowTarget.bill?.id ?? 'bill') : `minimum:${payNowTarget.debt?.id}`,
        kind: payNowTarget.type,
        name: payNowTarget.name,
        dueDate: payNowTarget.dueDate,
        dueCycleMonth: payNowTarget.dueDate.slice(0, 7),
        requiredAmount: makeMoney(currencyCode, Math.round(payNowTarget.requiredAmount * 10 ** getCurrency(currencyCode).scale)),
        accountId: payNowTarget.accountId,
        billId: payNowTarget.bill?.id,
        bill: payNowTarget.bill,
        debt: payNowTarget.debt,
      }
    : null;

  const paymentState = payNowObligation
    ? getObligationPaymentState(payNowObligation, transactions, currencyCode)
    : null;
  const matchResult = paymentState?.confirmedMatch ?? null;

  const paidThisCycle = matchResult ? moneyToMajor(matchResult.totalPaid) : 0;
  const pendingThisCycle = paymentState ? moneyToMajor(paymentState.pendingAmount) : 0;
  const requiredAmount = payNowTarget?.requiredAmount ?? 0;
  const remainingAmount = matchResult ? moneyToMajor(matchResult.remainingAmount) : requiredAmount;

  const candidatePayments = payNowObligation
    ? findUnassignedPaymentsForObligation(payNowObligation, transactions)
    : [];

  const handleMatchPayment = async (tx: LedgerTransaction) => {
    if (!payNowTarget || payNowBusy) return;
    setPayNowBusy(true);
    setPayNowError('');
    try {
      const isBill = payNowTarget.type === 'bill' && payNowTarget.bill;
      const explicitMemo = isBill
        ? (tx.memo
            ? (tx.memo.includes(`bill:${payNowTarget.bill!.id}`) ? tx.memo : `${tx.memo} [bill:${payNowTarget.bill!.id}]`)
            : `[bill:${payNowTarget.bill!.id}]`)
        : tx.memo;

      const updatedTx: LedgerTransaction = {
        ...tx,
        appliesToDate: payNowTarget.dueDate,
        accountId: tx.accountId ?? payNowTarget.accountId ?? null,
        memo: explicitMemo,
      };
      if (onUpdateTransaction) {
        await onUpdateTransaction(updatedTx);
      }
      setPayNowTarget(null);
    } catch (err) {
      setPayNowError(err instanceof Error ? err.message : 'Failed to match payment');
    } finally {
      setPayNowBusy(false);
    }
  };

  const handleRecordNewPayment = async () => {
    if (!payNowTarget || payNowBusy) return;
    setPayNowBusy(true);
    setPayNowError('');
    try {
      // Per Finding 8: Prevent duplicate full amount financial writes when already satisfied
      if (remainingAmount <= 0 || matchResult?.isSatisfied) {
        setPayNowError('Obligation is already satisfied for this cycle.');
        return;
      }
      if (pendingThisCycle > 0) {
        setPayNowError('A payment for this due cycle is awaiting confirmation. Reload after it syncs before adding another.');
        return;
      }
      const payAmount = remainingAmount;
      const todayStr = currentHouseholdDate(effectiveTimeZone);

      if (payNowTarget.type === 'bill' && payNowTarget.bill) {
        const bill = payNowTarget.bill;
        const paymentAmount = moneyFromMajor(payAmount, currencyCode);
        if (onRecordBillPayment) {
          await onRecordBillPayment(payNowTarget.bill, payNowTarget.dueDate, moneyFromMajor(payAmount, currencyCode));
        } else if (onAddTransaction) {
          const isCredit = bill.paymentMethod === 'credit';
          const hasExistingCycleTx = transactions.some(tx => tx.deletedAt === null && tx.id.startsWith(`bill:${bill.id}:${payNowTarget.dueDate}`));
          const newTx: LedgerTransaction = {
            id: hasExistingCycleTx ? `bill:${bill.id}:${payNowTarget.dueDate}:${Crypto.randomUUID()}` : `bill:${bill.id}:${payNowTarget.dueDate}`,
            accountId: isCredit ? bill.creditAccountId! : null,
            date: todayStr,
            appliesToDate: payNowTarget.dueDate,
            amount: paymentAmount,
            category: isCredit ? (bill.category === 'subscription' ? 'subscription' : 'utilities') : 'debit_bill',
            payee: bill.name,
            memo: `Payment for ${payNowTarget.dueDate} [bill:${bill.id}]`,
            source: 'recurring_bill',
            reconciled: false,
            createdAt: new Date().toISOString(),
            deletedAt: null,
          };
          await onAddTransaction(newTx);
        }
      } else if (payNowTarget.type === 'debt' && payNowTarget.debt) {
        const newTx: LedgerTransaction = {
          id: `tx:${Crypto.randomUUID()}`,
          accountId: payNowTarget.debt.id,
          date: todayStr,
          appliesToDate: payNowTarget.dueDate,
          amount: moneyFromMajor(payAmount, currencyCode),
          category: 'payment',
          payee: `Payment to ${payNowTarget.debt.name}`,
          memo: `Payment for ${payNowTarget.dueDate}`,
          source: 'manual',
          reconciled: false,
          createdAt: new Date().toISOString(),
          deletedAt: null,
        };
        if (onAddTransaction) {
          await onAddTransaction(newTx);
        }
      }
      setPayNowTarget(null);
    } catch (err) {
      setPayNowError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setPayNowBusy(false);
    }
  };

  const openBillEditor = (bill: RecurringBill) => {
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
    setShowAddBillModal(true);
  };

  const requestEndBill = (bill: RecurringBill) => {
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
    ].join('\n\n');
    return Alert.alert(
    'End recurring item and remove future entries?',
    message,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End recurring item', style: 'destructive', onPress: () => {
        if (!onDeleteRecurringBill || billSaveBusyRef.current) return;
        billSaveBusyRef.current = true;
        setAddBillError('');
        void onDeleteRecurringBill(bill.id, preview.snapshotToken).then(outcome => {
          if (outcome.status === 'pending') Alert.alert('Removal pending confirmation', outcome.message ?? 'Server confirmation is still pending.');
          else if (outcome.status === 'partial') Alert.alert('Removal incomplete', outcome.message ?? `${outcome.deletedTransactions} of ${outcome.totalTransactions} future ledger items were confirmed deleted. Some work remains.`);
          else Alert.alert('Recurring item ended', outcome.message ?? `${outcome.deletedTransactions} future-cycle transaction(s) were confirmed deleted. Recorded prepayments and their balance effects were preserved.`);
          if (shouldDismissRecurringBillEditor(outcome)) {
            setShowAddBillModal(false);
            setEditingBill(null);
          }
        }).catch(err => setAddBillError(err instanceof Error ? err.message : 'Unable to end this recurring item.')).finally(() => {
          billSaveBusyRef.current = false;
        });
      } },
    ],
    );
  };

  const handleSaveBill = async () => {
    if (billSaveBusyRef.current) return;
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

    if (newBillPaymentMethod === 'credit' && !newBillCreditAccountId) {
      setAddBillError('Please select which credit card this bill will be charged to.');
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
      onAdd={() => {
        setEditingBill(null);
        draftBillIdRef.current = Crypto.randomUUID();
        draftBillPaidTodayRef.current = {};
        setNewBillName('');
        setNewBillAmount('');
        setNewBillCustomCategory('');
        setNewBillDueDay('15');
        setNewBillCategory('utilities');
        setNewBillPaymentMethod('debit');
        setNewBillCreditAccountId(data.debts.find(d => d.category === 'Credit card')?.id ?? '');
        setShowAddBillModal(prev => !prev);
      }}
      addLabel="Add recurring bill"
    >
      {!!saveError && (
        <Text accessibilityRole="alert" style={ui.text}>
          {saveError}
        </Text>
      )}

      {/* Add recurring bill modal */}
      <SheetModal visible={showAddBillModal} onClose={() => { setShowAddBillModal(false); setEditingBill(null); }}>
        <Card>
          <SheetFormHeader title={editingBill ? 'Edit recurring bill' : 'Add recurring bill'} closeLabel="Close recurring item editor"
            onClose={() => { setShowAddBillModal(false); setEditingBill(null); draftBillIdRef.current = null; draftBillPaidTodayRef.current = {}; }} />

          <Text style={[ui.small, { marginTop: 6 }]}>Bill name</Text>
          <TextInput
            accessibilityLabel="Bill name"
            style={ui.input}
            placeholder="e.g. Electric & Gas, Internet, Gym"
            placeholderTextColor="#6E7571"
            value={newBillName}
            onChangeText={setNewBillName}
          />

          <View style={[ui.row, { gap: 8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={ui.small}>{`Amount (${currencySymbol})`}</Text>
              <TextInput
                accessibilityLabel="Bill amount"
                style={ui.input}
                placeholder="120.00"
                placeholderTextColor="#6E7571"
                keyboardType="decimal-pad"
                value={newBillAmount}
                onChangeText={t => setNewBillAmount(prev => acceptMoneyEdit(prev, t, currencyCode))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={ui.small}>Due day (1–31)</Text>
              <TextInput
                accessibilityLabel="Due day"
                style={ui.input}
                placeholder="15"
                placeholderTextColor="#6E7571"
                keyboardType="number-pad"
                value={newBillDueDay}
                onChangeText={setNewBillDueDay}
              />
            </View>
          </View>

          {!editingBill && Number.isInteger(Number(newBillDueDay)) && Number(newBillDueDay) >= 1 && Number(newBillDueDay) <= 31 ? (
            <Text style={ui.small}>{`First due date: ${obligationFirstDueDate(Number(newBillDueDay), currentHouseholdDate(effectiveTimeZone), currencyCode)}`}</Text>
          ) : null}

          {/* Category Selector */}
          <SelectDropdown
            label="Category"
            sheetTitle="Select Bill Category"
            value={newBillCategory}
            options={BILL_CATEGORIES}
            onSelect={setNewBillCategory}
          />
          {newBillCategory === 'other_bill' ? <>
            <Text style={[ui.small, { marginTop: 8 }]}>Custom category name (optional)</Text>
            <TextInput accessibilityLabel="Custom recurring spending category" style={ui.input}
              placeholder="e.g. Transportation" placeholderTextColor="#6E7571" maxLength={40}
              value={newBillCustomCategory} onChangeText={setNewBillCustomCategory} />
            {reusableCustomCategoryLabels.filter(label => label.toLocaleLowerCase() !== newBillCustomCategory.trim().toLocaleLowerCase()).slice(0, 6).length ? <View style={[ui.row, { flexWrap: 'wrap' }]}>
                {reusableCustomCategoryLabels.filter(label => label.toLocaleLowerCase() !== newBillCustomCategory.trim().toLocaleLowerCase()).slice(0, 6)
                  .map(label => <Pressable key={label.toLocaleLowerCase()} accessibilityRole="button" accessibilityLabel={`Reuse ${label} category`} onPress={() => setNewBillCustomCategory(label)} style={ui.segment}><Text style={ui.buttonText}>{label}</Text></Pressable>)}
              </View> : null}
          </> : null}

          {/* Payment Method Selector (Debit vs Credit Card) */}
          <Text style={[ui.small, { marginTop: 10 }]}>Payment method</Text>
          <View style={[ui.row, { gap: 8 }]}>
            <Pressable
              onPress={() => setNewBillPaymentMethod('debit')}
              style={[
                ui.segment,
                { flex: 1, paddingVertical: 8 },
                newBillPaymentMethod === 'debit' && ui.selected,
              ]}
            >
              <Text style={[ui.buttonText, { textAlign: 'center', color: newBillPaymentMethod === 'debit' ? '#81DFD2' : '#AAB3AD' }]}>
                Checking / Debit ($0 debt)
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setNewBillPaymentMethod('credit')}
              style={[
                ui.segment,
                { flex: 1, paddingVertical: 8 },
                newBillPaymentMethod === 'credit' && ui.selected,
              ]}
            >
              <Text style={[ui.buttonText, { textAlign: 'center', color: newBillPaymentMethod === 'credit' ? '#E3A088' : '#AAB3AD' }]}>
                Credit Card (+Debt)
              </Text>
            </Pressable>
          </View>

          {newBillPaymentMethod === 'credit' ? (
            creditCards.length > 0 ? (
              <SelectDropdown
                label="Charge to Credit Card"
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
              <Text style={[ui.small, { color: '#E3A088', marginTop: 8 }]}>
                No credit cards entered yet. Add one in the Debt tab first.
              </Text>
            )
          ) : null}

          {editingBill && (() => {
            const linkedDebtId = Object.entries(data.loanBillPairingByDebtId ?? {}).find(([, relation]) => relation?.status === 'linked' && relation.billId === editingBill.id)?.[0];
            const linkedDebt = linkedDebtId ? data.debts.find(debt => debt.id === linkedDebtId) : undefined;
            if (!linkedDebtId) return null;
            return <View style={[ui.divider, { gap: 8 }]}>
              <Text style={ui.heading}>Loan payment link</Text>
              <Text style={ui.small}>{linkedDebt ? `${linkedDebt.name} · ${linkedDebt.category} · minimum ${formatCurrency(linkedDebt.minimumPayment, currencySymbol)} / month` : 'This recurring item has a saved loan link whose account is unavailable.'}</Text>
              <Text style={ui.small}>This link changes Budget commitment/reminder grouping only. It does not create a payment or change a debt balance.</Text>
              <Pressable accessibilityRole="button" disabled={pairingBusy} onPress={() => void savePairing(linkedDebtId, null)} style={ui.button}><Text style={ui.buttonText}>Unlink loan payment</Text></Pressable>
            </View>;
          })()}

          {!!addBillError ? (
            <Text style={[ui.small, { color: '#FF7A59', marginTop: 6 }]}>{addBillError}</Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save recurring bill"
            onPress={handleSaveBill}
            style={[ui.button, { marginTop: 12, backgroundColor: '#81DFD2', paddingVertical: 10, alignItems: 'center' }]}
          >
            <Text style={[ui.buttonText, { color: '#1F201F', fontWeight: 'bold' }]}>{editingBill ? 'Save Changes' : 'Save Recurring Bill'}</Text>
          </Pressable>
          {editingBill && onDeleteRecurringBill ? <Pressable accessibilityRole="button" accessibilityLabel={`End recurring item ${editingBill.name}`} onPress={() => requestEndBill(editingBill)} style={[ui.button, { marginTop: 8, borderWidth: 1, borderColor: '#8B4F42', alignItems: 'center' }]}>
            <Text style={[ui.buttonText, { color: '#E3A088' }]}>End recurring item</Text>
          </Pressable> : null}
        </Card>
      </SheetModal>

      <SheetModal visible={showIncomeModal} onClose={() => setShowIncomeModal(false)}>
        <Card>
          <SheetFormHeader title={incomeEditorId === 'primary' ? 'Edit primary income' : incomeEditorId === 'new' ? 'Add income source' : 'Edit income source'}
            closeLabel="Close income editor" onClose={() => setShowIncomeModal(false)} />
          {incomeEditorId !== 'primary' ? <>
            <Text style={ui.small}>Income source name</Text>
            <TextInput accessibilityLabel="Income source name" style={ui.input} value={incomeName} onChangeText={setIncomeName} placeholder="Salary, side income" placeholderTextColor="#6E7571" />
          </> : null}
          <Text style={ui.small}>{`Amount per pay period (${currencySymbol})`}</Text>
          <TextInput accessibilityLabel="Income amount" style={ui.input} keyboardType="decimal-pad" value={incomeAmount} onChangeText={value => setIncomeAmount(previous => acceptMoneyEdit(previous, value, currencyCode))} placeholder="0.00" placeholderTextColor="#6E7571" />
          <Text style={ui.small}>Pay frequency</Text>
          <SelectDropdown label="Pay frequency" sheetTitle="Select pay frequency" value={incomeFrequency} options={PAY_FREQUENCY_OPTIONS.map(option => ({ value: option.value, label: option.label }))} onSelect={setIncomeFrequency} />
          {!!addBillError ? <Text accessibilityRole="alert" style={[ui.small, { color: '#FF7A59' }]}>{addBillError}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Save income" disabled={incomeBusy} onPress={() => void saveIncome()} style={[ui.button, { marginTop: 10, backgroundColor: '#81DFD2', alignItems: 'center' }]}><Text style={[ui.buttonText, { color: '#1F201F' }]}>{incomeBusy ? 'Saving…' : 'Save income'}</Text></Pressable>
          {incomeEditorId !== 'primary' && incomeEditorId !== 'new' ? <Pressable accessibilityRole="button" accessibilityLabel="Remove income source" disabled={incomeBusy} onPress={() => void removeIncome()} style={[ui.button, { marginTop: 8, alignItems: 'center' }]}><Text style={[ui.buttonText, { color: '#E3A088' }]}>Remove source</Text></Pressable> : null}
        </Card>
      </SheetModal>

      {tab === 'Budget' ? (
        <>
          {/* Monthly Cashflow Overview */}
          <Card>
            <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <View>
                <Text style={ui.small}>Total monthly take-home income</Text>
                <Text style={ui.title}>{formatCurrency(income, currencySymbol)}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit income"
                style={ui.button}
                onPress={() => openIncomeEditor('primary')}
              >
                <Text style={ui.buttonText}>Edit income</Text>
              </Pressable>
            </View>

            <Bar percent={cashflow.debtPaymentPercent + cashflow.debitBillsPercent} />

            <View style={[ui.row, { alignItems: 'stretch', marginTop: 6 }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={ui.small}>Debt Plan</Text>
                <Text style={ui.heading}>{formatCurrency(cashflow.totalDebtPlanPayment, currencySymbol)}</Text>
                <Text style={[ui.small, { color: '#81DFD2' }]}>{`${cashflow.debtPaymentPercent}% of income`}</Text>
              </View>
              <View style={{ width: 1, backgroundColor: '#353A37' }} />
              <View style={{ flex: 1, paddingLeft: 8, gap: 2 }}>
                <Text style={ui.small}>Debit Bills</Text>
                <Text style={ui.heading}>{formatCurrency(cashflow.totalDebitBills, currencySymbol)}</Text>
                <Text style={[ui.small, { color: '#AAB3AD' }]}>{`${cashflow.debitBillsPercent}% of income`}</Text>
              </View>
              <View style={{ width: 1, backgroundColor: '#353A37' }} />
              <View style={{ flex: 1, paddingLeft: 8, gap: 2 }}>
                <Text style={ui.small}>{cashflow.isDeficit ? 'Deficit' : 'Free Cash'}</Text>
                <Text style={[ui.value, { color: cashflow.isDeficit ? '#FF7A59' : '#73D9C6' }]}>
                  {formatCurrency(cashflow.remainingFreeCashflow, currencySymbol)}
                </Text>
                <Text style={[ui.small, { color: cashflow.isDeficit ? '#FF7A59' : '#73D9C6' }]}>
                  {cashflow.isDeficit ? 'Over budget' : `${cashflow.freeCashPercent}% unallocated`}
                </Text>
              </View>
            </View>

            <Text style={[ui.small, { marginTop: 6 }]}>
              Committed expenses and debt strategy payments. A linked recurring loan bill replaces that loan minimum in this commitment total; payoff calculations and recorded balances remain unchanged.
            </Text>
          </Card>

          {/* Income Sources */}
          <Card>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.heading}>Income sources</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Add income source" onPress={() => openIncomeEditor()} style={ui.button}><Text style={ui.buttonText}>Add source</Text></Pressable>
            </View>
            {incomes.map(i => (
              <Pressable key={i.id} accessibilityRole="button" accessibilityLabel={`Edit ${i.name}`} onPress={() => openIncomeEditor(i.id)} style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={ui.text}>{i.name}</Text>
                  <Text style={ui.small}>
                    {`${formatCurrency(i.amount, currencySymbol)} · ${
                      PAY_FREQUENCY_OPTIONS.find(o => o.value === i.frequency)?.label
                    }`}
                  </Text>
                </View>
                <Text style={ui.value}>
                  {formatCurrency(normalizeMonthlyIncome(i.amount, i.frequency, currencyCode), currencySymbol)}
                  /mo
                </Text>
              </Pressable>
            ))}
          </Card>

          {/* Category Budget Breakdown */}
          <Card>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous spending month" onPress={() => setSpendingMonth(getPreviousMonthString(spendingMonth))}><Text style={ui.buttonText}>Previous</Text></Pressable>
              <Text style={ui.heading}>{spendingMonth} spending</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Next spending month" onPress={() => setSpendingMonth(getNextMonthString(spendingMonth))}><Text style={ui.buttonText}>Next</Text></Pressable>
            </View>
            <Text style={[ui.small, { marginBottom: 8 }]}>Recorded purchases are listed here, separately from recurring commitments.</Text>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.heading}>Monthly Budget Breakdown</Text>
              <View style={ui.badge}>
                <Text style={ui.badgeText}>{`${displayBreakdown.length} CATEGORIES`}</Text>
              </View>
            </View>

            {displayBreakdown.map(item => {
              const isDebt = item.categoryKey === 'debt';
              const isPurchases = item.categoryKey === 'purchases';
              const icon: AppIconName =
                isDebt
                  ? 'debt'
                  : isPurchases
                    ? 'transactions'
                  : item.categoryKey === 'housing'
                    ? 'homeLoan'
                    : item.categoryKey === 'utilities'
                      ? 'auto'
                      : item.categoryKey === 'subscription'
                        ? 'calendar'
                        : item.categoryKey === 'insurance'
                          ? 'info'
                          : 'transactions';

              return (
                <View key={item.categoryKey} style={ui.divider}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: expandedCategory === item.categoryKey }}
                    accessibilityLabel={`${item.label}, ${expandedCategory === item.categoryKey ? 'hide' : 'show'} line items`}
                    onPress={() => setExpandedCategory(expandedCategory === item.categoryKey ? null : item.categoryKey)}
                    style={[ui.row, { justifyContent: 'space-between' }]}
                  >
                    <View style={[ui.row, { gap: 8, flex: 1 }]}>
                      <View style={ui.iconCircle}>
                        <AppIcon name={icon} size={18} color={isDebt ? '#81DFD2' : '#AAB3AD'} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={ui.heading}>{item.label}</Text>
                        <Text style={ui.small}>
                          {isDebt
                            ? 'Projected active payoff commitment'
                            : isPurchases
                              ? `${item.count} recorded purchase${item.count === 1 ? '' : 's'} this month`
                            : item.count > 0
                              ? `${item.count} active bill${item.count > 1 ? 's' : ''}`
                              : 'No bills added'}
                        </Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[ui.value, { color: isDebt ? '#81DFD2' : '#F9F9F6' }]}>
                        {formatCurrency(item.amount, currencySymbol)}
                      </Text>
                      <Text style={ui.small}>{`${item.percentOfIncome}% of income`}</Text>
                    </View>
                    <AppIcon name={expandedCategory === item.categoryKey ? 'chevronDown' : 'chevronRight'} size={15} color="#AAB3AD" />
                  </Pressable>
                  {item.percentOfIncome > 0 ? <Bar percent={item.percentOfIncome} /> : null}
                  {expandedCategory === item.categoryKey ? (
                    <View style={{ paddingTop: 6, paddingLeft: 40 }}>
                      {isDebt ? (
                        <>
                          {plan.payoffOrder.map(account => {
                            const debt = data.debts.find(candidate => candidate.id === account.id);
                            return (
                              <View key={account.id} style={[ui.row, ui.divider, { justifyContent: 'space-between', gap: 8 }]}>
                                <View style={{ flex: 1 }}>
                                  <Text style={ui.text}>{account.name}</Text>
                                  <Text style={ui.small}>{debt ? `Minimum ${formatCurrency(debt.minimumPayment, currencySymbol)}` : 'Active payoff account'}</Text>
                                </View>
                                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                                  <Text style={ui.value}>{formatCurrency(account.firstMonthPayment, currencySymbol)}/mo</Text>
                                  {debt && onEditDebt ? <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${debt.name}`} onPress={() => onEditDebt(debt.id)}><Text style={ui.buttonText}>Edit account</Text></Pressable> : null}
                                </View>
                              </View>
                            );
                          })}
                          <View style={[ui.row, { justifyContent: 'space-between', paddingVertical: 8 }]}>
                            <View style={{ flex: 1 }}><Text style={ui.text}>Extra monthly payment</Text><Text style={ui.small}>Added to minimum payments</Text></View>
                            <View style={{ alignItems: 'flex-end', gap: 4 }}>
                              <Text style={ui.value}>{formatCurrency(data.extraMonthlyPayment, currencySymbol)}</Text>
                              <Pressable accessibilityRole="button" accessibilityLabel="Open payoff strategy in Debt" onPress={onOpenStrategy}><Text style={ui.buttonText}>Edit strategy</Text></Pressable>
                            </View>
                          </View>
                          {!plan.payoffOrder.length ? <Text style={ui.small}>No active debt accounts.</Text> : null}
                        </>
                      ) : isPurchases ? (
                        <View>
                          {singlePurchases.items.map(tx => <View key={tx.id} style={[ui.row, ui.divider, { justifyContent: 'space-between' }]}>
                            <View style={{ flex: 1 }}><Text style={ui.text}>{tx.payee || 'Purchase'}</Text><Text style={ui.small}>{tx.date}</Text></View>
                            <Text style={ui.value}>{formatCurrency(moneyToMajor(tx.amount), currencySymbol)}</Text>
                          </View>)}
                        </View>
                      ) : (
                        (() => {
                          const customCategoryKey = item.categoryKey.startsWith('custom:') ? item.categoryKey.slice('custom:'.length) : null;
                          const bills = recurringBills.filter(bill => {
                            if (!bill.active) return false;
                            const label = data.recurringBillCategoryLabelByBillId?.[bill.id]?.trim();
                            if (customCategoryKey !== null) return bill.category === 'other_bill' && label?.toLocaleLowerCase() === customCategoryKey;
                            return bill.category === item.categoryKey && !label;
                          });
                          if (!bills.length) return <Text style={ui.small}>No active bill line items.</Text>;
                          return bills.map(bill => (
                            <View key={bill.id} style={[ui.row, ui.divider, { justifyContent: 'space-between', gap: 8 }]}>
                              <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${bill.name}`} onPress={() => openBillEditor(bill)} style={{ flex: 1 }}>
                                <Text style={ui.text}>{bill.name}</Text>
                                <Text style={ui.small}>{`Due day ${bill.dueDay} · ${bill.paymentMethod === 'credit' ? 'Credit card' : 'Checking / debit'}`}</Text>
                              </Pressable>
                              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                                <Text style={ui.value}>{formatCurrency(moneyToMajor(bill.amount), currencySymbol)}</Text>
                                <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${bill.name}`} onPress={() => openBillEditor(bill)}><Text style={ui.buttonText}>Edit</Text></Pressable>
                              </View>
                            </View>
                          ));
                        })()
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Card>
        </>
      ) : tab === 'Upcoming' ? (
        <>
          <Card>
          <Text style={ui.heading}>Upcoming bills & payment schedule</Text>
          <Text style={ui.text}>
            Track scheduled recurring obligations and confirm matched payments. Credit card charges increase card debt, while debit bills are cashflow-only ($0 debt).
          </Text>

          {/* Unpaid Prior and Current Overdue (Past Due) Obligations */}
          {(() => {
            const todayStr = currentHouseholdDate(effectiveTimeZone);
            const overdueObligations = calculateOverdueObligations({
              debts: data.debts,
              recurringBills,
              transactions,
              asOfDate: todayStr,
              currencyCode,
              schedules: data.obligationSchedules,
              loanBillPairs: linkedPairs,
            });

            const pastDueBills = overdueObligations
              .filter((item): item is OverdueObligationItem & { bill: RecurringBill } => item.kind === 'bill' && Boolean(item.bill) && item.dueCycleMonth !== currentMonthStr);
            const pastDueDebts = overdueObligations
              .filter((item): item is OverdueObligationItem & { debt: DebtItem } => item.kind === 'debt' && Boolean(item.debt) && item.dueCycleMonth !== currentMonthStr);
            const hasPendingPastDueConfirmation = [...pastDueBills, ...pastDueDebts]
              .some(item => item.settlementStatus === 'pending_confirmation');

            if (pastDueBills.length === 0 && pastDueDebts.length === 0) return null;

            const handleMarkAllPastDuePaid = async () => {
              if (payNowBusy) return;
              setPayNowBusy(true);
              setPayNowError('');
              try {
                const newTxs: LedgerTransaction[] = [];
                for (const item of pastDueBills) {
                  if (item.settlementStatus === 'pending_confirmation') continue;
                  const isCredit = item.bill.paymentMethod === 'credit';
                  const category = isCredit
                    ? (item.bill.category === 'subscription' ? 'subscription' : 'utilities')
                    : 'debit_bill';
                  const stableId = `bill:${item.bill.id}:${item.dueDate}`;
                  newTxs.push({
                    id: transactions.some(tx => tx.id === stableId) ? `${stableId}:${Crypto.randomUUID()}` : stableId,
                    accountId: isCredit ? item.bill.creditAccountId! : null,
                    date: todayStr,
                    appliesToDate: item.dueDate,
                    amount: item.match.remainingAmount,
                    category,
                    payee: item.bill.name,
                    memo: `Payment for ${item.dueDate} [bill:${item.bill.id}]`,
                    source: 'recurring_bill',
                    reconciled: true,
                    createdAt: new Date().toISOString(),
                    deletedAt: null,
                  });
                }
                for (const item of pastDueDebts) {
                  if (item.settlementStatus === 'pending_confirmation') continue;
                  const stableId = `min:${item.debt.id}:${item.dueDate}`;
                  newTxs.push({
                    id: transactions.some(tx => tx.id === stableId) ? `${stableId}:${Crypto.randomUUID()}` : stableId,
                    accountId: item.debt.id,
                    date: todayStr,
                    appliesToDate: item.dueDate,
                    amount: item.match.remainingAmount,
                    category: 'payment',
                    payee: `Payment to ${item.debt.name}`,
                    memo: `Payment for ${item.dueDate}`,
                    source: 'manual',
                    reconciled: true,
                    principalAmount: makeMoney(currencyCode, 0),
                    createdAt: new Date().toISOString(),
                    deletedAt: null,
                  });
                }
                const merged = [...newTxs, ...transactions];
                if (onUpdateTransactions) {
                  await onUpdateTransactions(merged);
                } else if (onAddTransaction) {
                  for (const tx of newTxs) {
                    await onAddTransaction(tx);
                  }
                }
              } catch (err) {
                setPayNowError(err instanceof Error ? err.message : 'Unable to mark all past due as paid.');
              } finally {
                setPayNowBusy(false);
              }
            };

            return (
              <View style={{ marginTop: 10, marginBottom: 8, padding: 12, backgroundColor: '#2D201E', borderRadius: 12, borderWidth: 1, borderColor: '#5C2D25' }}>
                <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }]}>
                  <Text style={[ui.small, { color: '#FF7A59', fontWeight: 'bold' }]}>
                    PAST DUE OBLIGATIONS (OVERDUE)
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Mark all past due as paid"
                    disabled={payNowBusy || hasPendingPastDueConfirmation}
                    onPress={() => void handleMarkAllPastDuePaid()}
                    style={[ui.button, { backgroundColor: '#369B97', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }]}>
                    <Text style={[ui.buttonText, { color: '#FFFFFF', fontWeight: 'bold', fontSize: 11 }]}>
                      {payNowBusy ? 'Settling…' : hasPendingPastDueConfirmation ? 'Awaiting confirmation' : 'Mark All Paid'}
                    </Text>
                  </Pressable>
                </View>
                {pastDueBills.map(item => (
                  <View key={`past-bill-${item.bill.id}-${item.dueDate}`} style={[ui.divider, ui.row, { justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[ui.heading, { color: '#FFA085' }]}>{item.bill.name}</Text>
                      <Text style={[ui.small, { color: item.settlementStatus === 'pending_confirmation' ? '#F2C94C' : '#E3A088' }]}>
                        {`Overdue from ${item.dueDate} · ${item.settlementStatus === 'pending_confirmation' ? 'Awaiting confirmation' : item.match.isPartiallyPaid ? 'Partially paid' : 'Unpaid'}`}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={[ui.value, { color: '#FFA085' }]}>{formatCurrency(moneyToMajor(item.match.remainingAmount), currencySymbol)}</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Pay past due for ${item.bill.name}`}
                        disabled={item.settlementStatus === 'pending_confirmation'}
                        onPress={() => {
                          setPayNowError('');
                          setPayNowTarget({
                            type: 'bill',
                            name: item.bill.name,
                            dueDate: item.dueDate,
                            requiredAmount: moneyToMajor(item.requiredAmount),
                            accountId: item.bill.creditAccountId,
                            bill: { ...item.bill, amount: item.requiredAmount },
                          });
                        }}
                        style={[ui.button, { backgroundColor: '#FF7A59', paddingHorizontal: 10, paddingVertical: 4 }]}>
                        <Text style={[ui.buttonText, { color: '#1F201F', fontWeight: 'bold', fontSize: 12 }]}>{item.settlementStatus === 'pending_confirmation' ? 'Awaiting confirmation' : 'Pay Past Due'}</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
                {pastDueDebts.map(item => (
                  <View key={`past-debt-${item.debt.id}-${item.dueDate}`} style={[ui.divider, ui.row, { justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[ui.heading, { color: '#FFA085' }]}>{item.debt.name} minimum</Text>
                      <Text style={[ui.small, { color: item.settlementStatus === 'pending_confirmation' ? '#F2C94C' : '#E3A088' }]}>
                        {`Overdue from ${item.dueDate} · ${item.settlementStatus === 'pending_confirmation' ? 'Awaiting confirmation' : item.match.isPartiallyPaid ? 'Partially paid' : 'Unpaid'}`}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={[ui.value, { color: '#FFA085' }]}>{formatCurrency(moneyToMajor(item.match.remainingAmount), currencySymbol)}</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Pay past due for ${item.debt.name}`}
                        disabled={item.settlementStatus === 'pending_confirmation'}
                        onPress={() => {
                          setPayNowError('');
                          setPayNowTarget({
                            type: 'debt',
                            name: item.debt.name,
                            dueDate: item.dueDate,
                            requiredAmount: moneyToMajor(item.requiredAmount),
                            accountId: item.debt.id,
                            debt: item.debt,
                          });
                        }}
                        style={[ui.button, { backgroundColor: '#FF7A59', paddingHorizontal: 10, paddingVertical: 4 }]}>
                        <Text style={[ui.buttonText, { color: '#1F201F', fontWeight: 'bold', fontSize: 12 }]}>{item.settlementStatus === 'pending_confirmation' ? 'Awaiting confirmation' : 'Pay Past Due'}</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            );
          })()}

          {activeRecurringBills.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              <Text style={[ui.small, { color: '#81DFD2', fontWeight: 'bold', marginBottom: 4 }]}>
                RECURRING HOUSEHOLD BILLS ({activeRecurringBills.length})
              </Text>
              {activeRecurringBills.flatMap(b => [currentMonthStr, getNextMonthString(currentMonthStr)].flatMap(month => {
                const targetDebt = data.debts.find(d => d.id === b.creditAccountId);
                const isCredit = b.paymentMethod === 'credit';
                const schedule = data.obligationSchedules?.[obligationScheduleKey('bill', b.id)];
                const cycle = schedule ? getObligationCycle(schedule, month) : null;
                if (schedule && (!cycle || cycle.acknowledgedPaid)) return [];
                const dueDate = cycle?.dueDate ?? resolveRecurringBillDate(month, b.dueDay);
                const cycleBill = cycle ? { ...b, amount: cycle.amount } : b;
                const bObligation: PaymentObligation = {
                  id: b.id,
                  kind: 'bill',
                  name: b.name,
                  dueDate,
                  dueCycleMonth: month,
                  requiredAmount: cycle?.amount ?? b.amount,
                  accountId: b.creditAccountId,
                  billId: b.id,
                  linkedDebtId: Object.entries(linkedPairs).find(([, billId]) => billId === b.id)?.[0],
                  bill: b,
                };
                const bState = getObligationPaymentState(bObligation, transactions, currencyCode);
                const bMatch = bState.confirmedMatch;
                const isPastDue = dueDate < todayStr && bState.status !== 'paid';
                return [(
                  <View key={`${b.id}:${dueDate}`} style={[ui.divider, ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                    <View style={[ui.row, { gap: 10, flex: 1 }]}>
                      <View style={ui.iconCircle}>
                        <AppIcon
                          name={isCredit ? 'creditCard' : 'calendar'}
                          size={18}
                          color={isCredit ? '#E3A088' : '#81DFD2'}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={ui.heading}>{b.name}</Text>
                        <Text style={ui.small}>
                          {`Due ${dueDate} · ${isCredit ? targetDebt?.name || 'Credit card' : 'Checking'}`}
                        </Text>
                        {bState.status === 'pending_confirmation' ? (
                          <Text style={[ui.small, { color: '#F2C94C' }]}>
                            {`${formatCurrency(moneyToMajor(bState.pendingAmount), currencySymbol)} awaiting confirmation`}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <Text style={[ui.value, { color: isCredit ? '#E3A088' : '#81DFD2' }]}>
                        {formatCurrency(moneyToMajor(cycle?.amount ?? b.amount), currencySymbol)}
                      </Text>
                      <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                        {bMatch.isSatisfied ? (
                          <View style={[ui.badge, { backgroundColor: '#1E2C28' }]}>
                            <Text style={[ui.badgeText, { color: '#73D882', fontSize: 10 }]}>✓ Paid</Text>
                          </View>
                        ) : bState.status === 'pending_confirmation' ? (
                          <View style={[ui.badge, { backgroundColor: '#302B20' }]}>
                            <Text style={[ui.badgeText, { color: '#F2C94C', fontSize: 10 }]}>Awaiting confirmation</Text>
                          </View>
                        ) : bMatch.isPartiallyPaid ? (
                          <View style={[ui.badge, { backgroundColor: '#2D2825' }]}>
                            <Text style={[ui.badgeText, { color: '#81DFD2', fontSize: 10 }]}>
                              {`Partial (${formatCurrency(moneyToMajor(bMatch.remainingAmount), currencySymbol)} left)`}
                            </Text>
                          </View>
                        ) : (
                          <View style={[ui.badge, { backgroundColor: isPastDue ? '#38221E' : isCredit ? '#2D2825' : '#1E2C28' }]}>
                            <Text style={[ui.badgeText, { color: isPastDue ? '#FF9B82' : isCredit ? '#E3A088' : '#81DFD2', fontSize: 10 }]}>
                              {isPastDue ? 'Past due' : 'Unpaid'}
                            </Text>
                          </View>
                        )}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={bState.status === 'pending_confirmation' ? `Payment for ${b.name} awaiting confirmation` : `Pay now for ${b.name}`}
                          disabled={bState.status === 'pending_confirmation'}
                          onPress={() => {
                            setPayNowError('');
                            setPayNowTarget({
                              type: 'bill',
                              name: b.name,
                              dueDate,
                              requiredAmount: moneyToMajor(cycle?.amount ?? b.amount),
                              accountId: b.creditAccountId,
                              bill: cycleBill,
                            });
                          }}
                          style={[ui.button, { backgroundColor: bMatch.isSatisfied ? '#353A37' : bState.status === 'pending_confirmation' ? '#625B43' : '#81DFD2', paddingHorizontal: 10, paddingVertical: 4 }]}
                        >
                          <Text style={[ui.buttonText, { color: bMatch.isSatisfied ? '#AAB3AD' : '#1F201F', fontWeight: 'bold', fontSize: 12 }]}>
                            {bMatch.isSatisfied ? 'Details' : bState.status === 'pending_confirmation' ? 'Awaiting confirmation' : bMatch.isPartiallyPaid ? 'Pay Rest' : 'Pay Now'}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                )];
              }))}
            </View>
          ) : null}

          <View style={{ marginTop: 12 }}>
            <Text style={[ui.small, { color: '#81DFD2', fontWeight: 'bold', marginBottom: 4 }]}>
              DEBT ACCOUNT MINIMUM REMINDERS
            </Text>
            {data.debts.filter(d => !linkedPairs[d.id] && d.balance > 0 && d.dueDay !== null && (data.obligationSchedules?.[obligationScheduleKey('debt', d.id)] || d.minimumPayment > 0)).length > 0 ? (
              data.debts
                .filter(d => !linkedPairs[d.id] && d.balance > 0 && d.dueDay !== null && (data.obligationSchedules?.[obligationScheduleKey('debt', d.id)] || d.minimumPayment > 0))
                .flatMap(d => [currentMonthStr, getNextMonthString(currentMonthStr)].flatMap(month => {
                  const schedule = data.obligationSchedules?.[obligationScheduleKey('debt', d.id)];
                  const cycle = schedule ? getObligationCycle(schedule, month) : null;
                  if (schedule && (!cycle || cycle.acknowledgedPaid)) return [];
                  const dueDate = cycle?.dueDate ?? resolveRecurringBillDate(month, d.dueDay!);
                  const scale = getCurrency(currencyCode).scale;
                  const dRequiredMoney = cycle?.amount ?? makeMoney(currencyCode, Math.round(d.minimumPayment * 10 ** scale));
                  const dObligation: PaymentObligation = {
                    id: `minimum:${d.id}`,
                    kind: 'debt',
                    name: `${d.name} minimum`,
                    dueDate,
                    dueCycleMonth: month,
                    requiredAmount: dRequiredMoney,
                    accountId: d.id,
                    debt: d,
                  };
                  const dState = getObligationPaymentState(dObligation, transactions, currencyCode);
                  const dMatch = dState.confirmedMatch;
                  const isPastDue = dueDate < todayStr && dState.status !== 'paid';
                  return [(
                    <View key={`${d.id}:${dueDate}`} style={[ui.divider, ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                      <View style={[ui.row, { gap: 10, flex: 1 }]}>
                        <View style={ui.iconCircle}>
                          <AppIcon
                            name={
                              d.category === 'Mortgage'
                                ? 'homeLoan'
                                : d.category === 'Auto loan'
                                  ? 'auto'
                                  : 'creditCard'
                            }
                            size={18}
                            color="#81DFD2"
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={ui.heading}>{d.name}</Text>
                        <Text style={ui.small}>{`Due ${dueDate} · Minimum payment`}</Text>
                        {dState.status === 'pending_confirmation' ? (
                          <Text style={[ui.small, { color: '#F2C94C' }]}>
                            {`${formatCurrency(moneyToMajor(dState.pendingAmount), currencySymbol)} awaiting confirmation`}
                          </Text>
                        ) : null}
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        <Text style={ui.value}>
                          {formatCurrency(moneyToMajor(dRequiredMoney), currencySymbol)}
                        </Text>
                        <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                          {dMatch.isSatisfied ? (
                            <View style={[ui.badge, { backgroundColor: '#1E2C28' }]}>
                              <Text style={[ui.badgeText, { color: '#73D882', fontSize: 10 }]}>✓ Paid</Text>
                            </View>
                          ) : dState.status === 'pending_confirmation' ? (
                            <View style={[ui.badge, { backgroundColor: '#302B20' }]}>
                              <Text style={[ui.badgeText, { color: '#F2C94C', fontSize: 10 }]}>Awaiting confirmation</Text>
                            </View>
                          ) : dMatch.isPartiallyPaid ? (
                            <View style={[ui.badge, { backgroundColor: '#2D2825' }]}>
                              <Text style={[ui.badgeText, { color: '#81DFD2', fontSize: 10 }]}>
                                {`Partial (${formatCurrency(moneyToMajor(dMatch.remainingAmount), currencySymbol)} left)`}
                              </Text>
                            </View>
                          ) : (
                            <View style={[ui.badge, { backgroundColor: isPastDue ? '#38221E' : '#2D2825' }]}>
                              <Text style={[ui.badgeText, { color: isPastDue ? '#FF9B82' : '#AAB3AD', fontSize: 10 }]}>
                                {isPastDue ? 'Past due' : 'Unpaid'}
                              </Text>
                            </View>
                          )}
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={dState.status === 'pending_confirmation' ? `Minimum payment for ${d.name} awaiting confirmation` : `Pay now for ${d.name}`}
                            disabled={dState.status === 'pending_confirmation'}
                            onPress={() => {
                              setPayNowError('');
                              setPayNowTarget({
                                type: 'debt',
                                name: d.name,
                                dueDate,
                                requiredAmount: moneyToMajor(dRequiredMoney),
                                accountId: d.id,
                                debt: d,
                              });
                            }}
                            style={[ui.button, { backgroundColor: dMatch.isSatisfied ? '#353A37' : dState.status === 'pending_confirmation' ? '#625B43' : '#81DFD2', paddingHorizontal: 10, paddingVertical: 4 }]}
                          >
                            <Text style={[ui.buttonText, { color: dMatch.isSatisfied ? '#AAB3AD' : '#1F201F', fontWeight: 'bold', fontSize: 12 }]}>
                              {dMatch.isSatisfied ? 'Details' : dState.status === 'pending_confirmation' ? 'Awaiting confirmation' : dMatch.isPartiallyPaid ? 'Pay Rest' : 'Pay Now'}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  )];
                }))
            ) : (
              <Text style={ui.small}>No due days entered on your debt accounts yet.</Text>
            )}
          </View>
        </Card>

        {/* Pay Now & Match Payment Bottom Sheet Modal */}
        <Modal
          visible={payNowTarget !== null}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setPayNowTarget(null)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }}>
            <View
              style={{
                backgroundColor: '#191F1C',
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                borderWidth: 1,
                borderColor: '#313C36',
                padding: 20,
                paddingBottom: 36,
                maxHeight: '90%',
              }}
            >
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={ui.title}>{`Payment for ${payNowTarget?.name ?? ''}`}</Text>
                  <Text style={ui.small}>{`Due date: ${payNowTarget?.dueDate ?? ''}`}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close payment sheet"
                  onPress={() => setPayNowTarget(null)}
                  style={ui.button}
                >
                  <Text style={{ color: '#AAB3AD', fontSize: 16, fontWeight: 'bold' }}>X</Text>
                </Pressable>
              </View>

              {!!payNowError && (
                <Text style={[ui.small, { color: '#FF7A59', marginBottom: 10 }]}>{payNowError}</Text>
              )}

              {/* Cycle Payment Metrics */}
              <View style={[ui.card, { padding: 12, marginBottom: 16 }]}>
                <View style={[ui.row, { justifyContent: 'space-around', alignItems: 'center' }]}>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={ui.small}>Required min</Text>
                    <Text style={ui.heading}>{formatCurrency(requiredAmount, currencySymbol)}</Text>
                  </View>
                  <View style={{ width: 1, height: 32, backgroundColor: '#353A37' }} />
                  <View style={{ alignItems: 'center' }}>
                    <Text style={ui.small}>Paid (confirmed)</Text>
                    <Text style={[ui.heading, { color: paidThisCycle > 0 ? '#73D9C6' : '#AAB3AD' }]}>
                      {formatCurrency(paidThisCycle, currencySymbol)}
                    </Text>
                    {pendingThisCycle > 0 ? (
                      <Text style={[ui.small, { color: '#F2C94C', fontSize: 10 }]}>
                        {`(+${formatCurrency(pendingThisCycle, currencySymbol)} pending)`}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ width: 1, height: 32, backgroundColor: '#353A37' }} />
                  <View style={{ alignItems: 'center' }}>
                    <Text style={ui.small}>Remaining</Text>
                    <Text style={[ui.value, { color: remainingAmount === 0 ? '#73D9C6' : '#E3A088' }]}>
                      {formatCurrency(remainingAmount, currencySymbol)}
                    </Text>
                  </View>
                </View>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 300 }}>
                {/* Match a Recorded Payment */}
                <View style={{ marginBottom: 18 }}>
                  <Text style={[ui.heading, { fontSize: 15, marginBottom: 4 }]}>Match a recorded payment</Text>
                  <Text style={[ui.small, { marginBottom: 10 }]}>
                    Link an existing unassigned transaction to this due date.
                  </Text>

                  {candidatePayments.length > 0 ? (
                    candidatePayments.map(tx => (
                      <View
                        key={tx.id}
                        style={[
                          ui.divider,
                          ui.row,
                          { justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
                        ]}
                      >
                        <View style={{ flex: 1 }}>
                          <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                            <Text style={ui.heading}>{tx.payee}</Text>
                            {tx.isPending ? (
                              <View style={[ui.badge, { backgroundColor: '#38321E', borderColor: '#F2C94C', borderWidth: 1, paddingVertical: 1, paddingHorizontal: 5 }]}>
                                <Text style={[ui.badgeText, { color: '#F2C94C', fontSize: 9 }]}>Pending</Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={ui.small}>{`${tx.date} · ${tx.memo || 'Unassigned payment'}`}</Text>
                        </View>
                        <View style={[ui.row, { gap: 10, alignItems: 'center' }]}>
                          <Text style={[ui.value, { color: '#81DFD2' }]}>
                            {formatCurrency(moneyToMajor(tx.amount), currencySymbol)}
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Match payment from ${tx.payee}`}
                            disabled={payNowBusy}
                            onPress={() => void handleMatchPayment(tx)}
                            style={[
                              ui.button,
                              { backgroundColor: '#1E2C28', borderColor: '#81DFD2', borderWidth: 1, paddingVertical: 4, paddingHorizontal: 10 },
                            ]}
                          >
                            <Text style={[ui.buttonText, { color: '#81DFD2', fontWeight: 'bold', fontSize: 12 }]}>
                              Match
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ))
                  ) : (
                    <View style={{ backgroundColor: '#212623', padding: 12, borderRadius: 10 }}>
                      <Text style={[ui.small, { textAlign: 'center', color: '#6E7571' }]}>
                        No unassigned payments found to match for this cycle.
                      </Text>
                    </View>
                  )}
                </View>
              </ScrollView>

              {/* Record New Payment Action */}
              <View style={{ marginTop: 12, gap: 10 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Record new payment"
                  disabled={payNowBusy || remainingAmount <= 0}
                  onPress={() => void handleRecordNewPayment()}
                  style={[
                    ui.button,
                    {
                      backgroundColor: remainingAmount <= 0 ? '#353A37' : '#81DFD2',
                      paddingVertical: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                    (payNowBusy || remainingAmount <= 0) && { opacity: 0.6 },
                  ]}
                >
                  <Text style={[ui.buttonText, { color: remainingAmount <= 0 ? '#AAB3AD' : '#1F201F', fontWeight: 'bold', fontSize: 15 }]}>
                    {remainingAmount <= 0
                      ? 'Fully Satisfied (0 remaining)'
                      : `Record New Payment (${formatCurrency(remainingAmount, currencySymbol)})`}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel payment sheet"
                  disabled={payNowBusy}
                  onPress={() => setPayNowTarget(null)}
                  style={[ui.button, { alignItems: 'center', paddingVertical: 10 }]}
                >
                  <Text style={ui.buttonText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </>
    ) : (
        <>
          <Card>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.heading}>Extra payment</Text>
              <View style={ui.badge}>
                <Text style={ui.badgeText}>ACCELERATOR</Text>
              </View>
            </View>
            <Text style={ui.small}>Monthly amount added to minimum payments</Text>
            <View style={[ui.row, { gap: 8, marginTop: 8 }]}>
              <TextInput
                accessibilityLabel="Extra monthly payment"
                style={[ui.input, { flex: 1 }]}
                keyboardType="decimal-pad"
                value={extra}
                onChangeText={t => {
                  setExtra(prev => acceptMoneyEdit(prev, t, currencyCode));
                  setStrategyError('');
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save extra payment"
                disabled={extraBusy}
                style={[ui.button, extraBusy && { opacity: 0.65 }]}
                onPress={() => {
                  const check = validateExtraPaymentInput(extra, currencyCode);
                  if (!check.valid) {
                    setStrategyError(check.error);
                    return;
                  }
                  void handleSaveExtra(check.extraMonthlyPayment);
                }}
              >
                <Text style={ui.buttonText}>{extraBusy ? 'Saving…' : 'Save'}</Text>
              </Pressable>
            </View>
            {!!strategyError ? <Text style={[ui.small, { color: '#FF7A59', marginTop: 4 }]}>{strategyError}</Text> : null}
          </Card>

          <Card>
            <Text style={ui.heading}>Payoff strategy</Text>
            <View style={[ui.row, { gap: 8, marginTop: 8 }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: data.strategy === 'snowball' }}
                accessibilityLabel="Debt Snowball — Pay smallest balance first"
                disabled={strategyBusy}
                style={[ui.segment, { flex: 1, paddingVertical: 10 }, data.strategy === 'snowball' && ui.selected, strategyBusy && { opacity: 0.65 }]}
                onPress={() => void handleSelectStrategy('snowball')}
              >
                <Text style={[ui.buttonText, { textAlign: 'center', color: data.strategy === 'snowball' ? '#81DFD2' : '#AAB3AD' }]}>
                  Debt Snowball
                </Text>
                <Text style={[ui.small, { textAlign: 'center', fontSize: 11 }]}>Smallest balance first</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: data.strategy === 'avalanche' }}
                accessibilityLabel="Debt Avalanche — Pay highest interest rate first"
                disabled={strategyBusy}
                style={[ui.segment, { flex: 1, paddingVertical: 10 }, data.strategy === 'avalanche' && ui.selected, strategyBusy && { opacity: 0.65 }]}
                onPress={() => void handleSelectStrategy('avalanche')}
              >
                <Text style={[ui.buttonText, { textAlign: 'center', color: data.strategy === 'avalanche' ? '#81DFD2' : '#AAB3AD' }]}>
                  Debt Avalanche
                </Text>
                <Text style={[ui.small, { textAlign: 'center', fontSize: 11 }]}>Highest APR first</Text>
              </Pressable>
            </View>

            <View style={{ marginTop: 12 }}>
              <Text style={ui.small}>Projected payoff date:</Text>
              <Text style={ui.heading}>{plan.debtFreeDateLabel}</Text>
              <Text style={ui.small}>{`${plan.monthsToPayoff ?? '—'} months projected`}</Text>
            </View>
          </Card>

          <Card>
            <Text style={ui.heading}>Payoff priority</Text>
            <Text style={[ui.small, { marginTop: 2, marginBottom: 8, color: '#AAB3AD' }]}>
              Projected schedule under assumed constant payments. Mathematical forecasts do not reflect historical recorded transactions.
            </Text>
            {plan.payoffOrder.length ? plan.payoffOrder.map((account, index) => {
              const expanded = expandedAccountId === account.id;
              return (
                <View key={account.id} style={ui.divider}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={`${index + 1}. ${account.name}, ${account.projectedPayoffLabel}`}
                    onPress={() => setExpandedAccountId(expanded ? null : account.id)}
                    style={[ui.row, { justifyContent: 'space-between', gap: 10 }]}
                  >
                    <View style={[ui.row, { flex: 1, gap: 10 }]}>
                      <View style={[ui.iconCircle, { width: 30, height: 30 }]}>
                        <Text style={ui.buttonText}>{index + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={ui.heading}>{account.name}</Text>
                        <Text style={ui.small}>{`${account.apr}% APR · ${formatCurrency(account.balance, currencySymbol)} balance`}</Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={ui.value}>{account.projectedPayoffLabel}</Text>
                      <Text style={ui.small}>{expanded ? 'Hide schedule' : 'View schedule'}</Text>
                    </View>
                  </Pressable>
                  {expanded ? (
                    <ScrollView style={{ maxHeight: 280, marginTop: 10 }} nestedScrollEnabled>
                      <View style={[ui.row, { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#353A37' }]}>
                        {['Month', 'Payment', 'Interest', 'Balance'].map(label => (
                          <Text key={label} style={[ui.small, { flex: 1, fontWeight: '700' }]}>{label}</Text>
                        ))}
                      </View>
                      {account.monthlySchedule.map((row, rowIndex) => (
                        <View key={`${account.id}-${rowIndex}`} style={[ui.row, { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#353A37' }]}>
                          <Text style={[ui.text, { flex: 1 }]}>{row.month}</Text>
                          <Text style={[ui.text, { flex: 1 }]}>{formatCurrency(row.payment, currencySymbol)}</Text>
                          <Text style={[ui.text, { flex: 1 }]}>{formatCurrency(row.interest, currencySymbol)}</Text>
                          <Text style={[ui.text, { flex: 1 }]}>{formatCurrency(row.balance, currencySymbol)}</Text>
                        </View>
                      ))}
                      {account.monthlySchedule.length === 0 ? <Text style={ui.small}>Projection unavailable.</Text> : null}
                    </ScrollView>
                  ) : null}
                </View>
              );
            }) : <Text style={ui.small}>Add a debt balance to see your payoff order.</Text>}
          </Card>
        </>
      )}
    </FinancialScreen>
  );
}
