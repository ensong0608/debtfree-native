import { useState } from 'react';
import * as Crypto from 'expo-crypto';
import { AmountText } from './AmountText';
import { HeroGradient } from './HeroGradient';
import { Card, ui } from './FinancialScreen';
import { Pressable, Text, TextInput, View, useNativeAppearance } from './NativeAppearance';
import { SheetFormHeader, SheetModal } from './SheetModal';
import { currentHouseholdDate, type DateOnly } from '../finance/calendar';
import { type LedgerTransaction } from '../finance/ledger';
import { moneyFromMajor, moneyToMajor, type Money } from '../finance/money';
import {
  findUnassignedPaymentsForObligation,
  getObligationPaymentState,
  type PaymentObligation,
} from '../finance/payment-matching';
import { creditRecurringBillCategory, type RecurringBill } from '../finance/recurring-bills';
import { acceptMoneyEdit, formatCurrency, formatEditableMoney, parseMoneyInput, type DebtItem } from '../onboarding-domain';

const normalizeDisplayName = (text: string) =>
  text.replace(/\b([A-Z]{4,})\b/g, w => w[0] + w.slice(1).toLowerCase());

export type PayNowTarget = {
  type: 'bill' | 'debt';
  name: string;
  dueDate: DateOnly;
  requiredAmount: number;
  overridePayAmount?: number;
  installmentLabel?: string;
  accountId?: string;
  bill?: RecurringBill;
  debt?: DebtItem;
};

export function ObligationPaySheet({
  target,
  onClose,
  transactions,
  loanBillPairs = {},
  historicalBillIdsByDebtId = {},
  householdTimeZone,
  currencyCode,
  currencySymbol,
  onRecordBillPayment,
  onAddTransaction,
  onUpdateTransaction,
  readOnly = false,
}: {
  target: PayNowTarget | null;
  onClose: () => void;
  transactions: LedgerTransaction[];
  loanBillPairs?: Readonly<Record<string, string>>;
  historicalBillIdsByDebtId?: Readonly<Record<string, readonly string[]>>;
  householdTimeZone?: string;
  currencyCode: string;
  currencySymbol: string;
  onRecordBillPayment?: (bill: RecurringBill, dueDate: DateOnly, amount?: Money) => unknown;
  onAddTransaction?: (tx: LedgerTransaction) => unknown;
  onUpdateTransaction?: (tx: LedgerTransaction) => unknown;
  readOnly?: boolean;
}) {
  const { palette, ctaBg, ctaFg } = useNativeAppearance();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [amountDraft, setAmountDraft] = useState<{ key: string; text: string } | null>(null);

  const payNowObligation: PaymentObligation | null = target
    ? {
        id: target.type === 'bill' ? (target.bill?.id ?? 'bill') : `minimum:${target.debt?.id}`,
        kind: target.type,
        name: target.name,
        dueDate: target.dueDate,
        dueCycleMonth: target.dueDate.slice(0, 7),
        requiredAmount: moneyFromMajor(target.requiredAmount, currencyCode),
        accountId: target.accountId,
        billId: target.bill?.id,
        linkedDebtId: Object.entries(loanBillPairs).find(([, id]) => id === target.bill?.id)?.[0],
        bill: target.bill,
        debt: target.debt,
        historicalBillIds: target.debt ? historicalBillIdsByDebtId[target.debt.id] : undefined,
      }
    : null;

  const paymentState = payNowObligation
    ? getObligationPaymentState(payNowObligation, transactions, currencyCode)
    : null;
  const matchResult = paymentState?.confirmedMatch ?? null;

  const paidThisCycle = matchResult ? moneyToMajor(matchResult.totalPaid) : 0;
  const pendingThisCycle = paymentState ? moneyToMajor(paymentState.pendingAmount) : 0;
  const requiredAmount = target?.requiredAmount ?? 0;
  const remainingAmount = matchResult ? moneyToMajor(matchResult.remainingAmount) : requiredAmount;
  const defaultPayAmount = target?.overridePayAmount != null && target.overridePayAmount > 0
    ? Math.min(remainingAmount, target.overridePayAmount)
    : remainingAmount;
  const payTargetKey = target
    ? `${target.type}:${target.bill?.id ?? target.debt?.id ?? target.name}:${target.dueDate}:${remainingAmount}`
    : '';
  const amountText = amountDraft && amountDraft.key === payTargetKey
    ? amountDraft.text
    : defaultPayAmount > 0
      ? formatEditableMoney(defaultPayAmount, currencyCode)
      : '';
  const parsedPayAmount = parseMoneyInput(amountText, currencyCode);

  const candidatePayments = payNowObligation
    ? findUnassignedPaymentsForObligation(payNowObligation, transactions)
    : [];

  const handleClose = () => {
    if (busy) return;
    setError('');
    setAmountDraft(null);
    onClose();
  };

  const handleMatchPayment = async (tx: LedgerTransaction) => {
    if (readOnly || !target || busy || !onUpdateTransaction || pendingThisCycle > 0 || remainingAmount <= 0) return;
    setBusy(true);
    setError('');
    try {
      const isBill = target.type === 'bill' && target.bill;
      const explicitMemo = isBill
        ? (tx.memo
            ? (tx.memo.includes(`bill:${target.bill!.id}`) ? tx.memo : `${tx.memo} [bill:${target.bill!.id}]`)
            : `[bill:${target.bill!.id}]`)
        : tx.memo;

      const updatedTx: LedgerTransaction = {
        ...tx,
        appliesToDate: target.dueDate,
        accountId: tx.accountId ?? target.accountId ?? null,
        memo: explicitMemo,
      };
      await onUpdateTransaction(updatedTx);
      setAmountDraft(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to match payment');
    } finally {
      setBusy(false);
    }
  };

  const handleRecordNewPayment = async () => {
    if (readOnly || !target || busy) return;
    setError('');
    if (remainingAmount <= 0 || matchResult?.isSatisfied) {
      setError('Obligation is already satisfied for this cycle.');
      return;
    }
    if (pendingThisCycle > 0) {
      setError('A payment for this due cycle is awaiting confirmation. Reload after it syncs before adding another.');
      return;
    }
    if (parsedPayAmount === null || parsedPayAmount <= 0) {
      setError('Please enter a valid payment amount greater than zero.');
      return;
    }
    if (target.type === 'bill' ? !onRecordBillPayment && !onAddTransaction : !onAddTransaction) {
      setError('Payment recording is unavailable.');
      return;
    }
    setBusy(true);
    try {
      const payAmount = parsedPayAmount;
      const todayStr = currentHouseholdDate(householdTimeZone);

      if (target.type === 'bill' && target.bill) {
        const bill = target.bill;
        const paymentAmount = moneyFromMajor(payAmount, currencyCode);
        if (onRecordBillPayment) {
          await onRecordBillPayment(target.bill, target.dueDate, paymentAmount);
        } else if (onAddTransaction) {
          const isCredit = bill.paymentMethod === 'credit';
          const hasExistingCycleTx = transactions.some(tx => tx.deletedAt === null && tx.id.startsWith(`bill:${bill.id}:${target.dueDate}`));
          const newTx: LedgerTransaction = {
            id: hasExistingCycleTx ? `bill:${bill.id}:${target.dueDate}:${Crypto.randomUUID()}` : `bill:${bill.id}:${target.dueDate}`,
            accountId: isCredit ? bill.creditAccountId! : null,
            date: todayStr,
            appliesToDate: target.dueDate,
            amount: paymentAmount,
            category: isCredit ? creditRecurringBillCategory(bill.category) : 'debit_bill',
            payee: bill.name,
            memo: `Payment for ${target.dueDate} [bill:${bill.id}]`,
            source: 'recurring_bill',
            reconciled: false,
            createdAt: new Date().toISOString(),
            deletedAt: null,
          };
          await onAddTransaction(newTx);
        }
      } else if (target.type === 'debt' && target.debt) {
        const newTx: LedgerTransaction = {
          id: `tx:${Crypto.randomUUID()}`,
          accountId: target.debt.id,
          date: todayStr,
          appliesToDate: target.dueDate,
          amount: moneyFromMajor(payAmount, currencyCode),
          category: 'payment',
          payee: 'Payment',
          memo: `Payment for ${target.dueDate}`,
          source: 'manual',
          reconciled: false,
          createdAt: new Date().toISOString(),
          deletedAt: null,
        };
        if (onAddTransaction) {
          await onAddTransaction(newTx);
        }
      }
      setAmountDraft(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setBusy(false);
    }
  };

  const canRecord = !readOnly && (target?.type === 'bill'
    ? Boolean(onRecordBillPayment || onAddTransaction)
    : Boolean(onAddTransaction));
  const recordDisabled = readOnly || busy || !canRecord || remainingAmount <= 0 || pendingThisCycle > 0 || parsedPayAmount === null || parsedPayAmount <= 0;

  return (
    <SheetModal visible={!readOnly && target !== null} onClose={handleClose}>
      <Card style={{ padding: 0, borderWidth: 0, shadowOpacity: 0, elevation: 0 }}>
        <SheetFormHeader
          title={`Payment for ${normalizeDisplayName(target?.name ?? '')}`}
          closeLabel="Close payment details"
          onClose={handleClose}
        />
        <Text style={ui.small}>
          {target?.installmentLabel ? `Due ${target?.dueDate ?? ''} · ${target.installmentLabel}` : `Due ${target?.dueDate ?? ''}`}
        </Text>
        {!!error && <Text accessibilityRole="alert" style={[ui.small, { color: '#F08B78' }]}>{error}</Text>}
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
            {candidatePayments.length ? candidatePayments.map(tx => (
              <View key={tx.id} style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={ui.text}>{tx.payee}</Text>
                  <Text style={ui.small}>{`${tx.date} · ${formatCurrency(moneyToMajor(tx.amount), currencySymbol)}`}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Match payment from ${tx.payee}`}
                  disabled={busy || !onUpdateTransaction || pendingThisCycle > 0 || remainingAmount <= 0}
                  onPress={() => void handleMatchPayment(tx)}
                  style={ui.button}
                >
                  <Text style={[ui.buttonText, { color: palette.brand }]}>Match</Text>
                </Pressable>
              </View>
            )) : <Text style={ui.small}>No unassigned payments.</Text>}
            {remainingAmount > 0 && pendingThisCycle <= 0 ? (
              <View style={{ marginTop: 14, gap: 6 }}>
                <Text style={ui.small}>Payment amount</Text>
                <View style={ui.inputWrap}>
                  <Text style={[ui.text, { color: palette.brand, fontWeight: '700' }]}>{currencySymbol}</Text>
                  <TextInput
                    accessibilityLabel="Payment amount"
                    keyboardType="decimal-pad"
                    editable={!busy}
                    value={amountText}
                    onChangeText={val => {
                      if (error) setError('');
                      setAmountDraft(prev => ({
                        key: payTargetKey,
                        text: acceptMoneyEdit(
                          prev && prev.key === payTargetKey ? prev.text : amountText,
                          val,
                          currencyCode,
                        ),
                      }));
                    }}
                    placeholder={formatEditableMoney(0, currencyCode)}
                    placeholderTextColor={palette.muted}
                    style={ui.input}
                  />
                </View>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Record new payment"
              disabled={recordDisabled}
              onPress={() => void handleRecordNewPayment()}
              style={[ui.button, { marginTop: 14, alignItems: 'center', backgroundColor: ctaBg, borderColor: ctaBg }, recordDisabled && { opacity: 0.5 }]}
            >
              <Text style={[ui.buttonText, { color: ctaFg }]}>
                {busy
                  ? 'Saving…'
                  : remainingAmount <= 0
                    ? 'Paid'
                    : parsedPayAmount !== null && parsedPayAmount > 0 && parsedPayAmount < remainingAmount
                      ? `Record ${formatCurrency(parsedPayAmount, currencySymbol)} partial payment`
                      : parsedPayAmount !== null && parsedPayAmount > 0
                        ? `Record ${formatCurrency(parsedPayAmount, currencySymbol)} payment`
                        : 'Record payment'}
              </Text>
            </Pressable>
          </>
        ) : null}
      </Card>
    </SheetModal>
  );
}
