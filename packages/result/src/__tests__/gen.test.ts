import { describe, expect, it, vi } from 'vitest';

import { gen } from '../gen.js';
import { err, ok } from '../result.js';

function step(n: number) {
  return n > 0 ? ok(n) : err(new Error(`negative: ${n}`));
}

describe('gen()', () => {
  it('happy path: all Ok, returns final value', () => {
    const result = gen(function* () {
      const a = yield* ok(1);
      const b = yield* ok(2);
      const c = yield* ok(3);
      return a + b + c;
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(6);
  });

  it('short-circuits on first Err and does not run subsequent steps', () => {
    const third = vi.fn(() => ok(99));

    const result = gen(function* () {
      const a = yield* step(1);
      const b = yield* step(-5); // fails here
      const c = yield* third();
      return a + b + c;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('negative: -5');
    expect(third).not.toHaveBeenCalled();
  });

  it('works with inline map/mapErr', () => {
    const result = gen(function* () {
      const val = yield* err<number, string>('raw error').mapErr((msg) => new Error(`ctx: ${msg}`));
      return val;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('ctx: raw error');
  });

  it('accumulates values in a loop', () => {
    const result = gen(function* () {
      const values: number[] = [];
      for (const n of [1, 2, 3, 4, 5]) {
        values.push(yield* step(n));
      }
      return values;
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toEqual([1, 2, 3, 4, 5]);
  });

  it('short-circuits inside a loop', () => {
    const result = gen(function* () {
      const values: number[] = [];
      for (const n of [1, 2, -1, 4, 5]) {
        values.push(yield* step(n));
      }
      return values;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('negative: -1');
  });

  it('supports nested gen calls', () => {
    const inner = () =>
      gen(function* () {
        const x = yield* ok(10);
        return x * 2;
      });

    const result = gen(function* () {
      const a = yield* inner();
      return a + 1;
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(21);
  });

  it('propagates error from nested gen call', () => {
    const innerFail = () =>
      gen(function* () {
        yield* err(new Error('inner error'));
        return 0;
      });

    const result = gen(function* () {
      const a = yield* innerFail();
      return a;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('inner error');
  });

  it('returns Ok for empty generator that just returns', () => {
    // eslint-disable-next-line require-yield -- generator with no yield is valid; wraps return value in Ok
    const result = gen(function* () {
      return 'done';
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe('done');
  });
});
