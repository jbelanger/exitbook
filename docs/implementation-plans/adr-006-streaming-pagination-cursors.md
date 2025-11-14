# Implementation Plan: ADR-006 Streaming Pagination with Typed Cursors

**Status:** Ready for Implementation
**ADR:** [ADR-006: Streaming Pagination with Typed Cursors for Cross-Provider Failover](../adr/006-streaming-pagination-with-typed-cursors.md)
**Created:** 2025-01-12

---

## Executive Summary

This plan implements streaming pagination with typed cursors to enable:

1. **Resumable imports** - Crash on page 80/100? Resume from page 80
2. **Mid-pagination failover** - Provider fails? Switch to backup at current cursor
3. **Memory-bounded processing** - Process 100-1000 transactions at a time, not 50,000
4. **Cross-provider compatibility** - Typed cursors enable failover between different providers
5. **Architectural consistency** - Align blockchain providers with exchange provider pattern

The implementation uses AsyncIterators for streaming, discriminated union cursor types for cross-provider compatibility, and provider capabilities metadata for intelligent failover.

---

## Core Design Decisions

### Cursor Type System

Use discriminated union with explicit `type` field for type-safe, cross-provider cursors:

```typescript
export type PaginationCursor =
  | { type: 'blockNumber'; value: number } // Cross-provider (EVM, Substrate)
  | { type: 'timestamp'; value: number } // Cross-provider (Bitcoin, Solana, NEAR)
  | { type: 'txHash'; value: string } // Cross-provider (Bitcoin UTXO chaining)
  | { type: 'pageToken'; value: string; providerName: string }; // Provider-locked
```

**Advantages:**

- Type-safe with TypeScript discriminated unions
- Clear cross-provider compatibility semantics
- Simple to serialize/deserialize
- Explicit provider-locking for opaque tokens

### Streaming Pattern

Use AsyncIterator for standardization and composability:

```typescript
async *executeStreaming<T>(
  operation: ProviderOperation,
  cursor?: CursorState
): AsyncIterableIterator<{
  data: TransactionWithRawData<T>[];
  cursor: CursorState;
}>
```

**Advantages:**

- Idiomatic modern TypeScript
- Composable with for-await-of loops
- Standard pattern in Node.js ecosystem
- Natural backpressure handling

### Provider Capabilities Declaration

Each provider declares supported cursor types and replay windows:

```typescript
capabilities: {
  supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
  preferredCursorType: 'pageToken',
  replayWindow: { blocks: 5, minutes: 5 },
}
```

**Advantages:**

- Explicit failover compatibility
- Provider manager can make intelligent routing decisions
- Clear documentation of provider limitations
- Enables automated compatibility checks

---

---

## Documentation & Rollout

### 1. Update CLAUDE.md

**File:** `CLAUDE.md`

Add section on pagination architecture:

```markdown
## Pagination Architecture

### Streaming Pattern

All blockchain providers use streaming pagination:

- AsyncIterator yields batches of 100-1000 transactions
- Each batch includes cursor state for resumption
- Memory-bounded processing (no unbounded accumulation)

### Typed Cursors

Cursors use discriminated unions for type safety:

- `blockNumber` - Cross-provider (EVM, Substrate)
- `timestamp` - Cross-provider (Bitcoin, Solana, NEAR)
- `txHash` - Cross-provider (Bitcoin UTXO chaining)
- `pageToken` - Provider-locked (opaque tokens)

### Cross-Provider Failover

Provider manager automatically switches providers mid-pagination:

1. Check cursor compatibility with next provider
2. Apply replay window to prevent gaps
3. Deduplicate overlapping transactions
4. Continue streaming from same logical position

### Replay Windows

Providers declare replay windows in capabilities:

- `blocks: 5` - Fetch 5 extra blocks before cursor
- `minutes: 5` - Fetch 5 extra minutes before cursor

Duplicates are automatically filtered via deduplication set.
```

### 2 Create Migration Guide

**File:** `docs/guides/migrating-providers-to-streaming.md`

```markdown
# Migrating Blockchain Providers to Streaming Pagination

## Overview

This guide walks through converting a blockchain provider from internal pagination loops to streaming pagination with typed cursors.

## Steps

### 1. Update Capabilities

Add cursor types and replay window to `@RegisterApiClient`:

\`\`\`typescript
@RegisterApiClient({
// ... existing config ...
capabilities: {
supportedOperations: [...],
supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
preferredCursorType: 'pageToken',
replayWindow: { blocks: 5, minutes: 5 },
},
})
\`\`\`

### 2. Implement extractCursors()

Extract all available cursor types from transactions:

\`\`\`typescript
extractCursors(transaction: YourTransactionType): PaginationCursor[] {
const cursors: PaginationCursor[] = [];

if (transaction.blockHeight) {
cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
}

if (transaction.timestamp) {
cursors.push({
type: 'timestamp',
value: new Date(transaction.timestamp).getTime()
});
}

return cursors;
}
\`\`\`

### 3. Implement applyReplayWindow()

Apply replay logic based on cursor type:

\`\`\`typescript
applyReplayWindow(cursor: PaginationCursor): PaginationCursor {
const replayWindow = this.capabilities.replayWindow;
if (!replayWindow) return cursor;

switch (cursor.type) {
case 'blockNumber':
return {
type: 'blockNumber',
value: Math.max(0, cursor.value - (replayWindow.blocks || 0)),
};
case 'timestamp':
const replayMs = (replayWindow.minutes || 0) _ 60 _ 1000;
return {
type: 'timestamp',
value: Math.max(0, cursor.value - replayMs),
};
default:
return cursor;
}
}
\`\`\`

### 4. Convert to Streaming

Replace internal pagination loop with AsyncIterator:

\`\`\`typescript
async \*executeStreaming(
operation: ProviderOperation,
resumeCursor?: CursorState
): AsyncIterableIterator<{
data: TransactionWithRawData<T>[];
cursor: CursorState;
}> {
// Determine starting point from cursor
let pageKey = undefined;
let totalFetched = resumeCursor?.totalFetched || 0;

if (resumeCursor) {
// Handle same-provider resumption
// Handle cross-provider resumption
}

// Pagination loop
while (hasMore) {
// Fetch page
const response = await this.fetchPage(...);

    // Map to transactions
    const transactions = response.map(...);

    // Extract cursors
    const lastTx = transactions[transactions.length - 1];
    const cursors = this.extractCursors(lastTx.normalized);

    // Build cursor state
    const cursorState: CursorState = {
      primary: /* most efficient cursor */,
      alternatives: cursors,
      lastTransactionId: lastTx.normalized.id,
      totalFetched: totalFetched + transactions.length,
      metadata: {
        providerName: this.name,
        updatedAt: Date.now(),
        isComplete: !hasMore,
      },
    };

    // Yield batch
    yield { data: transactions, cursor: cursorState };

    totalFetched += transactions.length;

}
}
\`\`\`

### 5. Add Tests

Test streaming, resumption, and cursor extraction.
```

---

## Implementation Schedule

### Week 1: Foundation

- **Days 1-2**: Implement cursor types and provider interfaces
- **Days 3-4**: Update provider manager with failover logic (Phase 2.1-2.3)
- **Day 5**: Write unit tests for cursor system

### Week 2: Proof of Concept

- **Days 1-3**: Implement Alchemy streaming with Result wrappers
- **Days 4-5**: Update EVM importer, integration tests

### Week 3: Deduplication & Resume Logic

- **Days 1-2**: Implement deduplication window loading (Phase 2.2)
- **Days 3-4**: Implement resume logic and database queries (Phase 4.3-4.4)
- **Day 5**: End-to-end testing with crashes/resumes

### Week 4: Validation

- **Days 1-2**: End-to-end testing with real data
- **Days 3-4**: Bug fixes and performance tuning
- **Day 5**: Documentation updates

### Week 5: Moralis Migration

- **Days 1-3**: Implement Moralis streaming
- **Days 4-5**: Testing and validation

### Week 6: Subscan Migration

- **Days 1-3**: Implement Subscan streaming (simpler, page-based)
- **Days 4-5**: Testing

### Week 7: Remaining Providers

- **Days 1-2**: NearBlocks streaming
- **Days 3-4**: Blockstream and others
- **Day 5**: Final testing

### Week 8: Production Readiness

- **Days 1-2**: Remove deprecated methods
- **Days 3-4**: Final documentation and migration guide
- **Day 5**: Production deployment

---

## Success Criteria

- ✅ All blockchain providers support streaming pagination with Result wrappers
- ✅ Provider manager successfully fails over mid-pagination
- ✅ Cursor state persists correctly in `import_sessions.last_cursor`
- ✅ **Imports automatically resume after crashes from last persisted cursor**
- ✅ Memory usage remains bounded during large imports (no accumulation)
- ✅ **Deduplication prevents duplicates across replay windows (loads recent IDs from storage)**
- ✅ **Streaming importer emits normal, internal, and token transaction categories (parity with legacy importer)**
- ✅ **Exchange importers continue working with existing `credentials` and `csvDirectories` fields**
- ✅ All integration tests pass
- ✅ Documentation is complete and accurate

---

## Risk Mitigation

| Risk                        | Mitigation                                          |
| --------------------------- | --------------------------------------------------- |
| Breaking existing imports   | Keep deprecated `execute()` method during migration |
| Provider compatibility      | Phased rollout, test each provider individually     |
| Cursor translation bugs     | Comprehensive unit tests for all cursor types       |
| Performance regression      | Benchmark before/after, optimize batch sizes        |
| Database schema changes     | See Phase 1.6 - dedicated cursor storage required   |
| Complex AsyncIterator logic | Well-documented examples, migration guide           |

---

## Open Questions

1. **Batch size optimization**: What's the optimal batch size per provider?
   - **Recommendation**: Start with 100, tune based on performance metrics

2. **Cache invalidation**: How to handle cached results with cursors?
   - **Recommendation**: Include cursor in cache key, invalidate on cursor change

3. **Progress UI**: How to show real-time progress to users?
   - **Status**: Future enhancement (ADR-007)
   - **Blockers**: Need CLI progress rendering infrastructure

4. **Parallel pagination**: Can we split page ranges across multiple providers?
   - **Status**: Future optimization (builds on this foundation)
   - **Blockers**: Requires coordination layer for page range assignment

5. **Deduplication window size**: How many recent transaction IDs should we load?
   - **Recommendation**: Start with 1000 (covers ~5-10 minutes of replay window at typical rates)
   - **Trade-off**: Memory usage vs dedup accuracy

6. **Resume behavior**: Should resume be automatic or require explicit flag?
   - **Recommendation**: Automatic resume if incomplete import found
   - **Safety**: User can force fresh import by deleting old data source or using `--force-new` flag

---

## References

- ADR-006: [Streaming Pagination with Typed Cursors](../adr/006-streaming-pagination-with-typed-cursors.md)
- Database schema: `packages/data/src/schema/database-schema.ts:60` (`cursor` field)
- Exchange provider example: `packages/exchange-providers/src/exchanges/kraken/client.ts:124-127`
- Provider manager: `packages/blockchain-providers/src/core/provider-manager.ts`
