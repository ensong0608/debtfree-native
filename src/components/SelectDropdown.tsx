import { useState } from 'react';
import {
  Keyboard,
  StyleSheet,
  TouchableWithoutFeedback,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Pressable, ScrollView, Text, View, useNativeAppearance } from './NativeAppearance';
import { AppIcon, type AppIconName } from './AppIcon';
import Svg, { Path } from 'react-native-svg';
import { AdaptiveModal } from './ModalOverlay';
import { useBottomInset, bottomInsetPadding } from './bottom-inset';

export type DropdownOption<T extends string | number> = {
  value: T;
  label: string;
  subtitle?: string;
  icon?: AppIconName;
};

export type SelectDropdownProps<T extends string | number> = {
  label?: string;
  value: T;
  options: readonly DropdownOption<T>[];
  onSelect: (value: T) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  sheetTitle?: string;
  compact?: boolean;
  embedded?: boolean;
  triggerLabel?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
};

export function SelectDropdown<T extends string | number>({
  label,
  value,
  options,
  onSelect,
  placeholder = 'Select an option',
  style,
  sheetTitle,
  compact = false,
  embedded = false,
  triggerLabel,
  accessibilityLabel,
  disabled = false,
}: SelectDropdownProps<T>) {
  const { palette } = useNativeAppearance();
  const bottomInset = useBottomInset();
  const [modalVisible, setModalVisible] = useState(false);

  const selectedOption = options.find(opt => opt.value === value);
  const displayLabel = selectedOption ? selectedOption.label : placeholder;

  return (
    <View style={[styles.container, style]}>
      {label ? <Text style={[styles.label, { color: palette.muted }]}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel ?? label ?? 'Selection'}: ${displayLabel}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={compact ? { top: 4, bottom: 4 } : undefined}
        onPress={() => {
          if (disabled) return;
          Keyboard.dismiss();
          setModalVisible(true);
        }}
        style={({ pressed }) => [
          styles.trigger,
          { backgroundColor: palette.raised, borderColor: palette.inputBorder },
          compact && styles.compactTrigger,
          compact && { borderColor: palette.border, backgroundColor: palette.surface },
          embedded && { borderWidth: 0, borderRadius: 0, backgroundColor: 'transparent' },
          modalVisible && { borderColor: palette.brand, backgroundColor: palette.tint },
          pressed && !disabled && { backgroundColor: palette.tint },
          disabled && { opacity: 0.6 },
        ]}
      >
        <View style={styles.triggerContent}>
          {!compact && selectedOption?.icon && (
            <AppIcon name={selectedOption.icon} size={18} color={palette.brand} style={styles.leadingIcon} />
          )}
          <Text
            numberOfLines={1}
            style={[styles.triggerText, { color: selectedOption ? palette.text : palette.muted }, compact && styles.compactText]}
          >
            {triggerLabel ?? displayLabel}
          </Text>
        </View>
        {!disabled ? (
          <AppIcon
            name="chevronDown"
            size={compact ? 14 : 18}
            color={palette.brand}
          />
        ) : null}
      </Pressable>

      <AdaptiveModal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
          <View style={styles.backdrop}>
            <TouchableWithoutFeedback>
              <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border, paddingBottom: bottomInsetPadding(bottomInset, 16) }]}>
                <View style={[styles.sheetHeader, { borderBottomColor: palette.border }]}>
                  <Text style={[styles.sheetTitle, { color: palette.text }]}>
                    {sheetTitle ?? label ?? 'Select an Option'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close picker"
                    onPress={() => setModalVisible(false)}
                    style={[styles.closeButton, { backgroundColor: 'transparent' }]}
                  >
                    <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false}><Path d="m6 6 12 12M6 18 18 6" stroke={palette.muted} strokeWidth={1.8} strokeLinecap="round" /></Svg>
                  </Pressable>
                </View>

                <ScrollView
                  style={styles.sheetScroll}
                  contentContainerStyle={styles.sheetScrollContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {options.map(option => {
                    const isSelected = option.value === value;
                    return (
                      <Pressable
                        key={String(option.value)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        onPress={() => {
                          onSelect(option.value);
                          setModalVisible(false);
                        }}
                        style={({ pressed }) => [
                          styles.optionItem,
                          isSelected && { backgroundColor: palette.tint, borderWidth: 1, borderColor: palette.border },
                          pressed && { backgroundColor: palette.tint },
                        ]}
                      >
                        <View style={styles.optionLeft}>
                          {option.icon && (
                            <AppIcon
                              name={option.icon}
                              size={20}
                              color={isSelected ? palette.brand : palette.muted}
                              style={styles.optionIcon}
                            />
                          )}
                          <View style={styles.optionTextContainer}>
                            <Text
                              style={[
                                styles.optionLabel,
                                { color: isSelected ? palette.brand : palette.text },
                              ]}
                            >
                              {option.label}
                            </Text>
                            {option.subtitle ? (
                              <Text style={[styles.optionSubtitle, { color: palette.muted }]}>{option.subtitle}</Text>
                            ) : null}
                          </View>
                        </View>
                        {isSelected ? (
                          <AppIcon name="check" size={20} color={palette.brand} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </AdaptiveModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#D8DFDA',
    marginBottom: 6,
    textTransform: 'none',
    letterSpacing: 0,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#191E1B',
    borderWidth: 1,
    borderColor: '#222A25',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
  },
  triggerActive: {
    borderColor: '#76DCB9',
    backgroundColor: '#1C2721',
  },
  compactTrigger: {
    backgroundColor: 'transparent',
    borderColor: '#353D38',
    borderRadius: 9,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  compactText: { fontSize: 13, fontWeight: '600' },
  triggerPressed: {
    backgroundColor: '#26302B',
  },
  triggerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  leadingIcon: {
    marginRight: 10,
  },
  triggerText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#F9F9F6',
    flex: 1,
  },
  placeholderText: {
    color: '#7E8982',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#141816',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#222A25',
    maxHeight: '75%',
    paddingBottom: 0,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#222A25',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F9F9F6',
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: '#28332E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: '#AAB3AD',
    fontSize: 15,
    fontWeight: '700',
  },
  sheetScroll: {
    maxHeight: 400,
  },
  sheetScrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    marginVertical: 3,
    backgroundColor: 'transparent',
  },
  optionItemSelected: {
    backgroundColor: '#24302A',
    borderWidth: 1,
    borderColor: '#3A4D43',
  },
  optionItemPressed: {
    backgroundColor: '#2B3831',
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  optionIcon: {
    marginRight: 12,
  },
  optionTextContainer: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#D8DFDA',
  },
  optionLabelSelected: {
    color: '#76DCB9',
    fontWeight: '700',
  },
  optionSubtitle: {
    fontSize: 12,
    color: '#7E8982',
    marginTop: 2,
  },
});
