import type { TransactionValidatedEvent, ValidationFailedEvent } from '../../../domain/events/validation-events.ts';
import type { ValidationResult } from '../../../domain/value-objects/validation-result.ts';

import type { ValidateTransactionCommand } from './validate-transaction.command.ts';

/**
 * Create TransactionValidatedEvent
 */
export function createTransactionValidatedEvent(
  command: ValidateTransactionCommand,
  results: ValidationResult[]
): TransactionValidatedEvent {
  return {
    requestId: command.requestId,
    timestamp: new Date().toISOString(),
    transactionId: command.transaction.id,
    type: 'TransactionValidated',
    validationResults: results,
  };
}

/**
 * Create ValidationFailedEvent
 */
export function createValidationFailedEvent(
  command: ValidateTransactionCommand,
  failedRules: ValidationResult[]
): ValidationFailedEvent {
  return {
    failedRules: failedRules.map((r) => r.rule),
    requestId: command.requestId,
    timestamp: new Date().toISOString(),
    transactionId: command.transaction.id,
    type: 'ValidationFailed',
    violations: failedRules.flatMap((r) => r.violations || []),
  };
}
