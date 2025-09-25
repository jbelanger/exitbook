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

export interface ImportRunResult<TRawData> {
  metadata?: Record<string, unknown> | undefined;
  rawData: ApiClientRawData<TRawData>[];
}

export interface ApiClientRawData<TRawData> {
  providerId: string;
  rawData: TRawData;
  sourceAddress?: string | undefined; // Optional address context for the data
  transactionType?: string | undefined; // Optional transaction type for classification
}

/**
 * Interface for importing raw data from external sources.
 * Each importer is responsible for fetching data from a specific source
 * (exchange API, blockchain API, CSV files, etc.) and storing it as raw JSON.
 */
export interface IImporter<TRawData> {
  /**
   * Validate that the source is accessible and parameters are correct.
   */
  canImport(params: ImportParams): Promise<boolean>;

  /**
   * Import raw data from the source and return it with API client provenance and metadata.
   * Does NOT save to database - that's handled by the ingestion service.
   */
  import(params: ImportParams): Promise<ImportRunResult<TRawData>>;
}
