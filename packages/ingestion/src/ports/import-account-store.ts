import type { AccountType, ExchangeCredentials } from '@exitbook/core';

/**
 * Parameters for finding or creating an account during import.
 * Owned by ingestion — the import workflow defines what it needs.
 */
export interface FindOrCreateAccountParams {
  userId: number | undefined;
  parentAccountId?: number | undefined;
  accountType: AccountType;
  sourceName: string;
  identifier: string;
  providerName?: string | undefined;
  credentials?: ExchangeCredentials | undefined;
}
