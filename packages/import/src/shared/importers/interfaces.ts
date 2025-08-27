import type { ApiClientRawData } from '../processors/interfaces.ts';

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

export interface ImportRunResult<TRawData> {
  metadata?: Record<string, unknown> | undefined;
  rawData: ApiClientRawData<TRawData>[];
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
   * Validate that the source is accessible and parameters are correct.
   */
  canImport(params: ImportParams): Promise<boolean>;

  /**
   * Import raw data from the source and return it with API client provenance and metadata.
   * Does NOT save to database - that's handled by the ingestion service.
   */
  import(params: ImportParams): Promise<ImportRunResult<TRawData>>;
}
