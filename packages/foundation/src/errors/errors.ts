import { err, type Result } from '../result/index.js';

/**
 * Type guard for checking if a value is an Error instance with a message.
 */
export function isErrorWithMessage(error: unknown): error is Error & { message: string } {
  return error instanceof Error && typeof error.message === 'string';
}

/**
 * Extract an error message from an unknown value.
 */
export function getErrorMessage(error: unknown, defaultMessage?: string): string {
  if (isErrorWithMessage(error)) {
    return error.message;
  }
  return defaultMessage || String(error);
}

/**
 * Wrap an unknown error with contextual information.
 */
export function wrapError<T = never>(error: unknown, context: string): Result<T, Error> {
  const cause = error instanceof Error ? error : new Error(getErrorMessage(error));
  return err(new Error(`${context}: ${cause.message}`, { cause }));
}
