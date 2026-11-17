import { BitLessMark } from './BitLessMark';
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  Animated,
  ScrollView as NativeScrollView,
  RefreshControl,
  StyleSheet,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Pressable, ScrollView, Text, View, appearanceColor, useNativeAppearance } from './NativeAppearance';
import Svg, { Circle, Path } from 'react-native-svg';
import { AppIcon } from './AppIcon';
import { useTabShell } from './TabShellContext';
import { AmountText } from './AmountText';
import { InformationButton } from './InformationSheet';
import { InspireQuote } from './InspireArt';
import { formatCurrency, categoryDebts, calculateBalanceSnapshot, type DebtItem } from '../onboarding-domain';

export function useScrollFadeOpacity() {
  const [opacity] = useState(() => new Animated.Value(1));
  const dimmedRef = useRef(false);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRestoreTimer = () => {
    if (restoreTimerRef.current) {
      clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }
  };

  const dim = () => {
    clearRestoreTimer();
    if (!dimmedRef.current) {
      dimmedRef.current = true;
      Animated.timing(opacity, {
        toValue: 0.4,
        duration: 130,
        useNativeDriver: true,
      }).start();
    }
  };

  const scheduleRestore = () => {
    clearRestoreTimer();
    restoreTimerRef.current = setTimeout(() => {
      restoreTimerRef.current = null;
      dimmedRef.current = false;
      Animated.timing(opacity, {
        toValue: 1,
        duration: 240,
        useNativeDriver: true,
      }).start();
    }, 650);
  };

  useEffect(() => () => {
    clearRestoreTimer();
  }, []);

  return {
    opacity,
    scrollHandlers: {
      onTouchStart: (_e?: GestureResponderEvent) => { dim(); },
      onTouchEnd: (_e?: GestureResponderEvent) => { scheduleRestore(); },
      onTouchCancel: (_e?: GestureResponderEvent) => { scheduleRestore(); },
      onScrollBeginDrag: (_e?: NativeSyntheticEvent<NativeScrollEvent>) => { dim(); },
      onMomentumScrollBegin: (_e?: NativeSyntheticEvent<NativeScrollEvent>) => { dim(); },
      onScroll: (_e?: NativeSyntheticEvent<NativeScrollEvent>) => {
        dim();
        scheduleRestore();
      },
      onScrollEndDrag: (_e?: NativeSyntheticEvent<NativeScrollEvent>) => { scheduleRestore(); },
      onMomentumScrollEnd: (_e?: NativeSyntheticEvent<NativeScrollEvent>) => { scheduleRestore(); },
      scrollEventThrottle: 16 as const,
    },
  };
}

export function FloatingAddButton({
  onPress,
  label,
  opacity,
}: {
  onPress: () => void;
  label: string;
  opacity: Animated.Value;
}) {
  const { isLight, ctaBg, ctaFg } = useNativeAppearance();
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        right: 18,
        bottom: 18,
        opacity,
        zIndex: 20,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: ctaBg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: isLight ? 0 : 1,
          borderColor: isLight ? 'transparent' : 'rgba(255,255,255,0.16)',
          shadowColor: '#000000',
          shadowOpacity: isLight ? 0.22 : 0.45,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <AppIcon name="plus" size={26} color={ctaFg} strokeWidth={3.2} />
      </Pressable>
    </Animated.View>
  );
}

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
  const { palette } = useNativeAppearance();
  const shell = useTabShell();
  const { opacity: fabOpacity, scrollHandlers } = useScrollFadeOpacity();
  return (
    <View style={{ flex: 1 }}>
      <View style={[ui.header, { backgroundColor: palette.canvas, borderBottomColor: palette.border }, (segments || title === 'Progress') && { borderWidth: 0, borderBottomWidth: 0, elevation: 0, shadowOpacity: 0 }]}>
        <View style={[ui.row, { justifyContent: 'space-between' }]}>
          <View style={[ui.row, { gap: 10 }]}>
            <BitLessMark />
            <Text accessibilityRole="header" style={[ui.title, { fontSize: 22 }]}>{title}</Text>
          </View>
          <View style={[ui.row, { gap: 8, alignItems: 'center' }]}>
            {onSettings && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open settings"
                onPress={onSettings}
                style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}
              >
                <AppIcon name="settings" size={21} color={palette.muted} />
              </Pressable>
            )}
          </View>
        </View>
        {segments && <Segments items={segments} selected={selected ?? ''} onSelect={onSelect!} compact={title === 'Progress'} />}
      </View>
      <ScrollView
        key={selected ?? title}
        contentContainerStyle={[ui.screen, onAdd ? { paddingBottom: 92 } : null]}
        keyboardShouldPersistTaps="handled"
        {...scrollHandlers}
        refreshControl={shell?.onRefresh ? <RefreshControl refreshing={shell.refreshing} onRefresh={() => { void shell.onRefresh?.(); }} /> : undefined}
      >
        {shell?.refreshFeedback && shell.refreshFeedback.kind !== 'success' ? <Text accessibilityLiveRegion="polite" style={[ui.small, { color: shell.refreshFeedback.kind === 'error' ? '#F08B78' : palette.muted }]}>{shell.refreshFeedback.message}</Text> : null}
        {children}
      </ScrollView>
      {onAdd ? <FloatingAddButton onPress={onAdd} label={addLabel} opacity={fabOpacity} /> : null}
    </View>
  );
}

export function Segments({
  items,
  selected,
  onSelect,
  compact = false,
}: {
  compact?: boolean;
  hideBaseline?: boolean;
  items: readonly string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const { palette } = useNativeAppearance();
  return (
    <View
      style={[
        ui.segments,
        {
          backgroundColor: 'transparent',
          borderWidth: 0,
        },
      ]}
    >
      {items.map(item => {
        const active = item === selected;
        return (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(item)}
            style={[
              ui.segment,
              { minHeight: compact ? 40 : 44 },
              { borderRadius: 0, borderBottomWidth: 2.5, borderBottomColor: active ? palette.brand : 'transparent' },
            ]}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              style={[
                ui.buttonText,
                {
                  textAlign: 'center',
                  fontSize: 16,
                  color: active ? palette.brand : palette.muted,
                  fontWeight: active ? '800' : '700',
                },
              ]}
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
  const { palette } = useNativeAppearance();
  return <View style={[ui.card, { backgroundColor: palette.surface, borderColor: palette.border }, style]}>{children}</View>;
}

export function Bar({ percent, color }: { percent: number; color?: string }) {
  const { isLight, palette } = useNativeAppearance();
  return (
    <View style={[ui.bar, { backgroundColor: isLight ? '#E2E8F0' : palette.raised }]}>
      <View style={[ui.barFill, color ? { backgroundColor: color } : undefined, { width: `${Math.max(0, Math.min(100, percent))}%` }]} />
    </View>
  );
}

export function MultiBar({ segments }: { segments: { percent: number; color: string }[] }) {
  return (
    <View style={{ height: 14, borderRadius: 7, overflow: 'hidden', flexDirection: 'row', gap: 2 }}>
      {segments.map((seg, idx) => (
        <View
          key={idx}
          style={{
            height: '100%',
            width: `${Math.max(0, Math.min(100, seg.percent))}%`,
            backgroundColor: seg.color,
            borderRadius: 4,
          }}
        />
      ))}
    </View>
  );
}

export function Ring({ percent, label }: { percent: number; label?: string }) {
  const { isLight, accentColor, palette } = useNativeAppearance();
  const p = Math.max(0, Math.min(100, percent));
  const ringTrack = isLight ? '#E6ECF4' : palette.raised;
  return (
    <View style={{ width: 112, height: 112, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={112} height={112} viewBox="0 0 112 112" style={{ position: 'absolute' }}>
        <Circle cx="56" cy="56" r="44" stroke={ringTrack} strokeWidth="12" fill="none" />
        {p > 0 ? (
          <Circle
            cx="56"
            cy="56"
            r="44"
            stroke={appearanceColor('#76DCB9', isLight, accentColor)}
            strokeWidth="12"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${(p / 100) * 2 * Math.PI * 44} ${2 * Math.PI * 44}`}
            rotation="-90"
            origin="56, 56"
          />
        ) : null}
      </Svg>
      <Text style={{ color: palette.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 }}>{`${Math.round(p)}%`}</Text>
      {label && <Text style={{ color: palette.muted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</Text>}
    </View>
  );
}

export function Gauge({ label = '—' }: { label?: string }) {
  const { isLight, accentColor } = useNativeAppearance();
  return (
    <View style={{ width: 124, alignItems: 'center' }}>
      <View style={{ width: 120, height: 68, alignItems: 'center', justifyContent: 'flex-end' }}>
        <Svg width={120} height={68} viewBox="0 0 120 68" style={{ position: 'absolute', top: 0 }}>
          <Path
            d="M12 58 A48 48 0 0 1 108 58"
            stroke={appearanceColor('#1C2420', isLight, accentColor)}
            strokeWidth="9"
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
  referenceDebts = debts,
  currencySymbol,
  onInformationVisibilityChange,
}: {
  debts: DebtItem[];
  referenceDebts?: DebtItem[];
  currencySymbol: string;
  onInformationVisibilityChange?: (visible: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<ComponentRef<typeof NativeScrollView>>(null);
  const { palette, isLight, accentColor } = useNativeAppearance();
  const goTo = (next: number) => {
    const bounded = Math.max(0, Math.min(categories.length - 1, next));
    setIndex(bounded);
    scrollRef.current?.scrollTo({ x: bounded * width, animated: true });
  };
  const activeCategory = categories[index];
  const activeDebts = categoryDebts(debts, activeCategory);
  const ringTrack = isLight ? '#E6ECF4' : palette.raised;
  const ringFill = appearanceColor('#76DCB9', isLight, accentColor);
  return (
    <Card style={{ gap: 8, padding: 16 }}>
      <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', minHeight: 28 }]}>
        <View style={[ui.row, { flex: 1, minWidth: 0, gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }]}>
          <Text accessibilityRole="header" style={ui.heading}>Your Accounts</Text>
          <Text style={[ui.small, { color: palette.muted }]} numberOfLines={1}>
            {`\u00b7 ${activeCategory} (${activeDebts.length})`}
          </Text>
        </View>
        <InformationButton onVisibilityChange={onInformationVisibilityChange} label="Balance change information" detail={"The Paid comparison includes original balances for active and previously paid-off household accounts. Balance shows current active debt only.\n\nA comparison is unavailable if any included account is missing an entered reference. This is a balance snapshot, not recorded payments or lifetime payment performance."} />
      </View>
      <View onLayout={event => { const next = event.nativeEvent.layout.width; if (next !== width) setWidth(next); }}>
        <ScrollView ref={scrollRef} horizontal pagingEnabled directionalLockEnabled showsHorizontalScrollIndicator={false} onContentSizeChange={() => { if (width) scrollRef.current?.scrollTo({ x: index * width, animated: false }); }} onMomentumScrollEnd={event => { if (width) setIndex(Math.max(0, Math.min(categories.length - 1, Math.round(event.nativeEvent.contentOffset.x / width)))); }}>
          {categories.map(category => {
            const selectedDebts = categoryDebts(referenceDebts, category);
            const stats = snapshot(selectedDebts);
            const hasReference = selectedDebts.length > 0 && selectedDebts.every(debt => debt.originalBalance != null);
            const paidRatio = hasReference ? Math.max(0, Math.min(100, stats.percent)) : 0;
            const radius = 38;
            const circumference = 2 * Math.PI * radius;
            const dashLength = (paidRatio / 100) * circumference;
            return (
              <View key={category} style={{ width, paddingVertical: 4 }}>
                <View style={[ui.row, { alignItems: 'center', gap: 18 }]}>
                  <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
                    <Svg width={96} height={96} viewBox="0 0 96 96" style={{ position: 'absolute' }}>
                      <Circle cx="48" cy="48" r={radius} stroke={ringTrack} strokeWidth="12" fill="none" />
                      {paidRatio > 0 ? (
                        <Circle
                          cx="48"
                          cy="48"
                          r={radius}
                          stroke={ringFill}
                          strokeWidth="12"
                          strokeLinecap="round"
                          fill="none"
                          strokeDasharray={`${dashLength} ${circumference}`}
                          rotation="-90"
                          origin="48, 48"
                        />
                      ) : null}
                    </Svg>
                    <Text style={{ color: palette.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.4 }}>
                      {selectedDebts.length === 0 ? '0%' : hasReference ? `${Math.round(paidRatio)}%` : '—'}
                    </Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
                    <View style={{ gap: 2 }}>
                      <Text style={[ui.small, { color: palette.muted, fontWeight: '600' }]}>Paid</Text>
                      <AmountText
                        value={selectedDebts.length === 0 ? formatCurrency(0, currencySymbol) : hasReference ? formatCurrency(Math.max(0, stats.paid), currencySymbol) : '—'}
                        style={[ui.value, { fontSize: 19, fontWeight: '800', color: isLight ? '#087D42' : '#86E3B8' }]}
                      />
                    </View>
                    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, paddingTop: 8, gap: 2 }}>
                      <Text style={[ui.small, { color: palette.muted, fontWeight: '600' }]}>Balance</Text>
                      <AmountText
                        value={formatCurrency(stats.balance, currencySymbol)}
                        style={[ui.value, { fontSize: 19, fontWeight: '800', color: isLight ? '#C53B27' : '#F08B78' }]}
                      />
                    </View>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
      <View style={[ui.row, { justifyContent: 'center', alignItems: 'center', paddingTop: 2, gap: 8 }]}>
        <View style={{ flex: 1, alignItems: 'flex-start' }}>
          <InspireQuote slot="accountsLeft" tiltDeg={-2} color="#0A85A5" style={{ fontSize: 12 }} />
        </View>
        <View accessible accessibilityRole="adjustable" accessibilityLabel="Account category" accessibilityHint="Swipe up or down to change category. You can also swipe left or right on the account card." accessibilityValue={{ min: 1, max: categories.length, now: index + 1, text: `${categories[index]}, ${index + 1} of ${categories.length}` }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'increment') goTo(index + 1); else if (event.nativeEvent.actionName === 'decrement') goTo(index - 1); }} style={{ minWidth: 44, minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          {categories.map((category, i) => <View key={category} style={{ width: i === index ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === index ? palette.brand : palette.border }} />)}
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <InspireQuote slot="accountsRight" cycleOffset={1} tiltDeg={1.5} color="#0A85A5" style={{ fontSize: 12, textAlign: 'right' }} />
        </View>
      </View>
    </Card>
  );
}

export const ui = StyleSheet.create({
  screen: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32, gap: 14 },
  header: {
    backgroundColor: '#121614',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#222A25',
  },
  title: { color: '#F1F5F2', fontSize: 24, fontWeight: '700', letterSpacing: -0.45 },
  heading: { color: '#F1F5F2', fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  text: { color: '#A6B2AA', fontSize: 15, lineHeight: 22 },
  small: { color: '#728078', fontSize: 13, lineHeight: 18 },
  value: { color: '#F1F5F2', fontSize: 17, fontWeight: '700' },
  mintValue: { color: '#76DCB9', fontSize: 17, fontWeight: '700' },
  positiveValue: { color: '#86E3B8', fontSize: 17, fontWeight: '700' },
  dangerValue: { color: '#F08B78', fontSize: 17, fontWeight: '700' },
  badge: {
    backgroundColor: 'rgba(118, 220, 185, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(118, 220, 185, 0.25)',
  },
  badgeText: { color: '#76DCB9', fontSize: 12, fontWeight: '700' },
  card: {
    backgroundColor: '#141816',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#222A25',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  button: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#1C2420',
    borderWidth: 1,
    borderColor: '#28372E',
    justifyContent: 'center',
  },
  selected: { backgroundColor: '#E8F0FF', borderColor: '#0051FB', borderWidth: 1 },
  buttonText: { color: '#0051FB', fontSize: 14, fontWeight: '700' },
  segments: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minWidth: 0,
    minHeight: 40,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  iconButton: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: '#1C2420',
    borderWidth: 1,
    borderColor: '#28372E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: '#1C2420',
    borderWidth: 1,
    borderColor: '#28372E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floating: {
    position: 'absolute',
    right: 18,
    bottom: 24,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0051FB',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  bar: { height: 11, borderRadius: 6, backgroundColor: '#1C2420', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#76DCB9', borderRadius: 6 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#191E1B',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#222A25',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  input: {
    color: '#F1F5F2',
    backgroundColor: '#191E1B',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#222A25',
    minHeight: 44,
    paddingHorizontal: 12,
    flex: 1,
  },
  divider: { borderTopWidth: 1, borderTopColor: '#222A25', paddingTop: 10 },
});


