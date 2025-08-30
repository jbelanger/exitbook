import type { StoredRawData } from '@crypto/data';

export interface SaveRawDataOptions {
  importSessionId?: string | undefined;
  metadata?: unknown;
  providerId?: string | undefined;
}

export interface LoadRawDataFilters {
  importSessionId?: string | undefined;
  processingStatus?: 'pending' | 'processed' | 'failed' | undefined;
  providerId?: string | undefined;
  since?: number | undefined;
  sourceId?: string | undefined;
}

/**
 * Interface for storing and retrieving external data.
 * Abstracts the database operations for external transaction storage.
 */
export interface IExternalDataStore {
  /**
   * Load external data from storage with optional filtering.
   */
  load(filters?: LoadRawDataFilters): Promise<StoredRawData[]>;

  /**
   * Mark multiple items as processed.
   */
  markAsProcessed(sourceId: string, sourceTransactionIds: string[], providerId?: string): Promise<void>;

  /**
   * Save external data items to storage.
   */
  save(
    sourceId: string,
    sourceType: string,
    rawData: Array<{ data: unknown; id: string }>,
    options?: SaveRawDataOptions
  ): Promise<number>;

  /**
   * Save a single external data item to storage.
   */
  saveSingle(
    sourceId: string,
    sourceType: string,
    sourceTransactionId: string,
    rawData: unknown,
    options?: SaveRawDataOptions
  ): Promise<void>;

  /**
   * Update the processing status of external data items.
   */
  updateProcessingStatus(
    sourceId: string,
    sourceTransactionId: string,
    status: 'pending' | 'processed' | 'failed',
    error?: string,
    providerId?: string
  ): Promise<void>;
}
