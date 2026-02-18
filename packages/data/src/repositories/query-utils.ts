import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';
import type { z } from 'zod';

/**
 * Serialize data to JSON, converting Decimal values to fixed-point strings.
 */
export function serializeToJson(data: unknown): Result<string | undefined, Error> {
  if (data === undefined || data === null) return ok(undefined);

  try {
    const serialized = JSON.stringify(data, (_key, value: unknown) => {
      if (value instanceof Decimal) {
        return value.toFixed();
      }
      // Duck-type fallback for Decimal from different module instances
      if (
        value &&
        typeof value === 'object' &&
        'd' in value &&
        'e' in value &&
        's' in value &&
        'toFixed' in value &&
        typeof value.toFixed === 'function'
      ) {
        return (value as { toFixed: () => string }).toFixed();
      }
      return value as string | number | boolean | null | object;
    });
    return ok(serialized);
  } catch (error) {
    return err(new Error(`Failed to serialize JSON: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Parse a JSON string and validate it against a Zod schema.
 */
export function parseWithSchema<T>(value: unknown, schema: z.ZodType<T>): Result<T | undefined, Error> {
  if (!value) return ok(undefined);

  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    const result = schema.safeParse(parsed);

    if (!result.success) {
      return err(new Error(`Schema validation failed: ${result.error.message}`));
    }

    return ok(result.data);
  } catch (error) {
    return err(new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Parse a JSON string without schema validation.
 */
export function parseJson<T = unknown>(value: unknown): Result<T | undefined, Error> {
  if (!value) return ok(undefined);

  try {
    const parsed = typeof value === 'string' ? (JSON.parse(value) as T) : (value as T);
    return ok(parsed);
  } catch (error) {
    return err(new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`));
  }
}
