import type { AccountType } from '@exitbook/core';

import type { CommonViewFilters } from '../../shared/view-utils.js';
import type { AccountSummary, SessionSummary } from '../query/account-query.js';
import type { AccountViewItem, ChildAccountViewItem, SessionViewItem } from '../view/accounts-view-state.js';

/**
 * Parameters for view accounts command.
 */
export interface ViewAccountsParams extends CommonViewFilters {
  accountId?: number | undefined;
  accountType?: AccountType | undefined;
  showSessions?: boolean | undefined;
}

// ─── TUI Transformation Utilities ───────────────────────────────────────────

/**
 * Convert an AccountSummary to an AccountViewItem for TUI display.
 */
export function toAccountViewItem(account: AccountSummary, sessions?: Map<number, SessionSummary[]>): AccountViewItem {
  const childAccounts: ChildAccountViewItem[] | undefined = account.childAccounts?.map((child) => ({
    id: child.id,
    identifier: child.identifier,
    sessionCount: child.sessionCount,
    balanceProjectionStatus: child.balanceProjectionStatus,
    verificationStatus: child.verificationStatus,
  }));

  const accountSessions = sessions?.get(account.id);
  const sessionViewItems: SessionViewItem[] | undefined = accountSessions?.map((s) => ({
    id: s.id,
    status: s.status,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
  }));

  return {
    id: account.id,
    accountType: account.accountType,
    sourceName: account.sourceName,
    identifier: account.identifier,
    parentAccountId: account.parentAccountId,
    providerName: account.providerName,
    balanceProjectionStatus: account.balanceProjectionStatus,
    balanceProjectionReason: account.balanceProjectionReason,
    lastCalculatedAt: account.lastCalculatedAt,
    lastRefreshAt: account.lastRefreshAt,
    verificationStatus: account.verificationStatus,
    sessionCount: account.sessionCount,
    childAccounts,
    sessions: sessionViewItems,
    createdAt: account.createdAt,
  };
}
