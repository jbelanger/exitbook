import type { Account } from '@exitbook/core';

/**
 * Parameters for clear operation
 */
export interface ClearServiceParams {
  accountId?: number | undefined;
  includeRaw: boolean;
  source?: string | undefined;
}

/**
 * Deletion preview for confirmation
 */
export interface DeletionPreview {
  calculations: number;
  disposals: number;
  links: number;
  lots: number;
  rawData: number;
  sessions: number;
  transfers: number;
  transactions: number;
}

/**
 * Account resolution result - stores account ID and source ID for deletion
 */
export interface ResolvedAccount {
  account: Account;
  sourceName: string;
}

/**
 * Determine which accounts should be cleared based on params.
 * Pure function - no database access.
 */
export function resolveAccountsForClear(
  params: ClearServiceParams,
  accountById: Account | undefined,
  accountsBySource: Account[]
): ResolvedAccount[] {
  if (params.accountId && accountById) {
    return [{ account: accountById, sourceName: accountById.sourceName }];
  }

  if (params.source && accountsBySource.length > 0) {
    return accountsBySource.map((account) => ({ account, sourceName: account.sourceName }));
  }

  return [];
}

/**
 * Calculate total items to be deleted.
 * Pure function.
 */
export function calculateTotalDeletionItems(preview: DeletionPreview): number {
  return (
    preview.sessions +
    preview.rawData +
    preview.transactions +
    preview.links +
    preview.lots +
    preview.disposals +
    preview.transfers +
    preview.calculations
  );
}

/**
 * Extract account IDs from resolved accounts.
 * Pure function.
 */
export function extractAccountIds(accounts: ResolvedAccount[]): number[] {
  return accounts.map((a) => a.account.id);
}

/**
 * Validate clear params.
 * Pure function.
 */
export function validateClearParams(params: ClearServiceParams): { error?: string; valid: boolean } {
  if (params.accountId && params.source) {
    return { valid: false, error: 'Cannot specify both accountId and source' };
  }

  if (params.accountId && params.accountId <= 0) {
    return { valid: false, error: 'accountId must be positive' };
  }

  return { valid: true };
}
