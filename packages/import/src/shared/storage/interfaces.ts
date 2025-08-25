import type { StoredRawData } from '../processors/interfaces.ts';

export interface SaveRawDataOptions {
  importSessionId?: string | undefined;
  metadata?: unknown;
  providerId?: string | undefined;
}

export interface LoadRawDataFilters {
  adapterId?: string | undefined;
  importSessionId?: string | undefined;
  processingStatus?: 'pending' | 'processed' | 'failed' | undefined;
  providerId?: string | undefined;
  since?: number | undefined;
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
  markAsProcessed(adapterId: string, sourceTransactionIds: string[], providerId?: string): Promise<void>;

  /**
   * Save external data items to storage.
   */
  save(
    adapterId: string,
    adapterType: string,
    rawData: Array<{ data: unknown; id: string; }>,
    options?: SaveRawDataOptions
  ): Promise<number>;

  /**
   * Save a single external data item to storage.
   */
  saveSingle(
    adapterId: string,
    adapterType: string,
    sourceTransactionId: string,
    rawData: unknown,
    options?: SaveRawDataOptions
  ): Promise<void>;

  /**
   * Update the processing status of external data items.
   */
  updateProcessingStatus(
    adapterId: string,
    sourceTransactionId: string,
    status: 'pending' | 'processed' | 'failed',
    error?: string,
    providerId?: string
  ): Promise<void>;
}
