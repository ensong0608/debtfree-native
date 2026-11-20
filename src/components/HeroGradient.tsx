import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useNativeAppearance } from './NativeAppearance';
import { gradientStops } from './appearance-theme';
import { InspireCornerArt, type InspireArtKind } from './InspireArt';

export function HeroGradient({ borderRadius = 0, kind, home = false }: { borderRadius?: number; kind?: InspireArtKind; home?: boolean }) {
  const { palette, isInspire } = useNativeAppearance();
  const id = `hero-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const fill = home ? palette.homeBg : palette.heroBg;
  const stops = gradientStops(fill);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        {stops.length > 0 && <Defs>
          <LinearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            {stops.map(stop => <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />)}
          </LinearGradient>
        </Defs>}
        <Rect width="100%" height="100%" fill={stops.length ? `url(#${id})` : fill} />
      </Svg>
      {isInspire && kind ? <InspireCornerArt kind={kind} borderRadius={borderRadius} /> : null}
    </View>
  );
}
