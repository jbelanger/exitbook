/**
 * Comprehensive type guard utilities for safe type checking and property access
 * Centralizes type safety patterns found throughout the codebase
 */

/**
 * Type guard for checking if a value is an Error instance with a message
 */
export function isErrorWithMessage(error: unknown): error is Error & { message: string } {
  return error instanceof Error && typeof error.message === 'string';
}

/**
 * Type guard for checking if an object has a property with a specific type
 */
export function hasPropertyOfType<T extends string, V>(
  obj: unknown,
  prop: T,
  typeCheck: (value: unknown) => value is V
): obj is Record<T, V> {
  return hasProperty(obj, prop) && typeCheck(obj[prop]);
}

/**
 * Type guard for checking if an object has a string property
 */
export function hasStringProperty<T extends string>(obj: unknown, prop: T): obj is Record<T, string> {
  return hasPropertyOfType(obj, prop, (value): value is string => typeof value === 'string');
}

/**
 * Type guard for checking if a value is an object (not null, not array)
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Type guard for checking if an object has a specific property
 */
function hasProperty<T extends string>(obj: unknown, prop: T): obj is Record<T, unknown> {
  return isObject(obj) && prop in obj;
}
