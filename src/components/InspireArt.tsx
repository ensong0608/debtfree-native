import { useId } from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Text, useNativeAppearance } from './NativeAppearance';
import { getInspireQuote, type InspireQuoteSlot } from './inspire-quotes';
import { cornerArtworkSvg, horizonSvg, phoneBackdropSvg, type InspireArtKind } from './inspire-scenes';
export type { InspireArtKind } from './inspire-scenes';

function Artwork({ xml, borderRadius = 0 }: { xml: string; borderRadius?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const scopedXml = xml.replace(/id="([^"]+)"/g, `id="${id}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#${id}-$1)`);
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]}>
      <SvgXml xml={scopedXml} width="100%" height="100%" />
    </View>
  );
}

export function InspireHorizonBackground({ borderRadius = 18 }: { borderRadius?: number }) {
  const { palette, isLight, isInspire } = useNativeAppearance();
  return isInspire ? <Artwork xml={horizonSvg(palette, !isLight)} borderRadius={borderRadius} /> : null;
}

export function InspireBackdrop() {
  const { palette, isLight, isInspire } = useNativeAppearance();
  return isInspire ? <Artwork xml={phoneBackdropSvg(palette, !isLight)} /> : null;
}

export function InspireCornerArt({ kind, borderRadius = 16 }: { kind: InspireArtKind; borderRadius?: number }) {
  const { palette, isLight, isInspire } = useNativeAppearance();
  return isInspire ? <Artwork xml={cornerArtworkSvg(kind, palette, !isLight)} borderRadius={borderRadius} /> : null;
}

export function InspireQuote({
  slot,
  cycleOffset = 0,
  tiltDeg = 0,
  color,
  style,
}: {
  slot: InspireQuoteSlot;
  cycleOffset?: number;
  tiltDeg?: number;
  color?: string;
  style?: TextStyle | TextStyle[];
}) {
  const { isInspire, palette } = useNativeAppearance();
  if (!isInspire) return null;
  return (
    <Text style={[{
      color: color ?? palette.quoteInk,
      fontSize: 12.5,
      fontStyle: 'italic',
      fontWeight: '600',
      lineHeight: 17,
      ...(tiltDeg ? { transform: [{ rotate: `${tiltDeg}deg` }] } : {}),
    }, style]}>
      {getInspireQuote(slot, cycleOffset)}
    </Text>
  );
}
