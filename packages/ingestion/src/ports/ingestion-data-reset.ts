import type { Result } from '@exitbook/core';

export interface IngestionResetImpact {
  transactions: number;
}

/**
 * Port for clearing ingestion-owned derived data.
 *
 * Owns: transactions (processing output) and raw processing status reset.
 * Does NOT touch links or consolidated movements — those belong to accounting.
 * Does NOT touch raw data, sessions, or accounts — that's purge territory.
 */
export interface IIngestionDataReset {
  countResetImpact(accountIds?: number[]): Promise<Result<IngestionResetImpact, Error>>;
  resetDerivedData(accountIds?: number[]): Promise<Result<IngestionResetImpact, Error>>;
}
