import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, StyleSheet, useColorScheme } from 'react-native';
import { NativeAppearanceProvider, Pressable, Text, View } from './components/NativeAppearance';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppIcon, NAVIGATION_TAB_ICONS, type NavigationTabIconName } from './components/AppIcon';

export function FiveTabShell({
  home,
  debt,
  transactions,
  budget,
  progress,
  settings,
  settingsVisible = false,
  onCloseSettings,
  themePreference = 'Dark',
  userId,
}: {
  home: (navigate: (tab: NavigationTabIconName, section?: string) => void) => ReactNode;
  debt: ReactNode | ((selectedDebtId: string | null, clearTarget: () => void, section: string, resetKey: number) => ReactNode);
  transactions: ReactNode | ((selectedTransactionId: string | null, clearTarget: () => void, section: string) => ReactNode);
  budget: (navigate: (tab: NavigationTabIconName, section?: string) => void) => ReactNode;
  progress: ReactNode | ((navigate: (tab: NavigationTabIconName, section?: string) => void) => ReactNode);
  settings?: ReactNode | ((onClose: () => void) => ReactNode);
  settingsVisible?: boolean;
  onCloseSettings?: () => void;
  themePreference?: 'System' | 'Dark' | 'Light';
  userId?: string;
}) {
  const [selectedTab, setSelectedTab] = useState<NavigationTabIconName>('home');
  const [targetTransactionId, setTargetTransactionId] = useState<string | null>(null);
  const [targetDebtId, setTargetDebtId] = useState<string | null>(null);
  const [debtSection, setDebtSection] = useState('Cards & Loans');
  const [debtResetKey, setDebtResetKey] = useState(0);
  const [transactionSection, setTransactionSection] = useState('History');
  const systemColorScheme = useColorScheme();
  const isLight = themePreference === 'Light' || (themePreference === 'System' && systemColorScheme === 'light');

  const showSettings = Boolean(settingsVisible && settings);

  useEffect(() => {
    if (!showSettings) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onCloseSettings?.();
      return true;
    });
    return () => subscription.remove();
  }, [showSettings, onCloseSettings]);

  const navigate = (tab: NavigationTabIconName, section?: string) => {
    if (tab === 'debt') {
      setDebtSection(section === 'Strategy' ? 'Strategy' : 'Cards & Loans');
      setTargetDebtId(section && section !== 'Strategy' ? section : null);
      setDebtResetKey(value => value + 1);
    }
    if (tab === 'transactions') {
      setTransactionSection(section === 'Upcoming' || section === 'Scheduled' ? section : 'History');
      setTargetTransactionId(section && section !== 'Upcoming' && section !== 'Scheduled' ? section : null);
    }
    setSelectedTab(tab);
  };

  const screens = {
    home: home(navigate),
    debt: typeof debt === 'function' ? debt(targetDebtId, () => setTargetDebtId(null), debtSection, debtResetKey) : debt,
    transactions: typeof transactions === 'function' ? transactions(targetTransactionId, () => setTargetTransactionId(null), transactionSection) : transactions,
    budget: budget(navigate),
    progress: typeof progress === 'function' ? progress(navigate) : progress,
  };

  return (
    <NativeAppearanceProvider themePreference={themePreference} userId={userId}>
    <SafeAreaView style={[styles.root, isLight && styles.rootLight]} edges={['top', 'bottom', 'left', 'right']}>
      <View style={[styles.content, showSettings && styles.hidden]}>
        {screens[selectedTab]}
      </View>
      <View accessibilityRole="tablist" style={[styles.tabBar, isLight && styles.tabBarLight, showSettings && styles.hidden]}>
        {NAVIGATION_TAB_ICONS.map(tab => {
          const selected = tab.name === selectedTab;
          const activeColor = isLight ? '#0D9488' : '#81DFD2';
          const inactiveColor = isLight ? '#64748B' : '#AAB3AD';
          const color = selected ? activeColor : inactiveColor;
          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected }}
              onPress={() => {
                if (tab.name === 'transactions') { setTargetTransactionId(null); setTransactionSection('History'); }
                if (tab.name === 'debt') { setTargetDebtId(null); setDebtSection('Cards & Loans'); setDebtResetKey(value => value + 1); }
                setSelectedTab(tab.name);
              }}
              style={styles.tab}
            >
              <View style={[styles.iconWrap, selected && (isLight ? styles.iconWrapSelectedLight : styles.iconWrapSelected)]}>
                <AppIcon name={tab.name} selected={selected} color={color} size={22} />
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.label, { color }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {showSettings ? (
        <View style={[styles.settingsOverlay, isLight && styles.settingsOverlayLight]}>
          {typeof settings === 'function' ? settings(() => onCloseSettings?.()) : settings}
        </View>
      ) : null}
    </SafeAreaView>
    </NativeAppearanceProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1F201F' },
  rootLight: { backgroundColor: '#F3F4F6' },
  content: { flex: 1 },
  hidden: { display: 'none' },
  settingsOverlay: { flex: 1, backgroundColor: '#1F201F' },
  settingsOverlayLight: { backgroundColor: '#F3F4F6' },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#353D38', backgroundColor: '#242926', paddingHorizontal: 6, paddingTop: 6 },
  tabBarLight: { backgroundColor: '#FFFFFF', borderTopColor: '#E5E7EB' },
  tab: { flex: 1, minWidth: 0, minHeight: 66, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, paddingVertical: 4, gap: 3 },
  iconWrap: { width: 48, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  iconWrapSelected: { backgroundColor: '#31534D' },
  iconWrapSelectedLight: { backgroundColor: '#CCFBF1' },
  label: { fontSize: 11, fontWeight: '600', textAlign: 'center', width: '100%', letterSpacing: 0.1 },
});



