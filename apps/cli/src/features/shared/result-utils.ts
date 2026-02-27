import type { Result } from 'neverthrow';

/**
 * Convert Result to value or throw error.
 */
export function unwrapResult<T>(result: Result<T, Error>): T {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}
