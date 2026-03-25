import type { AccountType } from '@exitbook/core';

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
  verificationStatus?: AccountVerificationStatus | undefined;
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
