/**
 * Comprehensive type guard utilities for safe type checking and property access
 * Centralizes type safety patterns found throughout the codebase
 */

/**
 * Type guard for checking if a value is an Error instance with a message
 */
export function isErrorWithMessage(
  error: unknown,
): error is Error & { message: string } {
  return error instanceof Error && typeof error.message === "string";
}

/**
 * Type guard for checking if a value is an Error instance with optional additional properties
 */
export function isErrorWithProperties<T extends Record<string, unknown>>(
  error: unknown,
  properties?: (keyof T)[],
): error is Error & T {
  if (!isErrorWithMessage(error)) return false;

  if (!properties || properties.length === 0) return true;

  return properties.every(
    (prop) => prop in error && error[prop as keyof typeof error] !== undefined,
  );
}

/**
 * Type guard for checking if a value is an object (not null, not array)
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Type guard for checking if an object has a specific property
 */
export function hasProperty<T extends string>(
  obj: unknown,
  prop: T,
): obj is Record<T, unknown> {
  return isObject(obj) && prop in obj;
}

/**
 * Type guard for checking if an object has multiple properties
 */
export function hasProperties<T extends string>(
  obj: unknown,
  props: readonly T[],
): obj is Record<T, unknown> {
  return isObject(obj) && props.every((prop) => prop in obj);
}

/**
 * Type guard for checking if an object has a property with a specific type
 */
export function hasPropertyOfType<T extends string, V>(
  obj: unknown,
  prop: T,
  typeCheck: (value: unknown) => value is V,
): obj is Record<T, V> {
  return hasProperty(obj, prop) && typeCheck(obj[prop]);
}

/**
 * Type guard for checking if an object has a string property
 */
export function hasStringProperty<T extends string>(
  obj: unknown,
  prop: T,
): obj is Record<T, string> {
  return hasPropertyOfType(
    obj,
    prop,
    (value): value is string => typeof value === "string",
  );
}

/**
 * Type guard for checking if an object has a number property
 */
export function hasNumberProperty<T extends string>(
  obj: unknown,
  prop: T,
): obj is Record<T, number> {
  return hasPropertyOfType(
    obj,
    prop,
    (value): value is number => typeof value === "number",
  );
}

/**
 * Type guard for checking if an object has an optional property
 */
export function hasOptionalProperty<T extends string>(
  obj: unknown,
  _prop: T,
): obj is Record<T, unknown> & Record<string, unknown> {
  return isObject(obj);
}

/**
 * Safe property accessor - returns the property value if it exists and matches the type, otherwise undefined
 */
export function getProperty<T>(
  obj: unknown,
  prop: string,
  typeCheck: (value: unknown) => value is T,
): T | undefined {
  if (!hasProperty(obj, prop)) return undefined;
  const value = obj[prop];
  return typeCheck(value) ? value : undefined;
}

/**
 * Safe string property accessor
 */
export function getStringProperty(
  obj: unknown,
  prop: string,
): string | undefined {
  return getProperty(
    obj,
    prop,
    (value): value is string => typeof value === "string",
  );
}

/**
 * Safe number property accessor
 */
export function getNumberProperty(
  obj: unknown,
  prop: string,
): number | undefined {
  return getProperty(
    obj,
    prop,
    (value): value is number => typeof value === "number",
  );
}

/**
 * Safe nested property accessor for common double-nested structures
 * Common pattern: obj.info.info.property
 */
export function getNestedProperty<T>(
  obj: unknown,
  path: string[],
  typeCheck: (value: unknown) => value is T,
): T | undefined {
  let current = obj;

  for (const segment of path) {
    if (!hasProperty(current, segment)) return undefined;
    current = current[segment];
  }

  return typeCheck(current) ? current : undefined;
}

/**
 * Type guard for CCXT-style info objects (common pattern in exchange adapters)
 */
export function isCcxtInfo(info: unknown): info is Record<string, unknown> & {
  info?: Record<string, unknown>;
} {
  return isObject(info);
}

/**
 * Safe CCXT double-nested info accessor
 * Handles the common pattern: transaction.info.info.property
 */
export function getCcxtNestedInfo(
  obj: unknown,
): Record<string, unknown> | undefined {
  if (!isObject(obj)) return undefined;
  if (!hasProperty(obj, "info")) return undefined;
  if (!isObject(obj.info)) return undefined;
  if (!hasProperty(obj.info, "info")) return undefined;
  if (!isObject(obj.info.info)) return undefined;

  return obj.info.info;
}

/**
 * Type guard for blockchain API responses with common structure
 */
export function isApiResponse<T>(
  response: unknown,
  dataProperty: string = "result",
): response is { status: string; [key: string]: unknown } & Record<
  typeof dataProperty,
  T
> {
  return (
    hasProperty(response, "status") &&
    hasStringProperty(response, "status") &&
    hasProperty(response, dataProperty)
  );
}

/**
 * Type guard for error objects with common error properties
 */
export function isExtendedError(error: unknown): error is Error & {
  code?: string | number;
  status?: string | number;
  retryAfter?: number;
} {
  return isErrorWithMessage(error);
}

/**
 * Safe error property extractor
 */
export function getErrorProperties(error: unknown): {
  message: string;
  code?: string | number;
  status?: string | number;
  retryAfter?: number;
} {
  if (!isErrorWithMessage(error)) {
    return { message: String(error) };
  }

  const result: ReturnType<typeof getErrorProperties> = {
    message: error.message,
  };

  // Safely extract additional properties if they exist
  if (hasProperty(error, "code")) {
    const code = error.code;
    if (typeof code === "string" || typeof code === "number") {
      result.code = code;
    }
  }

  if (hasProperty(error, "status")) {
    const status = error.status;
    if (typeof status === "string" || typeof status === "number") {
      result.status = status;
    }
  }

  if (hasProperty(error, "retryAfter")) {
    const retryAfter = error.retryAfter;
    if (typeof retryAfter === "number") {
      result.retryAfter = retryAfter;
    }
  }

  return result;
}

/**
 * Type predicate for non-null, non-undefined values
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Type guard for checking if a value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Type guard for checking if a value is a positive number
 */
export function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && value > 0 && !isNaN(value);
}

/**
 * Type guard for checking if a value is a valid timestamp (positive integer)
 */
export function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
