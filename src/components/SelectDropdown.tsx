import { useState } from 'react';
import {
  Modal,
  StyleSheet,
  TouchableWithoutFeedback,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Pressable, ScrollView, Text, View } from './NativeAppearance';
import { AppIcon, type AppIconName } from './AppIcon';

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
};

export function SelectDropdown<T extends string | number>({
  label,
  value,
  options,
  onSelect,
  placeholder = 'Select an option',
  style,
  sheetTitle,
}: SelectDropdownProps<T>) {
  const [modalVisible, setModalVisible] = useState(false);

  const selectedOption = options.find(opt => opt.value === value);
  const displayLabel = selectedOption ? selectedOption.label : placeholder;

  return (
    <View style={[styles.container, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label ?? 'Selection'}: ${displayLabel}`}
        onPress={() => setModalVisible(true)}
        style={({ pressed }) => [
          styles.trigger,
          modalVisible && styles.triggerActive,
          pressed && styles.triggerPressed,
        ]}
      >
        <View style={styles.triggerContent}>
          {selectedOption?.icon && (
            <AppIcon name={selectedOption.icon} size={18} color="#81DFD2" style={styles.leadingIcon} />
          )}
          <Text
            numberOfLines={1}
            style={[styles.triggerText, !selectedOption && styles.placeholderText]}
          >
            {displayLabel}
          </Text>
        </View>
        <AppIcon
          name="chevronDown"
          size={18}
          color="#81DFD2"
        />
      </Pressable>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
          <View style={styles.backdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.sheet}>
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetTitle}>
                    {sheetTitle ?? label ?? 'Select an Option'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close picker"
                    onPress={() => setModalVisible(false)}
                    style={styles.closeButton}
                  >
                    <Text style={styles.closeButtonText}>X</Text>
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
                          isSelected && styles.optionItemSelected,
                          pressed && styles.optionItemPressed,
                        ]}
                      >
                        <View style={styles.optionLeft}>
                          {option.icon && (
                            <AppIcon
                              name={option.icon}
                              size={20}
                              color={isSelected ? '#81DFD2' : '#8A9690'}
                              style={styles.optionIcon}
                            />
                          )}
                          <View style={styles.optionTextContainer}>
                            <Text
                              style={[
                                styles.optionLabel,
                                isSelected && styles.optionLabelSelected,
                              ]}
                            >
                              {option.label}
                            </Text>
                            {option.subtitle ? (
                              <Text style={styles.optionSubtitle}>{option.subtitle}</Text>
                            ) : null}
                          </View>
                        </View>
                        {isSelected ? (
                          <AppIcon name="check" size={20} color="#81DFD2" />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
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
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E2522',
    borderWidth: 1,
    borderColor: '#34403A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
  },
  triggerActive: {
    borderColor: '#81DFD2',
    backgroundColor: '#232C28',
  },
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
    backgroundColor: '#191F1C',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#313C36',
    maxHeight: '75%',
    paddingBottom: 28,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#27312C',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F9F9F6',
  },
  closeButton: {
    width: 32,
    height: 32,
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
    color: '#81DFD2',
    fontWeight: '700',
  },
  optionSubtitle: {
    fontSize: 12,
    color: '#7E8982',
    marginTop: 2,
  },
});
