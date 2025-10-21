/**
 * Input DTO for creating external transaction records
 * Used by importers before persistence
 * Write-side
 */
export interface ExternalTransaction {
  providerId: string;
  sourceAddress?: string | undefined;
  transactionTypeHint?: string | undefined;
  externalId?: string | undefined;
  cursor?: Record<string, unknown> | undefined;
  rawData: unknown;
  normalizedData: unknown;
}

/**
 * Represents raw and normalized transaction data from external sources after saving
 * Read-side
 */
export interface ExternalTransactionData extends ExternalTransaction {
  id: number;
  dataSourceId: number;
  processingStatus: 'pending' | 'processed' | 'failed' | 'skipped';
  processedAt?: Date | undefined;
  processingError?: string | undefined;
  createdAt: Date;
}
