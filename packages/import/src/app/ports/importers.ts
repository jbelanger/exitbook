import type { Result } from 'neverthrow';

/**
 * Authentication configuration for Coinbase API
 */
export interface ExchangeCredentials {
  /** API key */
  apiKey: string;
  /** Passphrase associated with API key (not required for CDP keys) */
  passphrase?: string | undefined;
  /** Whether to use sandbox environment */
  sandbox?: boolean | undefined;
  /** API secret for signing requests */
  secret: string;
}

export interface ImportParams {
  address?: string | undefined;
  csvDirectories?: string[] | undefined;
  exchangeCredentials?: Partial<ExchangeCredentials> | undefined;
  providerId?: string | undefined;
  since?: number | undefined;
}

export interface ImportResult {
  imported: number;
  importSessionId: number;
  metadata?: unknown;
  providerId?: string | undefined;
}

export interface ImportRunResult {
  metadata?: Record<string, unknown> | undefined;
  rawData: ApiClientRawData[];
}

export interface ApiClientRawData {
  metadata: {
    providerId: string;
    sourceAddress?: string | undefined;
    transactionType?: string | undefined;
  };
  rawData: unknown;
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
