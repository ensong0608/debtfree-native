import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Share,
  StyleSheet,
  TouchableWithoutFeedback,
  Vibration,
  useWindowDimensions,
} from 'react-native';
import { Pressable, ScrollView, Text, TextInput, View, useNativeAppearance } from '../components/NativeAppearance';
import type { Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { AppIcon } from '../components/AppIcon';
import { Card, Segments, ui } from '../components/FinancialScreen';
import { SelectDropdown, type DropdownOption } from '../components/SelectDropdown';
import {
  CURRENCY_OPTIONS,
  acceptMoneyEdit,
  formatCurrency,
  formatEditableMoney,
  validateExtraPaymentInput,
  type PayoffStrategy,
  type UserOnboardingData,
} from '../onboarding-domain';
import {
  requestNativeNotificationPermission,
  saveUserOnboardingData,
} from '../onboarding-storage';
import {
  assertCurrencyChangeAllowed,
  hasMonetaryRecords,
  validateStoredAmounts,
} from '../debt-storage-domain';
import { getPendingFinanceSummary, getPendingFinanceOperations, recoverPendingFinanceWrites, loadFinanceRecords, canRetryPendingFinanceOperation } from '../finance-storage';
import { loadUserOnboardingData } from '../onboarding-storage';
import { createNativeBackup, parseNativeBackup, createRestorePlan, createBackupCheckpointRepository, nativeBackupLifecycleWarnings, type RestoreCheckpoint } from '../finance/backup';
import { createChunkedStorage } from '../secure-chunks';
import type { LedgerTransaction, ReconciliationAnchor } from '../finance/ledger';
import type { RecurringBill } from '../finance/recurring-bills';
import type { PendingCommand } from '../finance/pending-journal';

export type ThemePreference = 'System' | 'Dark' | 'Light';
export type HouseholdRole = 'Owner' | 'Admin' | 'Viewer';

type SupportDocumentKey = 'guides' | 'privacy' | 'terms';
type SettingsPage = 'appearance' | 'household' | 'preferences' | 'notifications' | 'security' | 'support' | 'data';

const THEME_OPTIONS: readonly ThemePreference[] = ['System', 'Dark', 'Light'] as const;

const COMMON_TIMEZONES: readonly { value: string; label: string; subtitle: string }[] = [
  { value: 'America/Los_Angeles', label: 'Pacific Time (US & Canada)', subtitle: 'America/Los_Angeles' },
  { value: 'America/Denver', label: 'Mountain Time (US & Canada)', subtitle: 'America/Denver' },
  { value: 'America/Phoenix', label: 'Arizona (No DST)', subtitle: 'America/Phoenix' },
  { value: 'America/Chicago', label: 'Central Time (US & Canada)', subtitle: 'America/Chicago' },
  { value: 'America/New_York', label: 'Eastern Time (US & Canada)', subtitle: 'America/New_York' },
  { value: 'America/Anchorage', label: 'Alaska Time', subtitle: 'America/Anchorage' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time', subtitle: 'Pacific/Honolulu' },
  { value: 'America/Vancouver', label: 'Vancouver (Pacific)', subtitle: 'America/Vancouver' },
  { value: 'America/Toronto', label: 'Toronto (Eastern)', subtitle: 'America/Toronto' },
  { value: 'Europe/London', label: 'London (GMT / BST)', subtitle: 'Europe/London' },
  { value: 'Europe/Paris', label: 'Central European Time', subtitle: 'Europe/Paris' },
  { value: 'Asia/Tokyo', label: 'Japan Standard Time', subtitle: 'Asia/Tokyo' },
  { value: 'Australia/Sydney', label: 'Australian Eastern Time', subtitle: 'Australia/Sydney' },
  { value: 'UTC', label: 'Coordinated Universal Time', subtitle: 'UTC' },
];

const SUPPORT_DOCS: Record<
  SupportDocumentKey,
  { title: string; url: string; summary: readonly string[] }
> = {
  guides: {
    title: 'Help & Guides',
    url: 'https://debtfree-dashboard.ensong0608.workers.dev/help',
    summary: [
      'Snowball prioritizes your smallest balance first for fast momentum, while Avalanche targets the highest APR to minimize total interest.',
      'Recurring bills on credit cards increase card balance only when confirmed; debit bills track checking cashflow without creating debt.',
      'Use Reconcile on any Debt Account detail screen to align your tracked balance with your latest statement.',
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    url: 'https://debtfree-dashboard.ensong0608.workers.dev/privacy',
    summary: [
      'Your financial accounts, ledger transactions, and payoff preferences are scoped strictly to your authenticated household account via Row-Level Security.',
      'Local offline cache entries on this device are encrypted using platform hardware-backed SecureStore while unlocked.',
      'DebtFree never sells your personal financial records or transaction history to third-party advertisers.',
    ],
  },
  terms: {
    title: 'Terms of Service',
    url: 'https://debtfree-dashboard.ensong0608.workers.dev/terms',
    summary: [
      'Payoff dates and amortization tables are mathematical projections based on the balances, APRs, and extra monthly payments you enter.',
      'Recording or scheduling a bill inside DebtFree updates your personal ledger only and does not initiate bank transfers or lender payments.',
      'Always verify minimum payment amounts and due dates directly against your official lender statements.',
    ],
  },
};

function prefKey(userId: string, name: string): string {
  const safeId = userId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `debtfree-pref-${name}.${safeId}`;
}

async function readLocalPref(userId: string, name: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(prefKey(userId, name));
  } catch {
    return null;
  }
}

async function writeLocalPref(userId: string, name: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(prefKey(userId, name), value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // Optional device-local preference fallback stays in component state.
  }
}

const checkpointStore = createChunkedStorage({
  getItem: key => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  removeItem: key => SecureStore.deleteItemAsync(key),
}, () => Date.now().toString(36) + Math.random().toString(36).slice(2));
const checkpoints = createBackupCheckpointRepository(checkpointStore, { key: owner => 'finance-backup-checkpoint.' + [owner.userId, owner.householdId].map(value => Array.from(value).map(c => c.codePointAt(0)!.toString(16)).join('-')).join('.') });

function SettingSwitchRow({
  title,
  subtitle,
  checked,
  disabled = false,
  onToggle,
}: {
  title: string;
  subtitle?: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onToggle}
      style={[styles.switchRow, disabled && styles.disabled]}
    >
      <View style={styles.flex1}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      <View style={[styles.toggleTrack, checked && styles.toggleTrackOn]}>
        <View style={[styles.toggleThumb, checked && styles.toggleThumbOn]} />
      </View>
    </Pressable>
  );
}

function RoleBadge({ role }: { role: HouseholdRole }) {
  const palette =
    role === 'Owner'
      ? { bg: '#31534D', border: '#46786F', text: '#81DFD2' }
      : role === 'Admin'
        ? { bg: '#3A3324', border: '#6A5B37', text: '#F2C94C' }
        : { bg: '#2F3633', border: '#47524D', text: '#B5BDB7' };

  return (
    <View
      style={[
        styles.roleBadge,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      <Text style={[styles.roleBadgeText, { color: palette.text }]}>{role}</Text>
    </View>
  );
}

export type SettingsScreenProps = {
  session: Session | null;
  onboardingData: UserOnboardingData;
  transactions: LedgerTransaction[];
  recurringBills: RecurringBill[];
  reconciliationAnchors: ReconciliationAnchor[];
  currencyCode: string;
  currencySymbol: string;
  authBusy?: boolean;
  themePreference?: ThemePreference;
  onSelectTheme?: (theme: ThemePreference) => void;
  onClose: () => void;
  onUpdateOnboardingData: (next: UserOnboardingData) => void;
  onUpdateTransactions?: (next: LedgerTransaction[]) => void;
  onUpdateRecurringBills?: (next: RecurringBill[]) => void;
  onUpdateReconciliationAnchors?: (next: ReconciliationAnchor[]) => void;
  onSignOut: () => void | Promise<void>;
  onEditSetup?: () => void;
};

export function SettingsScreen({
  session,
  onboardingData,
  transactions,
  recurringBills,
  reconciliationAnchors,
  currencyCode,
  currencySymbol,
  authBusy = false,
  themePreference: propThemePreference,
  onSelectTheme,
  onClose,
  onUpdateOnboardingData,
  onUpdateTransactions,
  onUpdateRecurringBills,
  onUpdateReconciliationAnchors,
  onSignOut,
  onEditSetup,
}: SettingsScreenProps) {
  const { fontScale } = useWindowDimensions();
  const userId = session?.user?.id ?? onboardingData.userId;

  // Local device preferences (Appearance, Haptics, Dynamic Text)
  const [localThemePreference, setLocalThemePreference] = useState<ThemePreference>(propThemePreference ?? 'Dark');
  const themePreference = propThemePreference ?? localThemePreference;
  const { textScaling: dynamicTextEnabled, setTextScaling } = useNativeAppearance();
  const [hapticsEnabled, setHapticsEnabled] = useState(true);

  // Synced financial preferences state
  const committedExtraKey = `${currencyCode}:${onboardingData.extraMonthlyPayment}`;
  const [extraDraft, setExtraDraft] = useState<{ key: string; text: string } | null>(null);
  const extraInput =
    extraDraft && extraDraft.key === committedExtraKey
      ? extraDraft.text
      : formatEditableMoney(onboardingData.extraMonthlyPayment, currencyCode);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsError, setPrefsError] = useState('');
  const [prefsNotice, setPrefsNotice] = useState('');
  const savingRef = useRef(false);

  // Sign-out check state
  const [signingOutCheck, setSigningOutCheck] = useState(false);

  // Support & Legal sheet state
  const [activeDoc, setActiveDoc] = useState<SupportDocumentKey | null>(null);
  const [activeSettingsPage, setActiveSettingsPage] = useState<SettingsPage | null>(null);

  const [backupText, setBackupText] = useState('');
  const [backupMessage, setBackupMessage] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [pendingStatus, setPendingStatus] = useState('Checking pending changes?');
  const [pendingOperations, setPendingOperations] = useState<PendingCommand[]>([]);
  const [checkpoint, setCheckpoint] = useState<RestoreCheckpoint | null>(null);
  const owner = () => {
    if (!session?.user.id || session.user.id !== onboardingData.userId || !onboardingData.householdId) throw new Error('A matching authenticated user and household are required.');
    return { userId: session.user.id, householdId: onboardingData.householdId };
  };
  const refreshPending = async () => {
    const current = owner();
    const [summary, operations] = await Promise.all([getPendingFinanceSummary(current.userId), getPendingFinanceOperations(current.userId)]);
    setPendingOperations(operations);
    setPendingStatus(`${summary.total} unresolved; ${summary.conflict} conflicts, ${summary.needs_review} need review, ${summary.rejected} rejected.`);
    return summary.total;
  };
  useEffect(() => {
    let active = true;
    if (!session?.user.id || session.user.id !== onboardingData.userId || !onboardingData.householdId) { setPendingOperations([]); setPendingStatus('Sign in to inspect pending changes and checkpoints.'); return; }
    const current = { userId: session.user.id, householdId: onboardingData.householdId };
    void Promise.all([getPendingFinanceSummary(current.userId), getPendingFinanceOperations(current.userId), checkpoints.load(current)]).then(([summary, operations, saved]) => {
      if (active) { setPendingOperations(operations); setPendingStatus(`${summary.total} unresolved; ${summary.conflict} conflicts, ${summary.needs_review} need review, ${summary.rejected} rejected.`); setCheckpoint(saved); }
    }).catch(() => { if (active) setPendingStatus('Pending status or checkpoint could not be inspected.'); });
    return () => { active = false; };
  }, [session?.user.id, onboardingData.userId, onboardingData.householdId]);
  const currentBackup = async () => {
    const current = owner();
    if (savingRef.current || await refreshPending() > 0 || transactions.some(tx => tx.isPending)) throw new Error('Unconfirmed local changes must be resolved before backup or preflight.');
    const verified = await loadUserOnboardingData(session!);
    if (verified.householdId !== current.householdId || JSON.stringify(verified) !== JSON.stringify(onboardingData)) throw new Error('Current settings or debts differ from the verified household. Refresh and resolve local changes first.');
    const records = await loadFinanceRecords({ session, userId: current.userId, currency: currencyCode });
    if (records.syncStatus !== 'synced' || records.pendingWriteCount > 0 || await refreshPending() > 0) throw new Error('A complete confirmed finance snapshot is unavailable. Connect and resolve pending changes first.');
    if (JSON.stringify(records.transactions) !== JSON.stringify(transactions) || JSON.stringify(records.recurringBills) !== JSON.stringify(recurringBills) || JSON.stringify(records.reconciliationAnchors) !== JSON.stringify(reconciliationAnchors)) throw new Error('Displayed records differ from the verified snapshot. Refresh before continuing.');
    return createNativeBackup({ ...current, currency: currencyCode, exportedAt: new Date().toISOString(), onboardingData: verified, transactions: records.transactions, recurringBills: records.recurringBills, reconciliationAnchors: records.reconciliationAnchors }, current);
  };
  const runBackupAction = async (action: () => Promise<void>) => {
    if (backupBusy) return;
    setBackupBusy(true); setBackupMessage('');
    try { await action(); } catch (error) { setBackupMessage(error instanceof Error ? error.message : 'Unable to inspect backup.'); } finally { setBackupBusy(false); }
  };
  const exportBackup = () => void runBackupAction(async () => {
    const backup = await currentBackup();
    await Share.share({ title: 'DebtFree native backup JSON', message: JSON.stringify(backup, null, 2) });
    setBackupMessage(`Share sheet opened for the validated backup. ${nativeBackupLifecycleWarnings(backup).join(' ')} Restoration is currently unavailable.`);
  });
  const preflightBackup = () => void runBackupAction(async () => {
    const current = await currentBackup();
    const parsed = parseNativeBackup(backupText, owner());
    if (parsed.backup.transactions.some(tx => tx.isPending)) throw new Error('The backup contains unconfirmed transactions.');
    const plan = createRestorePlan(parsed.backup, current, owner());
    const counts = plan.operations.reduce((acc, op) => { acc[op.action]++; return acc; }, { create: 0, unchanged: 0, conflict: 0 });
    setBackupMessage(`Validated: ${parsed.backup.onboardingData.debts.length} debts, ${parsed.backup.transactions.length} transactions, ${parsed.backup.recurringBills.length} bills, ${parsed.backup.reconciliationAnchors.length} anchors. Preflight: ${counts.create} new, ${counts.unchanged} unchanged, ${counts.conflict} conflicts. ${parsed.warnings.join(' ')} Restoration requires a verified atomic service.`);
  });
  const refreshRecoveryState = async () => {
    const current = owner();
    const verified = await loadUserOnboardingData(session!);
    if (verified.userId !== current.userId || verified.householdId !== current.householdId) throw new Error('The current household could not be verified.');
    const records = await loadFinanceRecords({ session, userId: current.userId, currency: currencyCode });
    const remaining = await refreshPending();
    if (records.snapshotStatus !== 'authoritative' || records.pendingWriteCount > 0 || remaining > 0) {
      throw new Error('Some changes remain unresolved or the complete server state is unavailable. Displayed balances have not been refreshed.');
    }
    onUpdateOnboardingData(verified);
    onUpdateTransactions?.(records.transactions);
    onUpdateRecurringBills?.(records.recurringBills);
    onUpdateReconciliationAnchors?.(records.reconciliationAnchors);
  };
  const performRecovery = async (command: PendingCommand, action: 'retry' | 'accept_server_state') => {
    await runBackupAction(async () => {
      const current = owner();
      let recoveryError: unknown;
      try {
        if (action === 'retry') {
          await recoverPendingFinanceWrites({ userId: current.userId, session, action, commandId: command.commandId });
        } else {
          await recoverPendingFinanceWrites({ userId: current.userId, session, action, acknowledgeServerState: true, commandId: command.commandId });
        }
      } catch (error) { recoveryError = error; }
      try { await refreshRecoveryState(); } catch (error) {
        await refreshPending().catch(() => {});
        const detail = error instanceof Error ? error.message : 'The server state could not be refreshed.';
        throw new Error(`${recoveryError ? 'The action could not be confirmed.' : action === 'retry' ? 'Retry submitted.' : 'Server state selected.'} ${detail}`);
      }
      if (recoveryError) throw new Error('The action could not be confirmed. The current server state has been refreshed; check the change before trying again.');
      setBackupMessage(action === 'retry' ? 'Retry completed and the current server state was refreshed.' : 'Current server state adopted and refreshed. The original outcome remains unproven; evidence was archived.');
    });
  };
  const confirmRetry = (command: PendingCommand) => Alert.alert('Retry this change?', 'This change was never sent. Retry it now?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Retry', onPress: () => void performRecovery(command, 'retry') },
  ]);
  const confirmServerState = (command: PendingCommand) => Alert.alert('Review current server state', 'The outcome of this change is not proven. Adopting the current server state discards the local provisional intent while preserving archived evidence. This does not confirm whether the original change happened.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Adopt server state', style: 'destructive', onPress: () => void performRecovery(command, 'accept_server_state') },
  ]);
  const refreshConfirmation = () => Alert.alert('Refresh confirmation?', 'Check the server for evidence of pending finance writes. This does not retry a write; unresolved operations may still need review.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Refresh confirmation', onPress: () => void runBackupAction(async () => { const current = owner(); await recoverPendingFinanceWrites({ userId: current.userId, session, action: 'readback' }); await refreshRecoveryState(); setBackupMessage('Confirmation and current server state refreshed.'); }) },
  ]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [theme, haptics] = await Promise.all([
        readLocalPref(userId, 'theme'),
        readLocalPref(userId, 'haptics'),
      ]);
      if (!active) return;
      if (theme === 'System' || theme === 'Dark' || theme === 'Light') {
        setLocalThemePreference(theme);
        onSelectTheme?.(theme);
      }
      if (haptics !== null) setHapticsEnabled(haptics !== 'false');
    })();
    return () => {
      active = false;
    };
  }, [userId, onSelectTheme]);

  const triggerSubtleHaptic = useCallback(
    (force = false) => {
      if (!force && !hapticsEnabled) return;
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        try {
          Vibration.vibrate(10);
        } catch {
          // Vibration unavailable on simulator or restricted profile
        }
      }
    },
    [hapticsEnabled],
  );

  // Account & Provider Derivation
  const displayName = useMemo(() => {
    const meta = session?.user?.user_metadata;
    const fullName =
      (typeof meta?.full_name === 'string' && meta.full_name.trim()) ||
      (typeof meta?.name === 'string' && meta.name.trim());
    if (fullName) return fullName;
    if (session?.user?.email) return session.user.email.split('@')[0];
    return 'Preview User';
  }, [session]);

  const userEmail = session?.user?.email ?? 'Sandbox preview session (not signed in)';

  const connectedProviders = useMemo(() => {
    const set = new Set<string>();
    const appMeta = session?.user?.app_metadata;
    if (typeof appMeta?.provider === 'string') {
      set.add(appMeta.provider.toLowerCase());
    }
    if (Array.isArray(appMeta?.providers)) {
      for (const p of appMeta.providers) {
        if (typeof p === 'string') set.add(p.toLowerCase());
      }
    }
    if (Array.isArray(session?.user?.identities)) {
      for (const identity of session.user.identities) {
        if (typeof identity?.provider === 'string') {
          set.add(identity.provider.toLowerCase());
        }
      }
    }
    return set;
  }, [session]);

  // Regional & Household Derivation
  const deviceTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  );
  const activeTimeZone = onboardingData.householdTimeZone || deviceTimeZone;

  const timezoneOptions: readonly DropdownOption<string>[] = useMemo(() => {
    const list = [...COMMON_TIMEZONES];
    const ensureZone = (zone: string, tag: string) => {
      if (!zone) return;
      if (!list.some(item => item.value === zone)) {
        list.unshift({
          value: zone,
          label: `${zone.replace(/_/g, ' ')} (${tag})`,
          subtitle: zone,
        });
      }
    };
    ensureZone(deviceTimeZone, 'Device default');
    ensureZone(activeTimeZone, 'Current');
    return list.map(z => ({
      value: z.value,
      label: z.value === deviceTimeZone ? `${z.label} · Device` : z.label,
      subtitle: z.subtitle,
      icon: 'calendar',
    }));
  }, [activeTimeZone, deviceTimeZone]);

  const currencyLocked = useMemo(
    () =>
      hasMonetaryRecords(onboardingData, {
        transactions,
        recurringBills,
        reconciliationAnchors,
        complete: true,
      }),
    [onboardingData, transactions, recurringBills, reconciliationAnchors],
  );

  const currencyDropdownOptions: readonly DropdownOption<string>[] = useMemo(
    () =>
      CURRENCY_OPTIONS.map(c => ({
        value: c.code,
        label: `${c.code} (${c.symbol})`,
        subtitle: `${c.scale} decimal places`,
      })),
    [],
  );

  const householdName = useMemo(() => {
    const first = displayName.split(' ')[0] || 'My';
    return `${first}'s Household`;
  }, [displayName]);

  const householdMembers: readonly {
    id: string;
    name: string;
    detail: string;
    role: HouseholdRole;
  }[] = useMemo(() => {
    return [
      {
        id: 'owner',
        name: displayName,
        detail: session?.user?.email ?? 'Primary account holder (Verified)',
        role: 'Owner',
      },
    ];
  }, [displayName, session]);

  const persistOnboardingPatch = async (
    patch: Partial<UserOnboardingData>,
    successMessage?: string,
  ) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingPrefs(true);
    setPrefsError('');
    setPrefsNotice('');
    try {
      const candidate: UserOnboardingData = {
        ...onboardingData,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      if (!session) {
        validateStoredAmounts(candidate);
        onUpdateOnboardingData(candidate);
      } else {
        const confirmed = await saveUserOnboardingData(candidate);
        onUpdateOnboardingData(confirmed);
      }
      triggerSubtleHaptic();
      if (successMessage) setPrefsNotice(successMessage);
    } catch (err) {
      setPrefsError(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      savingRef.current = false;
      setSavingPrefs(false);
    }
  };

  // Handlers: Section 1 (Account & Security)
  const handleSignOutPress = async () => {
    if (signingOutCheck || authBusy) return;
    setSigningOutCheck(true);
    try {
      const count = await refreshPending();
      if (count > 0 || transactions.some(tx => tx.isPending)) {
        Alert.alert('Unconfirmed finance changes', 'Some finance operations are unconfirmed or need review. Signing out may leave them unresolved on this device.', [
          { text: 'Stay signed in', style: 'cancel' },
          { text: 'Sign out anyway', style: 'destructive', onPress: () => { onClose(); void onSignOut(); } },
        ]);
        return;
      }

      onClose();
      await onSignOut();
    } catch {
      Alert.alert('Unable to check pending changes', 'Stay signed in and retry when pending status is available.');
    } finally {
      setSigningOutCheck(false);
    }
  };

  // Handlers: Section 2 (Appearance & Display)
  const handleSelectTheme = (value: string) => {
    if (value !== 'System' && value !== 'Dark' && value !== 'Light') return;
    setLocalThemePreference(value as ThemePreference);
    onSelectTheme?.(value as ThemePreference);
    triggerSubtleHaptic();
    void writeLocalPref(userId, 'theme', value);
  };

  const handleToggleDynamicText = () => {
    const next = !dynamicTextEnabled;
    setTextScaling(next);
    triggerSubtleHaptic();
  };

  const handleToggleHaptics = () => {
    const next = !hapticsEnabled;
    setHapticsEnabled(next);
    if (next) triggerSubtleHaptic(true);
    void writeLocalPref(userId, 'haptics', String(next));
  };

  // Handlers: Section 3 (Household & Regional)
  const handleSelectCurrency = (nextCode: string) => {
    if (nextCode === currencyCode) return;
    setPrefsError('');
    try {
      assertCurrencyChangeAllowed(onboardingData, nextCode, {
        transactions,
        recurringBills,
        reconciliationAnchors,
        complete: true,
      });
      void persistOnboardingPatch(
        { currencyCode: nextCode },
        `Currency updated to ${nextCode}.`,
      );
    } catch (err) {
      setPrefsError(
        err instanceof Error
          ? err.message
          : 'Currency cannot be changed while monetary records exist.',
      );
    }
  };

  const handleSelectTimezone = (nextZone: string) => {
    if (nextZone === onboardingData.householdTimeZone) return;
    void persistOnboardingPatch(
      { householdTimeZone: nextZone },
      `Household timezone set to ${nextZone}.`,
    );
  };

  // Handlers: Section 4 (Preferences)
  const handleSelectStrategy = (strategy: PayoffStrategy) => {
    if (onboardingData.strategy === strategy) return;
    void persistOnboardingPatch(
      { strategy },
      `Payoff strategy set to ${strategy === 'snowball' ? 'Snowball' : 'Avalanche'}.`,
    );
  };

  const handleSaveExtraPayment = () => {
    const check = validateExtraPaymentInput(extraInput, currencyCode);
    if (!check.valid) {
      setPrefsError(check.error);
      return;
    }
    void persistOnboardingPatch(
      { extraMonthlyPayment: check.extraMonthlyPayment },
      `Extra monthly payment saved (${formatCurrency(check.extraMonthlyPayment, currencyCode)}/mo).`,
    ).then(() => {
      setExtraDraft(null);
    });
  };

  const handleToggleNotification = async (
    key: 'upcomingReminders' | 'overdueAlerts' | 'milestonesAndProgress',
  ) => {
    if (savingRef.current) return;
    const currentPrefs = onboardingData.notifications;
    const nextValue = !currentPrefs[key];
    let osStatus = currentPrefs.osPermissionStatus;
    let permissionRequested = currentPrefs.permissionRequested;

    if (nextValue && osStatus === 'undetermined') {
      osStatus = await requestNativeNotificationPermission();
      permissionRequested = true;
    }

    await persistOnboardingPatch({
      notifications: {
        ...currentPrefs,
        [key]: nextValue,
        permissionRequested,
        osPermissionStatus: osStatus,
      },
    });
  };

  // Handlers: Section 5 (Support & Legal)
  const handleOpenExternalDoc = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Alert.alert('Unable to open browser', `Visit ${url} for full documentation.`);
    }
  };

  const fontScalePercent = Math.round((fontScale || 1) * 100);
  const settingsPageTitle: Record<SettingsPage, string> = {
    appearance: 'Appearance',
    household: 'Household',
    preferences: 'Payoff preferences',
    notifications: 'Notifications',
    security: 'Security',
    support: 'Help & information',
    data: 'Data & security',
  };
  const settingGroups: { title: string; rows: { label: string; detail?: string; page?: SettingsPage }[] }[] = [
    { title: 'PREFERENCES', rows: [
      { label: 'Theme', detail: themePreference, page: 'appearance' },
      { label: 'Accent color', detail: 'Not available' },
      { label: 'Text size', detail: `${fontScalePercent}%`, page: 'appearance' },
      { label: 'Notifications', detail: 'Payment & progress alerts', page: 'notifications' },
      { label: 'Payoff preferences', detail: 'Strategy and extra payment', page: 'preferences' },
    ] },
    { title: 'HOUSEHOLD', rows: [
      { label: 'Members', detail: `${householdMembers.length} ${householdMembers.length === 1 ? 'member' : 'members'}`, page: 'household' },
      { label: 'Currency & timezone', detail: currencyCode, page: 'household' },
    ] },
    { title: 'DATA & SECURITY', rows: [
      { label: 'Security', detail: 'Account and sign-in', page: 'security' },
      { label: 'Backup & recovery', detail: 'Export and review backups', page: 'data' },
      { label: 'Archived debts', detail: 'Unavailable' },
      { label: 'Reset account', detail: 'Disabled for safety', page: 'data' },
    ] },
    { title: 'HELP & INFORMATION', rows: [
      { label: 'Help & support', detail: 'Guides, privacy and terms', page: 'support' },
    ] },
  ];

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        {activeSettingsPage ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Back to Settings from ${settingsPageTitle[activeSettingsPage]}`} hitSlop={10} onPress={() => setActiveSettingsPage(null)} style={styles.backButton}>
            <AppIcon name="chevronLeft" size={20} color="#F9F9F6" />
          </Pressable>
        ) : <View style={styles.headerRightSpacer} />}
        <Text accessibilityRole="header" style={ui.title}>
          {activeSettingsPage ? settingsPageTitle[activeSettingsPage] : 'Settings'}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close Settings" hitSlop={10} onPress={onClose} style={styles.closeSettingsButton}>
          <Text style={styles.closeSettingsText}>X</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!!prefsError ? (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorBannerText}>{prefsError}</Text>
          </View>
        ) : null}
        {!!prefsNotice ? (
          <View style={styles.noticeBanner} accessibilityLiveRegion="polite">
            <Text style={styles.noticeBannerText}>{prefsNotice}</Text>
          </View>
        ) : null}

        {activeSettingsPage === null ? (
          <View style={styles.settingsIndex}>
            {settingGroups.map(group => (
              <View key={group.title}>
                <Text style={styles.sectionHeader}>{group.title}</Text>
                <Card style={styles.menuCard}>
                  {group.rows.map((row, index) => (
                    <Pressable key={row.label} accessibilityRole="button" accessibilityState={{ disabled: !row.page }} accessibilityLabel={`${row.label}${row.detail ? `, ${row.detail}` : ''}`} disabled={!row.page} onPress={() => row.page && setActiveSettingsPage(row.page)} style={[styles.menuRow, index > 0 && ui.divider, !row.page && styles.disabledMenuRow]}>
                      <View style={styles.flex1}><Text style={styles.menuRowTitle}>{row.label}</Text></View>
                      {row.detail ? <Text style={styles.menuRowDetail}>{row.detail}</Text> : null}
                      <AppIcon name="chevronRight" size={18} color="#AAB3AD" />
                    </Pressable>
                  ))}
                </Card>
              </View>
            ))}
            {savingPrefs ? <ActivityIndicator size="small" color="#81DFD2" /> : null}
          </View>
        ) : null}

        {/* ================================================================ */}
        {activeSettingsPage === 'security' && <>
        {/* SECTION 1: ACCOUNT & SECURITY                                    */}
        {/* ================================================================ */}
        <Text style={styles.sectionHeader}>ACCOUNT & SECURITY</Text>
        <Card>
          <View style={styles.profileRow}>
            <View style={styles.avatarCircle}>
              <AppIcon name="user" size={22} color="#81DFD2" />
            </View>
            <View style={styles.flex1}>
              <Text style={ui.heading}>{displayName}</Text>
              <Text style={ui.small}>{userEmail}</Text>
            </View>
          </View>

          <View style={ui.divider}>
            <Text style={styles.subLabel}>Connected Auth Providers</Text>
            <View style={styles.providerList}>
              {(['google', 'apple'] as const).map(provider => {
                const isConnected = connectedProviders.has(provider);
                const label = provider === 'google' ? 'Google' : 'Apple';
                return (
                  <View key={provider} style={styles.providerRow}>
                    <Text style={styles.rowTitle}>{label}</Text>
                    <View
                      style={[
                        styles.statusBadge,
                        isConnected ? styles.statusBadgeActive : styles.statusBadgeMuted,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusBadgeText,
                          isConnected ? styles.statusBadgeTextActive : styles.statusBadgeTextMuted,
                        ]}
                      >
                        {isConnected ? 'Connected' : session ? 'Not linked' : 'Preview'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={ui.divider}>
            <SettingSwitchRow
              title="Biometric unlock (Unavailable)"
              subtitle="Hardware biometric authentication (Face ID / Fingerprint) requires native module integration and is currently unavailable in this build."
              checked={false}
              disabled={true}
              onToggle={() => {}}
            />
          </View>

          <View style={ui.divider}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign Out"
              disabled={authBusy || signingOutCheck}
              onPress={() => void handleSignOutPress()}
              style={[
                styles.signOutButton,
                (authBusy || signingOutCheck) && styles.disabled,
              ]}
            >
              {signingOutCheck || authBusy ? (
                <ActivityIndicator size="small" color="#E3A088" />
              ) : (
                <Text style={styles.signOutButtonText}>Sign Out</Text>
              )}
            </Pressable>
          </View>
        </Card>

        {/* ================================================================ */}
        </>}
        {activeSettingsPage === 'appearance' && <>
        {/* SECTION 2: APPEARANCE & DISPLAY                                  */}
        {/* ================================================================ */}
        <Text style={styles.sectionHeader}>APPEARANCE & DISPLAY</Text>
        <Card>
          <View style={styles.fieldGroup}>
            <Text style={styles.rowTitle}>Theme</Text>
            <Text style={styles.rowSub}>Choose how DebtFree surfaces appear</Text>
            <View style={{ marginTop: 8 }}>
              <Segments
                items={THEME_OPTIONS}
                selected={themePreference}
                onSelect={handleSelectTheme}
              />
            </View>
          </View>

          <View style={ui.divider}>
            <View style={[ui.row, { justifyContent: 'space-between', marginBottom: 6 }]}>
              <Text style={styles.subLabel}>Accessibility Text Scaling</Text>
              <View style={ui.badge}>
                <Text style={ui.badgeText}>{`OS Scale: ${fontScalePercent}%`}</Text>
              </View>
            </View>
            <SettingSwitchRow
              title="Dynamic Type scaling"
              subtitle="Scale financial labels and body copy with your device accessibility size"
              checked={dynamicTextEnabled}
              onToggle={handleToggleDynamicText}
            />
          </View>

          <View style={ui.divider}>
            <SettingSwitchRow
              title="Haptic feedback"
              subtitle="Subtle tactile confirmation when saving payments and preferences"
              checked={hapticsEnabled}
              onToggle={handleToggleHaptics}
            />
          </View>
        </Card>

        {/* ================================================================ */}
        </>}
        {activeSettingsPage === 'household' && <>
        {/* SECTION 3: HOUSEHOLD & REGIONAL                                  */}
        {/* ================================================================ */}
        <Text style={styles.sectionHeader}>HOUSEHOLD & REGIONAL</Text>
        <Card>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <View style={styles.flex1}>
              <Text style={styles.subLabel}>Household Name</Text>
              <Text style={ui.heading}>{householdName}</Text>
              <Text style={ui.small}>{`ID: ${onboardingData.householdId}`}</Text>
            </View>
            {__DEV__ && onEditSetup ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit income and setup"
                onPress={() => {
                  onClose();
                  onEditSetup();
                }}
                style={ui.button}
              >
                <Text style={ui.buttonText}>Edit Setup</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={ui.divider}>
            <Text style={styles.subLabel}>Member Roster</Text>
            <View style={styles.rosterList}>
              {householdMembers.map(member => (
                <View key={member.id} style={styles.rosterRow}>
                  <View style={styles.flex1}>
                    <Text style={styles.rowTitle}>{member.name}</Text>
                    <Text style={styles.rowSub}>{member.detail}</Text>
                  </View>
                  <RoleBadge role={member.role} />
                </View>
              ))}
            </View>
            <Text style={[ui.small, { marginTop: 8, fontStyle: 'italic', color: '#8E9992' }]}>
              Multi-member household collaboration (partner &amp; advisor invites) is not yet supported in this build. Additional members will appear here once verified on your household plan.
            </Text>
          </View>

          <View style={ui.divider}>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <View style={styles.flex1}>
                <Text style={styles.subLabel}>Household Currency (ISO 4217)</Text>
                <Text style={ui.heading}>{`${currencyCode} (${currencySymbol})`}</Text>
              </View>
              {currencyLocked ? (
                <View style={styles.lockedBadge}>
                  <Text style={styles.lockedBadgeText}>LOCKED</Text>
                </View>
              ) : null}
            </View>
            {currencyLocked ? (
              <Text style={styles.lockedCaption}>
                Currency cannot be changed while monetary records exist.
              </Text>
            ) : (
              <SelectDropdown
                label="Change Currency"
                sheetTitle="Select ISO 4217 Currency"
                value={currencyCode}
                options={currencyDropdownOptions}
                onSelect={handleSelectCurrency}
                style={{ marginTop: 8 }}
              />
            )}
          </View>

          <View style={ui.divider}>
            <SelectDropdown
              label="Household Timezone"
              sheetTitle="Select Household Timezone"
              value={activeTimeZone}
              options={timezoneOptions}
              onSelect={handleSelectTimezone}
            />
            <Text style={[ui.small, { marginTop: 6 }]}>
              {onboardingData.householdTimeZone
                ? `Configured IANA zone: ${onboardingData.householdTimeZone}`
                : `Using device default timezone (${deviceTimeZone})`}
            </Text>
          </View>
        </Card>

        {/* ================================================================ */}
        </>}
        {activeSettingsPage === 'preferences' && <>
        {/* SECTION 4: PREFERENCES                                           */}
        {/* ================================================================ */}
        <Text style={styles.sectionHeader}>PREFERENCES</Text>
        <Card>
          <View style={styles.fieldGroup}>
            <Text style={styles.rowTitle}>Payoff Strategy</Text>
            <Text style={styles.rowSub}>
              {onboardingData.strategy === 'snowball'
                ? 'Snowball — Lowest balance first for quick wins'
                : 'Avalanche — Highest APR first to minimize total interest'}
            </Text>
            <View style={[ui.row, { marginTop: 10 }]}>
              {(['snowball', 'avalanche'] as const).map(strategy => {
                const selected = onboardingData.strategy === strategy;
                return (
                  <Pressable
                    key={strategy}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={
                      strategy === 'snowball'
                        ? 'Snowball: Lowest balance first'
                        : 'Avalanche: Highest APR first'
                    }
                    onPress={() => handleSelectStrategy(strategy)}
                    style={[
                      styles.strategyOption,
                      selected && styles.strategyOptionSelected,
                    ]}
                  >
                    <AppIcon
                      name={strategy}
                      size={16}
                      color={selected ? '#81DFD2' : '#AAB3AD'}
                    />
                    <View style={styles.flex1}>
                      <Text
                        style={[
                          styles.strategyTitle,
                          selected && styles.strategyTitleSelected,
                        ]}
                      >
                        {strategy === 'snowball' ? 'Snowball' : 'Avalanche'}
                      </Text>
                      <Text style={styles.strategySub}>
                        {strategy === 'snowball' ? 'Lowest balance' : 'Highest APR'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={ui.divider}>
            <Text style={styles.rowTitle}>Extra Monthly Payment</Text>
            <Text style={styles.rowSub}>
              Additional monthly amount applied above minimum payments
            </Text>
            <View style={[ui.row, { marginTop: 10 }]}>
              <View style={ui.inputWrap}>
                <Text style={styles.currencyPrefix}>{currencySymbol}</Text>
                <TextInput
                  accessibilityLabel="Extra monthly payment"
                  keyboardType="decimal-pad"
                  value={extraInput}
                  onChangeText={val =>
                    setExtraDraft(prev => ({
                      key: committedExtraKey,
                      text: acceptMoneyEdit(
                        prev && prev.key === committedExtraKey ? prev.text : extraInput,
                        val,
                        currencyCode,
                      ),
                    }))
                  }
                  placeholder="0.00"
                  placeholderTextColor="#6E7571"
                  style={styles.moneyInput}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save extra monthly payment"
                disabled={savingPrefs}
                onPress={handleSaveExtraPayment}
                style={[styles.primaryInlineBtn, savingPrefs && styles.disabled]}
              >
                <Text style={styles.primaryInlineBtnText}>Save</Text>
              </Pressable>
            </View>
          </View>

        </Card>
        </>}
        {activeSettingsPage === 'notifications' && <>
        <Text style={styles.sectionHeader}>NOTIFICATIONS</Text>
        <Card>
          <View>
            <Text style={[styles.subLabel, { marginBottom: 4 }]}>Notification Alerts</Text>
            <SettingSwitchRow
              title="Upcoming payment reminders"
              subtitle="Receive a heads-up before scheduled bills and minimums are due"
              checked={onboardingData.notifications.upcomingReminders}
              disabled={savingPrefs}
              onToggle={() => void handleToggleNotification('upcomingReminders')}
            />
            <SettingSwitchRow
              title="Past-due alerts"
              subtitle="Get notified immediately when an obligation becomes overdue"
              checked={onboardingData.notifications.overdueAlerts}
              disabled={savingPrefs}
              onToggle={() => void handleToggleNotification('overdueAlerts')}
            />
            <SettingSwitchRow
              title="Milestones & progress"
              subtitle="Celebrate debt payoff milestones and monthly progress summaries"
              checked={onboardingData.notifications.milestonesAndProgress}
              disabled={savingPrefs}
              onToggle={() => void handleToggleNotification('milestonesAndProgress')}
            />
            <Text style={[ui.small, { marginTop: 8, fontStyle: 'italic', color: '#8E9992' }]}>
              Note: Notification switches record your saved preferences. Background scheduled push notifications are deferred pending platform scheduler integration.
            </Text>
          </View>
        </Card>

        {/* ================================================================ */}
        </>}
        {activeSettingsPage === 'support' && <>
        {/* SECTION 5: SUPPORT & LEGAL                                       */}
        {/* ================================================================ */}
        <Text style={styles.sectionHeader}>SUPPORT & LEGAL</Text>
        <Card>
          {(
            [
              { key: 'guides', label: 'Help & Guides', sub: 'Payoff methods, bills & reconciliation' },
              { key: 'privacy', label: 'Privacy Policy', sub: 'Data protection & hardware encryption' },
              { key: 'terms', label: 'Terms of Service', sub: 'Forecasting disclosures & usage terms' },
            ] as const
          ).map((item, idx) => (
            <Pressable
              key={item.key}
              accessibilityRole="link"
              accessibilityLabel={item.label}
              onPress={() => setActiveDoc(item.key)}
              style={[styles.linkRow, idx > 0 && ui.divider]}
            >
              <View style={styles.flex1}>
                <Text style={styles.rowTitle}>{item.label}</Text>
                <Text style={styles.rowSub}>{item.sub}</Text>
              </View>
              <AppIcon name="chevronRight" size={18} color="#81DFD2" />
            </Pressable>
          ))}
        </Card>

        {/* ================================================================ */}
        </>}
        {activeSettingsPage === 'data' && <>
        {/* SECTION 6: DANGER ZONE                                           */}
        {/* ================================================================ */}
        <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }]}>
          <Text style={[styles.sectionHeader, { color: '#E3A088', marginTop: 0, marginBottom: 0 }]}>DANGER ZONE</Text>
          <View style={[ui.badge, { backgroundColor: '#3A2825', borderColor: '#E3A088', borderWidth: 1 }]}>
            <Text style={[ui.badgeText, { color: '#E3A088', fontSize: 10 }]}>BLOCKED / DEFERRED</Text>
          </View>
        </View>
        <Card style={styles.dangerCard}>
          <Text style={ui.heading}>Reset Financial Data</Text>
          <Text style={ui.small}>
            Permanently erase tracked debt accounts, ledger transactions, recurring bills, and onboarding state across both local cache and cloud database.
          </Text>
          <Text style={[ui.small, { color: '#E3A088', fontStyle: 'italic', marginTop: 4 }]}>
            Operational safety block: Full atomic reset is blocked pending execution of forward migration (20261106140000_reset_financial_data_atomic.sql) and native OS biometric verification. This destructive control is disabled to prevent orphaned financial records.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset Financial Data (Disabled)"
            disabled={true}
            style={[styles.dangerButton, styles.disabled, { opacity: 0.5 }]}
          >
            <AppIcon name="reset" size={16} color="#AAB3AD" />
            <Text style={[styles.dangerButtonText, { color: '#AAB3AD' }]}>Reset Financial Data (Disabled)</Text>
          </Pressable>
        </Card>

        <Text style={styles.sectionHeader}>BACKUP & RECOVERY</Text>
        <Card>
          <Text style={ui.heading}>Native backup</Text>
          <Text style={ui.small}>Export a validated full-household JSON snapshot. Keep it private. Paste JSON below to review a backup.</Text>
          <Text style={ui.small}>{pendingStatus}</Text>
          {pendingOperations.map((command, index) => {
            const archived = Boolean(command.resolution);
            const rejected = command.failure?.kind === 'rejected';
            const uncertain = command.dispatchState === 'uncertain' || command.dispatchState === 'dispatched';
            const kindLabels: Record<string, string> = { transaction_create: 'New transaction', transaction_update: 'Transaction edit', transaction_delete: 'Transaction deletion', bill_upsert: 'Bill change', bill_delete: 'Bill deletion', anchor_upsert: 'Balance update', reconciliation: 'Balance reconciliation', legacy: 'Earlier change' };
            const domains: Record<string, string> = { transactions: 'transactions', bills: 'bills', anchors: 'balance records' };
            const affected = Object.entries(command.members.reduce<Record<string, number>>((counts, member) => { const label = domains[member.domain] ?? 'other records'; counts[label] = (counts[label] ?? 0) + 1; return counts; }, {})).map(([label, count]) => `${count} ${label}`).join(', ') || 'Records unavailable';
            const status = archived ? 'Archived evidence' : rejected ? 'Rejected by server' : command.state === 'conflict' ? 'Conflict with server state' : uncertain ? 'Outcome uncertain' : command.dispatchState === 'not_dispatched' ? 'Never sent' : 'Needs review';
            const reason = archived ? 'The local intent was set aside; evidence remains archived.' : rejected ? 'The server rejected this change.' : command.state === 'conflict' ? 'The saved state differs from this change.' : uncertain ? 'The app cannot prove whether this change was applied.' : command.dispatchState === 'not_dispatched' ? 'This change has not been sent.' : 'This change needs review before it can be resolved.';
            const retryable = !archived && canRetryPendingFinanceOperation(command);
            const reviewable = !archived && !rejected && (uncertain || command.state === 'conflict' || command.state === 'needs_review' || command.dispatchState === 'not_dispatched');
            return <View key={command.commandId} style={ui.divider}>
              <Text style={styles.rowTitle}>{`${index + 1}. ${kindLabels[command.kind] ?? 'Financial change'}`}</Text>
              <Text style={styles.rowSub}>{`${status} · ${affected}`}</Text>
              <Text style={styles.rowSub}>{reason}</Text>
              {retryable ? <Pressable accessibilityRole="button" disabled={backupBusy} onPress={() => confirmRetry(command)} style={styles.devSecondaryButton}><Text style={styles.devSecondaryButtonText}>Retry</Text></Pressable> : null}
              {reviewable ? <Pressable accessibilityRole="button" disabled={backupBusy} onPress={() => confirmServerState(command)} style={styles.devSecondaryButton}><Text style={styles.devSecondaryButtonText}>Review current server state</Text></Pressable> : null}
            </View>;
          })}
          <Pressable accessibilityRole="button" disabled={backupBusy} onPress={refreshConfirmation} style={styles.devSecondaryButton}><Text style={styles.devSecondaryButtonText}>Refresh confirmation</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={backupBusy} onPress={exportBackup} style={styles.devSecondaryButton}><Text style={styles.devSecondaryButtonText}>Export backup JSON</Text></Pressable>
          <TextInput accessibilityLabel="Native backup JSON" multiline value={backupText} onChangeText={value => { setBackupText(value); setBackupMessage(''); }} placeholder="Paste backup JSON to review" placeholderTextColor="#6E7571" style={styles.devJsonInput} />
          <Pressable accessibilityRole="button" disabled={backupBusy || !backupText.trim()} onPress={preflightBackup} style={styles.devSecondaryButton}><Text style={styles.devSecondaryButtonText}>Validate and review</Text></Pressable>
          <Text style={ui.small}>Restore unavailable: the authenticated atomic restore service and receipt verification have not been implemented and verified.</Text>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={[styles.devSecondaryButton, styles.disabled]}><Text style={styles.devSecondaryButtonText}>Restore unavailable</Text></Pressable>
          <Text style={ui.small}>{checkpoint ? `Checkpoint: ${checkpoint.status}; ${checkpoint.cursor} of ${checkpoint.plan.operations.length} operations. ${checkpoint.plan.conflicts} conflicts.` : 'No checkpoint found.'}</Text>
          {checkpoint ? <Pressable accessibilityRole="button" disabled={backupBusy} onPress={() => void runBackupAction(async () => { await Share.share({ title: 'DebtFree recovery checkpoint JSON', message: JSON.stringify(checkpoint, null, 2) }); })} style={styles.devSecondaryButton}><Text style={styles.devSecondaryButtonText}>Export checkpoint JSON</Text></Pressable> : null}
          {!!backupMessage && <Text accessibilityRole="alert" style={styles.rowSub}>{backupMessage}</Text>}
        </Card>
        </>}
      </ScrollView>

      {/* Support & Legal Reader Modal */}
      <Modal
        visible={activeDoc !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveDoc(null)}
      >
        <TouchableWithoutFeedback onPress={() => setActiveDoc(null)}>
          <View style={styles.modalBackdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.modalSheet}>
                {activeDoc ? (
                  <>
                    <View style={styles.modalHeader}>
                      <Text style={ui.heading}>{SUPPORT_DOCS[activeDoc].title}</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close document"
                        onPress={() => setActiveDoc(null)}
                        style={styles.closeIconBtn}
                      >
                        <Text style={styles.closeIconText}>X</Text>
                      </Pressable>
                    </View>
                    <View style={{ gap: 10 }}>
                      {SUPPORT_DOCS[activeDoc].summary.map((paragraph, index) => (
                        <Text key={index} style={ui.text}>
                          {`• ${paragraph}`}
                        </Text>
                      ))}
                    </View>
                    <View style={[ui.row, { marginTop: 16 }]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Open full page in browser"
                        onPress={() => void handleOpenExternalDoc(SUPPORT_DOCS[activeDoc].url)}
                        style={[styles.primaryModalBtn, styles.flex1]}
                      >
                        <Text style={styles.primaryModalBtnText}>Open in Browser</Text>
                      </Pressable>
                    </View>
                  </>
                ) : null}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1F201F',
  },
  flex1: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#242926',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#353D38',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#353D39',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRightSpacer: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeSettingsButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#353D39',
  },
  closeSettingsText: {
    color: '#F9F9F6',
    fontSize: 25,
    fontWeight: '400',
    lineHeight: 28,
  },
  settingsIndex: {
    gap: 8,
  },
  menuCard: {
    padding: 0,
    gap: 0,
    overflow: 'hidden',
    borderRadius: 16,
  },
  menuRow: {
    minHeight: 55,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  disabledMenuRow: {
    opacity: 0.55,
  },
  menuRowTitle: {
    color: '#F9F9F6',
    fontSize: 15,
    fontWeight: '600',
  },
  menuRowDetail: {
    color: '#AAB3AD',
    fontSize: 13,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 48,
    gap: 12,
  },
  sectionHeader: {
    color: '#81DFD2',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  subLabel: {
    color: '#AAB3AD',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#314541',
    borderWidth: 1,
    borderColor: '#46786F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerList: {
    gap: 8,
    marginTop: 4,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusBadgeActive: {
    backgroundColor: '#243C37',
    borderColor: '#46786F',
  },
  statusBadgeMuted: {
    backgroundColor: '#252A27',
    borderColor: '#3A423E',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusBadgeTextActive: {
    color: '#81DFD2',
  },
  statusBadgeTextMuted: {
    color: '#AAB3AD',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  rowTitle: {
    color: '#F9F9F6',
    fontSize: 15,
    fontWeight: '600',
  },
  rowSub: {
    color: '#AAB3AD',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  toggleTrack: {
    width: 46,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#3C443F',
    padding: 3,
    justifyContent: 'center',
  },
  toggleTrackOn: {
    backgroundColor: '#369B97',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#D4DBD7',
  },
  toggleThumbOn: {
    backgroundColor: '#FFFFFF',
    alignSelf: 'flex-end',
  },
  signOutButton: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#2E2624',
    borderWidth: 1,
    borderColor: '#664338',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutButtonText: {
    color: '#E3A088',
    fontSize: 14,
    fontWeight: '700',
  },
  fieldGroup: {
    gap: 2,
  },
  rosterList: {
    gap: 10,
    marginTop: 6,
  },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#222724',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#343C37',
  },
  roleLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  lockedBadge: {
    backgroundColor: '#3A3324',
    borderWidth: 1,
    borderColor: '#6A5B37',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  lockedBadgeText: {
    color: '#F2C94C',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  lockedCaption: {
    color: '#AAB3AD',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  strategyOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1F201F',
    borderWidth: 1,
    borderColor: '#3C443F',
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  strategyOptionSelected: {
    backgroundColor: '#263B36',
    borderColor: '#81DFD2',
  },
  strategyTitle: {
    color: '#D5DDD8',
    fontSize: 14,
    fontWeight: '700',
  },
  strategyTitleSelected: {
    color: '#F9F9F6',
  },
  strategySub: {
    color: '#AAB3AD',
    fontSize: 11,
  },
  currencyPrefix: {
    color: '#81DFD2',
    fontSize: 15,
    fontWeight: '700',
  },
  moneyInput: {
    flex: 1,
    color: '#F9F9F6',
    fontSize: 15,
    paddingVertical: 8,
  },
  primaryInlineBtn: {
    minHeight: 42,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: '#81DFD2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryInlineBtnText: {
    color: '#1F201F',
    fontSize: 14,
    fontWeight: '700',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 4,
  },
  dangerCard: {
    backgroundColor: '#2A2220',
    borderColor: '#5C382E',
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#A34F34',
    paddingHorizontal: 14,
    marginTop: 4,
  },
  dangerButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  devCard: {
    backgroundColor: '#252721',
    borderColor: '#5A5332',
  },
  devBadge: {
    backgroundColor: '#3A3324',
    borderWidth: 1,
    borderColor: '#F2C94C',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  devBadgeText: {
    color: '#F2C94C',
    fontSize: 10,
    fontWeight: '800',
  },
  devButton: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: '#2E3B37',
    borderWidth: 1,
    borderColor: '#81DFD2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  devButtonText: {
    color: '#81DFD2',
    fontSize: 13,
    fontWeight: '700',
  },
  devSecondaryButton: {
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#2F332B',
    borderWidth: 1,
    borderColor: '#5A5332',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  devSecondaryButtonText: {
    color: '#F2C94C',
    fontSize: 12,
    fontWeight: '700',
  },
  devSuccessText: {
    color: '#81DFD2',
    fontSize: 12,
    fontWeight: '600',
  },
  errorBanner: {
    backgroundColor: '#342320',
    borderWidth: 1,
    borderColor: '#8B4A39',
    borderRadius: 10,
    padding: 12,
  },
  errorBannerText: {
    color: '#FF9367',
    fontSize: 13,
    lineHeight: 18,
  },
  noticeBanner: {
    backgroundColor: '#223632',
    borderWidth: 1,
    borderColor: '#46786F',
    borderRadius: 10,
    padding: 12,
  },
  noticeBannerText: {
    color: '#81DFD2',
    fontSize: 13,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    padding: 20,
  },
  modalSheet: {
    backgroundColor: '#242926',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: '#3B453F',
    gap: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  closeIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#323935',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIconText: {
    color: '#AAB3AD',
    fontSize: 14,
    fontWeight: '700',
  },
  modalTextInput: {
    backgroundColor: '#1B1E1C',
    borderWidth: 1,
    borderColor: '#46504A',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F9F9F6',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  biometricGateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2B2921',
    borderWidth: 1,
    borderColor: '#6A5B37',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  biometricGateBtnVerified: {
    backgroundColor: '#213530',
    borderColor: '#46786F',
  },
  biometricGateText: {
    color: '#F2C94C',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryModalBtn: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#323935',
    borderWidth: 1,
    borderColor: '#46504A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryModalBtnText: {
    color: '#D5DDD8',
    fontSize: 14,
    fontWeight: '600',
  },
  primaryModalBtn: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#81DFD2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryModalBtnText: {
    color: '#1F201F',
    fontSize: 14,
    fontWeight: '700',
  },
  devJsonInput: {
    backgroundColor: '#1B1E1C',
    borderWidth: 1,
    borderColor: '#46504A',
    borderRadius: 10,
    padding: 10,
    color: '#D5DDD8',
    fontSize: 12,
    minHeight: 160,
    maxHeight: 240,
    textAlignVertical: 'top',
  },
});
