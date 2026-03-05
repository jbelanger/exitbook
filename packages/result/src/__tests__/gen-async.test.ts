import { describe, expect, it, vi } from 'vitest';

import { genAsync } from '../gen.js';
import { err, ok } from '../result.js';

async function asyncStep(n: number) {
  await Promise.resolve();
  return n > 0 ? ok(n) : err(new Error(`async negative: ${n}`));
}

describe('genAsync()', () => {
  it('happy path: all Ok, returns final value', async () => {
    const result = await genAsync(async function* () {
      const a = yield* await asyncStep(1);
      const b = yield* await asyncStep(2);
      const c = yield* await asyncStep(3);
      return a + b + c;
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(6);
  });

  it('short-circuits on first Err and does not run subsequent steps', async () => {
    const third = vi.fn(() => ok(99));

    const result = await genAsync(async function* () {
      const a = yield* await asyncStep(1);
      const b = yield* await asyncStep(-5); // fails here
      const c = yield* third();
      return a + b + c;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('async negative: -5');
    expect(third).not.toHaveBeenCalled();
  });

  it('works with inline mapErr', async () => {
    const result = await genAsync(async function* () {
      await Promise.resolve(); // satisfy require-await for async generator
      const val = yield* err<number, string>('raw').mapErr((msg) => new Error(`async ctx: ${msg}`));
      return val;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('async ctx: raw');
  });

  it('accumulates values in a loop', async () => {
    const result = await genAsync(async function* () {
      const values: number[] = [];
      for (const n of [10, 20, 30]) {
        values.push(yield* await asyncStep(n));
      }
      return values;
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toEqual([10, 20, 30]);
  });

  it('short-circuits inside a loop', async () => {
    const result = await genAsync(async function* () {
      const values: number[] = [];
      for (const n of [1, 2, -3, 4]) {
        values.push(yield* await asyncStep(n));
      }
      return values;
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('async negative: -3');
  });

  it('async operations actually execute (not just type-level)', async () => {
    let sideEffect = 0;

    const result = await genAsync(async function* () {
      sideEffect = 1;
      const a = yield* await asyncStep(5);
      sideEffect = 2;
      return a;
    });

    expect(sideEffect).toBe(2);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(5);
  });

  it('propagates error through async boundary', async () => {
    const result = await genAsync(async function* () {
      yield* await asyncStep(-99);
      return 'never reached';
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('async negative: -99');
  });

  it('supports mixing sync ok/err with await', async () => {
    const result = await genAsync(async function* () {
      const a = yield* ok(3);
      const b = yield* await asyncStep(7);
      return a + b;
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(10);
  });
});
