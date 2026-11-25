import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  PanResponder,
  Platform,
  RefreshControl,
  ScrollView as NativeScrollView,
  UIManager,
  requireNativeComponent,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { ScrollView, Text, View, useNativeAppearance } from './NativeAppearance';
import { AppIcon } from './AppIcon';

const MAX_PULL_DISTANCE = 92;
const TRIGGER_PULL_DISTANCE = 36;
const REFRESH_REST_HEIGHT = 50;
const PULL_DAMPING = 0.72;

type PullPhase = 'idle' | 'pulling' | 'ready' | 'refreshing' | 'updated';
type DragPhase = 'idle' | 'pulling' | 'ready' | 'settling' | 'updated';

type NativePullMoveEvent = NativeSyntheticEvent<{ dy: number }>;
type NativePullReleaseEvent = NativeSyntheticEvent<{ dy: number; cancelled: boolean }>;

type NativePullDownViewProps = {
  style?: StyleProp<ViewStyle>;
  pullEnabled?: boolean;
  refreshing?: boolean;
  onPullMove?: (event: NativePullMoveEvent) => void;
  onPullRelease?: (event: NativePullReleaseEvent) => void;
  children?: ReactNode;
};

const hasNativeAndroidPullDownView =
  Platform.OS === 'android' &&
  typeof UIManager?.getViewManagerConfig === 'function' &&
  Boolean(UIManager.getViewManagerConfig('DFNPullDownView'));

const NativePullDownView = hasNativeAndroidPullDownView
  ? requireNativeComponent<NativePullDownViewProps>('DFNPullDownView')
  : null;

export function PullToRefreshScrollView({
  children,
  refreshing,
  onRefresh,
  scrollViewRef,
  contentContainerStyle,
  showsVerticalScrollIndicator = true,
  keyboardShouldPersistTaps = 'handled',
  scrollEventThrottle = 16,
  onTouchStart,
  onTouchEnd,
  onTouchCancel,
  onScrollBeginDrag,
  onMomentumScrollBegin,
  onScroll,
  onScrollEndDrag,
  onMomentumScrollEnd,
  headerContent,
}: {
  children: ReactNode;
  refreshing: boolean;
  onRefresh?: () => Promise<void> | void;
  scrollViewRef?: RefObject<ComponentRef<typeof NativeScrollView> | null>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  showsVerticalScrollIndicator?: boolean;
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
  scrollEventThrottle?: number;
  onTouchStart?: (e: GestureResponderEvent) => void;
  onTouchEnd?: (e: GestureResponderEvent) => void;
  onTouchCancel?: (e: GestureResponderEvent) => void;
  onScrollBeginDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onMomentumScrollBegin?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollEndDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onMomentumScrollEnd?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  headerContent?: ReactNode;
}) {
  const { palette } = useNativeAppearance();
  const [pullY] = useState(() => new Animated.Value(refreshing ? REFRESH_REST_HEIGHT : 0));
  const scrollYRef = useRef(0);
  const refreshingRef = useRef(refreshing);
  const onRefreshRef = useRef(onRefresh);
  const awaitingLocalRefreshRef = useRef(false);
  const pullTriggeredRefreshRef = useRef(false);
  const refreshErroredRef = useRef(false);
  const updatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settlingSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapseSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const dragStateRef = useRef({ pulling: false, ready: false });
  const [dragPhase, setDragPhase] = useState<DragPhase>('idle');

  const phase: PullPhase = refreshing || dragPhase === 'settling'
    ? 'refreshing'
    : dragPhase;

  const clearSafetyTimers = useCallback(() => {
    if (settlingSafetyTimerRef.current) {
      clearTimeout(settlingSafetyTimerRef.current);
      settlingSafetyTimerRef.current = null;
    }
    if (collapseSafetyTimerRef.current) {
      clearTimeout(collapseSafetyTimerRef.current);
      collapseSafetyTimerRef.current = null;
    }
  }, []);

  const collapseToIdle = useCallback(() => {
    awaitingLocalRefreshRef.current = false;
    pullTriggeredRefreshRef.current = false;
    clearSafetyTimers();
    if (updatedTimerRef.current) {
      clearTimeout(updatedTimerRef.current);
      updatedTimerRef.current = null;
    }
    const finalizeIdle = () => {
      if (collapseSafetyTimerRef.current) {
        clearTimeout(collapseSafetyTimerRef.current);
        collapseSafetyTimerRef.current = null;
      }
      if (mountedRef.current && !refreshingRef.current && !dragStateRef.current.pulling && !awaitingLocalRefreshRef.current) {
        setDragPhase('idle');
      }
    };
    collapseSafetyTimerRef.current = setTimeout(finalizeIdle, 320);
    Animated.timing(pullY, {
      toValue: 0,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      finalizeIdle();
    });
  }, [clearSafetyTimers, pullY]);

  const finishPullRefresh = useCallback(() => {
    if (awaitingLocalRefreshRef.current || refreshingRef.current) return;
    if (settlingSafetyTimerRef.current) {
      clearTimeout(settlingSafetyTimerRef.current);
      settlingSafetyTimerRef.current = null;
    }
    if (pullTriggeredRefreshRef.current && !refreshErroredRef.current) {
      pullTriggeredRefreshRef.current = false;
      if (mountedRef.current) setDragPhase('updated');
      updatedTimerRef.current = setTimeout(() => {
        updatedTimerRef.current = null;
        collapseToIdle();
      }, 450);
    } else {
      collapseToIdle();
    }
  }, [collapseToIdle]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      awaitingLocalRefreshRef.current = false;
      pullTriggeredRefreshRef.current = false;
      dragStateRef.current = { pulling: false, ready: false };
      if (updatedTimerRef.current) {
        clearTimeout(updatedTimerRef.current);
        updatedTimerRef.current = null;
      }
      clearSafetyTimers();
      pullY.stopAnimation();
    };
  }, [clearSafetyTimers, pullY]);

  useEffect(() => {
    refreshingRef.current = refreshing;
    onRefreshRef.current = onRefresh;
  }, [refreshing, onRefresh]);

  useEffect(() => {
    if (refreshing) {
      if (updatedTimerRef.current) {
        clearTimeout(updatedTimerRef.current);
        updatedTimerRef.current = null;
      }
      if (collapseSafetyTimerRef.current) {
        clearTimeout(collapseSafetyTimerRef.current);
        collapseSafetyTimerRef.current = null;
      }
      Animated.timing(pullY, {
        toValue: REFRESH_REST_HEIGHT,
        duration: 160,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (!awaitingLocalRefreshRef.current && !dragStateRef.current.pulling && !updatedTimerRef.current) {
      finishPullRefresh();
    }
  }, [refreshing, finishPullRefresh, pullY]);

  const handlePullMove = useCallback((rawDy: number) => {
    if (!onRefreshRef.current || refreshingRef.current || awaitingLocalRefreshRef.current) return;
    if (updatedTimerRef.current) {
      clearTimeout(updatedTimerRef.current);
      updatedTimerRef.current = null;
    }
    clearSafetyTimers();
    if (!dragStateRef.current.pulling) {
      dragStateRef.current = { pulling: true, ready: false };
      setDragPhase('pulling');
    }
    const damped = Math.min(MAX_PULL_DISTANCE, Math.max(0, rawDy * PULL_DAMPING));
    pullY.setValue(damped);
    const nextReady = damped >= TRIGGER_PULL_DISTANCE;
    if (nextReady !== dragStateRef.current.ready) {
      dragStateRef.current.ready = nextReady;
      setDragPhase(nextReady ? 'ready' : 'pulling');
    }
  }, [clearSafetyTimers, pullY]);

  const handlePullRelease = useCallback((rawDy?: number, cancelled = false) => {
    const computedReady =
      typeof rawDy === 'number'
        ? Math.min(MAX_PULL_DISTANCE, Math.max(0, rawDy * PULL_DAMPING)) >= TRIGGER_PULL_DISTANCE
        : dragStateRef.current.ready;
    const shouldRefresh = !cancelled && (dragStateRef.current.ready || computedReady) && Boolean(onRefreshRef.current);
    dragStateRef.current = { pulling: false, ready: false };
    if (shouldRefresh && onRefreshRef.current) {
      awaitingLocalRefreshRef.current = true;
      pullTriggeredRefreshRef.current = true;
      refreshErroredRef.current = false;
      clearSafetyTimers();
      setDragPhase('settling');
      Animated.timing(pullY, {
        toValue: REFRESH_REST_HEIGHT,
        duration: 150,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      let settled = false;
      settlingSafetyTimerRef.current = setTimeout(() => {
        settlingSafetyTimerRef.current = null;
        if (settled || !mountedRef.current) return;
        settled = true;
        refreshErroredRef.current = true;
        awaitingLocalRefreshRef.current = false;
        collapseToIdle();
      }, 18_000);
      const minDisplayMs = new Promise<void>(resolve => setTimeout(resolve, 480));
      Promise.all([
        Promise.resolve().then(() => onRefreshRef.current?.()).catch(() => {
          refreshErroredRef.current = true;
        }),
        minDisplayMs,
      ]).finally(() => {
        if (settled) return;
        settled = true;
        awaitingLocalRefreshRef.current = false;
        if (settlingSafetyTimerRef.current) {
          clearTimeout(settlingSafetyTimerRef.current);
          settlingSafetyTimerRef.current = null;
        }
        if (mountedRef.current) finishPullRefresh();
      });
    } else {
      Animated.spring(pullY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 120,
        friction: 14,
      }).start(() => {
        if (mountedRef.current && !refreshingRef.current && !dragStateRef.current.pulling && !awaitingLocalRefreshRef.current) {
          setDragPhase('idle');
        }
      });
    }
  }, [clearSafetyTimers, collapseToIdle, finishPullRefresh, pullY]);

  const gestureHandlersRef = useRef({
    canCapture: (dx: number, dy: number) =>
      !NativePullDownView &&
      Boolean(onRefreshRef.current) &&
      !refreshingRef.current &&
      !awaitingLocalRefreshRef.current &&
      scrollYRef.current <= 2 &&
      dy >= 12 &&
      dy > Math.abs(dx) * 1.4,
    onGrant: () => {
      dragStateRef.current = { pulling: true, ready: false };
      setDragPhase('pulling');
    },
    onMove: handlePullMove,
    onRelease: handlePullRelease,
  });

  useEffect(() => {
    gestureHandlersRef.current = {
      canCapture: (dx: number, dy: number) =>
        !NativePullDownView &&
        Boolean(onRefreshRef.current) &&
        !refreshingRef.current &&
        !awaitingLocalRefreshRef.current &&
        scrollYRef.current <= 2 &&
        dy >= 12 &&
        dy > Math.abs(dx) * 1.4,
      onGrant: () => {
        dragStateRef.current = { pulling: true, ready: false };
        setDragPhase('pulling');
      },
      onMove: handlePullMove,
      onRelease: handlePullRelease,
    };
  }, [handlePullMove, handlePullRelease]);

  const [panResponder, setPanResponder] = useState<ReturnType<typeof PanResponder.create> | null>(null);

  useEffect(() => {
    setPanResponder(
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_evt, gestureState) =>
          gestureHandlersRef.current.canCapture(gestureState.dx, gestureState.dy),
        onPanResponderGrant: () => {
          gestureHandlersRef.current.onGrant();
        },
        onPanResponderMove: (_evt, gestureState) => {
          gestureHandlersRef.current.onMove(gestureState.dy);
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_evt, gestureState) => {
          gestureHandlersRef.current.onRelease(gestureState.dy, false);
        },
        onPanResponderTerminate: () => {
          gestureHandlersRef.current.onRelease(0, true);
        },
      }),
    );
  }, []);

  const indicatorOpacity = pullY.interpolate({
    inputRange: [0, 14, TRIGGER_PULL_DISTANCE],
    outputRange: [0, 0.45, 1],
    extrapolate: 'clamp',
  });

  const indicatorTranslateY = pullY.interpolate({
    inputRange: [0, REFRESH_REST_HEIGHT, MAX_PULL_DISTANCE],
    outputRange: [-24, 0, 14],
    extrapolate: 'clamp',
  });

  const isHighlightedPhase = phase === 'ready' || phase === 'refreshing' || phase === 'updated';
  const indicatorText = phase === 'refreshing'
    ? 'Refreshing data...'
    : phase === 'updated'
      ? 'Data updated'
      : phase === 'ready'
        ? 'Release to refresh'
        : 'Pull down to refresh';

  const body = (
    <View style={{ flex: 1, overflow: 'hidden' }} {...(Platform.OS !== 'ios' && !NativePullDownView && onRefresh && panResponder ? panResponder.panHandlers : {})}>
      {onRefresh && Platform.OS !== 'ios' ? (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: REFRESH_REST_HEIGHT,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: indicatorOpacity,
            transform: [{ translateY: indicatorTranslateY }],
            zIndex: 2,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 999,
              backgroundColor: isHighlightedPhase ? palette.tint : palette.surface,
              borderWidth: 1,
              borderColor: isHighlightedPhase ? palette.brand : palette.border,
            }}
          >
            {phase === 'refreshing' ? (
              <ActivityIndicator size="small" color={palette.brand} />
            ) : phase === 'updated' ? (
              <AppIcon name="check" size={16} color={palette.brand} />
            ) : (
              <View style={{ transform: [{ rotate: phase === 'ready' ? '180deg' : '0deg' }] }}>
                <AppIcon name="chevronDown" size={16} color={phase === 'ready' ? palette.brand : palette.muted} />
              </View>
            )}
            <Text
              style={{
                fontSize: 13,
                fontWeight: isHighlightedPhase ? '700' : '600',
                color: isHighlightedPhase ? palette.brand : palette.muted,
              }}
            >
              {indicatorText}
            </Text>
          </View>
        </Animated.View>
      ) : null}
      <Animated.View style={Platform.OS === 'ios' ? { flex: 1 } : { flex: 1, transform: [{ translateY: pullY }] }}>
        <ScrollView
          ref={scrollViewRef}
          nestedScrollEnabled
          refreshControl={Platform.OS === 'ios' && onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={() => { void Promise.resolve().then(onRefresh).catch(() => {}); }} /> : undefined}
          contentContainerStyle={contentContainerStyle}
          showsVerticalScrollIndicator={showsVerticalScrollIndicator}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          scrollEventThrottle={scrollEventThrottle}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
          onScrollBeginDrag={onScrollBeginDrag}
          onMomentumScrollBegin={onMomentumScrollBegin}
          onScroll={event => {
            const offsetY = event.nativeEvent.contentOffset.y;
            scrollYRef.current = offsetY;
            onScroll?.(event);
          }}
          onScrollEndDrag={onScrollEndDrag}
          onMomentumScrollEnd={onMomentumScrollEnd}
        >
          {headerContent}
          {children}
        </ScrollView>
      </Animated.View>
    </View>
  );

  if (NativePullDownView && onRefresh) {
    return (
      <NativePullDownView
        style={{ flex: 1, overflow: 'hidden' }}
        pullEnabled={!refreshing}
        refreshing={refreshing}
        onPullMove={event => {
          handlePullMove(event.nativeEvent.dy);
        }}
        onPullRelease={event => {
          handlePullRelease(event.nativeEvent.dy, event.nativeEvent.cancelled);
        }}
      >
        {body}
      </NativePullDownView>
    );
  }

  return body;
}
