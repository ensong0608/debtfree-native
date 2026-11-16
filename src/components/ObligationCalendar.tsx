import { Pressable, Text, View, useNativeAppearance } from './NativeAppearance';
import { AppIcon } from './AppIcon';
import { ui } from './FinancialScreen';
import type { ScheduledObligationRow } from '../finance/payment-matching';

/** Calendar navigation only; settlement and date eligibility stay in the shared selector. */
export function ObligationCalendar({
  month,
  rows,
  selectedDate,
  onSelect,
  plannedDates = [],
  annualFeeDates = [],
  onPrevMonth,
  onNextMonth,
  canPrevMonth = true,
  canNextMonth = true,
}: {
  month: string;
  rows: readonly ScheduledObligationRow[];
  selectedDate: string | null;
  onSelect: (date: string | null) => void;
  plannedDates?: readonly string[];
  annualFeeDates?: readonly string[];
  onPrevMonth?: () => void;
  onNextMonth?: () => void;
  canPrevMonth?: boolean;
  canNextMonth?: boolean;
}) {
  const { palette } = useNativeAppearance();
  const first = new Date(`${month}-01T12:00:00`);
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(first);
  const hasMonthNav = Boolean(onPrevMonth || onNextMonth);
  const length = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12).getDate();
  const days = Array.from({ length: first.getDay() + length }, (_, index) => index < first.getDay() ? null : index - first.getDay() + 1);
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, week) => Array.from({ length: 7 }, (_, weekday) => days[week * 7 + weekday] ?? null));
  return <View style={{ marginTop: 0, paddingHorizontal: 12, paddingVertical: 10, paddingTop: hasMonthNav ? 6 : 10, gap: 4, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 16 }}>
    {hasMonthNav ? (
      <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', paddingLeft: 4 }]}>
        <Text accessibilityRole="header" style={ui.heading}>{monthLabel}</Text>
        <View style={[ui.row, { gap: 2 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous scheduled month"
            accessibilityState={{ disabled: !canPrevMonth }}
            disabled={!canPrevMonth || !onPrevMonth}
            onPress={onPrevMonth}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: canPrevMonth ? 1 : 0.4 }}
          >
            <AppIcon name="chevronLeft" size={18} color={palette.brand} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next scheduled month"
            accessibilityState={{ disabled: !canNextMonth }}
            disabled={!canNextMonth || !onNextMonth}
            onPress={onNextMonth}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: canNextMonth ? 1 : 0.4 }}
          >
            <AppIcon name="chevronRight" size={18} color={palette.brand} />
          </Pressable>
        </View>
      </View>
    ) : null}
    <View style={{ flexDirection: 'row' }}>
      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <Text key={index} accessible={false} style={[ui.small, { flex: 1, textAlign: 'center' }]}>{day}</Text>)}
    </View>
    <View>
      {weeks.map((week, weekIndex) => <View key={weekIndex} style={{ flexDirection: 'row' }}>{week.map((day, index) => {
        if (day === null) return <View key={`blank-${index}`} style={{ flex: 1, minWidth: 0, minHeight: 38 }} />;
        const date = `${month}-${String(day).padStart(2, '0')}`;
        const entries = rows.filter(row => row.dueDate === date);
        const hasPlan = plannedDates.includes(date);
        const annualFeeCount = annualFeeDates.filter(feeDate => feeDate === date).length;
        const paid = entries.filter(row => row.state.status === 'paid').length;
        const pending = entries.filter(row => row.state.status === 'pending_confirmation').length;
        const unpaid = entries.length - paid - pending;
        const selected = date === selectedDate;
        return <Pressable key={date} accessibilityRole="button" accessibilityLabel={`${date}: ${paid} paid, ${unpaid} unpaid, ${pending} pending${hasPlan ? ', planned installment' : ''}${annualFeeCount ? `, ${annualFeeCount} annual fee${annualFeeCount === 1 ? '' : 's'}` : ''}`}
          accessibilityState={{ selected }} onPress={() => onSelect(selected ? null : date)}
          style={{ flex: 1, minWidth: 0, minHeight: 38, gap: 2, paddingVertical: 3, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: selected ? palette.brand : 'transparent', borderWidth: 1, borderColor: selected ? palette.brand : 'transparent' }}>
          <Text style={[ui.text, { color: selected ? palette.onBrand : entries.length ? palette.text : palette.muted, fontWeight: entries.length ? '700' : '400' }]}>{day}</Text>
          <View style={{ flexDirection: 'row', gap: 3, minHeight: 6, alignItems: 'center' }}>
            {paid > 0 ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#76DCB9', borderWidth: selected ? 1 : 0, borderColor: palette.onBrand }} /> : null}
            {unpaid > 0 ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#F5C563', borderWidth: selected ? 1 : 0, borderColor: palette.onBrand }} /> : null}
            {pending > 0 ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#A78BFA', borderWidth: selected ? 1 : 0, borderColor: palette.onBrand }} /> : null}
            {hasPlan ? <View accessibilityLabel="Planned installment" style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: '#60A5FA', transform: [{ rotate: '45deg' }], borderWidth: selected ? 1 : 0, borderColor: palette.onBrand }} /> : null}
            {annualFeeCount > 0 ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#F08B78', borderWidth: selected ? 1 : 0, borderColor: palette.onBrand }} /> : null}
          </View>
        </Pressable>;
      })}</View>)}
    </View>
    <View style={[ui.row, { justifyContent: 'center', columnGap: 14, rowGap: 6, marginTop: 2, flexWrap: 'wrap' }]}>
      {[['Paid', '#76DCB9'], ['Unpaid', '#F5C563'], ['Pending', '#A78BFA']].map(([label, color]) => (
        <View key={label} style={[ui.row, { gap: 5, alignItems: 'center' }]}>
          <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color }} />
          <Text style={[ui.small, { fontSize: 11 }]}>{label}</Text>
        </View>
      ))}
      <View style={[ui.row, { gap: 5, alignItems: 'center' }]}><View accessibilityLabel="Planned installment marker" style={{ width: 7, height: 7, borderRadius: 1, backgroundColor: '#60A5FA', transform: [{ rotate: '45deg' }] }} /><Text style={[ui.small, { fontSize: 11 }]}>Planned</Text></View>
      {annualFeeDates.length ? <View style={[ui.row, { gap: 5, alignItems: 'center' }]}><View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#F08B78' }} /><Text style={[ui.small, { fontSize: 11 }]}>Annual fee</Text></View> : null}
      {selectedDate ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Show all dates this month" onPress={() => onSelect(null)} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: palette.tint }}>
          <Text style={{ color: palette.brand, fontSize: 11, fontWeight: '700' }}>All dates</Text>
        </Pressable>
      ) : null}
    </View>
  </View>;
}
