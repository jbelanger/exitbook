import type { Account, AccountType, BalanceSnapshot, ProjectionStatus } from '@exitbook/core';

type IdentifierMaskInput = Pick<Account, 'accountType' | 'identifier'>;

export interface AccountQueryParams {
  profileId: number;
  accountId?: number | undefined;
  accountType?: AccountType | undefined;
  platformKey?: string | undefined;
  showSessions?: boolean | undefined;
}

export interface SessionSummary {
  id: number;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string | undefined;
}

export type AccountVerificationStatus = Exclude<BalanceSnapshot['verificationStatus'], 'never-run'> | 'never-checked';
export type AccountBalanceProjectionStatus = ProjectionStatus | 'never-built';

export interface AccountProjectionFreshness {
  status: AccountBalanceProjectionStatus;
  reason?: string | undefined;
}

export interface AccountSummary {
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
  verificationStatus?: AccountVerificationStatus | undefined;
  sessionCount: number | undefined;
  childAccounts?: AccountSummary[] | undefined;
  createdAt: string;
}

export interface AccountListResult {
  accounts: AccountSummary[];
  sessions?: Map<number, SessionSummary[]> | undefined;
  count: number;
}

export function maskIdentifier(account: IdentifierMaskInput): string {
  if (account.accountType === 'exchange-api' && account.identifier) {
    const key = account.identifier;
    if (key.length <= 8) {
      return '***';
    }
    return `${key.slice(0, 8)}***`;
  }
  return account.identifier;
}

export function getVerificationStatus(snapshot?: BalanceSnapshot): AccountVerificationStatus | undefined {
  if (!snapshot || snapshot.verificationStatus === 'never-run') {
    return 'never-checked';
  }
  return snapshot.verificationStatus;
}

export function toAccountSummary(
  account: Account,
  sessionCount: number | undefined,
  snapshot?: BalanceSnapshot,
  projectionFreshness?: AccountProjectionFreshness,
  childAccounts?: AccountSummary[]
): AccountSummary {
  return {
    id: account.id,
    accountFingerprint: account.accountFingerprint,
    accountType: account.accountType,
    platformKey: account.platformKey,
    name: account.name,
    identifier: maskIdentifier(account),
    parentAccountId: account.parentAccountId,
    providerName: account.providerName ?? undefined,
    balanceProjectionStatus: projectionFreshness?.status ?? (snapshot ? 'fresh' : 'never-built'),
    balanceProjectionReason: projectionFreshness?.reason,
    lastCalculatedAt: snapshot?.calculatedAt?.toISOString(),
    lastRefreshAt: snapshot?.lastRefreshAt?.toISOString(),
    verificationStatus: getVerificationStatus(snapshot),
    sessionCount,
    childAccounts,
    createdAt: account.createdAt.toISOString(),
  };
}
