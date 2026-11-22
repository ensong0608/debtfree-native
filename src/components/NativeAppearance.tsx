import React, { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable as NativePressable, ScrollView as NativeScrollView, StyleSheet, Switch as NativeSwitch, Text as NativeText, TextInput as NativeTextInput, View as NativeView, useColorScheme, type PressableProps, type PressableStateCallbackType, type ScrollViewProps, type SwitchProps, type TextInputProps, type TextProps, type TextStyle, type ViewProps } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import {
  appearanceStorageKeys, DEFAULT_APPEARANCE, defaultAccentColor, getAppearancePalette,
  isLightMode, resolveAppearancePreferences, type AccentColor, type AppearancePalette,
  type AppearancePreferences, type ThemeMode, type ThemeStyle,
} from './appearance-theme';
export type { AccentColor, AppearancePalette, ThemeMode, ThemeStyle } from './appearance-theme';

type Appearance = {
  isLight: boolean; isInspire: boolean; textScaling: boolean; setTextScaling: (enabled: boolean) => void;
  appearanceError: string | null; palette: AppearancePalette; themeStyle: ThemeStyle; themeMode: ThemeMode;
  accentColor: AccentColor; setAccentColor: (color: AccentColor) => Promise<void>;
  setThemeStyle: (style: ThemeStyle) => Promise<void>; setThemeMode: (mode: ThemeMode) => Promise<void>;
  ctaBg: string; ctaFg: string;
};
const initialPalette = getAppearancePalette('Fresh', defaultAccentColor, false);
const AppearanceContext = createContext<Appearance>({
  isLight: false, isInspire: false, textScaling: true, setTextScaling: () => {}, appearanceError: null,
  palette: initialPalette, themeStyle: 'Fresh', themeMode: 'System', accentColor: defaultAccentColor,
  setAccentColor: async () => {}, setThemeStyle: async () => {}, setThemeMode: async () => {},
  ctaBg: initialPalette.brand, ctaFg: initialPalette.onBrand,
});
export const useNativeAppearance = () => useContext(AppearanceContext);
const scalingKey = (id: string) => `debtfree-pref-text-scaling.${id.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
const preferenceWrites = new Map<string, Promise<AppearancePreferences>>();
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

async function loadAppearance(userId: string) {
  const keys = appearanceStorageKeys(userId);
  const [stored, legacyTheme, legacyAccent] = await Promise.all([
    SecureStore.getItemAsync(keys.preferences),
    SecureStore.getItemAsync(keys.legacyTheme),
    SecureStore.getItemAsync(keys.legacyAccent),
  ]);
  const fallbackAccent = legacyAccent ?? await SecureStore.getItemAsync(keys.legacyPlainAccent);
  return resolveAppearancePreferences(stored, legacyTheme, fallbackAccent);
}

export function NativeAppearanceProvider({ userId, children }: { userId?: string; children: React.ReactNode }) {
  const scheme = useColorScheme();
  const [scalingState, setScalingState] = useState<{ userId?: string; enabled: boolean }>({ userId, enabled: true });
  const scalingRevision = useRef(0);
  const [state, setState] = useState<{ userId?: string; preferences: AppearancePreferences }>({ userId, preferences: DEFAULT_APPEARANCE });
  const [errorState, setErrorState] = useState<{ userId?: string; message: string | null }>({ userId, message: null });
  const activeUser = useRef(userId);
  const preferenceRevision = useRef(0);

  useEffect(() => {
    activeUser.current = userId;
    let active = true;
    const revision = ++preferenceRevision.current;
    if (userId) void (async () => {
      await preferenceWrites.get(userId)?.catch(() => {});
      const preferences = await loadAppearance(userId);
      if (active && revision === preferenceRevision.current) setState({ userId, preferences });
    })().catch(() => {
      if (active && revision === preferenceRevision.current) setErrorState({ userId, message: 'Unable to load appearance settings.' });
    });
    return () => {
      active = false;
      activeUser.current = undefined;
    };
  }, [userId]);

  const updatePreferences = useCallback(async (change: Partial<AppearancePreferences>) => {
    if (!userId) throw new Error('Sign in to save appearance settings.');
    const revision = ++preferenceRevision.current;
    const queued = preferenceWrites.get(userId);
    const write = (async () => {
      const previous = await queued?.catch(() => null) ?? await loadAppearance(userId);
      const preferences = { ...previous, ...change };
      await SecureStore.setItemAsync(appearanceStorageKeys(userId).preferences, JSON.stringify(preferences), secureOptions);
      return preferences;
    })();
    preferenceWrites.set(userId, write);
    try {
      const preferences = await write;
      if (activeUser.current === userId && revision === preferenceRevision.current) {
        setState({ userId, preferences });
        setErrorState({ userId, message: null });
      }
    } catch (error) {
      if (activeUser.current === userId && revision === preferenceRevision.current) {
        const lastSaved = await loadAppearance(userId).catch(() => null);
        if (activeUser.current === userId && revision === preferenceRevision.current) {
          if (lastSaved) setState({ userId, preferences: lastSaved });
          setErrorState({ userId, message: 'Unable to save appearance settings.' });
        }
      }
      throw error;
    } finally {
      if (preferenceWrites.get(userId) === write) preferenceWrites.delete(userId);
    }
  }, [userId]);

  useEffect(() => {
    const revision = ++scalingRevision.current;
    let active = true;
    if (userId) void SecureStore.getItemAsync(scalingKey(userId)).then(value => {
      if (active && scalingRevision.current === revision) setScalingState({ userId, enabled: value !== 'false' });
    }).catch(() => {});
    return () => { active = false; };
  }, [userId]);
  const setTextScaling = useCallback((enabled: boolean) => {
    scalingRevision.current++;
    setScalingState({ userId, enabled });
    if (userId) void SecureStore.setItemAsync(scalingKey(userId), String(enabled), secureOptions).catch(() => {});
  }, [userId]);

  const setThemeStyle = useCallback((style: ThemeStyle) => updatePreferences({ style }), [updatePreferences]);
  const setThemeMode = useCallback((mode: ThemeMode) => updatePreferences({ mode }), [updatePreferences]);
  const setAccentColor = useCallback((accent: AccentColor) => updatePreferences({ accent }), [updatePreferences]);

  const { style: themeStyle, mode: themeMode, accent: accentColor } = state.userId === userId ? state.preferences : DEFAULT_APPEARANCE;
  const isInspire = themeStyle === 'Inspire';
  const isLight = isLightMode(themeMode, scheme);
  const palette = useMemo(() => getAppearancePalette(themeStyle, accentColor, isLight), [themeStyle, accentColor, isLight]);
  const appearanceError = errorState.userId === userId ? errorState.message : null;
  const textScaling = scalingState.userId === userId ? scalingState.enabled : true;
  const appearance = useMemo<Appearance>(() => ({
    themeStyle, themeMode, accentColor, isInspire, isLight, palette,
    appearanceError,
    textScaling,
    setTextScaling,
    setThemeStyle,
    setThemeMode,
    setAccentColor,
    ctaBg: palette.brand, ctaFg: palette.onBrand,
  }), [
    themeStyle, themeMode, accentColor, isInspire, isLight, palette,
    appearanceError, textScaling, setTextScaling, setThemeStyle, setThemeMode, setAccentColor,
  ]);
  return <AppearanceContext.Provider value={appearance}><StatusBar style={isLight ? 'dark' : 'light'} />{children}</AppearanceContext.Provider>;
}

// Explicit mappings keep brand and status hues meaningful while translating the dark surface palette.
const lightColors: Record<string, string> = {
  '#76dcb9':'#087d6f', '#60a5fa':'#2569be', '#2dd4bf':'#087f85', '#a78bfa':'#7d58ba', '#ec4899':'#b73d73', '#94a3b8':'#61758c',
  '#1f201f':'#f3f4f6', '#1b1e1c':'#f3f4f6', '#191f1c':'#ffffff', '#1e2522':'#ffffff', '#1e2c28':'#e6f4f0',
  '#0c0e0d':'#f4f6f5', '#141816':'#ffffff', '#121614':'#ffffff', '#191e1b':'#ffffff',
  '#222a25':'#e2e8e4', '#1c2420':'#e8efea', '#1c2721':'#d9f0e9', '#28372e':'#d1dcd6',
  '#86e3b8':'#0a8554', '#f08b78':'#c53b27', '#f5c563':'#a96d12', '#64b5f6':'#1976d2', '#ba68c8':'#7b1fa2',
  '#f1f5f2':'#111a15', '#a6b2aa':'#4f6156', '#728078':'#6f8277', '#77847d':'#6f8277',
  '#242926':'#ffffff', '#222724':'#ffffff', '#252a27':'#ffffff', '#262927':'#ffffff', '#272d2a':'#ffffff', '#292d2b':'#ffffff', '#232c28':'#ffffff', '#24302a':'#f1f5f3', '#26302b':'#f1f5f3', '#27312c':'#f1f5f3', '#28332e':'#f1f5f3', '#2b3831':'#e8f1ed',
  '#213530':'#e6f4f0', '#223632':'#e6f4f0', '#243c37':'#d9f0e9', '#263b36':'#e6f4f0', '#2e3b37':'#e3eee9', '#314541':'#dcece6', '#31534d':'#ccf0e8',
  '#24322d':'#e6f4f0', '#3b5a4f':'#ccf0e8',
  '#212623':'#f3f4f6', '#302b20':'#fff3cd', '#2d2825':'#fff0eb', '#38221e':'#ffece7',
  '#353d38':'#d1dcd6', '#353d39':'#d1dcd6', '#353a37':'#d1dcd6', '#37413b':'#d1dcd6', '#3c443f':'#d1dcd6', '#414743':'#c2d0c8', '#414a45':'#c2d0c8', '#313c36':'#d1dcd6', '#34403a':'#c2d0c8', '#3a4d43':'#b8cec3', '#323935':'#d1dcd6', '#343c37':'#d1dcd6', '#3a423e':'#d1dcd6', '#3b453f':'#d1dcd6', '#46504a':'#b8c9c0', '#47524d':'#b8c9c0', '#46786f':'#83b7a9',
  '#252721':'#f6f5ec', '#2b2921':'#faf3df', '#2f332b':'#f0f3e9', '#38321e':'#fff3cd', '#3a3324':'#fff3cd', '#3a2e1c':'#fff1d7', '#5a5332':'#d5bd76', '#6a5b37':'#d5bd76',
  '#2a2220':'#fff0eb', '#2e2624':'#fff0eb', '#342320':'#ffece7', '#3a2825':'#ffece7', '#3d2520':'#ffece7', '#5c382e':'#e5b7a8', '#664338':'#dcae9f',
  '#f9f9f6':'#182820', '#d8dfda':'#263b31', '#d4dbd7':'#263b31', '#d5ddd8':'#263b31', '#aab3ad':'#53665b', '#b5bdb7':'#53665b', '#8a9690':'#596d62', '#8e9992':'#596d62', '#7e8982':'#596d62', '#6e7571':'#596d62',
  '#81dfd2':'#087d6f', '#73d9c6':'#087d6f', '#f2c94c':'#8a6200', '#e5a93c':'#8a6200', '#e3a088':'#a34029', '#ff9367':'#a34029', '#ff7a59':'#a34029', '#ff9b82':'#a34029',
};
const neutralTokens: Record<string, keyof AppearancePalette> = {};
for (const color of ['#0c0e0d', '#1f201f', '#1b1e1c']) neutralTokens[color] = 'canvas';
for (const color of ['#141816', '#121614', '#191e1b', '#191f1c', '#1e2522', '#242926', '#222724', '#252a27', '#262927', '#272d2a', '#292d2b', '#232c28', '#212623']) neutralTokens[color] = 'surface';
for (const color of ['#24302a', '#26302b', '#27312c', '#28332e', '#1c2420']) neutralTokens[color] = 'raised';
neutralTokens['#1c2721'] = 'tint';
neutralTokens['#222a25'] = 'border';
neutralTokens['#28372e'] = 'border';
for (const color of ['#353d38', '#353d39', '#353a37', '#37413b', '#3c443f', '#414743', '#414a45', '#323935', '#343c37', '#3a423e', '#3b453f']) neutralTokens[color] = 'border';
for (const color of ['#f1f5f2', '#f9f9f6', '#d8dfda', '#d4dbd7', '#d5ddd8']) neutralTokens[color] = 'text';
for (const color of ['#a6b2aa', '#728078', '#77847d', '#aab3ad', '#b5bdb7', '#8a9690', '#8e9992', '#7e8982', '#6e7571']) neutralTokens[color] = 'muted';
const COLOR_STYLE_KEYS = [
  'color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderBottomColor',
  'borderLeftColor', 'borderRightColor', 'shadowColor', 'textDecorationColor',
] as const;
type MappedStyleEntry = { mapped: unknown; flattened: Record<string, unknown> | undefined };
const mappedStyleIdCaches = new Map<string, Map<number, MappedStyleEntry>>();
function getMappedStyleIdCache(isLight: boolean, isInspire: boolean, accentColor: AccentColor): Map<number, MappedStyleEntry> {
  const key = `${isLight ? 1 : 0}:${isInspire ? 1 : 0}:${accentColor}`;
  let cache = mappedStyleIdCaches.get(key);
  if (!cache) {
    cache = new Map<number, MappedStyleEntry>();
    mappedStyleIdCaches.set(key, cache);
  }
  return cache;
}
function resolveAppearanceColor(color: string, isLight: boolean, palette: AppearancePalette): string {
  const key = color.toLowerCase();
  const token = neutralTokens[key];
  if (token) return palette[token];
  if (key === '#86e3b8') return palette.posInk;
  if (key === '#f08b78') return palette.neg;
  return isLight ? lightColors[key] ?? color : color;
}
export function appearanceColor(color: string, isLight: boolean, accentColor: AccentColor = defaultAccentColor, isInspire = false): string {
  const palette = getAppearancePalette(isInspire ? 'Inspire' : 'Fresh', accentColor, isLight);
  return resolveAppearanceColor(color, isLight, palette);
}
function remapFlattenedStyle<T>(style: T, isLight: boolean, palette: AppearancePalette): MappedStyleEntry {
  const flattened = StyleSheet.flatten(style as any) as Record<string, unknown> | undefined;
  if (!flattened) return { mapped: style, flattened: undefined };
  let cloned: Record<string, unknown> | null = null;
  for (let i = 0; i < COLOR_STYLE_KEYS.length; i += 1) {
    const key = COLOR_STYLE_KEYS[i];
    const value = flattened[key];
    if (typeof value === 'string') {
      const mapped = resolveAppearanceColor(value, isLight, palette);
      if (mapped !== value) {
        if (!cloned) cloned = { ...flattened };
        cloned[key] = mapped;
      }
    }
  }
  return { mapped: (cloned ?? style) as T, flattened };
}
function mapStyleDetails<T>(
  style: T,
  isLight: boolean,
  accentColor: AccentColor,
  isInspire: boolean,
  palette: AppearancePalette,
): { mapped: T; flattened: Record<string, unknown> | undefined } {
  if (!style) return { mapped: style, flattened: undefined };
  if (typeof style === 'number') {
    const cache = getMappedStyleIdCache(isLight, isInspire, accentColor);
    const cached = cache.get(style);
    if (cached) return cached as { mapped: T; flattened: Record<string, unknown> | undefined };
    const entry = remapFlattenedStyle(style, isLight, palette);
    cache.set(style, entry);
    return entry as { mapped: T; flattened: Record<string, unknown> | undefined };
  }
  return remapFlattenedStyle(style, isLight, palette) as { mapped: T; flattened: Record<string, unknown> | undefined };
}
function mapStyle<T>(
  style: T,
  isLight: boolean,
  accentColor: AccentColor,
  isInspire: boolean,
  palette: AppearancePalette,
): T {
  return mapStyleDetails(style, isLight, accentColor, isInspire, palette).mapped;
}
export const View = forwardRef<React.ComponentRef<typeof NativeView>, ViewProps>(({ style, ...props }, ref) => { const { isLight, isInspire, accentColor, palette } = useNativeAppearance(); return <NativeView ref={ref} {...props} style={mapStyle(style, isLight, accentColor, isInspire, palette)} />; });
View.displayName = 'NativeAppearanceView';
type FontWeight = 'regular' | 'medium' | 'bold';
const InheritedFontWeight = createContext<FontWeight>('regular');
function montserratStyleFromFlattened(flattened: TextStyle | undefined, inherited: FontWeight) {
  const weight = flattened?.fontWeight;
  const numeric = weight === 'bold' ? 700 : weight === 'normal' ? 400 : Number(weight);
  const resolved: FontWeight = weight == null ? inherited : numeric >= 600 ? 'bold' : numeric >= 500 ? 'medium' : 'regular';
  const family = resolved === 'bold' ? 'Montserrat_700Bold' : resolved === 'medium' ? 'Montserrat_500Medium' : 'Montserrat_400Regular';
  return { resolved, style: flattened?.fontFamily ? { fontFamily: flattened.fontFamily, fontWeight: weight } : { fontFamily: family, fontWeight: 'normal' as const } };
}
function hasNestedElements(children: React.ReactNode): boolean {
  if (children == null || typeof children === 'string' || typeof children === 'number' || typeof children === 'boolean') return false;
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i += 1) {
      const item = children[i];
      if (item != null && typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') return true;
    }
    return false;
  }
  return true;
}
function resolveFontTextProps(
  inherited: FontWeight,
  flattened: TextStyle | undefined,
  children: React.ReactNode,
) {
  const font = montserratStyleFromFlattened(flattened, inherited);
  const wrapChildren = font.resolved !== inherited && hasNestedElements(children);
  return { font, wrapChildren };
}
export const FontText = forwardRef<React.ComponentRef<typeof NativeText>, TextProps>(({ style, children, ...props }, ref) => {
  const inherited = useContext(InheritedFontWeight);
  const flattened = style ? (StyleSheet.flatten(style) as TextStyle | undefined) : undefined;
  const { font, wrapChildren } = resolveFontTextProps(inherited, flattened, children);
  return (
    <NativeText ref={ref} {...props} style={[style, font.style]}>
      {wrapChildren ? <InheritedFontWeight.Provider value={font.resolved}>{children}</InheritedFontWeight.Provider> : children}
    </NativeText>
  );
});
FontText.displayName = 'MontserratText';
export const Text = forwardRef<React.ComponentRef<typeof NativeText>, TextProps>(({ style, children, ...props }, ref) => {
  const { isLight, isInspire, textScaling, accentColor, palette } = useNativeAppearance();
  const { mapped, flattened } = mapStyleDetails(style, isLight, accentColor, isInspire, palette);
  const inherited = useContext(InheritedFontWeight);
  const { font, wrapChildren } = resolveFontTextProps(inherited, flattened as TextStyle | undefined, children);
  return (
    <NativeText ref={ref} {...props} allowFontScaling={textScaling} style={[mapped, font.style]}>
      {wrapChildren ? <InheritedFontWeight.Provider value={font.resolved}>{children}</InheritedFontWeight.Provider> : children}
    </NativeText>
  );
});
Text.displayName = 'NativeAppearanceText';
export const TextInput = forwardRef<React.ComponentRef<typeof NativeTextInput>, TextInputProps>(({ style, placeholderTextColor, ...props }, ref) => {
  const { isLight, isInspire, textScaling, accentColor, palette } = useNativeAppearance();
  const color = typeof placeholderTextColor === 'string' ? resolveAppearanceColor(placeholderTextColor, isLight, palette) : placeholderTextColor;
  const { mapped, flattened } = mapStyleDetails(style, isLight, accentColor, isInspire, palette);
  const border = flattened?.borderColor;
  const neutralBorder = typeof border === 'string' && Boolean(neutralTokens[border.toLowerCase()]);
  const font = montserratStyleFromFlattened(flattened as TextStyle | undefined, 'regular');
  return <NativeTextInput ref={ref} {...props} allowFontScaling={textScaling} placeholderTextColor={color} style={[mapped, neutralBorder && { borderColor: palette.inputBorder }, font.style]} />;
});
TextInput.displayName = 'NativeAppearanceTextInput';
export const Pressable = forwardRef<React.ComponentRef<typeof NativePressable>, PressableProps>(({ style, ...props }, ref) => { const { isLight, isInspire, accentColor, palette } = useNativeAppearance(); return <NativePressable ref={ref} {...props} style={typeof style === 'function' ? (state: PressableStateCallbackType) => mapStyle(style(state), isLight, accentColor, isInspire, palette) : mapStyle(style, isLight, accentColor, isInspire, palette)} />; });
Pressable.displayName = 'NativeAppearancePressable';
export const ScrollView = forwardRef<React.ComponentRef<typeof NativeScrollView>, ScrollViewProps>(({ style, contentContainerStyle, ...props }, ref) => { const { isLight, isInspire, accentColor, palette } = useNativeAppearance(); return <NativeScrollView ref={ref} {...props} style={mapStyle(style, isLight, accentColor, isInspire, palette)} contentContainerStyle={mapStyle(contentContainerStyle, isLight, accentColor, isInspire, palette)} />; });
ScrollView.displayName = 'NativeAppearanceScrollView';
export const Switch = forwardRef<React.ComponentRef<typeof NativeSwitch>, SwitchProps>((props, ref) => { const { isLight, isInspire, accentColor, palette } = useNativeAppearance(); return <NativeSwitch ref={ref} {...props} style={mapStyle(props.style, isLight, accentColor, isInspire, palette)} />; });
Switch.displayName = 'NativeAppearanceSwitch';
