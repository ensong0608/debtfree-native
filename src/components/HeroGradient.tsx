import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useNativeAppearance } from './NativeAppearance';

export function HeroGradient({ borderRadius = 0 }: { borderRadius?: number }) {
  const { isLight, isInspire, accentColor } = useNativeAppearance();
  const rawId = useId();
  const gradId = `heroGrad_${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const stops = isInspire
    ? [
        { offset: '0%', color: '#087A9B' },
        { offset: '55%', color: '#0D9DBB' },
        { offset: '100%', color: '#18B39A' },
      ]
    : accentColor === 'Cobalt'
      ? isLight
        ? [
            { offset: '0%', color: '#070D5B' },
            { offset: '52%', color: '#0033B8' },
            { offset: '100%', color: '#0051FB' },
          ]
        : [
            { offset: '0%', color: '#0B1538' },
            { offset: '55%', color: '#122D73' },
            { offset: '100%', color: '#0F379E' },
          ]
      : [
          { offset: '0%', color: '#282443' },
          { offset: '100%', color: '#3A3268' },
        ];

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            {stops.map(stop => (
              <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity="1" />
            ))}
          </LinearGradient>
        </Defs>
        <Rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          rx={borderRadius}
          ry={borderRadius}
          fill={`url(#${gradId})`}
        />
      </Svg>
    </View>
  );
}
