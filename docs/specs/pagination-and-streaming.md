---
last_verified: 2025-12-12
status: canonical
---

# Pagination & Streaming Specification

> ⚠️ **Code is law**: If this document disagrees with implementation, update the spec to match code.

Defines how Exitbook streams paginated data, persists cursors for crash recovery, and fails over between providers while maintaining deduplication and completion guarantees.

## Quick Reference

| Concept                | Key Rule                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Cursor storage         | Stored per `operationType` in `accounts.last_cursor` and merged, not replaced             |
| Completion signal      | `cursor.metadata.isComplete` is authoritative for “done”, even with empty/duplicate batch |
| Resume priority        | Same-provider `pageToken` → `blockNumber` → `timestamp`; others passed through            |
| Failover replay window | Applied only on cross-provider resume for `blockNumber` / `timestamp`                     |
| Dedup windows          | Provider adapter ~500; manager 1000 seeded with `lastTransactionId`                       |
| Dedup seeding          | Manager dedup window is seeded only by `lastTransactionId` (no wider persisted window)    |

## Goals

- **Memory-bounded imports**: Stream large histories batch-by-batch with immediate persistence.
- **Resumability & failover**: Restart from last cursor and continue with next compatible provider on errors.
- **Overlap-safe correctness**: Combine replay windows and deduplication to avoid gaps while preventing duplicates.

## Non-Goals

- Transaction normalization, pricing, or accounting semantics.
- Perfect cursor portability across unrelated providers (provider-locked cursors allowed).

## Definitions

### Pagination Cursor

```ts
type PaginationCursor =
  | { type: 'blockNumber'; value: number }
  | { type: 'timestamp'; value: number } // ms since epoch
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
    // Provider/exchange-specific passthrough
    [k: string]: unknown;
  };
}
```

- `primary`: resume hint for the same provider when possible.
- `alternatives`: all extractable cursors from the last yielded transaction for cross-provider options.
- `lastTransactionId`: seeds dedup windows.
- `totalFetched`: cumulative batches fetched for this operation type.
- `metadata.providerName`: used to decide same-provider resume vs cross-provider failover.

### Cursor Map (per Account)

`Record<string, CursorState>` keyed by importer-defined `operationType` (e.g., `normal`, `internal`, `token`, `ledger`). Persisted on `accounts.last_cursor`; validated in `AccountRepository.update()`.

## Behavioral Rules

### Streaming Contract (all sources)

- Iterators yield `Result<Batch, Error>` (neverthrow) and must not throw for expected failures.
- Each batch includes `operationType`, `cursor`, `rawTransactions` (or provider-specific items), and `isComplete = cursor.metadata?.isComplete ?? false`.
- Batches are independently persistable; ingestion updates cursor storage **after every batch** for crash recovery. Cursor update failures log `warn` and import continues.
- Completion must propagate even if the batch contains only duplicates or is synthetically empty.

### Ingestion Layer (`IImporter`)

- `importStreaming(params): AsyncIterableIterator<Result<ImportBatchResult, Error>>`.
- Deduplication of `raw_transactions` happens in DB via unique indexes; collisions count as skipped, not fatal.
- Session totals updated per batch; sessions finalize on completion or terminal error.

### Blockchain Providers

- Interface: `executeStreaming<T>(operation, cursor?)`.
- Providers declare `supportedCursorTypes` and `preferredCursorType`; manager skips incompatible providers during resume.
- Shared adapter (`createStreamingIterator` / `BaseApiClient.streamWithPagination`) handles:
  - Pagination loop (`fetchPage` with `StreamingPageContext`).
  - Mapping items → batches and building `CursorState`.
  - Provider-local dedup window (default ~500, seeded with `resumeCursor.lastTransactionId`).
  - Empty completion batch emission when the terminal page only duplicates.
- Cursor construction in adapter:
  - If API returns `pageToken`, `cursor.primary = { type: 'pageToken', value, providerName }`.
  - Else prefer extracted `blockNumber`; fallback `{ type: 'blockNumber', value: 0 }` if none.
  - `alternatives` = all extracted cursors from the last transaction.
  - Provider-specific state under `cursor.metadata.custom`.

### Provider Manager (`executeWithFailover`)

| Condition                              | Behavior                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| Resuming with `pageToken`              | Only same `providerName` is eligible; others skipped.                              |
| Resuming with block/timestamp cursor   | Any provider declaring the cursor type is eligible.                                |
| Cross-provider failover                | Apply replay window before issuing requests; manager dedup window absorbs overlap. |
| Batch error (`Result.isErr()`)         | Record failure, advance to next provider, resume from last successful cursor.      |
| Unexpected throw                       | Wrapped as error batch; if all providers fail, terminal error yielded.             |
| Dedup leaves zero items but completion | Still yield batch so ingestion can finalize the operation.                         |

Cursor resolution priority: same-provider `pageToken` → `blockNumber` (`primary` then `alternatives`) → `timestamp` (`primary` then `alternatives`). Example: resuming an Alchemy stream with a stored `pageToken` created by Infura will skip that token and fall back to the last `blockNumber` in `alternatives`. Other cursor types pass through without replay-window adjustment.

Manager dedup window size: 1000; seeded with `resumeCursor.lastTransactionId` (no wider persisted window yet).

### Exchange Providers

- Streaming API: `fetchTransactionDataStreaming({ cursor? })`.
- Uses the same account cursor map; exchange client reads/writes `cursor[operationType]`.
- Completion may be signaled via empty batch with `cursor.metadata.isComplete === true`.
- Example (Kraken API): `cursor.primary` is `timestamp` boundary; `cursor.metadata.offset` tracks `ofs`; emits explicit empty completion batch.

## Data Model

### Cursor Storage on Accounts

```sql
accounts.last_cursor TEXT NULL -- JSON Record<operationType, CursorState>
```

- Merged per `operationType`; existing keys preserved unless overwritten explicitly for that key.
- Validated with `CursorStateSchema` (`packages/core/src/schemas/cursor.ts`) before write.

### Batch Shape (Streaming)

```ts
type ImportBatchResult = {
  operationType: string;
  rawTransactions: RawTransactionInput[];
  cursor: CursorState;
  isComplete: boolean;
};
```

Provider-level `StreamingBatchResult<T>` mirrors this shape with provider-specific payloads in place of `rawTransactions`.

## Pipeline / Flow

```mermaid
graph TD
    A[Importer/Provider iterator] --> B[Batch emitted (Result)]
    B --> C[Persist raw_transactions / provider data]
    C --> D[Update accounts.last_cursor[operationType]]
    D --> E[Manager dedup window]
    E --> F{Next batch?}
    F -->|yes| A
    B -->|Result.err| H[Record failure, try next provider]
    H --> A
    H -->|all providers failed| I[Terminal error, finalize session]
    F -->|complete| G[Finalize import session]
```

## Invariants

- **Completion preserved**: Completion signal must survive deduplication and empty batches.
- **Cursor merge**: Updates merge per `operationType`; no wholesale replacement of the cursor map.
- **No thrown control flow**: Expected failures surface as `Result.err`, not exceptions.
- **Failover continuity**: Replay window + dedup window ensures resumed stream cannot skip data.

## Edge Cases & Gotchas

- Cursor update failure logs `warn` and continues; next run may re-fetch overlap.
- Provider-locked cursors (`pageToken`) are unusable across providers; failover will skip them.
- Synthetic completion cursors (no data ever returned) are valid and must finalize imports.
- Manager dedup window seeded only by `lastTransactionId`; wider persisted windows not yet implemented.

## Known Limitations (Current Implementation)

- No persisted dedup window beyond `lastTransactionId`; heavy overlaps rely on in-memory window only.
- Replay windows applied only for `blockNumber`/`timestamp`; other cursor types rely on provider behavior.
- Provider compatibility check ignores `alternatives` ordering beyond type match (no numeric comparison).

## Related Specs

- [Accounts & Imports](./accounts-and-imports.md) — cursor storage, import sessions
- [Fee Semantics](./fees.md) — how streamed raw transactions feed fee handling

---

_Last updated: 2025-12-12_
