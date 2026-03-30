import type { Result } from '@exitbook/foundation';

/**
 * TODO(cli-rework): Legacy throw bridge kept for pre-boundary commands. Verify
 * whether this can be deleted once all callers migrate to `toCliResult(...)`
 * plus `resultDo(...)` / `resultDoAsync(...)`.
 * @deprecated Prefer preserving `Result` control flow instead of throwing.
 */
export function unwrapResult<T>(result: Result<T, Error>): T {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}
