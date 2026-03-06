import { Ok, Err, type Result } from './result.js';

/**
 * Preferred composition pattern when chaining multiple sync Result-returning operations.
 * Use `yield*` to unwrap each Result — short-circuits on first Err.
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
 * Like `resultFrom`, but catches thrown exceptions and wraps them in Err.
 *
 * @example
 * ```ts
 * const result = resultFromCatching(function* () {
 *   const parsed = yield* parseInput(raw);
 *   return riskyTransform(parsed); // may throw
 * }, 'Transform failed');
 * ```
 */
export function resultFromCatching<T>(
  fn: () => Generator<Err<never, Error>, T>,
  catchMessage: string
): Result<T, Error>;
export function resultFromCatching<T, E>(
  fn: () => Generator<Err<never, E>, T>,
  catchError: (cause: unknown) => E
): Result<T, E>;
export function resultFromCatching<T, Ctx>(
  fn: (ctx: Ctx) => Generator<Err<never, Error>, T>,
  ctx: Ctx,
  catchMessage: string
): Result<T, Error>;
export function resultFromCatching<T, E, Ctx>(
  fn: (ctx: Ctx) => Generator<Err<never, E>, T>,
  ctx: Ctx,
  catchError: (cause: unknown) => E
): Result<T, E>;
export function resultFromCatching<T, E>(
  fn: (ctx?: unknown) => Generator<Err<never, E>, T>,
  ctxOrCatch: unknown,
  maybeCatch?: string | ((cause: unknown) => E)
): Result<T, E> {
  const hasCtx = maybeCatch !== undefined;
  const ctx = hasCtx ? ctxOrCatch : undefined;
  const catcher = (hasCtx ? maybeCatch : ctxOrCatch) as string | ((cause: unknown) => E);

  try {
    const it = ctx !== undefined ? fn(ctx) : fn();
    const next = it.next();
    if (next.done) return new Ok(next.value);
    it.return(undefined as never);
    return new Err(next.value.error);
  } catch (error) {
    if (typeof catcher === 'string') {
      return new Err(new Error(catcher, { cause: error })) as Result<T, E>;
    }
    return new Err(catcher(error));
  }
}

/**
 * Async version of `resultFrom` for composing async Result-returning operations.
 * Use `yield* await` to unwrap each `Promise<Result>` — short-circuits on first Err.
 *
 * @example
 * ```ts
 * async function deleteForAccounts(tx: Transaction, ids: string[]): Promise<Result<void, Error>> {
 *   return resultFromAsync(async function* () {
 *     yield* await tx.links.deleteByAccountIds(ids);
 *     yield* await tx.transactions.deleteByAccountIds(ids);
 *   });
 * }
 * ```
 */
export async function resultFromAsync<T, E>(fn: () => AsyncGenerator<Err<never, E>, T>): Promise<Result<T, E>>;
export async function resultFromAsync<T, E, Ctx>(
  fn: (ctx: Ctx) => AsyncGenerator<Err<never, E>, T>,
  ctx: Ctx
): Promise<Result<T, E>>;
export async function resultFromAsync<T, E>(
  fn: (ctx?: unknown) => AsyncGenerator<Err<never, E>, T>,
  ctx?: unknown
): Promise<Result<T, E>> {
  const it = ctx !== undefined ? fn(ctx) : fn();
  const next = await it.next();
  if (next.done) return new Ok(next.value);
  await it.return(undefined as never);
  return new Err(next.value.error);
}

/**
 * Like `resultFromAsync`, but catches thrown exceptions and wraps them in Err.
 * Use when the generator body calls throwing APIs (e.g. database, network).
 *
 * @example
 * ```ts
 * // With catch message — wraps in new Error(message, { cause })
 * async findById(id: number): Promise<Result<Account, Error>> {
 *   return resultFromAsyncCatching(async function* (self) {
 *     const row = await self.db.selectFrom('accounts').where('id', '=', id).executeTakeFirst();
 *     if (!row) yield* err('Not found');
 *     return yield* toAccount(row!);
 *   }, this, 'Failed to find account by ID');
 * }
 *
 * // With catch factory — full control over error type
 * return resultFromAsyncCatching(async function* (self) {
 *   yield* await self.deleteRows(ids);
 * }, this, (cause) => new DatabaseError('Delete failed', { cause }));
 *
 * // Without ctx
 * return resultFromAsyncCatching(async function* () {
 *   const data = await fetchData();
 *   return yield* parseData(data);
 * }, 'Fetch failed');
 * ```
 */
export async function resultFromAsyncCatching<T>(
  fn: () => AsyncGenerator<Err<never, Error>, T>,
  catchMessage: string
): Promise<Result<T, Error>>;
export async function resultFromAsyncCatching<T, E>(
  fn: () => AsyncGenerator<Err<never, E>, T>,
  catchError: (cause: unknown) => E
): Promise<Result<T, E>>;
export async function resultFromAsyncCatching<T, Ctx>(
  fn: (ctx: Ctx) => AsyncGenerator<Err<never, Error>, T>,
  ctx: Ctx,
  catchMessage: string
): Promise<Result<T, Error>>;
export async function resultFromAsyncCatching<T, E, Ctx>(
  fn: (ctx: Ctx) => AsyncGenerator<Err<never, E>, T>,
  ctx: Ctx,
  catchError: (cause: unknown) => E
): Promise<Result<T, E>>;
export async function resultFromAsyncCatching<T, E>(
  fn: (ctx?: unknown) => AsyncGenerator<Err<never, E>, T>,
  ctxOrCatch: unknown,
  maybeCatch?: string | ((cause: unknown) => E)
): Promise<Result<T, E>> {
  const hasCtx = maybeCatch !== undefined;
  const ctx = hasCtx ? ctxOrCatch : undefined;
  const catcher = (hasCtx ? maybeCatch : ctxOrCatch) as string | ((cause: unknown) => E);

  try {
    const it = ctx !== undefined ? fn(ctx) : fn();
    const next = await it.next();
    if (next.done) return new Ok(next.value);
    await it.return(undefined as never);
    return new Err(next.value.error);
  } catch (error) {
    if (typeof catcher === 'string') {
      return new Err(new Error(catcher, { cause: error })) as Result<T, E>;
    }
    return new Err(catcher(error));
  }
}
