import type { Result } from './result.js';
import { err, ok } from './result.js';

export function collectResults<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (result.isErr()) {
      return result.map(() => values);
    }
    values.push(result.value);
  }
  return ok(values);
}

export function wrapError<T = never>(error: unknown, context: string): Result<T, Error> {
  const cause = error instanceof Error ? error : new Error(String(error));
  return err(new Error(`${context}: ${cause.message}`, { cause }));
}

export async function fromPromise<T>(promise: Promise<T>): Promise<Result<T, Error>> {
  try {
    return ok(await promise);
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    return err(cause);
  }
}

export function fromThrowable<T>(fn: () => T): Result<T, Error> {
  try {
    return ok(fn());
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    return err(cause);
  }
}
