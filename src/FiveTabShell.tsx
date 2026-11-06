import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppIcon, NAVIGATION_TAB_ICONS, type NavigationTabIconName } from './components/AppIcon';

export function FiveTabShell({
  home,
  debt,
  transactions,
  budget,
  progress,
}: {
  home: (navigate: (tab: NavigationTabIconName, section?: string) => void) => ReactNode;
  debt: ReactNode | ((selectedDebtId: string | null) => ReactNode);
  transactions: ReactNode;
  budget: (section: string) => ReactNode;
  progress: ReactNode | ((navigate: (tab: NavigationTabIconName, section?: string) => void) => ReactNode);
}) {
  const [selectedTab, setSelectedTab] = useState<NavigationTabIconName>('home');
  const [budgetSection, setBudgetSection] = useState('Budget');
  const [targetDebtId, setTargetDebtId] = useState<string | null>(null);

  const navigate = (tab: NavigationTabIconName, section?: string) => {
    if (tab === 'budget') setBudgetSection(section ?? 'Budget');
    if (tab === 'debt') setTargetDebtId(section ?? null);
    setSelectedTab(tab);
  };

  const screens = {
    home: home(navigate),
    debt: typeof debt === 'function' ? debt(targetDebtId) : debt,
    transactions,
    budget: budget(budgetSection),
    progress: typeof progress === 'function' ? progress(navigate) : progress,
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.content}>
        {screens[selectedTab]}
      </View>
      <View accessibilityRole="tablist" style={styles.tabBar}>
        {NAVIGATION_TAB_ICONS.map(tab => {
          const selected = tab.name === selectedTab;
          const color = selected ? '#81DFD2' : '#AAB3AD';
          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected }}
              onPress={() => setSelectedTab(tab.name)}
              style={styles.tab}
            >
              <View style={[styles.iconWrap, selected && styles.iconWrapSelected]}>
                <AppIcon name={tab.name} selected={selected} color={color} size={22} />
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.label, { color }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1F201F' },
  content: { flex: 1 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#353D38', backgroundColor: '#242926', paddingHorizontal: 6, paddingTop: 6 },
  tab: { flex: 1, minWidth: 0, minHeight: 66, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, paddingVertical: 4, gap: 3 },
  iconWrap: { width: 48, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  iconWrapSelected: { backgroundColor: '#31534D' },
  label: { fontSize: 11, fontWeight: '600', textAlign: 'center', width: '100%', letterSpacing: 0.1 },
});


