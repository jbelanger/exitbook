import { Result } from 'neverthrow';
import { ProcessedTransaction } from '@crypto/core';
import { ProcessingError } from './DomainError';
import { BaseEventMetadata } from './EventMetadata';

/**
 * Command: Process Raw Transaction Data into ProcessedTransaction
 *
 * Purpose: Convert raw blockchain/exchange transaction data into structured
 * ProcessedTransaction with unclassified movements, ready for purpose classification.
 */
export interface ProcessTransactionCommand {
  readonly rawData: unknown;
  readonly source: {
    readonly kind: 'exchange' | 'blockchain';
    readonly venue?: string; // For exchanges: 'kraken'
    readonly chain?: string; // For blockchains: 'ethereum'
  };
  readonly importSessionId: string;
  readonly requestId: string; // For idempotency (enforced by infra layer)
}

/**
 * Command Handler Interface
 */
export interface ProcessTransactionCommandHandler {
  /**
   * Execute transaction processing
   *
   * Input Parameters:
   * - command: ProcessTransactionCommand with raw data and context
   *
   * Validation Rules:
   * - Raw data must pass provider-specific Zod schema validation
   * - Source must match supported venues ('kraken') or chains ('ethereum')
   * - ImportSessionId must be non-empty string
   * - RequestId must be unique within session
   *
   * Business Rules:
   * - Movements must balance correctly (total IN = total OUT for transfers)
   * - All amounts must be positive DecimalStrings with max 18 decimal places
   * - Each movement must have valid direction ('IN' | 'OUT')
   * - Processors MUST NOT set purpose except for indisputable GAS hints
   *
   * Events Produced:
   * - TransactionProcessedEvent: On successful processing
   * - TransactionRejectedEvent: On validation or business rule failure
   */
  execute(command: ProcessTransactionCommand): Promise<Result<ProcessedTransaction, ProcessingError>>;
}

/**
 * Events produced by command execution
 */
export interface TransactionProcessedEvent extends BaseEventMetadata {
  readonly type: 'TransactionProcessed';
  readonly movementCount: number;
  readonly source: ProcessTransactionCommand['source'];
  readonly importSessionId?: string;
}

export interface TransactionRejectedEvent extends BaseEventMetadata {
  readonly type: 'TransactionRejected';
  readonly reason: string;
  readonly source: ProcessTransactionCommand['source'];
  readonly importSessionId?: string;
}
