import { Modal, Platform, TouchableWithoutFeedback, View } from 'react-native';
import { AppIcon, type AppIconName } from './AppIcon';
import { Pressable, Text, useNativeAppearance } from './NativeAppearance';
import { ui } from './FinancialScreen';

const AdaptiveModal =
  Platform.OS === 'web'
    ? ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
        visible ? <View style={{ position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}>{children}</View> : null
    : Modal;

export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = true,
  icon = 'warning',
  busy = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  icon?: AppIconName;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { isLight, palette, ctaBg, ctaFg } = useNativeAppearance();

  const iconBg = destructive
    ? isLight
      ? '#FEE2E2'
      : 'rgba(240, 139, 120, 0.16)'
    : palette.tint;
  const iconColor = destructive ? '#F08B78' : palette.brand;
  const confirmBg = destructive ? '#DC2626' : ctaBg;
  const confirmFg = destructive ? '#FFFFFF' : ctaFg;

  return (
    <AdaptiveModal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) onCancel(); }}>
      <TouchableWithoutFeedback onPress={() => { if (!busy) onCancel(); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <TouchableWithoutFeedback>
            <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 380, backgroundColor: palette.surface, borderRadius: 20, borderWidth: 1, borderColor: palette.border, padding: 20, gap: 14 }}>
              <View style={{ alignItems: 'center', gap: 10 }}>
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcon name={icon} size={24} color={iconColor} />
                </View>
                <Text accessibilityRole="header" style={[ui.heading, { fontSize: 18, textAlign: 'center' }]}>
                  {title}
                </Text>
                <Text style={[ui.text, { color: palette.muted, textAlign: 'center', lineHeight: 20 }]}>
                  {message}
                </Text>
              </View>
              <View style={{ gap: 8, marginTop: 2 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={confirmLabel}
                  disabled={busy}
                  onPress={onConfirm}
                  style={{ minHeight: 46, borderRadius: 12, backgroundColor: confirmBg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, opacity: busy ? 0.65 : 1 }}
                >
                  <Text style={{ color: confirmFg, fontSize: 15, fontWeight: '700' }}>
                    {busy ? 'Please wait\u2026' : confirmLabel}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={cancelLabel}
                  disabled={busy}
                  onPress={onCancel}
                  style={{ minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: isLight ? palette.canvas : palette.raised, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}
                >
                  <Text style={{ color: palette.text, fontSize: 15, fontWeight: '600' }}>{cancelLabel}</Text>
                </Pressable>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </AdaptiveModal>
  );
}
