import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { AppIcon } from './AppIcon';
import { formatCurrency, categoryDebts, type DebtItem } from '../onboarding-domain';

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
              accessibilityLabel="Edit setup"
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

export function Card({ children }: { children: ReactNode }) {
  return <View style={ui.card}>{children}</View>;
}

export function Bar({ percent }: { percent: number }) {
  return (
    <View style={ui.bar}>
      <View style={[ui.barFill, { width: `${Math.max(0, Math.min(100, percent))}%` }]} />
    </View>
  );
}

export function Ring({ percent, label }: { percent: number; label?: string }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <View style={{ width: 112, height: 112, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={112} height={112} viewBox="0 0 112 112" style={{ position: 'absolute' }}>
        <Circle cx="56" cy="56" r="48" stroke="#414A45" strokeWidth="9" fill="none" />
        <Circle
          cx="56"
          cy="56"
          r="48"
          stroke="#81DFD2"
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
  return (
    <View style={{ width: 124, alignItems: 'center' }}>
      <View style={{ width: 120, height: 68, alignItems: 'center', justifyContent: 'flex-end' }}>
        <Svg width={120} height={68} viewBox="0 0 120 68" style={{ position: 'absolute', top: 0 }}>
          <Path
            d="M12 58 A48 48 0 0 1 108 58"
            stroke="#414A45"
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

export const categories = ['Cards & Loans', 'Auto', 'All Debts'] as const;
export { categoryDebts };

export function snapshot(debts: DebtItem[]) {
  const balance = debts.reduce((s, d) => s + d.balance, 0);
  const starting = debts.reduce((s, d) => s + Math.max(d.balance, d.originalBalance ?? d.balance), 0);
  return {
    balance,
    paid: starting - balance,
    percent: starting > 0 ? ((starting - balance) / starting) * 100 : 0,
  };
}

export function SnapshotCard({
  debts,
  currencySymbol,
}: {
  debts: DebtItem[];
  currencySymbol: string;
}) {
  const [index, setIndex] = useState(0);
  const selected = categories[index];
  const stats = snapshot(categoryDebts(debts, selected));
  return (
    <Card>
      <View style={[ui.row, { justifyContent: 'space-between' }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous category"
          onPress={() => setIndex((index + categories.length - 1) % categories.length)}
          style={ui.iconButton}
        >
          <AppIcon name="chevronLeft" size={18} color="#81DFD2" />
        </Pressable>
        <Text style={ui.heading}>{selected}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next category"
          onPress={() => setIndex((index + 1) % categories.length)}
          style={ui.iconButton}
        >
          <AppIcon name="chevronRight" size={18} color="#81DFD2" />
        </Pressable>
      </View>
      <View style={[ui.row, { gap: 16 }]}>
        <Ring percent={stats.percent} label="snapshot" />
        <View style={{ flex: 1, gap: 6 }}>
          <View>
            <Text style={ui.small}>Paid (snapshot):</Text>
            <Text style={ui.value}>{formatCurrency(stats.paid, currencySymbol)}</Text>
          </View>
          <View style={ui.divider}>
            <Text style={ui.small}>Balance:</Text>
            <Text style={ui.heading}>{formatCurrency(stats.balance, currencySymbol)}</Text>
          </View>
        </View>
      </View>
      <Text style={ui.small}>
        Comparison with entered starting balances; not recorded payment history.
      </Text>
    </Card>
  );
}

export const ui = StyleSheet.create({
  screen: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 116, gap: 14 },
  header: {
    backgroundColor: '#262927',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#414743',
  },
  title: { color: '#F9F9F6', fontSize: 24, fontWeight: '700' },
  heading: { color: '#F9F9F6', fontSize: 17, fontWeight: '700' },
  text: { color: '#AAB3AD', fontSize: 14, lineHeight: 20 },
  small: { color: '#AAB3AD', fontSize: 12, lineHeight: 17 },
  value: { color: '#81DFD2', fontSize: 17, fontWeight: '700' },
  badge: {
    backgroundColor: '#31534D',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: { color: '#81DFD2', fontSize: 11, fontWeight: '700' },
  card: {
    backgroundColor: '#292D2B',
    borderRadius: 14,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#3C443F',
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


