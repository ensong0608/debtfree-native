import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppIcon, NAVIGATION_TAB_ICONS, type NavigationTabIconName } from './components/AppIcon';

export function FiveTabShell({ home, debt, transactions, budget, progress }: { home: (navigate: (tab: NavigationTabIconName, section?: string) => void) => ReactNode; debt: ReactNode; transactions: ReactNode; budget: (section: string) => ReactNode; progress: ReactNode }) {
  const [selectedTab, setSelectedTab] = useState<NavigationTabIconName>('home');
  const [budgetSection, setBudgetSection] = useState('Budget');
  const navigate = (tab: NavigationTabIconName, section?: string) => { if (tab === 'budget') setBudgetSection(section ?? 'Budget'); setSelectedTab(tab); };
  const screens = { home: home(navigate), debt, transactions, budget: budget(budgetSection), progress };

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
              <AppIcon name={tab.name} selected={selected} color={color} size={24} />
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
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#414743', backgroundColor: '#262927' },
  tab: { flex: 1, minWidth: 0, minHeight: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, paddingVertical: 6, gap: 3 },
  label: { fontSize: 11, fontWeight: '600', textAlign: 'center', width: '100%' },
});


