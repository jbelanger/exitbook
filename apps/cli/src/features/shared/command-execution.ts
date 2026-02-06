import type { Result } from 'neverthrow';

/**
 * Command handler interface.
 */
export interface CommandHandler<TParams, TResult> {
  execute(params: TParams): Promise<Result<TResult, Error>>;
  destroy?(): void;
}

/**
 * Convert Result to value or throw error.
 */
export function unwrapResult<T>(result: Result<T, Error>): T {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}
