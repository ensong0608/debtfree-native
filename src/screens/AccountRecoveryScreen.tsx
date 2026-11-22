import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, useNativeAppearance } from '../components/NativeAppearance';
import type { HouseholdMembershipSummary } from '../household-context';
import type { DebtCategoryDiagnostic, HouseholdRecoveryKind } from '../onboarding-storage';
import { REPAIR_CATEGORIES, type RepairCategory } from '../debt-category-repair';

type Props = {
  email: string;
  issue: string;
  diagnostics: DebtCategoryDiagnostic[];
  recoveryKind?: HouseholdRecoveryKind;
  pendingOperationCount?: number;
  households: HouseholdMembershipSummary[];
  currentId?: string;
  currentRole?: HouseholdMembershipSummary['role'];
  actionBusy?: boolean;
  onRepair: (diagnostic: DebtCategoryDiagnostic, category: RepairCategory) => Promise<void>;
  onSyncAndRecover?: () => Promise<void>;
  onAcceptServerState?: () => Promise<void>;
  onSwitch: (id: string) => Promise<void>;
  onJoin: (input: string) => Promise<void>;
  onRefresh: () => void | Promise<void>;
  onSignOut: () => void;
};
export function AccountRecoveryScreen(p: Props) {
  const { palette, ctaBg, ctaFg } = useNativeAppearance();
  const busyRef = useRef(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<Record<string, RepairCategory | undefined>>({});
  const fg = palette.text;
  const surface = palette.surface;
  const run = async (work: () => Promise<void>) => { if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); } finally { busyRef.current = false; setBusy(false); } };
  const actionBusy = busy || !!p.actionBusy;
  const pendingCount = p.pendingOperationCount ?? 0;
  const showPendingRecovery = (p.recoveryKind === 'pending_finance_commands' || pendingCount > 0)
    && Boolean(p.currentId)
    && Boolean(p.onSyncAndRecover || p.onAcceptServerState);
  return <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, backgroundColor: palette.canvas }} keyboardShouldPersistTaps="handled">
    <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: '700', color: fg }}>Your account</Text>
    <Text style={{ color: fg, marginVertical: 12 }}>{p.email}</Text>
    <View style={{ padding: 16, borderRadius: 14, backgroundColor: surface }}><Text accessibilityRole="alert" style={{ color: fg, fontWeight: '700' }}>{p.issue}</Text>
      {showPendingRecovery && (
        <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: palette.border }}>
          <Text style={{ color: fg, fontWeight: '700' }}>
            {pendingCount > 0
              ? `${pendingCount} unresolved local finance ${pendingCount === 1 ? 'change' : 'changes'} need recovery`
              : 'Pending finance changes need recovery'}
          </Text>
          <Text style={{ color: palette.muted, marginTop: 4 }}>
            Sync against the server to confirm saved changes, or use the authoritative server data and archive local evidence.
          </Text>
          {p.onSyncAndRecover && (
            <ActionButton
              label={actionBusy ? 'Syncing…' : 'Sync & Recover'}
              disabled={actionBusy}
              bg={ctaBg}
              fg={ctaFg}
              onPress={() => { void run(() => p.onSyncAndRecover!()); }}
            />
          )}
          {p.onAcceptServerState && (
            <ActionButton
              label={actionBusy ? 'Applying…' : 'Use Server Data & Continue'}
              disabled={actionBusy}
              bg={palette.raised}
              fg={fg}
              onPress={() => { void run(() => p.onAcceptServerState!()); }}
            />
          )}
        </View>
      )}
      {p.diagnostics.map(d => <View key={d.id} style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: palette.border }}>
        <Text style={{ color: fg, fontWeight: '700' }}>{d.name}</Text>
        <Text style={{ color: palette.muted, marginTop: 4 }}>{d.issue}{d.category ? `: ${d.category}` : ''}</Text>
        {p.currentRole === 'owner' || p.currentRole === 'member' ? <>
          <Text style={{ color: fg, marginTop: 12 }}>Choose the correct category</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
            {REPAIR_CATEGORIES.map(category => {
              const selected = selectedCategories[d.id] === category;
              return <Pressable key={category} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: actionBusy }} disabled={actionBusy} onPress={() => setSelectedCategories(current => ({ ...current, [d.id]: category }))} style={{ paddingVertical: 8, paddingHorizontal: 11, borderRadius: 18, marginRight: 7, marginTop: 7, borderWidth: 1, borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brand : palette.raised }}>
                <Text style={{ color: selected ? palette.onBrand : fg, fontWeight: selected ? '700' : '500' }}>{category}</Text>
              </Pressable>;
            })}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Save category for ${d.name}`} disabled={actionBusy || !selectedCategories[d.id]} onPress={() => { const category = selectedCategories[d.id]; if (category) void run(() => p.onRepair(d, category)); }} style={{ backgroundColor: ctaBg, padding: 14, borderRadius: 12, marginTop: 12, opacity: actionBusy || !selectedCategories[d.id] ? 0.5 : 1 }}>
            <Text style={{ color: ctaFg, textAlign: 'center', fontWeight: '700' }}>{actionBusy ? 'Saving category…' : 'Save category'}</Text>
          </Pressable>
        </> : <Text style={{ color: palette.muted, marginTop: 10 }}>This household is read-only for your account.</Text>}
      </View>)}
    </View>
    <Text style={{ color: fg, fontSize: 18, fontWeight: '700', marginTop: 24 }}>Your households</Text>
    {p.households.map(h => h.householdId === p.currentId ? <View key={h.householdId} style={{ backgroundColor: palette.raised, padding: 14, borderRadius: 12, marginTop: 10 }}><Text style={{ color: fg, fontWeight: '700' }}>{h.householdName}</Text><Text style={{ color: palette.muted, marginTop: 4 }}>Current household</Text></View> : <ActionButton key={h.householdId} label={h.householdName} disabled={actionBusy} bg={ctaBg} fg={ctaFg} onPress={() => { void run(() => p.onSwitch(h.householdId)); }} />)}
    <Text style={{ color: fg, fontSize: 18, fontWeight: '700', marginTop: 24 }}>Join a household</Text>
    <TextInput value={input} onChangeText={setInput} placeholder="Invitation link or code" placeholderTextColor={palette.muted} autoCapitalize="none" style={{ color: fg, backgroundColor: surface, padding: 14, borderRadius: 12, marginTop: 10 }} />
    <ActionButton label="Join" disabled={actionBusy} bg={ctaBg} fg={ctaFg} onPress={() => { void run(() => p.onJoin(input)); }} />
    {!!error && <Text accessibilityRole="alert" style={{ color: palette.text, marginTop: 12 }}>{error}</Text>}
    <ActionButton label="Refresh" disabled={actionBusy} bg={ctaBg} fg={ctaFg} onPress={p.onRefresh} />
    <ActionButton label="Sign out" disabled={actionBusy} bg={ctaBg} fg={ctaFg} onPress={p.onSignOut} />
  </ScrollView>;
}

function ActionButton({ label, onPress, disabled, bg, fg }: { label: string; onPress: () => void; disabled: boolean; bg: string; fg: string }) {
  return <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" style={{ backgroundColor: bg, padding: 14, borderRadius: 12, marginTop: 10, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: fg, textAlign: 'center', fontWeight: '700' }}>{label}</Text></Pressable>;
}
