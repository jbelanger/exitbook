import type { DomainEvent } from '@crypto/core';

import type { ValidationResult } from '../value-objects/validation-result.ts';

/**
 * Domain Events for Transaction Validation
 */

export interface TransactionValidatedEvent extends DomainEvent {
  readonly type: 'TransactionValidated';
  readonly validationResults: ValidationResult[];
}

export interface ValidationFailedEvent extends DomainEvent {
  readonly failedRules: string[];
  readonly type: 'ValidationFailed';
  readonly violations: string[];
}
