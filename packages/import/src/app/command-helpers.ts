import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

/**
 * Shared command validation helpers and error factories - Pure FP style
 */

/**
 * Pure Error Objects (no classes)
 */
export interface ProcessingError {
  readonly additionalContext?: Record<string, unknown>;
  readonly code: 'PROCESSING_ERROR';
  readonly message: string;
  readonly requestId?: string | undefined;
  readonly severity: 'error';
  readonly timestamp: string;
  readonly transactionId?: string | undefined;
  readonly type: 'ProcessingError';
}

export interface ValidationFailedError {
  readonly code: 'VALIDATION_FAILED';
  readonly message: string;
  readonly requestId?: string | undefined;
  readonly severity: 'error';
  readonly timestamp: string;
  readonly transactionId?: string | undefined;
  readonly type: 'ValidationFailedError';
  readonly violations: {
    readonly message: string;
    readonly rule: string;
    readonly violations?: string[] | undefined;
  }[];
}

export interface ClassificationError {
  readonly code: 'CLASSIFICATION_ERROR';
  readonly failedMovements: string[];
  readonly message: string;
  readonly requestId?: string | undefined;
  readonly severity: 'error';
  readonly timestamp: string;
  readonly transactionId?: string | undefined;
  readonly type: 'ClassificationError';
}

/**
 * Error Factory Functions (Pure)
 */
export function createProcessingError(
  message: string,
  context?: {
    additionalContext?: Record<string, unknown> | undefined;
    requestId?: string | undefined;
    transactionId?: string | undefined;
  }
): ProcessingError {
  return {
    code: 'PROCESSING_ERROR',
    message,
    severity: 'error',
    timestamp: new Date().toISOString(),
    type: 'ProcessingError',
    ...(context?.requestId && { requestId: context.requestId }),
    ...(context?.transactionId && { transactionId: context.transactionId }),
    ...(context?.additionalContext && { additionalContext: context.additionalContext }),
  };
}

export function createValidationFailedError(
  violations: {
    message: string;
    rule: string;
    violations?: string[] | undefined;
  }[],
  context?: {
    additionalContext?: Record<string, unknown> | undefined;
    requestId?: string | undefined;
    transactionId?: string | undefined;
  }
): ValidationFailedError {
  const message = `Validation failed: ${violations.map((v) => v.message).join('; ')}`;

  return {
    code: 'VALIDATION_FAILED',
    message,
    severity: 'error',
    timestamp: new Date().toISOString(),
    type: 'ValidationFailedError',
    violations,
    ...(context?.requestId && { requestId: context.requestId }),
    ...(context?.transactionId && { transactionId: context.transactionId }),
  };
}

export function createClassificationError(
  message: string,
  failedMovements: string[],
  context?: {
    additionalContext?: Record<string, unknown> | undefined;
    requestId?: string | undefined;
    transactionId?: string | undefined;
  }
): ClassificationError {
  return {
    code: 'CLASSIFICATION_ERROR',
    failedMovements,
    message,
    severity: 'error',
    timestamp: new Date().toISOString(),
    type: 'ClassificationError',
    ...(context?.requestId && { requestId: context.requestId }),
    ...(context?.transactionId && { transactionId: context.transactionId }),
  };
}

/**
 * Validation Helpers
 */

/**
 * Validate that requestId is a non-empty string
 */
export function validateRequestId<TError>(
  requestId: string,
  createError: (
    message: string,
    context?: {
      additionalContext?: Record<string, unknown> | undefined;
      requestId?: string | undefined;
      transactionId?: string | undefined;
    }
  ) => TError
): Result<void, TError> {
  if (!requestId?.trim()) {
    return err(createError('RequestId must be non-empty string', { requestId }));
  }
  return ok();
}
