import React, { useState, useEffect, useRef, type ReactNode } from 'react';
import { Pressable, Text, View, useNativeAppearance } from './NativeAppearance';
import { AppIcon } from './AppIcon';
import { SheetModal } from './SheetModal';

export function InformationSheet({ visible, onClose, title, detail }: { visible: boolean; onClose: () => void; title: string; detail: string }) {
  const { palette } = useNativeAppearance();
  return <SheetModal visible={visible} onClose={onClose} contentSized closeLabel="Close information">
    <View style={{ gap: 16, paddingTop: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 15, backgroundColor: palette.tint, alignItems: 'center', justifyContent: 'center' }}><AppIcon name="info" size={22} color={palette.brand} /></View>
        <Text accessibilityRole="header" style={{ flex: 1, color: palette.text, fontSize: 20, fontWeight: '700' }}>{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close information" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><AppIcon name="close" size={20} color={palette.muted} /></Pressable>
      </View>
      <View style={{ gap: 16 }}>{detail.split(/\n\n+/).map((paragraph, index) => {
        const [heading, ...body] = paragraph.split('\n');
        return <View key={index} style={{ gap: 5 }}>
          {body.length ? <Text style={{ color: palette.text, fontSize: 14, fontWeight: '700' }}>{heading}</Text> : null}
          <Text style={{ color: palette.text, fontSize: 15, lineHeight: 23 }}>{body.length ? body.join('\n') : heading}</Text>
        </View>;
      })}</View>
      <Pressable accessibilityRole="button" onPress={onClose} style={{ minHeight: 48, borderRadius: 14, backgroundColor: palette.brand, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: palette.onBrand, fontWeight: '700', fontSize: 15 }}>Close</Text></Pressable>
    </View>
  </SheetModal>;
}

export function useInformationSheet(): { showInformation: (title: string, detail: string) => void; informationSheet: ReactNode; isOpen: boolean } {
  const [content, setContent] = useState<{ title: string; detail: string } | null>(null);
  return { isOpen: content !== null, showInformation: (title, detail) => setContent({ title, detail }), informationSheet: <InformationSheet visible={content !== null} onClose={() => setContent(null)} title={content?.title ?? ''} detail={content?.detail ?? ''} /> };
}

export function InformationButton({ label, detail, color, size = 16, onVisibilityChange }: { label: string; detail: string; color?: string; size?: number; onVisibilityChange?: (visible: boolean) => void }) {
  const { palette } = useNativeAppearance();
  const { showInformation, informationSheet, isOpen } = useInformationSheet();
  const reportedOpen = useRef(false);
  useEffect(() => {
    if (isOpen) { reportedOpen.current = true; onVisibilityChange?.(true); return; }
    if (!reportedOpen.current) return;
    // Keep the welcome deferred while this sheet dismisses.
    const timer = setTimeout(() => { reportedOpen.current = false; onVisibilityChange?.(false); }, 400);
    return () => clearTimeout(timer);
  }, [isOpen, onVisibilityChange]);
  useEffect(() => () => { if (reportedOpen.current) onVisibilityChange?.(false); }, [onVisibilityChange]);
  const boxSize = Math.max(size + 2, 16);
  return <><Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => showInformation(label, detail)} hitSlop={12} style={{ width: boxSize, height: boxSize, alignItems: 'center', justifyContent: 'center' }}><AppIcon name="info" size={size} color={color ?? palette.muted} /></Pressable>{informationSheet}</>;
}
