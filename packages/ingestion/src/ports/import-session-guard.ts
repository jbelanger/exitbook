import type { Result } from '@exitbook/core';

export interface ImportSessionStatus {
  accountId: number;
  status: string;
}

/**
 * Port for querying import session state before processing.
 * The service applies domain rules (e.g. "status must be completed") — this port only provides data.
 */
export interface IImportSessionLookup {
  /**
   * Return the latest import session status for each of the given accounts.
   * Accounts with no sessions are omitted from the result.
   */
  findLatestSessionPerAccount(accountIds: number[]): Promise<Result<ImportSessionStatus[], Error>>;
}
