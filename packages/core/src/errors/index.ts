/**
 * Error Types Hierarchy for ProcessedTransaction + Purpose Classifier
 *
 * Provides structured error handling with specific error codes and context
 * for debugging and error recovery strategies.
 */

/**
 * Base domain error for transaction processing
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly severity: 'error' | 'warning';

  readonly timestamp: string;
  readonly requestId?: string | undefined;
  readonly transactionId?: string | undefined;
  readonly context?: Record<string, unknown> | undefined;

  constructor(
    message: string,
    context?: {
      additionalContext?: Record<string, unknown> | undefined;
      requestId?: string | undefined;
      transactionId?: string | undefined;
    }
  ) {
    super(message);
    this.timestamp = new Date().toISOString();
    this.requestId = context?.requestId;
    this.transactionId = context?.transactionId;
    this.context = context?.additionalContext;
    this.name = this.constructor.name;
  }

  toJSON() {
    return {
      code: this.code,
      context: this.context,
      message: this.message,
      name: this.name,
      requestId: this.requestId,
      severity: this.severity,
      timestamp: this.timestamp,
      transactionId: this.transactionId,
    };
  }
}

/**
 * Processing-related errors
 */
export class ProcessingError extends DomainError {
  readonly code = 'PROCESSING_ERROR';
  readonly severity = 'error' as const;
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';
  readonly severity = 'error' as const;
}

/**
 * Classification-related errors
 */
export class ClassificationError extends DomainError {
  readonly code = 'CLASSIFICATION_ERROR';
  readonly severity = 'error' as const;

  constructor(
    message: string,
    public readonly failedMovements: string[],
    context?: {
      additionalContext?: Record<string, unknown>;
      requestId?: string;
      transactionId?: string;
    }
  ) {
    super(message, context);
  }
}

/**
 * Repository-related errors
 */
export class RepositoryError extends DomainError {
  readonly severity = 'error' as const;

  constructor(
    public readonly code: 'NOT_FOUND' | 'VALIDATION_FAILED' | 'CONSTRAINT_VIOLATION',
    message: string,
    context?: {
      additionalContext?: Record<string, unknown>;
      requestId?: string;
      transactionId?: string;
    }
  ) {
    super(message, context);
  }
}

/**
 * Validation failure error with detailed violation information
 */
export class ValidationFailedError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  readonly severity = 'error' as const;

  constructor(
    public readonly violations: {
      message: string;
      rule: string;
      violations?: string[] | undefined;
    }[],
    context?: {
      additionalContext?: Record<string, unknown> | undefined;
      requestId?: string | undefined;
      transactionId?: string | undefined;
    }
  ) {
    const message = `Validation failed: ${violations.map((v) => v.message).join('; ')}`;
    super(message, context);
  }
}

/**
 * Conversion errors for legacy bridges
 */
export class ConversionError extends DomainError {
  readonly code = 'CONVERSION_ERROR';
  readonly severity = 'error' as const;

  constructor(
    message: string,
    public readonly sourceData?: unknown,
    context?: {
      additionalContext?: Record<string, unknown>;
      requestId?: string;
      transactionId?: string;
    }
  ) {
    super(message, context);
  }
}
