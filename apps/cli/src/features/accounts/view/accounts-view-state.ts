import type { StoredBalanceAssetsExplorerState } from '../../shared/stored-balance-assets-view.js';
import type {
  AccountDetailViewItem,
  AccountViewItem,
  ReadableAccountStoredBalanceDetailView,
  TypeCounts,
} from '../accounts-view-model.js';

export interface AccountsViewFilters {
  platformFilter?: string | undefined;
  typeFilter?: string | undefined;
  showSessions: boolean;
}

export interface AccountsListViewState {
  view: 'accounts';
  accounts: AccountViewItem[];
  accountDetailsById?: Record<number, AccountDetailViewItem> | undefined;
  typeCounts: TypeCounts;
  totalCount: number;
  selectedIndex: number;
  scrollOffset: number;
  filters: AccountsViewFilters;
}

export interface AccountsAssetsViewState extends StoredBalanceAssetsExplorerState {
  view: 'assets';
  parentState?: AccountsListViewState | undefined;
}

export type AccountsViewState = AccountsListViewState | AccountsAssetsViewState;

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
  typeCounts?: TypeCounts,
  initialSelectedIndex?: number,
  accountDetailsById?: Record<number, AccountDetailViewItem>
): AccountsListViewState {
  const selectedIndex = clampSelectedIndex(initialSelectedIndex, accounts.length);

  return {
    view: 'accounts',
    accounts,
    accountDetailsById,
    typeCounts: typeCounts ?? computeTypeCounts(accounts),
    totalCount,
    selectedIndex,
    scrollOffset: selectedIndex > 0 ? selectedIndex : 0,
    filters,
  };
}

export function createAccountsAssetsViewState(
  balance: ReadableAccountStoredBalanceDetailView,
  options?: {
    parentState?: AccountsListViewState | undefined;
  }
): AccountsAssetsViewState {
  return {
    view: 'assets',
    accountId: balance.scopeAccount.id,
    accountType: balance.scopeAccount.accountType,
    assets: balance.assets,
    lastRefreshAt: balance.lastRefreshAt,
    platformKey: balance.scopeAccount.platformKey,
    scrollOffset: 0,
    selectedIndex: 0,
    statusReason: balance.statusReason,
    suggestion: balance.suggestion,
    verificationStatus: balance.verificationStatus,
    parentState: options?.parentState,
  };
}

function clampSelectedIndex(selectedIndex: number | undefined, itemCount: number): number {
  if (itemCount === 0) {
    return 0;
  }

  if (selectedIndex === undefined || !Number.isFinite(selectedIndex)) {
    return 0;
  }

  if (selectedIndex < 0) {
    return 0;
  }

  if (selectedIndex >= itemCount) {
    return itemCount - 1;
  }

  return selectedIndex;
}
