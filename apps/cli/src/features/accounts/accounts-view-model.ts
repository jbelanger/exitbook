import type { AccountType, BalanceSnapshotVerificationStatus } from '@exitbook/core';

import type { StoredBalanceAssetViewItem } from '../shared/stored-balance-view.js';

import type { AccountBalanceProjectionStatus, AccountVerificationStatus } from './query/account-query.js';

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
  accountFingerprint: string;
  identifier: string;
  sessionCount: number | undefined;
  balanceProjectionStatus?: AccountBalanceProjectionStatus | undefined;
  verificationStatus?: AccountVerificationStatus | undefined;
}

/**
 * Per-account display item
 */
export interface AccountViewItem {
  id: number;
  accountFingerprint: string;
  accountType: AccountType;
  platformKey: string;
  name?: string | undefined;
  identifier: string;
  parentAccountId?: number | undefined;
  providerName?: string | undefined;
  balanceProjectionStatus?: AccountBalanceProjectionStatus | undefined;
  balanceProjectionReason?: string | undefined;
  lastCalculatedAt?: string | undefined;
  lastRefreshAt?: string | undefined;
  storedAssetCount?: number | undefined;
  storedBalanceStatusReason?: string | undefined;
  storedBalanceSuggestion?: string | undefined;
  verificationStatus?: AccountVerificationStatus | undefined;
  sessionCount: number | undefined;
  childAccounts?: ChildAccountViewItem[] | undefined;
  sessions?: SessionViewItem[] | undefined;
  createdAt: string;
}

export interface AccountScopeViewItem {
  id: number;
  accountFingerprint: string;
  accountType: AccountType;
  platformKey: string;
  identifier: string;
  name?: string | undefined;
}

export interface ReadableAccountStoredBalanceDetailView {
  readable: true;
  scopeAccount: AccountScopeViewItem;
  verificationStatus?: BalanceSnapshotVerificationStatus | undefined;
  statusReason?: string | undefined;
  suggestion?: string | undefined;
  lastRefreshAt?: string | undefined;
  assets: StoredBalanceAssetViewItem[];
}

export interface UnreadableAccountStoredBalanceDetailView {
  readable: false;
  scopeAccount: AccountScopeViewItem;
  reason: string;
  hint: string;
}

export type AccountStoredBalanceDetailView =
  | ReadableAccountStoredBalanceDetailView
  | UnreadableAccountStoredBalanceDetailView;

export interface AccountDetailViewItem extends AccountViewItem {
  requestedAccount?: AccountScopeViewItem | undefined;
  balance: AccountStoredBalanceDetailView;
}

/**
 * Counts by account type for header
 */
export interface TypeCounts {
  blockchain: number;
  exchangeApi: number;
  exchangeCsv: number;
}
