# ADR-006 Phase 5: Streaming Abstraction Design Proposal

**Status:** Proposal
**Created:** 2025-01-17
**Purpose:** Design clean abstraction to hide streaming complexity from provider implementations

---

## Problem Statement

The current Moralis streaming implementation (packages/blockchain-providers/src/blockchains/evm/providers/moralis/moralis.api-client.ts:488-740) contains **9 distinct concerns** that must be repeated in every provider:

1. **Cursor Resolution** - Extracting cursor values from `resumeCursor` based on type
2. **Deduplication Setup** - Creating dedup window with size calculations
3. **Pagination Loop Structure** - The `while(true)` loop pattern
4. **HTTP Request Construction** - Building params and making calls
5. **Error Handling & Yielding** - Checking results and yielding errors
6. **Mapping & Validation** - Transforming raw to normalized with error handling
7. **Deduplication Logic** - Calling `deduplicateTransactions`
8. **Empty Batch Completion** - Handling when all txs are deduped but need completion cursor
9. **Cursor State Building** - Building cursor state with metadata

**Impact:**
- ~250 lines of boilerplate per streaming operation
- Complex logic repeated across all providers (Alchemy, Subscan, Helius, NearBlocks, etc.)
- High cognitive load for new provider implementations
- Difficult to maintain consistency across providers
- Violates DRY principle

**Goal:** Reduce provider streaming implementation to **~20-30 lines** of simple, declarative configuration.

---

## Proposed Solution: Template Method Pattern

Add a protected helper method in `BaseApiClient` that encapsulates all common streaming logic:

```typescript
protected async *streamWithPagination<TRaw, TNormalized>(
  config: StreamingPaginationConfig<TRaw, TNormalized>
): AsyncIterableIterator<Result<StreamingBatchResult<TNormalized>, Error>>
```

---

## Design

### 1. Configuration Interface

```typescript
/**
 * Pagination parameters resolved from cursor state
 * Passed to fetchBatch function
 */
export interface PaginationParams {
  /** Page token for provider-specific pagination (most efficient) */
  pageToken?: string | undefined;
  /** Block number for cross-provider resumption */
  fromBlock?: number | undefined;
  /** Timestamp for cross-provider resumption */
  fromTimestamp?: number | undefined;
}

/**
 * Pagination info extracted from API response
 * Tells the streaming engine how to continue
 */
export interface PaginationInfo<TRaw> {
  /** Raw items from this page */
  items: TRaw[];
  /** Whether more pages are available */
  hasMore: boolean;
  /** Token for fetching next page (if hasMore is true) */
  nextPageToken?: string | undefined;
}

/**
 * Configuration for streaming pagination helper
 * Provider implements these 3 simple functions
 */
export interface StreamingPaginationConfig<TRaw, TNormalized> {
  /**
   * Fetch a batch of data from the API
   * Provider implements HTTP call logic here
   *
   * @param params - Resolved pagination parameters (pageToken, fromBlock, fromTimestamp)
   * @returns Result with API response
   *
   * @example
   * ```typescript
   * fetchBatch: async (params) => {
   *   const urlParams = new URLSearchParams({
   *     chain: this.moralisChainId,
   *     limit: '100',
   *     ...(params.pageToken && { cursor: params.pageToken }),
   *     ...(params.fromBlock && { from_block: String(params.fromBlock) }),
   *   });
   *   return this.httpClient.get(
   *     `/${address}?${urlParams.toString()}`,
   *     { schema: MoralisTransactionResponseSchema }
   *   );
   * }
   * ```
   */
  fetchBatch: (params: PaginationParams) => Promise<Result<unknown, Error>>;

  /**
   * Extract pagination info from API response
   * Provider tells the engine how to parse the response
   *
   * @param response - Raw API response
   * @returns Pagination info (items, hasMore, nextPageToken)
   *
   * @example
   * ```typescript
   * extractPaginationInfo: (response: MoralisTransactionResponse) => ({
   *   items: response.result || [],
   *   hasMore: !!response.cursor,
   *   nextPageToken: response.cursor,
   * })
   * ```
   */
  extractPaginationInfo: (response: unknown) => PaginationInfo<TRaw>;

  /**
   * Map a raw item to normalized transaction
   * Provider uses existing mapper utils here
   *
   * @param raw - Raw item from API
   * @returns Result with normalized transaction
   *
   * @example
   * ```typescript
   * mapItem: (raw: MoralisTransaction) =>
   *   mapMoralisTransaction(raw, {}, this.chainConfig.nativeCurrency)
   * ```
   */
  mapItem: (raw: TRaw) => Result<TNormalized, Error>;

  /**
   * Resume cursor (if resuming from previous import)
   */
  resumeCursor?: CursorState | undefined;

  /**
   * Deduplication window size
   * Default: 500 (suitable for 5-block replay window)
   */
  dedupWindowSize?: number | undefined;

  /**
   * Operation identifier for logging/debugging
   * Example: 'normal', 'internal', 'token'
   */
  operationType?: string | undefined;
}
```

### 2. Base Class Implementation

Add to `packages/blockchain-providers/src/core/base/api-client.ts`:

```typescript
/**
 * Stream data with automatic cursor resolution, deduplication, and error handling
 *
 * This helper encapsulates all common streaming concerns:
 * - Cursor resolution (pageToken, fromBlock, fromTimestamp)
 * - Deduplication window management
 * - Pagination loop orchestration
 * - Empty batch completion signals
 * - Cursor state building
 * - Result wrapping
 *
 * Providers only need to implement 3 simple functions in the config:
 * 1. fetchBatch - How to make the HTTP call
 * 2. extractPaginationInfo - How to parse the response
 * 3. mapItem - How to map raw to normalized (use existing mapper utils)
 *
 * @param config - Streaming pagination configuration
 * @returns AsyncIterator yielding Result-wrapped batches
 */
protected async *streamWithPagination<TRaw, TNormalized extends { id: string }>(
  config: StreamingPaginationConfig<TRaw, TNormalized>
): AsyncIterableIterator<Result<StreamingBatchResult<TNormalized>, Error>> {
  const {
    fetchBatch,
    extractPaginationInfo,
    mapItem,
    resumeCursor,
    dedupWindowSize = 500,
    operationType = 'default',
  } = config;

  // Resolve cursor using existing utility
  const resolvedCursor = resolveCursorForResumption(
    resumeCursor,
    {
      providerName: this.name,
      supportedCursorTypes: this.capabilities.supportedCursorTypes || [],
      isFailover: resumeCursor?.metadata?.providerName !== this.name,
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
    },
    this.logger
  );

  // Initialize deduplication window
  const dedupWindow = createDeduplicationWindow(
    resumeCursor?.lastTransactionId ? [resumeCursor.lastTransactionId] : []
  );

  let totalFetched = resumeCursor?.totalFetched || 0;

  // Pagination loop
  while (true) {
    // Fetch batch
    const batchResult = await fetchBatch(resolvedCursor);

    if (batchResult.isErr()) {
      this.logger.error(
        `Failed to fetch batch for ${operationType} - Error: ${getErrorMessage(batchResult.error)}`
      );
      yield err(batchResult.error);
      return;
    }

    // Extract pagination info
    const paginationInfo = extractPaginationInfo(batchResult.value);
    const { items, hasMore, nextPageToken } = paginationInfo;

    if (items.length === 0) break;

    // Map items
    const mappedBatch: TransactionWithRawData<TNormalized>[] = [];
    for (const rawItem of items) {
      const mapResult = mapItem(rawItem);

      if (mapResult.isErr()) {
        const errorMessage =
          mapResult.error.type === 'error'
            ? mapResult.error.message
            : (mapResult.error as any).reason || mapResult.error.message;
        this.logger.error(
          `Provider data validation failed for ${operationType} - Error: ${errorMessage}`
        );
        yield err(new Error(`Provider data validation failed: ${errorMessage}`));
        return;
      }

      mappedBatch.push({
        raw: rawItem,
        normalized: mapResult.value,
      });
    }

    // Deduplicate
    const dedupedTransactions = deduplicateTransactions(
      mappedBatch,
      dedupWindow,
      dedupWindowSize
    );

    // Handle empty batch after deduplication
    if (dedupedTransactions.length === 0) {
      this.logger.debug(
        `All ${items.length} items in batch were duplicates for ${operationType}, fetching next page`
      );

      // Critical: If this was the last page, must emit completion cursor
      if (!hasMore) {
        const cursorState = buildCursorState({
          transactions: mappedBatch, // Use pre-dedup batch to extract cursor info
          extractCursors: (tx) => this.extractCursors(tx),
          totalFetched,
          providerName: this.name,
          pageToken: undefined,
          isComplete: true,
        });

        yield ok({
          data: [],
          cursor: cursorState,
        });
        break;
      }

      // Update for next iteration
      resolvedCursor.pageToken = nextPageToken;
      continue;
    }

    // Update total count
    totalFetched += dedupedTransactions.length;

    // Build cursor state
    const cursorState = buildCursorState({
      transactions: dedupedTransactions,
      extractCursors: (tx) => this.extractCursors(tx),
      totalFetched,
      providerName: this.name,
      pageToken: nextPageToken,
      isComplete: !hasMore,
    });

    // Yield batch
    yield ok({
      data: dedupedTransactions,
      cursor: cursorState,
    });

    // Check if done
    if (!hasMore) break;

    // Update for next iteration
    resolvedCursor.pageToken = nextPageToken;
  }
}
```

### 3. Provider Implementation Example

**Before (Moralis - 120 lines):**

```typescript
private async *streamAddressTransactions(
  address: string,
  resumeCursor?: CursorState
): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
  let totalFetched = resumeCursor?.totalFetched || 0;
  let cursor = resumeCursor?.primary.type === 'pageToken' && resumeCursor.primary.providerName === this.name
    ? resumeCursor.primary.value
    : undefined;
  const fromBlock = resumeCursor?.primary.type === 'blockNumber' ? String(resumeCursor.primary.value) : undefined;

  const DEDUP_WINDOW_SIZE = 500;
  const dedupWindow = createDeduplicationWindow(
    resumeCursor?.lastTransactionId ? [resumeCursor.lastTransactionId] : []
  );

  while (true) {
    const params = new URLSearchParams({
      chain: this.moralisChainId,
      limit: '100',
    });

    if (cursor) params.append('cursor', cursor);
    if (fromBlock) params.append('from_block', fromBlock);
    params.append('include', 'internal_transactions');

    const endpoint = `/${address}?${params.toString()}`;
    const result = await this.httpClient.get(endpoint, { schema: MoralisTransactionResponseSchema });

    if (result.isErr()) {
      this.logger.error(
        `Failed to fetch address transactions for ${maskAddress(address)} - Error: ${getErrorMessage(result.error)}`
      );
      yield err(result.error);
      return;
    }

    const response = result.value;
    const rawTransactions = response.result || [];

    if (rawTransactions.length === 0) break;

    // Map transactions
    const mappedBatch: TransactionWithRawData<EvmTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = mapMoralisTransaction(rawTx, {}, this.chainConfig.nativeCurrency);

      if (mapResult.isErr()) {
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        this.logger.error(
          `Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`
        );
        yield err(new Error(`Provider data validation failed: ${errorMessage}`));
        return;
      }

      mappedBatch.push({
        raw: rawTx,
        normalized: mapResult.value,
      });
    }

    // Deduplicate using bounded window
    const mappedTransactions = deduplicateTransactions(mappedBatch, dedupWindow, DEDUP_WINDOW_SIZE);

    // If all transactions were deduplicated, check if we still need to emit completion cursor
    if (mappedTransactions.length === 0) {
      this.logger.debug(`All ${rawTransactions.length} transactions in batch were duplicates, fetching next page`);
      cursor = response.cursor || undefined;

      if (!cursor) {
        const cursorState = buildCursorState({
          transactions: mappedBatch,
          extractCursors: (tx) => this.extractCursors(tx),
          totalFetched,
          providerName: this.name,
          pageToken: undefined,
          isComplete: true,
        });

        yield ok({
          data: [],
          cursor: cursorState,
        });
        break;
      }
      continue;
    }

    totalFetched += mappedTransactions.length;

    const cursorState = buildCursorState({
      transactions: mappedTransactions,
      extractCursors: (tx) => this.extractCursors(tx),
      totalFetched,
      providerName: this.name,
      pageToken: response.cursor || undefined,
      isComplete: !response.cursor,
    });

    yield ok({
      data: mappedTransactions,
      cursor: cursorState,
    });

    cursor = response.cursor || undefined;
    if (!cursor) break;
  }
}
```

**After (Moralis - 25 lines):**

```typescript
private async *streamAddressTransactions(
  address: string,
  resumeCursor?: CursorState
): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
  yield* this.streamWithPagination({
    fetchBatch: async (params) => {
      const urlParams = new URLSearchParams({
        chain: this.moralisChainId,
        limit: '100',
        include: 'internal_transactions',
        ...(params.pageToken && { cursor: params.pageToken }),
        ...(params.fromBlock && { from_block: String(params.fromBlock) }),
      });
      return this.httpClient.get(
        `/${address}?${urlParams.toString()}`,
        { schema: MoralisTransactionResponseSchema }
      );
    },
    extractPaginationInfo: (response: MoralisTransactionResponse) => ({
      items: response.result || [],
      hasMore: !!response.cursor,
      nextPageToken: response.cursor,
    }),
    mapItem: (raw) => mapMoralisTransaction(raw, {}, this.chainConfig.nativeCurrency),
    resumeCursor,
    operationType: 'normal',
  });
}
```

**Reduction: 120 lines → 25 lines (79% reduction)**

---

## Benefits

### 1. **Massive Code Reduction**
- **Before:** ~250 lines per streaming operation
- **After:** ~25 lines per streaming operation
- **Savings:** ~90% reduction in boilerplate

### 2. **Single Source of Truth**
- All streaming concerns handled in ONE place (base class)
- Bug fixes benefit ALL providers immediately
- Consistent behavior across all providers

### 3. **Easy to Understand**
- Provider implementations are **declarative** (what, not how)
- Clear separation: HTTP call logic vs streaming orchestration
- New developers can implement providers in minutes

### 4. **Easy to Augment**
- Want to add progress tracking? Update base class once
- Want to add metrics? Update base class once
- Want to change dedup strategy? Update base class once

### 5. **Type Safety**
- Full TypeScript inference for config
- Compile-time checks for required methods
- Clear contracts via interfaces

### 6. **Testing**
- Test streaming logic once (base class unit tests)
- Providers only test HTTP call logic and mapping
- Much simpler mocking

---

## Migration Path

### Phase 1: Add Base Class Helper
1. Add `StreamingPaginationConfig` interface to `packages/blockchain-providers/src/core/types/streaming.ts`
2. Add `streamWithPagination` method to `BaseApiClient`
3. Add utility types (`PaginationParams`, `PaginationInfo`)
4. Write comprehensive tests for base class helper

### Phase 2: Migrate Moralis (Proof of Concept)
1. Refactor `streamAddressTransactions` to use new helper
2. Refactor `streamAddressTokenTransactions` to use new helper
3. Run existing tests to verify behavior unchanged
4. Measure code reduction and complexity improvement

### Phase 3: Document Pattern
1. Update CLAUDE.md with streaming pattern guidance
2. Create developer guide: "Implementing a Streaming Provider"
3. Add code examples for common scenarios

### Phase 4: Migrate Remaining Providers
1. Alchemy (similar to Moralis)
2. Subscan (page-based)
3. Helius, NearBlocks, Blockstream, etc.

### Phase 5: Remove Old Pattern
1. Mark direct streaming implementations as deprecated
2. Add lint rule to prevent new direct implementations
3. Remove boilerplate once all migrated

---

## Alternative Considered: Streaming Utility Function

Instead of base class method, use standalone utility:

```typescript
// In packages/blockchain-providers/src/core/utils/streaming-utils.ts
export async function* streamWithPagination<TRaw, TNormalized>(
  config: StreamingPaginationConfig<TRaw, TNormalized>
): AsyncIterableIterator<Result<StreamingBatchResult<TNormalized>, Error>>
```

**Pros:**
- More functional/pure
- Can be used outside inheritance hierarchy

**Cons:**
- Loses access to `this.logger`, `this.name`, `this.capabilities`
- Would need to pass these as config parameters
- Less convenient for providers

**Decision:** Use base class method for convenience, but keep logic in pure utility functions where possible.

---

## Implementation Checklist

- [ ] Create `packages/blockchain-providers/src/core/types/streaming.ts` with interfaces
- [ ] Add `streamWithPagination` to `BaseApiClient`
- [ ] Write unit tests for `streamWithPagination`
- [ ] Refactor Moralis `streamAddressTransactions` to use new pattern
- [ ] Refactor Moralis `streamAddressTokenTransactions` to use new pattern
- [ ] Verify all Moralis tests pass
- [ ] Update CLAUDE.md with streaming guidance
- [ ] Create developer guide document
- [ ] Migrate remaining providers (Alchemy, Subscan, etc.)

---

## Success Criteria

- ✅ Provider streaming implementations reduced from ~250 lines to ~25 lines
- ✅ All streaming concerns encapsulated in base class
- ✅ New providers can be implemented in <30 minutes
- ✅ All existing tests pass without modification
- ✅ No behavioral changes (output identical to before)
- ✅ Clear documentation and examples for future developers

---

## Open Questions

1. **Should we support batch size configuration?**
   - Currently hardcoded to 100 per provider
   - Could add `batchSize?: number` to config
   - **Recommendation:** Add if needed, start simple

2. **Should we support custom dedup window sizing per operation?**
   - Currently use 500 for all (5-block replay window assumption)
   - Could calculate from `replayWindow` metadata
   - **Recommendation:** Calculate dynamically in base class

3. **Should we extract more common HTTP param logic?**
   - Many providers use similar param patterns
   - Could create helper for common cases (cursor, fromBlock, limit)
   - **Recommendation:** Start with current design, extract if pattern emerges

4. **Should we support progress callbacks?**
   - Useful for CLI progress bars
   - Could add `onBatch?: (batch) => void` to config
   - **Recommendation:** Future enhancement, not needed for Phase 5

---

## References

- Current Moralis implementation: `packages/blockchain-providers/src/blockchains/evm/providers/moralis/moralis.api-client.ts:488-740`
- Base class: `packages/blockchain-providers/src/core/base/api-client.ts`
- Cursor utilities: `packages/blockchain-providers/src/core/utils/cursor-utils.ts`
- Provider manager utilities: `packages/blockchain-providers/src/core/provider-manager-utils.ts`
- ADR-006 Phase 1: `docs/implementation-plans/adr-006-streaming-pagination-cursors.md`
- ADR-006 Phase 1.5: `docs/implementation-plans/adr-006-phase-1.5-cursor-storage-architecture.md`
