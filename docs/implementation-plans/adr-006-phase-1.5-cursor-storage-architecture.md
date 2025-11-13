# Implementation Plan: ADR-006 Phase 1.5 - Cursor Storage Architecture

**Status:** Ready for Implementation
**Phase:** 1.5 (Foundation for streaming pagination)
**ADR:** [ADR-006: Streaming Pagination with Typed Cursors](../adr/006-streaming-pagination-with-typed-cursors.md)
**Created:** 2025-01-12

---

## Executive Summary

This phase redesigns cursor storage to support per-operation-type resumption for both blockchain and exchange imports. The key changes:

1. **Convert `data_sources.last_cursor` to a map** - Store cursor per operation type instead of single cursor
2. **Remove `external_transaction_data.cursor` field** - Eliminate per-record cursor storage (~99.995% storage reduction)
3. **Unified architecture** - Blockchains and exchanges use the same cursor storage pattern

**Impact:**

- **Storage:** 10 MB → 500 bytes cursor storage per import session (100k transactions)
- **Performance:** Direct cursor lookup instead of aggregate query across all records
- **Resumption:** Each operation type (normal/internal/token for blockchains, trade/deposit/withdrawal for exchanges) can resume independently

---

## Background

### Current State

**Two cursor fields exist:**

1. **`data_sources.last_cursor`** - Single `CursorState` for blockchain resumption (not yet used)
2. **`external_transaction_data.cursor`** - Per-record cursor for exchange resumption (actively used)

**Current exchange resumption flow:**

```typescript
// Aggregate cursors from ALL transaction records
const latestCursor = await rawDataRepository.getLatestCursor(dataSourceId);
// Returns: { trade: 1704075000000, deposit: 1704071600000, ... }
```

**Problem:** Blockchains also need per-operation cursors:

- Normal transactions
- Internal transactions
- Token transfers

But the ADR only passes cursor to normal transactions - internal/token always restart from scratch on crash.

### Design Discovery

**Key insight:** Both blockchains and exchanges have the same pattern:

- Multiple operation types fetched independently or sequentially
- Each operation type has its own pagination state
- Need to resume each operation type from its last position

**Current inefficiencies:**

- Per-record cursor storage: 100k records × 100 bytes = ~10 MB
- Aggregate query scans all records on every resume
- No authoritative "current cursor" location

---

## Design Decisions

### 1. Per-Operation Cursor Map

**Change `data_sources.last_cursor` from single cursor to map:**

```typescript
// Before (ADR Phase 1.0)
lastCursor: CursorState | undefined;

// After (Phase 1.5)
lastCursor: Record<string, CursorState> | undefined;
```

**Example JSON in database:**

```json
{
  "normal": {
    "primary": { "type": "blockNumber", "value": 12345 },
    "lastTransactionId": "0xabc...",
    "totalFetched": 100000,
    "metadata": { "providerName": "alchemy", "updatedAt": 1704067200 }
  },
  "internal": {
    "primary": { "type": "blockNumber", "value": 12340 },
    "lastTransactionId": "0xdef...",
    "totalFetched": 42000,
    "metadata": { "providerName": "alchemy", "updatedAt": 1704067300 }
  },
  "token": {
    "primary": { "type": "blockNumber", "value": 12338 },
    "lastTransactionId": "0x123...",
    "totalFetched": 15000,
    "metadata": { "providerName": "alchemy", "updatedAt": 1704067400 }
  }
}
```

**For exchanges:**

```json
{
  "trade": {
    "primary": { "type": "timestamp", "value": 1704075000000 },
    "lastTransactionId": "TRADE-12345",
    "totalFetched": 50000,
    "metadata": { "providerName": "kraken", "updatedAt": 1704067200 }
  },
  "deposit": {
    "primary": { "type": "timestamp", "value": 1704071600000 },
    "lastTransactionId": "DEPOSIT-789",
    "totalFetched": 1200,
    "metadata": { "providerName": "kraken", "updatedAt": 1704067250 }
  }
}
```

**Advantages:**

- ✅ Each operation type resumes independently
- ✅ Crash during internal/token fetch doesn't lose progress
- ✅ Direct lookup by operation type (no aggregation)
- ✅ Clear, type-safe structure
- ✅ Works for both blockchains and exchanges

### 2. Remove Per-Record Cursor Storage

**Delete `external_transaction_data.cursor` field entirely.**

**Rationale:**

- **Not used after aggregation** - Only purpose is `getLatestCursor()` which becomes obsolete
- **Massive storage waste** - 10 MB vs 500 bytes per import session
- **Slower resume** - Must scan all records to aggregate
- **No debugging value** - External IDs + timestamps + provider logs provide sufficient audit trail

**Migration:**

- Remove column from schema
- Delete `getLatestCursor()` method
- Update exchange imports to use `data_sources.last_cursor` map

### 3. Incremental Cursor Updates

**Update cursor after each batch, not just at session end.**

**Critical for crash recovery:**

```typescript
// During import streaming loop
for await (const batchResult of importer.importStreaming(params)) {
  const batch = batchResult.value;

  // 1. Save transactions
  await rawDataRepository.saveBatch(dataSourceId, batch.rawTransactions);

  // 2. Update cursor immediately
  await dataSourceRepository.updateCursor(dataSourceId, operationType, batch.cursor);
}
```

**Why this matters:**

- Crash after batch 50/100: Resume from batch 50 (not restart all 100)
- Cursor always reflects last successfully saved batch
- No drift between saved transactions and cursor position

---

## Implementation Steps

### Step 1: Update Core Schemas

**File:** `packages/core/src/schemas/data-source.ts`

```typescript
import { CursorStateSchema } from './cursor.js';

export const DataSourceSchema = z.object({
  id: z.number(),
  sourceId: z.string(),
  sourceType: SourceTypeSchema,
  status: DataSourceStatusSchema,
  startedAt: z.date(),
  completedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date().optional(),
  durationMs: z.number().optional(),
  errorMessage: z.string().optional(),
  errorDetails: z.unknown().optional(),
  importParams: DataImportParamsSchema,
  importResultMetadata: ImportResultMetadataSchema,
  lastBalanceCheckAt: z.date().optional(),
  verificationMetadata: VerificationMetadataSchema.optional(),

  // CHANGED: Map of cursors per operation type
  lastCursor: z.record(z.string(), CursorStateSchema).optional(),
});
```

**File:** `packages/core/src/schemas/external-transaction-data.ts`

```typescript
export const ExternalTransactionSchema = z.object({
  providerName: z.string().min(1, 'Provider Name must not be empty'),
  sourceAddress: z.string().optional(),
  transactionTypeHint: z.string().optional(),
  externalId: z.string().min(1, 'External ID must not be empty'),
  // REMOVED: cursor field
  rawData: z.unknown(),
  normalizedData: z.unknown(),
});
```

### Step 2: Update Database Schema

**File:** `packages/data/src/migrations/001_initial_schema.ts`

```typescript
// data_sources table - line 23
.addColumn('last_cursor', 'text') // Still JSON, now stores Record<string, CursorState>

// external_transaction_data table - REMOVE line 37
// .addColumn('cursor', 'text')  // DELETE THIS LINE
```

**Comment update:**

```typescript
.addColumn('last_cursor', 'text') // JSON: Record<operationType, CursorState> for per-operation resumption
```

### Step 3: Update Repository - Cursor Management

**File:** `packages/ingestion/src/persistence/data-source-repository.ts`

**Add new method:**

```typescript
/**
 * Update cursor for a specific operation type
 * Merges with existing cursors to support multi-operation imports
 */
async updateCursor(
  dataSourceId: number,
  operationType: string,
  cursor: CursorState
): Promise<Result<void, Error>> {
  try {
    // Load current cursors
    const dataSourceResult = await this.findById(dataSourceId);
    if (dataSourceResult.isErr()) {
      return err(dataSourceResult.error);
    }

    const dataSource = dataSourceResult.value;
    if (!dataSource) {
      return err(new Error(`Data source ${dataSourceId} not found`));
    }

    // Merge with existing cursors
    const updatedCursors = {
      ...(dataSource.lastCursor ?? {}),
      [operationType]: cursor,
    };

    // Validate merged structure
    const validationResult = z.record(z.string(), CursorStateSchema).safeParse(updatedCursors);
    if (!validationResult.success) {
      return err(new Error(`Invalid cursor map: ${validationResult.error.message}`));
    }

    // Persist
    await this.db
      .updateTable('data_sources')
      .set({
        last_cursor: JSON.stringify(validationResult.data),
        updated_at: this.getCurrentDateTimeForDB(),
      })
      .where('id', '=', dataSourceId)
      .execute();

    return ok();
  } catch (error) {
    return wrapError(error, 'Failed to update cursor');
  }
}
```

**Update existing methods:**

```typescript
// Deserialization now handles map structure
private deserializeCursor(cursorJson: unknown): Result<Record<string, CursorState> | undefined, Error> {
  if (!cursorJson) {
    return ok(undefined);
  }

  if (typeof cursorJson !== 'string') {
    return err(new Error('Cursor must be a JSON string'));
  }

  const parsedResult = this.parseWithSchema(
    cursorJson,
    z.record(z.string(), CursorStateSchema)
  );

  if (parsedResult.isErr()) {
    return err(new Error(`Invalid cursor map in database: ${parsedResult.error.message}`));
  }

  return ok(parsedResult.value);
}

// Serialization
private serializeCursor(cursor: Record<string, CursorState> | undefined): string | undefined {
  return cursor ? this.serializeToJson(cursor) : undefined;
}
```

### Step 4: Remove getLatestCursor Method

**File:** `packages/ingestion/src/persistence/raw-data-repository.ts`

**Delete:**

- `getLatestCursor()` method (lines 190-228)
- Test file: `__tests__/raw-data-repository-cursor.test.ts` (entire file)

**File:** `packages/ingestion/src/types/repositories.ts`

**Remove from interface:**

```typescript
export interface IRawDataRepository {
  // DELETE: getLatestCursor(dataSourceId: number): Promise<Result<Record<string, number> | null, Error>>;
  // Keep all other methods...
}
```

### Step 5: Update Exchange Import Service

**File:** `packages/ingestion/src/services/import-service.ts`

**Replace lines 212-219:**

```typescript
// OLD: Aggregate cursors from transaction records
let latestCursor: Record<string, number> | undefined = undefined;
if (existingDataSource) {
  const latestCursorResult = await this.rawDataRepository.getLatestCursor(existingDataSource.id);
  if (latestCursorResult.isOk() && latestCursorResult.value) {
    latestCursor = latestCursorResult.value;
  }
}

// NEW: Read cursors from data source
let latestCursors: Record<string, CursorState> | undefined = undefined;
if (existingDataSource?.lastCursor) {
  latestCursors = existingDataSource.lastCursor;
}
```

**Update import loop to persist cursors incrementally:**

```typescript
// After saving each batch
const savedCountResult = await this.rawDataRepository.saveBatch(dataSourceId, rawData);
if (savedCountResult.isErr()) {
  return err(savedCountResult.error);
}

// NEW: Update cursor after successful batch save
if (importResult.cursor && importResult.operationType) {
  const cursorUpdateResult = await this.dataSourceRepository.updateCursor(
    dataSourceId,
    importResult.operationType,
    importResult.cursor
  );

  if (cursorUpdateResult.isErr()) {
    this.logger.warn(`Failed to update cursor for ${importResult.operationType}: ${cursorUpdateResult.error.message}`);
    // Don't fail the import, just log warning
  }
}
```

### Step 6: Update Exchange Importers

**File:** `packages/ingestion/src/infrastructure/exchanges/*/importer.ts`

**Update import signature to return operation type:**

```typescript
export interface ImportBatchResult {
  rawTransactions: ExternalTransaction[];
  cursor?: CursorState; // NEW: Structured cursor instead of Record<string, number>
  operationType?: string; // NEW: Which operation type this batch belongs to
  metadata?: Record<string, unknown>;
}
```

**Example for Kraken:**

```typescript
async import(params: ImportParams): Promise<Result<ImportResult, Error>> {
  // ... fetch trades ...

  return ok({
    rawTransactions: tradeTransactions,
    cursor: {
      primary: { type: 'timestamp', value: maxTradeTimestamp },
      lastTransactionId: lastTradeId,
      totalFetched: tradeTransactions.length,
      metadata: { providerName: 'kraken', updatedAt: Date.now() }
    },
    operationType: 'trade', // NEW
    metadata: { /* ... */ }
  });
}
```

### Step 7: Update Blockchain Importer Interface

**File:** `packages/ingestion/src/types/importers.ts`

**Update to support per-operation resumption:**

```typescript
export interface ImportParams {
  address?: string;
  csvDirectories?: string[];
  credentials?: Record<string, unknown>;
  providerName?: string;

  // CHANGED: Now a map of cursors
  cursor?: Record<string, CursorState>;
}
```

**Update blockchain importer usage:**

```typescript
async *importStreaming(params: ImportParams) {
  const address = params.address!;

  // Extract operation-specific cursors
  const normalCursor = params.cursor?.['normal'];
  const internalCursor = params.cursor?.['internal'];
  const tokenCursor = params.cursor?.['token'];

  // Stream with operation-specific resumption
  for await (const batch of this.streamNormalTransactions(address, normalCursor)) {
    yield batch;
  }

  for await (const batch of this.streamInternalTransactions(address, internalCursor)) {
    yield batch;
  }

  for await (const batch of this.streamTokenTransactions(address, tokenCursor)) {
    yield batch;
  }
}
```

### Step 8: Update Database Schema Types

**File:** `packages/data/src/schema/database-schema.ts`

```typescript
export interface DataSourcesTable {
  id: Generated<number>;
  source_id: string;
  source_type: string;
  provider_name: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  transactions_imported: number;
  transactions_failed: number;
  error_message: string | null;
  error_details: string | null;
  import_params: string;
  import_result_metadata: string;
  last_cursor: string | null; // UPDATED: Now stores Record<string, CursorState>
  last_balance_check_at: string | null;
  verification_metadata: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface ExternalTransactionDataTable {
  id: Generated<number>;
  data_source_id: number;
  provider_name: string;
  external_id: string;
  // REMOVED: cursor: string | null;
  source_address: string | null;
  transaction_type_hint: string | null;
  raw_data: string;
  normalized_data: string;
  processing_status: string;
  processed_at: string | null;
  processing_error: string | null;
  created_at: string;
}
```

### Step 9: Update Tests

**Delete:**

- `packages/ingestion/src/persistence/__tests__/raw-data-repository-cursor.test.ts`

**Update:**

- `packages/ingestion/src/services/__tests__/import-service.test.ts`
  - Remove `getLatestCursor` mocks
  - Add `updateCursor` mocks
  - Update test expectations for map-based cursors

**Add new test file:**

**File:** `packages/ingestion/src/persistence/__tests__/data-source-repository-cursor.test.ts`

```typescript
import { createDatabase, runMigrations, type KyselyDB } from '@exitbook/data';
import type { CursorState } from '@exitbook/core';
import { beforeEach, describe, expect, test } from 'vitest';

import { DataSourceRepository } from '../data-source-repository.js';

describe('DataSourceRepository - Cursor Map Management', () => {
  let db: KyselyDB;
  let repository: DataSourceRepository;
  let dataSourceId: number;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    await runMigrations(db);
    repository = new DataSourceRepository(db);

    // Create test data source
    const result = await repository.create('ethereum', 'blockchain', {});
    if (result.isErr()) throw result.error;
    dataSourceId = result.value;
  });

  describe('updateCursor', () => {
    test('should store cursor for single operation type', async () => {
      const cursor: CursorState = {
        primary: { type: 'blockNumber', value: 12345 },
        lastTransactionId: '0xabc',
        totalFetched: 100,
        metadata: { providerName: 'alchemy', updatedAt: Date.now() },
      };

      const result = await repository.updateCursor(dataSourceId, 'normal', cursor);
      expect(result.isOk()).toBe(true);

      // Verify stored
      const dataSourceResult = await repository.findById(dataSourceId);
      expect(dataSourceResult.isOk()).toBe(true);
      expect(dataSourceResult.value?.lastCursor).toEqual({
        normal: cursor,
      });
    });

    test('should merge cursors for multiple operation types', async () => {
      const normalCursor: CursorState = {
        primary: { type: 'blockNumber', value: 12345 },
        lastTransactionId: '0xabc',
        totalFetched: 100,
        metadata: { providerName: 'alchemy', updatedAt: Date.now() },
      };

      const internalCursor: CursorState = {
        primary: { type: 'blockNumber', value: 12340 },
        lastTransactionId: '0xdef',
        totalFetched: 50,
        metadata: { providerName: 'alchemy', updatedAt: Date.now() },
      };

      await repository.updateCursor(dataSourceId, 'normal', normalCursor);
      await repository.updateCursor(dataSourceId, 'internal', internalCursor);

      const dataSourceResult = await repository.findById(dataSourceId);
      expect(dataSourceResult.isOk()).toBe(true);
      expect(dataSourceResult.value?.lastCursor).toEqual({
        normal: normalCursor,
        internal: internalCursor,
      });
    });

    test('should update existing cursor for operation type', async () => {
      const cursor1: CursorState = {
        primary: { type: 'blockNumber', value: 100 },
        lastTransactionId: '0x1',
        totalFetched: 50,
        metadata: { providerName: 'alchemy', updatedAt: Date.now() },
      };

      const cursor2: CursorState = {
        primary: { type: 'blockNumber', value: 200 },
        lastTransactionId: '0x2',
        totalFetched: 100,
        metadata: { providerName: 'alchemy', updatedAt: Date.now() },
      };

      await repository.updateCursor(dataSourceId, 'normal', cursor1);
      await repository.updateCursor(dataSourceId, 'normal', cursor2);

      const dataSourceResult = await repository.findById(dataSourceId);
      expect(dataSourceResult.value?.lastCursor?.['normal']).toEqual(cursor2);
    });

    test('should return error for non-existent data source', async () => {
      const cursor: CursorState = {
        primary: { type: 'blockNumber', value: 12345 },
        lastTransactionId: '0xabc',
        totalFetched: 100,
      };

      const result = await repository.updateCursor(99999, 'normal', cursor);
      expect(result.isErr()).toBe(true);
    });
  });
});
```

---

## Migration Path

### Database Migration

**No data migration needed** - database is dropped during development per CLAUDE.md.

Just update `001_initial_schema.ts`:

```typescript
// Remove cursor from external_transaction_data
await db.schema
  .createTable('external_transaction_data')
  .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
  .addColumn('data_source_id', 'integer', (col) => col.notNull().references('data_sources.id'))
  .addColumn('provider_name', 'text', (col) => col.notNull())
  .addColumn('external_id', 'text', (col) => col.notNull())
  // REMOVED: .addColumn('cursor', 'text')
  .addColumn('source_address', 'text')
  // ... rest of columns
  .execute();
```

### Code Migration

**Step-by-step:**

1. Update schemas (no runtime impact)
2. Update repository with new `updateCursor()` method
3. Remove `getLatestCursor()` method
4. Update import service to use new cursor map
5. Update exchange importers to return operation type
6. Run tests and verify cursor persistence

### Backwards Compatibility

**Breaking changes:**

- Exchange importers must update return type to include `operationType`
- Blockchain importers must update to accept cursor map
- Any code calling `getLatestCursor()` must be updated

**Migration strategy:**

- This is internal API - no external consumers
- Update all importers atomically
- Database schema change is additive (map structure stored as JSON)

---

## Success Criteria

- ✅ `data_sources.last_cursor` stores map of cursors per operation type
- ✅ `external_transaction_data.cursor` column removed from schema
- ✅ `getLatestCursor()` method deleted
- ✅ Exchange imports update cursor after each batch
- ✅ Blockchain imports can resume each operation type independently
- ✅ All tests pass with new cursor architecture
- ✅ Storage savings: ~99.995% reduction in cursor storage (10 MB → 500 bytes per session)
- ✅ Performance improvement: Direct cursor lookup (no aggregation query)

### Verification Commands

```bash
# Run all tests
pnpm test

# Verify schema changes
pnpm build

# Test exchange import with resumption
pnpm run dev import --exchange kraken --api-key KEY --api-secret SECRET --process

# Verify cursor persistence (check database)
sqlite3 apps/cli/data/transactions.db "SELECT id, source_id, last_cursor FROM data_sources;"
```

---

## Future Work (Phase 2.0+)

This phase lays the foundation for:

- **Streaming pagination implementation** - Use cursor map for incremental batch processing
- **Provider failover** - Resume with different provider using compatible cursor type
- **Parallel operation fetch** - Fetch normal/internal/token concurrently (if providers support it)
- **Progress reporting** - Show per-operation progress (e.g., "Normal: 100k, Internal: 42k, Token: 15k")

---

## Notes

- Cursor map stored as JSON text column (SQLite doesn't have native JSON type)
- Operation type names are string keys - use constants to avoid typos
- Cursor updates are incremental - no need to load all cursors to update one
- Empty map (`{}`) vs `null` - both represent "no cursor", prefer `null` for clarity
