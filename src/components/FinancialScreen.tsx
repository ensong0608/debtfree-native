import { useState, type ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Pressable, ScrollView, Text, View, appearanceColor, useNativeAppearance } from './NativeAppearance';
import Svg, { Circle, Path } from 'react-native-svg';
import { AppIcon } from './AppIcon';
import { SelectDropdown, type DropdownOption } from './SelectDropdown';
import { formatCurrency, categoryDebts, calculateBalanceSnapshot, type DebtItem } from '../onboarding-domain';

export function FinancialScreen({
  title,
  children,
  segments,
  selected,
  onSelect,
  onSettings,
  onAdd,
  addLabel = 'Add item',
}: {
  title: string;
  children: ReactNode;
  segments?: readonly string[];
  selected?: string;
  onSelect?: (value: string) => void;
  onSettings?: () => void;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <View style={{ flex: 1 }}>
      <View style={ui.header}>
        <View style={[ui.row, { justifyContent: 'space-between' }]}>
          <Text accessibilityRole="header" style={ui.title}>
            {title}
          </Text>
          {onSettings && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open settings"
              onPress={onSettings}
              style={ui.iconButton}
            >
              <AppIcon name="settings" size={20} color="#81DFD2" />
            </Pressable>
          )}
        </View>
        {segments && <Segments items={segments} selected={selected ?? ''} onSelect={onSelect!} />}
      </View>
      <ScrollView contentContainerStyle={ui.screen} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {onAdd && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          onPress={onAdd}
          style={ui.floating}
        >
          <AppIcon name="plus" size={24} color="#1F201F" />
        </Pressable>
      )}
    </View>
  );
}

export function Segments({
  items,
  selected,
  onSelect,
}: {
  items: readonly string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={ui.segments}>
      {items.map(item => {
        const active = item === selected;
        return (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(item)}
            style={[ui.segment, active && ui.selected]}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[ui.buttonText, { textAlign: 'center', color: active ? '#F9F9F6' : '#AAB3AD' }]}
            >
              {item}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[ui.card, style]}>{children}</View>;
}

export function Bar({ percent }: { percent: number }) {
  return (
    <View style={ui.bar}>
      <View style={[ui.barFill, { width: `${Math.max(0, Math.min(100, percent))}%` }]} />
    </View>
  );
}

export function Ring({ percent, label }: { percent: number; label?: string }) {
  const { isLight } = useNativeAppearance();
  const p = Math.max(0, Math.min(100, percent));
  return (
    <View style={{ width: 112, height: 112, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={112} height={112} viewBox="0 0 112 112" style={{ position: 'absolute' }}>
        <Circle cx="56" cy="56" r="48" stroke={appearanceColor('#414A45', isLight)} strokeWidth="9" fill="none" />
        <Circle
          cx="56"
          cy="56"
          r="48"
          stroke={appearanceColor('#81DFD2', isLight)}
          strokeWidth="9"
          fill="none"
          strokeDasharray={`${p * 3.016} 301.6`}
          rotation="-90"
          origin="56, 56"
        />
      </Svg>
      <Text style={ui.heading}>{`${Math.round(p)}%`}</Text>
      {label && <Text style={{ color: '#AAB3AD', fontSize: 10 }}>{label}</Text>}
    </View>
  );
}

export function Gauge({ label = '—' }: { label?: string }) {
  const { isLight } = useNativeAppearance();
  return (
    <View style={{ width: 124, alignItems: 'center' }}>
      <View style={{ width: 120, height: 68, alignItems: 'center', justifyContent: 'flex-end' }}>
        <Svg width={120} height={68} viewBox="0 0 120 68" style={{ position: 'absolute', top: 0 }}>
          <Path
            d="M12 58 A48 48 0 0 1 108 58"
            stroke={appearanceColor('#414A45', isLight)}
            strokeWidth="10"
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
        <Text style={ui.heading}>{label}</Text>
      </View>
      <View style={[ui.row, { width: '100%', justifyContent: 'space-between', paddingHorizontal: 4 }]}>
        <Text style={ui.small}>0%</Text>
        <Text style={ui.small}>200%+</Text>
      </View>
    </View>
  );
}

export const categories = ['Cards & Loans', 'Home', 'Auto'] as const;
export { categoryDebts };

export function snapshot(debts: DebtItem[]) {
  return calculateBalanceSnapshot(debts);
}

export function SnapshotCard({
  debts,
  currencySymbol,
}: {
  debts: DebtItem[];
  currencySymbol: string;
}) {
  const [selected, setSelected] = useState<string>(categories[0]);
  const stats = snapshot(categoryDebts(debts, selected));
  const selectedDebts = categoryDebts(debts, selected);
  const options: readonly DropdownOption<string>[] = categories.map(value => ({ value, label: value, icon: value === 'Auto' ? 'auto' : value === 'Home' ? 'homeLoan' : 'creditCard' }));
  return (
    <Card>
      <SelectDropdown label="Debt category" value={selected} options={options} onSelect={setSelected} sheetTitle="Choose debt category" />
      <View style={[ui.row, { gap: 16 }]}>
        <Ring percent={stats.percent} label="snapshot" />
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={ui.small}>{`${selectedDebts.length} accounts`}</Text>
          <View>
            <Text style={ui.small}>Balance change</Text>
            <Text style={ui.value}>{formatCurrency(stats.paid, currencySymbol)}</Text>
          </View>
          <View style={ui.divider}>
            <Text style={ui.small}>Balance:</Text>
            <Text style={ui.heading}>{formatCurrency(stats.balance, currencySymbol)}</Text>
          </View>
        </View>
      </View>
    </Card>
  );
}

export const ui = StyleSheet.create({
  screen: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 120, gap: 16 },
  header: {
    backgroundColor: '#242926',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#353D38',
  },
  title: { color: '#F9F9F6', fontSize: 24, fontWeight: '700', letterSpacing: -0.45 },
  heading: { color: '#F9F9F6', fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  text: { color: '#B5BDB7', fontSize: 14, lineHeight: 20 },
  small: { color: '#AAB3AD', fontSize: 12, lineHeight: 16 },
  value: { color: '#81DFD2', fontSize: 17, fontWeight: '700' },
  badge: {
    backgroundColor: '#31534D',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: { color: '#81DFD2', fontSize: 11, fontWeight: '700' },
  card: {
    backgroundColor: '#272D2A',
    borderRadius: 18,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: '#37413B',
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  button: {
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#353D39',
    justifyContent: 'center',
  },
  selected: { backgroundColor: '#31534D' },
  buttonText: { color: '#81DFD2', fontSize: 13, fontWeight: '700' },
  segments: {
    flexDirection: 'row',
    backgroundColor: '#1F201F',
    borderRadius: 11,
    padding: 4,
    borderWidth: 1,
    borderColor: '#3C443F',
  },
  segment: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  iconButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#353D39',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: '#314541',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floating: {
    position: 'absolute',
    right: 18,
    bottom: 56,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#81DFD2',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  bar: { height: 7, borderRadius: 4, backgroundColor: '#414A45', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#81DFD2', borderRadius: 4 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#353D39',
    borderRadius: 10,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  input: {
    color: '#F9F9F6',
    backgroundColor: '#353D39',
    borderRadius: 10,
    minHeight: 42,
    paddingHorizontal: 12,
    flex: 1,
  },
  divider: { borderTopWidth: 1, borderTopColor: '#414743', paddingTop: 10 },
});


