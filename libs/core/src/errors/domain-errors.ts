/**
 * Base class for all domain errors in the ExitBook system.
 * All domain-specific errors should extend this class.
 *
 * This follows the explicit error handling strategy using neverthrow Result types.
 * Domain layer never throws exceptions - always returns Result<T, DomainError>.
 */
export abstract class DomainError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown> | undefined;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when attempting operations on invalid or non-existent entities
 */
export class EntityNotFoundError extends DomainError {
  constructor(entityType: string, identifier: string | number) {
    super(`${entityType} with identifier ${identifier} not found`, 'ENTITY_NOT_FOUND', { entityType, identifier });
  }
}

/**
 * Error thrown when business rule validation fails
 */
export class BusinessRuleViolationError extends DomainError {
  constructor(rule: string, details?: Record<string, unknown>) {
    super(`Business rule violation: ${rule}`, 'BUSINESS_RULE_VIOLATION', details);
  }
}

/**
 * Error thrown when domain invariants are violated
 */
export class InvariantViolationError extends DomainError {
  constructor(invariant: string, details?: Record<string, unknown>) {
    super(`Domain invariant violation: ${invariant}`, 'INVARIANT_VIOLATION', details);
  }
}

/**
 * Error thrown when validation fails during object creation or modification
 */
export class ValidationError extends DomainError {
  constructor(field: string, reason: string, value?: unknown) {
    super(`Validation failed for field '${field}': ${reason}`, 'VALIDATION_ERROR', { field, reason, value });
  }
}

/**
 * Error thrown when a required field is missing or empty
 */
export class RequiredFieldError extends ValidationError {
  public readonly code = 'FIELD_REQUIRED';

  constructor(field: string) {
    super(field, `${field} is required`);
  }
}

/**
 * Error thrown when a field has an invalid format
 */
export class InvalidFormatError extends ValidationError {
  public readonly code = 'INVALID_FORMAT';

  constructor(field: string, format: string, value?: unknown) {
    super(field, `must be a valid ${format}`, value);
  }
}

/**
 * Error thrown when operations fail due to invalid state
 */
export class InvalidStateError extends DomainError {
  constructor(currentState: string, operation: string) {
    super(`Cannot perform operation '${operation}' in current state '${currentState}'`, 'INVALID_STATE', {
      currentState,
      operation,
    });
  }
}
