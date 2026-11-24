import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from '@expo-google-fonts/montserrat/useFonts';
import { Montserrat_400Regular } from '@expo-google-fonts/montserrat/400Regular';
import { Montserrat_500Medium } from '@expo-google-fonts/montserrat/500Medium';
import { Montserrat_700Bold } from '@expo-google-fonts/montserrat/700Bold';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets, initialWindowMetrics } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as SecureStore from 'expo-secure-store';
import { captureExceptionSafely } from './src/telemetry';
import { createInvitationIntentStore, invitationForUser, joinHouseholdWithRecovery, withStartupDeadline, type InvitationIntent } from './src/invitation-intent';
import type { Session } from '@supabase/supabase-js';
import {
  configurationProblem,
  isConfigured,
  listenAppState,
  onAuthInvalidated,
  createSessionVerification,
  signInWithApple,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  verifiedSession,
  getSupabaseClient,
} from './src/auth';
import {
  resolveAuthenticatedStage,
  type FlowStage,
  type UserOnboardingData,
} from './src/onboarding-domain';
import {
  clearUserDeviceDataAfterAccountDeletion,
  loadUserOnboardingData,
  HouseholdDataUnavailableError,
  resetUserOnboardingData,
} from './src/onboarding-storage';
import { deleteAuthenticatedAccount, getPendingAccountDeletionRequest, prepareAccountDeletionRequest, type AccountDeletionRequest } from './src/account-deletion';
import { listVerifiedHouseholdContexts, loadVerifiedHouseholdContext, saveHouseholdSelectionHint } from './src/household-service';
import { createSelectionCommitter } from './src/selection-commit';
import type { HouseholdContext, HouseholdMembershipSummary } from './src/household-context';
import {
  acceptHouseholdInvitation,
  parseHouseholdInviteInput,
  switchVerifiedHousehold,
} from './src/household-collaboration';
import { recoveryFailure, resolveRecoverySourceContext } from './src/recovery-domain';
import { AccountRecoveryScreen } from './src/screens/AccountRecoveryScreen';
import { FontText as Text, NativeAppearanceProvider } from './src/components/NativeAppearance';
import { repairDebtCategory } from './src/debt-category-repair';
import { getPendingFinanceSummary, recoverPendingFinanceWrites } from './src/finance-storage';
import { AppIcon } from './src/components/AppIcon';
import { DebtFreeFlow } from './src/OnboardingAndHome';
import { acceptOnboardingSnapshot } from './src/onboarding-snapshot';
import {
  PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA,
} from './src/finance/prototype-loader';
import { seedPrototypeHouseholdToStorage } from './src/finance-storage';
import { isLocalAcceptanceEnabled, loadLocalAcceptanceFixture, saveLocalAcceptanceFixture } from './src/dev/local-acceptance';

type AuthScreenState = 'checking' | 'ready' | 'unavailable' | 'deletion_pending' | 'invitation' | 'recovery';

const invitationStore = createInvitationIntentStore({
  getItem: key => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  removeItem: key => SecureStore.deleteItemAsync(key),
});

const commitHouseholdSelection = createSelectionCommitter(saveHouseholdSelectionHint);

function LocalAcceptanceEntry() {
  const [data, setData] = useState<UserOnboardingData | null>(null);
  const [stage, setStage] = useState<FlowStage>('home');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    loadLocalAcceptanceFixture().then(fixture => {
      if (active) { setData(fixture); setStage('home'); }
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : String(err));
    });
    return () => { active = false; };
  }, []);

  if (!data) return (
    <View style={styles.root}>
      <SafeAreaView style={styles.centered} edges={['top', 'bottom', 'left', 'right']}>
        {error ? <Text accessibilityRole="alert" style={styles.unavailableError}>{`Local acceptance setup failed: ${error}`}</Text> : <ActivityIndicator size="large" color="#58CBD0" />}
      </SafeAreaView>
    </View>
  );

  return <DebtFreeFlow
    key={`local-acceptance-${data.userId}`}
    session={null}
    onboardingData={data}
    stage={stage}
    onChangeStage={setStage}
    onUpdateOnboardingData={next => {
      if (next.userId !== 'local-acceptance-owner-v1' || next.householdId !== 'hh-local-acceptance-owner-v1') return;
      setData(next);
      void saveLocalAcceptanceFixture(next).then(setData).catch(err => setError(err instanceof Error ? err.message : String(err)));
    }}
    onGoogleSignIn={async () => null}
    onAppleSignIn={async () => null}
    onEmailSignIn={async () => false}
    onEmailSignUp={async () => false}
    onSignOut={async () => {}}
    onDeleteAccount={async () => {}}
    accountDeletionEnabled={false}
    appleAvailable={false}
    configured={false}
    configProblem={null}
    authBusy={false}
    authError={error}
    authNotice=""
    onClearAuthError={() => setError('')}
  />;
}

function RootApp() {
  const insets = useSafeAreaInsets();
  const [authState, setAuthState] = useState<AuthScreenState>('checking');
  const [session, setSession] = useState<Session | null>(null);
  const [onboardingData, setOnboardingData] = useState<UserOnboardingData | null>(null);
  const [stage, setStageState] = useState<FlowStage>('welcome');
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingDeletionRequest, setPendingDeletionRequest] = useState<AccountDeletionRequest | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [householdSummaries, setHouseholdSummaries] = useState<HouseholdMembershipSummary[]>([]);

  const [recoveryIssue, setRecoveryIssue] = useState<HouseholdDataUnavailableError | null>(null);
  const recoveryContextRef = useRef<HouseholdContext | null>(null);
  const onboardingDataRef = useRef<UserOnboardingData | null>(null);
  const sourceContext = async (currentSession: Session): Promise<HouseholdContext | null> => {
    const known = onboardingDataRef.current?.householdContext ?? recoveryContextRef.current;
    return resolveRecoverySourceContext(currentSession.user.id, known,
      () => listVerifiedHouseholdContexts(currentSession),
      async () => (await loadVerifiedHouseholdContext(currentSession, { suppressBootstrap: true })).selected);
  };
  const generation = useRef(0);
  const busyRef = useRef(false);
  const invalidatedWhileBusy = useRef(false);
  const mounted = useRef(false);
  const authStateRef = useRef<AuthScreenState>('checking');
  const sessionRef = useRef<Session | null>(null);
  const stageRef = useRef<FlowStage>('welcome');
  const [pendingInvite, setPendingInvite] = useState<InvitationIntent | null>(null);
  const pendingInviteRef = useRef<InvitationIntent | null>(null);
  const deferredInviteRef = useRef<string | null>(null);
  const rememberInvite = useCallback((intent: InvitationIntent | null) => {
    pendingInviteRef.current = intent;
    setPendingInvite(intent);
  }, []);

  const configured = isConfigured();
  const configProblem = configurationProblem();

  const setStage = useCallback((next: FlowStage) => {
    stageRef.current = next;
    setStageState(next);
  }, []);

  const setAuthScreen = useCallback((next: AuthScreenState) => {
    authStateRef.current = next;
    setAuthState(next);
  }, []);

  useEffect(() => {
    onboardingDataRef.current = onboardingData;
  }, [onboardingData]);

  const refreshHouseholdContexts = useCallback(async (): Promise<HouseholdMembershipSummary[]> => {
    const currentSession = sessionRef.current;
    if (!currentSession) {
      setHouseholdSummaries([]);
      return [];
    }
    const request = generation.current;
    let summaries = await listVerifiedHouseholdContexts(currentSession);
    if (!mounted.current || request !== generation.current || sessionRef.current?.user.id !== currentSession.user.id) return summaries;
    const activeHouseholdId = onboardingDataRef.current?.householdId;
    if (summaries.length > 0) {
      setHouseholdSummaries(summaries);
      const targetHouseholdId = activeHouseholdId && summaries.some(summary => summary.householdId === activeHouseholdId)
        ? activeHouseholdId
        : summaries[0].householdId;
      const freshData = await loadUserOnboardingData(currentSession, { householdId: targetHouseholdId });
      if (mounted.current && request === generation.current && sessionRef.current?.user.id === currentSession.user.id) {
        setOnboardingData(freshData);
        setStage(resolveAuthenticatedStage(freshData));
        void commitHouseholdSelection(currentSession.user.id, targetHouseholdId,
          () => mounted.current && request === generation.current && sessionRef.current?.user.id === currentSession.user.id).catch(() => {});
      }
      return summaries;
    }

    // When 0 summaries exist (e.g. user just left a household), bootstrap a personal household safely
    const freshData = await loadUserOnboardingData(currentSession);
    const refreshedSummaries = await listVerifiedHouseholdContexts(currentSession);
    if (mounted.current && request === generation.current && sessionRef.current?.user.id === currentSession.user.id) {
      setHouseholdSummaries(refreshedSummaries);
      setOnboardingData(freshData);
      setStage(resolveAuthenticatedStage(freshData));
      void commitHouseholdSelection(currentSession.user.id, freshData.householdId,
        () => mounted.current && request === generation.current && sessionRef.current?.user.id === currentSession.user.id).catch(() => {});
    }
    return refreshedSummaries;
  }, [setStage]);

  const presentPendingInviteAfterBusy = useCallback(async () => {
    const currentSession = sessionRef.current;
    if (!currentSession || busyRef.current || !mounted.current || authStateRef.current === 'deletion_pending') return;
    const stored = await invitationStore.load();
    const intent = invitationForUser(stored, currentSession.user.id);
    if (intent && !busyRef.current && mounted.current && sessionRef.current?.user.id === currentSession.user.id
        && deferredInviteRef.current !== `${currentSession.user.id}:${intent.token}`) {
      rememberInvite(intent);
      setAuthScreen('invitation');
    }
  }, [rememberInvite, setAuthScreen]);

  const handleSwitchHousehold = useCallback(async (targetHouseholdId: string): Promise<void> => {
    if (busyRef.current) throw new Error('Another account action is already running.');
    const currentSession = sessionRef.current;
    if (!currentSession) {
      throw new Error('Sign in before switching households.');
    }
    const request = ++generation.current;
    const ownsBusy = !busyRef.current;
    if (ownsBusy) { busyRef.current = true; setBusy(true); }
    try {
      const source = await sourceContext(currentSession);
      if (!mounted.current || request !== generation.current || sessionRef.current?.user.id !== currentSession.user.id) throw new Error('The household switch was superseded by a newer account action.');
      const result = await withStartupDeadline(switchVerifiedHousehold(
        currentSession,
        targetHouseholdId,
        source,
      ));
      if (!mounted.current || request !== generation.current || sessionRef.current?.user.id !== currentSession.user.id) {
        throw new Error('The household switch was superseded by a newer account action.');
      }
      setHouseholdSummaries(result.summaries);
      onboardingDataRef.current = result.onboardingData;
      setOnboardingData(result.onboardingData);
      setStage(resolveAuthenticatedStage(result.onboardingData));
      recoveryContextRef.current = null;
      setRecoveryIssue(null);
      setAuthScreen('ready');
      void commitHouseholdSelection(currentSession.user.id, result.onboardingData.householdId,
        () => mounted.current && request === generation.current && sessionRef.current?.user.id === currentSession.user.id).catch(() => {});
    } finally {
      if (ownsBusy) {
        busyRef.current = false;
        if (mounted.current) setBusy(false);
        void presentPendingInviteAfterBusy().catch(() => {});
      }
    }
  }, [setStage, presentPendingInviteAfterBusy]);

  const handleRepairDebtCategory = useCallback(async (diagnostic: NonNullable<typeof recoveryIssue>['diagnostics'][number], category: import('./src/debt-category-repair').RepairCategory): Promise<void> => {
    if (busyRef.current) throw new Error('Another account action is already running.');
    const currentSession = sessionRef.current;
    const context = recoveryContextRef.current;
    if (!currentSession || !context || context.userId !== currentSession.user.id) {
      throw new Error('The signed-in household could not be verified. No category was changed.');
    }
    const request = ++generation.current;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await repairDebtCategory({ session: currentSession, context, diagnostic, category }, {
        getClient: getSupabaseClient,
        createSessionVerification,
        listVerifiedHouseholdContexts,
        getPendingFinanceSummary,
      });
      if (!mounted.current || request !== generation.current || sessionRef.current?.user.id !== currentSession.user.id
          || recoveryContextRef.current?.householdId !== context.householdId) {
        throw new Error('The recovery action was superseded. Refresh household data before continuing.');
      }
      const refreshed = await loadUserOnboardingData(currentSession, { householdId: context.householdId });
      if (!mounted.current || request !== generation.current || sessionRef.current?.user.id !== currentSession.user.id) {
        throw new Error('The recovery action was superseded. Refresh household data before continuing.');
      }
      recoveryContextRef.current = null;
      setRecoveryIssue(null);
      onboardingDataRef.current = refreshed;
      setOnboardingData(refreshed);
      setHouseholdSummaries(current => current.map(summary => summary.householdId === refreshed.householdId
        ? { ...summary, role: context.role, membershipVersion: context.membershipVersion }
        : summary));
      setStage(resolveAuthenticatedStage(refreshed));
      setAuthScreen('ready');
      setError('');
    } catch (err) {
      if (err instanceof HouseholdDataUnavailableError && mounted.current && request === generation.current
          && sessionRef.current?.user.id === currentSession.user.id) {
        recoveryContextRef.current = err.context;
        setRecoveryIssue(err);
        setHouseholdSummaries(err.summaries);
      } else if (!(err instanceof HouseholdDataUnavailableError) && mounted.current && request === generation.current) {
        setError(err instanceof Error ? err.message : 'The category could not be confirmed. Refresh to check the latest account information.');
      }
      throw err;
    } finally {
      if (mounted.current && request === generation.current) {
        busyRef.current = false;
        setBusy(false);
        void presentPendingInviteAfterBusy().catch(() => {});
      }
    }
  }, [presentPendingInviteAfterBusy, setStage, setAuthScreen]);

  const runPendingFinanceRecovery = useCallback(async (mode: 'readback' | 'accept_all_server_state'): Promise<void> => {
    if (busyRef.current) throw new Error('Another account action is already running.');
    const currentSession = sessionRef.current;
    const context = recoveryContextRef.current;
    if (!currentSession || !context || context.userId !== currentSession.user.id) {
      throw new Error('The signed-in household could not be verified. Refresh and try again.');
    }
    const request = ++generation.current;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const recovery = await recoverPendingFinanceWrites(
        mode === 'readback'
          ? { userId: currentSession.user.id, householdContext: context, session: currentSession, action: 'readback' }
          : { userId: currentSession.user.id, householdContext: context, session: currentSession, action: 'accept_all_server_state', acknowledgeServerState: true },
      );
      if (!mounted.current || request !== generation.current || sessionRef.current?.user.id !== currentSession.user.id
          || recoveryContextRef.current?.householdId !== context.householdId) {
        throw new Error('The recovery action was superseded. Refresh household data before continuing.');
      }
      const remainingCount = recovery.operations.filter(op => !op.resolution).length;
      if (remainingCount > 0) {
        const updatedIssue = new HouseholdDataUnavailableError(
          context,
          recoveryIssue?.summaries ?? householdSummaries,
          recoveryIssue?.diagnostics ?? [],
          {
            recoveryKind: 'pending_finance_commands',
            pendingOperationCount: remainingCount,
            message: `${remainingCount} pending finance ${remainingCount === 1 ? 'change' : 'changes'} could not be confirmed on the server. Tap "Use Server Data & Continue" to archive local evidence and open your household.`,
          },
        );
        setRecoveryIssue(updatedIssue);
        setError(updatedIssue.message);
        throw updatedIssue;
      }
      const refreshed = await loadUserOnboardingData(currentSession, { householdId: context.householdId });
      if (!mounted.current || request !== generation.current || sessionRef.current?.user.id !== currentSession.user.id) {
        throw new Error('The recovery action was superseded. Refresh household data before continuing.');
      }
      recoveryContextRef.current = null;
      setRecoveryIssue(null);
      onboardingDataRef.current = refreshed;
      setOnboardingData(refreshed);
      setHouseholdSummaries(current => current.map(summary => summary.householdId === refreshed.householdId
        ? { ...summary, role: context.role, membershipVersion: context.membershipVersion }
        : summary));
      setStage(resolveAuthenticatedStage(refreshed));
      setAuthScreen('ready');
      setError('');
    } catch (err) {
      if (err instanceof HouseholdDataUnavailableError && mounted.current && request === generation.current
          && sessionRef.current?.user.id === currentSession.user.id) {
        recoveryContextRef.current = err.context;
        setRecoveryIssue(err);
        if (err.summaries.length > 0) setHouseholdSummaries(err.summaries);
        setError(err.message);
      } else if (!(err instanceof HouseholdDataUnavailableError) && mounted.current && request === generation.current) {
        setError(err instanceof Error ? err.message : 'Unable to recover pending household changes. Refresh and try again.');
      }
      throw err;
    } finally {
      if (mounted.current && request === generation.current) {
        busyRef.current = false;
        setBusy(false);
        void presentPendingInviteAfterBusy().catch(() => {});
      }
    }
  }, [householdSummaries, presentPendingInviteAfterBusy, recoveryIssue?.diagnostics, recoveryIssue?.summaries, setAuthScreen, setStage]);

  const handleSyncAndRecoverPending = useCallback(() => runPendingFinanceRecovery('readback'), [runPendingFinanceRecovery]);
  const handleAcceptServerStateAndContinue = useCallback(() => runPendingFinanceRecovery('accept_all_server_state'), [runPendingFinanceRecovery]);

  const handleAcceptHouseholdInvite = useCallback(async (rawTokenOrUrl: string): Promise<void> => {
    const currentSession = sessionRef.current;
    const token = parseHouseholdInviteInput(rawTokenOrUrl);
    if (!currentSession || !token) throw new Error('Sign in with the invited account and open a valid invitation.');
    if (busyRef.current) throw new Error('Another account action is already running.');
    const request = ++generation.current;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const source = await sourceContext(currentSession);
      if (!mounted.current || request !== generation.current || sessionRef.current?.user.id !== currentSession.user.id) throw new Error('The account action was superseded.');
      const { result: switched, intent } = await joinHouseholdWithRecovery({
        userId: currentSession.user.id, token, store: invitationStore,
        accept: () => acceptHouseholdInvitation(currentSession, token),
        open: async householdId => withStartupDeadline(switchVerifiedHousehold(
          currentSession, householdId, source,
        )),
        onIntent: intent => {
          if (mounted.current && request === generation.current && sessionRef.current?.user.id === currentSession.user.id) rememberInvite(intent);
        },
      });
      if (!mounted.current || request !== generation.current || sessionRef.current?.user.id !== currentSession.user.id) return;
      if (!await invitationStore.clear(intent)) {
        rememberInvite(await invitationStore.load());
        setAuthScreen('invitation');
        return;
      }
      rememberInvite(null);
      setHouseholdSummaries(switched.summaries);
      void commitHouseholdSelection(currentSession.user.id, switched.onboardingData.householdId,
        () => mounted.current && request === generation.current && sessionRef.current?.user.id === currentSession.user.id).catch(() => {});
      onboardingDataRef.current = switched.onboardingData;
      setOnboardingData(switched.onboardingData);
      setStage(resolveAuthenticatedStage(switched.onboardingData));
      setAuthScreen('ready');
      setNotice('Joined shared household.');
    } catch (err) {
      if (mounted.current && request === generation.current) {
        setError(err instanceof Error ? err.message : 'Joining could not be confirmed. Try again or check your households.');
        if (pendingInviteRef.current) setAuthScreen('invitation');
      }
      throw err;
    } finally {
      if (mounted.current && request === generation.current) {
        busyRef.current = false;
        setBusy(false);
        void presentPendingInviteAfterBusy().catch(() => {});
      }
    }
  }, [rememberInvite, setStage, setAuthScreen, presentPendingInviteAfterBusy]);

  const receiveInvite = useCallback(async (token: string) => {
    const intent = await invitationStore.receive(token);
    if (!mounted.current) return;
    rememberInvite(intent);
    deferredInviteRef.current = null;
    const currentSession = sessionRef.current;
    if (currentSession && invitationForUser(intent, currentSession.user.id) && !busyRef.current) {
      ++generation.current;
      setAuthScreen('invitation');
      setError('');
    } else setNotice('Sign in with the invited account to join your household.');
  }, [rememberInvite, setAuthScreen]);

  const loadEntry = useCallback(async (nextSession: Session) => {
    const stored = await invitationStore.load();
    const intent = invitationForUser(stored, nextSession.user.id);
    if (intent && deferredInviteRef.current !== `${nextSession.user.id}:${intent.token}`) {
      return { data: null, summaries: [] as HouseholdMembershipSummary[], intent };
    }
    let summaries: HouseholdMembershipSummary[] = [];
    const data = await loadUserOnboardingData(nextSession, {
      onMembershipsVerified: verified => { summaries = verified; },
    });
    const latestIntent = invitationForUser(await invitationStore.load(), nextSession.user.id);
    if (latestIntent && deferredInviteRef.current !== `${nextSession.user.id}:${latestIntent.token}`) {
      return { data, summaries, intent: latestIntent };
    }
    return { data, summaries, intent: null };
  }, []);

  const validate = useCallback(async (options?: { silent?: boolean }) => {
    const request = ++generation.current;
    const hadSession = sessionRef.current !== null;
    if (!options?.silent) {
      // Protected UI is hidden while re-confirming the stored session with the auth server.
      setAuthScreen('checking');
    }
    let verified: Session | null = null;
    try {
      const nextSession = await withStartupDeadline(verifiedSession());
      let retrySession = nextSession;
      if (!retrySession) {
        const stored = await getSupabaseClient().auth.getSession();
        retrySession = stored.data.session;
      }
      if (retrySession) {
        const pendingDeletion = await getPendingAccountDeletionRequest(retrySession.user.id);
        if (pendingDeletion) {
          if (mounted.current && request === generation.current) {
            sessionRef.current = retrySession;
            setSession(retrySession);
            setOnboardingData(null);
            setHouseholdSummaries([]);
            setPendingDeletionRequest(pendingDeletion);
            setError('A previous account deletion has not returned a final receipt. Retry the same request to reconcile it.');
            setAuthScreen('deletion_pending');
          }
          return;
        }
      }
      verified = nextSession;
      if (mounted.current && request === generation.current) {
        sessionRef.current = nextSession; setSession(nextSession);
        recoveryContextRef.current = null; setRecoveryIssue(null);
      }
      const entry = nextSession ? await withStartupDeadline(loadEntry(nextSession)) : null;
      if (nextSession && entry) {
        const pending = invitationForUser(await invitationStore.load(), nextSession.user.id);
        if (pending && deferredInviteRef.current !== `${nextSession.user.id}:${pending.token}`) entry.intent = pending;
      }
      const nextData = entry?.data ?? null;
      const nextSummaries = entry?.summaries ?? [];
      if (mounted.current && request === generation.current) {
        sessionRef.current = nextSession;
        setSession(nextSession);
        onboardingDataRef.current = nextData;
        setOnboardingData(nextData);
        setHouseholdSummaries(nextSummaries);
        setPendingDeletionRequest(null);
        const incoming = nextSession ? invitationForUser(pendingInviteRef.current, nextSession.user.id) : null;
        if (entry && incoming && deferredInviteRef.current !== `${nextSession?.user.id}:${incoming.token}`) entry.intent = incoming;
        if (nextSession && entry?.intent) {
          rememberInvite(entry.intent);
          setError('');
          setAuthScreen('invitation');
        } else if (nextSession && nextData) {
          void commitHouseholdSelection(nextSession.user.id, nextData.householdId, () => mounted.current && request === generation.current).catch(() => {});
          setError('');
          const nextStage = resolveAuthenticatedStage(nextData);
          if (stageRef.current !== nextStage) {
            setStage(nextStage);
          }
          setAuthScreen('ready');

        } else {
          setStage(stageRef.current === 'signup_1' ? 'signup_1' : 'welcome');
          if (hadSession) {
            setNotice('Your session has ended. Please sign in again.');
          }
          setAuthScreen('ready');
        }
      }
    } catch (err) {
      if (mounted.current && request === generation.current) {
        // Keep the stored session, drafts and recovery state on transient errors.
        // Protected content stays hidden until a fresh verification succeeds.
        if (verified && sessionRef.current?.user.id === verified.user.id) {
          const detail = err instanceof HouseholdDataUnavailableError ? err : null;
          recoveryContextRef.current = detail?.context ?? null; setRecoveryIssue(detail);
          setOnboardingData(null); onboardingDataRef.current = null;
          if (detail) setHouseholdSummaries(detail.summaries);
          else void listVerifiedHouseholdContexts(verified).then(items => { if (mounted.current && request === generation.current && sessionRef.current?.user.id === verified?.user.id) setHouseholdSummaries(items); }).catch(() => {});
          const intent = invitationForUser(pendingInviteRef.current, verified.user.id);
          setAuthScreen(intent && deferredInviteRef.current !== `${verified.user.id}:${intent.token}` ? 'invitation' : recoveryFailure(true, detail?.context ?? null, detail?.summaries ?? [], detail?.diagnostics ?? []).route);
        } else { sessionRef.current = null; setSession(null); recoveryContextRef.current = null; setRecoveryIssue(null); setAuthScreen('unavailable'); }
        setError(err instanceof Error ? err.message : 'Unable to verify your account. Try again when connected.');
      }
    }
  }, [setAuthScreen, setStage, loadEntry, rememberInvite]);

  useEffect(() => {
    mounted.current = true;
    // Read the cold-start link before any loader can create a personal household.
    void (async () => {
      try {
        const url = await Linking.getInitialURL();
        const token = url ? parseHouseholdInviteInput(url) : null;
        if (token) await receiveInvite(token);
        else rememberInvite(await invitationStore.load());
        if (mounted.current) void validate();
      } catch (err) {
        if (mounted.current) {
          setError(err instanceof Error ? err.message : 'Unable to recover your invitation. Try again.');
          setAuthScreen('unavailable');
        }
      }
    })();
    const requests = generation;
    if (Platform.OS === 'ios' && process.env.EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED === 'true') {
      void AppleAuthentication.isAvailableAsync()
        .then(available => {
          if (mounted.current) setAppleAvailable(available);
        })
        .catch(() => {
          if (mounted.current) setAppleAvailable(false);
        });
    }
    const handleIncomingUrl = (url: string | null | undefined) => {
      if (!url || !mounted.current) return;
      const token = parseHouseholdInviteInput(url);
      if (!token) return;
      void receiveInvite(token).catch(err => { if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to save your invitation. Open the link again.'); });
    };
    const linkSub = Linking.addEventListener('url', event => handleIncomingUrl(event.url));
    const subscription = listenAppState(() => {
      // Re-verify silently on return to the foreground when an active session already rendered the app.
      if (
        !busyRef.current &&
        (sessionRef.current !== null || authStateRef.current === 'unavailable')
      ) {
        void validate({ silent: authStateRef.current === 'ready' && sessionRef.current !== null });
      }
    });
    const unsubscribe = onAuthInvalidated(() => {
      if (busyRef.current) {
        invalidatedWhileBusy.current = true;
        if (!sessionRef.current) return;
        ++generation.current;
        busyRef.current = false; setBusy(false);
      }
      if (mounted.current) {
        const hadSession = sessionRef.current !== null;
        ++generation.current;
        sessionRef.current = null;
        recoveryContextRef.current = null; setRecoveryIssue(null);
        setSession(null);
        setOnboardingData(null);
        setHouseholdSummaries([]);
        setStage('welcome');
        setAuthScreen('ready');
        if (hadSession) {
          setNotice('Your session has ended. Please sign in again.');
        }
      }
    });
    return () => {
      mounted.current = false;
      ++requests.current;
      linkSub.remove();
      subscription.remove();
      unsubscribe();
    };
  }, [validate, setAuthScreen, setStage, receiveInvite, rememberInvite]);

  const login = async (action: () => Promise<Session | null>): Promise<Session | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    invalidatedWhileBusy.current = false;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    let verified: Session | null = null;
    try {
      let next = await action();
      if (invalidatedWhileBusy.current && next) {
        next = await verifiedSession();
      }
      if (next) next = await verifiedSession();
      verified = next;
      if (mounted.current && request === generation.current) { sessionRef.current = next; setSession(next); recoveryContextRef.current = null; setRecoveryIssue(null); }
      // The browser sign-in itself remains user-paced; only data loading is bounded.
      const entry = next ? await withStartupDeadline(loadEntry(next)) : null;
      if (next && entry) {
        const pending = invitationForUser(await invitationStore.load(), next.user.id);
        if (pending && deferredInviteRef.current !== `${next.user.id}:${pending.token}`) entry.intent = pending;
      }
      const nextData = entry?.data ?? null;
      const nextSummaries = entry?.summaries ?? [];
      if (mounted.current && request === generation.current) {
        sessionRef.current = next;
        setSession(next);
        onboardingDataRef.current = nextData;
        setOnboardingData(nextData);
        setHouseholdSummaries(nextSummaries);
        const incoming = next ? invitationForUser(pendingInviteRef.current, next.user.id) : null;
        if (entry && incoming && deferredInviteRef.current !== `${next?.user.id}:${incoming.token}`) entry.intent = incoming;
        if (next && entry?.intent) {
          rememberInvite(entry.intent);
          setAuthScreen('invitation');
        } else if (next && nextData) {
          void commitHouseholdSelection(next.user.id, nextData.householdId, () => mounted.current && request === generation.current).catch(() => {});
          setStage(resolveAuthenticatedStage(nextData));
          setAuthScreen('ready');

        } else {
          setAuthScreen('ready');
        }
      }
      return next;
    } catch (err) {
      if (mounted.current && request === generation.current) {
        setOnboardingData(null); onboardingDataRef.current = null;
        if (verified && sessionRef.current?.user.id === verified.user.id) {
          const detail = err instanceof HouseholdDataUnavailableError ? err : null;
          recoveryContextRef.current = detail?.context ?? null; setRecoveryIssue(detail);
          if (detail) setHouseholdSummaries(detail.summaries);
          else void listVerifiedHouseholdContexts(verified).then(items => { if (mounted.current && request === generation.current && sessionRef.current?.user.id === verified?.user.id) setHouseholdSummaries(items); }).catch(() => {});
          const intent = invitationForUser(pendingInviteRef.current, verified.user.id);
          setAuthScreen(intent && deferredInviteRef.current !== `${verified.user.id}:${intent.token}` ? 'invitation' : recoveryFailure(true, detail?.context ?? null, detail?.summaries ?? [], detail?.diagnostics ?? []).route);
        } else { sessionRef.current = null; setSession(null); setHouseholdSummaries([]); recoveryContextRef.current = null; setRecoveryIssue(null); setAuthScreen('unavailable'); }
        setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
      }
      return null;
    } finally {
      if (mounted.current && request === generation.current) {
        busyRef.current = false;
        setBusy(false);
        void presentPendingInviteAfterBusy().catch(() => {});
      }
    }
  };

  const handleEmailSignIn = async (email: string, password: string) => Boolean(await login(() => signInWithEmail(email, password)));
  const handleEmailSignUp = async (email: string, password: string) => {
    let needsConfirmation = false;
    const session = await login(async () => {
      const result = await signUpWithEmail(email, password);
      needsConfirmation = result.needsEmailConfirmation;
      return result.session;
    });
    if (needsConfirmation && mounted.current) setNotice('Check your email for a confirmation link, then sign in.');
    return Boolean(session) || needsConfirmation;
  };

  const logout = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const request = ++generation.current;
    sessionRef.current = null;
    recoveryContextRef.current = null; setRecoveryIssue(null);
    setSession(null);
    setOnboardingData(null);
    setHouseholdSummaries([]);
    setStage('welcome');
    setAuthScreen('ready');
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await signOut();
    } catch {
      if (mounted.current && request === generation.current) {
        setError('Sign-out could not be fully confirmed. Please reconnect and try again.');
      }
    } finally {
      if (mounted.current && request === generation.current) {
        busyRef.current = false;
        setBusy(false);
        void presentPendingInviteAfterBusy().catch(() => {});
      }
    }
  };

  const deleteAccount = async () => {
    if (busyRef.current) throw new Error('Another account action is already running.');
    const currentSession = sessionRef.current;
    const currentData = onboardingData;
    if (!currentSession || !currentData || currentData.userId !== currentSession.user.id) {
      throw new Error('The signed-in account could not be verified. Your data was not changed.');
    }
    busyRef.current = true;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let deletionRequest = await getPendingAccountDeletionRequest(currentSession.user.id);
      if (!deletionRequest) {
        const memberships = await listVerifiedHouseholdContexts(currentSession);
        const deleteEmptyHouseholdIds = memberships.filter(context => context.role === 'owner').map(context => context.householdId);
        deletionRequest = await prepareAccountDeletionRequest(currentSession, deleteEmptyHouseholdIds);
      }
      await deleteAuthenticatedAccount(currentSession.user.id, deletionRequest);
      let localCleanupError: Error | null = null;
      try {
        await clearUserDeviceDataAfterAccountDeletion(currentSession.user.id, Object.keys(deletionRequest.expectedMembershipVersions));
      } catch (cleanupError) {
        localCleanupError = cleanupError instanceof Error ? cleanupError : new Error('Local account data could not be fully removed.');
      }
      sessionRef.current = null;
      setSession(null);
      setOnboardingData(null);
      setHouseholdSummaries([]);
      setPendingDeletionRequest(null);
      setStage('welcome');
      setAuthScreen('ready');
      setResetKey(previous => previous + 1);
      try { await signOut(); } catch { /* Auth deletion is already confirmed; local sign-out is still attempted by signOut(). */ }
      if (localCleanupError && mounted.current && request === generation.current) setError(localCleanupError.message);
    } finally {
      if (mounted.current && request === generation.current) {
        busyRef.current = false;
        setBusy(false);
        void presentPendingInviteAfterBusy().catch(() => {});
      }
    }
  };

  const retryPendingAccountDeletion = async () => {
    if (busyRef.current) return;
    const currentSession = sessionRef.current;
    const request = pendingDeletionRequest;
    if (!currentSession || !request) {
      setError('The saved deletion request could not be verified. Keep this device signed in and contact support.');
      return;
    }
    busyRef.current = true;
    const generationId = ++generation.current;
    setBusy(true);
    setError('');
    try {
      await deleteAuthenticatedAccount(currentSession.user.id, request);
      let cleanupError: Error | null = null;
      try {
        await clearUserDeviceDataAfterAccountDeletion(currentSession.user.id, Object.keys(request.expectedMembershipVersions));
      } catch (error) {
        cleanupError = error instanceof Error ? error : new Error('Local account data could not be fully removed.');
      }
      sessionRef.current = null;
      setSession(null);
      setOnboardingData(null);
      setHouseholdSummaries([]);
      setPendingDeletionRequest(null);
      setStage('welcome');
      setAuthScreen('ready');
      setResetKey(previous => previous + 1);
      try { await signOut(); } catch { /* deletion has a confirmed terminal receipt */ }
      if (cleanupError && mounted.current && generationId === generation.current) setError(cleanupError.message);
    } catch (error) {
      if (mounted.current && generationId === generation.current) {
        setError(error instanceof Error ? error.message : 'Deletion is still pending; retry the same operation when connected.');
      }
    } finally {
      if (mounted.current && generationId === generation.current) {
        busyRef.current = false;
        setBusy(false);
        void presentPendingInviteAfterBusy().catch(() => {});
      }
    }
  };

  const resetEverything = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const request = ++generation.current;
    const currentUserId = sessionRef.current?.user?.id ?? onboardingData?.userId ?? null;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (currentUserId) {
        if (!onboardingData || onboardingData.userId !== currentUserId) {
          throw new Error('The selected household could not be verified. No reset was started.');
        }
        await resetUserOnboardingData(onboardingData);
      }
      sessionRef.current = null;
      setSession(null);
      setOnboardingData(null);
      setHouseholdSummaries([]);
      setStage('welcome');
      setResetKey(prev => prev + 1);
      setAuthScreen('ready');
      await signOut();
    } catch (err) {
      if (mounted.current && request === generation.current) {
        Alert.alert('Reset not completed', err instanceof Error ? err.message : 'Unable to confirm the data reset.');
        // Preserve the signed-in UI on failure; the next verified load reconciles remote state.
      }
    } finally {
      if (mounted.current && request === generation.current) {
        busyRef.current = false;
        setBusy(false);
        void presentPendingInviteAfterBusy().catch(() => {});
      }
    }
  };

  const retry = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try { await validate(); }
    finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
      void presentPendingInviteAfterBusy().catch(() => {});
    }
  };

  if (authState === 'invitation' && session && pendingInvite) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom', 'left', 'right']}>
          <ScrollView contentContainerStyle={[styles.unavailableWrap, { flex: undefined, flexGrow: 1, paddingVertical: 24 }]} keyboardShouldPersistTaps="handled">
          <Text style={styles.unavailableTitle} accessibilityRole="header">{pendingInvite.acceptedHouseholdId ? 'Finish opening your household' : 'Join your household'}</Text>
          <Text style={[styles.unavailableError, { color: '#C3C9C6' }]}>{`Signed in as ${session.user.email ?? 'your account'}. Your existing households stay separate.`}</Text>
          {!!error && <Text style={styles.unavailableError} accessibilityRole="alert">{error}</Text>}
          <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy, busy }} style={[styles.primaryButton, busy && styles.disabledButton]} onPress={() => { void handleAcceptHouseholdInvite(pendingInvite.token).catch(() => {}); }}>
            <Text style={styles.primaryButtonText}>{busy ? 'Connecting...' : pendingInvite.acceptedHouseholdId ? 'Continue to household' : 'Join household'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} style={styles.primaryButton} onPress={() => {
            const currentSession = sessionRef.current;
            if (!currentSession) return;
            busyRef.current = true;
            setBusy(true);
            void withStartupDeadline(listVerifiedHouseholdContexts(currentSession)).then(summaries => {
              if (mounted.current && sessionRef.current?.user.id === currentSession.user.id) {
                setHouseholdSummaries(summaries);
                setError(summaries.length ? '' : 'No joined household is available yet. Try joining again with the invited email.');
              }
            }).catch(err => setError(err instanceof Error ? err.message : 'Unable to check your households.')).finally(() => { busyRef.current = false; if (mounted.current) setBusy(false); void presentPendingInviteAfterBusy().catch(() => {}); });
          }}><Text style={styles.primaryButtonText}>Check my households</Text></Pressable>
          {householdSummaries.map(summary => <Pressable key={summary.householdId} accessibilityRole="button" disabled={busy} style={styles.primaryButton} onPress={() => {
            busyRef.current = true;
            setBusy(true);
            const intent = pendingInvite;
            void withStartupDeadline(handleSwitchHousehold(summary.householdId)).then(async () => {
              const cleared = await invitationStore.clear(intent);
              if (!cleared) { rememberInvite(await invitationStore.load()); return; }
              if (mounted.current && sessionRef.current?.user.id === summary.userId) {
                rememberInvite(null);
                setAuthScreen('ready');
                setError('');
              }
            }).catch(err => setError(err instanceof Error ? err.message : 'Unable to open this household.')).finally(() => { busyRef.current = false; if (mounted.current) setBusy(false); void presentPendingInviteAfterBusy().catch(() => {}); });
          }}><Text style={styles.primaryButtonText}>{`Open ${summary.householdName}`}</Text></Pressable>)}
          <Pressable accessibilityRole="button" disabled={busy} style={styles.primaryButton} onPress={() => {
            Alert.alert('Continue separately?', 'Continue with your own household, or create one if you do not have one. Your invitation stays saved for your next app open.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Continue separately', onPress: () => {
                deferredInviteRef.current = `${session.user.id}:${pendingInvite.token}`;
                void validate();
              } },
            ]);
          }}><Text style={styles.primaryButtonText}>Continue separately</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void logout()}><Text style={styles.unavailableError}>Use a different account</Text></Pressable>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  if (authState === 'recovery' && session) {
    return <NativeAppearanceProvider userId={session.user.id}><SafeAreaView style={{ flex: 1 }}><AccountRecoveryScreen email={session.user.email ?? 'Signed in'} issue={error || 'Your household could not be loaded. Refresh to try again.'} diagnostics={recoveryIssue?.diagnostics ?? []} recoveryKind={recoveryIssue?.recoveryKind} pendingOperationCount={recoveryIssue?.pendingOperationCount ?? 0} households={householdSummaries} currentId={recoveryIssue?.context?.householdId} currentRole={recoveryIssue?.context?.role} actionBusy={busy} onRepair={handleRepairDebtCategory} onSyncAndRecover={handleSyncAndRecoverPending} onAcceptServerState={handleAcceptServerStateAndContinue} onSwitch={handleSwitchHousehold} onJoin={handleAcceptHouseholdInvite} onRefresh={retry} onSignOut={() => void logout()} /></SafeAreaView></NativeAppearanceProvider>;
  }

  if (authState === 'checking') {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.centered} edges={['top', 'bottom', 'left', 'right']}>
          <View accessible accessibilityLabel="Checking your session" accessibilityLiveRegion="polite">
            <ActivityIndicator size="large" color="#58CBD0" />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (authState === 'deletion_pending') {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.unavailableWrap} edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.logoBrand} accessible accessibilityRole="header" accessibilityLabel="DebtFree">
            <View style={styles.brandMark}><AppIcon name="brandRise" size={17} color="#FFFFFF" /></View>
            <Text style={styles.logoText}>Debt<Text style={styles.logoTextAccent}>Free</Text></Text>
          </View>
          <Text style={styles.unavailableTitle} accessibilityRole="header">Account deletion is pending</Text>
          <Text style={styles.unavailableError} accessibilityRole="alert">
            {error || 'The server has not returned a final deletion receipt. Your household access remains fenced while this same request is reconciled.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check account deletion status"
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy || !pendingDeletionRequest}
            style={[styles.primaryButton, (busy || !pendingDeletionRequest) && styles.disabledButton]}
            onPress={() => void retryPendingAccountDeletion()}
          >
            <Text style={styles.primaryButtonText}>{busy ? 'Checking…' : 'Check status'}</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  if (authState === 'unavailable') {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.unavailableWrap} edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.logoBrand} accessible accessibilityRole="header" accessibilityLabel="DebtFree">
            <View style={styles.brandMark}>
              <AppIcon name="brandRise" size={17} color="#FFFFFF" />
            </View>
            <Text style={styles.logoText}>
              Debt<Text style={styles.logoTextAccent}>Free</Text>
            </Text>
          </View>
          <Text style={styles.unavailableTitle} accessibilityRole="header">
            {"We couldn't open your account"}
          </Text>
          {!!error ? (
            <Text style={styles.unavailableError} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            style={[styles.primaryButton, busy && styles.disabledButton]}
            onPress={retry}
          >
            <Text style={styles.primaryButtonText}>Try Again</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out on this device"
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            style={[styles.secondaryButton, busy && styles.disabledButton]}
            onPress={() => void logout()}
          >
            <Text style={styles.secondaryButtonText}>Sign out on this device</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  const previewAllowed = __DEV__ && configured && process.env.EXPO_PUBLIC_ENABLE_SANDBOX_PREVIEW === 'true';
  const continueAsTestUser = () => {
    if (!previewAllowed || sessionRef.current) return;
    setOnboardingData(PROTOTYPE_HOUSEHOLD_ONBOARDING_DATA);
    setStage('home');
    void seedPrototypeHouseholdToStorage('test-user-preview');
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <DebtFreeFlow
        key={`${session?.user.id ?? onboardingData?.userId ?? 'signed-out'}:${onboardingData?.householdId ?? 'none'}-${resetKey}`}
        session={session}
        onboardingData={onboardingData}
        householdSummaries={householdSummaries}
        onSwitchHousehold={handleSwitchHousehold}
        onRefreshHouseholdContexts={refreshHouseholdContexts}
        onAcceptHouseholdInvite={handleAcceptHouseholdInvite}
        stage={stage}
        onChangeStage={next => {
          if (!session?.user.id || (sessionRef.current?.user.id ?? null) === (session?.user.id ?? null)) setStage(next);
        }}
        onUpdateOnboardingData={next => {
          if (!session?.user.id || (sessionRef.current?.user.id === session.user.id && next.userId === session.user.id && next.householdId === onboardingDataRef.current?.householdId)) {
            setOnboardingData(current => acceptOnboardingSnapshot(current, next));
          }
        }}
        onGoogleSignIn={() => login(signInWithGoogle)}
        onAppleSignIn={() => login(signInWithApple)}
        onEmailSignIn={handleEmailSignIn}
        onEmailSignUp={handleEmailSignUp}
        onSignOut={logout}
        onDeleteAccount={deleteAccount}
        accountDeletionEnabled={process.env.EXPO_PUBLIC_ACCOUNT_DELETION_ENABLED === 'true'}
        onTestUserSignIn={previewAllowed && !session ? continueAsTestUser : undefined}
        appleAvailable={appleAvailable}
        configured={configured}
        configProblem={configProblem}
        authBusy={busy}
        authError={error}
        authNotice={notice}
        onClearAuthError={() => setError('')}
      />
      {__DEV__ && stage === 'welcome' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reset app and start over"
          disabled={busy}
          style={[
            styles.floatingResetButton,
            { bottom: Math.max(insets.bottom, 10) + 6 },
            busy && styles.disabledButton,
          ]}
          onPress={() => void resetEverything()}
        >
          {!busy ? <AppIcon name="reset" size={12} color="#FF9367" /> : null}
          <Text style={styles.floatingResetText}>{busy ? 'Resetting…' : 'Reset'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

class RootErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureExceptionSafely(error, 'root_error_boundary');
    if (__DEV__) {
      console.error('RootErrorBoundary caught error:', error, info.componentStack);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={[styles.root, styles.unavailableWrap]} edges={['top', 'bottom', 'left', 'right']}>
          <Text style={styles.unavailableTitle}>Something went wrong</Text>
          <Text style={styles.unavailableError}>
            BitLess hit an unexpected display error. Reload to continue — your saved data is safe.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reload app"
            onPress={() => this.setState({ hasError: false })}
            style={{ backgroundColor: '#49CC68', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12, marginTop: 6 }}
          >
            <Text style={{ color: '#090D14', fontSize: 15, fontWeight: '700' }}>Reload app</Text>
          </Pressable>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ Montserrat_400Regular, Montserrat_500Medium, Montserrat_700Bold });
  if (!fontsLoaded && !fontError) return null;
  if (isLocalAcceptanceEnabled()) {
    return (
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <RootErrorBoundary>
          <LocalAcceptanceEntry />
        </RootErrorBoundary>
      </SafeAreaProvider>
    );
  }
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <RootErrorBoundary>
        <RootApp />
      </RootErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1F201F',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unavailableWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    gap: 16,
  },
  logoBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#369B97',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  logoText: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F9F9F6',
    letterSpacing: -0.8,
  },
  logoTextAccent: {
    color: '#50C7C0',
  },
  unavailableTitle: {
    fontSize: 21,
    fontWeight: '700',
    color: '#F9F9F6',
    textAlign: 'center',
  },
  unavailableError: {
    fontSize: 13,
    color: '#FF8A75',
    textAlign: 'center',
    lineHeight: 19,
  },
  primaryButton: {
    width: '100%',
    minHeight: 51,
    borderRadius: 9,
    backgroundColor: '#A34F34',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    width: '100%',
    minHeight: 46,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#5D6660',
    backgroundColor: '#2D302E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#58CBD0',
    fontSize: 14,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.6,
  },
  floatingResetButton: {
    position: 'absolute',
    right: 16,
    zIndex: 9999,
    elevation: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#2B2220',
    borderWidth: 1,
    borderColor: '#BA6748',
  },
  floatingResetText: {
    color: '#FF9367',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
