import { describe, expect, it } from 'vitest';

import { resultFrom, resultFromAsync } from '../result-from.js';
import { ok, err, type Result } from '../result.js';

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

// -- resultFrom (sync) --

describe('resultFrom', () => {
  it('returns Ok when all steps succeed', () => {
    const result = resultFrom(function* () {
      const a = yield* succeed(1);
      const b = yield* succeed(2);
      return a + b;
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(3);
  });

  it('short-circuits on first Err', () => {
    const result = resultFrom(function* () {
      const a = yield* succeed(1);
      const _b = yield* fail('step2');
      const _c = yield* succeed(3); // never reached
      return a;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('step2');
  });

  it('short-circuits on first step if it fails', () => {
    const result = resultFrom(function* () {
      const _a = yield* fail('first');
      return 999;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('first');
  });

  it('handles many sequential steps', () => {
    const result = resultFrom(function* () {
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
    const result = resultFrom(function* () {
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

    const result = resultFrom(function* () {
      const n = yield* parseNumber('21');
      const s = yield* toString(n);
      return s;
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe('42');
  });

  it('runs finally block on Err short-circuit', () => {
    let finalized = false;

    const result = resultFrom(function* () {
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

    const result = resultFrom(function* () {
      try {
        return yield* succeed(42);
      } finally {
        finalized = true;
      }
    });

    expect(result.isOk()).toBe(true);
    expect(finalized).toBe(true);
  });
});

// -- resultFromAsync --

describe('resultFromAsync', () => {
  it('returns Ok when all async steps succeed', async () => {
    const result = await resultFromAsync(async function* () {
      const a = yield* await succeedAsync(10);
      const b = yield* await succeedAsync(20);
      return a + b;
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(30);
  });

  it('short-circuits on first async Err', async () => {
    const result = await resultFromAsync(async function* () {
      const a = yield* await succeedAsync(1);
      yield* await failAsync('async-fail');
      return a;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('async-fail');
  });

  it('handles loop with async steps', async () => {
    const result = await resultFromAsync(async function* () {
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

    const result = await resultFromAsync(async function* () {
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
    const result = await resultFromAsync(async function* () {
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

    const result = await resultFromAsync(async function* () {
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

    const result = await resultFromAsync(async function* () {
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

    const result = await resultFromAsync(async function* () {
      yield* await succeedAsync(1);
      yield* await Promise.resolve(err<number, Error>(specificError));
      return 0;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toBe(specificError);
  });
});
