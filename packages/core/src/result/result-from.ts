import { Ok, Err, type Result } from './result.js';

/**
 * Composes multiple sync Result-returning operations with automatic error propagation.
 * Use `yield*` to unwrap each Result — if any yields an Err, the generator short-circuits
 * and the Err is returned. Otherwise, the generator's return value is wrapped in Ok.
 *
 * This is the standard way to write any function that returns `Result<T, E>`.
 *
 * @example
 * ```ts
 * function processOrder(raw: string): Result<Order, Error> {
 *   return resultFrom(function* () {
 *     const input = yield* parseInput(raw);
 *     const validated = yield* validateOrder(input);
 *     return buildOrder(validated);
 *   });
 * }
 * ```
 */
export function resultFrom<T, E>(fn: () => Generator<Err<never, E>, T>): Result<T, E> {
  const it = fn();
  const next = it.next();
  if (next.done) return new Ok(next.value);
  it.return(undefined as never);
  return new Err(next.value.error);
}

/**
 * Async version of `resultFrom` for composing async Result-returning operations.
 * Use `yield* await` to unwrap each `Promise<Result>` — if any yields an Err,
 * the generator short-circuits and the Err is returned.
 *
 * This is the standard way to write any function that returns `Promise<Result<T, E>>`.
 *
 * @example
 * ```ts
 * async function deleteForAccounts(tx: Transaction, ids: string[]): Promise<Result<void, Error>> {
 *   return resultFromAsync(async function* () {
 *     yield* await tx.links.deleteByAccountIds(ids);
 *     yield* await tx.transactions.deleteByAccountIds(ids);
 *
 *     for (const id of ids) {
 *       yield* await tx.rawTransactions.deleteAll({ accountId: id });
 *     }
 *   });
 * }
 * ```
 */
export async function resultFromAsync<T, E>(fn: () => AsyncGenerator<Err<never, E>, T>): Promise<Result<T, E>> {
  const it = fn();
  const next = await it.next();
  if (next.done) return new Ok(next.value);
  await it.return(undefined as never);
  return new Err(next.value.error);
}
