/**
 * Input DTO for creating external transaction records
 * Used by importers before persistence
 */
export interface RawTransactionWithMetadata {
  providerId: string;
  sourceAddress?: string | undefined;
  transactionType?: string | undefined;
  externalId?: string | undefined;
  cursor?: Record<string, unknown> | undefined;
  rawData: unknown;
  normalizedData: unknown;
}
