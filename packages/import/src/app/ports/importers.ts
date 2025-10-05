import type { RawTransactionWithMetadata } from '@exitbook/data';
import type { ExchangeCredentials } from '@exitbook/exchanges';
import type { Result } from 'neverthrow';

export interface ImportParams {
  address?: string | undefined;
  credentials?: ExchangeCredentials | undefined;
  csvDirectories?: string[] | undefined;
  providerId?: string | undefined;
  since?: number | undefined;
  until?: number | undefined;
}

export interface ImportResult {
  imported: number;
  importSessionId: number;
  metadata?: Record<string, unknown> | undefined;
}

export interface ImportRunResult {
  metadata?: Record<string, unknown> | undefined;
  rawTransactions: RawTransactionWithMetadata[];
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
