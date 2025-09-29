import type { SourceDetails } from '@crypto/core';

/**
 * Command: Process Raw Transaction Data into ProcessedTransaction
 */
export interface ProcessTransactionCommand {
  readonly importSessionId: string;
  readonly rawData: unknown;
  readonly requestId: string; // For idempotency (enforced by infra layer)
  readonly source: SourceDetails;
}
