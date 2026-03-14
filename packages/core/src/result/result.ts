/**
 * A discriminated union representing either success (`Ok`) or failure (`Err`).
 *
 * Use `ok(value)` and `err(error)` to construct, and `resultDo` / `resultDoAsync`
 * for composing multiple Result-returning operations with automatic error propagation.
 *
 * @example
 * ```ts
 * // Construction
 * const success = ok(42);
 * const failure = err('not found');
 *
 * // Narrowing
 * if (result.isOk()) {
 *   console.log(result.value);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export type Result<T, E> = Ok<T, E> | Err<T, E>;

export class Ok<T, E> {
  readonly _tag = 'ok' as const;
  constructor(readonly value: T) {}
  isOk(): this is Ok<T, E> {
    return true;
  }
  isErr(): this is Err<T, E> {
    return false;
  }
  // TODO: neverthrow compat — convert call sites to use isOk() narrowing, then remove
  unwrapOr(_defaultValue: T): T {
    return this.value;
  }
  // Yielded type is the short-circuit carrier: yield* on Ok extracts the value,
  // yield* on Err propagates the error and terminates the generator.
  // eslint-disable-next-line require-yield -- Ok never yields; it returns the value directly
  *[Symbol.iterator](): Generator<Err<never, E>, T> {
    return this.value;
  }
}

export class Err<T, E> {
  readonly _tag = 'err' as const;
  constructor(readonly error: E) {}
  isOk(): this is Ok<T, E> {
    return false;
  }
  isErr(): this is Err<T, E> {
    return true;
  }
  // TODO: neverthrow compat — convert call sites to use isOk() narrowing, then remove
  unwrapOr(defaultValue: T): T {
    return defaultValue;
  }
  *[Symbol.iterator](): Generator<Err<never, E>, never> {
    yield this as unknown as Err<never, E>;
    // Required to satisfy generator completion typing; control never reaches here
    // because resultDo/resultDoAsync terminate the generator on receiving the yielded Err
    throw new Error('unreachable');
  }
}

export const ok = <T, E = never>(value: T): Ok<T, E> => new Ok(value);

/** Normalizes unknown values to Error instances. */
function normalizeError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function err<T = never>(message: string, cause?: unknown): Err<T, Error>;
export function err<T = never, E = Error>(error: E): Err<T, E>;
export function err<T = never>(errorOrMessage: unknown, cause?: unknown): Err<T, Error> {
  if (typeof errorOrMessage === 'string') {
    return new Err(new Error(errorOrMessage, cause !== undefined ? { cause: normalizeError(cause) } : undefined));
  }
  return new Err(errorOrMessage as Error);
}
