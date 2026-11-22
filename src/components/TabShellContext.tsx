import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';

export type RefreshFeedback = { kind: 'success' | 'warning' | 'error'; message: string } | null;
export type AccountsCategoryFilter = 'All' | 'Credit Cards' | 'Personal Loans' | 'Auto' | 'Home' | 'Paid Off';
export type TransactionsDateFilter = { scope: 'month' | 'year' | 'lifetime'; value: string };
export type HistoryTransactionTypeFilter = 'payments' | 'bills' | 'purchases' | 'interest_fees' | 'refunds_adjustments';
export type HistorySortOption = 'newest' | 'oldest' | 'highest_amount' | 'lowest_amount';
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
  transactionsTypeFilters: HistoryTransactionTypeFilter[];
  transactionsAccountGroups: string[];
  transactionsAccountIds: string[];
  transactionsSearchQuery: string;
  transactionsSearchOpen: boolean;
  transactionsSort: HistorySortOption;
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
  transactionsTypeFilters: [],
  transactionsAccountGroups: [],
  transactionsAccountIds: [],
  transactionsSearchQuery: '',
  transactionsSearchOpen: false,
  transactionsSort: 'newest',
};

export type TabShellContextValue = {
  onRefresh?: () => Promise<void>;
  refreshing: boolean;
  refreshFeedback?: RefreshFeedback;
  uiPreferences: TabUiPreferences;
  setUiPreferences: Dispatch<SetStateAction<TabUiPreferences>>;
};
export const TabShellContext = createContext<TabShellContextValue | null>(null);
export const useTabShell = () => useContext(TabShellContext);

export type TabRefreshContextValue = {
  onRefresh?: () => Promise<void>;
  refreshing: boolean;
  refreshFeedback?: RefreshFeedback;
};
export const TabRefreshContext = createContext<TabRefreshContextValue | null>(null);
export const useTabRefresh = () => useContext(TabRefreshContext);

export const TabUiActionsContext = createContext<Dispatch<SetStateAction<TabUiPreferences>> | null>(null);
export const useSetTabUiPreferences = () => useContext(TabUiActionsContext);

export type AccountsUiPreferences = Pick<
  TabUiPreferences,
  'accountsCategory' | 'accountsSearchQuery' | 'accountsSearchOpen' | 'accountsSort' | 'debtSection'
>;
export const AccountsUiContext = createContext<AccountsUiPreferences | null>(null);
export const useAccountsUiPreferences = () => useContext(AccountsUiContext);

export type TransactionsUiPreferences = Pick<
  TabUiPreferences,
  | 'transactionsSection'
  | 'transactionsDateFilter'
  | 'transactionsTypeFilters'
  | 'transactionsAccountGroups'
  | 'transactionsAccountIds'
  | 'transactionsSearchQuery'
  | 'transactionsSearchOpen'
  | 'transactionsSort'
>;
export const TransactionsUiContext = createContext<TransactionsUiPreferences | null>(null);
export const useTransactionsUiPreferences = () => useContext(TransactionsUiContext);

export type BudgetUiPreferences = Pick<TabUiPreferences, 'budgetSection'>;
export const BudgetUiContext = createContext<BudgetUiPreferences | null>(null);
export const useBudgetUiPreferences = () => useContext(BudgetUiContext);

export type ProgressUiPreferences = Pick<TabUiPreferences, 'progressSection'>;
export const ProgressUiContext = createContext<ProgressUiPreferences | null>(null);
export const useProgressUiPreferences = () => useContext(ProgressUiContext);
