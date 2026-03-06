# Result Type (`@exitbook/core`)

Custom `Result<T, E>` — not neverthrow. Located in `packages/core/src/result/`.

## Construction

```typescript
import { ok, err, type Result } from '@exitbook/core';

const success = ok(42); // Result<number, never>
const failure = err('not found'); // Result<never, Error> — string auto-wrapped in Error
const withCause = err('failed', originalError); // Error with { cause }
const typed = err(new CustomError()); // Result<never, CustomError>
```

## Narrowing

Use `isOk()` / `isErr()`, then access `.value` or `.error` directly:

```typescript
if (result.isOk()) {
  result.value; // T
} else {
  result.error; // E
}
```

## Composition with `resultFrom` (sync)

Generator + `yield*` to unwrap Results. Short-circuits on first Err:

```typescript
function process(raw: string): Result<Order, Error> {
  return resultFrom(function* () {
    const input = yield* parseInput(raw); // unwraps Result
    const validated = yield* validateOrder(input);
    return buildOrder(validated); // auto-wrapped in Ok
  });
}
```

## Composition with `resultFromAsync` (async)

Same pattern, use `yield* await` for async operations:

```typescript
async function deleteForAccounts(tx: Transaction, ids: string[]): Promise<Result<void, Error>> {
  return resultFromAsync(async function* () {
    yield* await tx.links.deleteByAccountIds(ids);
    yield* await tx.transactions.deleteByAccountIds(ids);
  });
}
```

## Catching variants

`resultFromCatching` / `resultFromAsyncCatching` — same as above but catches thrown exceptions and wraps them in Err. Use when calling throwing APIs (database, network):

```typescript
// With catch message — wraps in new Error(message, { cause })
async findById(id: number): Promise<Result<Account, Error>> {
  return resultFromAsyncCatching(async function* (self) {
    const row = await self.db.selectFrom('accounts').where('id', '=', id).executeTakeFirst();
    if (!row) yield* err('Not found');
    return yield* toAccount(row!);
  }, this, 'Failed to find account by ID');
}

// With catch factory — full control over error type
return resultFromAsyncCatching(async function* (self) {
  yield* await self.deleteRows(ids);
}, this, (cause) => new DatabaseError('Delete failed', { cause }));
```

The `ctx` parameter (e.g. `this`) is passed as second arg, before the catch handler. This avoids arrow function or `.bind()` for class methods.

## Rules

- All fallible functions return `Result<T, Error>` — no throws
- Use `resultFrom` / `resultFromAsync` for composition — not `.andThen()` chaining
- Do NOT use `resultFrom` for `AsyncIterableIterator` generators that yield multiple Results over time
- Prefer `.value` / `.error` with narrowing in new code
- Compat shims exist (`_unsafeUnwrap`, `_unsafeUnwrapErr`, `unwrapOr`) — migration only, do not use in new code
