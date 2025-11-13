# ADR 006: Streaming Pagination with Typed Cursors for Cross-Provider Failover

**Date**: 2025-01-12
**Status**: Accepted
**Deciders**: Joel Belanger (maintainer)
**Tags**: pagination, cursors, failover, streaming, blockchain-providers, resilience

---

## Context and Problem Statement

The blockchain provider system has critical pagination issues that prevent reliable, resumable, and efficient data imports:

### Problem 1: Non-Parallelizable Internal Pagination

All blockchain providers implement internal pagination loops that accumulate results before returning:

```typescript
// alchemy.api-client.ts (lines 254-279)
private async getAssetTransfersPaginated(...): Promise<AlchemyAssetTransfer[]> {
  const transfers: AlchemyAssetTransfer[] = [];
  let pageKey: string | undefined;

  do {
    const response = await this.httpClient.post(...);
    transfers.push(...response.result?.transfers || []); // ❌ Accumulate in memory
    pageKey = response.result?.pageKey;
  } while (pageKey && pageCount < maxPages);

  return transfers; // ❌ Return all at once
}
```

**Impact**:

- Single provider handles all 10,000+ transactions sequentially
- Cannot parallelize across multiple providers
- Cannot switch providers mid-pagination

### Problem 2: No Resumability

Blockchain providers don't return cursor information with transactions:

```typescript
// evm/importer.ts (lines 129-136)
return transactionsWithRaw.map((txWithRaw) => ({
  providerName,
  externalId: generateUniqueTransactionId(txWithRaw.normalized),
  transactionTypeHint: 'normal',
  sourceAddress: address,
  normalizedData: txWithRaw.normalized,
  rawData: txWithRaw.raw,
  // ❌ cursor field is missing!
}));
```

**Impact**:

- Provider fails on page 50/100 → restart from page 1
- No progress tracking between pages
- Lost work on crashes or errors

### Problem 3: Memory Bloat

All results accumulated in memory before returning:

```typescript
// moralis.api-client.ts (lines 211-255)
const rawTransactions: MoralisTransaction[] = [];
do {
  // ... fetch page ...
  rawTransactions.push(...pageTransactions); // ❌ Unbounded accumulation
} while (cursor);
return ok(transactions); // ❌ Return 50,000+ transactions at once
```

**Impact**:

- Loading 50,000 transactions into memory before processing
- OOM crashes on large wallets
- Poor performance characteristics

### Problem 4: No Mid-Pagination Failover

Provider manager's `executeWithFailover()` expects a single result:

```typescript
// provider-manager.ts (lines 354-453)
private async executeWithCircuitBreaker<T>(...): Promise<Result<T, Error>> {
  for (const provider of providers) {
    const result = await provider.execute<T>(operation); // ❌ All-or-nothing
    if (result.isOk()) return result;
  }
}
```

**Impact**:

- Cannot switch providers mid-import
- Single provider failure = complete restart
- No fault tolerance during long-running imports

### Problem 5: Architectural Inconsistency

Exchange providers (Kraken, KuCoin) already solve this correctly:

**Exchange providers** ✅:

- Return cursors per-transaction in `ExternalTransaction.cursor`
- Store progress in `external_transaction_data.cursor` field (database-schema.ts:60)
- Support resumability via `FetchParams.cursor` (types.ts:7-9)
- Handle partial failures via `PartialImportError`

**Blockchain providers** ❌:

- No cursor in results
- Internal pagination loops
- No resumability
- All-or-nothing execution

This architectural mismatch creates maintenance burden and user confusion.

---

## Decision

We will refactor blockchain providers to use **streaming pagination with typed cursors**, aligning them with the exchange provider pattern.

### Core Principles

1. **Streaming over accumulation**: Yield results incrementally via AsyncIterator
2. **Typed cursors**: Discriminated union with explicit cursor types for cross-provider compatibility
3. **Multiple cursor types**: Extract all available cursor types (blockNumber, timestamp, txHash) per transaction
4. **Provider capabilities**: Declare supported cursor types and replay windows
5. **Mid-pagination failover**: Provider manager can switch providers at any cursor point
6. **Replay windows**: Overlap with previous provider's data to prevent gaps
7. **Deduplication**: Set-based dedup handles replay overlaps

### Cursor Type System

```typescript
/**
 * Cursor type classification for cross-provider compatibility
 */
export type CursorType =
  | 'blockNumber' // EVM, Substrate - block-based pagination (cross-provider)
  | 'timestamp' // Bitcoin, Solana, NEAR - Unix timestamp (cross-provider)
  | 'txHash' // Bitcoin - txid-based chaining (cross-provider within same chain)
  | 'pageToken'; // Opaque tokens - provider-locked (Alchemy pageKey, Moralis cursor)

/**
 * Typed pagination cursors with semantic compatibility
 */
export type PaginationCursor =
  | { type: 'blockNumber'; value: number } // Cross-provider compatible
  | { type: 'timestamp'; value: number } // Cross-provider compatible (ms since epoch)
  | { type: 'txHash'; value: string } // Cross-provider compatible (same chain)
  | { type: 'pageToken'; value: string; providerName: string }; // Provider-locked

/**
 * Complete cursor state for a pagination point
 */
export interface CursorState {
  /**
   * Primary cursor for this provider (used for same-provider resumption)
   */
  primary: PaginationCursor;

  /**
   * Alternative cursors for cross-provider failover
   * Example: EVM transaction has both blockNumber AND timestamp
   */
  alternatives?: PaginationCursor[];

  /**
   * Last transaction ID for deduplication after replay window
   */
  lastTransactionId: string;

  /**
   * Total transactions fetched (for progress tracking)
   */
  totalFetched: number;

  /**
   * Metadata
   */
  metadata?: {
    providerName: string;
    updatedAt: number;
    isComplete?: boolean;
  };
}
```

### Provider Capabilities

```typescript
export interface ProviderCapabilities {
  /**
   * Supported operation types
   */
  supportedOperations: ProviderOperationType[];

  /**
   * Cursor types this provider can accept for resumption
   * Enables cross-provider failover
   */
  supportedCursorTypes: CursorType[];

  /**
   * Preferred cursor type for this provider (most efficient)
   */
  preferredCursorType: CursorType;

  /**
   * Replay window applied when failing over FROM a different provider
   * Prevents off-by-one gaps; duplicates absorbed by dedup keys
   */
  replayWindow?: {
    blocks?: number; // For blockNumber cursors (EVM, Substrate)
    minutes?: number; // For timestamp cursors (Bitcoin, Solana)
    transactions?: number; // For txHash cursors (Bitcoin UTXO chaining)
  };
}
```

### Provider Interface

```typescript
export interface IBlockchainProvider {
  readonly name: string;
  readonly blockchain: string;
  readonly capabilities: ProviderCapabilities;

  /**
   * Execute operation with streaming pagination
   */
  executeStreaming<T>(
    operation: ProviderOperation,
    cursor?: CursorState
  ): AsyncIterableIterator<{
    data: TransactionWithRawData<T>[];
    cursor: CursorState;
  }>;

  /**
   * Extract all available cursor types from a transaction
   */
  extractCursors(transaction: Transaction): PaginationCursor[];

  /**
   * Apply replay window to a cursor for safe failover
   */
  applyReplayWindow(cursor: PaginationCursor): PaginationCursor;
}
```

### Provider Manager Failover

```typescript
async *executeWithFailoverStreaming<T>(
  blockchain: string,
  operation: ProviderOperation,
  resumeCursor?: CursorState
): AsyncIterableIterator<FailoverExecutionResult<T>> {
  const providers = this.getProvidersInOrder(blockchain, operation);
  let currentCursor = resumeCursor;
  let providerIndex = 0;
  const deduplicationSet = new Set<string>();

  while (providerIndex < providers.length) {
    const provider = providers[providerIndex];

    // Check cursor compatibility
    if (currentCursor && !this.canProviderResume(provider, currentCursor)) {
      providerIndex++;
      continue;
    }

    try {
      const iterator = provider.executeStreaming(operation, currentCursor);

      for await (const batch of iterator) {
        // Deduplicate after replay window
        const deduplicated = batch.data.filter(tx =>
          !deduplicationSet.has(tx.normalized.id)
        );
        deduplicated.forEach(tx => deduplicationSet.add(tx.normalized.id));

        if (deduplicated.length > 0) {
          yield { data: deduplicated, providerName: provider.name, cursor: batch.cursor };
        }

        currentCursor = batch.cursor;
      }

      return; // Success

    } catch (error) {
      logger.error(`Provider ${provider.name} failed: ${error.message}`);
      providerIndex++; // Failover to next provider
    }
  }
}
```

### Importer Updates

```typescript
// evm/importer.ts
async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
  const iterator = await this.providerManager.executeWithFailoverStreaming(
    this.chainConfig.chainName,
    { type: 'getAddressTransactions', address: params.address }
  );

  const allTransactions: ExternalTransaction[] = [];

  for await (const batch of iterator) {
    const transactions = batch.data.map((txWithRaw) => ({
      providerName: batch.providerName,
      externalId: generateUniqueTransactionId(txWithRaw.normalized),
      transactionTypeHint: 'normal',
      sourceAddress: params.address,
      normalizedData: txWithRaw.normalized,
      rawData: txWithRaw.raw,
      cursor: batch.cursor, // ✅ Include cursor!
    }));

    allTransactions.push(...transactions);
    // Ingestion service can save progress here
  }

  return ok({ rawTransactions: allTransactions });
}
```

---

## Consequences

### Benefits

✅ **Resumability**: Crash on page 80/100? Resume from page 80 using stored cursor
✅ **Mid-pagination failover**: Provider fails? Switch to backup provider at current cursor
✅ **Memory bounded**: Process batches of 100-1000 transactions, not entire dataset
✅ **Progress tracking**: Save after each batch, show real-time progress to users
✅ **Parallelization possible**: Future optimization to distribute page ranges across providers
✅ **Architectural consistency**: Blockchain providers align with exchange provider pattern
✅ **Cross-provider compatibility**: Typed cursors enable failover between different providers
✅ **Type safety**: Discriminated unions provide excellent TypeScript support
✅ **Existing schema support**: Uses `external_transaction_data.cursor` field (already exists)

### Drawbacks

⚠️ **Breaking changes**: Requires refactoring all blockchain provider API clients
⚠️ **Complexity**: AsyncIterators add architectural complexity
⚠️ **Testing burden**: Need comprehensive tests for failover, resumability, deduplication scenarios
⚠️ **Migration effort**: Phased rollout required to minimize disruption

### Provider Capability Matrix

| Provider        | Preferred | Supported Types                   | Replay Window   |
| --------------- | --------- | --------------------------------- | --------------- |
| **Alchemy**     | pageToken | pageToken, blockNumber, timestamp | 5 blocks        |
| **Moralis**     | pageToken | pageToken, timestamp              | 5 minutes       |
| **Subscan**     | timestamp | timestamp, blockNumber            | 5 minutes       |
| **NearBlocks**  | timestamp | timestamp                         | 5 minutes       |
| **Blockstream** | txHash    | txHash, timestamp                 | 10 transactions |

### Cursor Translation Examples

**Scenario 1: Same-provider resumption (optimal)**

```
Alchemy → Alchemy
Cursor: { type: 'pageToken', value: 'xyz', providerName: 'alchemy' }
Action: Use pageToken directly (most efficient)
```

**Scenario 2: Cross-provider failover (with replay)**

```
Alchemy (failed at block 15000000) → Moralis
Cursor: { type: 'blockNumber', value: 15000000 }
Replay: 15000000 - 5 = 14999995
Action: Moralis starts from block 14999995, deduplicates overlapping transactions
```

**Scenario 3: Incompatible cursor (fallback)**

```
Alchemy pageToken → Subscan
Cursor: { type: 'pageToken', value: 'xyz', providerName: 'alchemy' }
Fallback: Use alternative cursor { type: 'timestamp', value: 1640000000 }
Action: Subscan resumes from timestamp
```

---

## Implementation Strategy

### Phase 1: Foundation (Week 1)

- Add cursor types to `@exitbook/blockchain-providers/core/types`
- Add `ProviderCapabilities` with `supportedCursorTypes` and `replayWindow`
- Create `IBlockchainProvider.executeStreaming()` interface
- Update one provider (Alchemy) as proof-of-concept
- Write comprehensive unit tests

### Phase 2: Provider Manager (Week 2)

- Implement `executeWithFailoverStreaming()` in `ProviderManager`
- Add `canProviderResume()` and `selectBestCursorType()` logic
- Implement deduplication with Set-based tracking
- Add cursor compatibility checking
- Integration tests for failover scenarios

### Phase 3: Importer Updates (Week 3)

- Update EVM importer to use streaming API
- Modify ingestion service to save progress after each batch
- Add resume-from-cursor support in import command
- Test resumability with cursor persistence

### Phase 4: Provider Migration (Weeks 4-6)

- Convert Moralis to streaming (Week 4)
- Convert Subscan to streaming (Week 5)
- Convert NearBlocks, Blockstream, others (Week 6)
- Remove old `execute()` methods
- Update all importers to streaming pattern

### Phase 5: Optimization (Week 7)

- Add batch size tuning based on provider capabilities
- Implement parallel pagination across providers (future)
- Add real-time progress UI
- Performance benchmarking and tuning

---

## Alternatives Considered

### Alternative 1: Quick Fix - Data Source Level Cursor (Rejected)

Store single cursor at `data_sources` table level instead of per-transaction.

**Why rejected**:

- Still no mid-pagination failover
- Still accumulates all results in memory
- Doesn't solve parallelization
- Inconsistent with exchange provider pattern
- Creates technical debt

### Alternative 2: Dual Cursor System (Rejected)

Separate `UniversalCursor` and `ProviderCursor` objects instead of discriminated union.

**Why rejected**:

- More complex type system
- Harder to serialize/deserialize
- Less type-safe than discriminated unions
- The single `CursorState` with primary/alternatives is cleaner

### Alternative 3: Callback-Based Streaming (Considered)

Use callbacks instead of AsyncIterator:

```typescript
export interface StreamingCallback<T> {
  onBatch(batch: T[], cursor: PaginationCursor): Promise<void>;
  onComplete(): Promise<void>;
  onError(error: Error, cursor?: PaginationCursor): Promise<void>;
}
```

**Why not chosen**:

- AsyncIterator is more idiomatic in modern TypeScript
- Better composability with for-await-of loops
- Standard pattern in Node.js ecosystem
- Could still add as alternative API if needed

---

## References

- Database schema: `packages/data/src/schema/database-schema.ts` (line 60: `cursor` field)
- Exchange providers: `packages/exchange-providers/src/exchanges/kraken/client.ts` (lines 124-127)
- Current pagination: `packages/blockchain-providers/src/blockchains/evm/providers/alchemy/alchemy.api-client.ts` (lines 254-279)
- Provider manager: `packages/blockchain-providers/src/core/provider-manager.ts` (lines 354-453)
- Importer interface: `packages/ingestion/src/types/importers.ts` (lines 31-38)

---

## Related Decisions

- ADR-003: Unified Price and FX Rate Enrichment Architecture (separation of concerns)
- Future: ADR-007: Parallel Pagination Across Multiple Providers (builds on this foundation)
