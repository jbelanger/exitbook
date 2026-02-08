import type { ExitCode } from './exit-codes.js';

/**
 * Standardized CLI response format.
 * Used for both JSON output and internal tracking.
 */
export interface CLIResponse<T = unknown> {
  /** Whether the command executed successfully */
  success: boolean;

  /** Command that was executed */
  command: string;

  /** ISO 8601 timestamp of when the response was generated */
  timestamp: string;

  /** Response data (only present on success) */
  data?: T;

  /** Error information (only present on failure) */
  error?:
    | {
        /** Machine-readable error code */
        code: string;

        /** Additional error details (optional) */
        details?: unknown;

        /** Human-readable error message */
        message: string;

        /** Stack trace (only in development/verbose mode) */
        stack?: string | undefined;
      }
    | undefined;

  /** Additional metadata about the execution */
  metadata?:
    | {
        /** Additional context */
        [key: string]: unknown;

        /** Command execution duration in milliseconds */
        duration_ms?: number | undefined;

        /** CLI version */
        version?: string | undefined;
      }
    | undefined;
}

export function createSuccessResponse<T>(command: string, data: T, metadata?: Record<string, unknown>): CLIResponse<T> {
  const response: CLIResponse<T> = {
    success: true,
    command,
    timestamp: new Date().toISOString(),
    data,
  };

  if (metadata) {
    response.metadata = metadata as {
      [key: string]: unknown;
      duration_ms?: number | undefined;
      version?: string | undefined;
    };
  }

  return response;
}

export function createErrorResponse(
  command: string,
  error: Error,
  code: string,
  details?: unknown
): CLIResponse<never> {
  const errorObj: { code: string; details?: unknown; message: string; stack?: string | undefined } = {
    code,
    message: error.message,
  };

  if (details !== undefined) {
    errorObj.details = details;
  }

  if (process.env['NODE_ENV'] === 'development' && error.stack) {
    errorObj.stack = error.stack;
  }

  return {
    success: false,
    command,
    timestamp: new Date().toISOString(),
    error: errorObj,
  };
}

/**
 * Map exit code to error code string.
 */
export function exitCodeToErrorCode(exitCode: ExitCode): string {
  const codes: Record<number, string> = {
    1: 'GENERAL_ERROR',
    2: 'INVALID_ARGS',
    3: 'AUTHENTICATION_ERROR',
    4: 'NOT_FOUND',
    5: 'RATE_LIMIT',
    6: 'NETWORK_ERROR',
    7: 'DATABASE_ERROR',
    8: 'VALIDATION_ERROR',
    9: 'CANCELLED',
    10: 'TIMEOUT',
    11: 'CONFIG_ERROR',
    13: 'PERMISSION_DENIED',
  };
  return codes[exitCode] ?? 'UNKNOWN_ERROR';
}
