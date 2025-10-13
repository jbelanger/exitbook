export interface RawTransactionWithMetadata {
  metadata: RawTransactionMetadata;
  rawData: unknown;
  // New fields for exchange validation and auto-incremental imports
  externalId?: string | undefined; // Unique transaction ID from source
  cursor?: Record<string, number> | undefined; // Cursor for resuming imports (e.g., { trade: 1704067200000 })
  normalizedData?: unknown; // Standardized transaction data after validation and mapping - Required for exchange
}

export interface RawTransactionMetadata {
  providerId: string;
  sourceAddress?: string | undefined;
  transactionType?: string | undefined;
}
