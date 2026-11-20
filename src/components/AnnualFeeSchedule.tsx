import { useMemo, useState } from 'react';
import { Pressable, Text, View, appearanceColor, useNativeAppearance } from './NativeAppearance';
import { AmountText } from './AmountText';
import { Card, ui } from './FinancialScreen';
import { AppIcon } from './AppIcon';
import { ConfirmModal } from './ConfirmModal';
import { formatCurrency, type DebtItem } from '../onboarding-domain';
import { type DateOnly } from '../finance/calendar';
import { type LedgerTransaction } from '../finance/ledger';
import { annualFeeTransactionId, isAnnualFeeTransaction } from '../finance/annual-fees';

const ANNUAL_FEE_DATE_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

type AnnualFeeRow = { debt: DebtItem; dueDate: DateOnly; transaction?: LedgerTransaction };

export function getAnnualFeeRows(debts: readonly DebtItem[], transactions: readonly LedgerTransaction[]): AnnualFeeRow[] {
  return debts.flatMap(debt => {
    if (debt.category !== 'Credit card' || debt.annualFeeAmount == null || debt.annualFeeNextDueDate == null) return [];
    const transaction = transactions.find(tx => isAnnualFeeTransaction(tx, debt.id, debt.annualFeeNextDueDate!));
    return [{ debt, dueDate: debt.annualFeeNextDueDate, transaction }];
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.debt.name.localeCompare(b.debt.name));
}

export function AnnualFeeSchedule({
  debts,
  transactions,
  mode,
  currencySymbol,
  currentDate,
  selectedMonth,
  selectedDate,
  onConfirmAnnualFee,
  readOnly = false,
}: {
  debts: readonly DebtItem[];
  transactions: readonly LedgerTransaction[];
  mode: 'upcoming' | 'scheduled';
  currencySymbol: string;
  currentDate: DateOnly;
  selectedMonth?: string;
  selectedDate?: string | null;
  onConfirmAnnualFee?: (debtId: string, renewalDate: DateOnly) => Promise<{ outcome: 'confirmed' | 'pending' } | void> | { outcome: 'confirmed' | 'pending' } | void;
  readOnly?: boolean;
}) {
  const { isLight, palette } = useNativeAppearance();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmRow, setConfirmRow] = useState<AnnualFeeRow | null>(null);
  const nextMonth = (() => {
    const [year, month] = currentDate.slice(0, 7).split('-').map(Number);
    return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  })();
  const allRows = useMemo(() => getAnnualFeeRows(debts, transactions), [debts, transactions]);
  const rows = useMemo(() => (
    mode === 'upcoming'
      ? allRows.filter(row => row.dueDate.slice(0, 7) <= nextMonth)
      : allRows.filter(row => row.dueDate.slice(0, 7) === selectedMonth && (!selectedDate || row.dueDate === selectedDate))
  ), [allRows, mode, nextMonth, selectedMonth, selectedDate]);

  const confirm = (row: AnnualFeeRow) => {
    if (readOnly) return;
    setConfirmRow(row);
  };

  const save = async (row: AnnualFeeRow) => {
    const id = annualFeeTransactionId(row.debt.id, row.dueDate);
    if (readOnly || !onConfirmAnnualFee || busyId) return;
    setBusyId(id);
    setError('');
    try {
      await onConfirmAnnualFee(row.debt.id, row.dueDate);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to record this annual fee.');
    } finally {
      setBusyId(null);
    }
  };

  if (!rows.length) return null;
  const grouped = new Map<string, AnnualFeeRow[]>();
  for (const row of rows) grouped.set(row.dueDate, [...(grouped.get(row.dueDate) ?? []), row]);

  return <View style={{ marginTop: 16, gap: 8 }}>
    <Text accessibilityRole="header" style={[ui.heading, { marginHorizontal: 16 }]}>Annual card fees</Text>
    {error ? <Text accessibilityRole="alert" style={[ui.small, { color: appearanceColor('#F08B78', isLight), marginHorizontal: 16 }]}>{error}</Text> : null}
    {[...grouped.entries()].map(([date, dateRows]) => <View key={date} style={{ gap: 8 }}>
      <Text style={[ui.small, { fontWeight: '700', marginHorizontal: 16 }]}>{ANNUAL_FEE_DATE_FMT.format(new Date(`${date}T12:00:00`))}</Text>
      {dateRows.map(row => {
        const id = annualFeeTransactionId(row.debt.id, row.dueDate);
        const pending = Boolean(row.transaction?.isPending);
        const recorded = Boolean(row.transaction && !pending);
        const overdue = row.dueDate < currentDate;
        return <Card key={id} style={{ marginHorizontal: 16, padding: 14, borderRadius: 14, gap: 8 }}>
          <View style={[ui.row, { justifyContent: 'space-between', gap: 10 }]}>
            <View style={[ui.row, { gap: 9, flex: 1 }]}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: palette.tint, alignItems: 'center', justifyContent: 'center' }}><AppIcon name="creditCard" size={17} color={palette.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[ui.heading, { fontSize: 15 }]}>{row.debt.name}</Text>
                <Text style={[ui.small, { color: pending ? '#F5C563' : recorded ? '#76DCB9' : overdue ? '#F08B78' : palette.muted }]}>
                  {pending ? 'Awaiting confirmation' : recorded ? 'Fee recorded · renewal update needed' : overdue ? 'Past due · confirm if charged' : 'Expected annual fee'}
                </Text>
              </View>
            </View>
            <AmountText style={[ui.value, { textAlign: 'right' }]} value={formatCurrency(row.debt.annualFeeAmount!, currencySymbol)} />
          </View>
          {!pending && !readOnly ? <Pressable accessibilityRole="button" accessibilityLabel={recorded ? `Finish annual-fee schedule for ${row.debt.name}` : `Record annual fee for ${row.debt.name}`} disabled={!onConfirmAnnualFee || busyId === id}
            onPress={() => confirm(row)} style={[ui.button, { alignSelf: 'flex-end', backgroundColor: palette.tint, borderColor: palette.brand, borderWidth: 1, opacity: !onConfirmAnnualFee || busyId === id ? 0.5 : 1 }]}>
            <Text style={[ui.buttonText, { color: palette.brand }]}>{busyId === id ? 'Saving…' : recorded ? 'Finish renewal update' : 'Record fee charged'}</Text>
          </Pressable> : null}
        </Card>;
      })}
    </View>)}
    {confirmRow ? (() => {
      const transactionExists = Boolean(confirmRow.transaction && !confirmRow.transaction.isPending);
      const amountLabel = formatCurrency(confirmRow.debt.annualFeeAmount!, currencySymbol);
      return (
        <ConfirmModal
          visible
          destructive={false}
          icon="creditCard"
          title={transactionExists ? 'Finish annual-fee schedule?' : 'Record annual fee?'}
          message={
            transactionExists
              ? `The ${amountLabel} fee for ${confirmRow.debt.name} is already recorded. Advance the next renewal date?`
              : `Confirm the ${amountLabel} fee has posted to ${confirmRow.debt.name}. This records the charge and updates the account balance; it will not make a payment or charge the card automatically.`
          }
          confirmLabel={transactionExists ? 'Finish' : 'Record charge'}
          onCancel={() => setConfirmRow(null)}
          onConfirm={() => {
            const target = confirmRow;
            setConfirmRow(null);
            void save(target);
          }}
        />
      );
    })() : null}
  </View>;
}

export function annualFeeDatesForMonth(debts: readonly DebtItem[], month: string): DateOnly[] {
  return getAnnualFeeRows(debts, []).filter(row => row.dueDate.slice(0, 7) === month).map(row => row.dueDate);
}
