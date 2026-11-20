import { useMemo } from 'react';
import { Pressable, Text, View, useNativeAppearance } from './NativeAppearance';
import { AppIcon } from './AppIcon';
import { InspireCornerArt } from './InspireArt';
import { ui } from './FinancialScreen';
import type { ScheduledObligationRow } from '../finance/payment-matching';

const CALENDAR_MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

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
  const { isInspire, isLight, palette } = useNativeAppearance();
  const { monthLabel, weeks } = useMemo(() => {
    const first = new Date(`${month}-01T12:00:00`);
    const length = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12).getDate();
    const days = Array.from({ length: first.getDay() + length }, (_, index) => index < first.getDay() ? null : index - first.getDay() + 1);
    const gridWeeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, week) => Array.from({ length: 7 }, (_, weekday) => days[week * 7 + weekday] ?? null));
    return { monthLabel: CALENDAR_MONTH_FMT.format(first), weeks: gridWeeks };
  }, [month]);

  const countsByDate = useMemo(() => {
    const map = new Map<string, { total: number; paid: number; pending: number; unpaid: number }>();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      let bucket = map.get(row.dueDate);
      if (!bucket) {
        bucket = { total: 0, paid: 0, pending: 0, unpaid: 0 };
        map.set(row.dueDate, bucket);
      }
      bucket.total += 1;
      if (row.state.status === 'paid') bucket.paid += 1;
      else if (row.state.status === 'pending_confirmation') bucket.pending += 1;
      else bucket.unpaid += 1;
    }
    return map;
  }, [rows]);

  const plannedDateSet = useMemo(() => new Set(plannedDates), [plannedDates]);
  const annualFeeCountByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < annualFeeDates.length; i += 1) {
      const date = annualFeeDates[i];
      map.set(date, (map.get(date) ?? 0) + 1);
    }
    return map;
  }, [annualFeeDates]);

  const hasMonthNav = Boolean(onPrevMonth || onNextMonth);
  const pendingDotColor = isLight ? '#6366F1' : '#818CF8';
  return <View style={{
    position: 'relative',
    overflow: 'hidden',
    marginTop: 0,
    paddingHorizontal: 14,
    paddingVertical: 12,
    paddingTop: hasMonthNav ? 8 : 12,
    gap: 5,
    backgroundColor: palette.surface,
    borderWidth: isInspire ? 1.5 : 1,
    borderColor: palette.cardBorder,
    borderRadius: 18,
  }}>
    {isInspire ? <InspireCornerArt kind="hero-calendar" borderRadius={18} /> : null}
    {hasMonthNav ? (
      <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', paddingLeft: 2, marginBottom: 2 }]}>
        <Text accessibilityRole="header" style={[ui.heading, { fontSize: 17 }]}>{monthLabel}</Text>
        <View style={[ui.row, { gap: 4 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous scheduled month"
            accessibilityState={{ disabled: !canPrevMonth }}
            disabled={!canPrevMonth || !onPrevMonth}
            onPress={onPrevMonth}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: canPrevMonth ? 1 : 0.4 }}
          >
            <View style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              borderWidth: isInspire ? 1.5 : 1,
              borderColor: palette.cardBorder,
              backgroundColor: palette.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <AppIcon name="chevronLeft" size={16} color={palette.accentInk} />
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next scheduled month"
            accessibilityState={{ disabled: !canNextMonth }}
            disabled={!canNextMonth || !onNextMonth}
            onPress={onNextMonth}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: canNextMonth ? 1 : 0.4 }}
          >
            <View style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              borderWidth: isInspire ? 1.5 : 1,
              borderColor: palette.cardBorder,
              backgroundColor: palette.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <AppIcon name="chevronRight" size={16} color={palette.accentInk} />
            </View>
          </Pressable>
        </View>
      </View>
    ) : null}
    <View style={{ flexDirection: 'row', gap: 4, paddingBottom: 2 }}>
      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <Text key={index} accessible={false} style={[ui.small, { flex: 1, textAlign: 'center', fontSize: 11.5, fontWeight: '700', color: palette.muted }]}>{day}</Text>)}
    </View>
    <View style={{ gap: 4 }}>
      {weeks.map((week, weekIndex) => <View key={weekIndex} style={{ flexDirection: 'row', gap: 4 }}>{week.map((day, index) => {
        if (day === null) return <View key={`blank-${index}`} style={{ flex: 1, minWidth: 0, minHeight: 40 }} />;
        const date = `${month}-${String(day).padStart(2, '0')}`;
        const bucket = countsByDate.get(date);
        const total = bucket?.total ?? 0;
        const paid = bucket?.paid ?? 0;
        const pending = bucket?.pending ?? 0;
        const unpaid = bucket?.unpaid ?? 0;
        const hasPlan = plannedDateSet.has(date);
        const annualFeeCount = annualFeeCountByDate.get(date) ?? 0;
        const selected = date === selectedDate;
        const hasActivity = total > 0 || hasPlan || annualFeeCount > 0;
        return <Pressable key={date} accessibilityRole="button" accessibilityLabel={`${date}: ${paid} paid, ${unpaid} unpaid, ${pending} pending${hasPlan ? ', planned installment' : ''}${annualFeeCount ? `, ${annualFeeCount} annual fee${annualFeeCount === 1 ? '' : 's'}` : ''}`}
          accessibilityState={{ selected }} onPress={() => onSelect(selected ? null : date)}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 40,
            gap: 3,
            paddingVertical: 4,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 10,
            backgroundColor: selected ? palette.selection : hasActivity ? palette.raised : 'transparent',
            borderWidth: selected ? 1.5 : (hasActivity && isInspire) ? 1 : 0,
            borderColor: selected ? palette.brand : (hasActivity && isInspire) ? palette.cardBorder : 'transparent',
          }}>
          <Text style={[ui.text, { fontSize: 13.5, lineHeight: 17, color: selected ? palette.accentInk : hasActivity ? palette.text : palette.muted, fontWeight: selected || hasActivity ? '700' : '500' }]}>{day}</Text>
          <View style={{ flexDirection: 'row', gap: 3, minHeight: 7, alignItems: 'center' }}>
            {paid > 0 ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.pos }} /> : null}
            {unpaid > 0 ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.neg }} /> : null}
            {pending > 0 ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: pendingDotColor }} /> : null}
            {hasPlan ? <View accessibilityLabel="Planned installment" style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: '#38BDF8', transform: [{ rotate: '45deg' }] }} /> : null}
            {annualFeeCount > 0 ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.neg }} /> : null}
          </View>
        </Pressable>;
      })}</View>)}
    </View>
    <View style={[ui.row, { justifyContent: 'center', columnGap: 14, rowGap: 6, marginTop: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: palette.border, flexWrap: 'wrap' }]}>
      {[['Paid', palette.pos], ['Unpaid', palette.neg], ['Pending', pendingDotColor]].map(([label, color]) => (
        <View key={label} style={[ui.row, { gap: 5, alignItems: 'center' }]}>
          <View style={{ width: 6.5, height: 6.5, borderRadius: 3.25, backgroundColor: color }} />
          <Text style={[ui.small, { fontSize: 11, fontWeight: '500', color: label === 'Unpaid' ? palette.neg : palette.muted }]}>{label}</Text>
        </View>
      ))}
      <View style={[ui.row, { gap: 5, alignItems: 'center' }]}><View accessibilityLabel="Planned installment marker" style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: '#38BDF8', transform: [{ rotate: '45deg' }] }} /><Text style={[ui.small, { fontSize: 11, fontWeight: '500' }]}>Planned</Text></View>
      {annualFeeDates.length ? <View style={[ui.row, { gap: 5, alignItems: 'center' }]}><View style={{ width: 6.5, height: 6.5, borderRadius: 3.25, backgroundColor: palette.neg }} /><Text style={[ui.small, { fontSize: 11, fontWeight: '500' }]}>Annual fee</Text></View> : null}
      {selectedDate ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Show all dates this month" onPress={() => onSelect(null)} style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: palette.selection, borderWidth: 1, borderColor: palette.brand }}>
          <Text style={{ color: palette.accentInk, fontSize: 11, fontWeight: '700' }}>All dates</Text>
        </Pressable>
      ) : null}
    </View>
  </View>;
}
