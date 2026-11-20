import { BitLessMark } from './BitLessMark';
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  ScrollView as NativeScrollView,
  StyleSheet,
  UIManager,
  requireNativeComponent,
  useWindowDimensions,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Pressable, ScrollView, Text, View, appearanceColor, useNativeAppearance } from './NativeAppearance';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { AppIcon } from './AppIcon';
import { PullToRefreshScrollView } from './PullToRefreshScrollView';
import { useTabShell } from './TabShellContext';
import { AmountText } from './AmountText';
import { InformationButton } from './InformationSheet';
import { InspireCornerArt, InspireQuote } from './InspireArt';
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
  const { isLight, isInspire, palette, ctaBg, ctaFg } = useNativeAppearance();
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
          borderRadius: 18,
          backgroundColor: ctaBg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: isInspire ? 1.5 : 0,
          borderColor: palette.graphOutline,
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

type FinancialSwipeContextValue = {
  setSwipeBlocked: (blocked: boolean) => void;
};

const FinancialSwipeContext = createContext<FinancialSwipeContextValue | null>(null);

export function useFinancialSwipeBlocker() {
  return useContext(FinancialSwipeContext);
}

type NativeSwipeBlockViewProps = {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

const hasNativeAndroidSwipeBlockView =
  Platform.OS === 'android' &&
  typeof UIManager?.getViewManagerConfig === 'function' &&
  Boolean(UIManager.getViewManagerConfig('DFNSwipeBlockView'));

const NativeSwipeBlockView = hasNativeAndroidSwipeBlockView
  ? requireNativeComponent<NativeSwipeBlockViewProps>('DFNSwipeBlockView')
  : null;

export function SwipeProtectedHorizontalArea({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const swipeBlocker = useFinancialSwipeBlocker();
  if (NativeSwipeBlockView) {
    return <NativeSwipeBlockView style={style}>{children}</NativeSwipeBlockView>;
  }
  return (
    <View
      style={style}
      onTouchStartCapture={() => swipeBlocker?.setSwipeBlocked(true)}
      onTouchEnd={() => swipeBlocker?.setSwipeBlocked(false)}
      onTouchCancel={() => swipeBlocker?.setSwipeBlocked(false)}
    >
      {children}
    </View>
  );
}

export function FinancialScreen({
  title,
  children,
  segments,
  selected,
  onSelect,
  renderSegment,
  onSegmentScrollNearEnd,
  onSettings,
  onAdd,
  addLabel = 'Add item',
}: {
  title: string;
  children?: ReactNode;
  segments?: readonly string[];
  selected?: string;
  onSelect?: (value: string) => void;
  renderSegment?: (segment: string) => ReactNode;
  onSegmentScrollNearEnd?: (segment: string) => void;
  onSettings?: () => void;
  onAdd?: () => void;
  addLabel?: string;
}) {
  const { palette, isInspire } = useNativeAppearance();
  const shell = useTabShell();
  const { opacity: fabOpacity, scrollHandlers } = useScrollFadeOpacity();
  const canSwipeSegments = Boolean(segments && segments.length > 1 && onSelect);
  const useSideBySidePager = Boolean(segments && segments.length > 1 && renderSegment);
  const [swipeBlocked, setSwipeBlockedState] = useState(false);
  const swipeBlockedRef = useRef(false);
  const pagerScrollRef = useRef<ComponentRef<typeof NativeScrollView>>(null);
  const swipeContextValue = useMemo<FinancialSwipeContextValue>(() => ({
    setSwipeBlocked: blocked => {
      if (NativeSwipeBlockView) return;
      if (swipeBlockedRef.current === blocked) return;
      swipeBlockedRef.current = blocked;
      setSwipeBlockedState(blocked);
    },
  }), []);
  const windowWidth = useWindowDimensions().width;
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const pageWidth = measuredWidth > 0 ? measuredWidth : Math.max(240, windowWidth);
  const pageWidthRef = useRef(pageWidth);
  useEffect(() => {
    pageWidthRef.current = pageWidth;
  }, [pageWidth]);
  const currentIdx = segments ? Math.max(0, segments.indexOf(selected ?? '')) : 0;
  const currentIdxRef = useRef(currentIdx);
  useEffect(() => {
    currentIdxRef.current = currentIdx;
  }, [currentIdx]);
  const activeSegmentName = segments?.[currentIdx];
  const [readySegments, setReadySegments] = useState<Record<string, boolean>>(() => (
    activeSegmentName ? { [activeSegmentName]: true } : {}
  ));
  useEffect(() => {
    if (!useSideBySidePager || !activeSegmentName || readySegments[activeSegmentName]) return;
    const rafId = requestAnimationFrame(() => {
      setReadySegments(prev => (prev[activeSegmentName] ? prev : { ...prev, [activeSegmentName]: true }));
    });
    return () => cancelAnimationFrame(rafId);
  }, [activeSegmentName, readySegments, useSideBySidePager]);
  const mountAllSegmentsNextFrame = useCallback(() => {
    if (!segments || segments.length < 2) return;
    requestAnimationFrame(() => {
      setReadySegments(prev => {
        let changed = false;
        const next = { ...prev };
        for (const seg of segments) {
          if (!next[seg]) {
            next[seg] = true;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
  }, [segments]);
  const [pagerScrollX] = useState(() => new Animated.Value(currentIdx * pageWidth));
  const trackTranslateX = useMemo(() => Animated.multiply(pagerScrollX, -1), [pagerScrollX]);
  const draggingRef = useRef(false);
  const momentumActiveRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedIdxRef = useRef(currentIdx);
  const prevWidthRef = useRef(pageWidth);
  const hasMountedOffsetRef = useRef(false);
  const syncedContentWidthRef = useRef(0);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    clearSettleTimer();
  }, [clearSettleTimer]);

  useLayoutEffect(() => {
    if (!useSideBySidePager) return;
    const widthChanged = Math.abs(prevWidthRef.current - pageWidth) > 1;
    const indexChanged = lastSyncedIdxRef.current !== currentIdx;
    prevWidthRef.current = pageWidth;
    lastSyncedIdxRef.current = currentIdx;
    if (draggingRef.current) return;
    const targetX = currentIdx * pageWidth;
    if (!hasMountedOffsetRef.current || widthChanged) {
      hasMountedOffsetRef.current = true;
      pagerScrollX.setValue(targetX);
      pagerScrollRef.current?.scrollTo({ x: targetX, y: 0, animated: false });
    } else if (indexChanged) {
      pagerScrollRef.current?.scrollTo({ x: targetX, y: 0, animated: true });
    }
  }, [currentIdx, pageWidth, pagerScrollX, useSideBySidePager]);

  const swipeStateRef = useRef({ segments, selected, onSelect, canSwipeSegments });
  useEffect(() => {
    swipeStateRef.current = { segments, selected, onSelect, canSwipeSegments };
  }, [segments, selected, onSelect, canSwipeSegments]);

  const commitPageFromOffset = useCallback((offsetX: number) => {
    const { canSwipeSegments: enabled, segments: items, selected: current, onSelect: selectSegment } = swipeStateRef.current;
    if (!enabled || !items || items.length < 2 || !selectSegment) return;
    const width = Math.max(240, pageWidthRef.current);
    const nextIdx = Math.max(0, Math.min(items.length - 1, Math.round(offsetX / width)));
    lastSyncedIdxRef.current = nextIdx;
    const nextSegment = items[nextIdx];
    if (nextSegment && nextSegment !== current) {
      selectSegment(nextSegment);
    }
  }, []);

  const onPagerScroll = useMemo(
    () =>
      Animated.event(
        [{ nativeEvent: { contentOffset: { x: pagerScrollX } } }],
        { useNativeDriver: true },
      ),
    [pagerScrollX],
  );

  const refreshHeaderNotice = shell?.refreshFeedback && shell.refreshFeedback.kind !== 'success' ? (
    <Text accessibilityLiveRegion="polite" style={[ui.small, { color: shell.refreshFeedback.kind === 'error' ? '#F08B78' : palette.muted }]}>
      {shell.refreshFeedback.message}
    </Text>
  ) : null;

  return (
    <FinancialSwipeContext.Provider value={swipeContextValue}>
      <View style={{ flex: 1 }}>
        <View style={[ui.header, { backgroundColor: 'transparent', borderWidth: 0, borderBottomWidth: 0, elevation: 0, shadowOpacity: 0 }]}>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <View style={[ui.row, { gap: 10 }]}>
              <BitLessMark />
              <Text accessibilityRole="header" style={[ui.title, { fontSize: 16, fontWeight: '700' }]}>{title}</Text>
            </View>
            <View style={[ui.row, { gap: 8, alignItems: 'center' }]}>
              {onSettings && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open settings"
                  onPress={onSettings}
                  hitSlop={6}
                  style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
                    borderWidth: isInspire ? 1.5 : 1, borderColor: palette.cardBorder,
                    backgroundColor: palette.surface }}
                >
                  <AppIcon name="settings" size={18} color={palette.muted} />
                </Pressable>
              )}
            </View>
          </View>
          {segments && (
            <Segments
              items={segments}
              selected={selected ?? ''}
              onSelect={onSelect!}
              compact
              trackTranslateX={useSideBySidePager ? trackTranslateX : undefined}
              pageWidth={useSideBySidePager ? pageWidth : undefined}
            />
          )}
        </View>
        <View
          style={{ flex: 1, overflow: 'hidden' }}
          onTouchStartCapture={() => {
            swipeContextValue.setSwipeBlocked(false);
          }}
          onLayout={event => {
            const width = event.nativeEvent.layout.width;
            if (width > 0 && Math.abs(width - measuredWidth) > 1) {
              setMeasuredWidth(width);
            }
          }}
        >
          {useSideBySidePager && segments && renderSegment ? (
            <>
              <Animated.ScrollView
                ref={pagerScrollRef}
                horizontal
                pagingEnabled
                nestedScrollEnabled
                directionalLockEnabled
                bounces={false}
                overScrollMode="never"
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                scrollEnabled={canSwipeSegments && !swipeBlocked}
                scrollEventThrottle={16}
                contentOffset={{ x: currentIdx * pageWidth, y: 0 }}
                style={{ flex: 1 }}
                onContentSizeChange={contentWidth => {
                  if (draggingRef.current) return;
                  if (Math.abs(contentWidth - syncedContentWidthRef.current) > 2 && contentWidth >= segments.length * pageWidth - 2) {
                    syncedContentWidthRef.current = contentWidth;
                    const targetX = currentIdxRef.current * pageWidthRef.current;
                    pagerScrollX.setValue(targetX);
                    pagerScrollRef.current?.scrollTo({ x: targetX, y: 0, animated: false });
                  }
                }}
                onScroll={onPagerScroll}
                onScrollBeginDrag={event => {
                  clearSettleTimer();
                  draggingRef.current = true;
                  momentumActiveRef.current = false;
                  mountAllSegmentsNextFrame();
                  scrollHandlers.onScrollBeginDrag(event);
                }}
                onMomentumScrollBegin={event => {
                  clearSettleTimer();
                  momentumActiveRef.current = true;
                  scrollHandlers.onMomentumScrollBegin(event);
                }}
                onScrollEndDrag={event => {
                  const offsetX = event.nativeEvent.contentOffset.x;
                  scrollHandlers.onScrollEndDrag(event);
                  clearSettleTimer();
                  settleTimerRef.current = setTimeout(() => {
                    settleTimerRef.current = null;
                    if (!momentumActiveRef.current) {
                      draggingRef.current = false;
                      commitPageFromOffset(offsetX);
                    }
                  }, 120);
                }}
                onMomentumScrollEnd={event => {
                  clearSettleTimer();
                  draggingRef.current = false;
                  momentumActiveRef.current = false;
                  commitPageFromOffset(event.nativeEvent.contentOffset.x);
                  scrollHandlers.onMomentumScrollEnd(event);
                }}
              >
                {segments.map(segment => {
                  const segmentReady = Boolean(readySegments[segment]);
                  return (
                    <View key={segment} style={{ width: pageWidth, flex: 1 }}>
                      <PullToRefreshScrollView
                        contentContainerStyle={[ui.screen, onAdd ? { paddingBottom: 92 } : null]}
                        keyboardShouldPersistTaps="handled"
                        refreshing={Boolean(shell?.refreshing)}
                        onRefresh={shell?.onRefresh}
                        headerContent={refreshHeaderNotice}
                        {...scrollHandlers}
                        onScroll={event => {
                          scrollHandlers.onScroll(event);
                          if (onSegmentScrollNearEnd && segmentReady) {
                            const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
                            if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 500) {
                              onSegmentScrollNearEnd(segment);
                            }
                          }
                        }}
                      >
                        {segmentReady ? renderSegment(segment) : (
                          <View style={{ paddingVertical: 56, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                            <ActivityIndicator size="small" color={palette.brand} />
                            <Text style={ui.small}>{`Loading ${segment.toLowerCase()}…`}</Text>
                          </View>
                        )}
                      </PullToRefreshScrollView>
                    </View>
                  );
                })}
              </Animated.ScrollView>
              {children}
            </>
          ) : (
            <PullToRefreshScrollView
              key={selected ?? title}
              contentContainerStyle={[ui.screen, onAdd ? { paddingBottom: 92 } : null]}
              keyboardShouldPersistTaps="handled"
              refreshing={Boolean(shell?.refreshing)}
              onRefresh={shell?.onRefresh}
              headerContent={refreshHeaderNotice}
              {...scrollHandlers}
            >
              {children}
            </PullToRefreshScrollView>
          )}
        </View>
        {onAdd ? <FloatingAddButton onPress={onAdd} label={addLabel} opacity={fabOpacity} /> : null}
      </View>
    </FinancialSwipeContext.Provider>
  );
}

export function Segments({
  items,
  selected,
  onSelect,
  compact = false,
  trackTranslateX,
  pageWidth,
}: {
  compact?: boolean;
  hideBaseline?: boolean;
  items: readonly string[];
  selected: string;
  onSelect: (value: string) => void;
  trackTranslateX?: {
    interpolate: (config: {
      inputRange: number[];
      outputRange: number[];
      extrapolate?: 'extend' | 'clamp' | 'identity';
    }) => Animated.AnimatedInterpolation<number>;
  };
  pageWidth?: number;
}) {
  const { palette } = useNativeAppearance();
  const [barWidth, setBarWidth] = useState(0);
  const selectedIndex = Math.max(0, items.indexOf(selected));
  const [animatedIndex] = useState(() => new Animated.Value(selectedIndex));

  useEffect(() => {
    Animated.timing(animatedIndex, {
      toValue: selectedIndex,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [selectedIndex, animatedIndex]);

  const tabWidth = items.length > 0 && barWidth > 0 ? barWidth / items.length : 0;
  const maxIdx = Math.max(1, items.length - 1);
  const indicatorTranslateX = tabWidth > 0
    ? trackTranslateX && pageWidth && pageWidth > 0 && items.length > 1
      ? trackTranslateX.interpolate({
          inputRange: [-maxIdx * pageWidth, 0],
          outputRange: [tabWidth * maxIdx, 0],
          extrapolate: 'clamp',
        })
      : animatedIndex.interpolate({
          inputRange: [0, maxIdx],
          outputRange: [0, tabWidth * maxIdx],
          extrapolate: 'clamp',
        })
    : 0;

  return (
    <View
      onLayout={event => {
        const w = event.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - barWidth) > 1) setBarWidth(w);
      }}
      style={[
        ui.segments,
        {
          backgroundColor: 'transparent',
          borderWidth: 0,
          position: 'relative',
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
             hitSlop={compact ? { top: 4, bottom: 4 } : undefined}
            onPress={() => onSelect(item)}
            style={[
              ui.segment,
               { minHeight: compact ? 30 : 44, ...(compact ? { paddingVertical: 3 } : {}) },
              {
                borderRadius: 0,
                borderBottomWidth: tabWidth > 0 ? 0 : 2.5,
                borderBottomColor: active ? palette.brand : 'transparent',
              },
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
                  fontSize: 15,
                  color: active ? palette.accentInk : palette.muted,
                  fontWeight: active ? '800' : '700',
                },
              ]}
            >
              {item}
            </Text>
          </Pressable>
        );
      })}
      {tabWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            width: tabWidth,
            height: 2.5,
            backgroundColor: palette.brand,
            borderRadius: 2,
            transform: [{ translateX: indicatorTranslateX }],
          }}
        />
      ) : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { isInspire, isLight, palette } = useNativeAppearance();
  return <View style={[
    ui.card,
    { backgroundColor: palette.surface, borderColor: palette.cardBorder },
    isInspire && {
      borderWidth: 1.5,
      shadowColor: palette.text,
      shadowOpacity: isLight ? 0.10 : 0.16,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 4,
      elevation: 2,
    },
    style,
  ]}>{children}</View>;
}

export function Bar({ percent, color }: { percent: number; color?: string }) {
  const { isInspire, palette } = useNativeAppearance();
  return (
    <View style={[ui.bar, { backgroundColor: palette.raised }, isInspire && { borderWidth: 1, borderColor: palette.graphOutline }]}>
      <View style={[ui.barFill, { backgroundColor: color ?? palette.brand, width: `${Math.max(0, Math.min(100, percent))}%` }, isInspire && { borderColor: palette.graphOutline, borderWidth: 1 }]} />
    </View>
  );
}

export function MultiBar({ segments }: { segments: { percent: number; color: string }[] }) {
  const { isInspire, palette } = useNativeAppearance();
  const visible = segments.filter(segment => segment.percent > 0);
  const remainder = Math.max(0, 100 - visible.reduce((sum, segment) => sum + segment.percent, 0));
  return (
    <View style={{ height: 14, borderRadius: 7, overflow: 'hidden', flexDirection: 'row', gap: 2, backgroundColor: palette.raised, borderWidth: isInspire ? 1.5 : 0, borderColor: palette.graphOutline }}>
      {visible.map((seg, idx) => (
        <View
          key={idx}
          style={{
            height: '100%',
            flex: seg.percent,
            backgroundColor: seg.color,
            borderRadius: 4,
            borderColor: palette.graphOutline,
            borderWidth: isInspire ? 1 : 0,
          }}
        />
      ))}
      {remainder > 0 ? <View style={{ flex: remainder }} /> : null}
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
  const { palette, isInspire } = useNativeAppearance();
  const ringGradId = `homeSnapRing_${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const goTo = (next: number) => {
    const bounded = Math.max(0, Math.min(categories.length - 1, next));
    setIndex(bounded);
    scrollRef.current?.scrollTo({ x: bounded * width, animated: true });
  };
  const activeCategory = categories[index];
  const activeDebts = categoryDebts(debts, activeCategory);
  return (
    <Card style={{ gap: 10, padding: 16, borderRadius: 18, overflow: 'hidden' }}>
      {isInspire ? <InspireCornerArt kind="corner-wave" borderRadius={18} /> : null}
      <View pointerEvents="none" accessible={false} style={{ position: 'absolute', right: 8, top: 8, width: 84, height: 64, opacity: 0.14 }}>
        <Svg width="84" height="64" viewBox="0 0 84 64">
          {[0, 1, 2, 3, 4].map(col => [0, 1, 2, 3].map(row => (
            <Circle key={`${col}-${row}`} cx={14 + col * 15} cy={8 + row * 14} r="1.4" fill={palette.muted} opacity={Math.max(0.15, (col + (3 - row)) / 7)} />
          )))}
        </Svg>
      </View>
      <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', minHeight: 28 }]}>
        <View style={[ui.row, { flex: 1, minWidth: 0, gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }]}>
          <Text accessibilityRole="header" style={ui.heading}>Your accounts</Text>
          <Text style={[ui.small, { color: palette.muted }]} numberOfLines={1}>
            {`\u00b7 ${activeCategory} (${activeDebts.length})`}
          </Text>
        </View>
        <InformationButton
          onVisibilityChange={onInformationVisibilityChange}
          label="Balance change information"
          detail={"The Paid comparison includes original balances for active and previously paid-off household accounts. Balance shows current active debt only.\n\nA comparison is unavailable if any included account is missing an entered reference. This is a balance snapshot, not recorded payments or lifetime payment performance."}
        />
      </View>
      <View onLayout={event => { const next = event.nativeEvent.layout.width; if (next !== width) setWidth(next); }}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={() => { if (width) scrollRef.current?.scrollTo({ x: index * width, animated: false }); }}
          onMomentumScrollEnd={event => { if (width) setIndex(Math.max(0, Math.min(categories.length - 1, Math.round(event.nativeEvent.contentOffset.x / width)))); }}
        >
          {categories.map(category => {
            const selectedDebts = categoryDebts(referenceDebts, category);
            const stats = snapshot(selectedDebts);
            const hasReference = selectedDebts.length > 0 && selectedDebts.every(debt => debt.originalBalance != null);
            const paidRatio = hasReference ? Math.max(0, Math.min(100, stats.percent)) : 0;
            const radius = 37;
            const circumference = 2 * Math.PI * radius;
            const dashLength = (paidRatio / 100) * circumference;
            return (
              <View key={category} style={{ width, paddingVertical: 2 }}>
                <View style={[ui.row, { alignItems: 'center', gap: 14 }]}>
                  <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
                    <Svg width={96} height={96} viewBox="0 0 96 96" style={{ position: 'absolute' }}>
                      <Defs>
                        <LinearGradient id={ringGradId} x1="0%" y1="0%" x2="100%" y2="100%">
                          <Stop offset="0%" stopColor={palette.brand} />
                          <Stop offset="100%" stopColor={palette.brand2} />
                        </LinearGradient>
                      </Defs>
                      <Circle cx="48" cy="48" r={radius} stroke={palette.raised} strokeWidth="11" fill="none" />
                      {isInspire ? (
                        <>
                          <Circle cx="48" cy="48" r={radius + 5.5} stroke={palette.graphOutline} strokeWidth="1.1" fill="none" />
                          <Circle cx="48" cy="48" r={radius - 5.5} stroke={palette.graphOutline} strokeWidth="1.1" fill="none" />
                        </>
                      ) : null}
                      {paidRatio > 0 && isInspire ? (
                        <Circle
                          cx="48"
                          cy="48"
                          r={radius}
                          stroke={palette.graphOutline}
                          strokeWidth="12.8"
                          strokeLinecap="round"
                          fill="none"
                          strokeDasharray={`${dashLength} ${circumference}`}
                          rotation="-90"
                          origin="48, 48"
                        />
                      ) : null}
                      {paidRatio > 0 ? (
                        <Circle
                          cx="48"
                          cy="48"
                          r={radius}
                          stroke={isInspire ? `url(#${ringGradId})` : palette.brand}
                          strokeWidth="11"
                          strokeLinecap="round"
                          fill="none"
                          strokeDasharray={`${dashLength} ${circumference}`}
                          rotation="-90"
                          origin="48, 48"
                        />
                      ) : null}
                    </Svg>
                    <Text style={{ color: palette.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.4 }}>
                      {selectedDebts.length === 0 ? '0%' : hasReference ? `${Math.round(paidRatio)}%` : '—'}
                    </Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
                    <View style={{
                      borderRadius: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      backgroundColor: palette.raised,
                      borderWidth: isInspire ? 1.5 : 1,
                      borderColor: palette.cardBorder,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                    }}>
                      <Text style={[ui.small, { color: palette.muted, fontWeight: '600' }]}>Paid</Text>
                      <AmountText
                        value={selectedDebts.length === 0 ? formatCurrency(0, currencySymbol) : hasReference ? formatCurrency(Math.max(0, stats.paid), currencySymbol) : '—'}
                        style={[ui.value, { fontSize: 16.5, fontWeight: '800', color: palette.posInk, textAlign: 'right' }]}
                      />
                    </View>
                    <View style={{
                      borderRadius: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      backgroundColor: palette.raised,
                      borderWidth: isInspire ? 1.5 : 1,
                      borderColor: palette.cardBorder,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                    }}>
                      <Text style={[ui.small, { color: palette.muted, fontWeight: '600' }]}>Balance</Text>
                      <AmountText
                        value={formatCurrency(stats.balance, currencySymbol)}
                        style={[ui.value, { fontSize: 16.5, fontWeight: '800', color: palette.neg, textAlign: 'right' }]}
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
          <InspireQuote slot="accountsLeft" tiltDeg={-2} color={palette.quoteInk} style={{ fontSize: 11.5 }} />
        </View>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Account category"
          accessibilityHint="Swipe up or down to change category. You can also swipe left or right on the account card."
          accessibilityValue={{ min: 1, max: categories.length, now: index + 1, text: `${categories[index]}, ${index + 1} of ${categories.length}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'increment') goTo(index + 1); else if (event.nativeEvent.actionName === 'decrement') goTo(index - 1); }}
          style={{ minWidth: 44, minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          {categories.map((category, i) => (
            <View
              key={category}
              style={{
                width: i === index ? 20 : 7,
                height: 7,
                borderRadius: 999,
                backgroundColor: i === index ? palette.brand : palette.border,
                borderWidth: isInspire ? 1 : 0,
                borderColor: i === index ? palette.brand : palette.graphOutline,
              }}
            />
          ))}
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <InspireQuote slot="accountsRight" cycleOffset={1} tiltDeg={1.5} color={palette.quoteInk} style={{ fontSize: 11.5, textAlign: 'right' }} />
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
    paddingTop: 4,
    paddingBottom: 4,
    gap: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#222A25',
  },
  title: { color: '#F1F5F2', fontSize: 24, fontWeight: '800', letterSpacing: -0.45 },
  heading: { color: '#F1F5F2', fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
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
  buttonText: { color: '#0051FB', fontSize: 14, fontWeight: '700', textAlign: 'center' },
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


