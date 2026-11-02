import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import type { Session } from '@supabase/supabase-js';
import { isConfigured, listenAppState, onAuthInvalidated, signInWithApple, signInWithGoogle, signOut, verifiedSession } from './src/auth';

type Screen = 'checking' | 'signedOut' | 'signedIn';
export default function App() {
  const [screen, setScreen] = useState<Screen>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [appleAvailable, setAppleAvailable] = useState(false);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const validate = useCallback(async () => {
    const request = ++generation.current;
    setScreen('checking');
    try {
      const session = await verifiedSession();
      if (mounted.current && request === generation.current) setScreen(session ? 'signedIn' : 'signedOut');
    } catch {
      if (mounted.current && request === generation.current) { setError('Unable to verify your session. Please sign in again.'); setScreen('signedOut'); }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    Promise.resolve().then(() => { if (mounted.current) void validate(); });
    const requests = generation;
    if (Platform.OS === 'ios') void AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
    const sub = listenAppState(() => { if (!busyRef.current) void validate(); });
    const unsubscribe = onAuthInvalidated(() => { if (!busyRef.current && mounted.current) { generation.current++; setScreen('signedOut'); } });
    return () => { mounted.current = false; requests.current++; sub.remove(); unsubscribe(); };
  }, [validate]);
  const login = async (action: () => Promise<Session | null>) => {
    if (busy) return;
    const request = ++generation.current; busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await action();
      if (mounted.current && request === generation.current) setScreen(result ? 'signedIn' : 'signedOut');
    } catch (err) {
      if (mounted.current && request === generation.current) { setScreen('signedOut'); setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.'); }
    } finally { if (mounted.current && request === generation.current) { busyRef.current = false; setBusy(false); } }
  };
  const logout = async () => {
    if (busy) return;
    const request = ++generation.current; busyRef.current = true; setScreen('signedOut'); setBusy(true); setError('');
    try { await signOut(); } catch { if (mounted.current && request === generation.current) setError('Sign-out could not be fully confirmed. Please reconnect and try again.'); }
    finally { if (mounted.current && request === generation.current) { busyRef.current = false; setBusy(false); } }
  };
  return <SafeAreaProvider><SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
    <View style={styles.brand}><View style={styles.mark}><Text style={styles.markText}>D</Text></View><Text style={styles.brandName}>DebtFree</Text></View>
    {screen === 'checking' ? <View style={styles.card} accessibilityLabel="Checking your session"><ActivityIndicator size="large" color="#295e9b"/><Text style={styles.muted}>Checking your session…</Text></View> : screen === 'signedIn' ?
      <View style={styles.card}><Text style={styles.eyebrow}>SIGNED IN</Text><Text style={styles.title}>Welcome to DebtFree</Text><Text style={styles.description}>Your account is ready. More of your DebtFree experience is coming soon.</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => void logout()} style={styles.button}><Text style={styles.buttonText}>Sign out</Text></Pressable></View> :
      <View style={styles.card}><Text style={styles.eyebrow}>YOUR NEXT CHAPTER</Text><Text style={styles.title}>Your household, together.</Text><Text style={styles.description}>Keep your goals in sight, one step at a time.</Text>
        {!isConfigured() && <Text style={styles.notice} accessibilityRole="alert">Test sign-in is not configured yet.</Text>}
        {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Sign in with Google" disabled={busy || !isConfigured()} onPress={() => void login(signInWithGoogle)} style={[styles.button, (busy || !isConfigured()) && styles.disabled]}>{busy ? <ActivityIndicator color="#fff"/> : <Text style={styles.buttonText}>Continue with Google</Text>}</Pressable>
        {appleAvailable && isConfigured() && <AppleAuthentication.AppleAuthenticationButton buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN} buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK} cornerRadius={14} style={styles.apple} onPress={() => { if (!busy && isConfigured()) void login(signInWithApple); }}/>}<Text style={styles.footnote}>Your information stays yours.</Text></View>}
  </ScrollView></SafeAreaView></SafeAreaProvider>;
}
const styles = StyleSheet.create({safe:{flex:1,backgroundColor:'#e4ebf3'},container:{flexGrow:1,justifyContent:'center',padding:24},brand:{alignItems:'center',marginBottom:32},mark:{height:58,width:58,borderRadius:18,alignItems:'center',justifyContent:'center',backgroundColor:'#295e9b'},markText:{color:'white',fontWeight:'800',fontSize:32},brandName:{color:'#182c4a',fontWeight:'800',fontSize:25,marginTop:10},card:{backgroundColor:'#f5f8fc',padding:24,borderRadius:24,gap:16,shadowColor:'#17243a',shadowOpacity:.09,shadowRadius:20,elevation:3},eyebrow:{fontSize:11,letterSpacing:1.4,fontWeight:'700',color:'#295e9b'},title:{fontSize:29,lineHeight:36,fontWeight:'800',color:'#101b31'},description:{fontSize:16,lineHeight:24,color:'#475062'},muted:{color:'#475062',textAlign:'center'},button:{minHeight:54,borderRadius:14,alignItems:'center',justifyContent:'center',paddingHorizontal:16,backgroundColor:'#295e9b'},buttonText:{color:'white',fontSize:16,fontWeight:'700'},disabled:{opacity:.5},apple:{height:54,width:'100%'},notice:{backgroundColor:'#e1e9f2',color:'#182c4a',padding:12,borderRadius:10},error:{color:'#a41d3e',fontSize:14},footnote:{color:'#475062',textAlign:'center',fontSize:13}});
