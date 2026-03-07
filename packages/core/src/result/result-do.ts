import { Ok, Err, err, type Result } from './result.js';

function toShortCircuitErr<E>(yielded: unknown, helperName: string): Err<never, E> {
  if (
    typeof yielded === 'object' &&
    yielded !== null &&
    '_tag' in yielded &&
    yielded._tag === 'err' &&
    'error' in yielded
  ) {
    return yielded as Err<never, E>;
  }

  throw new Error(
    `${helperName} expected the generator to yield an Err short-circuit value. ` +
      'Use `yield* someResult` inside resultDo* helpers; plain `yield` is for streaming generators.'
  );
}

/**
 * Preferred composition pattern when chaining multiple sync Result-returning operations.
 * Use `yield*` to unwrap each Result inside a one-shot generator — short-circuits on first Err.
 * This helper is not for streaming generators that emit `yield ok(...)` / `yield err(...)` items.
 *
 * @example
 * ```ts
 * function processOrder(raw: string): Result<Order, Error> {
 *   return resultDo(function* () {
 *     const input = yield* parseInput(raw);
 *     const validated = yield* validateOrder(input);
 *     return buildOrder(validated);
 *   });
 * }
 *
 * // With ctx (e.g. class methods)
 * class MyService {
 *   process(raw: string): Result<Order, Error> {
 *     return resultDo(function* (self) {
 *       const input = yield* self.parse(raw);
 *       return yield* self.validate(input);
 *     }, this);
 *   }
 * }
 * ```
 */
export function resultDo<T, E>(fn: () => Generator<Err<never, E>, T>): Result<T, E>;
export function resultDo<T, E, Ctx>(fn: (ctx: Ctx) => Generator<Err<never, E>, T>, ctx: Ctx): Result<T, E>;
export function resultDo<T, E>(fn: (ctx?: unknown) => Generator<Err<never, E>, T>, ctx?: unknown): Result<T, E> {
  const it = ctx !== undefined ? fn(ctx) : fn();
  const next = it.next();
  if (next.done) return new Ok(next.value);
  const shortCircuitErr = toShortCircuitErr<E>(next.value, 'resultDo');
  it.return(undefined as never);
  return new Err(shortCircuitErr.error);
}

/**
 * Like `resultDo`, but catches thrown exceptions and wraps them in Err.
 * Use the same `yield* someResult` unwrapping style as `resultDo`, not streaming `yield ok(...)`.
 *
 * @example
 * ```ts
 * const result = resultTry(function* () {
 *   const parsed = yield* parseInput(raw);
 *   return riskyTransform(parsed); // may throw
 * }, 'Transform failed');
 * ```
 */
export function resultTry<T>(fn: () => Generator<Err<never, Error>, T>, catchMessage: string): Result<T, Error>;
export function resultTry<T, E>(fn: () => Generator<Err<never, E>, T>, catchError: (cause: unknown) => E): Result<T, E>;
export function resultTry<T, Ctx>(
  fn: (ctx: Ctx) => Generator<Err<never, Error>, T>,
  ctx: Ctx,
  catchMessage: string
): Result<T, Error>;
export function resultTry<T, E, Ctx>(
  fn: (ctx: Ctx) => Generator<Err<never, E>, T>,
  ctx: Ctx,
  catchError: (cause: unknown) => E
): Result<T, E>;
export function resultTry<T, E>(
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
    const shortCircuitErr = toShortCircuitErr<E>(next.value, 'resultTry');
    it.return(undefined as never);
    return new Err(shortCircuitErr.error);
  } catch (error) {
    if (typeof catcher === 'string') {
      return err<T>(catcher, error) as Result<T, E>;
    }
    return new Err(catcher(error));
  }
}

/**
 * Async version of `resultDo` for composing async Result-returning operations.
 * Use `yield* await` to unwrap each `Promise<Result>` inside a one-shot generator — short-circuits on first Err.
 * This helper is not for streaming generators that emit `yield ok(...)` / `yield err(...)` items.
 *
 * @example
 * ```ts
 * async function deleteForAccounts(tx: Transaction, ids: string[]): Promise<Result<void, Error>> {
 *   return resultDoAsync(async function* () {
 *     yield* await tx.links.deleteByAccountIds(ids);
 *     yield* await tx.transactions.deleteByAccountIds(ids);
 *   });
 * }
 * ```
 */
export async function resultDoAsync<T, E>(fn: () => AsyncGenerator<Err<never, E>, T>): Promise<Result<T, E>>;
export async function resultDoAsync<T, E, Ctx>(
  fn: (ctx: Ctx) => AsyncGenerator<Err<never, E>, T>,
  ctx: Ctx
): Promise<Result<T, E>>;
export async function resultDoAsync<T, E>(
  fn: (ctx?: unknown) => AsyncGenerator<Err<never, E>, T>,
  ctx?: unknown
): Promise<Result<T, E>> {
  const it = ctx !== undefined ? fn(ctx) : fn();
  const next = await it.next();
  if (next.done) return new Ok(next.value);
  const shortCircuitErr = toShortCircuitErr<E>(next.value, 'resultDoAsync');
  await it.return(undefined as never);
  return new Err(shortCircuitErr.error);
}

/**
 * Like `resultDoAsync`, but catches thrown exceptions and wraps them in Err.
 * Use when the generator body calls throwing APIs (e.g. database, network).
 * Use the same `yield* await somePromiseResult` unwrapping style as `resultDoAsync`, not streaming `yield ok(...)`.
 *
 * @example
 * ```ts
 * // With catch message — wraps in new Error(message, { cause })
 * async findById(id: number): Promise<Result<Account, Error>> {
 *   return resultTryAsync(async function* (self) {
 *     const row = await self.db.selectFrom('accounts').where('id', '=', id).executeTakeFirst();
 *     if (!row) yield* err('Not found');
 *     return yield* toAccount(row!);
 *   }, this, 'Failed to find account by ID');
 * }
 *
 * // With catch factory — full control over error type
 * return resultTryAsync(async function* (self) {
 *   yield* await self.deleteRows(ids);
 * }, this, (cause) => new DatabaseError('Delete failed', { cause }));
 *
 * // Without ctx
 * return resultTryAsync(async function* () {
 *   const data = await fetchData();
 *   return yield* parseData(data);
 * }, 'Fetch failed');
 * ```
 */
export async function resultTryAsync<T>(
  fn: () => AsyncGenerator<Err<never, Error>, T>,
  catchMessage: string
): Promise<Result<T, Error>>;
export async function resultTryAsync<T, E>(
  fn: () => AsyncGenerator<Err<never, E>, T>,
  catchError: (cause: unknown) => E
): Promise<Result<T, E>>;
export async function resultTryAsync<T, Ctx>(
  fn: (ctx: Ctx) => AsyncGenerator<Err<never, Error>, T>,
  ctx: Ctx,
  catchMessage: string
): Promise<Result<T, Error>>;
export async function resultTryAsync<T, E, Ctx>(
  fn: (ctx: Ctx) => AsyncGenerator<Err<never, E>, T>,
  ctx: Ctx,
  catchError: (cause: unknown) => E
): Promise<Result<T, E>>;
export async function resultTryAsync<T, E>(
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
    const shortCircuitErr = toShortCircuitErr<E>(next.value, 'resultTryAsync');
    await it.return(undefined as never);
    return new Err(shortCircuitErr.error);
  } catch (error) {
    if (typeof catcher === 'string') {
      return err<T>(catcher, error) as Result<T, E>;
    }
    return new Err(catcher(error));
  }
}
