import React, { createContext, forwardRef, useContext, useEffect, useRef, useState } from 'react';
import { Pressable as NativePressable, ScrollView as NativeScrollView, StyleSheet, Switch as NativeSwitch, Text as NativeText, TextInput as NativeTextInput, View as NativeView, useColorScheme, type PressableProps, type ScrollViewProps, type SwitchProps, type TextInputProps, type TextProps, type ViewProps } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { palettes, defaultAccentColor, accentActionColors, type AccentColor, type AppearancePalette, type ThemePreference } from './appearance-theme';
export type { AccentColor, AppearancePalette, ThemePreference } from './appearance-theme';

type Appearance = { isLight: boolean; isInspire: boolean; textScaling: boolean; setTextScaling: (enabled: boolean) => void; appearanceError: string | null; palette: AppearancePalette; accentColor: AccentColor; setAccentColor: (color: AccentColor) => Promise<void>; ctaBg: string; ctaFg: string };
const AppearanceContext = createContext<Appearance>({ isLight: false, isInspire: false, textScaling: true, setTextScaling: () => {}, appearanceError: null, palette: palettes[defaultAccentColor].dark, accentColor: defaultAccentColor, setAccentColor: async () => {}, ctaBg: '#0051FB', ctaFg: '#FFFFFF' });
export const useNativeAppearance = () => useContext(AppearanceContext);
const scalingKey = (id: string) => `debtfree-pref-text-scaling.${id.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

const accentKey = (id: string) => `debtfree-pref-accent.${Array.from(id).map(c => c.codePointAt(0)!.toString(16)).join('-')}`;
const accentWrites = new Map<string, Promise<void>>();

export function NativeAppearanceProvider({ themePreference, userId, children }: { themePreference: ThemePreference; userId?: string; children: React.ReactNode }) {
  const scheme = useColorScheme();
  const [scalingState, setScalingState] = useState<{ userId?: string; enabled: boolean }>({ userId, enabled: true });
  const revision = useRef(0);
  const [accentState, setAccentState] = useState<{ userId?: string; color: AccentColor }>({ userId, color: defaultAccentColor });
  const accentRevision = useRef(0);
  const [appearanceErrorState, setAppearanceErrorState] = useState<{ userId?: string; message: string | null }>({ userId, message: null });
  useEffect(() => {
    const current = ++accentRevision.current;
    let active = true;
    if (userId) void (async () => {
      await accentWrites.get(userId)?.catch(() => {});
      const value = await SecureStore.getItemAsync(accentKey(userId));
      if (active && accentRevision.current === current && (value === 'Indigo' || value === 'Cobalt')) setAccentState({ userId, color: value });
    })().catch(() => { if (active && accentRevision.current === current) setAppearanceErrorState({ userId, message: 'Unable to load accent color.' }); });
    return () => { active = false; };
  }, [userId]);
  const setAccentColor = async (color: AccentColor) => {
    if (!userId) throw new Error('Sign in to save an accent color.');
    const current = ++accentRevision.current;
    const previous = accentWrites.get(userId) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(() => SecureStore.setItemAsync(accentKey(userId), color, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }));
    accentWrites.set(userId, write);
    try {
      await write;
      if (accentRevision.current === current) {
        setAccentState({ userId, color });
        setAppearanceErrorState({ userId, message: null });
      }
    } finally { if (accentWrites.get(userId) === write) accentWrites.delete(userId); }
  };
  useEffect(() => {
    const current = ++revision.current;
    let active = true;
    if (userId) void SecureStore.getItemAsync(scalingKey(userId)).then(value => {
      if (active && revision.current === current && value !== null) setScalingState({ userId, enabled: value !== 'false' });
    }).catch(() => {});
    return () => { active = false; };
  }, [userId]);
  const setTextScaling = (enabled: boolean) => {
    revision.current++;
    setScalingState({ userId, enabled });
    if (userId) void SecureStore.setItemAsync(scalingKey(userId), String(enabled), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }).catch(() => {});
  };
  const isInspire = themePreference === 'Inspire';
  const isLight = isInspire || themePreference === 'Light' || (themePreference === 'System' && scheme === 'light');
  const textScaling = scalingState.userId === userId ? scalingState.enabled : true;
  const accentColor = accentState.userId === userId ? accentState.color : defaultAccentColor;
  const appearanceError = appearanceErrorState.userId === userId ? appearanceErrorState.message : null;
  const palette = palettes[accentColor][isInspire ? 'inspire' : isLight ? 'light' : 'dark'];
  const { bg: ctaBg, fg: ctaFg } = accentActionColors(accentColor, palette, isInspire);
  return <AppearanceContext.Provider value={{ isLight, isInspire, textScaling, setTextScaling, appearanceError, palette, accentColor, setAccentColor, ctaBg, ctaFg }}><StatusBar style={isLight ? 'dark' : 'light'} />{children}</AppearanceContext.Provider>;
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
const inspireColors: Record<string, string> = {
  ...lightColors,
  '#76dcb9':'#149E75', '#86e3b8':'#149E75', '#60a5fa':'#0A85A5', '#2dd4bf':'#0EA5C6', '#a78bfa':'#7B5CE5', '#f5c563':'#C6840C', '#f08b78':'#D9534F',
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
export function appearanceColor(color: string, isLight: boolean, accentColor: AccentColor = defaultAccentColor, isInspire = false): string {
  const key = color.toLowerCase();
  const token = neutralTokens[key];
  if (token) return palettes[accentColor][isInspire ? 'inspire' : isLight ? 'light' : 'dark'][token];
  if (isInspire) return inspireColors[key] ?? color;
  return isLight ? lightColors[key] ?? color : color;
}
function mapStyle<T>(style: T, isLight: boolean, accentColor: AccentColor, isInspire: boolean): T {
  if (!style) return style;
  const flattened = StyleSheet.flatten(style as any);
  if (!flattened) return style;
  const result: Record<string, unknown> = { ...flattened };
  for (const key of ['color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'shadowColor', 'textDecorationColor']) {
    const value = result[key];
    if (typeof value === 'string') result[key] = appearanceColor(value, isLight, accentColor, isInspire);
  }
  return result as T;
}
export const View = forwardRef<React.ComponentRef<typeof NativeView>, ViewProps>(({ style, ...props }, ref) => { const { isLight, isInspire, accentColor } = useNativeAppearance(); return <NativeView ref={ref} {...props} style={mapStyle(style, isLight, accentColor, isInspire)} />; });
View.displayName = 'NativeAppearanceView';
export const Text = forwardRef<React.ComponentRef<typeof NativeText>, TextProps>(({ style, ...props }, ref) => { const { isLight, isInspire, textScaling, accentColor } = useNativeAppearance(); return <NativeText ref={ref} {...props} allowFontScaling={textScaling} style={mapStyle(style, isLight, accentColor, isInspire)} />; });
Text.displayName = 'NativeAppearanceText';
export const TextInput = forwardRef<React.ComponentRef<typeof NativeTextInput>, TextInputProps>(({ style, placeholderTextColor, ...props }, ref) => {
  const { isLight, isInspire, textScaling, accentColor, palette } = useNativeAppearance();
  const color = typeof placeholderTextColor === 'string' ? appearanceColor(placeholderTextColor, isLight, accentColor, isInspire) : placeholderTextColor;
  const border = StyleSheet.flatten(style)?.borderColor;
  const neutralBorder = typeof border === 'string' && Boolean(neutralTokens[border.toLowerCase()]);
  return <NativeTextInput ref={ref} {...props} allowFontScaling={textScaling} placeholderTextColor={color} style={[mapStyle(style, isLight, accentColor, isInspire), neutralBorder && { borderColor: palette.inputBorder }]} />;
});
TextInput.displayName = 'NativeAppearanceTextInput';
export const Pressable = forwardRef<React.ComponentRef<typeof NativePressable>, PressableProps>(({ style, ...props }, ref) => { const { isLight, isInspire, accentColor } = useNativeAppearance(); return <NativePressable ref={ref} {...props} style={typeof style === 'function' ? state => mapStyle(style(state), isLight, accentColor, isInspire) : mapStyle(style, isLight, accentColor, isInspire)} />; });
Pressable.displayName = 'NativeAppearancePressable';
export const ScrollView = forwardRef<React.ComponentRef<typeof NativeScrollView>, ScrollViewProps>(({ style, contentContainerStyle, ...props }, ref) => { const { isLight, isInspire, accentColor } = useNativeAppearance(); return <NativeScrollView ref={ref} {...props} style={mapStyle(style, isLight, accentColor, isInspire)} contentContainerStyle={mapStyle(contentContainerStyle, isLight, accentColor, isInspire)} />; });
ScrollView.displayName = 'NativeAppearanceScrollView';
export const Switch = forwardRef<React.ComponentRef<typeof NativeSwitch>, SwitchProps>((props, ref) => { const { isLight, isInspire, accentColor } = useNativeAppearance(); return <NativeSwitch ref={ref} {...props} style={mapStyle(props.style, isLight, accentColor, isInspire)} />; });
Switch.displayName = 'NativeAppearanceSwitch';
