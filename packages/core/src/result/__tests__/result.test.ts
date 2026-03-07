/* eslint-disable require-yield -- generators that only throw are testing catch behavior */
import { describe, expect, it } from 'vitest';

import { resultDo, resultDoAsync, resultTry, resultTryAsync } from '../result-do.js';
import { ok, err, type Err, type Result } from '../result.js';

// -- Helpers --

const succeed = (v: number): Result<number, Error> => ok(v);
const fail = (msg: string): Result<number, Error> => err(new Error(msg));

const succeedAsync = (v: number): Promise<Result<number, Error>> => Promise.resolve(ok(v));
const failAsync = (msg: string): Promise<Result<number, Error>> => Promise.resolve(err(new Error(msg)));

// -- Result (Ok / Err) --

describe('Result', () => {
  describe('Ok', () => {
    const result = ok(42);

    it('isOk returns true', () => {
      expect(result.isOk()).toBe(true);
    });

    it('isErr returns false', () => {
      expect(result.isErr()).toBe(false);
    });

    it('has _tag "ok"', () => {
      expect(result._tag).toBe('ok');
    });

    it('holds the value', () => {
      if (result.isOk()) expect(result.value).toBe(42);
    });
  });

  describe('Err', () => {
    const result = err(new Error('boom'));

    it('isOk returns false', () => {
      expect(result.isOk()).toBe(false);
    });

    it('isErr returns true', () => {
      expect(result.isErr()).toBe(true);
    });

    it('has _tag "err"', () => {
      expect(result._tag).toBe('err');
    });

    it('holds the error', () => {
      if (result.isErr()) expect(result.error.message).toBe('boom');
    });
  });
});

// -- resultDo (sync) --

describe('resultDo', () => {
  it('returns Ok when all steps succeed', () => {
    const result = resultDo(function* () {
      const a = yield* succeed(1);
      const b = yield* succeed(2);
      return a + b;
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(3);
  });

  it('short-circuits on first Err', () => {
    const result = resultDo(function* () {
      const a = yield* succeed(1);
      const _b = yield* fail('step2');
      const _c = yield* succeed(3); // never reached
      return a;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('step2');
  });

  it('short-circuits on first step if it fails', () => {
    const result = resultDo(function* () {
      const _a = yield* fail('first');
      return 999;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('first');
  });

  it('handles many sequential steps', () => {
    const result = resultDo(function* () {
      let sum = 0;
      for (let i = 1; i <= 10; i++) {
        sum += yield* succeed(i);
      }
      return sum;
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(55);
  });

  it('preserves the exact error from the failing step', () => {
    const specificError = new Error('specific');
    const result = resultDo(function* () {
      yield* succeed(1);
      yield* err(specificError);
      return 0;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toBe(specificError);
  });

  it('works with different value types across steps', () => {
    const parseNumber = (s: string): Result<number, Error> => {
      const n = Number(s);
      return isNaN(n) ? err(new Error('NaN')) : ok(n);
    };
    const toString = (n: number): Result<string, Error> => ok(String(n * 2));

    const result = resultDo(function* () {
      const n = yield* parseNumber('21');
      const s = yield* toString(n);
      return s;
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe('42');
  });

  it('runs finally block on Err short-circuit', () => {
    let finalized = false;

    const result = resultDo(function* () {
      try {
        yield* succeed(1);
        yield* fail('boom');
        return 0;
      } finally {
        finalized = true;
      }
    });

    expect(result.isErr()).toBe(true);
    expect(finalized).toBe(true);
  });

  it('runs finally block on success', () => {
    let finalized = false;

    const result = resultDo(function* () {
      try {
        return yield* succeed(42);
      } finally {
        finalized = true;
      }
    });

    expect(result.isOk()).toBe(true);
    expect(finalized).toBe(true);
  });

  it('throws a helpful error when the generator yields a non-Err value', () => {
    expect(() =>
      resultDo(function* () {
        yield ok(1);
        return 2;
      } as unknown as () => Generator<Err<never, Error>, number, unknown>)
    ).toThrow('resultDo expected the generator to yield an Err short-circuit value');
  });
});

// -- resultTry (sync) --

describe('resultTry', () => {
  it('returns Ok when no error thrown', () => {
    const result = resultTry(function* () {
      return yield* succeed(42);
    }, 'should not catch');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(42);
  });

  it('short-circuits on yielded Err (not caught)', () => {
    const result = resultTry(function* () {
      yield* fail('yielded');
      return 0;
    }, 'catch message');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('yielded');
  });

  it('catches thrown error with catchMessage string', () => {
    const result = resultTry(function* () {
      throw new Error('kaboom');
    }, 'Operation failed');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Operation failed');
      expect(result.error.cause).toBeInstanceOf(Error);
      expect((result.error.cause as Error).message).toBe('kaboom');
    }
  });

  it('catches thrown error with catchError factory', () => {
    class CustomError {
      constructor(
        readonly message: string,
        readonly originalCause: unknown
      ) {}
    }

    const result = resultTry(
      function* () {
        throw new Error('oops');
      },
      (cause) => new CustomError('Wrapped', cause)
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(CustomError);
      expect((result.error as unknown as CustomError).originalCause).toBeInstanceOf(Error);
    }
  });
});

// -- resultDoAsync --

describe('resultDoAsync', () => {
  it('returns Ok when all async steps succeed', async () => {
    const result = await resultDoAsync(async function* () {
      const a = yield* await succeedAsync(10);
      const b = yield* await succeedAsync(20);
      return a + b;
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(30);
  });

  it('short-circuits on first async Err', async () => {
    const result = await resultDoAsync(async function* () {
      const a = yield* await succeedAsync(1);
      yield* await failAsync('async-fail');
      return a;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('async-fail');
  });

  it('handles loop with async steps', async () => {
    const result = await resultDoAsync(async function* () {
      let sum = 0;
      for (let i = 1; i <= 5; i++) {
        sum += yield* await succeedAsync(i);
      }
      return sum;
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(15);
  });

  it('short-circuits mid-loop', async () => {
    let iterations = 0;

    const result = await resultDoAsync(async function* () {
      for (let i = 1; i <= 5; i++) {
        iterations++;
        if (i === 3) {
          yield* await failAsync('stop-at-3');
        }
        yield* await succeedAsync(i);
      }
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('stop-at-3');
    expect(iterations).toBe(3);
  });

  it('can mix sync Results with async ones', async () => {
    const result = await resultDoAsync(async function* () {
      const a = yield* succeed(1); // sync
      const b = yield* await succeedAsync(2); // async
      const c = yield* succeed(3); // sync
      return a + b + c;
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(6);
  });

  it('runs finally block on async Err short-circuit', async () => {
    let finalized = false;

    const result = await resultDoAsync(async function* () {
      try {
        yield* await succeedAsync(1);
        yield* await failAsync('boom');
        return 0;
      } finally {
        finalized = true;
      }
    });

    expect(result.isErr()).toBe(true);
    expect(finalized).toBe(true);
  });

  it('runs finally block on async success', async () => {
    let finalized = false;

    const result = await resultDoAsync(async function* () {
      try {
        return yield* await succeedAsync(42);
      } finally {
        finalized = true;
      }
    });

    expect(result.isOk()).toBe(true);
    expect(finalized).toBe(true);
  });

  it('preserves error identity through async chain', async () => {
    const specificError = new Error('identity-check');

    const result = await resultDoAsync(async function* () {
      yield* await succeedAsync(1);
      yield* await Promise.resolve(err<number>(specificError));
      return 0;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toBe(specificError);
  });

  it('passes ctx as parameter when provided', async () => {
    const ctx = { multiplier: 10 };

    const result = await resultDoAsync(async function* (self) {
      const a = yield* await succeedAsync(3);
      return a * self.multiplier;
    }, ctx);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(30);
  });

  it('passes ctx and short-circuits on Err', async () => {
    const ctx = { label: 'test' };

    const result = await resultDoAsync(async function* (self) {
      yield* await failAsync(`${self.label}-failed`);
      return 0;
    }, ctx);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('test-failed');
  });

  it('propagates thrown errors when no catch handler', async () => {
    await expect(
      resultDoAsync(async function* () {
        throw new Error('kaboom');
      })
    ).rejects.toThrow('kaboom');
  });

  it('throws a helpful error when the generator yields a non-Err value', async () => {
    await expect(
      resultDoAsync(async function* () {
        yield ok(1);
        return 2;
      } as unknown as () => AsyncGenerator<Err<never, Error>, number, unknown>)
    ).rejects.toThrow('resultDoAsync expected the generator to yield an Err short-circuit value');
  });
});

// -- resultTryAsync --

describe('resultTryAsync', () => {
  it('returns Ok when all steps succeed', async () => {
    const ctx = { value: 5 };
    const result = await resultTryAsync(
      async function* (self) {
        return self.value + (yield* await succeedAsync(10));
      },
      ctx,
      'should not catch'
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(15);
  });

  it('short-circuits on yielded Err (not caught)', async () => {
    const result = await resultTryAsync(async function* () {
      yield* await failAsync('yielded-err');
      return 0;
    }, 'catch message');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('yielded-err');
  });

  it('catches thrown error with catchMessage string', async () => {
    const result = await resultTryAsync(async function* () {
      throw new Error('db connection failed');
    }, 'Failed to query database');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Failed to query database');
      expect(result.error.cause).toBeInstanceOf(Error);
      expect((result.error.cause as Error).message).toBe('db connection failed');
    }
  });

  it('catches thrown error with catchError factory', async () => {
    class CustomError {
      constructor(
        readonly message: string,
        readonly originalCause: unknown
      ) {}
    }

    const result = await resultTryAsync(
      async function* () {
        throw new Error('network timeout');
      },
      (cause) => new CustomError('Request failed', cause)
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(CustomError);
      expect(result.error.message).toBe('Request failed');
      expect((result.error as unknown as CustomError).originalCause).toBeInstanceOf(Error);
    }
  });

  it('catches non-Error thrown values with catchMessage', async () => {
    const result = await resultTryAsync(async function* () {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- testing non-Error throw handling
      throw 'raw string error';
    }, 'Wrapped error');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Wrapped error');
      expect(result.error.cause).toBeInstanceOf(Error);
      expect((result.error.cause as Error).message).toBe('raw string error');
    }
  });

  it('passes ctx and catches thrown error', async () => {
    const ctx = { tableName: 'accounts' };

    const result = await resultTryAsync(
      async function* (self) {
        throw new Error(`table ${self.tableName} locked`);
      },
      ctx,
      (cause) => new Error('DB operation failed', { cause: cause as Error })
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('DB operation failed');
      expect((result.error.cause as Error).message).toBe('table accounts locked');
    }
  });

  it('runs finally block before catch wraps the error', async () => {
    let finalized = false;

    const result = await resultTryAsync(async function* () {
      try {
        throw new Error('boom');
      } finally {
        finalized = true;
      }
    }, 'Caught');

    expect(result.isErr()).toBe(true);
    expect(finalized).toBe(true);
  });

  it('works without ctx using 2-arg form', async () => {
    const result = await resultTryAsync(async function* () {
      const a = yield* await succeedAsync(1);
      const b = yield* await succeedAsync(2);
      return a + b;
    }, 'should not catch');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(3);
  });
});

// -- err() overloads --

describe('err()', () => {
  it('creates Err from Error instance', () => {
    const error = new Error('direct');
    const result = err(error);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toBe(error);
  });

  it('creates Err from message string', () => {
    const result = err('something failed');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('something failed');
      expect(result.error.cause).toBeUndefined();
    }
  });

  it('creates Err from message string with Error cause', () => {
    const cause = new Error('root cause');
    const result = err('wrapper message', cause);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('wrapper message');
      expect(result.error.cause).toBe(cause);
    }
  });

  it('creates Err from message string with non-Error cause', () => {
    const result = err('wrapper', 'string cause');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('wrapper');
      expect(result.error.cause).toBeInstanceOf(Error);
      expect((result.error.cause as Error).message).toBe('string cause');
    }
  });
});

// -- compat shims --

describe('compat shims', () => {
  it('Ok._unsafeUnwrapErr throws', () => {
    expect(() => ok(42)._unsafeUnwrapErr()).toThrow('Called _unsafeUnwrapErr on Ok');
  });

  it('Ok.unwrapOr returns value, ignoring default', () => {
    expect(ok(42).unwrapOr(0)).toBe(42);
  });

  it('Err._unsafeUnwrapErr returns the error', () => {
    const error = new Error('boom');
    const result = err(error);
    if (result.isErr()) expect(result._unsafeUnwrapErr()).toBe(error);
  });

  it('Err.unwrapOr returns default value', () => {
    expect(err<number>(new Error('boom')).unwrapOr(99)).toBe(99);
  });
});
