import { createContext, useCallback, useMemo, useState, type ReactNode, type ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import { NativeAppearanceProvider, Pressable, Text, View, useNativeAppearance } from './components/NativeAppearance';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NAVIGATION_TAB_ICONS, type NavigationTabIconName } from './components/AppIcon';
import { NavigationIcon } from './components/NavigationIcon';
import {
  AccountsUiContext,
  BudgetUiContext,
  DEFAULT_TAB_UI_PREFERENCES,
  ProgressUiContext,
  TabRefreshContext,
  TabShellContext,
  TabUiActionsContext,
  TransactionsUiContext,
  type AccountsUiPreferences,
  type BudgetUiPreferences,
  type ProgressUiPreferences,
  type RefreshFeedback,
  type TabUiPreferences,
  type TransactionsUiPreferences,
} from './components/TabShellContext';
import { bottomInsetPadding } from './components/bottom-inset';
import { InspireBackdrop } from './components/InspireArt';

type Navigate = (tab: NavigationTabIconName, section?: string) => void;
export const HomePaneVisibilityContext = createContext(false);

type FiveTabShellProps = {
  home: (navigate: Navigate) => ReactNode;
  debt: ReactNode | ((selectedDebtId: string | null, clearTarget: () => void, section: string, resetKey: number, navigate: Navigate) => ReactNode);
  transactions: ReactNode | ((selectedTransactionId: string | null, clearTarget: () => void, section: string, navigate: Navigate) => ReactNode);
  budget: (navigate: Navigate) => ReactNode;
  progress: ReactNode | ((navigate: Navigate) => ReactNode);
  settings?: ReactNode | ((onClose: () => void) => ReactNode);
  settingsVisible?: boolean;
  onCloseSettings?: () => void;
  userId?: string;
  overlay?: ReactNode;
  onRefresh?: () => Promise<void>;
  refreshing?: boolean;
  refreshFeedback?: RefreshFeedback;
  settingsSaveWarning?: { checking: boolean; onCheck: () => void };
};

export function FiveTabShell(props: FiveTabShellProps) {
  return (
    <NativeAppearanceProvider userId={props.userId}>
      <FiveTabShellContent {...props} />
    </NativeAppearanceProvider>
  );
}

function FiveTabShellContent({
  home,
  debt,
  transactions,
  budget,
  progress,
  settings,
  settingsVisible = false,
  onCloseSettings,
  overlay,
  onRefresh, refreshing = false, refreshFeedback, settingsSaveWarning,
}: FiveTabShellProps) {
  const [selectedTab, setSelectedTab] = useState<NavigationTabIconName>('home');
  const [visitedTabs, setVisitedTabs] = useState<Partial<Record<NavigationTabIconName, boolean>>>({ home: true });
  const [targetTransactionId, setTargetTransactionId] = useState<string | null>(null);
  const [targetDebtId, setTargetDebtId] = useState<string | null>(null);
  const [uiPreferences, setUiPreferences] = useState<TabUiPreferences>(DEFAULT_TAB_UI_PREFERENCES);
  const [debtSection, setDebtSection] = useState('Cards & Loans');
  const [debtResetKey, setDebtResetKey] = useState(0);
  const [transactionSection, setTransactionSection] = useState('History');

  const showSettings = Boolean(settingsVisible && settings);

  const activateTab = useCallback((tab: NavigationTabIconName) => {
    setVisitedTabs(current => (current[tab] ? current : { ...current, [tab]: true }));
    setSelectedTab(tab);
  }, []);

  const navigate = useCallback<Navigate>((tab, section) => {
    if (tab === 'debt' && section === 'Scheduled') {
      setTransactionSection('Scheduled');
      setUiPreferences(current => current.transactionsSection === 'Scheduled' ? current : { ...current, transactionsSection: 'Scheduled' });
      setTargetTransactionId(null);
      activateTab('transactions');
      return;
    }
    if (tab === 'debt') {
      const nextDebtSection = section === 'Strategy' ? 'Strategy' : 'Accounts';
      setDebtSection(section === 'Strategy' ? 'Strategy' : 'Cards & Loans');
      setUiPreferences(current => current.debtSection === nextDebtSection ? current : { ...current, debtSection: nextDebtSection });
      setTargetDebtId(section && section !== 'Strategy' && section !== 'Scheduled' && section !== 'Cards & Loans' && section !== 'Accounts' ? section : null);
      setDebtResetKey(value => value + 1);
    }
    if (tab === 'transactions') {
      const nextTxSection = section === 'Scheduled' ? 'Scheduled' : 'History';
      setTransactionSection(nextTxSection);
      setUiPreferences(current => current.transactionsSection === nextTxSection ? current : { ...current, transactionsSection: nextTxSection });
      setTargetTransactionId(section && !['History', 'Scheduled'].includes(section) ? section : null);
    }
    activateTab(tab);
  }, [activateTab]);

  const clearDebtTarget = useCallback(() => setTargetDebtId(null), []);
  const clearTransactionTarget = useCallback(() => setTargetTransactionId(null), []);
  const shell = useMemo(
    () => ({ onRefresh, refreshing, refreshFeedback, uiPreferences, setUiPreferences }),
    [onRefresh, refreshing, refreshFeedback, uiPreferences],
  );
  const refreshValue = useMemo(
    () => ({ onRefresh, refreshing, refreshFeedback }),
    [onRefresh, refreshing, refreshFeedback],
  );
  const accountsUi = useMemo<AccountsUiPreferences>(
    () => ({
      accountsCategory: uiPreferences.accountsCategory,
      accountsSearchQuery: uiPreferences.accountsSearchQuery,
      accountsSearchOpen: uiPreferences.accountsSearchOpen,
      accountsSort: uiPreferences.accountsSort,
      debtSection: uiPreferences.debtSection,
    }),
    [
      uiPreferences.accountsCategory,
      uiPreferences.accountsSearchQuery,
      uiPreferences.accountsSearchOpen,
      uiPreferences.accountsSort,
      uiPreferences.debtSection,
    ],
  );
  const transactionsUi = useMemo<TransactionsUiPreferences>(
    () => ({
      transactionsSection: uiPreferences.transactionsSection,
      transactionsDateFilter: uiPreferences.transactionsDateFilter,
      transactionsTypeFilters: uiPreferences.transactionsTypeFilters,
      transactionsAccountGroups: uiPreferences.transactionsAccountGroups,
      transactionsAccountIds: uiPreferences.transactionsAccountIds,
      transactionsSearchQuery: uiPreferences.transactionsSearchQuery,
      transactionsSearchOpen: uiPreferences.transactionsSearchOpen,
      transactionsSort: uiPreferences.transactionsSort,
    }),
    [
      uiPreferences.transactionsSection,
      uiPreferences.transactionsDateFilter,
      uiPreferences.transactionsTypeFilters,
      uiPreferences.transactionsAccountGroups,
      uiPreferences.transactionsAccountIds,
      uiPreferences.transactionsSearchQuery,
      uiPreferences.transactionsSearchOpen,
      uiPreferences.transactionsSort,
    ],
  );
  const budgetUi = useMemo<BudgetUiPreferences>(
    () => ({ budgetSection: uiPreferences.budgetSection }),
    [uiPreferences.budgetSection],
  );
  const progressUi = useMemo<ProgressUiPreferences>(
    () => ({ progressSection: uiPreferences.progressSection }),
    [uiPreferences.progressSection],
  );
  const homeVisible = selectedTab === 'home' && !showSettings;
  const homeContent = useMemo(() => home(navigate), [home, navigate]);
  // Keep mounted panes on the same React elements when only the selected tab changes.
  const debtContent = useMemo(() => visitedTabs.debt
    ? typeof debt === 'function' ? debt(targetDebtId, clearDebtTarget, debtSection, debtResetKey, navigate) : debt
    : null, [visitedTabs.debt, debt, targetDebtId, clearDebtTarget, debtSection, debtResetKey, navigate]);
  const transactionsContent = useMemo(() => visitedTabs.transactions
    ? typeof transactions === 'function' ? transactions(targetTransactionId, clearTransactionTarget, transactionSection, navigate) : transactions
    : null, [visitedTabs.transactions, transactions, targetTransactionId, clearTransactionTarget, transactionSection, navigate]);
  const budgetContent = useMemo(() => visitedTabs.budget ? budget(navigate) : null, [visitedTabs.budget, budget, navigate]);
  const progressContent = useMemo(() => visitedTabs.progress
    ? typeof progress === 'function' ? progress(navigate) : progress
    : null, [visitedTabs.progress, progress, navigate]);

  const renderTabPane = (tab: NavigationTabIconName, content: ReactNode) => {
    const active = selectedTab === tab;
    return (
      <View
        key={tab}
        style={[styles.tabPane, !active && styles.hidden]}
        pointerEvents={active ? 'auto' : 'none'}
        accessibilityElementsHidden={!active}
        importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      >
        {content}
      </View>
    );
  };

  return (
    <TabShellContext.Provider value={shell}>
    <TabRefreshContext.Provider value={refreshValue}>
    <TabUiActionsContext.Provider value={setUiPreferences}>
    <AccountsUiContext.Provider value={accountsUi}>
    <TransactionsUiContext.Provider value={transactionsUi}>
    <BudgetUiContext.Provider value={budgetUi}>
    <ProgressUiContext.Provider value={progressUi}>
    <ThemedSafeArea edges={['top', 'left', 'right']}>
      {settingsSaveWarning ? <SettingsSaveWarning checking={settingsSaveWarning.checking} onCheck={settingsSaveWarning.onCheck} /> : null}
      <View style={[styles.content, showSettings && styles.hidden]}>
        {renderTabPane('home', (
          <HomePaneVisibilityContext.Provider value={homeVisible}>
            {homeContent}
          </HomePaneVisibilityContext.Provider>
        ))}
        {visitedTabs.debt ? renderTabPane('debt', debtContent) : null}
        {visitedTabs.transactions ? renderTabPane('transactions', transactionsContent) : null}
        {visitedTabs.budget ? renderTabPane('budget', budgetContent) : null}
        {visitedTabs.progress ? renderTabPane('progress', progressContent) : null}
      </View>
      <TabBar
        selectedTab={selectedTab}
        hidden={showSettings}
        onSelect={tab => {
          if (tab !== selectedTab) {
            if (tab === 'transactions') setTargetTransactionId(null);
            if (tab === 'debt') setTargetDebtId(null);
          }
          activateTab(tab);
        }}
      />
      {showSettings ? (
        <View style={styles.settingsOverlay}>
          {typeof settings === 'function' ? settings(() => onCloseSettings?.()) : settings}
        </View>
      ) : null}
      {overlay}
    </ThemedSafeArea>
    </ProgressUiContext.Provider>
    </BudgetUiContext.Provider>
    </TransactionsUiContext.Provider>
    </AccountsUiContext.Provider>
    </TabUiActionsContext.Provider>
    </TabRefreshContext.Provider>
    </TabShellContext.Provider>
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
  return <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: palette.canvas }]}><InspireBackdrop />{children}</SafeAreaView>;
}

function TabBar({ selectedTab, hidden, onSelect }: { selectedTab: NavigationTabIconName; hidden: boolean; onSelect: (tab: NavigationTabIconName) => void }) {
  const { palette } = useNativeAppearance();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.navArea,
        {
          backgroundColor: palette.navBg,
          borderTopColor: palette.border,
          paddingBottom: bottomInsetPadding(insets.bottom, 6),
        },
        hidden && styles.hidden,
      ]}
    >
      <View accessibilityRole="tablist" style={styles.dock}>
        {NAVIGATION_TAB_ICONS.map(tab => {
          const selected = tab.name === selectedTab;
          const color = selected ? palette.accentInk : palette.muted;
          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected }}
              onPress={() => onSelect(tab.name)}
              style={styles.tab}
            >
              <View style={styles.dockIcon}>
                <NavigationIcon name={tab.name} color={selected ? palette.brand : palette.muted} />
              </View>
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
  tabPane: { flex: 1 },
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
  dockIcon: { width: 43, height: 27, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  label: {
    fontSize: 11.5,
    textAlign: 'center',
    letterSpacing: 0.1,
  },
});



