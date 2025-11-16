import type { Account } from '@exitbook/core';

/**
 * Parameters for account query service
 */
export interface AccountQueryParams {
  accountId?: number;
  accountType?: 'blockchain' | 'exchange-api' | 'exchange-csv';
  source?: string;
}

/**
 * Session summary for display
 */
export interface SessionSummary {
  id: number;
  status: string;
  startedAt: string;
  completedAt?: string | undefined;
}

/**
 * Formatted account for display
 */
export interface FormattedAccount {
  id: number;
  accountType: string;
  sourceName: string;
  identifier: string;
  providerName?: string | undefined;
  lastBalanceCheckAt?: string | undefined;
  verificationStatus?: 'match' | 'mismatch' | 'never-checked' | undefined;
  sessionCount?: number | undefined;
  createdAt: string;
}

/**
 * Result of account query operation
 */
export interface AccountQueryResult {
  accounts: FormattedAccount[];
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
  if (!account.verificationMetadata) {
    return account.lastBalanceCheckAt ? undefined : 'never-checked';
  }

  const metadata = account.verificationMetadata;

  // Guard against missing last_verification (legacy or corrupted data)
  if (!metadata.last_verification) {
    return account.lastBalanceCheckAt ? undefined : 'never-checked';
  }

  const status = metadata.last_verification.status;

  if (status === 'match') {
    return 'match';
  }

  if (status === 'mismatch') {
    return 'mismatch';
  }

  return undefined;
}

/**
 * Format account for display.
 */
export function formatAccount(account: Account, sessionCount: number | undefined): FormattedAccount {
  return {
    id: account.id,
    accountType: account.accountType,
    sourceName: account.sourceName,
    identifier: maskIdentifier(account),
    providerName: account.providerName ?? undefined,
    lastBalanceCheckAt: account.lastBalanceCheckAt?.toISOString(),
    verificationStatus: getVerificationStatus(account),
    sessionCount,
    createdAt: account.createdAt.toISOString(),
  };
}
