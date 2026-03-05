import { describe, expect, it } from 'vitest';

import { collectResults, fromPromise, fromThrowable, wrapError } from '../helpers.js';
import { err, ok } from '../result.js';

describe('collectResults()', () => {
  it('collects all Ok values into an array', () => {
    const result = collectResults([ok(1), ok(2), ok(3)]);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toEqual([1, 2, 3]);
  });

  it('short-circuits on the first Err', () => {
    const error = new Error('second');
    const result = collectResults([ok(1), err<number, Error>(error), ok(3)]);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toBe(error);
  });

  it('returns Ok with empty array for empty input', () => {
    const result = collectResults<number, Error>([]);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toEqual([]);
  });

  it('returns first Err when multiple Errs present', () => {
    const first = new Error('first');
    const second = new Error('second');
    const result = collectResults([ok(1), err<number, Error>(first), err<number, Error>(second)]);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toBe(first);
  });
});

describe('wrapError()', () => {
  it('wraps an Error instance with context', () => {
    const cause = new Error('original');
    const result = wrapError(cause, 'Context');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Context: original');
      expect(result.error.cause).toBe(cause);
    }
  });

  it('wraps a string error with context', () => {
    const result = wrapError('string error', 'Failed');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('Failed: string error');
  });

  it('wraps a number error with context', () => {
    const result = wrapError(404, 'HTTP error');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('HTTP error: 404');
  });

  it('wraps null with context', () => {
    // eslint-disable-next-line unicorn/no-null -- intentionally testing null as unknown error value
    const result = wrapError(null, 'Null error');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('Null error: null');
  });

  it('wraps undefined with context', () => {
    const result = wrapError(undefined, 'Undefined error');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('Undefined error: undefined');
  });

  it('preserves Error subclass as cause', () => {
    const typeError = new TypeError('type mismatch');
    const result = wrapError(typeError, 'Validation');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Validation: type mismatch');
      expect(result.error.cause).toBe(typeError);
      expect(result.error.cause).toBeInstanceOf(TypeError);
    }
  });
});

describe('fromPromise()', () => {
  it('wraps a resolved promise in Ok', async () => {
    const result = await fromPromise(Promise.resolve(42));
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(42);
  });

  it('wraps a rejected promise in Err', async () => {
    const result = await fromPromise(Promise.reject(new Error('rejected')));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('rejected');
  });

  it('wraps a non-Error rejection in Err', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- intentionally testing non-Error rejection handling
    const result = await fromPromise(Promise.reject('string rejection'));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('string rejection');
  });
});

describe('fromThrowable()', () => {
  it('wraps a non-throwing function in Ok', () => {
    const result = fromThrowable(() => 'hello');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe('hello');
  });

  it('wraps a thrown Error in Err', () => {
    const result = fromThrowable(() => {
      throw new Error('boom');
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('boom');
  });

  it('wraps a thrown non-Error in Err', () => {
    const result = fromThrowable(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- intentionally testing non-Error throw handling
      throw 'string throw';
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('string throw');
  });

  it('returns Ok with undefined for void functions', () => {
    const result = fromThrowable(() => {
      // side effect only, no return
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBeUndefined();
  });
});
