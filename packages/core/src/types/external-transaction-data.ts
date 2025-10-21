import type { RawTransactionWithMetadata } from '../index.ts';

/**
 * Domain model for external transaction data
 * Represents raw and normalized transaction data from external sources
 * Extends RawTransactionWithMetadata with persistence fields
 */
export interface ExternalTransactionData extends RawTransactionWithMetadata {
  id: number;
  dataSourceId: number;
  processingStatus: 'pending' | 'processed' | 'failed' | 'skipped';
  processedAt?: Date | undefined;
  processingError?: string | undefined;
  createdAt: Date;
}
