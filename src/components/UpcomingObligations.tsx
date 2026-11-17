import { AmountText } from './AmountText';
import { useState } from 'react';
import * as Crypto from 'expo-crypto';
import { Pressable, Text, View, appearanceColor, useNativeAppearance } from './NativeAppearance';
import { ConfirmModal } from './ConfirmModal';
import { Card, ui } from './FinancialScreen';
import { HeroGradient } from './HeroGradient';
import { AppIcon } from './AppIcon';
import { SheetFormHeader, SheetModal } from './SheetModal';
import { formatCurrency, type DebtItem } from '../onboarding-domain';
import { currentHouseholdDate, getNextMonthString, type DateOnly } from '../finance/calendar';
import { getCurrency } from '../finance/currencies';
import { addMoney, makeMoney, moneyFromMajor, moneyToMajor, type Money } from '../finance/money';
import { type LedgerTransaction } from '../finance/ledger';
import { type RecurringBill } from '../finance/recurring-bills';
import { type ObligationSchedules } from '../finance/obligation-schedule';
import { AnnualFeeSchedule, getAnnualFeeRows } from './AnnualFeeSchedule';
import {
  calculateOverdueObligations, findUnassignedPaymentsForObligation,
  getObligationPaymentState, getScheduledObligationRows,
  type OverdueObligationItem, type PaymentObligation, type ScheduledObligationRow,
} from '../finance/payment-matching';

const normalizeDisplayName = (text: string) =>
  text.replace(/\b([A-Z]{4,})\b/g, w => w[0] + w.slice(1).toLowerCase());

type PayNowTarget = {
  type: 'bill' | 'debt'; name: string; dueDate: DateOnly; requiredAmount: number;
  accountId?: string; bill?: RecurringBill; debt?: DebtItem;
};

/** Single Upcoming view, migrated from Budget. Financial rules remain in shared selectors. */
export function UpcomingObligations({
  debts, recurringBills, transactions, obligationSchedules, loanBillPairs = {}, excludedBillIds = [], historicalBillIdsByDebtId = {},
  householdTimeZone, currencyCode, currencySymbol,
  onRecordBillPayment, onAddTransaction, onUpdateTransaction, onUpdateTransactions, onConfirmAnnualFee,
  readOnly = false,
}: {
  debts: DebtItem[]; recurringBills: RecurringBill[]; transactions: LedgerTransaction[];
  obligationSchedules?: ObligationSchedules; loanBillPairs?: Readonly<Record<string, string>>; excludedBillIds?: readonly string[];
  historicalBillIdsByDebtId?: Readonly<Record<string, readonly string[]>>;
  householdTimeZone?: string; currencyCode: string; currencySymbol: string;
  onRecordBillPayment?: (bill: RecurringBill, dueDate: DateOnly, amount?: Money) => unknown;
  onAddTransaction?: (tx: LedgerTransaction) => unknown;
  onUpdateTransaction?: (tx: LedgerTransaction) => unknown;
  onUpdateTransactions?: (txs: LedgerTransaction[]) => unknown;
  onConfirmAnnualFee?: (debtId: string, renewalDate: DateOnly) => Promise<{ outcome: 'confirmed' | 'pending' } | void> | { outcome: 'confirmed' | 'pending' } | void;
  readOnly?: boolean;
}) {
  const { isLight, palette, ctaBg, ctaFg } = useNativeAppearance();
  const [payNowTarget, setPayNowTarget] = useState<PayNowTarget | null>(null);
  const [payNowBusy, setPayNowBusy] = useState(false);
  const [payNowError, setPayNowError] = useState('');
  const [confirmMarkPriorPaid, setConfirmMarkPriorPaid] = useState(false);
  const effectiveTimeZone = householdTimeZone;
  const todayStr = currentHouseholdDate(effectiveTimeZone);
  const currentMonthStr = todayStr.slice(0, 7);
  const nextMonth = getNextMonthString(currentMonthStr);
  const params = { debts, recurringBills, transactions, asOfDate: todayStr,
    currencyCode, schedules: obligationSchedules, loanBillPairs, excludedBillIds, historicalBillIdsByDebtId };
  const rows = getScheduledObligationRows(params).filter(row =>
    row.dueCycleMonth <= nextMonth && row.state.status !== 'paid');
  const hasAnnualFeeInWindow = getAnnualFeeRows(debts, transactions).some(row => row.dueDate.slice(0, 7) <= nextMonth);
  const actionable = rows.filter(row => row.state.status !== 'pending_confirmation');
  const toPay = actionable.reduce((sum, row) => addMoney(sum, row.state.confirmedMatch.remainingAmount), makeMoney(currencyCode, 0));
  const overdueCount = actionable.filter(row => row.dueDate < todayStr).length;
  const groups = new Map<string, Map<string, ScheduledObligationRow[]>>();
  for (const row of rows) {
    const month = row.dueDate.slice(0, 7);
    if (!groups.has(month)) groups.set(month, new Map());
    const dates = groups.get(month)!;
    dates.set(row.dueDate, [...(dates.get(row.dueDate) ?? []), row]);
  }
  const overdueObligations = calculateOverdueObligations(params);
  const pastDueBills = overdueObligations.filter((item): item is OverdueObligationItem & { bill: RecurringBill } =>
    item.kind === 'bill' && Boolean(item.bill) && item.dueCycleMonth < currentMonthStr);
  const pastDueDebts = overdueObligations.filter((item): item is OverdueObligationItem & { debt: DebtItem } =>
    item.kind === 'debt' && Boolean(item.debt) && item.dueCycleMonth < currentMonthStr);
  const priorCount = pastDueBills.length + pastDueDebts.length;
  const hasPendingPastDueConfirmation = [...pastDueBills, ...pastDueDebts]
    .some(item => item.settlementStatus === 'pending_confirmation');

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
        linkedDebtId: Object.entries(loanBillPairs).find(([, id]) => id === payNowTarget.bill?.id)?.[0],
        bill: payNowTarget.bill,
        debt: payNowTarget.debt,
        historicalBillIds: payNowTarget.debt ? historicalBillIdsByDebtId[payNowTarget.debt.id] : undefined,
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
    if (readOnly || !payNowTarget || payNowBusy || !onUpdateTransaction || pendingThisCycle > 0 || remainingAmount <= 0) return;
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
    if (readOnly || !payNowTarget || payNowBusy) return;
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
      if (payNowTarget.type === 'bill' ? !onRecordBillPayment && !onAddTransaction : !onAddTransaction) {
        setPayNowError('Payment recording is unavailable.'); return;
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
          payee: 'Payment',
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

  const handleMarkAllPastDuePaid = async () => {
    if (readOnly || payNowBusy || hasPendingPastDueConfirmation || (!onUpdateTransactions && !onAddTransaction)) return;
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
          payee: 'Payment',
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

  const openPayment = (row: ScheduledObligationRow) => {
    if (readOnly) return;
    setPayNowError('');
    setPayNowTarget({ type: row.kind, name: row.name, dueDate: row.dueDate,
      requiredAmount: moneyToMajor(row.requiredAmount), accountId: row.debt?.id ?? row.bill?.creditAccountId,
      bill: row.bill ? { ...row.bill, amount: row.requiredAmount } : undefined, debt: row.debt });
  };
  const canRecord = !readOnly && (payNowTarget?.type === 'bill'
    ? Boolean(onRecordBillPayment || onAddTransaction) : Boolean(onAddTransaction));
  const canSettle = !readOnly && Boolean(onUpdateTransactions || onAddTransaction);
  const recordDisabled = readOnly || payNowBusy || !canRecord || remainingAmount <= 0 || pendingThisCycle > 0;

  const sortedMonths = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  let firstActionableRowId: string | null = null;
  for (const [, dates] of sortedMonths) {
    for (const [, items] of [...dates.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      for (const row of items) {
        if (row.state.status !== 'pending_confirmation') {
          firstActionableRowId = row.id;
          break;
        }
      }
      if (firstActionableRowId) break;
    }
    if (firstActionableRowId) break;
  }

  return <>
    <View style={[ui.row, { padding: 16, borderRadius: 17, backgroundColor: palette.hero, overflow: 'hidden', justifyContent: 'space-between', alignItems: 'center' }]}>
      <HeroGradient borderRadius={17} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[ui.small, { color: 'rgba(255,255,255,0.82)' }]}>TO PAY</Text>
        <AmountText style={[ui.title, { fontSize: 32, color: '#FFFFFF' }]} value={formatCurrency(moneyToMajor(toPay), currencySymbol)} />
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: isLight ? '#FFF9E6' : 'rgba(245, 197, 99, 0.15)', borderWidth: 1, borderColor: isLight ? '#F7DE9C' : 'rgba(245, 197, 99, 0.3)' }}>
          <Text style={{ color: appearanceColor('#F5C563', isLight), fontSize: 12, fontWeight: '700' }}>{`${actionable.length} unpaid`}</Text>
        </View>
        <Text style={[ui.small, { fontSize: 12, color: 'rgba(255,255,255,0.82)' }]}>{overdueCount ? `${overdueCount} overdue` : 'Current + next month'}</Text>
      </View>
    </View>
    {!!payNowError && !payNowTarget ? <Text accessibilityRole="alert" style={[ui.small, { color: '#F08B78' }]}>{payNowError}</Text> : null}
    {priorCount > 0 ? <View style={[ui.row, { justifyContent: 'space-between', flexWrap: 'wrap', paddingHorizontal: 16 }]}>
      <Text style={[ui.small, { color: '#F08B78' }]}>{`${priorCount} overdue from prior months`}</Text>
      {!readOnly ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Mark prior overdue obligations paid"
          disabled={payNowBusy || !canSettle || hasPendingPastDueConfirmation}
          onPress={() => setConfirmMarkPriorPaid(true)} style={ui.button}>
          <Text style={[ui.buttonText, { color: palette.brand }]}>{payNowBusy ? 'Saving…' : hasPendingPastDueConfirmation ? 'Pending confirmation' : 'Mark paid'}</Text>
        </Pressable>
      ) : null}
    </View> : null}
    {!rows.length && !hasAnnualFeeInWindow ? <View style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}><AppIcon name="check" size={30} color="#76DCB9" /><Text style={ui.heading}>All caught up</Text><Text style={ui.small}>No unpaid items in the attention window.</Text></View> : null}
    {sortedMonths.map(([month, dates]) => {
      const monthItems = [...dates.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([date, items]) => items.map(row => ({ date, row })));
      const count = monthItems.length;
      return <View key={month} style={{ gap: 8 }}>
        <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 }]}>
          <Text accessibilityRole="header" style={ui.heading}>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T12:00:00`))}</Text>
          <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: isLight ? '#E5F8F8' : 'rgba(39, 238, 233, 0.14)', borderWidth: 1, borderColor: isLight ? '#A5E5E7' : 'rgba(39, 238, 233, 0.35)' }}>
            <Text style={{ color: isLight ? '#087F85' : '#27EEE9', fontSize: 12, fontWeight: '700' }}>{`${count} ${count === 1 ? 'item' : 'items'}`}</Text>
          </View>
        </View>
        <Card style={{ padding: 0, gap: 0, borderRadius: 16, overflow: 'hidden' }}>
          {monthItems.map(({ date, row }, index) => {
            const pending = row.state.status === 'pending_confirmation';
            const partial = row.state.confirmedMatch.isPartiallyPaid;
            const paidAmountFormatted = formatCurrency(moneyToMajor(row.state.confirmedMatch.totalPaid), currencySymbol);
            const isOverdue = date < todayStr;
            const isPrimaryPay = !pending && row.id === firstActionableRowId;
            const displayName = normalizeDisplayName(row.name);
            const kindLabel = row.kind === 'debt' ? 'Minimum payment' : row.bill?.paymentMethod === 'credit' ? 'Credit Card' : 'Debit Card';
            const statusText = pending
              ? 'Awaiting confirmation'
              : isOverdue
              ? (partial ? `Overdue · Partial - ${paidAmountFormatted}` : 'Overdue')
              : partial
              ? `Partial - ${paidAmountFormatted}`
              : 'Unpaid';
            const subtitle = `${kindLabel} · ${statusText}`;
            const subtitleColor = pending
              ? appearanceColor('#A78BFA', isLight)
              : isOverdue
              ? appearanceColor('#F08B78', isLight)
              : partial
              ? appearanceColor('#F5C563', isLight)
              : palette.muted;
            return <View
              key={row.id}
              style={[
                { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, gap: 12 },
                index > 0 && { borderTopWidth: 1, borderTopColor: palette.border },
              ]}
            >
              <View accessibilityLabel={date} style={{ width: 34, alignItems: 'center' }}>
                <Text style={[ui.title, { fontSize: 20, lineHeight: 24, color: isOverdue ? appearanceColor('#F08B78', isLight) : palette.text }]}>{Number(date.slice(8))}</Text>
                <Text style={[ui.small, { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' }]}>{new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(`${date}T12:00:00`))}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text style={[ui.heading, { fontSize: 16 }]}>{displayName}</Text>
                <Text style={[ui.small, { color: subtitleColor, fontWeight: pending || isOverdue || partial ? '600' : '400' }]}>{subtitle}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                <AmountText style={[ui.value, { fontSize: 16, textAlign: 'right' }]} value={formatCurrency(moneyToMajor(row.state.confirmedMatch.remainingAmount), currencySymbol)} />
                {!readOnly ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Payment details for ${displayName} due ${date}`}
                    disabled={payNowBusy}
                    onPress={() => openPayment(row)}
                    hitSlop={4}
                    style={[
                      ui.button,
                      isPrimaryPay
                        ? { backgroundColor: ctaBg, borderColor: ctaBg, borderWidth: 1, minHeight: 36, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 999 }
                        : { backgroundColor: palette.tint, borderColor: palette.brand, borderWidth: 1, minHeight: 36, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 999 },
                    ]}
                  >
                    <Text style={[ui.buttonText, { color: isPrimaryPay ? ctaFg : palette.brand, fontWeight: '700', fontSize: 13 }]}>
                      {pending ? 'Details' : 'Pay'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>;
          })}
        </Card>
      </View>;
    })}
    <AnnualFeeSchedule debts={debts} transactions={transactions} mode="upcoming" currencySymbol={currencySymbol} currentDate={todayStr} onConfirmAnnualFee={onConfirmAnnualFee} readOnly={readOnly} />
    <ConfirmModal
      visible={confirmMarkPriorPaid}
      title="Mark prior months paid?"
      message="Record the remaining overdue amounts as payments made today."
      confirmLabel="Mark paid"
      destructive={false}
      icon="check"
      busy={payNowBusy}
      onConfirm={() => {
        setConfirmMarkPriorPaid(false);
        void handleMarkAllPastDuePaid();
      }}
      onCancel={() => setConfirmMarkPriorPaid(false)}
    />
    <SheetModal visible={!readOnly && payNowTarget !== null} onClose={() => { if (!payNowBusy) setPayNowTarget(null); }}>
      <Card style={{ padding: 0, borderWidth: 0, shadowOpacity: 0, elevation: 0 }}>
        <SheetFormHeader title={`Payment for ${normalizeDisplayName(payNowTarget?.name ?? '')}`} closeLabel="Close payment details"
          onClose={() => { if (!payNowBusy) setPayNowTarget(null); }} />
        <Text style={ui.small}>{`Due ${payNowTarget?.dueDate ?? ''}`}</Text>
        {!!payNowError && <Text accessibilityRole="alert" style={[ui.small, { color: '#F08B78' }]}>{payNowError}</Text>}
        <View style={{ backgroundColor: palette.hero, borderRadius: 16, padding: 16, gap: 12, overflow: 'hidden' }}>
          <HeroGradient borderRadius={16} />
          <Text style={[ui.small, { color: 'rgba(255,255,255,0.82)' }]}>REMAINING THIS CYCLE</Text>
          <AmountText style={[ui.title, { fontSize: 32, color: '#FFFFFF' }]} value={formatCurrency(remainingAmount, currencySymbol)} />
        </View>
        <View style={[ui.row, { justifyContent: 'space-between', marginVertical: 12 }]}>
          <View><Text style={ui.small}>Required</Text><Text style={ui.heading}>{formatCurrency(requiredAmount, currencySymbol)}</Text></View>
          <View><Text style={ui.small}>Paid</Text><Text style={ui.heading}>{formatCurrency(paidThisCycle, currencySymbol)}</Text></View>
          <View><Text style={ui.small}>Remaining</Text><Text style={ui.value}>{formatCurrency(remainingAmount, currencySymbol)}</Text></View>
        </View>
        {pendingThisCycle > 0 ? <Text style={[ui.small, { color: '#F5C563' }]}>{`${formatCurrency(pendingThisCycle, currencySymbol)} awaiting confirmation`}</Text> : null}
        {!readOnly ? (
          <>
            <Text style={ui.heading}>Match a recorded payment</Text>
            {candidatePayments.length ? candidatePayments.map(tx => <View key={tx.id} style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}>
              <View style={{ flex: 1 }}><Text style={ui.text}>{tx.payee}</Text><Text style={ui.small}>{`${tx.date} · ${formatCurrency(moneyToMajor(tx.amount), currencySymbol)}`}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Match payment from ${tx.payee}`}
                disabled={payNowBusy || !onUpdateTransaction || pendingThisCycle > 0 || remainingAmount <= 0}
                onPress={() => void handleMatchPayment(tx)} style={ui.button}><Text style={[ui.buttonText, { color: palette.brand }]}>Match</Text></Pressable>
            </View>) : <Text style={ui.small}>No unassigned payments.</Text>}
            <Pressable accessibilityRole="button" accessibilityLabel="Record new payment" disabled={recordDisabled}
              onPress={() => void handleRecordNewPayment()} style={[ui.button, { marginTop: 14, alignItems: 'center', backgroundColor: ctaBg, borderColor: ctaBg }, recordDisabled && { opacity: 0.5 }]}>
              <Text style={[ui.buttonText, { color: ctaFg }]}>{payNowBusy ? 'Saving…' : remainingAmount <= 0 ? 'Paid' : 'Record payment'}</Text>
            </Pressable>
          </>
        ) : null}
      </Card>
    </SheetModal>
  </>;
}
