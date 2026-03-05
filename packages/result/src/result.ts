export type Result<T, E = Error> = Ok<T, E> | Err<T, E>;

export class Ok<T, E = never> {
  readonly _tag = 'ok' as const;

  constructor(readonly value: T) {}

  isOk(): this is Ok<T, E> {
    return true;
  }

  isErr(): this is Err<T, E> {
    return false;
  }

  map<U>(fn: (val: T) => U): Result<U, E> {
    return new Ok(fn(this.value));
  }

  mapErr<F>(_fn: (err: E) => F): Result<T, F> {
    return new Ok<T, F>(this.value);
  }

  andThen<U>(fn: (val: T) => Result<U, E>): Result<U, E> {
    return fn(this.value);
  }

  unwrapOr(_fallback: T): T {
    return this.value;
  }

  match<U>(handlers: { err: (err: E) => U; ok: (val: T) => U }): U {
    return handlers.ok(this.value);
  }

  tap(fn: (val: T) => void): Result<T, E> {
    fn(this.value);
    return this;
  }

  tapErr(_fn: (err: E) => void): Result<T, E> {
    return this;
  }

  // eslint-disable-next-line require-yield -- Ok iterator returns without yielding; yield* unwraps to value
  *[Symbol.iterator](): Generator<never, T, unknown> {
    return this.value;
  }
}

export class Err<T = never, E = Error> {
  readonly _tag = 'err' as const;

  constructor(readonly error: E) {}

  isOk(): this is Ok<T, E> {
    return false;
  }

  isErr(): this is Err<T, E> {
    return true;
  }

  map<U>(_fn: (val: T) => U): Result<U, E> {
    return new Err<U, E>(this.error);
  }

  mapErr<F>(fn: (err: E) => F): Result<T, F> {
    return new Err<T, F>(fn(this.error));
  }

  andThen<U>(_fn: (val: T) => Result<U, E>): Result<U, E> {
    return new Err<U, E>(this.error);
  }

  unwrapOr(fallback: T): T {
    return fallback;
  }

  match<U>(handlers: { err: (err: E) => U; ok: (val: T) => U }): U {
    return handlers.err(this.error);
  }

  tap(_fn: (val: T) => void): Result<T, E> {
    return this;
  }

  tapErr(fn: (err: E) => void): Result<T, E> {
    fn(this.error);
    return this;
  }

  *[Symbol.iterator](): Generator<Err<never, E>, never, unknown> {
    yield this as unknown as Err<never, E>;
    // unreachable — the generator runner never resumes after an Err yield
    throw new Error('unreachable');
  }
}

export function ok<T, E = never>(value: T): Result<T, E> {
  return new Ok<T, E>(value);
}

export function err<T = never, E = Error>(error: E): Result<T, E> {
  return new Err<T, E>(error);
}
