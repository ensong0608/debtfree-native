import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import type { NavigationTabIconName } from './AppIcon';

export type RefreshFeedback = { kind: 'success' | 'warning' | 'error'; message: string } | null;
export type AccountsCategoryFilter = 'All' | 'Credit Cards' | 'Personal Loans' | 'Auto' | 'Home' | 'Paid Off';
export type TransactionsDateFilter = { scope: 'month' | 'year' | 'lifetime'; value: string };
export type TabUiPreferences = {
  accountsCategory: AccountsCategoryFilter;
  accountsSearchQuery: string;
  accountsSearchOpen: boolean;
  accountsSort: number;
  debtSection: 'Accounts' | 'Strategy';
  transactionsSection: 'History' | 'Scheduled';
  budgetSection: 'Budget' | 'Expense';
  progressSection: 'Overview' | 'Utilization' | 'Milestones';
  transactionsDateFilter: TransactionsDateFilter;
  transactionsAccountFilter: string;
  transactionsTypeFilter: number;
  transactionsSearchQuery: string;
  transactionsSearchOpen: boolean;
  transactionsSortAsc: boolean;
};

export const DEFAULT_TAB_UI_PREFERENCES: TabUiPreferences = {
  accountsCategory: 'All',
  accountsSearchQuery: '',
  accountsSearchOpen: false,
  accountsSort: 0,
  debtSection: 'Accounts',
  transactionsSection: 'History',
  budgetSection: 'Budget',
  progressSection: 'Overview',
  transactionsDateFilter: { scope: 'month', value: '' },
  transactionsAccountFilter: 'all',
  transactionsTypeFilter: 0,
  transactionsSearchQuery: '',
  transactionsSearchOpen: false,
  transactionsSortAsc: false,
};

export type TabShellContextValue = {
  tab: NavigationTabIconName;
  onRefresh?: () => Promise<void>;
  refreshing: boolean;
  refreshFeedback?: RefreshFeedback;
  uiPreferences: TabUiPreferences;
  setUiPreferences: Dispatch<SetStateAction<TabUiPreferences>>;
};
export const TabShellContext = createContext<TabShellContextValue | null>(null);
export const useTabShell = () => useContext(TabShellContext);
