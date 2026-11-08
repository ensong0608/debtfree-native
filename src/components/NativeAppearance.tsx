import React, { createContext, forwardRef, useContext, useEffect, useRef, useState } from 'react';
import { Pressable as NativePressable, ScrollView as NativeScrollView, StyleSheet, Switch as NativeSwitch, Text as NativeText, TextInput as NativeTextInput, View as NativeView, useColorScheme, type PressableProps, type ScrollViewProps, type SwitchProps, type TextInputProps, type TextProps, type ViewProps } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';

type ThemePreference = 'System' | 'Dark' | 'Light';
type Appearance = { isLight: boolean; textScaling: boolean; setTextScaling: (enabled: boolean) => void };
const AppearanceContext = createContext<Appearance>({ isLight: false, textScaling: true, setTextScaling: () => {} });
export const useNativeAppearance = () => useContext(AppearanceContext);
const scalingKey = (id: string) => `debtfree-pref-text-scaling.${id.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

export function NativeAppearanceProvider({ themePreference, userId, children }: { themePreference: ThemePreference; userId?: string; children: React.ReactNode }) {
  const scheme = useColorScheme();
  const [textScaling, setScaling] = useState(true);
  const revision = useRef(0);
  useEffect(() => {
    const current = ++revision.current;
    setScaling(true);
    if (userId) void SecureStore.getItemAsync(scalingKey(userId)).then(value => {
      if (revision.current === current && value !== null) setScaling(value !== 'false');
    }).catch(() => {});
    return () => { revision.current++; };
  }, [userId]);
  const setTextScaling = (enabled: boolean) => {
    revision.current++;
    setScaling(enabled);
    if (userId) void SecureStore.setItemAsync(scalingKey(userId), String(enabled), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }).catch(() => {});
  };
  const isLight = themePreference === 'Light' || (themePreference === 'System' && scheme === 'light');
  return <AppearanceContext.Provider value={{ isLight, textScaling, setTextScaling }}><StatusBar style={isLight ? 'dark' : 'light'} />{children}</AppearanceContext.Provider>;
}

// Explicit mappings keep brand and status hues meaningful while translating the dark surface palette.
const lightColors: Record<string, string> = {
  '#1f201f':'#f3f4f6', '#1b1e1c':'#f3f4f6', '#191f1c':'#ffffff', '#1e2522':'#ffffff', '#1e2c28':'#e6f4f0',
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
export function appearanceColor(color: string, isLight: boolean): string {
  return isLight ? lightColors[color.toLowerCase()] ?? color : color;
}
function mapStyle<T>(style: T, isLight: boolean): T {
  if (!isLight || !style) return style;
  const flattened = StyleSheet.flatten(style as any);
  if (!flattened) return style;
  const result: Record<string, unknown> = { ...flattened };
  for (const key of ['color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'shadowColor', 'textDecorationColor']) {
    const value = result[key];
    if (typeof value === 'string') result[key] = lightColors[value.toLowerCase()] ?? value;
  }
  return result as T;
}
export const View = forwardRef<React.ComponentRef<typeof NativeView>, ViewProps>(({ style, ...props }, ref) => { const { isLight } = useNativeAppearance(); return <NativeView ref={ref} {...props} style={mapStyle(style, isLight)} />; });
export const Text = forwardRef<React.ComponentRef<typeof NativeText>, TextProps>(({ style, ...props }, ref) => { const { isLight, textScaling } = useNativeAppearance(); return <NativeText ref={ref} {...props} allowFontScaling={textScaling} style={mapStyle(style, isLight)} />; });
export const TextInput = forwardRef<React.ComponentRef<typeof NativeTextInput>, TextInputProps>(({ style, placeholderTextColor, ...props }, ref) => { const { isLight, textScaling } = useNativeAppearance(); const color = typeof placeholderTextColor === 'string' && isLight ? lightColors[placeholderTextColor.toLowerCase()] ?? placeholderTextColor : placeholderTextColor; return <NativeTextInput ref={ref} {...props} allowFontScaling={textScaling} placeholderTextColor={color} style={mapStyle(style, isLight)} />; });
export const Pressable = forwardRef<React.ComponentRef<typeof NativePressable>, PressableProps>(({ style, ...props }, ref) => { const { isLight } = useNativeAppearance(); return <NativePressable ref={ref} {...props} style={typeof style === 'function' ? state => mapStyle(style(state), isLight) : mapStyle(style, isLight)} />; });
export const ScrollView = forwardRef<React.ComponentRef<typeof NativeScrollView>, ScrollViewProps>(({ style, contentContainerStyle, ...props }, ref) => { const { isLight } = useNativeAppearance(); return <NativeScrollView ref={ref} {...props} style={mapStyle(style, isLight)} contentContainerStyle={mapStyle(contentContainerStyle, isLight)} />; });
export const Switch = forwardRef<React.ComponentRef<typeof NativeSwitch>, SwitchProps>((props, ref) => { const { isLight } = useNativeAppearance(); return <NativeSwitch ref={ref} {...props} style={mapStyle(props.style, isLight)} />; });
