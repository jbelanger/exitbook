import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';
import type { z } from 'zod';

function isDecimalLike(value: unknown): value is { toFixed: () => string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'd' in value &&
    'e' in value &&
    's' in value &&
    'toFixed' in value &&
    typeof value.toFixed === 'function'
  );
}

export function serializeToJson(data: unknown): Result<string | undefined, Error> {
  if (data === undefined || data === null) {
    return ok(undefined);
  }

  try {
    const serialized = JSON.stringify(
      data,
      function replacer(this: Record<string, unknown>, key: string, value: unknown) {
        const holderValue = this[key];

        if (holderValue instanceof Decimal || isDecimalLike(holderValue)) return holderValue.toFixed();
        if (value instanceof Decimal || isDecimalLike(value)) return value.toFixed();

        return value;
      }
    );
    return ok(serialized);
  } catch (error) {
    return wrapError(error, 'Failed to serialize JSON');
  }
}

function isMissingJsonValue(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

export function parseWithSchema<T>(value: unknown, schema: z.ZodType<T>): Result<T | undefined, Error> {
  if (isMissingJsonValue(value)) {
    return ok(undefined);
  }

  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    const result = schema.safeParse(parsed);

    if (!result.success) {
      return err(new Error(`Schema validation failed: ${result.error.message}`));
    }

    return ok(result.data);
  } catch (error) {
    return wrapError(error, 'Failed to parse JSON');
  }
}

export function parseJson(value: unknown): Result<unknown, Error> {
  if (isMissingJsonValue(value)) {
    return ok(undefined);
  }

  try {
    const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
    return ok(parsed);
  } catch (error) {
    return wrapError(error, 'Failed to parse JSON');
  }
}
