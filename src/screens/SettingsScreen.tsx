import { settingsFailureSnapshot } from '../settings-contract';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Alert,
  Modal,
  Platform,
  Share,
  StyleSheet,
  TouchableWithoutFeedback,
  Vibration,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, ScrollView, Text, TextInput, View, useNativeAppearance, type ThemePreference } from '../components/NativeAppearance';
import type { Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { AppIcon, type AppIconName } from '../components/AppIcon';
import { ConfirmModal } from '../components/ConfirmModal';
import { Card, Segments, ui } from '../components/FinancialScreen';
import { InspireQuote } from '../components/InspireArt';
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
  loadUserOnboardingData,
  saveUserOnboardingData,
  saveUserOnboardingSettingsPatch,
} from '../onboarding-storage';
import {
  assertCurrencyChangeAllowed,
  hasMonetaryRecords,
  validateStoredAmounts,
} from '../debt-storage-domain';
import { getPendingFinanceSummary, getPendingFinanceOperations, recoverPendingFinanceWrites, loadFinanceRecords, canRetryPendingFinanceOperation } from '../finance-storage';
import { createNativeBackup, parseNativeBackup, createRestorePlan, createBackupCheckpointRepository, nativeBackupLifecycleWarnings, type RestoreCheckpoint } from '../finance/backup';
import { createChunkedStorage } from '../secure-chunks';
import type { LedgerTransaction, ReconciliationAnchor } from '../finance/ledger';
import type { RecurringBill } from '../finance/recurring-bills';
import type { HouseholdPendingCommand } from '../finance/pending-journal';
import {
  canEditHousehold,
  type HouseholdMembershipSummary,
  type HouseholdRole as ContextHouseholdRole,
} from '../household-context';
import {
  acceptHouseholdInvitation,
  buildHouseholdInviteWebUrl,
  cancelHouseholdInvitation,
  createHouseholdInvitation,
  leaveHousehold,
  listHouseholdInvitations,
  listHouseholdMembers,
  removeHouseholdMember,
  rotateHouseholdInvitation,
  transferHouseholdOwnership,
  updateHouseholdMemberRole,
  type CreatedOrRotatedInviteResult,
  type HouseholdInvitationRole,
  type HouseholdInvitationSummary,
  type HouseholdMemberSummary,
} from '../household-collaboration';

export type { ThemePreference } from '../components/NativeAppearance';
export type HouseholdRole = 'Owner' | 'Member' | 'Admin' | 'Viewer';

function toDisplayRole(role: ContextHouseholdRole): HouseholdRole {
  if (role === 'owner') return 'Owner';
  if (role === 'viewer') return 'Viewer';
  return 'Member';
}

type SupportDocumentKey = 'guides' | 'privacy' | 'terms';
type SettingsPage = 'appearance' | 'household' | 'preferences' | 'notifications' | 'security' | 'support' | 'data';

const THEME_OPTIONS: readonly ThemePreference[] = ['System', 'Dark', 'Light', 'Inspire'] as const;

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
  { title: string; url: string | null; summary: readonly string[] }
> = {
  guides: {
    title: 'Help & Guides',
    url: process.env.EXPO_PUBLIC_HELP_URL ?? null,
    summary: [
      'Snowball prioritizes your smallest balance first for fast momentum, while Avalanche targets the highest APR to minimize total interest.',
      'Recurring bills on credit cards increase card balance only when confirmed; debit bills track checking cashflow without creating debt.',
      'Use Reconcile on any Debt Account detail screen to align your tracked balance with your latest statement.',
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    url: process.env.EXPO_PUBLIC_PRIVACY_URL ?? null,
    summary: [
      'Your financial accounts, ledger transactions, and payoff preferences are scoped strictly to your authenticated household account via Row-Level Security.',
      'Local offline cache entries on this device are encrypted using platform hardware-backed SecureStore while unlocked.',
      'DebtFree never sells your personal financial records or transaction history to third-party advertisers.',
    ],
  },
  terms: {
    title: 'Terms of Service',
    url: process.env.EXPO_PUBLIC_TERMS_URL ?? null,
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
  const { palette, ctaBg, ctaFg } = useNativeAppearance();
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
      <View style={[styles.toggleTrack, { backgroundColor: checked ? ctaBg : palette.raised, borderColor: checked ? ctaBg : palette.border }]}>
        <View style={[styles.toggleThumb, checked && styles.toggleThumbOn, { backgroundColor: checked ? ctaFg : palette.muted }]} />
      </View>
    </Pressable>
  );
}

function RoleBadge({ role }: { role: HouseholdRole }) {
  const palette =
    role === 'Owner'
      ? { bg: '#31534D', border: '#46786F', text: '#76DCB9' }
      : role === 'Member' || role === 'Admin'
        ? { bg: '#3A3324', border: '#6A5B37', text: '#F5C563' }
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
  householdSummaries?: HouseholdMembershipSummary[];
  onSwitchHousehold?: (householdId: string) => Promise<void>;
  onRefreshHouseholdContexts?: () => Promise<HouseholdMembershipSummary[]>;
  onAcceptHouseholdInvite?: (tokenOrUrl: string) => Promise<void>;
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
  onDeleteAccount?: () => Promise<void>;
  accountDeletionEnabled?: boolean;
  settingsUncertain?: boolean;
  onSettingsUncertain?: () => void;
};

export function SettingsScreen({
  session,
  onboardingData,
  settingsUncertain = false,
  onSettingsUncertain,
  householdSummaries = [],
  onSwitchHousehold,
  onRefreshHouseholdContexts,
  onAcceptHouseholdInvite,
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
  onDeleteAccount,
  accountDeletionEnabled = false,
}: SettingsScreenProps) {
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const userId = session?.user?.id ?? onboardingData.userId;
  const verifiedContext = onboardingData.householdContext;
  const isOwner = session ? verifiedContext?.role === 'owner' : true;
  const canEdit = session ? (verifiedContext ? canEditHousehold(verifiedContext) : false) : true;

  // Local device preferences (Appearance, Haptics, Dynamic Text)
  const [localThemePreference, setLocalThemePreference] = useState<ThemePreference>(propThemePreference ?? 'Dark');
  const themePreference = propThemePreference ?? localThemePreference;
  const { textScaling: dynamicTextEnabled, setTextScaling, appearanceError, palette, isInspire, accentColor, setAccentColor, ctaBg, ctaFg } = useNativeAppearance();
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [confirmPrompt, setConfirmPrompt] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    destructive?: boolean;
    icon?: AppIconName;
    onConfirm: () => void;
  } | null>(null);

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

  // Household collaboration state
  const [rosterMembers, setRosterMembers] = useState<HouseholdMemberSummary[]>([]);
  const [invitations, setInvitations] = useState<HouseholdInvitationSummary[]>([]);
  const [collabLoading, setCollabLoading] = useState(false);
  const [collabBusy, setCollabBusy] = useState(false);
  const [collabError, setCollabError] = useState('');
  const [collabNotice, setCollabNotice] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<HouseholdInvitationRole>('member');
  const [latestInvite, setLatestInvite] = useState<CreatedOrRotatedInviteResult | null>(null);
  const [joinInput, setJoinInput] = useState('');
  const [switchingHouseholdId, setSwitchingHouseholdId] = useState<string | null>(null);

  // Sign-out check state
  const [signingOutCheck, setSigningOutCheck] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  // Support & Legal sheet state
  const [activeDoc, setActiveDoc] = useState<SupportDocumentKey | null>(null);
  const [activeSettingsPage, setActiveSettingsPage] = useState<SettingsPage | null>(null);
  const [editingHousehold, setEditingHousehold] = useState(false);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (savingRef.current) return true;
      if (editingHousehold) { setEditingHousehold(false); setPrefsError(''); }
      else if (activeSettingsPage) setActiveSettingsPage(null);
      else onClose();
      return true;
    });
    return () => subscription.remove();
  }, [editingHousehold, activeSettingsPage, onClose]);
  const [householdDraft, setHouseholdDraft] = useState('');

  const [backupText, setBackupText] = useState('');
  const [backupMessage, setBackupMessage] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const pendingScopeAvailable = Boolean(session?.user.id && session.user.id === onboardingData.userId && onboardingData.householdContext?.householdId === onboardingData.householdId);
  const [pendingStatus, setPendingStatus] = useState(pendingScopeAvailable ? 'Checking pending changes…' : 'Sign in to inspect pending changes and checkpoints.');
  const [pendingOperations, setPendingOperations] = useState<HouseholdPendingCommand[]>([]);
  const [checkpoint, setCheckpoint] = useState<RestoreCheckpoint | null>(null);
  const owner = () => {
    const householdContext = onboardingData.householdContext;
    if (!session?.user.id || session.user.id !== onboardingData.userId || !householdContext
      || householdContext.userId !== session.user.id || householdContext.householdId !== onboardingData.householdId) {
      throw new Error('A matching authenticated user and current verified household context are required.');
    }
    return {
      userId: session.user.id,
      householdId: onboardingData.householdId,
      membershipVersion: householdContext.membershipVersion,
      role: householdContext.role,
      householdContext,
    };
  };
  const refreshPending = async () => {
    const current = owner();
    const [summary, operations] = await Promise.all([getPendingFinanceSummary(current.householdContext), getPendingFinanceOperations(current.householdContext)]);
    setPendingOperations(operations);
    setPendingStatus(`${summary.total} unresolved; ${summary.conflict} conflicts, ${summary.needs_review} need review, ${summary.rejected} rejected.`);
    return summary.total;
  };
  const onboardingHouseholdContext = onboardingData.householdContext;
  useEffect(() => {
    let active = true;
    if (!session?.user.id || session.user.id !== onboardingData.userId || !onboardingHouseholdContext
      || onboardingHouseholdContext.userId !== session.user.id || onboardingHouseholdContext.householdId !== onboardingData.householdId) return;
    const current = {
      userId: session.user.id,
      householdId: onboardingData.householdId,
      membershipVersion: onboardingHouseholdContext.membershipVersion,
      role: onboardingHouseholdContext.role,
      householdContext: onboardingHouseholdContext,
    };
    const backupOwner = {
      userId: current.userId,
      householdId: current.householdId,
      membershipVersion: current.membershipVersion,
      role: current.role,
    };
    void Promise.all([getPendingFinanceSummary(current.householdContext), getPendingFinanceOperations(current.householdContext), checkpoints.load(backupOwner)]).then(([summary, operations, saved]) => {
      if (active) { setPendingOperations(operations); setPendingStatus(`${summary.total} unresolved; ${summary.conflict} conflicts, ${summary.needs_review} need review, ${summary.rejected} rejected.`); setCheckpoint(saved); }
    }).catch(() => { if (active) setPendingStatus('Pending status or checkpoint could not be inspected.'); });
    return () => { active = false; };
  }, [session?.user.id, onboardingData.userId, onboardingData.householdId, onboardingHouseholdContext]);
  const visiblePendingStatus = pendingScopeAvailable ? pendingStatus : 'Sign in to inspect pending changes and checkpoints.';
  const visiblePendingOperations = pendingScopeAvailable ? pendingOperations : [];
  const currentBackup = async () => {
    const current = owner();
    const backupOwner = {
      userId: current.userId,
      householdId: current.householdId,
      membershipVersion: current.membershipVersion,
      role: current.role,
    };
    if (savingRef.current || await refreshPending() > 0 || transactions.some(tx => tx.isPending)) throw new Error('Unconfirmed local changes must be resolved before backup or preflight.');
    const verified = await loadUserOnboardingData(session!, { householdId: current.householdId });
    if (verified.householdId !== current.householdId || JSON.stringify(verified) !== JSON.stringify(onboardingData)) throw new Error('Current settings or debts differ from the verified household. Refresh and resolve local changes first.');
    const records = await loadFinanceRecords({ session, userId: current.userId, currency: currencyCode, householdContext: current.householdContext });
    if (records.syncStatus !== 'synced' || records.pendingWriteCount > 0 || await refreshPending() > 0) throw new Error('A complete confirmed finance snapshot is unavailable. Connect and resolve pending changes first.');
    if (JSON.stringify(records.transactions) !== JSON.stringify(transactions) || JSON.stringify(records.recurringBills) !== JSON.stringify(recurringBills) || JSON.stringify(records.reconciliationAnchors) !== JSON.stringify(reconciliationAnchors)) throw new Error('Displayed records differ from the verified snapshot. Refresh before continuing.');
    return createNativeBackup({ userId: current.userId, householdId: current.householdId, currency: currencyCode, exportedAt: new Date().toISOString(), onboardingData: verified, transactions: records.transactions, recurringBills: records.recurringBills, reconciliationAnchors: records.reconciliationAnchors }, backupOwner);
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
    const { userId: uid, householdId: hid, membershipVersion, role } = owner();
    const backupOwner = { userId: uid, householdId: hid, membershipVersion, role };
    const parsed = parseNativeBackup(backupText, backupOwner);
    if (parsed.backup.transactions.some(tx => tx.isPending)) throw new Error('The backup contains unconfirmed transactions.');
    const plan = createRestorePlan(parsed.backup, current, backupOwner);
    const counts = plan.operations.reduce((acc, op) => { acc[op.action]++; return acc; }, { create: 0, unchanged: 0, conflict: 0 });
    setBackupMessage(`Validated: ${parsed.backup.onboardingData.debts.length} debts, ${parsed.backup.transactions.length} transactions, ${parsed.backup.recurringBills.length} bills, ${parsed.backup.reconciliationAnchors.length} anchors. Preflight: ${counts.create} new, ${counts.unchanged} unchanged, ${counts.conflict} conflicts. ${parsed.warnings.join(' ')} Restoration requires a verified atomic service.`);
  });
  const refreshRecoveryState = async () => {
    const current = owner();
    const verified = await loadUserOnboardingData(session!, { householdId: current.householdId });
    if (verified.userId !== current.userId || verified.householdId !== current.householdId) throw new Error('The current household could not be verified.');
    const records = await loadFinanceRecords({ session, userId: current.userId, currency: currencyCode, householdContext: current.householdContext });
    const remaining = await refreshPending();
    if (records.snapshotStatus !== 'authoritative' || records.pendingWriteCount > 0 || remaining > 0) {
      throw new Error('Some changes remain unresolved or the complete server state is unavailable. Displayed balances have not been refreshed.');
    }
    onUpdateOnboardingData(verified);
    onUpdateTransactions?.(records.transactions);
    onUpdateRecurringBills?.(records.recurringBills);
    onUpdateReconciliationAnchors?.(records.reconciliationAnchors);
  };
  const performRecovery = async (command: HouseholdPendingCommand, action: 'retry' | 'accept_server_state') => {
    await runBackupAction(async () => {
      const current = owner();
      let recoveryError: unknown;
      try {
        if (action === 'retry') {
          await recoverPendingFinanceWrites({ userId: current.userId, householdContext: current.householdContext, session, action, commandId: command.commandId });
        } else {
          await recoverPendingFinanceWrites({ userId: current.userId, householdContext: current.householdContext, session, action, acknowledgeServerState: true, commandId: command.commandId });
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
  const confirmRetry = (command: HouseholdPendingCommand) => setConfirmPrompt({
    title: 'Retry this change?',
    message: 'This change was never sent. Retry it now?',
    confirmLabel: 'Retry',
    destructive: false,
    icon: 'reset',
    onConfirm: () => {
      setConfirmPrompt(null);
      void performRecovery(command, 'retry');
    },
  });
  const confirmServerState = (command: HouseholdPendingCommand) => setConfirmPrompt({
    title: 'Review current server state',
    message: 'The outcome of this change is not proven. Adopting the current server state discards the local provisional intent while preserving archived evidence. This does not confirm whether the original change happened.',
    confirmLabel: 'Adopt server state',
    destructive: true,
    onConfirm: () => {
      setConfirmPrompt(null);
      void performRecovery(command, 'accept_server_state');
    },
  });
  const refreshConfirmation = () => setConfirmPrompt({
    title: 'Refresh confirmation?',
    message: 'Check the server for evidence of pending finance writes. This does not retry a write; unresolved operations may still need review.',
    confirmLabel: 'Refresh confirmation',
    destructive: false,
    icon: 'reset',
    onConfirm: () => {
      setConfirmPrompt(null);
      void runBackupAction(async () => {
        const current = owner();
        await recoverPendingFinanceWrites({ userId: current.userId, householdContext: current.householdContext, session, action: 'readback' });
        await refreshRecoveryState();
        setBackupMessage('Confirmation and current server state refreshed.');
      });
    },
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      const [theme, haptics] = await Promise.all([
        readLocalPref(userId, 'theme'),
        readLocalPref(userId, 'haptics'),
      ]);
      if (!active) return;
      if (theme === 'System' || theme === 'Dark' || theme === 'Light' || theme === 'Inspire') {
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
    return onboardingData.householdName ?? `${first}'s Household`;
  }, [displayName, onboardingData.householdName]);

  const saveHouseholdName = async () => {
    if (settingsUncertain) { setPrefsError('Check the unconfirmed settings save before making another change.'); return; }
    if (!isOwner) { setPrefsError('Only the household owner can rename the household.'); return; }
    const name = householdDraft.trim();
    if (!name || name.length > 120) { setPrefsError('Enter a household name of 1 to 120 characters.'); return; }
    if (savingRef.current) return;
    if (!session) { setPrefsError('Sign in to save household settings.'); return; }
    savingRef.current = true;
    setSavingPrefs(true);
    setPrefsError('');
    setPrefsNotice('');
    try {
      const confirmed = await saveUserOnboardingSettingsPatch(onboardingData, { householdName: name }, session);
      onUpdateOnboardingData(confirmed);
      void onRefreshHouseholdContexts?.();
      setEditingHousehold(false);
      setPrefsNotice('Household name saved.');
      triggerSubtleHaptic();
    } catch (err) {
      const outcome = settingsFailureSnapshot(err, onboardingData);
      if (outcome.uncertain) onSettingsUncertain?.();
      onUpdateOnboardingData(outcome.data);
      setPrefsError(err instanceof Error ? err.message : 'Unable to save household name.');
    } finally {
      savingRef.current = false;
      setSavingPrefs(false);
    }
  };

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
        role: verifiedContext ? toDisplayRole(verifiedContext.role) : 'Owner',
      },
    ];
  }, [displayName, session, verifiedContext]);

  const refreshCollaborationState = useCallback(async (overrideData?: UserOnboardingData) => {
    const targetData = overrideData ?? onboardingData;
    const context = targetData.householdContext;
    if (
      !session?.user?.id
      || session.user.id !== targetData.userId
      || !context
      || context.userId !== session.user.id
      || context.householdId !== targetData.householdId
    ) {
      setRosterMembers([]);
      setInvitations([]);
      return;
    }
    setCollabLoading(true);
    try {
      const membersRes = await listHouseholdMembers(session, context);
      setRosterMembers(membersRes.members);
      if (context.role === 'owner') {
        const invitesRes = await listHouseholdInvitations(session, context);
        setInvitations(invitesRes.invitations);
      } else {
        setInvitations([]);
      }
      setCollabError('');
    } catch (err) {
      setCollabError(err instanceof Error ? err.message : 'Unable to load household members.');
    } finally {
      setCollabLoading(false);
    }
  }, [session, onboardingData]);

  const [scopedCollabKey, setScopedCollabKey] = useState(`${session?.user?.id ?? ''}:${onboardingData.householdId}`);
  const currentCollabKey = `${session?.user?.id ?? ''}:${onboardingData.householdId}`;
  if (scopedCollabKey !== currentCollabKey) {
    setScopedCollabKey(currentCollabKey);
    setLatestInvite(null);
    setEditingHousehold(false);
    setCollabError('');
    setCollabNotice('');
    setRosterMembers([]);
    setInvitations([]);
  }

  useEffect(() => {
    let active = true;
    const context = onboardingHouseholdContext;
    if (
      !session?.user?.id
      || session.user.id !== onboardingData.userId
      || !context
      || context.userId !== session.user.id
      || context.householdId !== onboardingData.householdId
    ) {
      return;
    }
    const membersPromise = listHouseholdMembers(session, context);
    const invitesPromise = context.role === 'owner'
      ? listHouseholdInvitations(session, context)
      : Promise.resolve({ invitations: [] as HouseholdInvitationSummary[] });
    void Promise.all([membersPromise, invitesPromise]).then(([membersRes, invitesRes]) => {
      if (!active) return;
      setRosterMembers(membersRes.members);
      setInvitations(invitesRes.invitations);
      setCollabError('');
    }).catch(err => {
      if (!active) return;
      setCollabError(err instanceof Error ? err.message : 'Unable to load household members.');
    });
    return () => { active = false; };
  }, [
    session,
    onboardingData.userId,
    onboardingData.householdId,
    onboardingHouseholdContext,
  ]);

  const syncHouseholdAfterCollabMutation = async () => {
    if (!session) return;
    const fresh = await loadUserOnboardingData(session, { householdId: onboardingData.householdId });
    onUpdateOnboardingData(fresh);
    await onRefreshHouseholdContexts?.();
    await refreshCollaborationState(fresh);
  };

  const runCollabAction = async (fn: () => Promise<void>) => {
    if (collabBusy) return;
    setCollabBusy(true);
    setCollabError('');
    setCollabNotice('');
    try {
      await fn();
      triggerSubtleHaptic();
    } catch (err) {
      setCollabError(err instanceof Error ? err.message : 'Unable to complete household action.');
    } finally {
      setCollabBusy(false);
    }
  };

  const handleCreateInvite = () => void runCollabAction(async () => {
    const current = owner();
    if (current.role !== 'owner') throw new Error('Only the household owner can invite members.');
    const result = await createHouseholdInvitation(session!, current.householdContext, {
      inviteeEmail: inviteEmail,
      role: inviteRole,
    });
    setLatestInvite(result);
    setInviteEmail('');
    setCollabNotice(result.delivery.message);
    await syncHouseholdAfterCollabMutation();
  });

  const handleRotateInvite = (invitationId: string) => void runCollabAction(async () => {
    const current = owner();
    if (current.role !== 'owner') throw new Error('Only the household owner can rotate invitations.');
    const result = await rotateHouseholdInvitation(session!, current.householdContext, invitationId);
    setLatestInvite(result);
    setCollabNotice(result.delivery.message);
    await syncHouseholdAfterCollabMutation();
  });

  const handleRevokeInvite = (invitationId: string, emailHint: string) => {
    setConfirmPrompt({
      title: 'Revoke invitation?',
      message: `Cancel the pending invitation for ${emailHint}?`,
      confirmLabel: 'Revoke',
      cancelLabel: 'Keep invite',
      destructive: true,
      onConfirm: () => {
        setConfirmPrompt(null);
        void runCollabAction(async () => {
          const current = owner();
          await cancelHouseholdInvitation(session!, current.householdContext, invitationId);
          setCollabNotice(`Invitation for ${emailHint} revoked.`);
          await syncHouseholdAfterCollabMutation();
        });
      },
    });
  };

  const handleShareInvite = async (invite: CreatedOrRotatedInviteResult) => {
    try {
      const webUrl = invite.inviteWebUrl || buildHouseholdInviteWebUrl(invite.rawToken);
      const roleDescription = invite.role === 'viewer' ? 'viewer (read-only)' : 'member (can edit finances)';
      const shareTitle = `Join ${householdName} on DebtFree`;
      await Share.share(
        Platform.select({
          ios: {
            title: shareTitle,
            url: webUrl,
            message: `You're invited to join "${householdName}" on DebtFree as a ${roleDescription}.\n\nTap to join:\n${webUrl}\n\nInvite code: ${invite.rawToken}`,
          },
          default: {
            title: shareTitle,
            message: `You're invited to join "${householdName}" on DebtFree as a ${roleDescription}.\n\nTap the link to join:\n${webUrl}\n\nOr enter this invite code in Settings → Household:\n${invite.rawToken}`,
          },
        })
      );
    } catch (err) {
      setCollabError(err instanceof Error ? err.message : 'Unable to open the share sheet.');
    }
  };

  const handleToggleMemberRole = (member: HouseholdMemberSummary) => void runCollabAction(async () => {
    const current = owner();
    if (current.role !== 'owner') throw new Error('Only the household owner can change member roles.');
    const nextRole: HouseholdInvitationRole = member.role === 'viewer' ? 'member' : 'viewer';
    await updateHouseholdMemberRole(session!, current.householdContext, {
      memberUserId: member.userId,
      role: nextRole,
    });
    setCollabNotice(`Updated member role to ${nextRole === 'member' ? 'Member' : 'Viewer'}.`);
    await syncHouseholdAfterCollabMutation();
  });

  const handleRemoveMember = (member: HouseholdMemberSummary) => {
    const label = member.emailHint ?? member.userId;
    setConfirmPrompt({
      title: 'Remove household member?',
      message: `Remove ${label} from ${householdName}? They will immediately lose access to this household.`,
      confirmLabel: 'Remove',
      destructive: true,
      onConfirm: () => {
        setConfirmPrompt(null);
        void runCollabAction(async () => {
          const current = owner();
          await removeHouseholdMember(session!, current.householdContext, member.userId);
          setCollabNotice(`Removed ${label} from ${householdName}.`);
          await syncHouseholdAfterCollabMutation();
        });
      },
    });
  };

  const handleTransferOwnership = (member: HouseholdMemberSummary) => {
    const label = member.emailHint ?? member.userId;
    setConfirmPrompt({
      title: 'Transfer household ownership?',
      message: `Make ${label} the owner of ${householdName}? You will become a Member and will no longer control invitations or ownership.`,
      confirmLabel: 'Transfer ownership',
      destructive: true,
      onConfirm: () => {
        setConfirmPrompt(null);
        void runCollabAction(async () => {
          const current = owner();
          await transferHouseholdOwnership(session!, current.householdContext, member.userId);
          setCollabNotice(`Ownership transferred to ${label}.`);
          await syncHouseholdAfterCollabMutation();
        });
      },
    });
  };

  const handleLeaveHousehold = () => {
    setConfirmPrompt({
      title: 'Leave this household?',
      message: `Leave ${householdName}? Your personal households remain separate and untouched.`,
      confirmLabel: 'Leave household',
      cancelLabel: 'Stay',
      destructive: true,
      onConfirm: () => {
        setConfirmPrompt(null);
        void runCollabAction(async () => {
          const current = owner();
          await leaveHousehold(session!, current.householdContext);
          await onRefreshHouseholdContexts?.();
          setCollabNotice(`You left ${householdName}.`);
        });
      },
    });
  };

  const handleJoinHousehold = () => void runCollabAction(async () => {
    if (!session) throw new Error('Sign in before joining a household.');
    const trimmed = joinInput.trim();
    if (!trimmed) throw new Error('Paste an invite link or invite code first.');
    if (onAcceptHouseholdInvite) {
      await onAcceptHouseholdInvite(trimmed);
    } else {
      await acceptHouseholdInvitation(session, trimmed);
      await onRefreshHouseholdContexts?.();
    }
    setJoinInput('');
    setCollabNotice('Joined household and switched your active view.');
  });

  const handleSelectHouseholdSwitch = (targetHouseholdId: string) => {
    if (!onSwitchHousehold || switchingHouseholdId || targetHouseholdId === onboardingData.householdId) return;
    setSwitchingHouseholdId(targetHouseholdId);
    setCollabError('');
    setCollabNotice('');
    void onSwitchHousehold(targetHouseholdId)
      .then(() => {
        setCollabNotice('Switched active household.');
        triggerSubtleHaptic();
      })
      .catch(err => {
        setCollabError(err instanceof Error ? err.message : 'Unable to switch households.');
      })
      .finally(() => {
        setSwitchingHouseholdId(null);
      });
  };

  const persistOnboardingPatch = async (
    patch: Partial<UserOnboardingData>,
    successMessage?: string,
  ) => {
    if (settingsUncertain && !('notifications' in patch)) { setPrefsError('Check the unconfirmed settings save before making another change.'); return; }
    if (!canEdit) { setPrefsError('View-only members cannot modify household settings.'); return; }
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
        const confirmed = 'notifications' in patch
          ? await saveUserOnboardingData(candidate, { personalOnly: true })
          : await saveUserOnboardingSettingsPatch(onboardingData, patch, session);
        onUpdateOnboardingData(confirmed);
      }
      triggerSubtleHaptic();
      if (successMessage) setPrefsNotice(successMessage);
    } catch (err) {
      const outcome = settingsFailureSnapshot(err, onboardingData);
      if (outcome.uncertain) onSettingsUncertain?.();
      onUpdateOnboardingData(outcome.data);
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
        setConfirmPrompt({
          title: 'Unconfirmed finance changes',
          message: 'Some finance operations are unconfirmed or need review. Signing out may leave them unresolved on this device.',
          confirmLabel: 'Sign out anyway',
          cancelLabel: 'Stay signed in',
          destructive: true,
          onConfirm: () => {
            setConfirmPrompt(null);
            onClose();
            void onSignOut();
          },
        });
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
    if (value !== 'System' && value !== 'Dark' && value !== 'Light' && value !== 'Inspire') return;
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
    if (!isOwner) { setPrefsError('Only the household owner can change the household currency.'); return; }
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
    if (!canEdit) { setPrefsError('View-only members cannot change household timezone.'); return; }
    if (nextZone === onboardingData.householdTimeZone) return;
    void persistOnboardingPatch(
      { householdTimeZone: nextZone },
      `Household timezone set to ${nextZone}.`,
    );
  };

  // Handlers: Section 4 (Preferences)
  const handleSelectStrategy = (strategy: PayoffStrategy) => {
    if (!canEdit) { setPrefsError('View-only members cannot change payoff strategy.'); return; }
    if (onboardingData.strategy === strategy) return;
    void persistOnboardingPatch(
      { strategy },
      `Payoff strategy set to ${strategy === 'snowball' ? 'Snowball' : 'Avalanche'}.`,
    );
  };

  const handleSaveExtraPayment = () => {
    if (!canEdit) { setPrefsError('View-only members cannot change extra monthly payment.'); return; }
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
    if (!canEdit) { setPrefsError('View-only members cannot change notification settings.'); return; }
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
  const handleOpenExternalDoc = async (url: string | null) => {
    if (!url) {
      setPrefsError('This web page is not configured yet.');
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Alert.alert('Unable to open browser', `Visit ${url} for full documentation.`);
    }
  };

  const confirmDeleteAccount = () => {
    if (!accountDeletionEnabled || !onDeleteAccount || deletingAccount || !session) return;
    setConfirmPrompt({
      title: 'Delete your account?',
      message: 'Deleting your account cannot be undone. An owned household is removed only when the server confirms that you are its sole active member and it contains no financial data. Shared or non-empty households must be transferred first. Any unresolved, rejected, dispatched, uncertain, or stale-version finance command blocks deletion. Device finance data is removed only after account deletion is confirmed.',
      confirmLabel: 'Delete account',
      destructive: true,
      onConfirm: () => {
        setConfirmPrompt(null);
        setDeletingAccount(true);
        setPrefsError('');
        void onDeleteAccount().catch(error => {
          setDeletingAccount(false);
          setPrefsError(error instanceof Error ? error.message : 'Account deletion could not be confirmed. Your local data was kept.');
        });
      },
    });
  };

  const fontScalePercent = Math.round((fontScale || 1) * 100);
  const displayedMemberCount = session && rosterMembers.length > 0 ? rosterMembers.length : householdMembers.length;
  const settingsPageTitle: Record<SettingsPage, string> = {
    appearance: 'Appearance',
    household: 'Household',
    preferences: 'Payoff preferences',
    notifications: 'Notifications',
    security: 'Security',
    support: 'Help & information',
    data: 'Data & security',
  };
  const SETTING_ROW_ICONS: Record<string, AppIconName> = {
    'Theme': 'theme',
    'Accent color': 'palette',
    'Text size': 'textSize',
    'Notifications': 'bell',
    'Payoff preferences': 'flag',
    'Members': 'users',
    'Currency & timezone': 'globe',
    'Security': 'shield',
    'Backup & recovery': 'reset',
    'Help & support': 'info',
  };
  const settingGroups: { title: string; rows: { label: string; detail?: string; page?: SettingsPage }[] }[] = [
    { title: 'PREFERENCES', rows: [
      { label: 'Theme', detail: themePreference, page: 'appearance' },
      { label: 'Accent color', detail: accentColor, page: 'appearance' },
      { label: 'Text size', detail: `${fontScalePercent}%`, page: 'appearance' },
      { label: 'Notifications', detail: 'Payment & progress alerts', page: 'notifications' },
      { label: 'Payoff preferences', detail: 'Strategy and extra payment', page: 'preferences' },
    ] },
    { title: 'HOUSEHOLD', rows: [
      { label: 'Members', detail: `${displayedMemberCount} ${displayedMemberCount === 1 ? 'member' : 'members'}`, page: 'household' },
      { label: 'Currency & timezone', detail: currencyCode, page: 'household' },
    ] },
    { title: 'DATA & SECURITY', rows: [
      { label: 'Security', detail: 'Account and sign-in', page: 'security' },
      { label: 'Backup & recovery', detail: 'Export and review backups', page: 'data' },
    ] },
    { title: 'HELP & INFORMATION', rows: [
      { label: 'Help & support', detail: 'Guides, privacy and terms', page: 'support' },
    ] },
  ];

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: palette.surface, borderBottomColor: palette.border, zIndex: 10, elevation: 2 }]}>
        {activeSettingsPage ? (
          <Pressable accessibilityRole="button" accessibilityLabel={editingHousehold ? 'Cancel household editing' : `Back to Settings from ${settingsPageTitle[activeSettingsPage]}`} disabled={savingPrefs} hitSlop={10} onPress={() => { if (editingHousehold) { setEditingHousehold(false); setPrefsError(''); } else setActiveSettingsPage(null); }} style={styles.backButton}>
            <AppIcon name="chevronLeft" size={20} color={palette.text} />
          </Pressable>
        ) : <View style={styles.headerRightSpacer} />}
        <Text accessibilityRole="header" style={ui.title}>
          {editingHousehold ? 'Edit household' : activeSettingsPage ? settingsPageTitle[activeSettingsPage] : 'Settings'}
        </Text>
        {!activeSettingsPage ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Close Settings" disabled={savingPrefs} hitSlop={10} onPress={onClose} style={styles.closeSettingsButton}>
            <AppIcon name="close" size={20} color={palette.muted} />
          </Pressable>
        ) : <View style={styles.headerRightSpacer} />}
      </View>

      <ScrollView
        style={{ flex: 1, overflow: 'hidden' }}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 24) + 16 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!!prefsError ? (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorBannerText}>{prefsError}</Text>
          </View>
        ) : null}
        {!!prefsNotice ? (
          <View style={[styles.noticeBanner, { backgroundColor: palette.tint, borderColor: palette.brand }]} accessibilityLiveRegion="polite">
            <Text style={[styles.noticeBannerText, { color: palette.brand }]}>{prefsNotice}</Text>
          </View>
        ) : null}

        {activeSettingsPage === null ? (
          <View style={styles.settingsIndex}>
            <Pressable accessibilityRole="button" accessibilityLabel="Account and sign-in" onPress={() => setActiveSettingsPage('security')} style={[styles.profileRow, { backgroundColor: palette.tint, borderRadius: 14, padding: 13, marginBottom: 4 }]}><View style={[styles.avatarCircle, { backgroundColor: palette.hero, borderColor: palette.hero }]}><AppIcon name="user" size={22} color={palette.onHero} /></View><View style={styles.flex1}><Text style={ui.heading}>{displayName}</Text><Text style={ui.small}>{userEmail}</Text></View><AppIcon name="chevronRight" size={18} color={palette.brand} /></Pressable>
            {settingGroups.map(group => (
              <View key={group.title}>
                <Text style={[styles.sectionHeader, { color: palette.brand }]}>{group.title}</Text>
                <Card style={styles.menuCard}>
                  {group.rows.map((row, index) => (
                    <Pressable key={row.label} accessibilityRole="button" accessibilityState={{ disabled: !row.page }} accessibilityLabel={`${row.label}${row.detail ? `, ${row.detail}` : ''}`} disabled={!row.page} onPress={() => row.page && setActiveSettingsPage(row.page)} style={[styles.menuRow, index > 0 && ui.divider, !row.page && styles.disabledMenuRow]}>
                      <AppIcon name={SETTING_ROW_ICONS[row.label] ?? 'info'} size={18} color={palette.muted} />
                      <View style={[styles.flex1, { gap: 3 }]}><Text style={styles.menuRowTitle}>{row.label}</Text>{row.detail && row.detail.length > 16 ? <Text style={[styles.menuRowDetail, { fontSize: 12 }]}>{row.detail}</Text> : null}</View>
                      {row.detail && row.detail.length <= 16 ? <Text style={styles.menuRowDetail}>{row.detail}</Text> : null}
                      <AppIcon name="chevronRight" size={18} color={palette.muted} />
                    </Pressable>
                  ))}
                </Card>
              </View>
            ))}
            {savingPrefs ? <ActivityIndicator size="small" color={palette.brand} /> : null}
          </View>
        ) : null}

        {/* ================================================================ */}
        {activeSettingsPage === 'security' && <>
        {/* SECTION 1: ACCOUNT & SECURITY                                    */}
        {/* ================================================================ */}
        <Text style={[styles.sectionHeader, { color: palette.brand }]}>ACCOUNT & SECURITY</Text>
        <Card>
          <View style={styles.profileRow}>
            <View style={[styles.avatarCircle, { backgroundColor: palette.tint, borderColor: palette.brand }]}>
              <AppIcon name="user" size={22} color={palette.brand} />
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
                <ActivityIndicator size="small" color="#F08B78" />
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
        <Text style={[styles.sectionHeader, { color: palette.brand }]}>APPEARANCE & DISPLAY</Text>
        <Card>
          <View style={styles.fieldGroup}>
            <Text style={styles.rowTitle}>Theme</Text>
            <Text style={styles.rowSub}>
              {isInspire ? 'Playful teal sky & encouraging notes' : 'Choose your theme'}
            </Text>
            <View style={{ marginTop: 8 }}>
              <Segments
                items={THEME_OPTIONS}
                selected={themePreference}
                onSelect={handleSelectTheme}
              />
            </View>
          </View>

          <View style={ui.divider}>
            <Text style={styles.rowTitle}>Accent color</Text>
            {isInspire ? (
              <Text style={styles.rowSub}>Accent color applies to Dark and Light themes. Inspire uses its own coastal sky palette.</Text>
            ) : null}
            {appearanceError ? <Text accessibilityRole="alert" style={{ color: palette.text }}>{appearanceError}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, opacity: isInspire ? 0.5 : 1 }}>
              {(['Indigo', 'Cobalt'] as const).map(color => <Pressable key={color} accessibilityRole="radio" accessibilityState={{ checked: accentColor === color, disabled: isInspire }} disabled={isInspire} onPress={() => { void setAccentColor(color).catch(() => Alert.alert('Unable to save accent color', 'Please try again.')); }} style={{ flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderRadius: 9, borderColor: accentColor === color ? palette.brand : palette.border, backgroundColor: accentColor === color ? palette.tint : palette.surface }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: color === 'Indigo' ? '#5147A8' : '#0051FB' }} /><Text style={{ color: accentColor === color ? palette.brand : palette.text }}>{color}</Text></View></Pressable>)}
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
              subtitle="Use your device text size"
              checked={dynamicTextEnabled}
              onToggle={handleToggleDynamicText}
            />
          </View>

          <View style={ui.divider}>
            <SettingSwitchRow
              title="Haptic feedback"
              subtitle="Confirm saves with a vibration"
              checked={hapticsEnabled}
              onToggle={handleToggleHaptics}
            />
          </View>
        </Card>

        {/* ================================================================ */}
        </>}
        {activeSettingsPage === 'household' && editingHousehold && <Card>
          <Text style={styles.subLabel}>Household name *</Text>
          <TextInput accessibilityLabel="Household name, required" value={householdDraft} onChangeText={setHouseholdDraft} maxLength={120} editable={!savingPrefs && isOwner} style={[styles.modalTextInput, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]} />
          <View style={[ui.row, { marginTop: 16, justifyContent: 'flex-end' }]}>
            <Pressable accessibilityRole="button" disabled={savingPrefs} onPress={() => { setEditingHousehold(false); setPrefsError(''); }} style={ui.button}><Text style={ui.buttonText}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={savingPrefs || !isOwner} onPress={() => void saveHouseholdName()} style={ui.button}><Text style={[ui.buttonText, { color: palette.brand }]}>{savingPrefs ? 'Saving…' : 'Save'}</Text></Pressable>
          </View>
        </Card>}
        {activeSettingsPage === 'household' && !editingHousehold && <>
        {/* SECTION 3: HOUSEHOLD & REGIONAL                                  */}
        {/* ================================================================ */}
        <Text style={[styles.sectionHeader, { color: palette.brand }]}>HOUSEHOLD &amp; COLLABORATION</Text>
        {!!collabError ? (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorBannerText}>{collabError}</Text>
          </View>
        ) : null}
        {!!collabNotice ? (
          <View style={[styles.noticeBanner, { backgroundColor: palette.tint, borderColor: palette.brand }]} accessibilityLiveRegion="polite">
            <Text style={[styles.noticeBannerText, { color: palette.brand }]}>{collabNotice}</Text>
          </View>
        ) : null}

        {session && householdSummaries.length > 0 ? (
          <Card>
            <Text style={styles.subLabel}>Your Households</Text>
            <Text style={[ui.small, { marginBottom: 8 }]}>
              Switch between households you belong to. Each household keeps separate accounts and financial history.
            </Text>
            <View style={styles.rosterList}>
              {householdSummaries.map(summary => {
                const isCurrent = summary.householdId === onboardingData.householdId;
                const isSwitchingThis = switchingHouseholdId === summary.householdId;
                return (
                  <View key={summary.householdId} style={[styles.rosterRow, isCurrent && { borderColor: palette.brand }]}>
                    <View style={styles.flex1}>
                      <View style={[ui.row, { gap: 8, alignItems: 'center' }]}>
                        <Text style={styles.rowTitle}>{summary.householdName}</Text>
                        <RoleBadge role={toDisplayRole(summary.role)} />
                      </View>
                      <Text style={styles.rowSub}>{`${summary.currencyCode} · ${isCurrent ? 'Active household' : 'Tap Switch to open'}`}</Text>
                    </View>
                    {isCurrent ? (
                      <View style={[styles.statusBadge, styles.statusBadgeActive]}>
                        <Text style={[styles.statusBadgeText, styles.statusBadgeTextActive]}>Active</Text>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Switch to household ${summary.householdName}`}
                        disabled={Boolean(switchingHouseholdId) || collabBusy}
                        onPress={() => handleSelectHouseholdSwitch(summary.householdId)}
                        style={[ui.button, (Boolean(switchingHouseholdId) || collabBusy) && styles.disabled]}
                      >
                        <Text style={[ui.buttonText, { color: palette.brand }]}>{isSwitchingThis ? 'Switching…' : 'Switch'}</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          </Card>
        ) : null}

        <Card>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <View style={styles.flex1}>
              <Text style={styles.subLabel}>Household Name</Text>
              <View style={[ui.row, { gap: 8, alignItems: 'center', flexWrap: 'wrap' }]}>
                <Text style={ui.heading}>{householdName}</Text>
                {verifiedContext ? <RoleBadge role={toDisplayRole(verifiedContext.role)} /> : null}
              </View>
              <Text style={ui.small}>{`ID: ${onboardingData.householdId}`}</Text>
            </View>
            {isOwner ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit household"
                onPress={() => {
                  setHouseholdDraft(householdName);
                  setPrefsError('');
                  setEditingHousehold(true);
                }}
                style={ui.button}
              >
                <Text style={[ui.buttonText, { color: palette.brand }]}>Edit</Text>
              </Pressable>
            ) : null}
          </View>
          {!canEdit ? (
            <Text style={[ui.small, { marginTop: 8 }]}>
              View-only access: you can inspect this household’s finances, switch households, or leave. Only members or owners can make edits.
            </Text>
          ) : null}

          <View style={ui.divider}>
            <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <Text style={styles.subLabel}>Member Roster</Text>
              {collabLoading ? <ActivityIndicator size="small" color={palette.brand} /> : null}
            </View>
            <View style={styles.rosterList}>
              {(session && rosterMembers.length > 0 ? rosterMembers : null)?.map(member => (
                <View key={member.userId} style={[styles.rosterRow, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
                  <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                    <View style={styles.flex1}>
                      <Text style={styles.rowTitle}>
                        {(member.emailHint ?? (member.isSelf ? userEmail : member.userId)) + (member.isSelf ? ' (You)' : '')}
                      </Text>
                      <Text style={styles.rowSub}>
                        {member.joinedAt ? `Joined ${member.joinedAt.slice(0, 10)}` : 'Active member'}
                      </Text>
                    </View>
                    <RoleBadge role={toDisplayRole(member.role)} />
                  </View>
                  {isOwner && !member.isSelf ? (
                    <View style={[ui.row, { gap: 8, flexWrap: 'wrap' }]}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={collabBusy}
                        onPress={() => handleToggleMemberRole(member)}
                        style={[ui.button, collabBusy && styles.disabled]}
                      >
                        <Text style={[ui.buttonText, { color: palette.brand }]}>
                          {member.role === 'viewer' ? 'Make Member' : 'Make Viewer'}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={collabBusy}
                        onPress={() => handleTransferOwnership(member)}
                        style={[ui.button, collabBusy && styles.disabled]}
                      >
                        <Text style={[ui.buttonText, { color: '#F5C563' }]}>Transfer ownership</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={collabBusy}
                        onPress={() => handleRemoveMember(member)}
                        style={[ui.button, collabBusy && styles.disabled]}
                      >
                        <Text style={[ui.buttonText, { color: '#F08B78' }]}>Remove</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {!isOwner && member.isSelf ? (
                    <View style={[ui.row, { justifyContent: 'flex-start' }]}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={collabBusy}
                        onPress={handleLeaveHousehold}
                        style={[ui.button, collabBusy && styles.disabled]}
                      >
                        <Text style={[ui.buttonText, { color: '#F08B78' }]}>Leave household</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              )) ?? householdMembers.map(member => (
                <View key={member.id} style={styles.rosterRow}>
                  <View style={styles.flex1}>
                    <Text style={styles.rowTitle}>{member.name}</Text>
                    <Text style={styles.rowSub}>{member.detail}</Text>
                  </View>
                  <RoleBadge role={member.role} />
                </View>
              ))}
            </View>
            {session && !isOwner && rosterMembers.length === 0 ? (
              <View style={[ui.row, { marginTop: 10 }]}>
                <Pressable
                  accessibilityRole="button"
                  disabled={collabBusy}
                  onPress={handleLeaveHousehold}
                  style={[ui.button, collabBusy && styles.disabled]}
                >
                  <Text style={[ui.buttonText, { color: '#F08B78' }]}>Leave household</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {session && isOwner ? (
            <View style={ui.divider}>
              <Text style={styles.subLabel}>Invite Member (up to 3 total)</Text>
              <Text style={[ui.small, { marginBottom: 8 }]}>
                Invite a partner as a Member (can edit) or an advisor as a Viewer (read-only).
              </Text>
              <TextInput
                accessibilityLabel="Invitee email address"
                placeholder="partner@example.com"
                placeholderTextColor="#6E7571"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!collabBusy}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                style={[styles.modalTextInput, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border, fontSize: 14, fontWeight: '500', letterSpacing: 0 }]}
              />
              <View style={[ui.row, { gap: 8, marginTop: 8 }]}>
                {(['member', 'viewer'] as const).map(roleOption => {
                  const selected = inviteRole === roleOption;
                  return (
                    <Pressable
                      key={roleOption}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      disabled={collabBusy}
                      onPress={() => setInviteRole(roleOption)}
                      style={[
                        styles.strategyOption,
                        selected && [styles.strategyOptionSelected, { backgroundColor: palette.tint, borderColor: palette.brand }],
                      ]}
                    >
                      <Text style={[styles.strategyTitle, selected && [styles.strategyTitleSelected, { color: palette.brand }]]}>
                        {roleOption === 'member' ? 'Member (Edit)' : 'Viewer (Read-only)'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create household invitation"
                disabled={collabBusy || !inviteEmail.trim()}
                onPress={handleCreateInvite}
                style={[styles.primaryInlineBtn, { backgroundColor: ctaBg, marginTop: 10 }, (collabBusy || !inviteEmail.trim()) && styles.disabled]}
              >
                <Text style={[styles.primaryInlineBtnText, { color: ctaFg }]}>{collabBusy ? 'Sending…' : 'Send Invite'}</Text>
              </Pressable>

              {latestInvite ? (
                <View style={[styles.rosterRow, { flexDirection: 'column', alignItems: 'stretch', gap: 6, marginTop: 12, borderColor: palette.brand }]}>
                  <Text style={[ui.small, { color: palette.brand, fontWeight: '700' }]}>INVITE READY TO SHARE</Text>
                  <Text style={ui.small}>{latestInvite.delivery.message}</Text>
                  <Text style={ui.small} selectable>{`Web Link: ${latestInvite.inviteWebUrl || buildHouseholdInviteWebUrl(latestInvite.rawToken)}`}</Text>
                  <Text style={ui.small} selectable>{`Invite Code: ${latestInvite.rawToken}`}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleShareInvite(latestInvite)}
                    style={[ui.button, { alignSelf: 'flex-start', marginTop: 4 }]}
                  >
                    <Text style={[ui.buttonText, { color: palette.brand }]}>Share invite link</Text>
                  </Pressable>
                </View>
              ) : null}

              {invitations.length > 0 ? (
                <View style={{ marginTop: 12, gap: 8 }}>
                  <Text style={styles.subLabel}>Pending Invitations</Text>
                  {invitations.map(inv => (
                    <View key={inv.invitationId} style={[styles.rosterRow, { flexDirection: 'column', alignItems: 'stretch', gap: 6 }]}>
                      <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                        <View style={styles.flex1}>
                          <Text style={styles.rowTitle}>{inv.emailHint}</Text>
                          <Text style={styles.rowSub}>
                            {inv.expired ? 'Expired' : `Expires ${inv.expiresAt.slice(0, 10)} · ${inv.deliveryState}`}
                          </Text>
                        </View>
                        <RoleBadge role={inv.role === 'member' ? 'Member' : 'Viewer'} />
                      </View>
                      <View style={[ui.row, { gap: 8, flexWrap: 'wrap' }]}>
                        <Pressable
                          accessibilityRole="button"
                          disabled={collabBusy}
                          onPress={() => handleRotateInvite(inv.invitationId)}
                          style={[ui.button, collabBusy && styles.disabled]}
                        >
                          <Text style={[ui.buttonText, { color: palette.brand }]}>Resend / Rotate link</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          disabled={collabBusy}
                          onPress={() => handleRevokeInvite(inv.invitationId, inv.emailHint)}
                          style={[ui.button, collabBusy && styles.disabled]}
                        >
                          <Text style={[ui.buttonText, { color: '#F08B78' }]}>Revoke</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {session ? (
            <View style={ui.divider}>
              <Text style={styles.subLabel}>Join a Household</Text>
              <Text style={[ui.small, { marginBottom: 8 }]}>
                Paste an invite link or code sent to your account email. Joining switches your active view; your existing household data stays separate and is never merged.
              </Text>
              <TextInput
                accessibilityLabel="Invite link or invite code"
                placeholder="Paste invite link or code"
                placeholderTextColor="#6E7571"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!collabBusy}
                value={joinInput}
                onChangeText={setJoinInput}
                style={[styles.modalTextInput, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border, fontSize: 13, fontWeight: '500', letterSpacing: 0 }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Join household"
                disabled={collabBusy || !joinInput.trim()}
                onPress={handleJoinHousehold}
                style={[styles.primaryInlineBtn, { backgroundColor: ctaBg, marginTop: 10 }, (collabBusy || !joinInput.trim()) && styles.disabled]}
              >
                <Text style={[styles.primaryInlineBtnText, { color: ctaFg }]}>{collabBusy ? 'Joining…' : 'Join Household'}</Text>
              </Pressable>
            </View>
          ) : null}

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
            ) : !isOwner ? (
              <Text style={styles.lockedCaption}>
                Only the household owner can change the household currency.
              </Text>
            ) : (
              <SelectDropdown
                label="Change Currency"
                sheetTitle="Select ISO 4217 Currency"
                value={currencyCode}
                options={currencyDropdownOptions}
                disabled={!isOwner}
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
              disabled={!canEdit}
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
        <Text style={[styles.sectionHeader, { color: palette.brand }]}>PREFERENCES</Text>
        <Card>
          {!canEdit ? (
            <View style={{ backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <Text style={ui.small}>View-only access: only household members or owners can update payoff preferences.</Text>
            </View>
          ) : null}
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
                    accessibilityState={{ selected, disabled: !canEdit }}
                    accessibilityLabel={
                      strategy === 'snowball'
                        ? 'Snowball: Lowest balance first'
                        : 'Avalanche: Highest APR first'
                    }
                    disabled={!canEdit}
                    onPress={() => handleSelectStrategy(strategy)}
                    style={[
                      styles.strategyOption,
                      selected && [styles.strategyOptionSelected, { backgroundColor: palette.tint, borderColor: palette.brand }],
                      !canEdit && styles.disabled,
                    ]}
                  >
                    <AppIcon
                      name={strategy}
                      size={16}
                      color={selected ? palette.brand : palette.muted}
                    />
                    <View style={styles.flex1}>
                      <Text
                        style={[
                          styles.strategyTitle,
                          selected && [styles.strategyTitleSelected, { color: palette.brand }],
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
                <Text style={[styles.currencyPrefix, { color: palette.brand }]}>{currencySymbol}</Text>
                <TextInput
                  accessibilityLabel="Extra monthly payment"
                  keyboardType="decimal-pad"
                  editable={canEdit}
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
              {canEdit ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save extra monthly payment"
                  disabled={savingPrefs}
                  onPress={handleSaveExtraPayment}
                  style={[styles.primaryInlineBtn, { backgroundColor: ctaBg }, savingPrefs && styles.disabled]}
                >
                  <Text style={[styles.primaryInlineBtnText, { color: ctaFg }]}>Save</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

        </Card>
        </>}
        {activeSettingsPage === 'notifications' && <>
        <Text style={[styles.sectionHeader, { color: palette.brand }]}>NOTIFICATIONS</Text>
        <Card>
          <View>
            {!canEdit ? (
              <View style={{ backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <Text style={ui.small}>View-only access: only household members or owners can change notification preferences.</Text>
              </View>
            ) : null}
            <Text style={[styles.subLabel, { marginBottom: 4 }]}>Notification Alerts</Text>
            <SettingSwitchRow
              title="Upcoming payment reminders"
              subtitle="Receive a heads-up before scheduled bills and minimums are due"
              checked={onboardingData.notifications.upcomingReminders}
              disabled={savingPrefs || !canEdit}
              onToggle={() => void handleToggleNotification('upcomingReminders')}
            />
            <SettingSwitchRow
              title="Past-due alerts"
              subtitle="Get notified immediately when an obligation becomes overdue"
              checked={onboardingData.notifications.overdueAlerts}
              disabled={savingPrefs || !canEdit}
              onToggle={() => void handleToggleNotification('overdueAlerts')}
            />
            <SettingSwitchRow
              title="Milestones & progress"
              subtitle="Celebrate debt payoff milestones and monthly progress summaries"
              checked={onboardingData.notifications.milestonesAndProgress}
              disabled={savingPrefs || !canEdit}
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
        <Text style={[styles.sectionHeader, { color: palette.brand }]}>SUPPORT & LEGAL</Text>
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
              <AppIcon name="chevronRight" size={18} color={palette.brand} />
            </Pressable>
          ))}
        </Card>

        {/* ================================================================ */}
        </>}
        {activeSettingsPage === 'data' && <>
        {/* SECTION 6: DANGER ZONE                                           */}
        {/* ================================================================ */}
        <Text style={[styles.sectionHeader, { color: '#F08B78' }]}>ACCOUNT DELETION</Text>
        <Card style={styles.dangerCard}>
          <Text style={ui.heading}>Delete account and data</Text>
          <Text style={ui.small}>Permanently remove your DebtFree sign-in and associated cloud financial data. Financial data reset and backup restore are not available in this release.</Text>
          {accountDeletionEnabled && session ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Delete account and data" disabled={deletingAccount || authBusy} onPress={confirmDeleteAccount} style={[styles.dangerButton, (deletingAccount || authBusy) && styles.disabled]}>
              {deletingAccount ? <ActivityIndicator size="small" color="#F08B78" /> : <AppIcon name="reset" size={16} color="#F08B78" />}
              <Text style={styles.dangerButtonText}>{deletingAccount ? 'Deleting account…' : 'Delete account'}</Text>
            </Pressable>
          ) : <Text style={styles.rowSub}>Account deletion is not configured in this build yet.</Text>}
          {process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL ? (
            <Pressable accessibilityRole="link" onPress={() => void handleOpenExternalDoc(process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL ?? null)} style={styles.linkRow}>
              <Text style={styles.rowTitle}>Request deletion on the DebtFree website</Text>
              <AppIcon name="chevronRight" size={18} color={palette.brand} />
            </Pressable>
          ) : null}
        </Card>

        <Text style={[styles.sectionHeader, { color: palette.brand }]}>BACKUP & RECOVERY</Text>
        <Card>
          <Text style={ui.heading}>Native backup</Text>
          <Text style={ui.small}>Export a validated JSON snapshot or review a pasted backup. Full restore is not available in this release.</Text>
          <Text style={ui.small}>{visiblePendingStatus}</Text>
          {visiblePendingOperations.map((command, index) => {
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
          <Text style={ui.small}>{checkpoint ? `Checkpoint: ${checkpoint.status}; ${checkpoint.cursor} of ${checkpoint.plan.operations.length} operations. ${checkpoint.plan.conflicts} conflicts.` : 'No checkpoint found.'}</Text>
          {checkpoint ? <Pressable accessibilityRole="button" disabled={backupBusy} onPress={() => void runBackupAction(async () => { await Share.share({ title: 'DebtFree recovery checkpoint JSON', message: JSON.stringify(checkpoint, null, 2) }); })} style={styles.devSecondaryButton}><Text style={styles.devSecondaryButtonText}>Export checkpoint JSON</Text></Pressable> : null}
          {!!backupMessage && <Text accessibilityRole="alert" style={styles.rowSub}>{backupMessage}</Text>}
        </Card>
        </>}

        <InspireQuote
          slot="settingsFooter"
          color="#0B89A8"
          style={{ textAlign: 'center', marginTop: 10, paddingHorizontal: 12 }}
        />
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
                    {SUPPORT_DOCS[activeDoc].url ? <View style={[ui.row, { marginTop: 16 }]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Open full page in browser"
                        onPress={() => void handleOpenExternalDoc(SUPPORT_DOCS[activeDoc].url)}
                        style={[styles.primaryModalBtn, { backgroundColor: ctaBg }, styles.flex1]}
                      >
                        <Text style={[styles.primaryModalBtnText, { color: ctaFg }]}>Open in Browser</Text>
                      </Pressable>
                    </View> : <Text style={[ui.small, { marginTop: 16 }]}>The official web page will be configured before public release.</Text>}
                  </>
                ) : null}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <ConfirmModal
        visible={confirmPrompt !== null}
        title={confirmPrompt?.title ?? ''}
        message={confirmPrompt?.message ?? ''}
        confirmLabel={confirmPrompt?.confirmLabel}
        cancelLabel={confirmPrompt?.cancelLabel}
        destructive={confirmPrompt?.destructive ?? true}
        icon={confirmPrompt?.icon ?? 'warning'}
        onConfirm={() => confirmPrompt?.onConfirm()}
        onCancel={() => setConfirmPrompt(null)}
      />

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
    backgroundColor: '#121614', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#222A25',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#1C2420', borderWidth: 1, borderColor: '#28372E',
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
    backgroundColor: '#1C2420', borderWidth: 1, borderColor: '#28372E',
  },
  closeSettingsText: {
    color: '#F9F9F6',
    fontSize: 25,
    fontWeight: '400',
    lineHeight: 28,
  },
  settingsIndex: {
    gap: 6,
  },
  menuCard: {
    padding: 0,
    gap: 0,
    overflow: 'hidden',
    borderRadius: 16,
  },
  menuRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
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
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 32,
    gap: 10,
  },
  sectionHeader: {
    color: '#76DCB9',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.9,
    marginTop: 4,
    paddingHorizontal: 16,
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
    fontSize: 12,
    fontWeight: '700',
  },
  statusBadgeTextActive: {
    color: '#76DCB9',
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
    fontSize: 13,
    lineHeight: 18,
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
    backgroundColor: '#76DCB9',
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
    backgroundColor: 'rgba(240, 139, 120, 0.12)', borderWidth: 1, borderColor: '#5C382E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutButtonText: {
    color: '#F08B78',
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
    backgroundColor: '#141816',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#222A25',
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
    fontSize: 12,
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
    color: '#F5C563',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  lockedCaption: {
    color: '#AAB3AD',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  strategyOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#141816', borderWidth: 1, borderColor: '#222A25',
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  strategyOptionSelected: {
    backgroundColor: '#1C2721', borderColor: '#76DCB9',
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
    fontSize: 12,
  },
  currencyPrefix: {
    color: '#76DCB9',
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
    backgroundColor: '#76DCB9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryInlineBtnText: {
    color: '#0C0E0D',
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
    borderColor: '#F5C563',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  devBadgeText: {
    color: '#F5C563',
    fontSize: 12,
    fontWeight: '800',
  },
  devButton: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: '#2E3B37',
    borderWidth: 1,
    borderColor: '#76DCB9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  devButtonText: {
    color: '#76DCB9',
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
    color: '#F5C563',
    fontSize: 12,
    fontWeight: '700',
  },
  devSuccessText: {
    color: '#76DCB9',
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
    color: '#76DCB9',
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
    color: '#F5C563',
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
    backgroundColor: '#76DCB9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryModalBtnText: {
    color: '#0C0E0D',
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
