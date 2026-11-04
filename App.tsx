import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import type { Session } from '@supabase/supabase-js';
import {
  AuthUnavailableError,
  configurationProblem,
  isConfigured,
  listenAppState,
  onAuthInvalidated,
  signInWithApple,
  signInWithGoogle,
  signOut,
  verifiedSession,
} from './src/auth';
import {
  resolveAuthenticatedStage,
  type FlowStage,
  type UserOnboardingData,
} from './src/onboarding-domain';
import { loadUserOnboardingData, resetUserOnboardingData } from './src/onboarding-storage';
import { AppIcon } from './src/components/AppIcon';
import { DebtFreeFlow } from './src/OnboardingAndHome';

type AuthScreenState = 'checking' | 'ready' | 'unavailable';

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
  const [appleAvailable, setAppleAvailable] = useState(false);

  const generation = useRef(0);
  const busyRef = useRef(false);
  const invalidatedWhileBusy = useRef(false);
  const mounted = useRef(false);
  const authStateRef = useRef<AuthScreenState>('checking');
  const sessionRef = useRef<Session | null>(null);
  const stageRef = useRef<FlowStage>('welcome');

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

  const validate = useCallback(async () => {
    const request = ++generation.current;
    const hadSession = sessionRef.current !== null;
    // Protected UI is hidden while re-confirming the stored session with the auth server.
    setAuthScreen('checking');
    try {
      const nextSession = await verifiedSession();
      let nextData: UserOnboardingData | null = null;
      if (nextSession) {
        nextData = await loadUserOnboardingData(nextSession);
      }
      if (mounted.current && request === generation.current) {
        sessionRef.current = nextSession;
        setSession(nextSession);
        setOnboardingData(nextData);
        if (nextSession && nextData) {
          setError('');
          setStage(resolveAuthenticatedStage(nextData));
        } else {
          setStage(stageRef.current === 'signup_1' ? 'signup_1' : 'welcome');
          if (hadSession) {
            setNotice('Your session has ended. Please sign in again.');
          }
        }
        setAuthScreen('ready');
      }
    } catch (err) {
      if (mounted.current && request === generation.current) {
        sessionRef.current = null;
        setSession(null);
        setOnboardingData(null);
        if (err instanceof AuthUnavailableError) {
          setAuthScreen('unavailable');
          setError(err.message);
        } else {
          setStage('welcome');
          setAuthScreen('ready');
          setError('Unable to verify your session. Please sign in again.');
        }
      }
    }
  }, [setAuthScreen, setStage]);

  useEffect(() => {
    mounted.current = true;
    Promise.resolve().then(() => {
      if (mounted.current) void validate();
    });
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
    const subscription = listenAppState(() => {
      // Re-verify on return to the foreground only when a stored session may exist; idle signed-out screens stay put.
      if (
        !busyRef.current &&
        (sessionRef.current !== null || authStateRef.current === 'unavailable')
      ) {
        void validate();
      }
    });
    const unsubscribe = onAuthInvalidated(() => {
      if (busyRef.current) {
        invalidatedWhileBusy.current = true;
        return;
      }
      if (mounted.current) {
        const hadSession = sessionRef.current !== null;
        ++generation.current;
        sessionRef.current = null;
        setSession(null);
        setOnboardingData(null);
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
      subscription.remove();
      unsubscribe();
    };
  }, [validate, setAuthScreen, setStage]);

  const login = async (action: () => Promise<Session | null>): Promise<Session | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    invalidatedWhileBusy.current = false;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let next = await action();
      if (invalidatedWhileBusy.current && next) {
        next = await verifiedSession();
      }
      let nextData: UserOnboardingData | null = null;
      if (next) {
        nextData = await loadUserOnboardingData(next);
      }
      if (mounted.current && request === generation.current) {
        sessionRef.current = next;
        setSession(next);
        setOnboardingData(nextData);
        if (next && nextData) {
          setStage(resolveAuthenticatedStage(nextData));
        }
        setAuthScreen('ready');
      }
      return next;
    } catch (err) {
      if (mounted.current && request === generation.current) {
        sessionRef.current = null;
        setSession(null);
        setOnboardingData(null);
        setAuthScreen('ready');
        setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
      }
      return null;
    } finally {
      if (mounted.current && request === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const logout = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const request = ++generation.current;
    sessionRef.current = null;
    setSession(null);
    setOnboardingData(null);
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
        await resetUserOnboardingData(currentUserId);
      }
      sessionRef.current = null;
      setSession(null);
      setOnboardingData(null);
      setStage('welcome');
      setResetKey(prev => prev + 1);
      setAuthScreen('ready');
      await signOut();
    } catch {
      if (mounted.current && request === generation.current) {
        sessionRef.current = null;
        setSession(null);
        setOnboardingData(null);
        setStage('welcome');
        setResetKey(prev => prev + 1);
        setAuthScreen('ready');
      }
    } finally {
      if (mounted.current && request === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const retry = () => {
    if (!busyRef.current) {
      setError('');
      void validate();
    }
  };

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
            {"We couldn't confirm your sign-in"}
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

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <DebtFreeFlow
        key={resetKey}
        session={session}
        onboardingData={onboardingData}
        stage={stage}
        onChangeStage={setStage}
        onUpdateOnboardingData={setOnboardingData}
        onGoogleSignIn={() => login(signInWithGoogle)}
        onAppleSignIn={() => login(signInWithApple)}
        onSignOut={logout}
        appleAvailable={appleAvailable}
        configured={configured}
        configProblem={configProblem}
        authBusy={busy}
        authError={error}
        authNotice={notice}
        onClearAuthError={() => setError('')}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reset app and start over"
        disabled={busy}
        style={[
          styles.floatingResetButton,
          { bottom: Math.max(insets.bottom, 10) + (stage === 'home' && onboardingData ? 76 : 6) },
          busy && styles.disabledButton,
        ]}
        onPress={() => void resetEverything()}
      >
        {!busy ? <AppIcon name="reset" size={12} color="#FF9367" /> : null}
        <Text style={styles.floatingResetText}>{busy ? 'Resetting…' : 'Reset'}</Text>
      </Pressable>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <RootApp />
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
