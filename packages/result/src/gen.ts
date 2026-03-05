import type { Err, Result } from './result.js';
import { ok } from './result.js';

export function gen<T, E>(fn: () => Generator<Err<never, E>, T, unknown>): Result<T, E> {
  const iter = fn();
  const step = iter.next();
  if (!step.done) {
    // The generator yielded — it hit an Err via yield*
    return step.value as Err<T, E>;
  }
  return ok(step.value);
}

export async function genAsync<T, E>(fn: () => AsyncGenerator<Err<never, E>, T, unknown>): Promise<Result<T, E>> {
  const iter = fn();
  const step = await iter.next();
  if (!step.done) {
    // The generator yielded — it hit an Err via yield*
    return step.value as Err<T, E>;
  }
  return ok(step.value);
}
