import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { Text } from './NativeAppearance';

type AmountTextProps = { value: string; style?: StyleProp<TextStyle>; decimalScale?: number };

export function AmountText({ value, style, decimalScale = 0.65 }: AmountTextProps) {
  const fontSize = StyleSheet.flatten(style)?.fontSize ?? 17;
  // The app formatter uses a period; also accept locale-formatted comma fractions.
  const localeDecimal = new Intl.NumberFormat().format(1.1).replace(/[0-9]/g, '');
  const separator = value.includes('.') && value.includes(',')
    ? (value.lastIndexOf('.') > value.lastIndexOf(',') ? '.' : ',')
    : value.includes('.') ? '.' : localeDecimal === ',' ? ',' : '.';
  const pattern = separator === '.' ? /(\.\d+)(?=\D*$)/ : /(,\d{1,2})(?=\D*$)/;
  const match = value.match(pattern);
  const index = match?.index;
  return (
    <Text accessibilityLabel={value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[{ fontSize, minWidth: 0, flexShrink: 1, fontVariant: ['tabular-nums'] }, style]}>
      {!match || index === undefined ? value : <>{value.slice(0, index)}<Text style={{ fontSize: fontSize * decimalScale }}>{match[0]}</Text>{value.slice(index + match[0].length)}</>}
    </Text>
  );
}
