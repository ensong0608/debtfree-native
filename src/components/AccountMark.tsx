import { Image } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Text, View, useNativeAppearance } from './NativeAppearance';
import { accountMarkArtwork, resolveAccountMarkArtwork } from './institution-logos';

export function AccountMark({ name, category, size = 36 }: { name: string; category?: string; size?: number }) {
  const { palette } = useNativeAppearance();
  const artworkKey = resolveAccountMarkArtwork(name, category);
  const artwork = artworkKey ? accountMarkArtwork[artworkKey] : undefined;
  if (typeof artwork === 'string') {
    return <SvgXml xml={artwork} width={size} height={size} accessible={false} />;
  }
  if (artwork) {
    return (
      <View accessible={false} style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: '#FFFFFF', borderColor: '#D6DEE8', borderWidth: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Image accessible={false} source={artwork.source} style={{ width: size * 0.65, height: size * 0.65 }} resizeMode="contain" />
      </View>
    );
  }
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase();
  return (
    <View accessible={false} style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: palette.tint, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: palette.accentInk, fontSize: size / 3, fontWeight: '800' }}>{initials}</Text>
    </View>
  );
}
