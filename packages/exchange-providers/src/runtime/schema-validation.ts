// Pure schema validation helpers for exchange clients.

import { wrapError } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import { type ZodType } from 'zod';

/**
 * Validate credentials against a Zod schema
 */
export function validateCredentials<T>(schema: ZodType<T>, credentials: unknown, exchangeId: string): Result<T, Error> {
  const validationResult = schema.safeParse(credentials);
  if (!validationResult.success) {
    return err(new Error(`Invalid ${exchangeId} credentials: ${validationResult.error.message}`));
  }
  return ok(validationResult.data);
}

/**
 * Validate raw data against a Zod schema
 */
export function validateRawData<T>(schema: ZodType<T>, rawData: unknown, exchangeId: string): Result<T, Error> {
  try {
    const parsed = schema.parse(rawData);
    return ok(parsed);
  } catch (error) {
    return wrapError(error, `${exchangeId} data validation failed`);
  }
}
