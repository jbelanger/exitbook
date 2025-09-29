/**
 * Base Domain Error for standardized error handling across CQRS operations
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly severity: 'error' | 'warning';

  readonly timestamp: string;
  readonly requestId?: string;
  readonly transactionId?: string;
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    context?: {
      requestId?: string;
      transactionId?: string;
      additionalContext?: Record<string, unknown>;
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
      name: this.name,
      code: this.code,
      severity: this.severity,
      message: this.message,
      timestamp: this.timestamp,
      requestId: this.requestId,
      transactionId: this.transactionId,
      context: this.context,
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
    public readonly violations: Array<{
      rule: string;
      message: string;
      violations?: string[];
    }>,
    context?: {
      requestId?: string;
      transactionId?: string;
    }
  ) {
    const message = `Validation failed: ${violations.map((v) => v.message).join('; ')}`;
    super(message, context);
  }
}
