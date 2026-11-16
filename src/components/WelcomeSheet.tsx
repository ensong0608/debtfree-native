import React from 'react';
import { Pressable, Text, View, useNativeAppearance } from './NativeAppearance';
import { SheetModal } from './SheetModal';
import { AppIcon } from './AppIcon';

type Item = { id: string; name: string; dueDate: string; settlementStatus: string };

function formatWelcomeDueDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed);
}

export function WelcomeSheet({ visible, onClose, name, overdue, upcoming, pendingCount, status, pairingCount, dataVerified, onUpcoming, onPending, onPairing }: {
  visible: boolean; onClose: () => void; name: string; timeZone: string;
  overdue: readonly Item[]; upcoming: readonly Item[]; pendingCount: number; status: string; pairingCount: number; dataVerified: boolean;
  onUpcoming: () => void; onPending: () => void; onPairing: () => void;
}) {
  const { palette, ctaBg, ctaFg } = useNativeAppearance();
  const seen = new Set<string>();
  const items = [...overdue.map(item => ({ ...item, label: 'Overdue' })), ...upcoming.map(item => ({ ...item, label: 'Upcoming' }))]
    .filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
  const clear = dataVerified && !status && !items.length && !pendingCount && !pairingCount;
  const row = (label: string, action: string, onPress: () => void, key: string) => (
    <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${label}. ${action}`} onPress={onPress}
      style={{ minHeight: 52, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: palette.border, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text style={{ color: palette.text, flex: 1, fontSize: 15, lineHeight: 21 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text style={{ color: palette.brand, fontWeight: '700' }}>{action}</Text>
        <AppIcon name="chevronRight" size={16} color={palette.brand} />
      </View>
    </Pressable>
  );
  return <SheetModal visible={visible} onClose={onClose} contentSized closeLabel="Close welcome">
    <View style={{ paddingTop: 12, gap: 10 }}>
      <View style={{ width: 44, height: 44, borderRadius: 15, backgroundColor: palette.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
        <AppIcon name={clear ? 'check' : 'bell'} size={22} color={palette.brand} />
      </View>
      <Text accessibilityRole="header" style={{ color: palette.text, fontSize: 25, fontWeight: '700' }}>Hi, {name}</Text>
      <Text style={{ color: palette.muted, fontSize: 14 }}>{clear ? 'A little momentum goes a long way.' : "Here's what may need your attention."}</Text>
      {status ? <Text accessibilityRole="alert" style={{ color: palette.text, paddingVertical: 10, lineHeight: 21 }}>{status}</Text> : null}
      {items.map(item => {
        const settlement = item.settlementStatus === 'pending_confirmation' ? ' · Pending confirmation' : item.settlementStatus === 'partially_paid' ? ' · Partially paid' : '';
        const statusPrefix = item.label === 'Overdue' ? 'Overdue' : 'Due';
        return row(`${item.name} · ${statusPrefix} ${formatWelcomeDueDate(item.dueDate)}${settlement}`, 'View', onUpcoming, item.id);
      })}
      {pendingCount > 0 ? row(`${pendingCount} pending transaction${pendingCount === 1 ? '' : 's'}`, 'Review', onPending, 'pending') : null}
      {pairingCount > 0 ? row(`${pairingCount} loan link${pairingCount === 1 ? '' : 's'} to review`, 'Review', onPairing, 'pairing') : null}
      {clear ? <View style={{ paddingVertical: 14, gap: 6 }}>
        <Text style={{ color: palette.text, fontSize: 16, fontWeight: '600' }}>No known items need attention</Text>
        <Text style={{ color: palette.muted, fontSize: 14, lineHeight: 21 }}>You&apos;re keeping on top of your plan. Keep it up!</Text>
      </View> : null}
      {!dataVerified && !status ? <Text style={{ color: palette.muted, lineHeight: 21 }}>Financial data is not yet verified. Attention items may be incomplete.</Text> : null}
      <Pressable accessibilityRole="button" onPress={onClose} style={{ minHeight: 48, backgroundColor: ctaBg, borderRadius: 14, alignItems: 'center', justifyContent: 'center', padding: 15, marginTop: 12 }}>
        <Text style={{ color: ctaFg, fontWeight: '700' }}>Continue to Home</Text>
      </Pressable>
    </View>
  </SheetModal>;
}
