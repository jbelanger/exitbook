import type { ProcessedTransaction } from '@crypto/core';

/**
 * Command: Classify Transaction Movements by Purpose
 */
export interface ClassifyMovementsCommand {
  readonly requestId: string; // For idempotency (enforced by infra layer)
  readonly rulesetVersion?: string; // Optional: specify classifier version
  readonly transaction: ProcessedTransaction;
}
