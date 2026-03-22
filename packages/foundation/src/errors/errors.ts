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

/**
 * Type guard for checking if an object has a string property.
 */
export function hasStringProperty<T extends string>(obj: unknown, prop: T): obj is Record<T, string> {
  return hasPropertyOfType(obj, prop, (value): value is string => typeof value === 'string');
}

function hasPropertyOfType<T extends string, V>(
  obj: unknown,
  prop: T,
  typeCheck: (value: unknown) => value is V
): obj is Record<T, V> {
  return hasProperty(obj, prop) && typeCheck(obj[prop]);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasProperty<T extends string>(obj: unknown, prop: T): obj is Record<T, unknown> {
  return isObject(obj) && prop in obj;
}
