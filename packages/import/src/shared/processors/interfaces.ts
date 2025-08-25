import type { UniversalTransaction } from '@crypto/core';

export interface StoredRawData<TRawData = unknown> {
  adapterId: string;
  adapterType: string;
  createdAt: number;
  id: string;
  importSessionId?: string | undefined;
  metadata?: unknown;
  processedAt?: number | undefined;
  processingError?: string | undefined;
  processingStatus: string;
  providerId?: string | undefined;
  rawData: TRawData;
  sourceTransactionId: string;
}

export interface ProcessResult {
  errors: string[];
  failed: number;
  processed: number;
}

/**
 * Interface for processing raw data into UniversalTransaction format.
 * Each processor is responsible for converting source-specific raw data
 * into the standardized UniversalTransaction format.
 */
export interface IProcessor<TRawData> {
  /**
   * Check if this processor can handle data from the specified adapter.
   */
  canProcess(adapterId: string, adapterType: string): boolean;

  /**
   * Process raw data into UniversalTransaction objects.
   */
  process(rawData: StoredRawData<TRawData>[]): Promise<UniversalTransaction[]>;

  /**
   * Process a single raw data item (useful for testing and debugging).
   */
  processSingle(rawData: StoredRawData<TRawData>): Promise<UniversalTransaction | null>;
}
