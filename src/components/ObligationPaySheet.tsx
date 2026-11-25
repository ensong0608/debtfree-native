import { useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { AmountText } from './AmountText';
import { HeroGradient } from './HeroGradient';
import { Card, ui } from './FinancialScreen';
import { Pressable, Text, TextInput, View, useNativeAppearance } from './NativeAppearance';
import { SheetFormHeader, SheetModal } from './SheetModal';
import { formatShortDate } from './DatePickerModal';
import { calendarDaysBetween, currentHouseholdDate, type DateOnly } from '../finance/calendar';
import { type LedgerTransaction } from '../finance/ledger';
import { moneyFromMajor, moneyToMajor, type Money } from '../finance/money';
import {
  findUnassignedPaymentsForObligation,
  getObligationPaymentState,
  type PaymentObligation,
} from '../finance/payment-matching';
import { creditRecurringBillCategory, type RecurringBill } from '../finance/recurring-bills';
import {
  acceptMoneyEdit,
  canSuggestLoanPaymentSplit,
  formatCurrency,
  formatEditableMoney,
  parseMoneyInput,
  projectedLoanBalanceAfterPrincipal,
  resolveAutoLoanSplitSuggestion,
  suggestLoanPaymentSplit,
  type DebtItem,
  type LoanInterestMethod,
} from '../onboarding-domain';

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
  debts = [],
  mortgageEscrowByDebtId = {},
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
  debts?: readonly DebtItem[];
  mortgageEscrowByDebtId?: Readonly<Record<string, number>>;
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
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [amountDraft, setAmountDraft] = useState<{ key: string; text: string } | null>(null);
  const [splitDraft, setSplitDraft] = useState<{
    key: string;
    mode: 'auto' | 'manual' | 'cleared';
    principal: string;
    interest: string;
    escrow: string;
  } | null>(null);
  const [autoMethodOverride, setAutoMethodOverride] = useState<{ key: string; method: LoanInterestMethod } | null>(null);
  const todayStr = currentHouseholdDate(householdTimeZone);

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

  const loanDebt = target?.type === 'debt'
    ? (target.debt && (target.debt.category === 'Mortgage' || target.debt.category === 'Auto loan') ? target.debt : undefined)
    : target?.type === 'bill' && payNowObligation?.linkedDebtId
      ? debts.find(d => d.id === payNowObligation.linkedDebtId && (d.category === 'Mortgage' || d.category === 'Auto loan'))
      : undefined;
  const loanEscrow = loanDebt?.category === 'Mortgage' ? mortgageEscrowByDebtId[loanDebt.id] : undefined;
  const canAutoSplit = Boolean(loanDebt && canSuggestLoanPaymentSplit(loanDebt, loanEscrow));

  const activeDraftSplit = splitDraft && splitDraft.key === payTargetKey ? splitDraft : null;
  const splitMode: 'auto' | 'manual' | 'cleared' = activeDraftSplit
    ? activeDraftSplit.mode
    : (canAutoSplit ? 'auto' : 'cleared');
  const autoLinkedBillIds = loanDebt?.category === 'Auto loan'
    ? Array.from(new Set([
        loanBillPairs[loanDebt.id],
        ...(historicalBillIdsByDebtId[loanDebt.id] ?? []),
        target?.bill?.id,
      ].filter((value): value is string => Boolean(value))))
    : [];
  const preferredAutoMethod = autoMethodOverride && autoMethodOverride.key === payTargetKey
    ? autoMethodOverride.method
    : undefined;
  const autoLoanContext = loanDebt?.category === 'Auto loan'
    ? resolveAutoLoanSplitSuggestion({
        debt: loanDebt,
        paymentAmount: parsedPayAmount !== null && parsedPayAmount > 0 ? parsedPayAmount : 0,
        paymentDate: todayStr,
        transactions,
        currencyCode,
        preferredMethod: preferredAutoMethod,
        linkedBillIds: autoLinkedBillIds,
      })
    : null;
  const autoSplitSuggestion = loanDebt && canAutoSplit && parsedPayAmount !== null && parsedPayAmount > 0
    ? (loanDebt.category === 'Auto loan'
      ? autoLoanContext!.suggestion
      : suggestLoanPaymentSplit({
          balance: loanDebt.balance,
          aprPercent: loanDebt.apr,
          paymentAmount: parsedPayAmount,
          escrowAmount: loanEscrow,
          currencyCode,
        }))
    : null;
  const principalText = splitMode === 'auto'
    ? (autoSplitSuggestion ? formatEditableMoney(autoSplitSuggestion.principal, currencyCode) : '')
    : splitMode === 'manual' && activeDraftSplit
      ? activeDraftSplit.principal
      : '';
  const interestText = splitMode === 'auto'
    ? (autoSplitSuggestion ? formatEditableMoney(autoSplitSuggestion.interest, currencyCode) : '')
    : splitMode === 'manual' && activeDraftSplit
      ? activeDraftSplit.interest
      : '';
  const escrowText = loanDebt?.category === 'Mortgage'
    ? (splitMode === 'auto'
      ? (autoSplitSuggestion ? formatEditableMoney(autoSplitSuggestion.escrow, currencyCode) : '')
      : splitMode === 'manual' && activeDraftSplit
        ? activeDraftSplit.escrow
        : '')
    : '';

  const parseSplitField = (text: string): { valid: boolean; major: number; minor: number; money: Money | null } => {
    const trimmed = text.trim();
    if (!trimmed) return { valid: true, major: 0, minor: 0, money: null };
    const parsed = parseMoneyInput(trimmed, currencyCode);
    if (parsed === null || parsed < 0) return { valid: false, major: 0, minor: 0, money: null };
    const m = moneyFromMajor(parsed, currencyCode);
    return { valid: true, major: parsed, minor: m.minorUnits, money: m };
  };

  const isSplitActive = Boolean(loanDebt && splitMode !== 'cleared');
  const principalParsed = isSplitActive ? parseSplitField(principalText) : { valid: true, major: 0, minor: 0, money: null };
  const interestParsed = isSplitActive ? parseSplitField(interestText) : { valid: true, major: 0, minor: 0, money: null };
  const escrowParsed = isSplitActive && loanDebt?.category === 'Mortgage'
    ? parseSplitField(escrowText)
    : { valid: true, major: 0, minor: 0, money: null };
  const paymentMinor = parsedPayAmount !== null && parsedPayAmount > 0
    ? moneyFromMajor(parsedPayAmount, currencyCode).minorUnits
    : 0;
  const splitHasInvalidField = isSplitActive && (!principalParsed.valid || !interestParsed.valid || !escrowParsed.valid);
  const splitExceedsPayment = isSplitActive && paymentMinor > 0
    && (principalParsed.minor + interestParsed.minor + escrowParsed.minor > paymentMinor);

  const handleSplitFieldEdit = (field: 'principal' | 'interest' | 'escrow', rawValue: string) => {
    if (error) setError('');
    setSplitDraft(prev => {
      const base = prev && prev.key === payTargetKey && prev.mode === 'manual'
        ? prev
        : { key: payTargetKey, mode: 'manual' as const, principal: principalText, interest: interestText, escrow: escrowText };
      return {
        key: payTargetKey,
        mode: 'manual',
        principal: field === 'principal' ? acceptMoneyEdit(base.principal, rawValue, currencyCode) : base.principal,
        interest: field === 'interest' ? acceptMoneyEdit(base.interest, rawValue, currencyCode) : base.interest,
        escrow: field === 'escrow' ? acceptMoneyEdit(base.escrow, rawValue, currencyCode) : base.escrow,
      };
    });
  };

  const handleClose = () => {
    if (busy || busyRef.current) return;
    setError('');
    setAmountDraft(null);
    setSplitDraft(null);
    setAutoMethodOverride(null);
    onClose();
  };

  const handleMatchPayment = async (tx: LedgerTransaction) => {
    if (readOnly || !target || busy || busyRef.current || !onUpdateTransaction || pendingThisCycle > 0 || remainingAmount <= 0) return;
    busyRef.current = true;
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
      setSplitDraft(null);
      setAutoMethodOverride(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to match payment');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleRecordNewPayment = async () => {
    if (readOnly || !target || busy || busyRef.current) return;
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
    if (splitHasInvalidField) {
      setError('Please enter valid breakdown amounts.');
      return;
    }
    if (splitExceedsPayment) {
      setError('Principal, interest, and escrow cannot exceed the payment amount.');
      return;
    }
    if (target.type === 'bill' ? !onRecordBillPayment && !onAddTransaction : !onAddTransaction) {
      setError('Payment recording is unavailable.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const payAmount = parsedPayAmount;
      const todayStr = currentHouseholdDate(householdTimeZone);
      const principalAmount = isSplitActive ? principalParsed.money : null;
      const interestAmount = isSplitActive ? interestParsed.money : null;
      const escrowAmount = isSplitActive && loanDebt?.category === 'Mortgage' ? escrowParsed.money : null;

      if (target.type === 'bill' && target.bill) {
        const bill = target.bill;
        const paymentAmount = moneyFromMajor(payAmount, currencyCode);
        if (isSplitActive && loanDebt && onAddTransaction) {
          const newTx: LedgerTransaction = {
            id: `tx:${Crypto.randomUUID()}`,
            accountId: loanDebt.id,
            date: todayStr,
            appliesToDate: target.dueDate,
            amount: paymentAmount,
            category: 'payment',
            payee: bill.name,
            memo: `Payment for ${target.dueDate} [bill:${bill.id}]`,
            source: 'recurring_bill',
            reconciled: false,
            createdAt: new Date().toISOString(),
            deletedAt: null,
            principalAmount,
            interestAmount,
            escrowAmount,
          };
          await onAddTransaction(newTx);
        } else if (onRecordBillPayment) {
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
          ...(isSplitActive ? { principalAmount, interestAmount, escrowAmount } : {}),
        };
        if (onAddTransaction) {
          await onAddTransaction(newTx);
        }
      }
      setAmountDraft(null);
      setSplitDraft(null);
      setAutoMethodOverride(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const canRecord = !readOnly && (target?.type === 'bill'
    ? Boolean(onRecordBillPayment || onAddTransaction)
    : Boolean(onAddTransaction));
  const recordDisabled = readOnly || busy || !canRecord || remainingAmount <= 0 || pendingThisCycle > 0 || parsedPayAmount === null || parsedPayAmount <= 0 || splitHasInvalidField || splitExceedsPayment;

  return (
    <SheetModal visible={!readOnly && target !== null} onClose={handleClose}>
      <Card style={{ padding: 0, borderWidth: 0, shadowOpacity: 0, elevation: 0 }}>
        <SheetFormHeader
          title={`Record payment for ${normalizeDisplayName(target?.name ?? '')}`}
          closeLabel="Close payment details"
          onClose={handleClose}
        />
        <Text style={ui.small}>Records a payment in your BitLess ledger. BitLess does not connect to banks or move money.</Text>
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
                {loanDebt ? (
                  <View
                    style={{
                      marginTop: 8,
                      padding: 12,
                      borderRadius: 12,
                      backgroundColor: palette.raised,
                      borderWidth: 1,
                      borderColor: palette.border,
                      gap: 8,
                    }}
                  >
                    <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 8 }]}>
                      <Text style={[ui.small, { color: palette.text, fontWeight: '700', flex: 1 }]}>Payment breakdown</Text>
                      <View style={[ui.row, { gap: 6 }]}>
                        {splitMode === 'cleared' ? (
                          canAutoSplit ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Use estimated payment split"
                              disabled={busy}
                              onPress={() => setSplitDraft({ key: payTargetKey, mode: 'auto', principal: '', interest: '', escrow: '' })}
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 5,
                                borderRadius: 999,
                                borderWidth: 1,
                                borderColor: palette.brand,
                                backgroundColor: palette.tint,
                              }}
                            >
                              <Text style={[ui.small, { color: palette.brand, fontWeight: '700' }]}>Use estimate</Text>
                            </Pressable>
                          ) : (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Enter payment split manually"
                              disabled={busy}
                              onPress={() => setSplitDraft({ key: payTargetKey, mode: 'manual', principal: '', interest: '', escrow: '' })}
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 5,
                                borderRadius: 999,
                                borderWidth: 1,
                                borderColor: palette.brand,
                                backgroundColor: palette.tint,
                              }}
                            >
                              <Text style={[ui.small, { color: palette.brand, fontWeight: '700' }]}>Enter split</Text>
                            </Pressable>
                          )
                        ) : (
                          <>
                            {splitMode === 'manual' && canAutoSplit ? (
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Reset payment split to estimate"
                                disabled={busy}
                                onPress={() => setSplitDraft({ key: payTargetKey, mode: 'auto', principal: '', interest: '', escrow: '' })}
                                style={{
                                  paddingHorizontal: 10,
                                  paddingVertical: 5,
                                  borderRadius: 999,
                                  borderWidth: 1,
                                  borderColor: palette.border,
                                  backgroundColor: palette.surface,
                                }}
                              >
                                <Text style={[ui.small, { color: palette.brand, fontWeight: '700' }]}>Reset estimate</Text>
                              </Pressable>
                            ) : null}
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Clear payment split"
                              disabled={busy}
                              onPress={() => setSplitDraft({ key: payTargetKey, mode: 'cleared', principal: '', interest: '', escrow: '' })}
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 5,
                                borderRadius: 999,
                                borderWidth: 1,
                                borderColor: palette.border,
                                backgroundColor: palette.surface,
                              }}
                            >
                              <Text style={[ui.small, { color: palette.muted, fontWeight: '700' }]}>Clear split</Text>
                            </Pressable>
                          </>
                        )}
                      </View>
                    </View>
                    {splitMode === 'cleared' ? (
                      <>
                        {loanDebt.category === 'Mortgage' && !canAutoSplit ? (
                          <Text style={[ui.small, { color: palette.muted }]}>
                            Add monthly escrow in Accounts → Detail to auto-estimate, or enter split manually.
                          </Text>
                        ) : null}
                        <Text style={[ui.small, { color: palette.muted }]}>Cashflow only · loan balance unchanged.</Text>
                      </>
                    ) : (
                      <>
                        {loanDebt.category === 'Auto loan' && autoLoanContext ? (
                          <View style={{ gap: 6 }}>
                            {autoLoanContext.lastPaymentDate ? (() => {
                              const rawDays = Math.max(0, calendarDaysBetween(autoLoanContext.lastPaymentDate, todayStr));
                              return (
                                <View style={[ui.row, { gap: 6, flexWrap: 'wrap' }]}>
                                  {([
                                    { method: 'daily_simple' as const, label: `Daily (${rawDays}d)` },
                                    { method: 'monthly' as const, label: 'Monthly' },
                                  ]).map(option => {
                                    const active = autoLoanContext.method === option.method;
                                    return (
                                      <Pressable
                                        key={option.method}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected: active }}
                                        disabled={busy}
                                        onPress={() => {
                                          setAutoMethodOverride({ key: payTargetKey, method: option.method });
                                          if (splitMode === 'manual') {
                                            setSplitDraft({ key: payTargetKey, mode: 'auto', principal: '', interest: '', escrow: '' });
                                          }
                                        }}
                                        style={{
                                          paddingHorizontal: 10,
                                          paddingVertical: 5,
                                          borderRadius: 999,
                                          borderWidth: 1,
                                          borderColor: active ? palette.brand : palette.border,
                                          backgroundColor: active ? palette.tint : palette.surface,
                                        }}
                                      >
                                        <Text style={[ui.small, { color: active ? palette.brand : palette.muted, fontWeight: '700' }]}>
                                          {option.label}
                                        </Text>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              );
                            })() : null}
                            <Text style={[ui.small, { color: palette.muted }]}>
                              {autoLoanContext.method === 'daily_simple' && autoLoanContext.lastPaymentDate
                                ? `Daily · ${autoLoanContext.daysElapsed === 0 ? 'same day (0d)' : `${autoLoanContext.daysElapsed} ${autoLoanContext.daysElapsed === 1 ? 'day' : 'days'} since ${formatShortDate(autoLoanContext.lastPaymentDate)}`} · ${formatCurrency(autoLoanContext.dailyInterestCost, currencySymbol)}/day`
                                : !autoLoanContext.lastPaymentDate
                                  ? `Monthly est. · ${formatCurrency(autoLoanContext.dailyInterestCost, currencySymbol)}/day · no prior payment yet`
                                  : `Monthly est. (APR ÷ 12) · ${formatCurrency(autoLoanContext.dailyInterestCost, currencySymbol)}/day`}
                            </Text>
                          </View>
                        ) : null}
                        <View style={{ gap: 6 }}>
                          <Text style={[ui.small, { color: palette.muted }]}>Principal</Text>
                          <View style={ui.inputWrap}>
                            <Text style={[ui.text, { color: palette.brand, fontWeight: '700' }]}>{currencySymbol}</Text>
                            <TextInput
                              accessibilityLabel="Principal"
                              keyboardType="decimal-pad"
                              editable={!busy}
                              value={principalText}
                              onChangeText={val => handleSplitFieldEdit('principal', val)}
                              placeholder={formatEditableMoney(0, currencyCode)}
                              placeholderTextColor={palette.muted}
                              style={ui.input}
                            />
                          </View>
                          <Text style={[ui.small, { color: palette.muted }]}>Interest</Text>
                          <View style={ui.inputWrap}>
                            <Text style={[ui.text, { color: palette.brand, fontWeight: '700' }]}>{currencySymbol}</Text>
                            <TextInput
                              accessibilityLabel="Interest"
                              keyboardType="decimal-pad"
                              editable={!busy}
                              value={interestText}
                              onChangeText={val => handleSplitFieldEdit('interest', val)}
                              placeholder={formatEditableMoney(0, currencyCode)}
                              placeholderTextColor={palette.muted}
                              style={ui.input}
                            />
                          </View>
                          {loanDebt.category === 'Mortgage' ? (
                            <>
                              <Text style={[ui.small, { color: palette.muted }]}>Escrow</Text>
                              <View style={ui.inputWrap}>
                                <Text style={[ui.text, { color: palette.brand, fontWeight: '700' }]}>{currencySymbol}</Text>
                                <TextInput
                                  accessibilityLabel="Escrow"
                                  keyboardType="decimal-pad"
                                  editable={!busy}
                                  value={escrowText}
                                  onChangeText={val => handleSplitFieldEdit('escrow', val)}
                                  placeholder={formatEditableMoney(0, currencyCode)}
                                  placeholderTextColor={palette.muted}
                                  style={ui.input}
                                />
                              </View>
                            </>
                          ) : null}
                        </View>
                        {splitExceedsPayment ? (
                          <Text accessibilityRole="alert" style={[ui.small, { color: '#F08B78' }]}>
                            Principal, interest, and escrow cannot exceed the payment amount.
                          </Text>
                        ) : null}
                        {principalParsed.major > 0 ? (
                          <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }]}>
                            <Text style={[ui.small, { color: palette.muted }]}>Balance</Text>
                            <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                              <AmountText value={formatCurrency(loanDebt.balance, currencySymbol)} style={[ui.small, { color: palette.muted }]} />
                              <Text style={[ui.small, { color: palette.muted }]}>→</Text>
                              <AmountText
                                value={formatCurrency(projectedLoanBalanceAfterPrincipal(loanDebt.balance, principalParsed.major, currencyCode), currencySymbol)}
                                style={[ui.small, { color: palette.posInk, fontWeight: '700' }]}
                              />
                            </View>
                          </View>
                        ) : (
                          <Text style={[ui.small, { color: palette.muted }]}>Cashflow only · loan balance unchanged.</Text>
                        )}
                      </>
                    )}
                  </View>
                ) : null}
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
