import type { AccountViewItem, ChildAccountViewItem, SessionViewItem } from './accounts-view-model.js';
import type { AccountSummary, SessionSummary } from './query/account-query.js';

export function toAccountViewItem(account: AccountSummary, sessions?: Map<number, SessionSummary[]>): AccountViewItem {
  const childAccounts: ChildAccountViewItem[] | undefined = account.childAccounts?.map((child) => ({
    id: child.id,
    accountFingerprint: child.accountFingerprint,
    identifier: child.identifier,
    sessionCount: child.sessionCount,
    balanceProjectionStatus: child.balanceProjectionStatus,
    verificationStatus: child.verificationStatus,
  }));

  const accountSessions = sessions?.get(account.id);
  const sessionViewItems: SessionViewItem[] | undefined = accountSessions?.map((session) => ({
    id: session.id,
    status: session.status,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
  }));

  return {
    id: account.id,
    accountFingerprint: account.accountFingerprint,
    accountType: account.accountType,
    platformKey: account.platformKey,
    name: account.name,
    identifier: account.identifier,
    parentAccountId: account.parentAccountId,
    providerName: account.providerName,
    balanceProjectionStatus: account.balanceProjectionStatus,
    balanceProjectionReason: account.balanceProjectionReason,
    lastCalculatedAt: account.lastCalculatedAt,
    lastRefreshAt: account.lastRefreshAt,
    storedAssetCount: account.storedAssetCount,
    storedBalanceStatusReason: account.storedBalanceStatusReason,
    storedBalanceSuggestion: account.storedBalanceSuggestion,
    verificationStatus: account.verificationStatus,
    sessionCount: account.sessionCount,
    childAccounts,
    sessions: sessionViewItems,
    createdAt: account.createdAt,
  };
}
