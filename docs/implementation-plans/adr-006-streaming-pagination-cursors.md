# Implementation Plan: ADR-006 Streaming Pagination with Typed Cursors

**Status:** Ready for Implementation
**ADR:** [ADR-006: Streaming Pagination with Typed Cursors for Cross-Provider Failover](../adr/006-streaming-pagination-with-typed-cursors.md)
**Created:** 2025-01-12
**Updated:** 2025-01-12 (Reviewer feedback incorporated)
**Estimated Duration:** 8 weeks (phased rollout)

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

## Phase 1: Foundation - Core Types & Interfaces

### 1.1 Cursor Type Definitions

**File:** `packages/blockchain-providers/src/core/types/cursor.ts` (NEW)

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
 * Semantic cursors (blockNumber, timestamp, txHash) are cross-provider compatible
 * PageToken cursors are provider-locked due to opaque implementation
 */
export type PaginationCursor =
  | { type: 'blockNumber'; value: number } // Cross-provider compatible
  | { type: 'timestamp'; value: number } // Cross-provider compatible (ms since epoch)
  | { type: 'txHash'; value: string } // Cross-provider compatible (same chain)
  | { type: 'pageToken'; value: string; providerName: string }; // Provider-locked

/**
 * Complete cursor state for a pagination point
 * Can contain multiple cursor types to maximize failover options
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

**Validation:**

- Add Zod schema for runtime validation
- Test all cursor type discriminations
- Verify serialization roundtrips

### 1.2 Provider Capabilities

**File:** `packages/blockchain-providers/src/core/types/provider.ts`

Update `ProviderCapabilities` interface:

```typescript
export interface ProviderCapabilities {
  /**
   * Supported operation types
   */
  supportedOperations: ProviderOperationType[];

  /**
   * Cursor types this provider can accept for resumption
   * Enables cross-provider failover for compatible cursor types
   */
  supportedCursorTypes: CursorType[];

  /**
   * Preferred cursor type for this provider (most efficient)
   * Used when starting fresh or when multiple options available
   */
  preferredCursorType: CursorType;

  /**
   * Replay window applied when failing over FROM a different provider
   * Prevents off-by-one gaps; duplicates absorbed by dedup keys
   */
  replayWindow?: {
    blocks?: number; // For blockNumber cursors (EVM, Substrate)
    minutes?: number; // For timestamp cursors (Bitcoin, Solana) or fallback
    transactions?: number; // For txHash cursors (Bitcoin UTXO chaining)
  };
}
```

### 1.3 Provider Interface Updates

**File:** `packages/blockchain-providers/src/core/types/provider.ts`

Add streaming methods to `IBlockchainProvider`:

````typescript
/**
 * Streaming batch result with Result wrapper
 * Follows neverthrow pattern for consistent error handling
 */
export interface StreamingBatchResult<T> {
  data: TransactionWithRawData<T>[];
  cursor: CursorState;
}

export interface IBlockchainProvider {
  readonly name: string;
  readonly blockchain: string;
  readonly capabilities: ProviderCapabilities;

  /**
   * Execute operation with streaming pagination
   *
   * IMPORTANT: This method yields Result<T, Error> to maintain consistency with
   * the repository's neverthrow pattern. Errors are yielded as err(Error) rather
   * than thrown directly. Consumers should check each yielded result with .isErr().
   *
   * @param operation - The operation to execute
   * @param cursor - Optional cursor state to resume from
   * @returns AsyncIterator yielding Result-wrapped batches with cursor state
   *
   * @example
   * ```typescript
   * const iterator = provider.executeStreaming(operation, cursor);
   * for await (const batchResult of iterator) {
   *   if (batchResult.isErr()) {
   *     logger.error('Batch failed:', batchResult.error);
   *     // Handle error or break
   *     break;
   *   }
   *   const { data, cursor } = batchResult.value;
   *   // Process batch...
   * }
   * ```
   */
  executeStreaming<T>(
    operation: ProviderOperation,
    cursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>>;

  /**
   * Extract all available cursor types from a transaction
   * Providers should return as many cursor types as possible to maximize failover options
   *
   * @param transaction - Normalized transaction
   * @returns Array of all extractable cursor types
   *
   * @example
   * // EVM transaction provides both blockNumber and timestamp
   * extractCursors(evmTx) => [
   *   { type: 'blockNumber', value: 15000000 },
   *   { type: 'timestamp', value: 1640000000000 }
   * ]
   */
  extractCursors(transaction: Transaction): PaginationCursor[];

  /**
   * Apply replay window to a cursor for safe failover
   * Returns adjusted cursor that will overlap with previous provider's data
   *
   * @param cursor - Cursor from a different provider
   * @returns Adjusted cursor with replay window applied
   *
   * @example
   * // Original cursor: block 15000000
   * // Replay window: 5 blocks
   * // Returns: block 14999995
   */
  applyReplayWindow(cursor: PaginationCursor): PaginationCursor;

  /**
   * Existing non-streaming method (keep for backward compatibility during migration)
   * @deprecated Use executeStreaming instead
   */
  execute<T>(operation: ProviderOperation, options: Record<string, unknown>): Promise<Result<T, Error>>;
}
````

### 1.4 Cursor Validation Schema

**File:** `packages/core/src/schemas/cursor.ts` (NEW)

```typescript
import { z } from 'zod';

/**
 * Zod schema for PaginationCursor (discriminated union)
 */
export const PaginationCursorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('blockNumber'),
    value: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('timestamp'),
    value: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('txHash'),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal('pageToken'),
    value: z.string().min(1),
    providerName: z.string().min(1),
  }),
]);

/**
 * Zod schema for CursorState
 */
export const CursorStateSchema = z.object({
  primary: PaginationCursorSchema,
  alternatives: z.array(PaginationCursorSchema).optional(),
  lastTransactionId: z.string().min(1),
  totalFetched: z.number().int().nonnegative(),
  metadata: z
    .object({
      providerName: z.string(),
      updatedAt: z.number().int().nonnegative(),
      isComplete: z.boolean().optional(),
    })
    .optional(),
});
```

**File:** `packages/core/src/schemas/external-transaction-data.ts`

Update the existing schema to use typed cursor:

```typescript
import { CursorStateSchema } from './cursor.js';

export const ExternalTransactionSchema = z.object({
  // ... existing fields ...
  cursor: CursorStateSchema.optional(), // ✅ Changed from z.record(z.string(), z.unknown())
  // ... rest of schema ...
});
```

### 1.5 Type Exports

**File:** `packages/blockchain-providers/src/core/types/index.ts`

```typescript
export * from './cursor.js';
export type { CursorType, PaginationCursor, CursorState } from './cursor.js';
```

**File:** `packages/blockchain-providers/src/index.ts`

```typescript
export type { CursorType, PaginationCursor, CursorState } from './core/types/cursor.js';
```

**File:** `packages/core/src/schemas/index.ts`

```typescript
export { PaginationCursorSchema, CursorStateSchema } from './cursor.js';
```

### 1.6 Database Schema Updates

**File:** `packages/data/src/schema/database-schema.ts`

Update the `data_sources` table to store authoritative cursor state:

```typescript
export interface DataSourcesTable {
  // ... existing fields ...

  /**
   * Last cursor state for resumable imports
   * Stores the discriminated union CursorState as JSON
   *
   * This is the AUTHORITATIVE cursor for resume operations:
   * - Read on import start: `SELECT last_cursor FROM data_sources WHERE id = ?`
   * - Write after EACH batch: `UPDATE data_sources SET last_cursor = ? WHERE id = ?`
   *
   * Schema validation: CursorStateSchema from @exitbook/core/schemas
   */
  last_cursor: string | undefined; // JSON-serialized CursorState

  // ... rest of fields ...
}
```

**Migration Path:**

The `external_transaction_data.cursor` field (line 49) stores per-transaction cursor for provenance/debugging. The NEW `data_sources.last_cursor` field stores the authoritative cursor for resumption. Developer must:

1. Add `last_cursor` column to `data_sources` table in migration
2. Parse/validate using `CursorStateSchema.safeParse()` on read
3. Serialize via `JSON.stringify()` on write
4. Query on import start: Look up data source, parse `last_cursor`, pass to `ImportParams.cursor`

**File:** `packages/data/src/migrations/001_initial_schema.ts`

Add column directly to the initial CREATE TABLE statement (per CLAUDE.md requirements):

```typescript
// Find the data_sources table creation and add last_cursor column
await db.schema
  .createTable('data_sources')
  .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
  // ... existing columns ...
  .addColumn('last_cursor', 'text') // JSON-serialized CursorState for resumption
  // ... rest of columns ...
  .execute();
```

**IMPORTANT:** Do NOT use `alterTable` - add the column to the initial CREATE TABLE statement. Per CLAUDE.md, the database is dropped during development, so migrations must be added to `001_initial_schema.ts` directly.

**File:** `packages/data/src/repositories/data-source-repository.ts`

Add cursor serialization/deserialization:

```typescript
import { CursorStateSchema } from '@exitbook/core/schemas';
import type { CursorState } from '@exitbook/blockchain-providers';

/**
 * Serialize CursorState for database storage
 */
private serializeCursor(cursor: CursorState | undefined): string | undefined {
  return cursor ? JSON.stringify(cursor) : undefined;
}

/**
 * Deserialize and validate CursorState from database
 */
private deserializeCursor(cursorJson: string | undefined): CursorState | undefined {
  if (!cursorJson) return undefined;

  try {
    const parsed = JSON.parse(cursorJson);
    const validated = CursorStateSchema.safeParse(parsed);

    if (!validated.success) {
      logger.warn('Invalid cursor state in database', { errors: validated.error });
      return undefined;
    }

    return validated.data;
  } catch (error) {
    logger.warn('Failed to parse cursor state', { error: getErrorMessage(error) });
    return undefined;
  }
}

/**
 * Create data source with optional cursor
 */
async create(params: {
  // ... existing params ...
  lastCursor?: CursorState;
}): Promise<Result<DataSource, Error>> {
  // ... existing code ...

  const result = await db
    .insertInto('data_sources')
    .values({
      // ... existing fields ...
      last_cursor: this.serializeCursor(params.lastCursor),
    })
    .execute();

  // ...
}

/**
 * Update data source with cursor
 */
async update(id: number, params: {
  // ... existing params ...
  lastCursor?: CursorState;
}): Promise<Result<void, Error>> {
  // ... existing code ...

  const result = await db
    .updateTable('data_sources')
    .set({
      // ... existing fields ...
      last_cursor: this.serializeCursor(params.lastCursor),
    })
    .where('id', '=', id)
    .execute();

  // ...
}

/**
 * Find data source by ID with cursor
 */
async findById(id: number): Promise<Result<DataSource | undefined, Error>> {
  // ... query ...

  if (row) {
    return ok({
      // ... existing fields ...
      lastCursor: this.deserializeCursor(row.last_cursor),
    });
  }

  // ...
}
```

---

## Phase 2: Provider Manager - Failover Logic

### 2.1 Cursor Compatibility Helpers

**File:** `packages/blockchain-providers/src/core/provider-manager.ts`

Add private helper methods:

```typescript
/**
 * Check if provider can resume from cursor
 */
private canProviderResume(provider: IBlockchainProvider, cursor: CursorState): boolean {
  const supportedTypes = provider.capabilities.supportedCursorTypes;

  // Check primary cursor
  if (supportedTypes.includes(cursor.primary.type)) {
    // If it's a pageToken, must match provider name
    if (cursor.primary.type === 'pageToken') {
      return cursor.primary.providerName === provider.name;
    }
    return true;
  }

  // Check alternatives
  return cursor.alternatives?.some(alt =>
    supportedTypes.includes(alt.type) &&
    (alt.type !== 'pageToken' || alt.providerName === provider.name)
  ) || false;
}

/**
 * Select best cursor type for provider from available options
 * Priority order: blockNumber > timestamp > txHash > pageToken (for cross-provider)
 */
private selectBestCursorType(
  provider: IBlockchainProvider,
  cursor?: CursorState
): CursorType {
  if (!cursor) return provider.capabilities.preferredCursorType;

  const supportedTypes = provider.capabilities.supportedCursorTypes;
  const allCursors = [cursor.primary, ...(cursor.alternatives || [])];

  // Priority order for cross-provider failover
  const priorityOrder: CursorType[] = ['blockNumber', 'timestamp', 'txHash', 'pageToken'];

  for (const type of priorityOrder) {
    if (supportedTypes.includes(type) && allCursors.some(c => c.type === type)) {
      return type;
    }
  }

  return provider.capabilities.preferredCursorType;
}

/**
 * Find best cursor to use for provider
 */
private findBestCursor(
  provider: IBlockchainProvider,
  cursor: CursorState
): PaginationCursor | undefined {
  const supportedTypes = provider.capabilities.supportedCursorTypes;

  // Try primary first
  if (supportedTypes.includes(cursor.primary.type)) {
    if (cursor.primary.type !== 'pageToken' || cursor.primary.providerName === provider.name) {
      return cursor.primary;
    }
  }

  // Try alternatives
  if (cursor.alternatives) {
    for (const alt of cursor.alternatives) {
      if (supportedTypes.includes(alt.type)) {
        if (alt.type !== 'pageToken' || alt.providerName === provider.name) {
          return alt;
        }
      }
    }
  }

  return undefined;
}
```

### 2.2 Deduplication Window Management

**File:** `packages/blockchain-providers/src/core/provider-manager.ts`

Add helper method to load recent transaction IDs for deduplication:

```typescript
/**
 * Load recent transaction IDs from storage to seed deduplication set
 *
 * When resuming with a replay window, we need to filter out transactions
 * that were already processed. Loading recent IDs prevents duplicates.
 *
 * @param dataSourceId - Data source to load transactions from
 * @param windowSize - Number of recent transactions to load (default: 1000)
 * @returns Set of transaction IDs from the last N transactions
 */
private async loadRecentTransactionIds(
  dataSourceId: number,
  windowSize: number = 1000
): Promise<Set<string>> {
  // TODO: Implement in Phase 2.3
  // Query: SELECT external_id FROM external_transaction_data
  //        WHERE data_source_id = ?
  //        ORDER BY id DESC
  //        LIMIT ?

  // For now, return empty set (Phase 1-2 proof of concept only)
  return new Set<string>();
}
```

**Note:** This is a critical component for production use. Phase 1-2 proof of concept can skip this by ensuring test imports don't resume mid-stream. Phase 2.3 must implement this before any production use.

### 2.3 Streaming Failover Implementation

**File:** `packages/blockchain-providers/src/core/provider-manager.ts`

Add new method alongside existing `executeWithFailover`:

```typescript
/**
 * Execute operation with streaming pagination and intelligent failover
 *
 * Supports:
 * - Mid-pagination provider switching
 * - Cross-provider cursor translation
 * - Automatic deduplication after replay windows
 * - Progress tracking
 */
async *executeWithFailoverStreaming<T>(
  blockchain: string,
  operation: ProviderOperation,
  resumeCursor?: CursorState
): AsyncIterableIterator<Result<FailoverExecutionResult<T> & { cursor: CursorState }, Error>> {
  const providers = this.getProvidersInOrder(blockchain, operation);

  if (providers.length === 0) {
    yield err(
      new ProviderError(
        `No providers available for ${blockchain} operation: ${operation.type}`,
        'NO_PROVIDERS',
        { blockchain, operation: operation.type }
      )
    );
    return;
  }

  let currentCursor = resumeCursor;
  let providerIndex = 0;
  const deduplicationSet = new Set<string>();

  // ✅ CRITICAL: Populate dedup set from recent database transactions to prevent duplicates
  // during replay window (5 blocks/minutes can be dozens of transactions)
  if (resumeCursor) {
    // TODO Phase 2.3: Load recent transaction IDs from storage to seed dedup set
    // For now, only track the last transaction ID (insufficient for production)
    deduplicationSet.add(resumeCursor.lastTransactionId);
  }

  while (providerIndex < providers.length) {
    const provider = providers[providerIndex];

    // Check cursor compatibility
    if (currentCursor && !this.canProviderResume(provider, currentCursor)) {
      const supportedTypes = provider.capabilities.supportedCursorTypes.join(', ');
      logger.warn(
        `Provider ${provider.name} cannot resume from cursor type ${currentCursor.primary.type}. ` +
        `Supported types: ${supportedTypes}. Trying next provider.`
      );
      providerIndex++;
      continue;
    }

    const isFailover = currentCursor && currentCursor.metadata?.providerName !== provider.name;

    logger.info(
      `Using provider ${provider.name} for ${operation.type}` +
      (isFailover
        ? ` (failover from ${currentCursor!.metadata?.providerName}, replay window will be applied)`
        : currentCursor
          ? ` (resuming same provider)`
          : '')
    );

    try {
      const iterator = provider.executeStreaming(operation, currentCursor);

      for await (const batchResult of iterator) {
        // ✅ Check Result wrapper from provider
        if (batchResult.isErr()) {
          logger.error(`Provider ${provider.name} batch failed: ${getErrorMessage(batchResult.error)}`);

          // Record failure and try next provider
          const circuitState = this.getOrCreateCircuitState(provider.name);
          this.circuitStates.set(provider.name, recordFailure(circuitState, Date.now()));
          this.updateHealthMetrics(provider.name, false, 0, getErrorMessage(batchResult.error));

          providerIndex++;
          break; // Break inner loop, continue outer loop to try next provider
        }

        const batch = batchResult.value;

        // Deduplicate (especially important after failover with replay window)
        const deduplicated = batch.data.filter(tx => {
          const id = tx.normalized.id;
          if (deduplicationSet.has(id)) {
            logger.debug(`Skipping duplicate transaction: ${id}`);
            return false;
          }
          deduplicationSet.add(id);
          return true;
        });

        if (deduplicated.length > 0) {
          // ✅ Yield Result-wrapped batch
          yield ok({
            data: deduplicated as unknown as T[],
            providerName: provider.name,
            cursor: batch.cursor,
          });
        }

        currentCursor = batch.cursor;

        // Record success for circuit breaker
        const circuitState = this.getOrCreateCircuitState(provider.name);
        this.circuitStates.set(provider.name, recordSuccess(circuitState, Date.now()));
      }

      logger.info(`Provider ${provider.name} completed successfully`);
      return;

    } catch (error) {
      // ✅ Unexpected errors (outside Result chain) - wrap and yield
      const errorMessage = getErrorMessage(error);
      logger.error(`Provider ${provider.name} failed with unexpected error: ${errorMessage}`);

      // Record failure
      const circuitState = this.getOrCreateCircuitState(provider.name);
      this.circuitStates.set(provider.name, recordFailure(circuitState, Date.now()));
      this.updateHealthMetrics(provider.name, false, 0, errorMessage);

      // Try next provider
      providerIndex++;

      if (providerIndex < providers.length) {
        const nextProvider = providers[providerIndex];
        const bestCursorType = this.selectBestCursorType(nextProvider, currentCursor);
        logger.info(
          `Failing over to ${nextProvider.name}. ` +
          `Will use ${bestCursorType} cursor for resumption.`
        );
      } else {
        // All providers exhausted - yield error
        yield err(
          new ProviderError(
            `All providers exhausted for ${blockchain}. Last error: ${errorMessage}`,
            'ALL_PROVIDERS_FAILED',
            { blockchain, operation: operation.type, lastError: errorMessage }
          )
        );
        return;
      }
    }
  }

  // No compatible providers found
  yield err(
    new ProviderError(
      `No compatible providers found for ${blockchain}`,
      'NO_COMPATIBLE_PROVIDERS',
      { blockchain, operation: operation.type }
    )
  );
}
```

---

## Phase 3: Proof-of-Concept Provider (Alchemy)

### 3.1 Update Capabilities Declaration

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/alchemy/alchemy.api-client.ts`

Update `@RegisterApiClient` decorator:

```typescript
@RegisterApiClient({
  // ... existing config ...
  capabilities: {
    supportedOperations: [
      'getAddressTransactions',
      'getAddressInternalTransactions',
      'getAddressBalances',
      'getAddressTokenTransactions',
      'getAddressTokenBalances',
    ],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 5, minutes: 5 },
  },
})
export class AlchemyApiClient extends BaseApiClient {
  // ...
}
```

### 3.2 Implement Cursor Extraction

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/alchemy/alchemy.api-client.ts`

```typescript
extractCursors(transaction: EvmTransaction): PaginationCursor[] {
  const cursors: PaginationCursor[] = [];

  if (transaction.blockHeight !== undefined) {
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
```

### 3.3 Implement Replay Window

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/alchemy/alchemy.api-client.ts`

```typescript
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
      const replayMs = (replayWindow.minutes || 0) * 60 * 1000;
      return {
        type: 'timestamp',
        value: Math.max(0, cursor.value - replayMs),
      };

    default:
      return cursor;
  }
}
```

### 3.4 Implement Streaming Execution

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/alchemy/alchemy.api-client.ts`

Replace `getAssetTransfersPaginated` with streaming version:

```typescript
async *executeStreaming(
  operation: ProviderOperation,
  resumeCursor?: CursorState
): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
  // Only handle getAddressTransactions for now (proof of concept)
  if (operation.type !== 'getAddressTransactions') {
    yield err(new Error(`Streaming not yet implemented for operation: ${operation.type}`));
    return;
  }

  const address = operation.address;

  // Determine starting point
  let pageKey: string | undefined;
  let fromBlock: string | undefined;
  let totalFetched = resumeCursor?.totalFetched || 0;

  if (resumeCursor) {
    // Priority 1: Use pageToken from same provider (most efficient)
    if (resumeCursor.primary.type === 'pageToken' &&
        resumeCursor.primary.providerName === this.name) {
      pageKey = resumeCursor.primary.value;
      this.logger.info(`Resuming from Alchemy pageKey: ${pageKey}`);
    }
    // Priority 2: Use blockNumber cursor (cross-provider failover)
    else {
      const blockCursor = resumeCursor.primary.type === 'blockNumber'
        ? resumeCursor.primary
        : resumeCursor.alternatives?.find(c => c.type === 'blockNumber');

      if (blockCursor && blockCursor.type === 'blockNumber') {
        const adjusted = this.applyReplayWindow(blockCursor);
        fromBlock = `0x${adjusted.value.toString(16)}`;
        this.logger.info(`Resuming from block ${adjusted.value} (with replay window)`);
      } else {
        this.logger.warn('No compatible cursor found, starting from beginning');
      }
    }
  }

  const deduplicationSet = new Set<string>();
  if (resumeCursor?.lastTransactionId) {
    deduplicationSet.add(resumeCursor.lastTransactionId);
  }

  let pageCount = 0;
  const maxPages = 100;

  while (pageCount < maxPages) {
    // Fetch transfers FROM address (outgoing)
    const fromParams: AlchemyAssetTransferParams = {
      category: ['external', 'internal', 'erc20', 'erc721', 'erc1155'],
      excludeZeroValue: false,
      fromAddress: address,
      fromBlock: fromBlock || '0x0',
      maxCount: '0x3e8', // 1000
      toBlock: 'latest',
      withMetadata: true,
      ...(pageKey && { pageKey }),
    };

    const fromResult = await this.httpClient.post(
      `/${this.apiKey}`,
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'alchemy_getAssetTransfers',
        params: [fromParams],
      },
      { schema: AlchemyAssetTransfersJsonRpcResponseSchema }
    );

    if (fromResult.isErr()) {
      yield err(fromResult.error);
      return;
    }

    const fromResponse = fromResult.value;
    const fromTransfers = fromResponse.result?.transfers || [];

    // Fetch transfers TO address (incoming)
    const toParams: AlchemyAssetTransferParams = {
      category: ['external', 'internal', 'erc20', 'erc721', 'erc1155'],
      excludeZeroValue: false,
      toAddress: address,
      fromBlock: fromBlock || '0x0',
      maxCount: '0x3e8',
      toBlock: 'latest',
      withMetadata: true,
      ...(pageKey && { pageKey }),
    };

    const toResult = await this.httpClient.post(
      `/${this.apiKey}`,
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'alchemy_getAssetTransfers',
        params: [toParams],
      },
      { schema: AlchemyAssetTransfersJsonRpcResponseSchema }
    );

    if (toResult.isErr()) {
      yield err(toResult.error);
      return;
    }

    const toResponse = toResult.value;
    const toTransfers = toResponse.result?.transfers || [];

    const allTransfers = [...fromTransfers, ...toTransfers];

    if (allTransfers.length === 0) break;

    // Map and deduplicate
    const mappedTransfers = allTransfers
      .map(t => mapAlchemyTransaction(t, this.chainConfig))
      .filter(tx => {
        if (deduplicationSet.has(tx.normalized.id)) {
          this.logger.debug(`Skipping duplicate: ${tx.normalized.id}`);
          return false;
        }
        deduplicationSet.add(tx.normalized.id);
        return true;
      });

    totalFetched += mappedTransfers.length;

    // Extract cursors from last transaction
    const lastTx = mappedTransfers[mappedTransfers.length - 1];
    const cursors = this.extractCursors(lastTx.normalized);

    // Build cursor state
    const cursorState: CursorState = {
      primary: fromResponse.result?.pageKey
        ? { type: 'pageToken', value: fromResponse.result.pageKey, providerName: this.name }
        : cursors.find(c => c.type === 'blockNumber')!,
      alternatives: cursors,
      lastTransactionId: lastTx.normalized.id,
      totalFetched,
      metadata: {
        providerName: this.name,
        updatedAt: Date.now(),
        isComplete: !fromResponse.result?.pageKey && !toResponse.result?.pageKey,
      },
    };

    // ✅ Yield Result-wrapped batch
    yield ok({
      data: mappedTransfers,
      cursor: cursorState,
    });

    pageKey = fromResponse.result?.pageKey || toResponse.result?.pageKey;
    if (!pageKey) break;
    pageCount++;
  }
}
```

**CRITICAL PATTERN:**

All errors in the streaming path are **yielded** as `err(Error)`, not thrown:

```typescript
// ❌ WRONG - throws, bypasses Result contract
if (fromResult.isErr()) {
  throw fromResult.error;
}

// ✅ CORRECT - yields err() and returns
if (fromResult.isErr()) {
  yield err(fromResult.error);
  return;
}

// ✅ CORRECT - wraps success in ok()
yield ok({
  data: mappedTransfers,
  cursor: cursorState,
});
```

This maintains consistency with neverthrow pattern throughout the repository.

````

### 3.5 Keep Legacy Method (Temporarily)

Mark old method as deprecated but keep functional:

```typescript
/**
 * @deprecated Use executeStreaming instead
 */
async execute<T>(operation: ProviderOperation, options: Record<string, unknown>): Promise<Result<T, Error>> {
  // Existing implementation unchanged
  // Will be removed in Phase 4 after all providers migrated
}
````

---

## Phase 4: Importer & Ingestion Service Updates

### 4.1 Update IImporter Contract

**File:** `packages/ingestion/src/types/importers.ts`

Update the interface to support streaming:

```typescript
import type { Result } from 'neverthrow';
import type { CursorState } from '@exitbook/blockchain-providers';
import type { ExchangeCredentials } from '@exitbook/exchanges-providers';

/**
 * Import parameters with typed cursor support
 *
 * ✅ PRESERVES existing contract for exchange importers (credentials, csvDirectories)
 * ✅ ONLY updates cursor type from Record<string, number> to CursorState
 */
export interface ImportParams {
  address?: string | undefined;
  credentials?: ExchangeCredentials | undefined;
  csvDirectories?: string[] | undefined;
  providerName?: string | undefined;

  /**
   * Typed cursor for resuming imports
   * Replaces the loose Record<string, number> with strongly-typed CursorState
   *
   * BREAKING CHANGE: cursor type changed from Record<string, number> to CursorState
   * All blockchain importers must update cursor handling
   * Exchange importers typically don't use cursors, so impact is minimal
   */
  cursor?: CursorState; // ✅ Changed from Record<string, number>
}

/**
 * Single batch of imported transactions
 */
export interface ImportBatchResult {
  rawTransactions: ExternalTransaction[];
  cursor: CursorState;
  isComplete: boolean;
}

/**
 * Final import result (for backward compatibility during migration)
 */
export interface ImportRunResult {
  rawTransactions: ExternalTransaction[];
  finalCursor?: CursorState;
}

/**
 * Importer interface
 *
 * MIGRATION PATH:
 * - Old method: import() returns all transactions at once
 * - New method: importStreaming() yields batches with cursors
 * - Keep both during migration, remove import() in Phase 7
 */
export interface IImporter {
  /**
   * Streaming import - yields batches as they're fetched
   * Enables memory-bounded processing and mid-import resumption
   *
   * @param params - Import parameters including optional resume cursor
   * @returns AsyncIterator yielding Result-wrapped batches
   */
  importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>>;

  /**
   * Legacy batch import - accumulates all transactions before returning
   * @deprecated Use importStreaming instead
   * Will be removed in Phase 7 after all importers migrated
   */
  import(params: ImportParams): Promise<Result<ImportRunResult, Error>>;
}
```

### 4.2 Update EVM Importer

**File:** `packages/ingestion/src/infrastructure/blockchains/evm/importer.ts`

Implement streaming importer (normal + internal + token parity):

```typescript
/**
 * Streaming import implementation
 * Streams NORMAL + INTERNAL + TOKEN batches without ever accumulating everything in memory.
 * Maintains backwards-compatibility until the legacy import() wrapper is removed.
 */
async *importStreaming(
  params: ImportParams
): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
  if (!params.address) {
    yield err(new Error(`Address required for ${this.chainConfig.chainName} transaction import`));
    return;
  }

  const address = params.address;

  this.logger.info(
    `Starting ${this.chainConfig.chainName} streaming import for ${address.substring(0, 20)}...`,
    params.cursor ? { resumingFrom: params.cursor.totalFetched } : {}
  );

  try {
    for await (const batchResult of this.streamNormalTransactions(address, params.cursor)) {
      yield batchResult;
    }

    for await (const batchResult of this.streamInternalTransactions(address)) {
      yield batchResult;
    }

    for await (const batchResult of this.streamTokenTransactions(address)) {
      yield batchResult;
    }

    this.logger.info(`${this.chainConfig.chainName} streaming import completed`);

  } catch (error) {
    this.logger.error(
      `Failed to stream transactions for address ${address}`,
      { error: getErrorMessage(error) }
    );
    yield err(error instanceof Error ? error : new Error(String(error)));
  }
}

private async *streamNormalTransactions(
  address: string,
  resumeCursor?: CursorState
): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
  const iterator = this.providerManager.executeWithFailoverStreaming<EvmTransaction>(
    this.chainConfig.chainName,
    {
      type: 'getAddressTransactions',
      address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:normal-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:all`,
    },
    resumeCursor
  );

  for await (const providerBatchResult of iterator) {
    if (providerBatchResult.isErr()) {
      yield err(providerBatchResult.error);
      return;
    }

    const providerBatch = providerBatchResult.value;
    const transactions = providerBatch.data as TransactionWithRawData<EvmTransaction>[];

    yield ok({
      rawTransactions: transactions.map((txWithRaw) => ({
        providerName: providerBatch.providerName,
        externalId: generateUniqueTransactionId(txWithRaw.normalized),
        transactionTypeHint: 'normal',
        sourceAddress: address,
        normalizedData: txWithRaw.normalized,
        rawData: txWithRaw.raw,
        cursor: providerBatch.cursor,
      })),
      cursor: providerBatch.cursor,
      isComplete: providerBatch.cursor.metadata?.isComplete ?? false,
    });
  }
}

private async *streamInternalTransactions(
  address: string
): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
  const iterator = this.providerManager.executeWithFailoverStreaming<EvmTransaction>(
    this.chainConfig.chainName,
    {
      type: 'getAddressInternalTransactions',
      address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:internal-txs:${params.type === 'getAddressInternalTransactions' ? params.address : 'unknown'}:all`,
    }
  );

  for await (const providerBatchResult of iterator) {
    if (providerBatchResult.isErr()) {
      yield err(providerBatchResult.error);
      return;
    }

    const providerBatch = providerBatchResult.value;
    const transactions = providerBatch.data as TransactionWithRawData<EvmTransaction>[];

    yield ok({
      rawTransactions: transactions.map((txWithRaw) => ({
        providerName: providerBatch.providerName,
        externalId: generateUniqueTransactionId(txWithRaw.normalized),
        transactionTypeHint: 'internal',
        sourceAddress: address,
        normalizedData: txWithRaw.normalized,
        rawData: txWithRaw.raw,
        cursor: providerBatch.cursor,
      })),
      cursor: providerBatch.cursor,
      isComplete: providerBatch.cursor.metadata?.isComplete ?? false,
    });
  }
}

private async *streamTokenTransactions(
  address: string
): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
  const iterator = this.providerManager.executeWithFailoverStreaming<EvmTransaction>(
    this.chainConfig.chainName,
    {
      type: 'getAddressTokenTransactions',
      address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:token-txs:${params.type === 'getAddressTokenTransactions' ? params.address : 'unknown'}:all`,
    }
  );

  for await (const providerBatchResult of iterator) {
    if (providerBatchResult.isErr()) {
      yield err(providerBatchResult.error);
      return;
    }

    const providerBatch = providerBatchResult.value;
    const transactions = providerBatch.data as TransactionWithRawData<EvmTransaction>[];

    yield ok({
      rawTransactions: transactions.map((txWithRaw) => ({
        providerName: providerBatch.providerName,
        externalId: generateUniqueTransactionId(txWithRaw.normalized),
        transactionTypeHint: 'token',
        sourceAddress: address,
        normalizedData: txWithRaw.normalized,
        rawData: txWithRaw.raw,
        cursor: providerBatch.cursor,
      })),
      cursor: providerBatch.cursor,
      isComplete: providerBatch.cursor.metadata?.isComplete ?? false,
    });
  }
}

/**
 * Legacy batch import (deprecated)
 * Accumulates all batches from streaming implementation
 * @deprecated Use importStreaming instead
 */
async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
  const allTransactions: ExternalTransaction[] = [];
  let finalCursor: CursorState | undefined;

  // Consume streaming iterator
  for await (const batchResult of this.importStreaming(params)) {
    if (batchResult.isErr()) {
      return err(batchResult.error);
    }

    const batch = batchResult.value;
    allTransactions.push(...batch.rawTransactions);
    finalCursor = batch.cursor;
  }

  return ok({ rawTransactions: allTransactions, finalCursor });
}
```

### 4.3 Resume Logic

**File:** `packages/ingestion/src/services/import-service.ts`

Add method to find and resume from existing data source:

```typescript
/**
 * Find existing incomplete data source for resume
 *
 * Looks up the most recent 'started' or 'failed' data source for the same
 * source identifier (address/exchange) and extracts its cursor for resumption.
 *
 * @param sourceId - Address or exchange identifier
 * @param sourceType - 'blockchain' or 'exchange'
 * @returns Existing data source with cursor, or undefined if none found
 */
private async findResumableDataSource(
  sourceId: string,
  sourceType: 'blockchain' | 'exchange'
): Promise<{ dataSource: DataSource; cursor?: CursorState } | undefined> {
  // Query for most recent incomplete import
  const result = await this.dataSourceRepository.findLatestIncomplete(sourceId, sourceType);

  if (result.isErr()) {
    logger.warn('Failed to query for resumable data source', { error: getErrorMessage(result.error) });
    return undefined;
  }

  const dataSource = result.value;
  if (!dataSource) return undefined;

  logger.info(
    `Found resumable data source #${dataSource.id}`,
    {
      status: dataSource.status,
      transactionsImported: dataSource.transactionsImported,
      cursorProgress: dataSource.lastCursor?.totalFetched
    }
  );

  return { dataSource, cursor: dataSource.lastCursor };
}
```

**File:** `packages/data/src/repositories/data-source-repository.ts`

Add query method:

```typescript
/**
 * Find latest incomplete data source for resume
 * Status 'started' or 'failed' indicates incomplete import
 */
async findLatestIncomplete(
  sourceId: string,
  sourceType: 'blockchain' | 'exchange'
): Promise<Result<DataSource | undefined, Error>> {
  try {
    const row = await this.db
      .selectFrom('data_sources')
      .selectAll()
      .where('source_id', '=', sourceId)
      .where('source_type', '=', sourceType)
      .where('status', 'in', ['started', 'failed'])
      .orderBy('started_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!row) return ok(undefined);

    return ok({
      ...row,
      lastCursor: this.deserializeCursor(row.last_cursor),
    });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
```

### 4.4 Update Ingestion Service with Resume Support

**File:** `packages/ingestion/src/services/import-service.ts`

Implement streaming ingestion with crash recovery:

```typescript
/**
 * Streaming import with incremental batch persistence and crash recovery
 *
 * RESUME LOGIC:
 * 1. Check if params.cursor is provided (manual resume)
 * 2. If not, look up latest incomplete data source for this address/exchange
 * 3. If found, resume from its last_cursor
 * 4. Otherwise, start fresh import
 */
async importWithStreaming(params: ImportParams): Promise<Result<ImportResult, Error>> {
  const sourceId = params.address || 'api';
  const sourceType = params.address ? 'blockchain' : 'exchange';

  // ✅ STEP 1: Check for resumable data source
  let dataSource: DataSource;
  let resumeCursor: CursorState | undefined = params.cursor;
  let totalImported = 0;

  if (!resumeCursor) {
    // No cursor provided - check for resumable import
    const resumable = await this.findResumableDataSource(sourceId, sourceType);

    if (resumable) {
      dataSource = resumable.dataSource;
      resumeCursor = resumable.cursor;
      totalImported = dataSource.transactionsImported || 0;

      logger.info(
        `Resuming import from data source #${dataSource.id}`,
        { totalImported, cursorProgress: resumeCursor?.totalFetched }
      );

      // Update status back to 'started' (in case it was 'failed')
      await this.dataSourceRepository.update(dataSource.id, { status: 'started' });
    } else {
      // No resumable import - create new data source
      const createResult = await this.dataSourceRepository.create({
        sourceId,
        sourceType,
        providerName: params.providerName,
        status: 'started',
        startedAt: new Date(),
        importParams: params,
        lastCursor: undefined,
      });

      if (createResult.isErr()) {
        return err(createResult.error);
      }

      dataSource = createResult.value;
      logger.info(`Starting new import with data source #${dataSource.id}`);
    }
  } else {
    // Cursor provided explicitly - create new data source
    const createResult = await this.dataSourceRepository.create({
      sourceId,
      sourceType,
      providerName: params.providerName,
      status: 'started',
      startedAt: new Date(),
      importParams: params,
      lastCursor: resumeCursor,
    });

    if (createResult.isErr()) {
      return err(createResult.error);
    }

    dataSource = createResult.value;
  }

  let lastCursor: CursorState | undefined = resumeCursor;

  try {
    // ✅ STEP 2: Pass resume cursor to importer
    const importParams: ImportParams = {
      ...params,
      cursor: resumeCursor,
    };

    // Stream batches from importer
    const batchIterator = this.importer.importStreaming(importParams);

    for await (const batchResult of batchIterator) {
      if (batchResult.isErr()) {
        // Update data source with error
        await this.dataSourceRepository.update(dataSource.id, {
          status: 'failed',
          errorMessage: getErrorMessage(batchResult.error),
          lastCursor, // Preserve last successful cursor
        });
        return err(batchResult.error);
      }

      const batch = batchResult.value;

      // Save batch to database (with cursor)
      const saveResult = await this.rawDataRepository.saveBatch(
        batch.rawTransactions.map(tx => ({
          dataSourceId: dataSource.id,
          ...tx,
        }))
      );

      if (saveResult.isErr()) {
        await this.dataSourceRepository.update(dataSource.id, {
          status: 'failed',
          errorMessage: getErrorMessage(saveResult.error),
          lastCursor,
        });
        return err(saveResult.error);
      }

      totalImported += batch.rawTransactions.length;
      lastCursor = batch.cursor;

      // ✅ CRITICAL: Update progress and cursor after EACH batch
      // This enables resumption after crashes
      await this.dataSourceRepository.update(dataSource.id, {
        transactionsImported: totalImported,
        lastCursor: batch.cursor, // ✅ Persist cursor for resumability
      });

      this.logger.info(
        `Batch saved: ${batch.rawTransactions.length} transactions (total: ${totalImported})`,
        { cursorProgress: batch.cursor.totalFetched }
      );

      if (batch.isComplete) {
        this.logger.info('Import marked complete by provider');
        break;
      }
    }

    // Mark complete
    await this.dataSourceRepository.update(dataSource.id, {
      status: 'completed',
      completedAt: new Date(),
      lastCursor,
    });

    return ok({
      dataSourceId: dataSource.id,
      imported: totalImported,
    });

  } catch (error) {
    // Unexpected error (not from Result chain)
    this.logger.error('Unexpected error during streaming import', { error: getErrorMessage(error) });

    await this.dataSourceRepository.update(dataSource.id, {
      status: 'failed',
      errorMessage: getErrorMessage(error),
      lastCursor, // Preserve for potential manual recovery
    });

    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
```

---

## Phase 5: Provider Migration

### 5.1 Migration Order

Roll out streaming to remaining providers:

1. **Week 4: Moralis** (similar to Alchemy)
2. **Week 5: Subscan** (page-based, simpler)
3. **Week 6: NearBlocks, Blockstream, others**

### 5.2 Moralis Implementation

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/moralis/moralis.api-client.ts`

```typescript
@RegisterApiClient({
  // ... existing config ...
  capabilities: {
    supportedOperations: [...],
    supportedCursorTypes: ['pageToken', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { minutes: 5 },
  },
})
export class MoralisApiClient extends BaseApiClient {

  extractCursors(transaction: EvmTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    if (transaction.timestamp) {
      cursors.push({
        type: 'timestamp',
        value: new Date(transaction.timestamp).getTime()
      });
    }

    if (transaction.blockHeight) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
    }

    return cursors;
  }

  applyReplayWindow(cursor: PaginationCursor): PaginationCursor {
    const replayWindow = this.capabilities.replayWindow;
    if (!replayWindow) return cursor;

    if (cursor.type === 'timestamp') {
      const replayMs = (replayWindow.minutes || 0) * 60 * 1000;
      return {
        type: 'timestamp',
        value: Math.max(0, cursor.value - replayMs),
      };
    }

    return cursor;
  }

  async *executeStreaming(
    operation: ProviderOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
    // Implementation similar to Alchemy but uses Moralis cursor format
    // ...
  }
}
```

### 5.3 Subscan Implementation

**File:** `packages/blockchain-providers/src/blockchains/substrate/providers/subscan/subscan.api-client.ts`

```typescript
@RegisterApiClient({
  // ... existing config ...
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
    supportedCursorTypes: ['timestamp', 'blockNumber'],
    preferredCursorType: 'timestamp',
    replayWindow: { minutes: 5, blocks: 10 },
  },
})
export class SubscanApiClient extends BaseApiClient {
  extractCursors(transaction: SubstrateTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    if (transaction.timestamp) {
      cursors.push({
        type: 'timestamp',
        value: new Date(transaction.timestamp).getTime(),
      });
    }

    if (transaction.blockHeight) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
    }

    return cursors;
  }

  // Subscan uses simple page numbers, easier to implement
  async *executeStreaming(
    operation: ProviderOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<{
    data: TransactionWithRawData<SubstrateTransaction>[];
    cursor: CursorState;
  }> {
    // Start from page 0 or resume from cursor
    let page = 0;
    let totalFetched = resumeCursor?.totalFetched || 0;

    if (resumeCursor) {
      // Calculate page from timestamp if failing over
      // Or use exact page if same provider (future optimization)
    }

    const maxPages = 100;
    const rowsPerPage = 100;

    while (page < maxPages) {
      const body = {
        address: operation.address,
        page: page,
        row: rowsPerPage,
      };

      const result = await this.httpClient.post<SubscanTransfersResponse>('/api/v2/scan/transfers', body, {
        schema: SubscanTransfersResponseSchema,
      });

      if (result.isErr()) {
        yield err(result.error);
        return;
      }

      const response = result.value;
      if (response.code !== 0) {
        yield err(new Error(`Subscan API error: ${response.message || `Code ${response.code}`}`));
        return;
      }

      const transfers = response.data?.transfers || [];
      if (transfers.length === 0) break;

      // Map transfers
      const transactions: TransactionWithRawData<SubstrateTransaction>[] = [];
      for (const transfer of transfers) {
        const mapResult = convertSubscanTransaction(
          transfer,
          {},
          new Set([operation.address]),
          this.chainConfig,
          this.chainConfig.nativeCurrency,
          this.chainConfig.nativeDecimals
        );

        if (mapResult.isOk()) {
          transactions.push({
            raw: transfer,
            normalized: mapResult.value,
          });
        }
      }

      totalFetched += transactions.length;

      // Extract cursors
      const lastTx = transactions[transactions.length - 1];
      const cursors = this.extractCursors(lastTx.normalized);

      const cursorState: CursorState = {
        primary: cursors.find((c) => c.type === 'timestamp')!,
        alternatives: cursors,
        lastTransactionId: lastTx.normalized.id,
        totalFetched,
        metadata: {
          providerName: this.name,
          updatedAt: Date.now(),
          isComplete: transfers.length < rowsPerPage,
        },
      };

      // ✅ Yield Result-wrapped batch
      yield ok({
        data: transactions,
        cursor: cursorState,
      });

      if (transfers.length < rowsPerPage) break;
      page++;
    }
  }
}
```

---

## Phase 6: Testing

### 6.1 Unit Tests - Cursor System

**File:** `packages/blockchain-providers/src/core/types/__tests__/cursor.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import type { PaginationCursor, CursorState } from '../cursor.js';

describe('Cursor Types', () => {
  describe('PaginationCursor', () => {
    it('should support blockNumber cursor', () => {
      const cursor: PaginationCursor = { type: 'blockNumber', value: 15000000 };
      expect(cursor.type).toBe('blockNumber');
      expect(cursor.value).toBe(15000000);
    });

    it('should support timestamp cursor', () => {
      const cursor: PaginationCursor = { type: 'timestamp', value: 1640000000000 };
      expect(cursor.type).toBe('timestamp');
    });

    it('should support txHash cursor', () => {
      const cursor: PaginationCursor = { type: 'txHash', value: '0xabc123' };
      expect(cursor.type).toBe('txHash');
    });

    it('should support pageToken with providerName', () => {
      const cursor: PaginationCursor = {
        type: 'pageToken',
        value: 'xyz789',
        providerName: 'alchemy',
      };
      expect(cursor.type).toBe('pageToken');
      expect(cursor.providerName).toBe('alchemy');
    });
  });

  describe('CursorState', () => {
    it('should contain primary and alternative cursors', () => {
      const state: CursorState = {
        primary: { type: 'pageToken', value: 'xyz', providerName: 'alchemy' },
        alternatives: [
          { type: 'blockNumber', value: 15000000 },
          { type: 'timestamp', value: 1640000000000 },
        ],
        lastTransactionId: 'tx-123',
        totalFetched: 500,
        metadata: {
          providerName: 'alchemy',
          updatedAt: Date.now(),
          isComplete: false,
        },
      };

      expect(state.alternatives).toHaveLength(2);
      expect(state.totalFetched).toBe(500);
    });

    it('should serialize and deserialize correctly', () => {
      const state: CursorState = {
        primary: { type: 'blockNumber', value: 100 },
        lastTransactionId: 'tx-1',
        totalFetched: 10,
      };

      const serialized = JSON.stringify(state);
      const deserialized = JSON.parse(serialized) as CursorState;

      expect(deserialized.primary.type).toBe('blockNumber');
      expect(deserialized.totalFetched).toBe(10);
    });
  });
});
```

### 6.2 Unit Tests - Provider Manager

**File:** `packages/blockchain-providers/src/core/__tests__/provider-manager-streaming.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BlockchainProviderManager } from '../provider-manager.js';
import type { IBlockchainProvider, CursorState } from '../types/index.js';

describe('ProviderManager - Streaming', () => {
  let manager: BlockchainProviderManager;

  beforeEach(() => {
    manager = new BlockchainProviderManager(undefined);
  });

  describe('Cursor Compatibility', () => {
    it('should accept provider with matching cursor type', () => {
      const provider: IBlockchainProvider = {
        name: 'test-provider',
        blockchain: 'ethereum',
        capabilities: {
          supportedOperations: ['getAddressTransactions'],
          supportedCursorTypes: ['blockNumber', 'timestamp'],
          preferredCursorType: 'blockNumber',
        },
        executeStreaming: vi.fn(),
        extractCursors: vi.fn(),
        applyReplayWindow: vi.fn(),
        execute: vi.fn(),
      };

      const cursor: CursorState = {
        primary: { type: 'blockNumber', value: 100 },
        lastTransactionId: 'tx-1',
        totalFetched: 10,
      };

      // Access private method via type assertion for testing
      const canResume = (manager as any).canProviderResume(provider, cursor);
      expect(canResume).toBe(true);
    });

    it('should reject provider with incompatible cursor type', () => {
      const provider: IBlockchainProvider = {
        name: 'test-provider',
        blockchain: 'ethereum',
        capabilities: {
          supportedOperations: ['getAddressTransactions'],
          supportedCursorTypes: ['pageToken'],
          preferredCursorType: 'pageToken',
        },
        executeStreaming: vi.fn(),
        extractCursors: vi.fn(),
        applyReplayWindow: vi.fn(),
        execute: vi.fn(),
      };

      const cursor: CursorState = {
        primary: { type: 'blockNumber', value: 100 },
        lastTransactionId: 'tx-1',
        totalFetched: 10,
      };

      const canResume = (manager as any).canProviderResume(provider, cursor);
      expect(canResume).toBe(false);
    });

    it('should accept provider if alternative cursor matches', () => {
      const provider: IBlockchainProvider = {
        name: 'test-provider',
        blockchain: 'ethereum',
        capabilities: {
          supportedOperations: ['getAddressTransactions'],
          supportedCursorTypes: ['timestamp'],
          preferredCursorType: 'timestamp',
        },
        executeStreaming: vi.fn(),
        extractCursors: vi.fn(),
        applyReplayWindow: vi.fn(),
        execute: vi.fn(),
      };

      const cursor: CursorState = {
        primary: { type: 'pageToken', value: 'xyz', providerName: 'alchemy' },
        alternatives: [{ type: 'timestamp', value: 1640000000000 }],
        lastTransactionId: 'tx-1',
        totalFetched: 10,
      };

      const canResume = (manager as any).canProviderResume(provider, cursor);
      expect(canResume).toBe(true);
    });
  });

  describe('Failover', () => {
    it('should switch providers mid-pagination', async () => {
      // Test implementation for failover scenario
      // Mock first provider to fail after 2 batches
      // Mock second provider to continue from cursor
      // Verify deduplication works
    });
  });
});
```

### 6.3 Integration Tests

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/alchemy/__tests__/alchemy-streaming.e2e.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { AlchemyApiClient } from '../alchemy.api-client.js';

describe('Alchemy - Streaming E2E', () => {
  it('should stream transactions with cursor', async () => {
    const client = new AlchemyApiClient({
      blockchain: 'ethereum',
      name: 'alchemy',
      baseUrl: 'https://eth-mainnet.g.alchemy.com/v2',
      apiKey: process.env.ALCHEMY_API_KEY!,
    });

    const batches: any[] = [];
    const iterator = client.executeStreaming({
      type: 'getAddressTransactions',
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    });

    let batchCount = 0;
    for await (const batch of iterator) {
      batches.push(batch);
      batchCount++;

      // Verify cursor exists
      expect(batch.cursor).toBeDefined();
      expect(batch.cursor.primary).toBeDefined();
      expect(batch.cursor.lastTransactionId).toBeDefined();

      if (batchCount >= 3) break; // Test first 3 batches
    }

    expect(batches.length).toBeGreaterThan(0);
  });

  it('should resume from cursor', async () => {
    // Test resumability
    // 1. Fetch first 2 batches
    // 2. Save cursor from batch 2
    // 3. Create new client instance
    // 4. Resume from saved cursor
    // 5. Verify no duplicates
  });
});
```

**File:** `packages/ingestion/src/infrastructure/blockchains/evm/__tests__/importer-streaming.test.ts`

Add regression test to ensure all transaction categories stream:

```typescript
it('streams normal, internal, and token batches', async () => {
  const importer = new EvmImporter(chainConfig, providerManager);
  mockProviderManager(providerManager, [
    { op: 'getAddressTransactions', transactions: fakeNormalTxs },
    { op: 'getAddressInternalTransactions', transactions: fakeInternalTxs },
    { op: 'getAddressTokenTransactions', transactions: fakeTokenTxs },
  ]);

  const hints: string[] = [];
  for await (const batchResult of importer.importStreaming({ address: '0xabc' })) {
    expect(batchResult.isOk()).toBe(true);
    hints.push(...batchResult.value.rawTransactions.map((tx) => tx.transactionTypeHint!));
  }

  expect(hints).toEqual(['normal', 'internal', 'token']);
});
```

---

## Phase 7: Documentation & Rollout

### 7.1 Update CLAUDE.md

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

### 7.2 Create Migration Guide

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
- ✅ Cursor state persists correctly in `data_sources.last_cursor`
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
