import { useState } from 'react';
import * as Crypto from 'expo-crypto';
import { Modal, Pressable, ScrollView, Text, TextInput, TouchableWithoutFeedback, View } from 'react-native';
import { AppIcon } from '../components/AppIcon';
import { Card, FinancialScreen, ui } from '../components/FinancialScreen';
import { SelectDropdown, type DropdownOption } from '../components/SelectDropdown';
import { formatCurrency, acceptMoneyEdit, type DebtItem } from '../onboarding-domain';
import {
  classifyCategoryDirection,
  type LedgerTransaction,
  type TransactionCategory,
} from '../finance/ledger';
import { makeMoney, moneyFromMajor, moneyToMajor, parseMoney, addMoney } from '../finance/money';
import { parseDateOnly, type DateOnly } from '../finance/calendar';
import { resolveRecurringBillDate, type RecurringBill } from '../finance/recurring-bills';

const CATEGORY_CHOICES: { label: string; category: TransactionCategory; isDebt: boolean }[] = [
  { label: 'Payment', category: 'payment', isDebt: true },
  { label: 'Purchase', category: 'purchase', isDebt: true },
  { label: 'Subscription', category: 'subscription', isDebt: true },
  { label: 'Utilities', category: 'utilities', isDebt: true },
  { label: 'Interest', category: 'interest', isDebt: true },
  { label: 'Fee / Annual Fee', category: 'fee', isDebt: true },
  { label: 'Refund', category: 'refund', isDebt: true },
  { label: 'Debit Bill (Checking)', category: 'debit_bill', isDebt: false },
  { label: 'Debit Spending (Checking)', category: 'debit_spending', isDebt: false },
];

function localDateInputValue(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function TransactionsScreen({
  debts,
  transactions = [],
  currencySymbol = '$',
  currencyCode = 'USD',
  onSettings,
  onAddTransaction,
  onUpdateTransaction,
  onDeleteTransaction,
  recurringBills = [],
  onRecordBillPayment,
}: {
  debts: DebtItem[];
  transactions?: LedgerTransaction[];
  currencySymbol?: string;
  currencyCode?: string;
  onSettings: () => void;
  onAddTransaction?: (tx: LedgerTransaction) => void | Promise<void>;
  onUpdateTransaction?: (tx: LedgerTransaction) => void | Promise<void>;
  onDeleteTransaction?: (txId: string) => void | Promise<void>;
  recurringBills?: RecurringBill[];
  onRecordBillPayment?: (bill: RecurringBill, dueCycle: DateOnly) => Promise<void>;
}) {
  const [tab, setTab] = useState('History');
  const [accountIdx, setAccountIdx] = useState(0); // 0 = All accounts, 1 = Debit/Checking, 2..N = debt accounts
  const [periodIdx, setPeriodIdx] = useState(0); // 0 = Current month, 1 = Previous month, 2 = All time
  const [typeIdx, setTypeIdx] = useState(0); // 0 = All Types, 1 = Payments, 2 = Charges/Fees, 3 = Debit Only
  const [sortAsc, setSortAsc] = useState(false); // false = newest first, true = oldest first
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // Add Transaction Form State
  const [newPayee, setNewPayee] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCategoryIdx, setNewCategoryIdx] = useState(0);
  const [newAccountId, setNewAccountId] = useState(debts[0]?.id ?? '');
  const [newDate, setNewDate] = useState(() => localDateInputValue());
  const [newAppliesToDate, setNewAppliesToDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerMonth, setDatePickerMonth] = useState(() => localDateInputValue().slice(0, 7));
  const [formError, setFormError] = useState('');
  const [billError, setBillError] = useState('');
  const [pendingBillCycle, setPendingBillCycle] = useState<string | null>(null);

  // Edit Transaction Form State
  const [editingTx, setEditingTx] = useState<LedgerTransaction | null>(null);
  const [editPayee, setEditPayee] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCategoryIdx, setEditCategoryIdx] = useState(0);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editMemo, setEditMemo] = useState('');
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingTx, setDeletingTx] = useState(false);

  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthStr = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const accountOptions = [
    { label: 'All accounts', id: 'all' },
    { label: 'Checking / Debit ($0 debt)', id: 'debit' },
    ...debts.map(d => ({ label: d.name, id: d.id })),
  ];

  const periodDropdownOptions: readonly DropdownOption<number>[] = [
    { value: 0, label: 'Current month', icon: 'calendar', subtitle: 'View transactions for this month' },
    { value: 1, label: 'Previous month', icon: 'calendar', subtitle: 'View transactions from last month' },
    { value: 2, label: 'All time', icon: 'calendar', subtitle: 'Lifetime transaction history' },
  ];

  const accountFilterDropdownOptions: readonly DropdownOption<number>[] = accountOptions.map((opt, idx) => ({
    value: idx,
    label: opt.label,
    icon: idx === 1 ? 'calendar' : (idx > 1 ? 'creditCard' : undefined),
  }));

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
  const dueCycleOptions: readonly DropdownOption<string>[] = [
    { value: '', label: 'No due cycle', subtitle: 'Leave this payment unassigned to a due date' },
    ...(selectedDebt
      ? [0, 1, 2].map(monthOffset => {
          const monthDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
          const month = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
          const cycleDay = selectedDebt.dueDay ?? Number(newDate.slice(-2));
          const date = resolveRecurringBillDate(month, cycleDay);
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
    const selectedAcc = accountOptions[accountIdx];
    if (selectedAcc.id === 'debit' && tx.accountId !== null) return false;
    if (selectedAcc.id !== 'all' && selectedAcc.id !== 'debit' && tx.accountId !== selectedAcc.id) return false;

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

  // Sort transactions by date
  const sorted = [...filtered].sort((a, b) => {
    if (sortAsc) return a.date.localeCompare(b.date);
    return b.date.localeCompare(a.date);
  });

  // Calculate summary metrics for the filtered period
  let totalPaymentsMinor = 0;
  let totalInterestFeesMinor = 0;
  let totalAdjustmentsMinor = 0;
  let netBalanceChangeMinor = 0;

  for (const tx of filtered) {
    const dir = classifyCategoryDirection(tx.category);
    if (tx.category === 'payment' || tx.category === 'refund') {
      totalPaymentsMinor += tx.amount.minorUnits;
    }
    if (['interest', 'fee', 'annual_fee'].includes(tx.category)) {
      totalInterestFeesMinor += tx.amount.minorUnits;
    }
    if (['interest_adjustment', 'balance_adjustment', 'credit_adjustment'].includes(tx.category)) {
      totalAdjustmentsMinor += tx.amount.minorUnits;
    }
    if (dir === 'increase_debt') {
      netBalanceChangeMinor += tx.amount.minorUnits;
    } else if (dir === 'decrease_debt') {
      netBalanceChangeMinor -= tx.amount.minorUnits;
    }
  }

  const handleSaveTransaction = async () => {
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

    try {
      const actualDate = parseDateOnly(newDate.trim());
      const appliesToDate = newAppliesToDate.trim() ? parseDateOnly(newAppliesToDate.trim()) : null;
      const moneyAmount = parseMoney(newAmount, currencyCode);

      const tx: LedgerTransaction = {
        id: `tx:${Crypto.randomUUID()}`,
        accountId,
        date: actualDate,
        appliesToDate,
        amount: moneyAmount,
        category: catOption.category,
        payee: newPayee.trim() || (catOption.category === 'payment' ? `Payment to ${selectedDebt?.name ?? 'debt account'}` : catOption.label),
        memo: `Manual entry (${catOption.label})`,
        source: 'manual',
        reconciled: false,
        createdAt: new Date().toISOString(),
        deletedAt: null,
      };

      if (onAddTransaction) {
        await onAddTransaction(tx);
      }
      setShowAddForm(false);
      setNewPayee('');
      setNewAmount('');
      setNewAppliesToDate('');
    } catch (e) {
      setFormError((e as Error).message || 'Unable to save transaction');
    }
  };

  const handleOpenEdit = (tx: LedgerTransaction) => {
    setEditingTx(tx);
    setEditPayee(tx.payee);
    setEditAmount(moneyToMajor(tx.amount).toFixed(2));
    const catIdx = CATEGORY_CHOICES.findIndex(c => c.category === tx.category);
    setEditCategoryIdx(catIdx >= 0 ? catIdx : 0);
    setEditAccountId(tx.accountId);
    setEditDate(tx.date);
    setEditMemo(tx.memo || '');
    setEditError('');
  };

  const handleSaveEdit = async () => {
    if (!editingTx) return;
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

      const updatedTx: LedgerTransaction = {
        ...editingTx,
        accountId: catOption.isDebt ? editAccountId : null,
        date: actualDate,
        amount: moneyAmount,
        category: catOption.category,
        payee: editPayee.trim() || catOption.label,
        memo: editMemo.trim() || undefined,
      };

      if (onUpdateTransaction) {
        await onUpdateTransaction(updatedTx);
      }
      setEditingTx(null);
    } catch (e) {
      setEditError((e as Error).message || 'Unable to save transaction');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteTx = async () => {
    if (!editingTx) return;
    setDeletingTx(true);
    try {
      if (onDeleteTransaction) {
        await onDeleteTransaction(editingTx.id);
      } else if (onUpdateTransaction) {
        await onUpdateTransaction({
          ...editingTx,
          deletedAt: new Date().toISOString(),
        });
      }
      setEditingTx(null);
    } catch (e) {
      setEditError((e as Error).message || 'Unable to delete transaction');
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
      const origDir = classifyCategoryDirection(editingTx.category);
      if (origDir === 'increase_debt') {
        previewMoney = addMoney(previewMoney, makeMoney(currencyCode, -editingTx.amount.minorUnits));
      } else if (origDir === 'decrease_debt') {
        previewMoney = addMoney(previewMoney, editingTx.amount);
      }
    }

    // 2. Apply newly configured amount and category
    const parsedAmt = parseFloat(editAmount);
    if (!Number.isNaN(parsedAmt) && parsedAmt > 0 && editCatOption.isDebt) {
      try {
        const newAmtMoney = parseMoney(editAmount, currencyCode);
        const newDir = classifyCategoryDirection(editCatOption.category);
        if (newDir === 'increase_debt') {
          previewMoney = addMoney(previewMoney, newAmtMoney);
        } else if (newDir === 'decrease_debt') {
          previewMoney = addMoney(previewMoney, makeMoney(currencyCode, -newAmtMoney.minorUnits));
        }
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
        setTab(nextTab);
        if (nextTab === 'Scheduled') setShowAddForm(false);
      }}
      onSettings={onSettings}
      onAdd={tab === 'History' && !showAddForm ? () => setShowAddForm(true) : undefined}
      addLabel="Add transaction"
    >
      {showAddForm ? (
        <Card>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <Text style={ui.heading}>Add Transaction</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss form"
              onPress={() => setShowAddForm(false)}
            >
              <Text style={ui.buttonText}>Cancel</Text>
            </Pressable>
          </View>

          {!!formError && (
            <Text style={[ui.small, { color: '#E3A088' }]}>{formError}</Text>
          )}

          <Text style={ui.small}>Payee or Description (optional)</Text>
          <TextInput
            placeholder={CATEGORY_CHOICES[newCategoryIdx].category === 'payment' ? 'Add a note (optional)' : 'e.g. Electric Company, Target'}
            placeholderTextColor="#AAB3AD"
            value={newPayee}
            onChangeText={setNewPayee}
            style={ui.input}
          />

          <Text style={ui.small}>Transaction date</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Transaction date: ${newDate}`}
            onPress={() => { setDatePickerMonth(newDate.slice(0, 7)); setShowDatePicker(true); }}
            style={[ui.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
          >
            <Text style={ui.text}>{newDate}</Text>
            <AppIcon name="calendar" size={18} color="#81DFD2" />
          </Pressable>
          {CATEGORY_CHOICES[newCategoryIdx].category === 'payment' ? (
            <SelectDropdown
              label="Applies to payment cycle (optional)"
              sheetTitle="Choose Payment Due Cycle"
              value={newAppliesToDate}
              options={dueCycleOptions}
              onSelect={setNewAppliesToDate}
              placeholder="Choose a due cycle"
            />
          ) : null}

          <Modal visible={showDatePicker} transparent animationType="slide" onRequestClose={() => setShowDatePicker(false)}>
            <TouchableWithoutFeedback onPress={() => setShowDatePicker(false)}>
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }}>
                <TouchableWithoutFeedback>
                  <View style={{ backgroundColor: '#191F1C', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: '#313C36', padding: 18, paddingBottom: 30 }}>
                    <View style={[ui.row, { justifyContent: 'space-between', marginBottom: 16 }]}>
                      <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => {
                        const [year, month] = datePickerMonth.split('-').map(Number);
                        const previous = new Date(year, month - 2, 1);
                        setDatePickerMonth(`${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`);
                      }} style={ui.button}><AppIcon name="chevronLeft" size={17} color="#81DFD2" /></Pressable>
                      <Text style={ui.heading}>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(`${datePickerMonth}-01T12:00:00`))}</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => {
                        const [year, month] = datePickerMonth.split('-').map(Number);
                        const next = new Date(year, month, 1);
                        setDatePickerMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
                      }} style={ui.button}><AppIcon name="chevronRight" size={17} color="#81DFD2" /></Pressable>
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
                                style={{ width: '13%', height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? '#81DFD2' : 'transparent' }}>
                                <Text style={[ui.text, selected ? { color: '#1B1E1C', fontWeight: '700' } : null]}>{day}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ));
                    })()}
                    <Pressable accessibilityRole="button" onPress={() => { setNewDate(localDateInputValue()); setShowDatePicker(false); }} style={[ui.button, { alignSelf: 'center', marginTop: 8 }]}>
                      <Text style={ui.buttonText}>Today</Text>
                    </Pressable>
                  </View>
                </TouchableWithoutFeedback>
              </View>
            </TouchableWithoutFeedback>
          </Modal>

          <Text style={ui.small}>Amount</Text>
          <TextInput
            placeholder="0.00"
            placeholderTextColor="#AAB3AD"
            keyboardType="decimal-pad"
            value={newAmount}
            onChangeText={val => setNewAmount(acceptMoneyEdit(newAmount, val, currencyCode))}
            style={ui.input}
          />

          <SelectDropdown
            label="Category"
            sheetTitle="Select Transaction Category"
            value={newCategoryIdx}
            options={categoryDropdownOptions}
            onSelect={setNewCategoryIdx}
          />

          {CATEGORY_CHOICES[newCategoryIdx].isDebt && debts.length > 0 ? (
            <SelectDropdown
              label="Target Debt Account"
              sheetTitle="Select Target Debt Account"
            value={selectedDebtId}
              options={debtAccountDropdownOptions}
            onSelect={id => { setNewAccountId(id); setNewAppliesToDate(''); }}
            />
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={handleSaveTransaction}
            style={[ui.button, { backgroundColor: '#81DFD2', marginTop: 12, justifyContent: 'center' }]}
          >
            <Text style={[ui.buttonText, { color: '#1B1E1C', fontWeight: 'bold' }]}>Save Transaction</Text>
          </Pressable>
        </Card>
      ) : null}

      {tab === 'Scheduled' ? (
        <Card>
          <Text style={ui.heading}>Upcoming recurring bills</Text>
          <Text style={ui.text}>Bills stay unpaid until you confirm them. A confirmation records today as the transaction date and links it to the selected due cycle.</Text>
          {!!billError ? <Text accessibilityRole="alert" style={ui.text}>{billError}</Text> : null}
          {(() => {
            const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`;
            const upcoming = recurringBills.filter(bill => bill.active).flatMap(bill => [thisMonth, nextMonth].map(month => ({ bill, due: resolveRecurringBillDate(month, bill.dueDay) })))
              .filter(item => !transactions.some(tx => tx.deletedAt === null && tx.source === 'recurring_bill' &&
                (tx.id === `bill:${item.bill.id}:${item.due.slice(0, 7)}` || (tx.appliesToDate === item.due && tx.payee === item.bill.name))))
              .sort((a, b) => a.due.localeCompare(b.due));
            if (!upcoming.length) return <Text style={[ui.text, { marginTop: 8 }]}>No unpaid recurring bills are scheduled.</Text>;
            return upcoming.map(({ bill, due }) => (
              <View key={`${bill.id}:${due}`} style={[ui.divider, ui.row, { justifyContent: 'space-between', gap: 8 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={ui.heading}>{bill.name}</Text>
                  <Text style={ui.small}>{`Due ${due} · ${bill.paymentMethod === 'credit' ? 'Charged to credit card' : 'Paid from checking'}`}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={ui.value}>{formatCurrency(moneyToMajor(bill.amount), currencySymbol)}</Text>
                  <Pressable accessibilityRole="button" disabled={!onRecordBillPayment || pendingBillCycle === `${bill.id}:${due}`}
                    onPress={async () => {
                      const key = `${bill.id}:${due}`;
                      setPendingBillCycle(key); setBillError('');
                      try { await onRecordBillPayment?.(bill, due); }
                      catch (error) { setBillError(error instanceof Error ? error.message : 'Unable to record this bill.'); }
                      finally { setPendingBillCycle(null); }
                    }} style={[ui.button, { backgroundColor: '#81DFD2' }]}>
                    <Text style={[ui.buttonText, { color: '#1B1E1C' }]}>{pendingBillCycle === `${bill.id}:${due}` ? 'Saving…' : 'Record paid'}</Text>
                  </Pressable>
                </View>
              </View>
            ));
          })()}
        </Card>
      ) : (
        <>
          <View style={[ui.row, { gap: 8, marginVertical: 4 }]}>
            <View style={{ flex: 1 }}>
              <SelectDropdown
                sheetTitle="Filter by Period"
                value={periodIdx}
                options={periodDropdownOptions}
                onSelect={setPeriodIdx}
              />
            </View>
            <View style={{ flex: 1 }}>
              <SelectDropdown
                sheetTitle="Filter by Account"
                value={accountIdx}
                options={accountFilterDropdownOptions}
                onSelect={setAccountIdx}
              />
            </View>
          </View>

          <View style={ui.row}>
            <View style={[ui.card, { flex: 1, padding: 10, backgroundColor: '#262927', borderRadius: 10 }]}>
              <View style={[ui.row, { gap: 5 }]}>
                <AppIcon name="trendDown" size={13} color="#81DFD2" />
                <Text numberOfLines={1} style={ui.small}>Payments</Text>
              </View>
              <Text style={ui.heading}>{formatCurrency(moneyToMajor(makeMoney(currencyCode, totalPaymentsMinor)), currencySymbol)}</Text>
            </View>
            <View style={[ui.card, { flex: 1, padding: 10, backgroundColor: '#262927', borderRadius: 10 }]}>
              <View style={[ui.row, { gap: 5 }]}>
                <AppIcon name="brandRise" size={13} color="#E3A088" />
                <Text numberOfLines={1} style={ui.small}>Interest & fees</Text>
              </View>
              <Text style={ui.heading}>{formatCurrency(moneyToMajor(makeMoney(currencyCode, totalInterestFeesMinor)), currencySymbol)}</Text>
            </View>
            <View style={[ui.card, { flex: 1, padding: 10, backgroundColor: '#262927', borderRadius: 10 }]}>
              <View style={[ui.row, { gap: 5 }]}>
                <AppIcon name="sort" size={13} color="#AAB3AD" />
                <Text numberOfLines={1} style={ui.small}>Adjustments</Text>
              </View>
              <Text style={ui.heading}>{formatCurrency(moneyToMajor(makeMoney(currencyCode, totalAdjustmentsMinor)), currencySymbol)}</Text>
            </View>
          </View>

          <Card>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <View style={[ui.row, { gap: 6 }]}>
                <Text style={ui.text}>Net balance change</Text>
                <AppIcon name="info" size={15} color="#AAB3AD" />
              </View>
              <Text
                style={[
                  ui.value,
                  { color: netBalanceChangeMinor < 0 ? '#81DFD2' : netBalanceChangeMinor > 0 ? '#E3A088' : '#F9F9F6' },
                ]}
              >
                {netBalanceChangeMinor < 0
                  ? `-${formatCurrency(moneyToMajor(makeMoney(currencyCode, Math.abs(netBalanceChangeMinor))), currencySymbol)}`
                  : netBalanceChangeMinor > 0
                    ? `+${formatCurrency(moneyToMajor(makeMoney(currencyCode, netBalanceChangeMinor)), currencySymbol)}`
                    : formatCurrency(0, currencySymbol)}
              </Text>
            </View>
          </Card>

          <View style={ui.row}>
            <View style={ui.inputWrap}>
              <AppIcon name="search" size={16} color="#AAB3AD" />
              <TextInput
                accessibilityLabel="Search transactions"
                placeholder="Search payee or category"
                placeholderTextColor="#AAB3AD"
                value={search}
                onChangeText={setSearch}
                style={[ui.input, { borderWidth: 0, paddingHorizontal: 0, paddingVertical: 8 }]}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filter by transaction type"
              style={ui.button}
              onPress={() => setTypeIdx((typeIdx + 1) % 4)}
            >
              <Text style={ui.buttonText}>{['All Types', 'Payments', 'Charges', 'Debit Only'][typeIdx]}</Text>
              <AppIcon name="chevronDown" size={12} color="#AAB3AD" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change sort order"
              style={ui.button}
              onPress={() => setSortAsc(!sortAsc)}
            >
              <AppIcon name="sort" size={14} color="#81DFD2" />
              <Text style={ui.buttonText}>{sortAsc ? 'Oldest' : 'Newest'}</Text>
            </Pressable>
          </View>

          {sorted.length === 0 ? (
            <Card>
              <Text style={ui.heading}>No recorded transactions</Text>
              <Text style={ui.text}>
                No transactions match your current search and filters. Tap the + button above to log a payment or purchase.
              </Text>
            </Card>
          ) : (
            sorted.map(tx => {
              const dir = classifyCategoryDirection(tx.category);
              const targetDebt = debts.find(d => d.id === tx.accountId);
              const accountLabel = tx.accountId === null ? 'Checking / Debit' : targetDebt?.name || 'Debt Account';
              const isPayment = dir === 'decrease_debt';
              const isCharge = dir === 'increase_debt';
              const amountFormatted = formatCurrency(moneyToMajor(tx.amount), currencySymbol);

              return (
                <Pressable
                  key={tx.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit transaction ${tx.payee}`}
                  onPress={() => handleOpenEdit(tx)}
                >
                  <Card>
                    <View style={[ui.row, { justifyContent: 'space-between' }]}>
                      <View style={[ui.row, { gap: 10, flex: 1 }]}>
                        <View style={ui.iconCircle}>
                          <AppIcon
                            name={
                              isPayment
                                ? 'trendDown'
                                : tx.category === 'interest' || tx.category === 'fee'
                                  ? 'brandRise'
                                  : tx.accountId === null
                                    ? 'calendar'
                                    : 'creditCard'
                            }
                            size={18}
                            color={isPayment ? '#81DFD2' : isCharge ? '#E3A088' : '#81DFD2'}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={ui.heading}>{tx.payee}</Text>
                          <Text style={ui.small}>
                            {`${tx.date} \u00b7 ${accountLabel} \u00b7 ${tx.category.replace('_', ' ')}`}
                          </Text>
                          {tx.appliesToDate ? <Text style={ui.small}>{`Applies to due cycle ${tx.appliesToDate}`}</Text> : null}
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                          <Text
                            style={[
                              ui.value,
                              { color: isPayment ? '#81DFD2' : isCharge ? '#E3A088' : '#F9F9F6' },
                            ]}
                          >
                            {isPayment ? `-${amountFormatted}` : isCharge ? `+${amountFormatted}` : amountFormatted}
                          </Text>
                          <AppIcon name="chevronRight" size={14} color="#AAB3AD" />
                        </View>
                        {tx.source === 'recurring_bill' ? (
                          <View style={[ui.badge, { backgroundColor: '#1E2C28' }]}>
                            <Text style={[ui.badgeText, { color: '#81DFD2', fontSize: 10 }]}>Auto-Bill</Text>
                          </View>
                        ) : tx.source === 'reconciliation' ? (
                          <View style={[ui.badge, { backgroundColor: '#2D2825' }]}>
                            <Text style={[ui.badgeText, { color: '#E3A088', fontSize: 10 }]}>Reconciled</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    {tx.memo ? (
                      <Text style={[ui.small, { marginTop: 4, fontStyle: 'italic' }]}>{tx.memo}</Text>
                    ) : null}
                  </Card>
                </Pressable>
              );
            })
          )}
        </>
      )}

      {/* Edit Transaction Modal */}
      <Modal visible={editingTx !== null} transparent animationType="slide" onRequestClose={() => setEditingTx(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#191F1C', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: '#313C36', padding: 18, maxHeight: '90%' }}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={[ui.row, { justifyContent: 'space-between', marginBottom: 12 }]}>
                <Text style={ui.title}>Edit Transaction</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close edit form"
                  onPress={() => setEditingTx(null)}
                >
                  <Text style={{ color: '#AAB3AD', fontSize: 18, fontWeight: 'bold' }}>✕</Text>
                </Pressable>
              </View>

              {!!editError && (
                <Text accessibilityRole="alert" style={[ui.small, { color: '#E3A088', marginBottom: 8 }]}>
                  {editError}
                </Text>
              )}

              <Text style={ui.small}>Payee or Description</Text>
              <TextInput
                accessibilityLabel="Payee or description"
                placeholder="e.g. Target, Payment"
                placeholderTextColor="#AAB3AD"
                value={editPayee}
                onChangeText={setEditPayee}
                style={ui.input}
              />

              <Text style={[ui.small, { marginTop: 8 }]}>Amount</Text>
              <TextInput
                accessibilityLabel="Transaction amount"
                placeholder="0.00"
                placeholderTextColor="#AAB3AD"
                keyboardType="decimal-pad"
                value={editAmount}
                onChangeText={val => setEditAmount(acceptMoneyEdit(editAmount, val, currencyCode))}
                style={ui.input}
              />

              <SelectDropdown
                label="Category"
                sheetTitle="Select Transaction Category"
                value={editCategoryIdx}
                options={categoryDropdownOptions}
                onSelect={setEditCategoryIdx}
              />

              {editCatOption.isDebt && debts.length > 0 ? (
                <SelectDropdown
                  label="Target Debt Account"
                  sheetTitle="Select Target Debt Account"
                  value={editAccountId || debts[0]?.id || ''}
                  options={debtAccountDropdownOptions}
                  onSelect={setEditAccountId}
                />
              ) : null}

              <Text style={[ui.small, { marginTop: 8 }]}>Transaction Date (YYYY-MM-DD)</Text>
              <TextInput
                accessibilityLabel="Transaction date"
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#AAB3AD"
                value={editDate}
                onChangeText={setEditDate}
                style={ui.input}
              />

              <Text style={[ui.small, { marginTop: 8 }]}>Note (optional)</Text>
              <TextInput
                accessibilityLabel="Transaction note"
                placeholder="Optional notes or memo"
                placeholderTextColor="#AAB3AD"
                value={editMemo}
                onChangeText={setEditMemo}
                style={ui.input}
              />

              {/* Live Balance Preview */}
              <View style={[ui.card, { backgroundColor: '#262927', padding: 12, marginVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#353A37' }]}>
                <Text style={[ui.small, { color: '#81DFD2', fontWeight: 'bold' }]}>LIVE BALANCE PREVIEW</Text>
                {targetEditDebt ? (
                  <View style={[ui.row, { justifyContent: 'space-between', marginTop: 6 }]}>
                    <Text style={ui.heading}>{targetEditDebt.name}</Text>
                    <Text style={[ui.value, { fontSize: 13 }]}>
                      {formatCurrency(editCurrentBal, currencySymbol)} → <Text style={{ color: editAfterBal <= editCurrentBal ? '#81DFD2' : '#E3A088' }}>{formatCurrency(editAfterBal, currencySymbol)}</Text>
                    </Text>
                  </View>
                ) : (
                  <Text style={[ui.text, { marginTop: 4 }]}>Checking / Cashflow ($0 debt impact)</Text>
                )}
              </View>

              {/* Actions */}
              <View style={{ gap: 10, marginTop: 4, marginBottom: 20 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save Changes"
                  disabled={savingEdit}
                  onPress={() => void handleSaveEdit()}
                  style={[ui.button, { backgroundColor: '#81DFD2', justifyContent: 'center', minHeight: 44 }]}
                >
                  <Text style={[ui.buttonText, { color: '#1B1E1C', fontWeight: 'bold' }]}>
                    {savingEdit ? 'Saving…' : 'Save Changes'}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel edit"
                  onPress={() => setEditingTx(null)}
                  style={[ui.button, { justifyContent: 'center', minHeight: 40 }]}
                >
                  <Text style={ui.buttonText}>Cancel</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete transaction"
                  disabled={deletingTx}
                  onPress={() => void handleDeleteTx()}
                  style={[ui.button, { backgroundColor: '#3D2520', borderColor: '#8B4F42', borderWidth: 1, justifyContent: 'center', minHeight: 44 }]}
                >
                  <Text style={[ui.buttonText, { color: '#FF7A59', fontWeight: 'bold' }]}>
                    {deletingTx ? 'Deleting…' : 'Delete transaction'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </FinancialScreen>
  );
}
