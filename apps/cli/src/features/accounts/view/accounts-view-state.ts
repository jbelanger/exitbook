import type { AccountViewItem, TypeCounts } from '../accounts-view-model.js';

export interface AccountsViewFilters {
  platformFilter?: string | undefined;
  typeFilter?: string | undefined;
  showSessions: boolean;
}

export interface AccountsViewState {
  accounts: AccountViewItem[];
  typeCounts: TypeCounts;
  totalCount: number;
  selectedIndex: number;
  scrollOffset: number;
  filters: AccountsViewFilters;
}

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
