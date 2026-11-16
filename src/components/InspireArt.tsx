import { useId } from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Text, useNativeAppearance } from './NativeAppearance';
import { getInspireQuote, type InspireQuoteSlot } from './inspire-quotes';

/** Scenic aqua-mint mountain & sun artwork for the Home Debt-Free Date Hero card in Inspire mode. */
export function InspireHorizonBackground({ borderRadius = 18 }: { borderRadius?: number }) {
  const rawId = useId();
  const skyId = `inspireSky_${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const sunId = `inspireSun_${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]}>
      <Svg width="100%" height="100%" viewBox="0 0 360 190" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id={skyId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#D7F4F6" />
            <Stop offset="55%" stopColor="#ECFCFA" />
            <Stop offset="100%" stopColor="#CFF1EE" />
          </LinearGradient>
          <LinearGradient id={sunId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#FFE69C" />
            <Stop offset="100%" stopColor="#FFD269" />
          </LinearGradient>
        </Defs>

        <Rect width="360" height="190" fill={`url(#${skyId})`} />
        <Circle cx="308" cy="70" r="50" fill="#FFE69C" opacity="0.28" />
        <Circle cx="308" cy="70" r="31" fill={`url(#${sunId})`} opacity="0.88" />
        <Ellipse cx="96" cy="40" rx="34" ry="10" fill="#FFFFFF" opacity="0.58" />
        <Ellipse cx="212" cy="28" rx="44" ry="11" fill="#FFFFFF" opacity="0.45" />

        {/* Layered coastal mountains */}
        <Path d="M128 148 L195 72 L248 118 L294 86 L360 148 Z" fill="#A8DCE8" opacity="0.82" />
        <Path d="M174 150 L226 92 L268 128 L315 102 L360 150 Z" fill="#78C5E4" opacity="0.65" />
        <Path d="M236 150 L276 112 L318 140 L345 120 L360 150 Z" fill="#4AA8CD" opacity="0.45" />

        {/* Tranquil water & sand shore */}
        <Rect x="0" y="146" width="360" height="24" fill="#8CDEDC" opacity="0.72" />
        <Path d="M0 164 Q90 158 190 163 T360 161 L360 190 L0 190 Z" fill="#E3D99D" opacity="0.72" />

        {/* Soft pine silhouettes */}
        <Path d="M312 152 l6-18 6 18 z M324 153 l5-14 5 14 z M296 154 l4-12 4 12 z" fill="#137E78" opacity="0.72" />
      </Svg>
    </View>
  );
}

/** Real editable & rotating encouraging text, visible strictly in the Inspire theme. */
export function InspireQuote({
  slot,
  cycleOffset = 0,
  tiltDeg = 0,
  color = '#0B89A8',
  style,
}: {
  slot: InspireQuoteSlot;
  cycleOffset?: number;
  tiltDeg?: number;
  color?: string;
  style?: TextStyle | TextStyle[];
}) {
  const { isInspire } = useNativeAppearance();
  if (!isInspire) return null;

  const text = getInspireQuote(slot, cycleOffset);
  return (
    <Text
      style={[
        {
          color,
          fontSize: 12.5,
          fontStyle: 'italic',
          fontWeight: '600',
          lineHeight: 17,
          ...(tiltDeg ? { transform: [{ rotate: `${tiltDeg}deg` }] } : {}),
        },
        style,
      ]}
    >
      {text}
    </Text>
  );
}
