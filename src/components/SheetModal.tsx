import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, ScrollView, Text, View, useNativeAppearance } from './NativeAppearance';
import Svg, { Path } from 'react-native-svg';
import { AdaptiveModal } from './ModalOverlay';
import { bottomInsetPadding } from './bottom-inset';

/** Shared title and accessible close affordance for editable sheets and forms. */
export function SheetFormHeader({ title, subtitle, centered = false, onClose, closeLabel = 'Close form' }: {
  title: string;
  subtitle?: string;
  centered?: boolean;
  onClose: () => void;
  closeLabel?: string;
}) {
  const { palette } = useNativeAppearance();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
      {centered ? <View style={{ width: 44, height: 44 }} accessible={false} /> : null}
      <View style={{ flex: 1, alignItems: centered ? 'center' : 'flex-start' }}>
        <Text accessibilityRole="header" style={{ color: palette.text, fontSize: 18, fontWeight: '700', textAlign: centered ? 'center' : 'left' }}>{title}</Text>
        {subtitle ? <Text style={{ color: palette.muted, fontSize: 13, marginTop: 2, textAlign: centered ? 'center' : 'left' }}>{subtitle}</Text> : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} hitSlop={10} onPress={onClose}
        style={{ width: 44, height: 44, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false}><Path d="m6 6 12 12M6 18 18 6" fill="none" stroke={palette.muted} strokeWidth={1.8} strokeLinecap="round" /></Svg>
      </Pressable>
    </View>
  );
}

/** Shared theme-aware bottom-sheet frame for editable finance forms. */
export function SheetModal({ visible, onClose, children, footer, height = '92%', contentSized = false, closeLabel = 'Close form' }: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  height?: `${number}%`;
  contentSized?: boolean;
  closeLabel?: string;
}) {
  const { palette } = useNativeAppearance();
  const insets = useSafeAreaInsets();
  return (
    <AdaptiveModal visible={visible} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.62)' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} style={{ flex: 1 }} />
        <View accessibilityViewIsModal style={{ ...(contentSized ? { maxHeight: '90%' as const } : { height }), backgroundColor: palette.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' }}>
          <View accessible={false} style={{ alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: palette.border, marginTop: 8 }} />
          <ScrollView style={contentSized ? (footer ? { flexGrow: 0, flexShrink: 1, minHeight: 0 } : { flexGrow: 0 }) : footer ? { flex: 1, minHeight: 0 } : undefined} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ padding: 16, paddingBottom: footer ? 16 : bottomInsetPadding(insets.bottom, 24) }}>
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingBottom: bottomInsetPadding(insets.bottom, 4) }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </AdaptiveModal>
  );
}
