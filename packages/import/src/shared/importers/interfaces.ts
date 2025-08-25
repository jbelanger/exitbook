export interface ImportParams {
  [key: string]: unknown;
  addresses?: string[] | undefined;
  csvDirectories?: string[] | undefined;
  importSessionId?: string | undefined;
  providerId?: string | undefined;
  since?: number | undefined;
  until?: number | undefined;
}

export interface ImportResult {
  imported: number;
  importSessionId: string;
  metadata?: unknown;
  providerId?: string | undefined;
}

export interface ValidationResult {
  errors: string[];
  isValid: boolean;
  warnings: string[];
}

/**
 * Interface for importing raw data from external sources.
 * Each importer is responsible for fetching data from a specific source
 * (exchange API, blockchain API, CSV files, etc.) and storing it as raw JSON.
 */
export interface IImporter<TRawData> {
  /**
   * Import raw data from the source and return it.
   * Does NOT save to database - that's handled by the ingestion service.
   */
  importFromSource(params: ImportParams): Promise<TRawData[]>;

  /**
   * Validate raw data format after extraction.
   */
  validateRawData(data: TRawData[]): ValidationResult;

  /**
   * Validate that the source is accessible and parameters are correct.
   */
  validateSource(params: ImportParams): Promise<boolean>;
}
