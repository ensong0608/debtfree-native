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
  const currency = /\p{Sc}+(?=\s*\d)/u.exec(value);
  const currencyEnd = currency ? currency.index + currency[0].length : 0;
  const numericEnd = index ?? value.length;
  return (
    <Text accessibilityLabel={value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[{ fontSize, minWidth: 0, flexShrink: 1, fontVariant: ['tabular-nums'] }, style]}>
      {currency ? <>
        {value.slice(0, currency.index)}
        <Text style={{ fontSize: fontSize * 0.72 }}>{currency[0]}</Text>
        {'\u00a0'}{value.slice(currencyEnd, numericEnd).trimStart()}
      </> : value.slice(0, numericEnd)}
      {match && index !== undefined ? <>
        <Text style={{ fontSize: fontSize * decimalScale }}>{match[0]}</Text>
        {value.slice(index + match[0].length)}
      </> : null}
    </Text>
  );
}
