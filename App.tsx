import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import type { Session } from '@supabase/supabase-js';
import {
  isConfigured,
  listenAppState,
  onAuthInvalidated,
  signInWithApple,
  signInWithGoogle,
  signOut,
  verifiedSession,
} from './src/auth';

function TopWaveHeader() {
  return (
    <View style={styles.waveContainer} pointerEvents="none">
      <View style={styles.waveLayerBack} />
      <View style={styles.waveLayerMid} />
      <View style={styles.waveLayerFront} />
    </View>
  );
}

function PiggyBankIcon() {
  return (
    <View style={styles.piggyWrapper}>
      <View style={styles.trendContainer}>
        <View style={styles.trendSegment1} />
        <View style={styles.trendSegment2} />
        <View style={styles.trendSegment3} />
        <View style={styles.trendArrowHeadTop} />
        <View style={styles.trendArrowHeadRight} />
      </View>
      <View style={styles.piggyBody}>
        <View style={styles.piggyCoinSlot} />
        <View style={styles.piggyEar} />
        <View style={styles.piggyEye} />
        <View style={styles.piggySnout} />
        <View style={styles.piggyTail} />
        <View style={styles.piggyLegBack} />
        <View style={styles.piggyLegFront} />
      </View>
    </View>
  );
}

function GoogleIcon() {
  return (
    <View style={styles.googleIconBox}>
      <View style={styles.googleRingRed} />
      <View style={styles.googleRingYellow} />
      <View style={styles.googleRingGreen} />
      <View style={styles.googleRingBlue} />
      <View style={styles.googleInnerCutout} />
      <View style={styles.googleRightGap} />
      <View style={styles.googleCrossbar} />
    </View>
  );
}

type Screen = 'checking' | 'signedOut' | 'signedIn';

function SignInScreen() {
  const [screen, setScreen] = useState<Screen>('checking');
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [appleAvailable, setAppleAvailable] = useState(false);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const invalidatedWhileBusy = useRef(false);
  const mounted = useRef(false);

  const validate = useCallback(async () => {
    const request = ++generation.current;
    setSession(null);
    setScreen('checking');
    try {
      const next = await verifiedSession();
      if (mounted.current && request === generation.current) {
        setSession(next);
        setScreen(next ? 'signedIn' : 'signedOut');
      }
    } catch {
      if (mounted.current && request === generation.current) {
        setSession(null);
        setScreen('signedOut');
        setError('Unable to verify your session. Please sign in again.');
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void validate();
    if (Platform.OS === 'ios' && process.env.EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED === 'true') {
      void AppleAuthentication.isAvailableAsync().then(available => {
        if (mounted.current) setAppleAvailable(available);
      }).catch(() => { if (mounted.current) setAppleAvailable(false); });
    }
    const subscription = listenAppState(() => { if (!busyRef.current) void validate(); });
    const unsubscribe = onAuthInvalidated(() => {
      if (busyRef.current) { invalidatedWhileBusy.current = true; return; }
      if (mounted.current) {
        ++generation.current;
        setSession(null);
        setScreen('signedOut');
      }
    });
    return () => { mounted.current = false; ++generation.current; subscription.remove(); unsubscribe(); };
  }, [validate]);

  const login = async (action: () => Promise<Session | null>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    invalidatedWhileBusy.current = false;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    try {
      let next = await action();
      if (invalidatedWhileBusy.current && next) next = await verifiedSession();
      if (mounted.current && request === generation.current) {
        setSession(next);
        setScreen(next ? 'signedIn' : 'signedOut');
      }
    } catch (err) {
      if (mounted.current && request === generation.current) {
        setSession(null);
        setScreen('signedOut');
        setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
      }
    } finally {
      if (mounted.current && request === generation.current) { busyRef.current = false; setBusy(false); }
    }
  };
  const logout = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const request = ++generation.current;
    setSession(null);
    setScreen('signedOut');
    setBusy(true);
    setError('');
    try { await signOut(); }
    catch { if (mounted.current && request === generation.current) setError('Sign-out could not be fully confirmed. Please reconnect and try again.'); }
    finally { if (mounted.current && request === generation.current) { busyRef.current = false; setBusy(false); } }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopWaveHeader />
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.brandRow} accessibilityLabel="DebtFree">
            <Text style={styles.brandDebt}>Debt</Text><Text style={styles.brandFree}>Free</Text><PiggyBankIcon />
          </View>
          {screen === 'checking' ? (
            <View style={styles.formContainer} accessibilityLabel="Checking your session">
              <ActivityIndicator size="large" color="#088395" />
            </View>
          ) : screen === 'signedIn' ? (
            <View style={styles.signedInBox}>
              <Text style={styles.subtitle}>Welcome</Text>
              <Text style={styles.body}>{session?.user.email ?? 'Signed in'}</Text>
              <Pressable accessibilityRole="button" disabled={busy} style={[styles.loginButton, styles.signOutButton, busy && styles.disabledButton]} onPress={() => void logout()}>
                <Text style={styles.loginButtonText}>Sign Out</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.formContainer}>
              <Text style={styles.subtitle}>{"Glad you're back"}</Text>
              {!isConfigured() && <Text style={styles.notice} accessibilityRole="alert">A separate test sign-in service has not been configured yet.</Text>}
              <Pressable accessibilityRole="button" accessibilityLabel="Continue with Google" accessibilityState={{ disabled: busy || !isConfigured(), busy }} disabled={busy || !isConfigured()} style={[styles.googleButton, (busy || !isConfigured()) && styles.disabledButton]} onPress={() => void login(signInWithGoogle)}>
                {busy ? <ActivityIndicator color="#088395" /> : <><GoogleIcon /><Text style={styles.googleButtonText}>Continue with Google</Text></>}
              </Pressable>
              {appleAvailable && isConfigured() && <AppleAuthentication.AppleAuthenticationButton buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN} buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK} cornerRadius={28} style={styles.appleButton} onPress={() => { if (!busyRef.current) void login(signInWithApple); }} />}
            </View>
          )}
          {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

export default function App() {
  return <SafeAreaProvider><SignInScreen /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 110,
    paddingBottom: 32,
    justifyContent: 'center',
    gap: 48,
  },
  waveContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 150,
    overflow: 'hidden',
  },
  waveLayerBack: {
    position: 'absolute',
    top: -65,
    left: -40,
    right: -40,
    height: 155,
    backgroundColor: '#CBECE8',
    transform: [{ rotate: '-6deg' }],
  },
  waveLayerMid: {
    position: 'absolute',
    top: -55,
    left: -30,
    right: -50,
    height: 140,
    backgroundColor: '#B5E2DF',
    opacity: 0.65,
    transform: [{ rotate: '7deg' }],
  },
  waveLayerFront: {
    position: 'absolute',
    top: -75,
    left: 40,
    right: -60,
    height: 135,
    backgroundColor: '#DFF5F2',
    opacity: 0.8,
    transform: [{ rotate: '-11deg' }],
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  brandDebt: {
    fontSize: 42,
    fontWeight: '800',
    color: '#0D253F',
    letterSpacing: -0.8,
  },
  brandFree: {
    fontSize: 42,
    fontWeight: '800',
    color: '#22C5B8',
    letterSpacing: -0.8,
  },
  piggyWrapper: {
    width: 44,
    height: 48,
    marginLeft: 8,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  trendContainer: {
    position: 'absolute',
    top: 2,
    left: 6,
    width: 32,
    height: 18,
  },
  trendSegment1: {
    position: 'absolute',
    bottom: 2,
    left: 2,
    width: 11,
    height: 2.5,
    backgroundColor: '#0D253F',
    borderRadius: 2,
    transform: [{ rotate: '-35deg' }],
  },
  trendSegment2: {
    position: 'absolute',
    bottom: 5,
    left: 10,
    width: 9,
    height: 2.5,
    backgroundColor: '#0D253F',
    borderRadius: 2,
    transform: [{ rotate: '20deg' }],
  },
  trendSegment3: {
    position: 'absolute',
    bottom: 8,
    left: 16,
    width: 13,
    height: 2.5,
    backgroundColor: '#0D253F',
    borderRadius: 2,
    transform: [{ rotate: '-40deg' }],
  },
  trendArrowHeadTop: {
    position: 'absolute',
    top: 2,
    right: 3,
    width: 8,
    height: 2.5,
    backgroundColor: '#0D253F',
    borderRadius: 1.5,
  },
  trendArrowHeadRight: {
    position: 'absolute',
    top: 2,
    right: 3,
    width: 2.5,
    height: 8,
    backgroundColor: '#0D253F',
    borderRadius: 1.5,
  },
  piggyBody: {
    width: 34,
    height: 25,
    borderRadius: 13,
    backgroundColor: '#22C5B8',
    position: 'relative',
    marginBottom: 4,
  },
  piggyCoinSlot: {
    position: 'absolute',
    top: 3,
    left: 11,
    width: 9,
    height: 2.5,
    borderRadius: 1.5,
    backgroundColor: '#0D253F',
  },
  piggyEar: {
    position: 'absolute',
    top: -4,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 3,
    backgroundColor: '#22C5B8',
    transform: [{ rotate: '25deg' }],
  },
  piggyEye: {
    position: 'absolute',
    top: 8,
    right: 6,
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#0D253F',
  },
  piggySnout: {
    position: 'absolute',
    top: 9,
    right: -4,
    width: 6,
    height: 9,
    borderRadius: 3,
    backgroundColor: '#22C5B8',
  },
  piggyTail: {
    position: 'absolute',
    top: 8,
    left: -4,
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: '#22C5B8',
  },
  piggyLegBack: {
    position: 'absolute',
    bottom: -4,
    left: 7,
    width: 5,
    height: 6,
    borderRadius: 2,
    backgroundColor: '#22C5B8',
  },
  piggyLegFront: {
    position: 'absolute',
    bottom: -4,
    right: 8,
    width: 5,
    height: 6,
    borderRadius: 2,
    backgroundColor: '#22C5B8',
  },
  formContainer: {
    width: '100%',
    marginTop: 8,
  },
  subtitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#0D253F',
    textAlign: 'center',
    marginBottom: 32,
  },
  input: {
    width: '100%',
    height: 54,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 999,
    paddingHorizontal: 22,
    fontSize: 16,
    color: '#0F172A',
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  passwordInput: {
    marginTop: 18,
  },
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    marginTop: 12,
    marginBottom: 22,
    paddingVertical: 2,
  },
  forgotPasswordText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#088395',
  },
  loginButton: {
    width: '100%',
    height: 56,
    borderRadius: 999,
    backgroundColor: '#088395',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#088395',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 30,
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  dividerText: {
    marginHorizontal: 14,
    fontSize: 14,
    fontWeight: '500',
    color: '#1E293B',
  },
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  socialCircleButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  googleButton: {
    minHeight: 56, width: '100%', borderRadius: 999, borderWidth: 1, borderColor: '#CBD5E1',
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF',
  },
  googleButtonText: { color: '#0D253F', fontSize: 16, fontWeight: '700' },
  appleButton: { width: '100%', height: 56, marginTop: 16 },
  googleIconBox: {
    width: 24,
    height: 24,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleRingRed: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 4.5,
    borderColor: 'transparent',
    borderTopColor: '#EA4335',
    transform: [{ rotate: '-15deg' }],
  },
  googleRingYellow: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 4.5,
    borderColor: 'transparent',
    borderLeftColor: '#FBBC05',
    transform: [{ rotate: '-15deg' }],
  },
  googleRingGreen: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 4.5,
    borderColor: 'transparent',
    borderBottomColor: '#34A853',
    transform: [{ rotate: '-15deg' }],
  },
  googleRingBlue: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 4.5,
    borderColor: 'transparent',
    borderRightColor: '#4285F4',
    transform: [{ rotate: '25deg' }],
  },
  googleInnerCutout: {
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: '#FFFFFF',
  },
  googleRightGap: {
    position: 'absolute',
    top: 4,
    right: 0,
    width: 6,
    height: 7,
    backgroundColor: '#FFFFFF',
  },
  googleCrossbar: {
    position: 'absolute',
    right: 1,
    top: 10,
    width: 11,
    height: 4.2,
    backgroundColor: '#4285F4',
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  appleIconBox: {
    width: 24,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  appleLeaf: {
    width: 6,
    height: 7,
    backgroundColor: '#000000',
    borderTopLeftRadius: 6,
    borderBottomRightRadius: 6,
    marginBottom: 1,
    marginLeft: 3,
    transform: [{ rotate: '15deg' }],
  },
  appleBody: {
    width: 20,
    height: 17,
    position: 'relative',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  appleLobeLeft: {
    width: 12,
    height: 17,
    backgroundColor: '#000000',
    borderTopLeftRadius: 9,
    borderTopRightRadius: 6,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 5,
    marginRight: -3,
  },
  appleLobeRight: {
    width: 12,
    height: 17,
    backgroundColor: '#000000',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 9,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 8,
  },
  appleBiteCutout: {
    position: 'absolute',
    right: -3,
    top: 4,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FFFFFF',
  },
  appleBottomIndent: {
    position: 'absolute',
    bottom: -2,
    width: 4,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 42,
  },
  footerPrompt: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1E293B',
  },
  footerSignUp: {
    fontSize: 15,
    fontWeight: '700',
    color: '#088395',
  },
  noticeBox: {
    alignItems: 'center',
    marginTop: 16,
  },
  notice: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
  },
  signedInBox: {
    alignItems: 'center',
    gap: 16,
    marginTop: 16,
  },
  body: {
    fontSize: 15,
    color: '#475569',
    marginBottom: 8,
  },
  signOutButton: {
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
  },
  disabledButton: {
    opacity: 0.6,
  },
  error: {
    color: '#DC2626',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
  },
});
