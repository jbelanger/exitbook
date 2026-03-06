/**
 * A discriminated union representing either success (`Ok`) or failure (`Err`).
 *
 * Use `ok(value)` and `err(error)` to construct, and `resultFrom` / `resultFromAsync`
 * for composing multiple Result-returning operations with automatic error propagation.
 *
 * @example
 * ```ts
 * // Construction
 * const success = ok(42);
 * const failure = err(new Error('not found'));
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
  // TODO: neverthrow compat — convert call sites to use .value directly, then remove
  _unsafeUnwrap(): T {
    return this.value;
  }
  // TODO: neverthrow compat — convert call sites to use .error directly, then remove
  _unsafeUnwrapErr(): never {
    throw new Error('Called _unsafeUnwrapErr on Ok');
  }
  // TODO: neverthrow compat — convert call sites to use isOk() narrowing, then remove
  unwrapOr(_defaultValue: T): T {
    return this.value;
  }
  // eslint-disable-next-line require-yield -- allows for easier composition with resultFrom()
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
  // TODO: neverthrow compat — convert call sites to use .error directly, then remove
  _unsafeUnwrap(): never {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- fine
    throw this.error;
  }
  // TODO: neverthrow compat — convert call sites to use .error directly, then remove
  _unsafeUnwrapErr(): E {
    return this.error;
  }
  // TODO: neverthrow compat — convert call sites to use isOk() narrowing, then remove
  unwrapOr(defaultValue: T): T {
    return defaultValue;
  }
  *[Symbol.iterator](): Generator<Err<never, E>, never> {
    yield this as unknown as Err<never, E>;
    throw new Error('unreachable');
  }
}

export const ok = <T, E = never>(value: T): Result<T, E> => new Ok(value);
export const err = <T = never, E = Error>(error: E): Result<T, E> => new Err(error);
