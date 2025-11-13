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
