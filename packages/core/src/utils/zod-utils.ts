import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import type { ZodSchema, ZodError } from 'zod';

/**
 * Validates an input against a Zod schema and returns a neverthrow Result.
 *
 * @param schema The Zod schema to validate against.
 * @param input The unknown input to validate.
 * @returns An Ok(T) with the parsed data if successful, otherwise an Err(ZodError).
 */
export function fromZod<T>(schema: ZodSchema<T>, input: unknown): Result<T, ZodError> {
  const parsed = schema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err(parsed.error);
}
