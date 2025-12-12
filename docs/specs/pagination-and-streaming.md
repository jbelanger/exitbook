# Pagination and Streaming

This document specifies the pagination, cursor, streaming, and failover behavior used across Exitbook ingestion. **Code is law**: this spec describes the current implementation (not an aspirational design).

## Goals

- **Memory-bounded imports**: process large histories incrementally (batch-by-batch).
- **Crash recovery**: resume without restarting from zero.
- **Mid-stream failover**: when a provider fails, continue with the next compatible provider.
- **Safe overlap**: use replay windows + deduplication to avoid gaps across failover/resume.
- **Consistent error handling**: streaming yields `Result` values (neverthrow), not thrown exceptions.

## Terminology

- **Streaming operation**: returns many batches (e.g. blockchain address transactions).
- **One-shot operation**: returns exactly one batch (e.g. balance, token metadata).
- **Batch**: a unit of work yielded by a streaming iterator and persisted immediately.
- **Cursor**: the persisted pagination checkpoint for one operation type.
- **Cursor map**: `Record<operationType, CursorState>` stored on the `Account` for resumability.

## Cursor model

Cursor types are a discriminated union. Current runtime schema is defined by `packages/core/src/schemas/cursor.ts`.

### CursorType

Current supported `CursorType` values:

- `blockNumber` — cross-provider compatible where block heights exist
- `timestamp` — cross-provider compatible where timestamps exist (milliseconds since epoch)
- `txHash` — chain-specific transaction identifier (e.g. Bitcoin-style)
- `slot` — chain-specific slot cursor (e.g. Solana-style)
- `signature` — chain-specific signature cursor (e.g. Solana-style)
- `pageToken` — provider-locked opaque token; requires `providerName`

### PaginationCursor

```ts
type PaginationCursor =
  | { type: 'blockNumber'; value: number }
  | { type: 'timestamp'; value: number }
  | { type: 'txHash'; value: string }
  | { type: 'slot'; value: number }
  | { type: 'signature'; value: string }
  | { type: 'pageToken'; value: string; providerName: string };
```

### CursorState

```ts
interface CursorState {
  primary: PaginationCursor;
  alternatives?: PaginationCursor[];
  lastTransactionId: string;
  totalFetched: number;
  metadata?: {
    providerName: string;
    updatedAt: number;
    isComplete?: boolean;
    // NOTE: passthrough, provider/exchange-specific fields allowed
    [k: string]: unknown;
  };
}
```

#### Semantics

- `primary` is what the producer expects to use for same-producer resumption (when possible).
- `alternatives` should include _all_ extractable cursors from the last yielded transaction to maximize cross-provider failover options.
- `lastTransactionId` is used for deduplication windows (both provider-side and manager-side).
- `totalFetched` is cumulative for that operation type, across batches (including resumption).
- `metadata.isComplete` is the authoritative “done” signal for that operation type.
- `metadata.providerName` is relied upon to detect cross-provider failover; producers should always set it.
- `metadata` is `passthrough`: providers/exchanges may attach small additional fields (e.g. exchange offsets). Providers using the shared streaming adapter namespace custom state under `metadata.custom`.

## Persistence: where cursors live

### Cursor storage

Cursors are persisted on the **Account** as a JSON cursor map:

- Table: `accounts.last_cursor`
- Shape: `Record<string, CursorState>` (operation-type → cursor)
- Validation: `AccountRepository.update()` validates with `z.record(z.string(), CursorStateSchema)` before writing.

`import_sessions` track execution status and counts, but **do not store cursors**.

### Operation types (cursor map keys)

The cursor map key is an importer/client concern. Examples in current code:

- EVM importer: `normal`, `internal`, `token`
- Bitcoin importer: `normal`
- Kraken API importer: `ledger`

The ingestion layer is responsible for mapping its operation types to provider manager operation types (e.g. `normal` → `getAddressTransactions`).

## Streaming contract (shared across sources)

All streaming surfaces follow the same shape:

- Yield `Result<Batch, Error>` (neverthrow).
- **Do not throw** to signal expected failures. If a throw happens anyway, higher layers catch and wrap it as an error batch.
- Yield multiple batches, each independently persistable.
- Always provide a `CursorState` for the batch, including a completion signal via `cursor.metadata.isComplete` when finished.

### Ingestion layer (`IImporter`)

Importers implement:

```ts
importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>>
```

and yield `ImportBatchResult` values with:

- `rawTransactions`: batch items to persist
- `operationType`: cursor-map key used for persistence
- `cursor`: checkpoint for this operation type
- `isComplete`: derived from `cursor.metadata?.isComplete ?? false`

### TransactionImportService behavior

`TransactionImportService.executeStreamingImport()` implements the “imperative shell”:

1. Streams batches from the importer.
2. Persists each batch via `RawDataRepository.saveBatch()` (duplicates are skipped by DB constraints).
3. Updates `accounts.last_cursor[operationType]` after **each** batch for crash recovery.
   - Cursor update failures are logged as warnings and do **not** fail the import.
4. Tracks totals in `import_sessions` and finalizes the session on completion.

## Blockchain providers: streaming + failover

### Provider streaming interface

Blockchain providers implement:

```ts
executeStreaming<T>(
  operation: ProviderOperation,
  cursor?: CursorState
): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>>
```

Providers also declare cursor support via `ProviderCapabilities.supportedCursorTypes` and choose a preferred cursor type via `preferredCursorType`. If a cursor is present and a provider does not declare compatible cursor support, the provider manager will skip it during resumption.

### Shared streaming adapter (provider-side)

Many providers use the shared streaming adapter (`createStreamingIterator` / `BaseApiClient.streamWithPagination`) which owns:

- The pagination loop (`fetchPage` with a `StreamingPageContext`)
- Per-provider batch mapping (`mapItem`)
- Cursor-state construction (`buildCursorState`)
- Provider-local deduplication window (default size: 500; seeded with `resumeCursor.lastTransactionId` when present)
- “Empty completion batch” behavior when the terminal page contains only duplicates

Key cursor construction behavior (`buildCursorState`):

- If the provider returns a `pageToken`, `cursor.primary` becomes `{ type: 'pageToken', value, providerName }`.
- Otherwise, `cursor.primary` prefers an extracted `blockNumber` cursor, or falls back to `{ type: 'blockNumber', value: 0 }`.
- `cursor.alternatives` is set to all extracted cursors from the last transaction in the yielded batch.
- Completion is surfaced via `cursor.metadata.isComplete`.
- Provider-specific state is namespaced under `cursor.metadata.custom`.

Providers may also yield a “synthetic completion cursor” (e.g. when an operation is conceptually complete but yields no data). This is a valid completion signal and should be treated as success.

### Provider manager (`BlockchainProviderManager.executeWithFailover`)

The provider manager exposes a unified iterator API for **both** streaming and one-shot operations:

- Streaming operations yield multiple batches.
- One-shot operations yield exactly one batch (wrapped to match the streaming shape).

Current streaming operations are:

- `getAddressTransactions`
- `getAddressInternalTransactions`
- `getAddressTokenTransactions`

#### Failover loop

For streaming operations, the manager:

1. Selects providers that support the operation type and are not blocked by circuit breakers.
2. If resuming:
   - Skips providers that cannot resume from the stored cursor type (see “Cursor compatibility”).
   - Distinguishes **same-provider resume** vs **cross-provider failover** using `cursor.metadata.providerName`.
3. Runs `provider.executeStreaming(operation, adjustedCursor)` and yields its batches, with manager-local deduplication applied.
4. On batch errors (`Result.isErr()`), records failures, advances to the next provider, and continues from the last successful cursor.
5. On unexpected thrown errors, wraps them as an error and may fail over; if all providers fail, yields a terminal error.

#### Cursor compatibility

Compatibility checks are performed against `ProviderCapabilities.supportedCursorTypes`:

- If the cursor type is `pageToken`, it is only compatible with the same provider name.
- Otherwise, any matching cursor type in `cursor.primary` or `cursor.alternatives` is considered compatible.

#### Cursor resolution and replay windows (manager-side)

The manager resolves cursors to practical resume parameters using this priority order:

1. `pageToken` **only** when it is from the same provider.
2. `blockNumber` from `primary`, or from `alternatives`.
3. `timestamp` from `primary`, or from `alternatives`.

Replay windows (via `provider.applyReplayWindow`) are applied **only** during cross-provider failover (not during same-provider resume) for `blockNumber` / `timestamp` resolution.

Cursor types outside `{pageToken, blockNumber, timestamp}` are passed through without manager-level replay-window adjustments.

#### Deduplication (manager-side)

The manager applies a deduplication window across yielded batches (window size: 1000) to absorb overlap introduced by replay windows and by provider-specific pagination quirks.

When resuming, the manager currently seeds the dedup window with `resumeCursor.lastTransactionId` (and does not yet load a larger window from storage).

Important invariant: completion must not be lost.

- If a batch deduplicates down to zero items but the cursor marks completion, the manager still yields the completion batch so ingestion can finalize the operation.

## Exchange providers: streaming + pagination

Exchange clients can expose streaming via:

```ts
fetchTransactionDataStreaming(params?: { cursor?: Record<string, CursorState> })
  : AsyncIterableIterator<Result<FetchBatchResult, Error>>
```

Exchange pagination is client-specific, but shares the same **cursor map** persistence mechanism:

- The exchange client reads and updates `params.cursor[operationType]`.
- The exchange client may store additional pagination state in `cursor.metadata` (e.g. offsets).
- Completion can be signaled with an empty batch where `cursor.metadata.isComplete === true`.

Example: Kraken’s API pagination uses:

- `cursor.primary` as a `timestamp` (the “since” boundary)
- `cursor.metadata.offset` as the pagination offset (`ofs`)
- An explicit empty completion batch when there is no more data

## Non-goals and constraints

- Cursors are optimized for **resumability and correctness**, not for perfect cross-provider portability. Provider-locked cursor types (e.g. `pageToken`) require same-provider resumption.
- Cursor metadata is intentionally extensible; do not assume it contains only the core fields.
