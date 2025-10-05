import type { RawTransactionWithMetadata } from '@exitbook/data';
import type { ExchangeCredentials } from '@exitbook/exchanges';
import type { Result } from 'neverthrow';

export interface ImportParams {
  address?: string | undefined;
  credentials?: ExchangeCredentials | undefined;
  csvDirectories?: string[] | undefined;
  cursor?: Record<string, number> | undefined;
  providerId?: string | undefined;
}

/**
 * Extended params for blockchain imports that still use since/until.
 * TODO: Refactor blockchain importers to use cursor-based pagination.
 */
export interface BlockchainImportParams extends ImportParams {
  since?: number | undefined;
  until?: number | undefined;
}

export interface ImportResult {
  imported: number;
  importSessionId: number;
  metadata?: Record<string, unknown> | undefined;
}

export interface ImportRunResult {
  // Successfully fetched and validated transactions
  rawTransactions: RawTransactionWithMetadata[];
  // Metadata about the import run (e.g., total fetched, date ranges)
  metadata?: Record<string, unknown> | undefined;
}
/**
 * Interface for importing raw data from external sources.
 * Each importer is responsible for fetching data from a specific source
 * (exchange API, blockchain API, CSV files, etc.) and storing it as raw JSON.
 */
export interface IImporter {
  /**
   * Import raw data from the source and return it with API client provenance and metadata.
   * Does NOT save to database - that's handled by the ingestion service.
   * Returns Result to make error handling explicit.
   */
  import(params: ImportParams): Promise<Result<ImportRunResult, Error>>;
}
