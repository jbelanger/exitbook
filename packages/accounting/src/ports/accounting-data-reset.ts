import type { Result } from '@exitbook/core';

export interface AccountingResetImpact {
  links: number;
  consolidatedMovements: number;
}

/**
 * Port for clearing accounting-owned derived data.
 *
 * Owns: transaction_links, utxo_consolidated_movements, and (future) cost-basis tables.
 */
export interface IAccountingDataReset {
  countResetImpact(accountIds?: number[]): Promise<Result<AccountingResetImpact, Error>>;
  resetDerivedData(accountIds?: number[]): Promise<Result<AccountingResetImpact, Error>>;
}
