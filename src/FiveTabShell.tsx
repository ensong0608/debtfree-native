import { useCallback, useEffect, useState, type ReactNode, type ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import { NativeAppearanceProvider, Pressable, Text, View, useNativeAppearance } from './components/NativeAppearance';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NAVIGATION_TAB_ICONS, type NavigationTabIconName } from './components/AppIcon';
import { NavigationIcon } from './components/NavigationIcon';
import { TabShellContext, type RefreshFeedback } from './components/TabShellContext';
import { bottomInsetPadding } from './components/bottom-inset';

export function FiveTabShell({
  home,
  debt,
  transactions,
  budget,
  progress,
  settings,
  settingsVisible = false,
  onCloseSettings,
  onHomeVisibilityChange,
  themePreference = 'Dark',
  userId,
  overlay,
  onRefresh, refreshing = false, refreshFeedback, settingsSaveWarning,
}: {
  home: (navigate: (tab: NavigationTabIconName, section?: string) => void) => ReactNode;
  debt: ReactNode | ((selectedDebtId: string | null, clearTarget: () => void, section: string, resetKey: number) => ReactNode);
  transactions: ReactNode | ((selectedTransactionId: string | null, clearTarget: () => void, section: string) => ReactNode);
  budget: (navigate: (tab: NavigationTabIconName, section?: string) => void, section: string) => ReactNode;
  progress: ReactNode | ((navigate: (tab: NavigationTabIconName, section?: string) => void) => ReactNode);
  settings?: ReactNode | ((onClose: () => void) => ReactNode);
  settingsVisible?: boolean;
  onCloseSettings?: () => void;
  onHomeVisibilityChange?: (visible: boolean) => void;
  themePreference?: 'System' | 'Dark' | 'Light' | 'Inspire';
  userId?: string;
  overlay?: ReactNode;
  onRefresh?: () => Promise<void>;
  refreshing?: boolean;
  refreshFeedback?: RefreshFeedback;
  settingsSaveWarning?: { checking: boolean; onCheck: () => void };
}) {
  const [selectedTab, setSelectedTab] = useState<NavigationTabIconName>('home');
  const [targetTransactionId, setTargetTransactionId] = useState<string | null>(null);
  const [targetDebtId, setTargetDebtId] = useState<string | null>(null);
  const [debtSection, setDebtSection] = useState('Cards & Loans');
  const [debtResetKey, setDebtResetKey] = useState(0);
  const [transactionSection, setTransactionSection] = useState('History');
  const [budgetSection, setBudgetSection] = useState('Budget');

  const registerAction = useCallback((_tab: NavigationTabIconName, _callback: () => void, _label?: string) => () => {}, []);
  const showSettings = Boolean(settingsVisible && settings);

  useEffect(() => {
    onHomeVisibilityChange?.(selectedTab === 'home' && !showSettings);
  }, [selectedTab, showSettings, onHomeVisibilityChange]);

  const navigate = (tab: NavigationTabIconName, section?: string) => {
    if (tab === 'debt' && section === 'Scheduled') {
      setTransactionSection('Scheduled');
      setTargetTransactionId(null);
      setSelectedTab('transactions');
      return;
    }
    if (tab === 'debt') {
      setDebtSection(section === 'Strategy' ? 'Strategy' : 'Cards & Loans');
      setTargetDebtId(section && section !== 'Strategy' && section !== 'Scheduled' && section !== 'Cards & Loans' && section !== 'Accounts' ? section : null);
      setDebtResetKey(value => value + 1);
    }
    if (tab === 'transactions') {
      setTransactionSection(section === 'Scheduled' ? 'Scheduled' : 'History');
      setTargetTransactionId(section && !['History', 'Scheduled'].includes(section) ? section : null);
    }
    if (tab === 'budget') setBudgetSection('Budget');
    setSelectedTab(tab);
  };

  const activeScreen = (() => {
    switch (selectedTab) {
      case 'home':
        return home(navigate);
      case 'debt':
        return typeof debt === 'function' ? debt(targetDebtId, () => setTargetDebtId(null), debtSection, debtResetKey) : debt;
      case 'transactions':
        return typeof transactions === 'function' ? transactions(targetTransactionId, () => setTargetTransactionId(null), transactionSection) : transactions;
      case 'budget':
        return budget(navigate, budgetSection);
      case 'progress':
        return typeof progress === 'function' ? progress(navigate) : progress;
    }
  })();

  return (
    <NativeAppearanceProvider themePreference={themePreference} userId={userId}>
    <TabShellContext.Provider value={{ tab: selectedTab, registerAction, onRefresh, refreshing, refreshFeedback }}>
    <ThemedSafeArea edges={['top', 'left', 'right']}>
      {settingsSaveWarning ? <SettingsSaveWarning checking={settingsSaveWarning.checking} onCheck={settingsSaveWarning.onCheck} /> : null}
      <View style={[styles.content, showSettings && styles.hidden]}>
        {activeScreen}
      </View>
      <TabBar
        selectedTab={selectedTab}
        hidden={showSettings}
        onSelect={tab => {
          if (tab === 'transactions') { setTargetTransactionId(null); setTransactionSection('History'); }
          if (tab === 'debt') { setTargetDebtId(null); setDebtSection('Cards & Loans'); setDebtResetKey(value => value + 1); }
          if (tab === 'budget') setBudgetSection('Budget');
          setSelectedTab(tab);
        }}
      />
      {showSettings ? (
        <View style={styles.settingsOverlay}>
          {typeof settings === 'function' ? settings(() => onCloseSettings?.()) : settings}
        </View>
      ) : null}
      {overlay}
    </ThemedSafeArea>
    </TabShellContext.Provider>
    </NativeAppearanceProvider>
  );
}

function SettingsSaveWarning({ checking, onCheck }: { checking: boolean; onCheck: () => void }) {
  const { palette } = useNativeAppearance();
  return <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: palette.surface, gap: 4 }}>
    <Text accessibilityRole="alert" style={{ color: palette.text, fontSize: 13 }}>Save not confirmed. Showing last verified settings until checked.</Text>
    <Pressable accessibilityRole="button" disabled={checking} accessibilityState={{ disabled: checking, busy: checking }} onPress={onCheck} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <Text style={{ color: palette.brand, fontWeight: '700' }}>{checking ? 'Checking save...' : 'Check latest settings'}</Text>
    </Pressable>
  </View>;
}

function ThemedSafeArea({ children, edges }: ComponentProps<typeof SafeAreaView>) {
  const { palette } = useNativeAppearance();
  return <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: palette.canvas }]}>{children}</SafeAreaView>;
}

function TabBar({ selectedTab, hidden, onSelect }: { selectedTab: NavigationTabIconName; hidden: boolean; onSelect: (tab: NavigationTabIconName) => void }) {
  const { palette } = useNativeAppearance();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.navArea,
        {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          paddingBottom: bottomInsetPadding(insets.bottom, 6),
        },
        hidden && styles.hidden,
      ]}
    >
      <View accessibilityRole="tablist" style={styles.dock}>
        {NAVIGATION_TAB_ICONS.map(tab => {
          const selected = tab.name === selectedTab;
          const color = selected ? palette.brand : palette.muted;
          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected }}
              onPress={() => onSelect(tab.name)}
              style={styles.tab}
            >
              <NavigationIcon name={tab.name} color={color} />
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                maxFontSizeMultiplier={1.35}
                style={[styles.label, { color, fontWeight: selected ? '700' : '500' }]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0C0E0D' },
  navArea: {
    width: '100%',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
  },
  content: { flex: 1 },
  hidden: { display: 'none' },
  settingsOverlay: { flex: 1, backgroundColor: '#0C0E0D' },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 4,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  label: {
    fontSize: 11.5,
    textAlign: 'center',
    letterSpacing: 0.1,
  },
});



