import { createContext, useContext } from 'react';
import type { NavigationTabIconName } from './AppIcon';

export type RefreshFeedback = { kind: 'success' | 'warning' | 'error'; message: string } | null;
export type TabShellContextValue = {
  tab: NavigationTabIconName;
  registerAction: (tab: NavigationTabIconName, callback: () => void, label?: string) => () => void;
  onRefresh?: () => Promise<void>;
  refreshing: boolean;
  refreshFeedback?: RefreshFeedback;
};
export const TabShellContext = createContext<TabShellContextValue | null>(null);
export const useTabShell = () => useContext(TabShellContext);
