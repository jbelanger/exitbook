/**
 * Domain model for external transaction data
 * Represents raw and normalized transaction data from external sources
 */
export interface ExternalTransactionData {
  id: number;
  dataSourceId: number;
  providerId?: string | undefined;
  externalId?: string | undefined;
  cursor?: Record<string, unknown> | undefined;
  rawData: unknown;
  normalizedData: unknown;
  processingStatus: 'pending' | 'processed' | 'failed' | 'skipped';
  processedAt?: Date | undefined;
  processingError?: string | undefined;
  metadata?: unknown;
  createdAt: Date;
}
