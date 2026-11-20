import { useState } from 'react';
import { AppIcon } from './AppIcon';
import { ui } from './FinancialScreen';
import { Pressable, ScrollView, Text, View, useNativeAppearance } from './NativeAppearance';
import { SheetModal } from './SheetModal';

const monthName = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });

export function PeriodDateSheet({ value, currentYear, earliestYear, onSelect, onClose }: {
  value: string;
  currentYear: number;
  earliestYear: number;
  onSelect: (value: `${number}` | `${number}-${number}` | 'lifetime') => void;
  onClose: () => void;
}) {
  const [year, setYear] = useState(value === 'lifetime' ? currentYear : Number(value.slice(0, 4)));
  const { palette, ctaBg, ctaFg, isInspire } = useNativeAppearance();
  const years = Array.from({ length: currentYear - earliestYear + 1 }, (_, index) => currentYear - index);
  const optionStyle = (selected: boolean) => ({
    minHeight: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: 12,
    borderWidth: isInspire ? 1.5 : 1,
    borderColor: selected ? ctaBg : palette.cardBorder,
    backgroundColor: selected ? ctaBg : palette.tint,
  });
  const selectAndClose = (next: Parameters<typeof onSelect>[0]) => {
    onSelect(next);
    onClose();
  };
  return (
    <SheetModal visible onClose={onClose} contentSized closeLabel="Close date range selector">
      <View style={[ui.row, { justifyContent: 'space-between', marginBottom: 8 }]}>
        <Text accessibilityRole="header" style={ui.title}>Date</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close date range selector" onPress={onClose} style={{ width: 44, height: 44, borderWidth: 1, borderColor: palette.cardBorder, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
          <AppIcon name="close" size={20} color={palette.muted} />
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: value === 'lifetime' }} onPress={() => selectAndClose('lifetime')} style={[ui.row, { minHeight: 44, paddingHorizontal: 14, borderWidth: 1, justifyContent: 'space-between', borderColor: value === 'lifetime' ? ctaBg : palette.cardBorder, borderRadius: 12, backgroundColor: value === 'lifetime' ? palette.selection : 'transparent' }]}>
        <Text style={[ui.text, { color: palette.text, fontWeight: '700' }]}>Lifetime</Text>
        {value === 'lifetime' ? <AppIcon name="check" size={17} color={palette.accentInk} /> : null}
      </Pressable>
      <Text accessibilityRole="header" style={[ui.heading, { marginTop: 12, marginBottom: 4 }]}>Year</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
        {years.map(option => {
          const selected = value === String(option);
          return (
            <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => {
              setYear(option);
              onSelect(`${option}`);
            }} style={[optionStyle(selected), { minWidth: 70, borderRadius: 22 }]}>
              <Text style={{ color: selected ? ctaFg : palette.text, fontWeight: year === option ? '700' : '500' }}>{option}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text accessibilityRole="header" style={[ui.heading, { marginTop: 12, marginBottom: 4 }]}>Month · {year}</Text>
      {[0, 3, 6, 9].map(start => (
        <View key={start} style={[ui.row, { gap: 8, marginBottom: 8 }]}>
          {[start, start + 1, start + 2].map(index => {
            const month = `${year}-${String(index + 1).padStart(2, '0')}` as `${number}-${number}`;
            const selected = value === month;
            return (
              <Pressable key={month} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => selectAndClose(month)} style={[optionStyle(selected), { flex: 1 }]}>
                <Text style={{ color: selected ? ctaFg : palette.text, fontWeight: '700' }}>
                  {monthName.format(new Date(Date.UTC(2024, index, 1)))}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </SheetModal>
  );
}
