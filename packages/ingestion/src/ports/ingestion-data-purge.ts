import type { Result } from '@exitbook/foundation';

export interface IngestionPurgeImpact {
  accounts: number;
  sessions: number;
  rawData: number;
}

/**
 * Port for purging ingestion source data (raw imports, sessions, accounts).
 *
 * This is the destructive "full clear" — requires re-import from exchanges/blockchains.
 * Callers must ensure derived data (accounting + ingestion) is already cleared
 * before purging, otherwise FK constraints will fail.
 */
export interface IIngestionDataPurge {
  countPurgeImpact(accountIds?: number[]): Promise<Result<IngestionPurgeImpact, Error>>;
  purgeImportedData(accountIds?: number[]): Promise<Result<IngestionPurgeImpact, Error>>;
}
