import type { Account, AccountType } from '@exitbook/core';

/**
 * Parameters for account query service
 */
export interface AccountQueryParams {
  accountId?: number | undefined;
  accountType?: AccountType | undefined;
  source?: string | undefined;
}

/**
 * Session summary for display
 */
export interface SessionSummary {
  id: number;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string | undefined;
}

/**
 * Formatted account for display
 */
export interface AccountView {
  id: number;
  accountType: AccountType;
  sourceName: string;
  identifier: string;
  parentAccountId?: number | undefined;
  providerName?: string | undefined;
  lastBalanceCheckAt?: string | undefined;
  verificationStatus?: 'match' | 'mismatch' | 'never-checked' | undefined;
  sessionCount: number | undefined;
  childAccounts?: AccountView[] | undefined;
  createdAt: string;
}

/**
 * Result of account query operation
 */
export interface AccountListResult {
  accounts: AccountView[];
  sessions?: Map<number, SessionSummary[]> | undefined;
  count: number;
}

/**
 * Mask sensitive identifiers (API keys) for security.
 * Shows first 8 chars + *** for exchange-api accounts, full address for blockchain.
 */
export function maskIdentifier(account: Account): string {
  if (account.accountType === 'exchange-api' && account.identifier) {
    // Mask API keys: show first 8 chars + ***
    const key = account.identifier;
    if (key.length <= 8) {
      return '***';
    }
    return `${key.slice(0, 8)}***`;
  }
  // For blockchain and exchange-csv, show the full identifier
  return account.identifier;
}

/**
 * Determine verification status from account metadata.
 */
export function getVerificationStatus(account: Account): 'match' | 'mismatch' | 'never-checked' | undefined {
  const lastVerification = account.verificationMetadata?.last_verification;

  if (!lastVerification) {
    return account.lastBalanceCheckAt ? undefined : 'never-checked';
  }

  const { status } = lastVerification;
  if (status === 'match' || status === 'mismatch') {
    return status;
  }

  return undefined;
}

/**
 * Format account for display.
 */
export function formatAccount(
  account: Account,
  sessionCount: number | undefined,
  childAccounts?: AccountView[]
): AccountView {
  return {
    id: account.id,
    accountType: account.accountType,
    sourceName: account.sourceName,
    identifier: maskIdentifier(account),
    parentAccountId: account.parentAccountId,
    providerName: account.providerName ?? undefined,
    lastBalanceCheckAt: account.lastBalanceCheckAt?.toISOString(),
    verificationStatus: getVerificationStatus(account),
    sessionCount,
    childAccounts,
    createdAt: account.createdAt.toISOString(),
  };
}
