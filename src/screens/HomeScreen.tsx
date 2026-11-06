import React, { useState, useRef, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
import {
  acceptAprEdit,
  acceptMoneyEdit,
  activeDebts,
  calculatePayoffPlan,
  formatCurrency,
  formatEditableMoney,
  type DebtCategory,
  type DebtItem,
  type FlowStage,
  type PayoffPlanResult,
  type PayoffStrategy,
  type UserOnboardingData,
} from '../onboarding-domain';
import {
  saveUserOnboardingData,
  deleteUserDebt,
  upsertUserDebt,
} from '../onboarding-storage';
import { type LedgerTransaction, type ReconciliationAnchor, classifyCategoryDirection } from '../finance/ledger';
import { type RecurringBill } from '../finance/recurring-bills';
import { moneyToMajor } from '../finance/money';
import { type DateOnly } from '../finance/calendar';
import { resolveRecurringBillDate } from '../finance/recurring-bills';

const DEBT_CATEGORY_DROPDOWN_OPTIONS: readonly DropdownOption<DebtCategory>[] = [
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
  onAddTransaction: (tx: LedgerTransaction) => void | Promise<void>;
  onUpdateTransaction?: (tx: LedgerTransaction) => void | Promise<void>;
  onDeleteTransaction?: (txId: string) => void | Promise<void>;
  onRecordBillPayment: (bill: RecurringBill, dueCycle: DateOnly) => Promise<void>;
  onReconcileDebt: (
    item: DebtItem,
    verifiedBalance: number,
    reason: 'interest_adjustment' | 'balance_adjustment' | 'credit_adjustment',
  ) => void | Promise<void>;
  onAddRecurringBill: (bill: RecurringBill) => void | Promise<void>;
  authBusy?: boolean;
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
  authBusy = false,
}: HomeScreenProps) {
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState('');
  const savingRef = useRef(false);

  // Add/Edit Debt form state
  const [editingDebtId, setEditingDebtId] = useState<string | null>(null);
  const draftDebtIdRef = useRef<string | null>(null);
  const [showDebtForm, setShowDebtForm] = useState(false);
  const [debtCategory, setDebtCategory] = useState<DebtCategory>('Credit card');
  const [debtName, setDebtName] = useState('');
  const [debtBalance, setDebtBalance] = useState('');
  const [debtOriginalBalance, setDebtOriginalBalance] = useState('');
  const [debtApr, setDebtApr] = useState('');
  const [debtMinimum, setDebtMinimum] = useState('');
  const [debtDueDay, setDebtDueDay] = useState('');
  const [debtCreditLimit, setDebtCreditLimit] = useState('');

  const plan: PayoffPlanResult = calculatePayoffPlan(
    onboardingData.debts,
    onboardingData.strategy,
    onboardingData.extraMonthlyPayment,
    new Date(),
    currencyCode,
  );

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const windowEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14);
  const windowEndKey = `${windowEnd.getFullYear()}-${String(windowEnd.getMonth() + 1).padStart(2, '0')}-${String(windowEnd.getDate()).padStart(2, '0')}`;
  const billDueInWindow = (dueDay: number) => [0, 1].map(offset => {
    const date = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    return resolveRecurringBillDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, dueDay);
  }).find(date => date >= todayKey && date <= windowEndKey) ?? null;
  const upcomingItems = [
    ...recurringBills.filter(bill => bill.active).flatMap(bill => {
      const dueDate = billDueInWindow(bill.dueDay);
      if (!dueDate || transactions.some(tx => tx.id === `bill:${bill.id}:${dueDate}` && tx.deletedAt === null)) return [];
      return [{ id: bill.id, name: bill.name, dueDate, amount: moneyToMajor(bill.amount) }];
    }),
    ...activeDebts(onboardingData.debts).filter(debt => debt.balance > 0 && debt.minimumPayment > 0 && debt.dueDay !== null).flatMap(debt => {
      const dueDate = billDueInWindow(debt.dueDay!);
      if (!dueDate || transactions.some(tx => tx.accountId === debt.id && tx.category === 'payment' && tx.deletedAt === null &&
        ((tx.appliesToDate && tx.appliesToDate === dueDate) || (!tx.appliesToDate && tx.date.slice(0, 7) === dueDate.slice(0, 7) && tx.date <= dueDate)))) return [];
      return [{ id: `minimum:${debt.id}`, name: `${debt.name} minimum`, dueDate, amount: debt.minimumPayment }];
    }),
  ].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3);

  const clearErrors = () => setLocalError('');

  const editSetup = () => {
    clearErrors();
    onChangeStage('onboard_1');
  };

  const openNewDebtEditor = (category: DebtCategory = 'Credit card') => {
    clearErrors();
    draftDebtIdRef.current = null;
    setEditingDebtId(null);
    setDebtCategory(category);
    setDebtName('');
    setDebtBalance('');
    setDebtOriginalBalance('');
    setDebtApr('');
    setDebtMinimum('');
    setDebtDueDay('');
    setDebtCreditLimit('');
    setShowDebtForm(true);
  };

  const openEditDebtEditor = (item: DebtItem) => {
    clearErrors();
    draftDebtIdRef.current = null;
    setEditingDebtId(item.id);
    setDebtCategory(item.category);
    setDebtName(item.name);
    setDebtBalance(formatEditableMoney(item.balance, currencyCode));
    setDebtOriginalBalance(item.originalBalance !== null ? formatEditableMoney(item.originalBalance, currencyCode) : '');
    setDebtApr(String(item.apr));
    setDebtMinimum(formatEditableMoney(item.minimumPayment, currencyCode));
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

    const dueDayNum = debtDueDay.trim() ? parseInt(debtDueDay.trim(), 10) : null;
    if (dueDayNum !== null && (dueDayNum < 1 || dueDayNum > 31)) {
      setLocalError('Due day must be between 1 and 31.');
      return;
    }

    const origNum = debtOriginalBalance.trim() ? parseFloat(debtOriginalBalance.trim()) : null;
    const limitNum = debtCreditLimit.trim() ? parseFloat(debtCreditLimit.trim()) : null;

    savingRef.current = true;
    setSaving(true);

    try {
      const updated = await upsertUserDebt(onboardingData, {
        id: existingDebt?.id,
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
      setShowDebtForm(false);
      setEditingDebtId(null);
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
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to delete debt account.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleToggleHomeStrategy = async (nextStrategy: PayoffStrategy) => {
    if (savingRef.current || onboardingData.strategy === nextStrategy) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await saveUserOnboardingData({
        ...onboardingData,
        strategy: nextStrategy,
      });
      onUpdateOnboardingData(updated);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to update your strategy.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveExtra = async (amount: number) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setLocalError('');
    try {
      const updated = await saveUserOnboardingData({ ...onboardingData, extraMonthlyPayment: amount });
      onUpdateOnboardingData(updated);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to update extra payment.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const debtEditor: ReactNode = showDebtForm ? (
    <View style={styles.inlineEditorCard}>
      <Text style={styles.inlineEditorTitle}>
        {editingDebtId ? 'Edit debt account' : `Add ${debtCategory}`}
      </Text>
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
        style={styles.textInputField}
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
            style={styles.textInputField}
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
            style={styles.textInputField}
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
            style={styles.textInputField}
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
            style={styles.textInputField}
            keyboardType="number-pad"
            value={debtDueDay}
            onChangeText={setDebtDueDay}
            placeholder="15"
            placeholderTextColor="#6E7571"
          />
        </View>
      </View>
      <View style={styles.choiceGrid2}>
        <View style={styles.flex1}>
          <Text style={styles.fieldLabelSmall}>Original balance (optional)</Text>
          <TextInput
            accessibilityLabel="Original balance"
            style={styles.textInputField}
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
            style={styles.textInputField}
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
      key={session?.user.id ?? onboardingData.userId}
      debt={(targetDebtId: string | null) => (
        <DebtScreen
          debts={onboardingData.debts}
          initialSelectedId={targetDebtId}
          plan={plan}
          currencySymbol={currencySymbol}
          transactions={transactions}
          reconciliationAnchors={reconciliationAnchors}
          editor={debtEditor}
          error={localError}
          onAdd={() => openNewDebtEditor('Credit card')}
          onEdit={openEditDebtEditor}
          onRemove={item => { void handleDeleteDebt(item.id); }}
          onReconcile={onReconcileDebt}
          onSettings={editSetup}
        />
      )}
      transactions={
        <TransactionsScreen
          debts={onboardingData.debts}
          transactions={transactions}
          recurringBills={recurringBills}
          currencySymbol={currencySymbol}
          currencyCode={currencyCode}
          onRecordBillPayment={onRecordBillPayment}
          onAddTransaction={onAddTransaction}
          onUpdateTransaction={onUpdateTransaction}
          onDeleteTransaction={onDeleteTransaction}
          onSettings={editSetup}
        />
      }
      budget={(section: string) => (
        <BudgetScreen
          key={section}
          initialSection={section}
          data={onboardingData}
          plan={plan}
          currencySymbol={currencySymbol}
          currencyCode={currencyCode}
          transactions={transactions}
          recurringBills={recurringBills}
          onAddRecurringBill={onAddRecurringBill}
          onRecordBillPayment={onRecordBillPayment}
          onAddTransaction={onAddTransaction}
          onUpdateTransaction={onUpdateTransaction}
          onEditIncome={editSetup}
          onSettings={editSetup}
          onStrategy={value => { void handleToggleHomeStrategy(value); }}
          onExtra={value => { void handleSaveExtra(value); }}
          error={localError}
        />
      )}
      progress={(navigate: (tab: any, section?: string) => void) => (
        <ProgressScreen
          debts={onboardingData.debts}
          transactions={transactions}
          currencySymbol={currencySymbol}
          strategy={plan.strategy}
          onSettings={editSetup}
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit setup"
                style={styles.headerActionPill}
                onPress={editSetup}
              >
                <AppIcon name="settings" size={12} color="#81DFD2" />
                <Text style={styles.headerActionPillText}>Edit Setup</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign out"
                disabled={authBusy}
                style={[styles.headerSignOutPill, authBusy && styles.disabledButton]}
                onPress={() => void onSignOut()}
              >
                <Text style={styles.headerSignOutPillText}>Sign Out</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={false}>
            <Text style={ui.title}>{`Hi, ${session?.user.user_metadata?.full_name?.split(' ')[0] || session?.user.email?.split('@')[0] || 'there'}`}</Text>
            <Text style={ui.text}>Your debt-free journey</Text>
            <Card style={styles.estimateCard}>
              <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.heading}>Debt-free estimate</Text>
                <View style={ui.badge}>
                  <Text style={ui.badgeText}>ESTIMATE</Text>
                </View>
              </View>
              <Text style={ui.small}>Projected from your active payoff plan</Text>
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'stretch' }]}>
                <View style={{ flex: 1, justifyContent: 'center' }}>
                  <Text style={[ui.title, styles.estimateDate]}>{plan.debtFreeDateLabel}</Text>
                </View>
                <View style={{ width: 1, backgroundColor: '#353A37' }} />
                <View style={{ alignItems: 'center', justifyContent: 'center', paddingLeft: 12 }}>
                  <Text style={ui.heading}>{plan.monthsToPayoff ?? '—'}</Text>
                  <Text style={ui.small}>months to go</Text>
                </View>
              </View>
              <Bar percent={plan.progressPercent} />
            </Card>
            <SnapshotCard debts={onboardingData.debts} currencySymbol={currencySymbol} />
            <Card>
              <View style={[ui.row, { justifyContent: 'space-between' }]}>
                <Text style={ui.heading}>Payoff strategy</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="See all payoff strategy details"
                  style={[ui.row, { gap: 4 }]}
                  onPress={() => navigate('budget', 'Strategy')}
                >
                  <Text style={ui.buttonText}>See all</Text>
                  <AppIcon name="chevronRight" size={12} color="#81DFD2" />
                </Pressable>
              </View>
              <Text style={ui.text}>
                {onboardingData.strategy === 'avalanche' ? 'Avalanche' : 'Snowball'} · All active debts
              </Text>
              <View style={ui.row}>
                {(['avalanche', 'snowball'] as const).map(strategy => (
                  <Pressable
                    key={strategy}
                    accessibilityRole="button"
                    accessibilityState={{ selected: onboardingData.strategy === strategy }}
                    style={[ui.button, onboardingData.strategy === strategy && ui.selected]}
                    onPress={() => void handleToggleHomeStrategy(strategy)}
                  >
                    <AppIcon name={strategy} size={14} color="#81DFD2" />
                    <Text style={ui.buttonText}>
                      {strategy === 'avalanche' ? 'Avalanche' : 'Snowball'}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => openNewDebtEditor('Credit card')}
                  style={ui.button}
                >
                  <AppIcon name="plus" size={12} color="#81DFD2" />
                  <Text style={ui.buttonText}>Add debt</Text>
                </Pressable>
              </View>
              {!!localError && !showDebtForm && (
                <Text accessibilityRole="alert" style={ui.text}>
                  {localError}
                </Text>
              )}
              {debtEditor}
              {plan.payoffOrder.map((item, idx) => {
                const fullDebt = onboardingData.debts.find(d => d.id === item.id);
                return (
                  <View key={item.id} style={[ui.divider, ui.row]}>
                    <View style={ui.badge}>
                      <Text style={ui.badgeText}>#{idx + 1}</Text>
                    </View>
                    <View style={ui.iconCircle}>
                      <AppIcon
                        name={
                          item.category === 'Mortgage'
                            ? 'homeLoan'
                            : item.category === 'Auto loan'
                              ? 'auto'
                              : 'creditCard'
                        }
                        color="#81DFD2"
                        size={18}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={ui.heading}>{item.name}</Text>
                      <Text style={ui.small}>
                        {`${item.apr}% APR · ${formatCurrency(item.firstMonthPayment, currencyCode)}/mo`}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <View style={ui.badge}>
                        <Text style={ui.badgeText}>{item.projectedPayoffLabel}</Text>
                      </View>
                      {fullDebt ? (
                        <View style={[ui.row, { gap: 10 }]}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Edit ${item.name}`}
                            onPress={() => openEditDebtEditor(fullDebt)}
                          >
                            <Text style={ui.buttonText}>Edit</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${item.name}`}
                            onPress={() => void handleDeleteDebt(item.id)}
                          >
                            <Text style={[ui.buttonText, { color: '#E3A088' }]}>Remove</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}
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
                          <Text style={ui.heading}>{tx.payee}</Text>
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
                  onPress={() => navigate('budget', 'Upcoming')}
                >
                  <Text style={ui.buttonText}>See all</Text>
                  <AppIcon name="chevronRight" size={12} color="#81DFD2" />
                </Pressable>
              </View>
              {upcomingItems.map(item => (
                <View key={item.id} style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}>
                  <View style={{ flex: 1 }}><Text style={ui.heading}>{item.name}</Text><Text style={ui.small}>{`Due ${item.dueDate}`}</Text></View>
                  <Text style={ui.value}>{formatCurrency(item.amount, currencySymbol)}</Text>
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
    color: '#FFFFFF',
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
    backgroundColor: '#2A302D',
    borderWidth: 1,
    borderColor: '#3A443E',
  },
  headerActionPillText: {
    color: '#81DFD2',
    fontSize: 12,
    fontWeight: '600',
  },
  headerSignOutPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#2A302D',
    borderWidth: 1,
    borderColor: '#3A443E',
  },
  headerSignOutPillText: {
    color: '#E3A088',
    fontSize: 12,
    fontWeight: '600',
  },
  homeContent: {
    padding: 18,
    paddingBottom: 40,
    gap: 16,
  },
  inlineEditorCard: {
    backgroundColor: '#252926',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#383D39',
    padding: 14,
    marginTop: 8,
    marginBottom: 4,
  },
  inlineEditorTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  fieldLabelSmall: {
    color: '#AAB3AD',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  textInputField: {
    backgroundColor: '#1E211F',
    borderWidth: 1,
    borderColor: '#383D39',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FFFFFF',
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
