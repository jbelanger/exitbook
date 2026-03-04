import type { Account } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

export interface ClearParams {
  accountId?: number | undefined;
  source?: string | undefined;
  includeRaw: boolean;
}

export interface DeletionPreview {
  accounts: number;
  links: number;
  rawData: number;
  sessions: number;
  transactions: number;
}

export interface ClearResult {
  deleted: DeletionPreview;
}

export interface ResolvedAccount {
  account: Account;
  sourceName: string;
}

/**
 * Determine which accounts should be cleared based on params.
 * Pure function — no database access.
 */
export function resolveAccountsForClear(
  params: ClearParams,
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
 */
export function calculateTotalDeletionItems(preview: DeletionPreview): number {
  return preview.accounts + preview.sessions + preview.rawData + preview.transactions + preview.links;
}

/**
 * Extract account IDs from resolved accounts.
 */
export function extractAccountIds(accounts: ResolvedAccount[]): number[] {
  return accounts.map((a) => a.account.id);
}

/**
 * Validate clear params.
 */
export function validateClearParams(params: ClearParams): Result<void, Error> {
  if (params.accountId && params.source) {
    return err(new Error('Cannot specify both accountId and source'));
  }

  if (params.accountId && params.accountId <= 0) {
    return err(new Error('accountId must be positive'));
  }

  return ok(undefined);
}

/**
 * Build a human-readable filter description for error messages.
 */
export function describeFilters(params: ClearParams): string {
  const parts: string[] = [];
  if (params.accountId !== undefined) parts.push(`accountId=${params.accountId}`);
  if (params.source !== undefined) parts.push(`source=${params.source}`);
  return parts.join(', ');
}
