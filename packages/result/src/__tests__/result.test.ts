import { describe, expect, it, vi } from 'vitest';

import { Err, Ok, err, ok } from '../result.js';

describe('Ok', () => {
  it('constructs with a value', () => {
    const result = ok(42);
    expect(result).toBeInstanceOf(Ok);
    expect((result as Ok<number>).value).toBe(42);
  });

  it('has _tag "ok"', () => {
    expect(ok('hello')._tag).toBe('ok');
  });

  it('isOk() returns true', () => {
    expect(ok(1).isOk()).toBe(true);
  });

  it('isErr() returns false', () => {
    expect(ok(1).isErr()).toBe(false);
  });

  it('map transforms the value', () => {
    const result = ok(2).map((n) => n * 3);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(6);
  });

  it('mapErr is a no-op', () => {
    const result = ok<number, Error>(5).mapErr((e) => new TypeError(e.message));
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(5);
  });

  it('andThen chains to a new Result', () => {
    const result = ok(3).andThen((n) => ok(n + 1));
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(4);
  });

  it('andThen returns Err when fn returns Err', () => {
    const result = ok<number, Error>(3).andThen(() => err(new Error('fail')));
    expect(result.isErr()).toBe(true);
  });

  it('unwrapOr returns the value', () => {
    expect(ok(7).unwrapOr(0)).toBe(7);
  });

  it('match calls ok handler', () => {
    const out = ok(10).match({ err: () => -1, ok: (v) => v * 2 });
    expect(out).toBe(20);
  });

  it('tap calls side effect and returns same Result', () => {
    const fn = vi.fn();
    const result = ok(99);
    const returned = result.tap(fn);
    expect(fn).toHaveBeenCalledWith(99);
    expect(returned).toBe(result);
  });

  it('tapErr is a no-op on Ok', () => {
    const fn = vi.fn();
    const result = ok(1).tapErr(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(result.isOk()).toBe(true);
  });
});

describe('Err', () => {
  it('constructs with an error', () => {
    const error = new Error('oops');
    const result = err(error);
    expect(result).toBeInstanceOf(Err);
    expect((result as Err<never, Error>).error).toBe(error);
  });

  it('has _tag "err"', () => {
    expect(err(new Error('x'))._tag).toBe('err');
  });

  it('isOk() returns false', () => {
    expect(err(new Error()).isOk()).toBe(false);
  });

  it('isErr() returns true', () => {
    expect(err(new Error()).isErr()).toBe(true);
  });

  it('map is a no-op', () => {
    const error = new Error('fail');
    const result = err<number, Error>(error).map((n) => n * 2);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toBe(error);
  });

  it('mapErr transforms the error', () => {
    const result = err<never, string>('bad').mapErr((msg) => new Error(msg));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('bad');
  });

  it('andThen is a no-op', () => {
    const fn = vi.fn();
    const error = new Error('stop');
    const result = err<number, Error>(error).andThen(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toBe(error);
  });

  it('unwrapOr returns the fallback', () => {
    expect(err<number, Error>(new Error()).unwrapOr(42)).toBe(42);
  });

  it('match calls err handler', () => {
    const out = err<number, Error>(new Error('x')).match({ err: (e) => e.message.length, ok: () => 0 });
    expect(out).toBe(1);
  });

  it('tap is a no-op on Err', () => {
    const fn = vi.fn();
    const result = err<number, Error>(new Error('e')).tap(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(result.isErr()).toBe(true);
  });

  it('tapErr calls side effect and returns same Result', () => {
    const fn = vi.fn();
    const error = new Error('tapErr');
    const result = err(error);
    const returned = result.tapErr(fn);
    expect(fn).toHaveBeenCalledWith(error);
    expect(returned).toBe(result);
  });
});

describe('type narrowing', () => {
  it('narrows to Ok after isOk() guard', () => {
    const result: Ok<number, Error> | Err<number, Error> = ok(5);
    if (result.isOk()) {
      const val: number = result.value;
      expect(val).toBe(5);
    }
  });

  it('narrows to Err after isErr() guard', () => {
    const error = new Error('narrow');
    const result: Ok<number, Error> | Err<number, Error> = err(error);
    if (result.isErr()) {
      const e: Error = result.error;
      expect(e).toBe(error);
    }
  });
});
