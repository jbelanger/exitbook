import type { Account, AccountType, ExchangeCredentials } from '@exitbook/core';

import type { AssetComparisonItem } from './accounts-refresh-types.js';

const ACCOUNT_TYPE_PRIORITY: Record<AccountType, number> = {
  blockchain: 0,
  'exchange-api': 1,
  'exchange-csv': 2,
};

const ASSET_STATUS_PRIORITY: Record<AssetComparisonItem['status'], number> = {
  mismatch: 0,
  warning: 1,
  match: 2,
};

interface AccountRefreshCredentialResolution {
  credentials?: ExchangeCredentials | undefined;
  skipReason?: string | undefined;
}

export function sortAccountsByRefreshPriority<T extends { accountId: number; accountType: AccountType }>(
  accounts: T[]
): T[] {
  return [...accounts].sort((a, b) => {
    const typeDiff = ACCOUNT_TYPE_PRIORITY[a.accountType] - ACCOUNT_TYPE_PRIORITY[b.accountType];
    if (typeDiff !== 0) return typeDiff;
    return a.accountId - b.accountId;
  });
}

export function sortAssetComparisonsByStatus(assets: AssetComparisonItem[]): AssetComparisonItem[] {
  return [...assets].sort((a, b) => {
    const statusDiff = ASSET_STATUS_PRIORITY[a.status] - ASSET_STATUS_PRIORITY[b.status];
    if (statusDiff !== 0) return statusDiff;
    return a.assetSymbol.localeCompare(b.assetSymbol);
  });
}

export function resolveAccountRefreshCredentials(account: Account): AccountRefreshCredentialResolution {
  if (account.accountType === 'blockchain') {
    return {};
  }

  if (account.credentials) {
    return { credentials: account.credentials };
  }

  return { skipReason: 'no stored provider credentials' };
}
