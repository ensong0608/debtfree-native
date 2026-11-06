import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
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
} from '../onboarding-domain';
import { calculateMonthlyCashflow, calculateCategoryBreakdown } from '../finance/budget';
import { makeMoney, moneyToMajor, parseMoney } from '../finance/money';
import { resolveRecurringBillDate, type RecurringBill, type RecurringBillCategory, type RecurringBillPaymentMethod } from '../finance/recurring-bills';
import { parseDateOnly, type DateOnly } from '../finance/calendar';
import type { LedgerTransaction } from '../finance/ledger';

const BILL_CATEGORIES: readonly DropdownOption<RecurringBillCategory>[] = [
  { value: 'utilities', label: 'Utilities', subtitle: 'Water, Electric, Gas, Internet', icon: 'calendar' },
  { value: 'subscription', label: 'Subscription', subtitle: 'Streaming, Software, Gym', icon: 'creditCard' },
  { value: 'housing', label: 'Housing / Rent', subtitle: 'Rent, HOA, Maintenance', icon: 'homeLoan' },
  { value: 'insurance', label: 'Insurance', subtitle: 'Health, Auto, Home insurance', icon: 'calendar' },
  { value: 'other_bill', label: 'Other Bill', subtitle: 'General recurring obligations', icon: 'calendar' },
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
  transactions = [],
  recurringBills = [],
  onEditIncome,
  onStrategy,
  onExtra,
  onSettings,
  onAddRecurringBill,
  onRecordBillPayment,
  onAddTransaction,
  onUpdateTransaction,
  error: saveError,
  initialSection,
}: {
  data: UserOnboardingData;
  plan: PayoffPlanResult;
  currencySymbol: string;
  currencyCode: string;
  transactions?: LedgerTransaction[];
  recurringBills?: RecurringBill[];
  onEditIncome: () => void;
  onStrategy: (strategy: PayoffStrategy) => void;
  onExtra: (amount: number) => void;
  onSettings: () => void;
  onAddRecurringBill?: (bill: RecurringBill) => void;
  onRecordBillPayment?: (bill: RecurringBill, dueCycle: DateOnly) => Promise<void>;
  onAddTransaction?: (tx: LedgerTransaction) => void | Promise<void>;
  onUpdateTransaction?: (tx: LedgerTransaction) => void | Promise<void>;
  error: string;
  initialSection: string;
}) {
  const [tab, setTab] = useState(initialSection);
  const [extra, setExtra] = useState(formatEditableMoney(data.extraMonthlyPayment, currencyCode));
  const [strategyError, setStrategyError] = useState('');
  const [showAddBillModal, setShowAddBillModal] = useState(false);
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);

  // Pay Now Modal State
  const [payNowTarget, setPayNowTarget] = useState<PayNowTarget | null>(null);
  const [payNowBusy, setPayNowBusy] = useState(false);
  const [payNowError, setPayNowError] = useState('');

  // New Recurring Bill Form State
  const [newBillName, setNewBillName] = useState('');
  const [newBillAmount, setNewBillAmount] = useState('');
  const [newBillCategory, setNewBillCategory] = useState<RecurringBillCategory>('utilities');
  const [newBillDueDay, setNewBillDueDay] = useState('15');
  const [newBillPaymentMethod, setNewBillPaymentMethod] = useState<RecurringBillPaymentMethod>('debit');
  const [newBillCreditAccountId, setNewBillCreditAccountId] = useState<string>(
    data.debts.find(d => d.category === 'Credit card')?.id ?? ''
  );
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
  });

  const categoryBreakdown = calculateCategoryBreakdown({
    recurringBills,
    monthlyIncome: income,
    monthlyDebtPlanPayment: plan.monthlyTotalPayment,
    currencyCode,
  });

  const creditCards = data.debts.filter(d => d.category === 'Credit card');

  const currentMonthStr = new Date().toISOString().slice(0, 7);

  const paidThisCycleMinor = payNowTarget
    ? transactions
        .filter(tx => {
          if (tx.deletedAt !== null || tx.category !== 'payment') return false;
          if (tx.appliesToDate === payNowTarget.dueDate) return true;
          if (payNowTarget.accountId && tx.accountId === payNowTarget.accountId) {
            return tx.date.slice(0, 7) === payNowTarget.dueDate.slice(0, 7);
          }
          return false;
        })
        .reduce((sum, tx) => sum + tx.amount.minorUnits, 0)
    : 0;

  const paidThisCycle = moneyToMajor(makeMoney(currencyCode, paidThisCycleMinor));
  const requiredAmount = payNowTarget?.requiredAmount ?? 0;
  const remainingAmount = Math.max(0, requiredAmount - paidThisCycle);

  const candidatePayments = payNowTarget
    ? transactions.filter(tx => {
        if (tx.deletedAt !== null) return false;
        if (tx.category !== 'payment') return false;
        if (tx.appliesToDate === payNowTarget.dueDate) return false;
        if (payNowTarget.type === 'bill') {
          return !tx.appliesToDate || (payNowTarget.accountId && tx.accountId === payNowTarget.accountId);
        } else {
          return (
            tx.accountId === payNowTarget.accountId ||
            (!tx.appliesToDate && (!tx.accountId || tx.payee.toLowerCase().includes(payNowTarget.name.toLowerCase())))
          );
        }
      })
    : [];

  const handleMatchPayment = async (tx: LedgerTransaction) => {
    if (!payNowTarget || payNowBusy) return;
    setPayNowBusy(true);
    setPayNowError('');
    try {
      const updatedTx: LedgerTransaction = {
        ...tx,
        appliesToDate: payNowTarget.dueDate,
        accountId: tx.accountId ?? payNowTarget.accountId ?? null,
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
      if (payNowTarget.type === 'bill' && payNowTarget.bill) {
        if (onRecordBillPayment) {
          await onRecordBillPayment(payNowTarget.bill, payNowTarget.dueDate);
        }
      } else if (payNowTarget.type === 'debt' && payNowTarget.debt) {
        const payAmount = remainingAmount > 0 ? remainingAmount : payNowTarget.requiredAmount;
        const todayStr = new Date().toISOString().slice(0, 10);
        const newTx: LedgerTransaction = {
          id: `tx:${Crypto.randomUUID()}`,
          accountId: payNowTarget.debt.id,
          date: parseDateOnly(todayStr),
          appliesToDate: payNowTarget.dueDate,
          amount: makeMoney(currencyCode, Math.round(payAmount * 100)),
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

  const handleSaveBill = () => {
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

    const dayNum = parseInt(newBillDueDay, 10);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
      setAddBillError('Due day must be between 1 and 31.');
      return;
    }

    if (newBillPaymentMethod === 'credit' && !newBillCreditAccountId) {
      setAddBillError('Please select which credit card this bill will be charged to.');
      return;
    }

    const newBill: RecurringBill = {
      id: `rb-${Date.now()}`,
      name: nameTrimmed,
      category: newBillCategory,
      amount: makeMoney(currencyCode, parsedAmt),
      dueDay: dayNum,
      paymentMethod: newBillPaymentMethod,
      creditAccountId: newBillPaymentMethod === 'credit' ? newBillCreditAccountId : undefined,
      autoPost: true,
      active: true,
      createdAt: new Date().toISOString(),
    };

    onAddRecurringBill?.(newBill);
    setNewBillName('');
    setNewBillAmount('');
    setShowAddBillModal(false);
  };

  return (
    <FinancialScreen
      title={tab === 'Strategy' ? 'Payoff strategy' : tab === 'Upcoming' ? 'Upcoming' : 'Budget'}
      segments={['Budget', 'Upcoming', 'Strategy']}
      selected={tab}
      onSelect={setTab}
      onSettings={onSettings}
      onAdd={tab === 'Budget' || tab === 'Upcoming' ? () => setShowAddBillModal(prev => !prev) : undefined}
      addLabel="Add recurring bill"
    >
      {!!saveError && (
        <Text accessibilityRole="alert" style={ui.text}>
          {saveError}
        </Text>
      )}

      {/* Add Recurring Bill Modal */}
      {showAddBillModal ? (
        <Card>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <Text style={ui.heading}>Add recurring bill</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel add bill"
              onPress={() => setShowAddBillModal(false)}
            >
              <Text style={ui.buttonText}>Cancel</Text>
            </Pressable>
          </View>

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

          {/* Category Selector */}
          <SelectDropdown
            label="Category"
            sheetTitle="Select Bill Category"
            value={newBillCategory}
            options={BILL_CATEGORIES}
            onSelect={setNewBillCategory}
          />

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
                Auto-Debit ($0 debt)
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

          {!!addBillError ? (
            <Text style={[ui.small, { color: '#FF7A59', marginTop: 6 }]}>{addBillError}</Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save recurring bill"
            onPress={handleSaveBill}
            style={[ui.button, { marginTop: 12, backgroundColor: '#81DFD2', paddingVertical: 10, alignItems: 'center' }]}
          >
            <Text style={[ui.buttonText, { color: '#1F201F', fontWeight: 'bold' }]}>Save Recurring Bill</Text>
          </Pressable>
        </Card>
      ) : null}

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
                onPress={onEditIncome}
              >
                <Text style={ui.buttonText}>Edit</Text>
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
              Committed expenses and debt strategy payments. Credit card bills charge cards directly and are repaid through your debt plan without double-deducting from checking cashflow.
            </Text>
          </Card>

          {/* Income Sources */}
          <Card>
            <Text style={ui.heading}>Income sources</Text>
            {incomes.map(i => (
              <View key={i.id} style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}>
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
              </View>
            ))}
          </Card>

          {/* Category Budget Breakdown */}
          <Card>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.heading}>Monthly Budget Breakdown</Text>
              <View style={ui.badge}>
                <Text style={ui.badgeText}>{`${categoryBreakdown.length} CATEGORIES`}</Text>
              </View>
            </View>

            {categoryBreakdown.map(item => {
              const isDebt = item.categoryKey === 'debt';
              const icon: AppIconName =
                isDebt
                  ? 'debt'
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
                  <View style={[ui.row, { justifyContent: 'space-between' }]}>
                    <View style={[ui.row, { gap: 8, flex: 1 }]}>
                      <View style={ui.iconCircle}>
                        <AppIcon name={icon} size={18} color={isDebt ? '#81DFD2' : '#AAB3AD'} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={ui.heading}>{item.label}</Text>
                        <Text style={ui.small}>
                          {isDebt
                            ? 'Projected active payoff commitment'
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
                  </View>
                  {item.percentOfIncome > 0 ? <Bar percent={item.percentOfIncome} /> : null}
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
            Bills are automatically logged to transactions when due. Credit card bills increase card debt, while debit bills are cashflow-only ($0 debt).
          </Text>

          {recurringBills.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              <Text style={[ui.small, { color: '#81DFD2', fontWeight: 'bold', marginBottom: 4 }]}>
                RECURRING HOUSEHOLD BILLS ({recurringBills.length})
              </Text>
              {recurringBills.map(b => {
                const targetDebt = data.debts.find(d => d.id === b.creditAccountId);
                const isCredit = b.paymentMethod === 'credit';
                const dueDate = resolveRecurringBillDate(currentMonthStr, b.dueDay);
                return (
                  <View key={b.id} style={[ui.divider, ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
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
                          {`Due day ${b.dueDay} · ${isCredit ? targetDebt?.name || 'Credit card' : 'Checking'}`}
                        </Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <Text style={[ui.value, { color: isCredit ? '#E3A088' : '#81DFD2' }]}>
                        {formatCurrency(moneyToMajor(b.amount), currencySymbol)}
                      </Text>
                      <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                        <View style={[ui.badge, { backgroundColor: isCredit ? '#2D2825' : '#1E2C28' }]}>
                          <Text style={[ui.badgeText, { color: isCredit ? '#E3A088' : '#81DFD2', fontSize: 10 }]}>
                            {isCredit ? 'Credit Card' : 'Auto-Debit'}
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Pay now for ${b.name}`}
                          onPress={() => {
                            setPayNowError('');
                            setPayNowTarget({
                              type: 'bill',
                              name: b.name,
                              dueDate,
                              requiredAmount: moneyToMajor(b.amount),
                              accountId: b.creditAccountId,
                              bill: b,
                            });
                          }}
                          style={[ui.button, { backgroundColor: '#81DFD2', paddingHorizontal: 10, paddingVertical: 4 }]}
                        >
                          <Text style={[ui.buttonText, { color: '#1F201F', fontWeight: 'bold', fontSize: 12 }]}>
                            Pay Now
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          <View style={{ marginTop: 12 }}>
            <Text style={[ui.small, { color: '#81DFD2', fontWeight: 'bold', marginBottom: 4 }]}>
              DEBT ACCOUNT MINIMUM REMINDERS
            </Text>
            {data.debts.filter(d => d.dueDay && d.balance > 0 && d.minimumPayment > 0).length > 0 ? (
              data.debts
                .filter(d => d.dueDay && d.balance > 0 && d.minimumPayment > 0)
                .map(d => {
                  const dueDate = resolveRecurringBillDate(currentMonthStr, d.dueDay!);
                  return (
                    <View key={d.id} style={[ui.divider, ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
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
                          <Text style={ui.small}>{`Due day ${d.dueDay} · Manual reminder`}</Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        <Text style={ui.value}>
                          {formatCurrency(d.minimumPayment, currencySymbol)}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Pay now for ${d.name}`}
                          onPress={() => {
                            setPayNowError('');
                            setPayNowTarget({
                              type: 'debt',
                              name: d.name,
                              dueDate,
                              requiredAmount: d.minimumPayment,
                              accountId: d.id,
                              debt: d,
                            });
                          }}
                          style={[ui.button, { backgroundColor: '#81DFD2', paddingHorizontal: 10, paddingVertical: 4 }]}
                        >
                          <Text style={[ui.buttonText, { color: '#1F201F', fontWeight: 'bold', fontSize: 12 }]}>
                            Pay Now
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })
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
                  <Text style={{ color: '#AAB3AD', fontSize: 16, fontWeight: 'bold' }}>✕</Text>
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
                    <Text style={ui.small}>Paid this cycle</Text>
                    <Text style={[ui.heading, { color: paidThisCycle > 0 ? '#73D9C6' : '#AAB3AD' }]}>
                      {formatCurrency(paidThisCycle, currencySymbol)}
                    </Text>
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
                          <Text style={ui.heading}>{tx.payee}</Text>
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
                  disabled={payNowBusy}
                  onPress={() => void handleRecordNewPayment()}
                  style={[
                    ui.button,
                    {
                      backgroundColor: '#81DFD2',
                      paddingVertical: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                    payNowBusy && { opacity: 0.6 },
                  ]}
                >
                  <Text style={[ui.buttonText, { color: '#1F201F', fontWeight: 'bold', fontSize: 15 }]}>
                    {`Record New Payment (${formatCurrency(remainingAmount > 0 ? remainingAmount : requiredAmount, currencySymbol)})`}
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
                style={ui.button}
                onPress={() => {
                  const check = validateExtraPaymentInput(extra, currencyCode);
                  if (!check.valid) {
                    setStrategyError(check.error);
                    return;
                  }
                  onExtra(check.extraMonthlyPayment);
                }}
              >
                <Text style={ui.buttonText}>Save</Text>
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
                style={[ui.segment, { flex: 1, paddingVertical: 10 }, data.strategy === 'snowball' && ui.selected]}
                onPress={() => onStrategy('snowball')}
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
                style={[ui.segment, { flex: 1, paddingVertical: 10 }, data.strategy === 'avalanche' && ui.selected]}
                onPress={() => onStrategy('avalanche')}
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
