import type { ReactNode } from 'react';
import { Modal } from 'react-native';
import { Pressable, ScrollView, Text, View } from './NativeAppearance';

/** Shared title and accessible close affordance for editable sheets and forms. */
export function SheetFormHeader({ title, onClose, closeLabel = 'Close form' }: {
  title: string;
  onClose: () => void;
  closeLabel?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
      <Text accessibilityRole="header" style={{ color: '#F9F9F6', fontSize: 17, fontWeight: '700', flex: 1 }}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} hitSlop={10} onPress={onClose}
        style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#353D39' }}>
        <Text style={{ color: '#F9F9F6', fontSize: 20, lineHeight: 24, fontWeight: '600' }}>×</Text>
      </Pressable>
    </View>
  );
}

/** Shared theme-aware bottom-sheet frame for editable finance forms. */
export function SheetModal({ visible, onClose, children, height = '92%' }: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  height?: `${number}%`;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.62)' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close form" onPress={onClose} style={{ flex: 1 }} />
        <View accessibilityViewIsModal style={{ height, backgroundColor: '#1F201F', borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
