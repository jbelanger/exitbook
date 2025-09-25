import { Result } from 'neverthrow';
import { ClassifiedTransaction, ValidationFailedError } from '@crypto/core';
import { BaseEventMetadata } from './EventMetadata';

/**
 * Command: Validate Classified Transaction Balance Rules
 *
 * Purpose: Apply financial validation rules to classified movements to ensure
 * transaction integrity before storage.
 */
export interface ValidateTransactionCommand {
  readonly transaction: ClassifiedTransaction;
  readonly requestId: string; // For idempotency (enforced by infra layer)
}

/**
 * Validation result for individual rules
 */
export interface ValidationResult {
  readonly isValid: boolean;
  readonly rule: string;
  readonly message: string;
  readonly violations?: string[];
}

/**
 * Command Handler Interface
 */
export interface ValidateTransactionCommandHandler {
  /**
   * Execute transaction validation
   *
   * Input Parameters:
   * - command: ValidateTransactionCommand with ClassifiedTransaction
   *
   * Validation Rules:
   * - Transaction must have classified movements
   * - All movements must have valid purpose assignments
   * - RequestId must be unique
   *
   * Business Rules:
   * - FEES_AND_GAS_OUT: All FEE and GAS movements must be direction 'OUT'
   * - TRADE_PRINCIPALS_BALANCE: For trades, PRINCIPAL movements must balance by currency
   * - TRANSFER_BALANCE: For transfers, PRINCIPAL movements must net to zero in transferred currency
   * - Mathematical precision must be maintained (Decimal.js calculations)
   * - Failed validation rejects entire transaction (no partial success)
   *
   * Events Produced:
   * - TransactionValidatedEvent: On successful validation
   * - ValidationFailedEvent: On any validation rule failure
   */
  execute(command: ValidateTransactionCommand): Promise<Result<ValidationResult[], ValidationFailedError>>;
}

/**
 * Events produced by command execution
 */
export interface TransactionValidatedEvent extends BaseEventMetadata {
  readonly type: 'TransactionValidated';
  readonly validationResults: ValidationResult[];
}

export interface ValidationFailedEvent extends BaseEventMetadata {
  readonly type: 'ValidationFailed';
  readonly failedRules: string[];
  readonly violations: string[];
}
