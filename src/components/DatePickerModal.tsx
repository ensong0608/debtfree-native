import { useState } from 'react';
import { TouchableWithoutFeedback } from 'react-native';
import { Pressable, Text, View, useNativeAppearance } from './NativeAppearance';
import { AppIcon } from './AppIcon';
import { currentHouseholdDate, parseDateOnly, type DateOnly } from '../finance/calendar';
import { ui } from './FinancialScreen';
import { AdaptiveModal } from './ModalOverlay';
import { useBottomInset, bottomInsetPadding } from './bottom-inset';

function currentPickerDate(timeZone?: string): DateOnly {
  if (timeZone) {
    try {
      return currentHouseholdDate(timeZone);
    } catch {
      // Fall back to device-local calendar date if timezone is invalid.
    }
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return parseDateOnly(`${y}-${m}-${d}`);
}

export function formatShortDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
  } catch {
    return value;
  }
}

export function CalendarDatePickerModal({
  visible,
  value,
  defaultDate,
  timeZone,
  title = 'Choose date',
  allowClear = false,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: string;
  defaultDate?: DateOnly;
  timeZone?: string;
  title?: string;
  allowClear?: boolean;
  onSelect: (value: DateOnly | '') => void;
  onClose: () => void;
}) {
  const { palette } = useNativeAppearance();
  const bottomInset = useBottomInset();
  const fallback = defaultDate ?? currentPickerDate(timeZone);
  const resolvedValue = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
  const [month, setMonth] = useState(resolvedValue.slice(0, 7));
  const [prevVisible, setPrevVisible] = useState(visible);

  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setMonth(resolvedValue.slice(0, 7));
    }
  }

  const [year, monthNum] = month.split('-').map(Number);
  const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();
  const safeMonth = Number.isFinite(monthNum) && monthNum >= 1 && monthNum <= 12 ? monthNum : new Date().getMonth() + 1;
  const monthKey = `${safeYear}-${String(safeMonth).padStart(2, '0')}`;
  const offset = new Date(safeYear, safeMonth - 1, 1).getDay();
  const count = new Date(safeYear, safeMonth, 0).getDate();
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));

  return (
    <AdaptiveModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }}>
          <TouchableWithoutFeedback>
            <View accessibilityViewIsModal style={{ backgroundColor: palette.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: palette.border, padding: 18, paddingBottom: bottomInsetPadding(bottomInset, 16) }}>
              <View style={[ui.row, { justifyContent: 'space-between', marginBottom: 8 }]}>
                <View style={{ width: 44, height: 44 }} accessible={false} />
                <Text accessibilityRole="header" style={[ui.heading, { textAlign: 'center', flex: 1 }]}>{title}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close date picker" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcon name="close" size={18} color={palette.muted} />
                </Pressable>
              </View>
              <View style={[ui.row, { justifyContent: 'space-between', marginBottom: 14 }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous month"
                  onPress={() => {
                    const previous = new Date(safeYear, safeMonth - 2, 1);
                    setMonth(`${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`);
                  }}
                  style={[ui.button, { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }]}
                >
                  <AppIcon name="chevronLeft" size={17} color={palette.brand} />
                </Pressable>
                <Text style={ui.heading}>
                  {new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(`${monthKey}-01T12:00:00`))}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next month"
                  onPress={() => {
                    const next = new Date(safeYear, safeMonth, 1);
                    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
                  }}
                  style={[ui.button, { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }]}
                >
                  <AppIcon name="chevronRight" size={17} color={palette.brand} />
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 }}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                  <Text key={`${day}-${index}`} style={[ui.small, { width: '13%', textAlign: 'center' }]}>{day}</Text>
                ))}
              </View>
              {weeks.map((week, weekIndex) => (
                <View key={`week-${weekIndex}`} style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 5 }}>
                  {week.map((day, dayIndex) => {
                    if (day === null) return <View key={`blank-${weekIndex}-${dayIndex}`} style={{ width: '13%', height: 42 }} />;
                    const dateStr = `${monthKey}-${String(day).padStart(2, '0')}`;
                    const selected = dateStr === value;
                    return (
                      <Pressable
                        key={dateStr}
                        accessibilityRole="button"
                        accessibilityLabel={dateStr}
                        accessibilityState={{ selected }}
                        onPress={() => {
                          onSelect(parseDateOnly(dateStr));
                          onClose();
                        }}
                        style={{
                          width: '13%',
                          height: 42,
                          borderRadius: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: selected ? palette.brand : 'transparent',
                        }}
                      >
                        <Text style={[ui.text, selected ? { color: palette.onBrand, fontWeight: '700' } : null]}>{day}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
              <View style={[ui.row, { justifyContent: 'center', gap: 16, marginTop: 8 }]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onSelect(currentPickerDate(timeZone));
                    onClose();
                  }}
                  style={[ui.button, { minHeight: 44, paddingHorizontal: 16 }]}
                >
                  <Text style={[ui.buttonText, { color: palette.brand }]}>Today</Text>
                </Pressable>
                {allowClear && value ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      onSelect('');
                      onClose();
                    }}
                    style={[ui.button, { minHeight: 44, paddingHorizontal: 16 }]}
                  >
                    <Text style={[ui.buttonText, { color: palette.muted }]}>Clear</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </AdaptiveModal>
  );
}

export function DueDayPickerModal({
  visible,
  value,
  title = 'Select due day',
  subtitle,
  allowClear = false,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: number | null;
  title?: string;
  subtitle?: string;
  allowClear?: boolean;
  onSelect: (day: number | null) => void;
  onClose: () => void;
}) {
  const { palette } = useNativeAppearance();
  const bottomInset = useBottomInset();
  const days: (number | null)[] = Array.from({ length: 31 }, (_, i) => i + 1);
  while (days.length % 7) days.push(null);
  const rows = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));

  return (
    <AdaptiveModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }}>
          <TouchableWithoutFeedback>
            <View accessibilityViewIsModal style={{ backgroundColor: palette.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: palette.border, padding: 18, paddingBottom: bottomInsetPadding(bottomInset, 16) }}>
              <View style={[ui.row, { justifyContent: 'space-between', marginBottom: subtitle ? 4 : 12 }]}>
                <View style={{ width: 44, height: 44 }} accessible={false} />
                <Text accessibilityRole="header" style={[ui.heading, { textAlign: 'center', flex: 1 }]}>{title}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close due day picker" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcon name="close" size={18} color={palette.muted} />
                </Pressable>
              </View>
              {subtitle ? <Text style={[ui.small, { textAlign: 'center', marginBottom: 12 }]}>{subtitle}</Text> : null}
              {rows.map((row, rIdx) => (
                <View key={`row-${rIdx}`} style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 6 }}>
                  {row.map((day, cIdx) => {
                    if (day === null) return <View key={`blank-${rIdx}-${cIdx}`} style={{ width: '13%', height: 44 }} />;
                    const selected = value === day;
                    return (
                      <Pressable
                        key={day}
                        accessibilityRole="button"
                        accessibilityLabel={`Day ${day}`}
                        accessibilityState={{ selected }}
                        onPress={() => {
                          onSelect(day);
                          onClose();
                        }}
                        style={{
                          width: '13%',
                          height: 44,
                          borderRadius: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: selected ? palette.brand : 'transparent',
                        }}
                      >
                        <Text style={[ui.text, selected ? { color: palette.onBrand, fontWeight: '700' } : null]}>{day}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
              {allowClear && value !== null ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onSelect(null);
                    onClose();
                  }}
                  style={[ui.button, { alignSelf: 'center', marginTop: 8, minHeight: 44, paddingHorizontal: 18 }]}
                >
                  <Text style={[ui.buttonText, { color: palette.muted }]}>Clear due day</Text>
                </Pressable>
              ) : null}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </AdaptiveModal>
  );
}
