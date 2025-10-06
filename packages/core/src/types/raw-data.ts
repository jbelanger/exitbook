export interface RawTransactionWithMetadata {
  metadata: RawTransactionMetadata;
  rawData: unknown;
  // New fields for exchange validation and auto-incremental imports
  externalId?: string | undefined; // Unique transaction ID from source
  cursor?: Record<string, number> | undefined; // Cursor for resuming imports (e.g., { trade: 1704067200000 })
  parsedData?: unknown; // Validated data (only set if validation passed)
}

export interface RawTransactionMetadata {
  providerId: string;
  sourceAddress?: string | undefined;
  transactionType?: string | undefined;
}
