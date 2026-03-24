/**
 * Accounts view TUI state
 */
import type { AccountViewItem, TypeCounts } from '../accounts-view-model.js';

/**
 * Active filters (read-only, applied from CLI args)
 */
export interface AccountsViewFilters {
  sourceFilter?: string | undefined;
  typeFilter?: string | undefined;
  showSessions: boolean;
}

/**
 * Accounts view state
 */
export interface AccountsViewState {
  // Data
  accounts: AccountViewItem[];
  typeCounts: TypeCounts;
  totalCount: number;

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Filters
  filters: AccountsViewFilters;
}

/**
 * Compute type counts from items
 */
export function computeTypeCounts(items: AccountViewItem[]): TypeCounts {
  const counts: TypeCounts = { blockchain: 0, exchangeApi: 0, exchangeCsv: 0 };
  for (const item of items) {
    switch (item.accountType) {
      case 'blockchain':
        counts.blockchain += 1;
        break;
      case 'exchange-api':
        counts.exchangeApi += 1;
        break;
      case 'exchange-csv':
        counts.exchangeCsv += 1;
        break;
    }
  }
  return counts;
}

/**
 * Create initial accounts view state
 */
export function createAccountsViewState(
  accounts: AccountViewItem[],
  filters: AccountsViewFilters,
  totalCount: number,
  typeCounts?: TypeCounts
): AccountsViewState {
  return {
    accounts,
    typeCounts: typeCounts ?? computeTypeCounts(accounts),
    totalCount,
    selectedIndex: 0,
    scrollOffset: 0,
    filters,
  };
}
