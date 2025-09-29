import type { StoredRawData } from '@crypto/data';

export interface LoadRawDataFilters {
  importSessionId?: number | undefined;
  processingStatus?: 'pending' | 'processed' | 'failed' | undefined;
  providerId?: string | undefined;
  since?: number | undefined;
  sourceId?: string | undefined;
}

/**
 * Interface for storing and retrieving external data.
 * Abstracts the database operations for external transaction storage.
 */
export interface IRawDataRepository {
  /**
   * Load external data from storage with optional filtering.
   */
  load(filters?: LoadRawDataFilters): Promise<StoredRawData[]>;

  /**
   * Mark multiple items as processed.
   */
  markAsProcessed(sourceId: string, sourceTransactionIds: number[], providerId?: string): Promise<void>;

  /**
   * Save external data items to storage.
   */
  save(
    sourceId: string,
    sourceType: string,
    rawData: unknown,
    importSessionId: number,
    providerId: string,
    metadata?: unknown
  ): Promise<number>;

  /**
   * Update the processing status of external data items.
   */
  updateProcessingStatus(
    rawTransactionId: number,
    status: 'pending' | 'processed' | 'failed',
    error?: string,
    providerId?: string
  ): Promise<void>;
}
