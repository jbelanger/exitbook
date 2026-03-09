/**
 * Accounts view TUI state
 */

import type { AccountType } from '@exitbook/core';

/**
 * Session line item for detail panel (when --show-sessions)
 */
export interface SessionViewItem {
  id: number;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string | undefined;
}

/**
 * Child account for detail panel (derived addresses)
 */
export interface ChildAccountViewItem {
  id: number;
  identifier: string;
  sessionCount: number | undefined;
  verificationStatus?: 'match' | 'mismatch' | 'never-checked' | undefined;
}

/**
 * Per-account display item
 */
export interface AccountViewItem {
  id: number;
  accountType: AccountType;
  sourceName: string;
  identifier: string;
  parentAccountId?: number | undefined;
  providerName?: string | undefined;
  lastBalanceCheckAt?: string | undefined;
  verificationStatus?: 'match' | 'mismatch' | 'never-checked' | undefined;
  sessionCount: number | undefined;
  childAccounts?: ChildAccountViewItem[] | undefined;
  sessions?: SessionViewItem[] | undefined;
  createdAt: string;
}

/**
 * Counts by account type for header
 */
export interface TypeCounts {
  blockchain: number;
  exchangeApi: number;
  exchangeCsv: number;
}

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
