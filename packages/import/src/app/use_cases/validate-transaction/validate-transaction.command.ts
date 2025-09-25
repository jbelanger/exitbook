import type { ClassifiedTransaction } from '@crypto/core';

/**
 * Command: Validate Classified Transaction Balance Rules
 */
export interface ValidateTransactionCommand {
  readonly requestId: string; // For idempotency (enforced by infra layer)
  readonly transaction: ClassifiedTransaction;
}
