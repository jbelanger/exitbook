import type { Account, AccountType, BalanceSnapshot } from '@exitbook/core';

export interface AccountQueryParams {
  accountId?: number | undefined;
  accountType?: AccountType | undefined;
  source?: string | undefined;
  showSessions?: boolean | undefined;
}

export interface SessionSummary {
  id: number;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string | undefined;
}

export interface AccountSummary {
  id: number;
  accountType: AccountType;
  sourceName: string;
  identifier: string;
  parentAccountId?: number | undefined;
  providerName?: string | undefined;
  lastBalanceCheckAt?: string | undefined;
  verificationStatus?: 'match' | 'mismatch' | 'never-checked' | undefined;
  sessionCount: number | undefined;
  childAccounts?: AccountSummary[] | undefined;
  createdAt: string;
}

export function getBalanceScopeAccountId(account: Pick<Account, 'id' | 'parentAccountId'>): number {
  return account.parentAccountId ?? account.id;
}

export interface AccountListResult {
  accounts: AccountSummary[];
  sessions?: Map<number, SessionSummary[]> | undefined;
  count: number;
}

/**
 * Mask sensitive identifiers (API keys) for security.
 * Shows first 8 chars + *** for exchange-api accounts, full address for blockchain.
 */
export function maskIdentifier(account: Account): string {
  if (account.accountType === 'exchange-api' && account.identifier) {
    const key = account.identifier;
    if (key.length <= 8) {
      return '***';
    }
    return `${key.slice(0, 8)}***`;
  }
  return account.identifier;
}

/**
 * Determine verification status from a stored balance snapshot.
 */
export function getVerificationStatus(snapshot?: BalanceSnapshot): 'match' | 'mismatch' | 'never-checked' | undefined {
  if (!snapshot || snapshot.verificationStatus === 'never-run') {
    return 'never-checked';
  }

  if (snapshot.verificationStatus === 'match') {
    return 'match';
  }

  if (snapshot.verificationStatus === 'mismatch') {
    return 'mismatch';
  }

  return undefined;
}

/**
 * Project an Account domain object to an AccountSummary read model.
 */
export function toAccountSummary(
  account: Account,
  sessionCount: number | undefined,
  snapshot?: BalanceSnapshot,
  childAccounts?: AccountSummary[]
): AccountSummary {
  return {
    id: account.id,
    accountType: account.accountType,
    sourceName: account.sourceName,
    identifier: maskIdentifier(account),
    parentAccountId: account.parentAccountId,
    providerName: account.providerName ?? undefined,
    lastBalanceCheckAt: snapshot?.lastRefreshAt?.toISOString(),
    verificationStatus: getVerificationStatus(snapshot),
    sessionCount,
    childAccounts,
    createdAt: account.createdAt.toISOString(),
  };
}
