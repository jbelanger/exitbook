# Import Pipeline Refactoring: Normalization & Pagination

**Status:** Partially Implemented - See Implementation Status Below
**Author:** System Architecture
**Date:** 2025-10-04
**Last Updated:** 2025-10-17
**Target Version:** 2.0.0

---

## Implementation Status

### ✅ **Completed (as of 2025-10-17)**

- **Normalization merged into import phase**: API clients now normalize data immediately during fetch
  - Each API client instantiates its own mapper (e.g., `BlockstreamTransactionMapper`)
  - Validation with Zod happens during import (fail-fast on invalid data)
  - Both `raw` and `normalized` data stored in `external_transaction_data`
  - Processing phase now loads pre-normalized data
  - Related commit: `afdcefd - feat: Enhance transaction handling with normalization and raw data support`

### ⏳ **Planned / Not Yet Implemented**

The following features described in this document are **future work** and not yet implemented:

- Externalized pagination from API clients (clients still have internal pagination loops)
- Service-level pagination orchestration
- Typed, cross-provider compatible pagination cursors
- Resumable imports with cursor persistence
- Progress tracking via transaction count queries
- Per-page metrics and observability enhancements
- Replay windows for failover

---

## Executive Summary

This document outlines a comprehensive refactoring of the import pipeline to address critical architectural issues with data normalization and pagination. **Normalization has been successfully merged into the import phase**. The remaining work focuses on externalizing pagination control to enable parallelizable, resumable, and more robust data imports.

**Key Changes:**

- ✅ **DONE:** Merge normalization into import phase (fail-fast validation)
- ⏳ **TODO:** Remove internal pagination from API clients (return one page at a time)
- ⏳ **TODO:** Implement service-level pagination orchestration (parallelizable across providers)
- ✅ **DONE:** Store both normalized and raw data for audit trail
- ⏳ **TODO:** Support resumable imports with typed, cross-provider compatible pagination cursors
- ⏳ **TODO:** Enforce strict deduplication with canonical dedup keys
- ⏳ **TODO:** Add progress tracking via optional transaction count queries
- ⏳ **TODO:** Enhance observability with per-page metrics and progress indicators

**Validation Status:** ✅ Reviewed & Approved (2025-10-04)

- Architecture aligns with existing abstractions (mapper factory, provider manager)
- Plan fits current data flow and repository patterns
- **Enhanced with cross-provider cursor compatibility** - cursors typed by semantics, not provider
- Quick wins from architectural review integrated throughout

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current Architecture](#current-architecture)
3. [Identified Issues](#identified-issues)
4. [Proposed Solution](#proposed-solution)
5. [Technical Design](#technical-design)
6. [Implementation Plan](#implementation-plan)
7. [Migration Strategy](#migration-strategy)
8. [Testing Strategy](#testing-strategy)
9. [Risk Assessment](#risk-assessment)

---

## 1. Problem Statement

### 1.1 Normalization Issues

The current pipeline separates data fetching and normalization into distinct phases:

```
Import → Store Raw Data → (Later) Normalize → Process → Store Transactions
```

**Problems:**

1. **Deferred validation** - Invalid API data is stored and only discovered during processing
2. **Missing metadata** - Cannot extract pagination cursors (tx hash, block number) during import
3. **Redundant work** - Must parse/validate raw data twice (once for pagination, again for normalization)
4. **Late failures** - Processing fails on bad data that should have been rejected during import

**Example Issue:**

```typescript
// During import - blindly store raw data
await rawDataRepository.save(sessionId, rawApiResponse); // No validation!

// Later during processing - normalization fails
const normalizeResult = normalizer.normalize(rawData);
if (normalizeResult.isErr()) {
  // Too late! Bad data already stored, session marked complete
  return err(normalizeResult.error);
}
```

### 1.2 Pagination Issues

API clients currently implement internal pagination loops:

```typescript
// Current: Provider handles ALL pagination internally
async getAddressTransactions(address: string): Promise<Transaction[]> {
  const allTxs = [];
  let cursor = undefined;

  while (hasMore) {
    const page = await fetchPage(address, cursor);
    allTxs.push(...page);
    cursor = getNextCursor(page);
    hasMore = page.length > 0;
  }

  return allTxs; // Returns ALL data
}
```

**Problems:**

1. **Non-parallelizable** - Once a provider starts, it owns pagination until completion
2. **No failover during pagination** - If provider fails mid-pagination, lose all progress
3. **Client-controlled `since` parameter is a footgun** - Portfolio apps require complete transaction history; letting clients pass arbitrary `since` values creates data completeness gaps and inconsistent behavior across providers
4. **Memory issues** - Loading thousands of transactions into memory before processing
5. **No progress tracking** - Cannot resume interrupted imports

**Example: Provider `since` parameter inconsistency**

```typescript
// Alchemy: Hardcoded fromBlock: '0x0' - completely ignores since parameter
const fromParams: AlchemyAssetTransferParams = {
  fromBlock: '0x0', // ❌ Always fetches from genesis
  toBlock: 'latest',
  // ...
};

// Even when providers DO respect since, client-controlled values are dangerous:
// - Client passes since=yesterday → Misses historical transactions
// - Different clients pass different values → Inconsistent portfolio state
// - No enforcement of completeness → Silent data loss
```

---

## 2. Current Architecture (As Implemented)

### 2.1 Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: Import (Fetch + Normalize)                             │
│                                                                  │
│  Importer → API Client (internal pagination loop)               │
│              ↓                                                   │
│          For each transaction:                                   │
│            - Fetch raw data                                      │
│            - Mapper.map() → Zod validation → Normalize          │
│            - Return TransactionWithRawData { raw, normalized }  │
│              ↓                                                   │
│  Store: external_transaction_data { raw_data, normalized_data } │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: Process (Convert to Universal Format)                  │
│                                                                  │
│  Load normalized_data → Processor → UniversalTransaction        │
│                                                                  │
│  Output: transactions table                                     │
└─────────────────────────────────────────────────────────────────┘
```

**Key Implementation Details:**

- ✅ **Normalization happens during import**: API clients call `mapper.map()` for each transaction
- ✅ **Fail-fast validation**: Zod validation in mapper catches invalid data immediately
- ✅ **Dual storage**: Both `raw_data` and `normalized_data` stored for audit trail
- ⚠️ **Internal pagination still exists**: API clients still have `while` loops fetching all pages
- ⚠️ **No cursor persistence**: Imports can't be resumed mid-pagination

### 2.2 Current Importer Example (As Implemented)

**File:** `packages/import/src/infrastructure/blockchains/bitcoin/importer.ts`

```typescript
export class BitcoinTransactionImporter implements IImporter {
  private async fetchRawTransactionsForAddress(
    address: string,
    since?: number
  ): Promise<Result<RawTransactionWithMetadata[], ProviderError>> {
    // Fetch from provider (with internal pagination in API client)
    const result = await this.providerManager.executeWithFailover('bitcoin', {
      type: 'getAddressTransactions',
      address: address,
      since: since,
    });

    return result.map((response) => {
      // ✅ NEW: API client returns TransactionWithRawData { raw, normalized }
      const transactionsWithRaw = response.data as TransactionWithRawData<BitcoinTransaction>[];
      const providerId = response.providerName;

      // ✅ NEW: Both raw and normalized data are already available
      return transactionsWithRaw.map((txWithRaw) => ({
        rawData: txWithRaw.raw, // Original provider response
        normalizedData: txWithRaw.normalized, // Already validated + normalized
        metadata: {
          providerId,
          sourceAddress: address,
        },
      }));
    });
  }
}
```

**Key Changes:**

- ✅ API client now returns `TransactionWithRawData<T>[]` with both `raw` and `normalized`
- ✅ No separate normalization step needed
- ✅ Data is validated during fetch (fail-fast)

### 2.3 Current API Client Example (As Implemented)

**File:** `packages/platform/providers/src/blockchain/bitcoin/blockstream/blockstream-api-client.ts`

```typescript
export class BlockstreamApiClient extends BaseApiClient {
  private mapper: BlockstreamTransactionMapper; // ✅ NEW: Mapper instance

  constructor(config: ProviderConfig) {
    super(config);
    this.mapper = new BlockstreamTransactionMapper(); // ✅ NEW: Instantiate mapper
  }

  private async getAddressTransactions(params: {
    address: string;
    since?: number;
  }): Promise<Result<TransactionWithRawData<BitcoinTransaction>[], Error>> {
    const allTransactions: TransactionWithRawData<BitcoinTransaction>[] = [];
    let lastSeenTxid: string | undefined;
    let hasMore = true;
    let batchCount = 0;
    const maxBatches = 50;

    // ⚠️ STILL HAS: Internal pagination loop (not yet externalized)
    while (hasMore && batchCount < maxBatches) {
      const endpoint = lastSeenTxid ? `/address/${address}/txs/chain/${lastSeenTxid}` : `/address/${address}/txs`;

      const txResult = await this.httpClient.get<BlockstreamTransaction[]>(endpoint);
      if (txResult.isErr()) return err(txResult.error);

      const rawTransactions = txResult.value;

      // ✅ NEW: Normalize each transaction during fetch
      for (const rawTx of rawTransactions) {
        const mapResult = this.mapper.map(
          rawTx,
          {
            providerId: 'blockstream.info',
            sourceAddress: address,
          },
          {}
        );

        if (mapResult.isErr()) {
          // ✅ NEW: Fail-fast on validation error
          return err(new Error(`Validation failed: ${mapResult.error.message}`));
        }

        // ✅ NEW: Store both raw and normalized
        allTransactions.push({
          raw: rawTx,
          normalized: mapResult.value,
        });
      }

      lastSeenTxid = rawTransactions[rawTransactions.length - 1]?.txid;
      hasMore = rawTransactions.length === 25;
      batchCount++;
    }

    // Returns ALL transactions with both raw and normalized data
    return ok(allTransactions);
  }
}
```

**Key Changes:**

- ✅ API client instantiates mapper in constructor
- ✅ Calls `mapper.map()` for each transaction during fetch
- ✅ Returns `TransactionWithRawData<T>[]` with both `raw` and `normalized`
- ✅ Fail-fast validation (errors propagate immediately)
- ⚠️ Internal pagination loop still exists (not yet externalized)

### 2.4 Current Processing Service (As Implemented)

**File:** `packages/import/src/app/services/ingestion-service.ts` (lines 195-208)

```typescript
// Load raw data from database
const rawDataItemsResult = await this.rawDataRepository.load(loadFilters);
const rawDataItems = rawDataItemsResult.value;

// ✅ NEW: Load normalized_data (already validated during import)
const normalizedRawDataItems: unknown[] = [];

for (const item of pendingItems) {
  // ✅ NEW: Try normalized_data first (preferred path)
  let normalized_data: unknown =
    typeof item.normalized_data === 'string' ? JSON.parse(item.normalized_data) : item.normalized_data;

  // Fallback to raw_data for backwards compatibility
  if (!normalized_data || Object.keys(normalized_data as Record<string, never>).length === 0) {
    normalized_data = typeof item.raw_data === 'string' ? JSON.parse(item.raw_data) : item.raw_data;
  }

  normalizedRawDataItems.push(normalized_data);
}

// ✅ NEW: No normalization step - data already validated
const processor = await this.processorFactory.create(sourceId, sourceType, parsedSessionMetadata);
const sessionTransactionsResult = await processor.process(normalizedRawDataItems, parsedSessionMetadata);

if (sessionTransactionsResult.isErr()) {
  // Only processor errors possible - normalization errors caught during import
  return err(sessionTransactionsResult.error);
}
```

**Key Changes:**

- ✅ Loads `normalized_data` directly (no normalization step)
- ✅ Fallback to `raw_data` for backwards compatibility
- ✅ Validation errors caught during import, not processing
- ✅ Cleaner error handling (only processor errors possible here)

---

## 3. Identified Issues

### 3.1 ✅ Normalization Issues (RESOLVED)

These issues have been **resolved** by the normalization refactoring:

| Issue                       | Status   | Solution                                                  |
| --------------------------- | -------- | --------------------------------------------------------- |
| **Late validation**         | ✅ FIXED | Validation happens during import (fail-fast)              |
| **Cannot extract metadata** | ✅ FIXED | Metadata extracted during normalization in API client     |
| **Double parsing**          | ✅ FIXED | Single parse during import, stored normalized data reused |
| **Silent failures**         | ✅ FIXED | Validation errors propagate immediately, no silent skips  |

### 3.2 ⚠️ Pagination Issues (STILL PRESENT)

| Issue                                      | Impact                 | Example                                                                                                              |
| ------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Non-parallelizable**                     | Slow imports           | Single provider handles all 10,000+ transactions sequentially                                                        |
| **No failover mid-pagination**             | Lost progress          | Provider fails on page 50/100, restart from page 1                                                                   |
| **Client-controlled `since` is a footgun** | Data completeness gaps | Client passes `since=yesterday`, misses all historical transactions; portfolio balance calculations become incorrect |
| **Memory bloat**                           | OOM crashes            | Loading 50,000 transactions into memory before processing                                                            |
| **No resumability**                        | Wasted work            | Crash on page 80/100, must restart entire import                                                                     |

### 3.3 Code Examples of Issues

#### Issue 1: Client-Controlled `since` Parameter is Dangerous

**Problem:** Allowing clients to pass `since` parameter creates completeness gaps:

```typescript
// Current API exposes since to clients
await importer.import({ address: '0x...', since: Date.now() - 86400000 }); // ❌ Only imports last 24h!

// Portfolio app needs ALL transactions to calculate balances correctly
// But nothing prevents clients from passing incomplete ranges
```

**Root Cause:** `since` should be **server-owned**, computed from persisted session state:

```typescript
// Server should derive start cursor from last successful import
const lastCursor = await sessionRepository.getLastCursor(address);
const startFrom = lastCursor || 'genesis'; // Resume or start fresh

// Provider inconsistencies compound the problem:
// - Alchemy ignores since entirely (hardcoded fromBlock: '0x0')
// - Moralis respects it but trusts client values blindly
// - No validation that since produces complete history
```

#### Issue 2: Internal Pagination Loops

**File:** `packages/platform/providers/src/blockchain/evm/providers/alchemy/alchemy.api-client.ts` (lines 142-176)

```typescript
private async getAssetTransfersPaginated(params: AlchemyAssetTransferParams): Promise<AlchemyAssetTransfer[]> {
  const transfers: AlchemyAssetTransfer[] = [];
  let pageKey: string | undefined;
  let pageCount = 0;
  const maxPages = 10; // Safety limit

  // ❌ Internal pagination - cannot parallelize or failover
  do {
    const requestParams = { ...params };
    if (pageKey) requestParams.pageKey = pageKey;

    const response = await this.httpClient.post<...>(`/${this.apiKey}`, {
      method: 'alchemy_getAssetTransfers',
      params: [requestParams],
    });

    transfers.push(...response.result?.transfers || []);
    pageKey = response.result?.pageKey;
    pageCount++;

  } while (pageKey && pageCount < maxPages);

  return transfers; // Returns ALL transfers
}
```

#### Issue 3: Late Normalization Failures

**File:** `packages/import/src/app/services/ingestion-service.ts` (lines 378-394)

```typescript
// STRICT MODE: Fail if any raw data items could not be normalized
if (normalizationErrors.length > 0) {
  this.logger.error(`CRITICAL: ${normalizationErrors.length}/${pendingItems.length} items failed normalization`);

  // ❌ Too late! Session already marked complete, raw data stored
  return err(
    new Error(
      `Cannot proceed: ${normalizationErrors.length} raw data items failed normalization. ` +
        `This would corrupt portfolio calculations.`
    )
  );
}
```

---

## 4. Proposed Solution

### 4.1 New Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: Import + Normalize (Single Pass)                       │
│                                                                  │
│  Importer → API Client (1 page) → Zod Validate → Normalize     │
│              ↓                                                   │
│         Return {normalized, raw, cursor}                        │
│              ↓                                                   │
│  Service: Queue next page if hasMore                            │
│              ↓                                                   │
│  Store: external_transaction_data {normalized_data, raw_data}   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: Process (Convert to Universal Format)                  │
│                                                                  │
│  Load normalized_data → Processor → UniversalTransaction        │
│                                                                  │
│  Output: transactions table                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Key Improvements

#### Improvement 1: Merge Normalization into Import

**Before:**

```typescript
// Import: Store raw, defer validation
const rawData = await fetchFromAPI();
await storage.save(rawData); // ❌ No validation

// Later: Normalize (might fail)
const normalized = normalizer.normalize(rawData); // ❌ Too late
```

**After:**

```typescript
// Import: Validate + normalize immediately
const rawData = await fetchFromAPI();

// Fail fast with Zod validation
const validated = BitcoinTransactionSchema.safeParse(rawData);
if (!validated.success) {
  return err(new Error(`Invalid data: ${validated.error}`));
}

// Normalize immediately
const normalized = normalizer.normalize(validated.data);
if (normalized.isErr()) {
  return err(normalized.error);
}

// Store both normalized and raw
await storage.save({ normalized: normalized.value, raw: rawData });
```

**Benefits:**

- ✅ Fail fast on invalid API data
- ✅ Extract pagination metadata during fetch (tx hash, block height)
- ✅ Store validated data only
- ✅ Single parse/validation pass

#### Improvement 2: Externalize Pagination & Remove Client-Controlled `since`

**Before:**

```typescript
// API Client: Internal pagination loop with client-controlled since
async getAddressTransactions(address: string, since?: number): Promise<Transaction[]> {
  const all = [];
  let cursor;

  while (hasMore) { // ❌ Non-parallelizable
    const page = await fetchPage(address, cursor, since); // ❌ Client controls completeness
    all.push(...page);
    cursor = getNextCursor(page);
  }

  return all;
}
```

**After:**

```typescript
// API Client: Return ONE page + cursor (NO since parameter exposed to clients)
async getAddressTransactions(params: {
  address: string;
  cursor?: PaginationCursor; // Server-computed from session state
  limit?: number;
}): Promise<PaginatedResponse<Transaction[]>> {
  const page = await fetchPage(params.address, params.cursor, params.limit);

  return {
    data: page,
    nextCursor: getNextCursor(page),
    hasMore: page.length === params.limit
  };
}

// Service: Server owns start cursor computation (no client-controlled since)
async importFromSource(address: string, mode: 'incremental' | 'reindex') {
  // 1. Server-owned start cursor - derive from session state
  let cursor: PaginationCursor | undefined;

  if (mode === 'incremental') {
    // Resume from last successful import
    const lastSession = await sessionRepository.getLastSuccessful(address);
    cursor = lastSession?.pagination_cursor || undefined; // Start from last known position
  } else {
    // Full reindex - admin-only flag, never client-controlled
    cursor = undefined; // Start from genesis
  }

  let hasMore = true;

  // 2. Pagination loop with server-controlled cursors
  while (hasMore) {
    // ✅ Each page can use different provider (failover)
    // ✅ No client-controlled since - server derives start from session
    const result = await importer.import({ address, cursor, limit: 100 });

    await storage.save(result.data);

    cursor = result.nextCursor;
    hasMore = result.hasMore;

    // ✅ Store cursor for resumability
    await session.updateCursor(cursor);
  }
}
```

**Benefits:**

- ✅ **Server-owned completeness** - No client can create data gaps by passing bad `since` values
- ✅ **Consistent behavior** - All imports start from correct position (resume or genesis)
- ✅ **Provider drift eliminated** - Centralized `since` logic enforces contract, not client hints
- ✅ Parallelizable across providers
- ✅ Provider failover per page
- ✅ Resumable imports (store cursor)
- ✅ Bounded memory usage
- ✅ Progress tracking

---

## 5. Technical Design

### 5.1 Schema Changes

#### Update: `external_transaction_data` table

```typescript
export interface ExternalTransactionDataTable {
  id: Generated<number>;
  data_source_id: number;

  // NEW: Store normalized data alongside raw
  normalized_data: JSONString; // ✨ NEW
  raw_data: JSONString;

  metadata: JSONString | null;
  created_at: DateTime;

  processing_status: 'pending' | 'processed' | 'failed' | 'skipped';
  processed_at: DateTime | null;
  processing_error: string | null;
  provider_id: string | null;
}
```

#### Update: `data_sources` table

```typescript
export interface DataSourcesTable {
  // ... existing fields ...

  // NEW: Track pagination cursor for resumable imports
  pagination_cursor: JSONString | null; // ✨ NEW

  // NEW: Track expected total transaction count for progress reporting
  expected_total_count: number | null; // ✨ NEW - from provider's getTransactionCount()
}
```

### 5.2 Interface Changes

#### New: Pagination Types

**File:** `packages/import/src/app/ports/importers.ts`

```typescript
// NEW: Cursor type classification for cross-provider compatibility
export type CursorType =
  | 'blockNumber' // EVM, Substrate - block-based pagination (cross-provider)
  | 'timestamp' // Bitcoin, Solana - Unix timestamp (cross-provider)
  | 'txHash' // Bitcoin - txid-based chaining (cross-provider within BTC)
  | 'pageToken'; // Opaque tokens - provider-locked

// NEW: Typed pagination cursors with semantic compatibility
// Semantic cursors (blockNumber, timestamp, txHash) are cross-provider compatible
// PageToken cursors are provider-locked due to opaque implementation
export type PaginationCursor =
  | { type: 'blockNumber'; value: number } // Cross-provider compatible
  | { type: 'timestamp'; value: number } // Cross-provider compatible
  | { type: 'txHash'; value: string } // Cross-provider compatible (same chain)
  | { type: 'pageToken'; value: string; providerId: string }; // Provider-locked

// NEW: Normalized + raw data pair with deduplication
export interface NormalizedRawPair {
  normalized: unknown; // Provider-specific normalized format
  raw: unknown; // Original API response
  metadata?: Record<string, unknown>;
  dedupKey: string; // Canonical dedup identity: `${providerId}:${txHash}:${index}`
}

// UPDATED: Import result with pagination
export interface ImportRunResult {
  data: NormalizedRawPair[]; // Changed from rawTransactions
  metadata?: Record<string, unknown>;

  // NEW: Pagination support
  nextCursor?: PaginationCursor;
  hasMore: boolean;
}

// UPDATED: Import params with cursor (since REMOVED - server-owned)
export interface ImportParams {
  address?: string;
  csvDirectories?: string[];
  providerId?: string;

  // NEW: Pagination support (server-controlled cursors only)
  cursor?: PaginationCursor; // Computed by server from session state
  limit?: number;

  // REMOVED: since parameter - now server-owned
  // Clients no longer control start position; server derives from session state
}
```

#### Update: Provider Capabilities (Cross-Provider Cursor Support)

**File:** `packages/platform/providers/src/core/blockchain/types/capabilities.ts`

```typescript
import type { CursorType } from '@exitbook/import/app/ports/importers.js';

export interface ProviderCapabilities {
  operations: ProviderOperationType[];

  // NEW: Declare which cursor types this provider supports
  // Enables cross-provider failover for compatible cursor types
  supportedCursorTypes?: CursorType[];

  // NEW: Replay window applied when failing over FROM a different provider
  // Prevents off-by-one gaps; duplicates absorbed by dedup keys
  replayWindow?: {
    blocks?: number; // For blockNumber cursors (EVM, Substrate)
    minutes?: number; // For timestamp cursors (Bitcoin, Solana) or fallback
  };

  requiresApiKey: boolean;
  // ... existing fields
}
```

**Replay Policy:**

When `executeWithFailover` selects a different provider than the last successful one for this session, the chosen provider **MUST** apply its `replayWindow` based on the current cursor type before executing. The provider detects failover by comparing the cursor's provenance (tracked in session metadata or operation context) against its own identifier. Duplicates produced by the overlap are absorbed by dedup keys; cursor advancement proceeds as normal.

**Recommended Defaults:**

- Bitcoin (txHash): `{minutes: 60}` (~6 blocks)
- Ethereum (blockNumber): `{blocks: 50}` (~10 min)
- Solana (timestamp): `{minutes: 1}` (~150 blocks)
- Substrate (blockNumber): `{blocks: 50}` (~10 min)

#### Update: Provider Operations

**File:** `packages/platform/providers/src/core/blockchain/types/operations.ts`

```typescript
import type { PaginationCursor } from '@exitbook/import/app/ports/importers.js';

export type ProviderOperationParams =
  | {
      type: 'getAddressTransactions';
      address: string;

      // Enhanced pagination support (since REMOVED from public API)
      cursor?: PaginationCursor | undefined; // Typed cursor for compatibility checking
      limit?: number | undefined; // Max results per request

      // INTERNAL ONLY: Provider implementations may still use these for cursor→timestamp conversion
      // But they are NOT exposed to clients; server computes from cursor when needed
      _internalSince?: number | undefined; // Derived from cursor by provider, not client
      _internalUntil?: number | undefined; // Optional end boundary
    }
  | {
      type: 'getTransactionCount'; // ✨ NEW - for progress tracking
      address: string;
    };
// ... other operations

// NEW: Paginated provider response with typed cursor
export interface PaginatedProviderResponse<T> {
  data: T;
  nextCursor?: PaginationCursor; // Return typed cursor
  hasMore: boolean;
}
```

### 5.3 Provider Manager Enhancement (Cross-Provider Cursor Compatibility)

**File:** `packages/platform/providers/src/core/blockchain/provider-manager.ts`

```typescript
/**
 * Execute operation with intelligent failover and cursor-aware provider selection
 */
async executeWithFailover<T>(
  blockchain: string,
  operation: ProviderOperation
): Promise<Result<FailoverExecutionResult<T>, ProviderError>> {

  const providers = this.getProviders(blockchain);
  const cursor = operation.cursor;

  // Filter providers by cursor type compatibility
  // If no cursor, all providers are eligible
  // If cursor exists, only providers supporting that cursor type can be used
  const compatibleProviders = cursor
    ? providers.filter(provider => {
        const supportedTypes = provider.capabilities.supportedCursorTypes || [];
        return supportedTypes.includes(cursor.type);
      })
    : providers;

  if (compatibleProviders.length === 0) {
    return err(new ProviderError(
      `No providers support cursor type: ${cursor?.type}`,
      'NO_COMPATIBLE_PROVIDERS'
    ));
  }

  this.logger.debug({
    blockchain,
    totalProviders: providers.length,
    compatibleProviders: compatibleProviders.length,
    cursorType: cursor?.type,
    providers: compatibleProviders.map(p => p.name)
  });

  // Try each compatible provider with circuit breaker logic
  for (const provider of compatibleProviders) {
    const circuitState = this.getCircuitState(provider.name);

    if (isCircuitOpen(circuitState)) {
      this.logger.warn(`Circuit open for ${provider.name}, skipping`);
      continue;
    }

    try {
      const result = await provider.execute(operation);
      recordSuccess(circuitState);

      return ok({ data: result, providerName: provider.name });
    } catch (error) {
      recordFailure(circuitState);
      this.logger.warn(`Provider ${provider.name} failed, trying next`);
      continue;
    }
  }

  return err(new ProviderError(
    'All compatible providers exhausted',
    'ALL_PROVIDERS_FAILED'
  ));
}
```

**Benefits:**

- ✅ **Cross-provider failover during pagination** - Switch from Alchemy to Moralis mid-import using blockNumber cursor
- ✅ **Type-safe cursor compatibility** - Provider manager enforces cursor type support via capabilities
- ✅ **Graceful degradation** - Opaque pageToken cursors remain provider-locked (correct behavior)
- ✅ **Observability** - Logs show compatible vs total providers for debugging

### 5.4 Progress Tracking via Transaction Count

**Design:**

Providers that support transaction count queries register the `getTransactionCount` operation. Before starting an import, the ingestion service attempts to fetch the total count:

```typescript
// Optional - try to get count for progress tracking
const countResult = await providerManager.executeWithFailover(blockchain, {
  type: 'getTransactionCount',
  address: '0x...',
});

if (countResult.isOk()) {
  expectedTotalCount = countResult.value.data;
  // Store in session for progress calculations
}
```

**Implementation Examples:**

- **Mempool.space (Bitcoin)**: `GET /api/address/:address` returns `chain_stats.tx_count + mempool_stats.tx_count`
- **Subscan (Substrate)**: Paginated responses include `count` field with total transactions

**Progress Display:**

- **With count**: `"Progress: 150/500 (30%)"`
- **Without count**: `"Imported: 150 transactions so far..."`

**Storage:**

- `data_sources.expected_total_count` stores the initial count (nullable)
- Logs include progress info derived from `totalImported / expectedTotalCount`

**Benefits:**

- ✅ **Better UX** - Users see percentage completion when supported
- ✅ **Graceful degradation** - Falls back to incremental count when unavailable
- ✅ **No API abuse** - Only called once at start, not per-page
- ✅ **Provider flexibility** - Opt-in via operation registration, not required

### 5.5 Provider Cursor Capability Matrix

| Provider             | Blockchain | Supported Cursor Types     | Supports Count | Notes                                           |
| -------------------- | ---------- | -------------------------- | -------------- | ----------------------------------------------- |
| **Alchemy**          | EVM        | `blockNumber`, `pageToken` | ❌             | Supports both block-based and opaque pagination |
| **Moralis**          | EVM        | `blockNumber`              | ❌             | Block-based only                                |
| **Etherscan-family** | EVM        | `blockNumber`              | ❌             | All Etherscan-like explorers (Snowtrace, etc.)  |
| **Blockstream**      | Bitcoin    | `txHash`                   | ❌             | Transaction chaining via txid                   |
| **Mempool.space**    | Bitcoin    | `txHash`                   | ✅             | `chain_stats.tx_count + mempool_stats.tx_count` |
| **Tatum**            | Bitcoin    | `timestamp`                | ❌             | Uses block timestamp                            |
| **Helius**           | Solana     | `timestamp`, `pageToken`   | ❌             | Before/after signatures + block time            |
| **Solscan**          | Solana     | `timestamp`                | ❌             | Block timestamp-based                           |
| **Subscan**          | Substrate  | `blockNumber`, `pageToken` | ✅             | `count` field in paginated responses            |

**Registration Example:**

```typescript
// Provider without transaction count support
@BlockchainProvider({
  name: 'alchemy',
  blockchain: 'ethereum',
  capabilities: {
    operations: ['getAddressTransactions'],
    supportedCursorTypes: ['blockNumber', 'pageToken'],
    replayWindow: { blocks: 50 }, // ✨ Rewind 50 blocks on failover
    requiresApiKey: true,
  },
})
class AlchemyProvider implements IBlockchainProvider {
  async execute(operation: ProviderOperation) {
    let cursor = operation.cursor;

    // Apply replay window if failing over from different provider
    const lastProvider = operation.context?.lastSuccessfulProvider;
    if (lastProvider && lastProvider !== 'alchemy' && cursor?.type === 'blockNumber') {
      const originalBlock = cursor.value;
      cursor = { ...cursor, value: Math.max(0, originalBlock - 50) };

      this.logger.info({
        msg: 'Applied replay window for failover',
        fromProvider: lastProvider,
        toProvider: 'alchemy',
        cursorType: 'blockNumber',
        originalCursor: originalBlock,
        adjustedCursor: cursor.value,
        windowApplied: { blocks: 50 },
      });
    }

    return this.apiClient.getAddressTransactions({ ...operation, cursor });
  }
}

// Provider with transaction count support
@BlockchainProvider({
  name: 'mempool.space',
  blockchain: 'bitcoin',
  capabilities: {
    operations: ['getAddressTransactions', 'getTransactionCount'], // ✨ NEW
    supportedCursorTypes: ['txHash'],
    replayWindow: { minutes: 60 }, // ✨ Rewind 60min on failover (txHash → timestamp conversion)
    requiresApiKey: false,
  },
})
class MempoolSpaceProvider implements IBlockchainProvider {
  // For txHash cursors, must convert to timestamp-based rewind
  async execute(operation: ProviderOperation) {
    let startParam = operation.cursor?.value; // txHash

    const lastProvider = operation.context?.lastSuccessfulProvider;
    if (lastProvider && lastProvider !== 'mempool.space' && operation.cursor?.type === 'txHash') {
      // Map txHash → blockHeight → subtract window → get earlier txHash
      const txInfo = await this.apiClient.getTransaction(operation.cursor.value);
      const targetBlock = Math.max(0, txInfo.status.block_height - 6); // ~60min = 6 blocks
      const earlierTx = await this.apiClient.getLastTxBeforeBlock(targetBlock, operation.address);
      startParam = earlierTx?.txid || startParam;

      this.logger.info({
        msg: 'Applied replay window for failover',
        fromProvider: lastProvider,
        cursorType: 'txHash',
        windowApplied: { blocks: 6, minutes: 60 },
      });
    }

    return this.apiClient.getAddressTransactions({ ...operation, cursor: startParam });
  }
}
```

**Implementation Notes:**

- Provider receives `operation.context.lastSuccessfulProvider` from session tracking
- Provider compares against its own name to detect failover
- Replay window logic is provider-specific (knows how to translate cursor types)
- Observability: Log `{fromProvider, toProvider, cursorType, windowApplied}` on every rewind
- Rate limiting: Replay increases request volume; relies on existing backoff/circuit breaker configs

### 5.6 Implementation Examples

#### Example 1: Updated Bitcoin Importer

**File:** `packages/import/src/infrastructure/blockchains/bitcoin/importer.ts`

```typescript
export class BitcoinTransactionImporter implements IImporter {
  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    const { address, cursor, limit = 100 } = params;
    // Note: No 'since' parameter - server derives start position from cursor

    // 1. Fetch ONE page from provider with cursor (server-controlled)
    const result = await this.providerManager.executeWithFailover('bitcoin', {
      type: 'getAddressTransactions',
      address: address!,
      cursor: cursor?.type === 'txHash' ? cursor.value : undefined,
      limit,
      // No since passed - provider starts from cursor or genesis
    });

    return result.map((response) => {
      const paginatedResponse = response.data as PaginatedProviderResponse<unknown[]>;
      const rawTransactions = paginatedResponse.data;
      const providerId = response.providerName;

      const normalizedPairs: NormalizedRawPair[] = [];

      // 2. Validate + Normalize each transaction
      for (const rawTx of rawTransactions) {
        // Zod validation
        const validatedResult = BitcoinTransactionSchema.safeParse(rawTx);
        if (!validatedResult.success) {
          this.logger.warn(`Invalid data, skipping: ${validatedResult.error}`);
          continue;
        }

        // Normalize
        const normalizeResult = this.normalizer.normalize(
          validatedResult.data,
          { providerId, sourceAddress: address },
          { address }
        );

        if (normalizeResult.isErr()) {
          // Handle skip vs error semantics
          if (normalizeResult.error.type === 'skip') {
            // SKIP: Save raw for observability, log reason, continue
            const skipDedupKey = `${providerId}:skip:${this.getTransactionId(rawTx)}`;
            normalizedPairs.push({
              normalized: null, // Mark as skipped
              raw: rawTx,
              metadata: { providerId, sourceAddress: address, skipReason: normalizeResult.error.reason },
              dedupKey: skipDedupKey,
            });
            this.logger.debug(`Skipped transaction: ${normalizeResult.error.reason}`);
            continue;
          }
          // ERROR: Fail the entire page
          this.logger.error(`Normalization failed: ${normalizeResult.error.message}`);
          return err(new Error(`Page failed normalization: ${normalizeResult.error.message}`));
        }

        // 3. Store pair with dedup key
        const txId = this.getTransactionId(validatedResult.data);
        const dedupKey = `${providerId}:${txId}:${rawTransactions.indexOf(rawTx)}`;

        normalizedPairs.push({
          normalized: normalizeResult.value,
          raw: rawTx,
          metadata: { providerId, sourceAddress: address },
          dedupKey,
        });
      }

      // 4. Extract pagination cursor (cross-provider compatible for txHash)
      const nextCursor: PaginationCursor | undefined = paginatedResponse.nextCursor
        ? { type: 'txHash', value: paginatedResponse.nextCursor }
        : undefined;

      return {
        data: normalizedPairs,
        hasMore: paginatedResponse.hasMore,
        nextCursor,
      };
    });
  }
}
```

#### Example 2: Updated API Client (Blockstream)

**File:** `packages/platform/providers/src/blockchain/bitcoin/blockstream/blockstream-api-client.ts`

```typescript
private async getAddressTransactions(params: {
  address: string;
  cursor?: string;  // lastSeenTxid (server-provided from session state)
  limit?: number;
  // Note: No since parameter - not needed for txHash-based pagination
}): Promise<PaginatedProviderResponse<BlockstreamTransaction[]>> {
  const { address, cursor, limit = 25 } = params;

  // Build endpoint with cursor (start from cursor or genesis)
  const endpoint = cursor
    ? `/address/${address}/txs/chain/${cursor}`  // Resume from last known txid
    : `/address/${address}/txs`;                  // Start from most recent (API default)

  // Fetch ONE page only
  const rawTransactions = await this.httpClient.get<BlockstreamTransaction[]>(endpoint);

  // Return page + cursor for next request
  return {
    data: rawTransactions,
    nextCursor: rawTransactions.length > 0
      ? rawTransactions[rawTransactions.length - 1].txid
      : undefined,
    hasMore: rawTransactions.length === limit
  };
}
```

#### Example 3: Updated Ingestion Service

**File:** `packages/import/src/app/services/ingestion-service.ts`

```typescript
async importFromSource(
  sourceId: string,
  sourceType: 'exchange' | 'blockchain',
  params: ImportParams & { mode?: 'incremental' | 'reindex' } // NEW: Server-controlled mode
): Promise<Result<ImportResult, Error>> {
  let dataSourceId = 0;
  let totalImported = 0;
  let hasMore = true;
  let expectedTotalCount: number | null = null;

  // ✨ NEW: Server-owned start cursor computation (replaces client-controlled since)
  let cursor: PaginationCursor | undefined;

  if (params.mode === 'reindex') {
    // Full reindex - admin-only flag, start from genesis
    cursor = undefined;
    this.logger.info('Starting full reindex from genesis');
  } else {
    // Incremental mode (default) - resume from last successful import
    const lastSession = await this.sessionRepository.getLastSuccessful(
      sourceId,
      sourceType,
      params.address
    );
    cursor = lastSession?.pagination_cursor
      ? JSON.parse(lastSession.pagination_cursor)
      : undefined;

    this.logger.info({
      mode: 'incremental',
      resumingFrom: cursor?.value || 'genesis',
      cursorType: cursor?.type
    });
  }

  // Try to get transaction count for progress tracking (optional)
  if (sourceType === 'blockchain' && params.address) {
    const countResult = await this.providerManager.executeWithFailover(sourceId, {
      type: 'getTransactionCount',
      address: params.address,
    });

    if (countResult.isOk()) {
      expectedTotalCount = countResult.value.data as number;
      this.logger.info(`Expected ${expectedTotalCount} transactions for address ${params.address}`);
    } else {
      this.logger.debug('Transaction count not available, will show incremental progress');
    }
  }

  // Create session
  const sessionIdResult = await this.sessionRepository.create(
    sourceId,
    sourceType,
    params.providerId,
    params,
    expectedTotalCount  // ✨ NEW - store expected count
  );
  if (sessionIdResult.isErr()) return err(sessionIdResult.error);

  dataSourceId = sessionIdResult.value;

  // Paginate through all data
  while (hasMore) {
    const pageStartTime = Date.now();
    let validationErrors = 0;
    let skips = 0;

    const importer = await this.importerFactory.create(
      sourceId,
      sourceType,
      params.providerId
    );

    // Fetch + normalize one page
    const importResult = await importer.import({ ...params, cursor });

    if (importResult.isErr()) return err(importResult.error);

    const pageResult = importResult.value;

    // Count validation outcomes for observability
    for (const pair of pageResult.data) {
      if (pair.normalized === null) skips++;
    }

    // Save normalized + raw pairs with dedup
    const savedCountResult = await this.rawDataRepository.saveBatch(
      dataSourceId,
      pageResult.data.map(pair => ({
        normalized: pair.normalized,
        raw: pair.raw,
        metadata: pair.metadata,
        dedupKey: pair.dedupKey
      }))
    );

    if (savedCountResult.isErr()) return err(savedCountResult.error);

    totalImported += savedCountResult.value;
    hasMore = pageResult.hasMore;
    cursor = pageResult.nextCursor;

    // Update session with cursor for resumability
    await this.sessionRepository.updateCursor(dataSourceId, cursor);

    // Enhanced observability: per-page metrics with progress
    const cursorAdvanceTime = Date.now() - pageStartTime;
    const progressInfo = expectedTotalCount
      ? { progress: `${totalImported}/${expectedTotalCount}`, percentage: Math.round((totalImported / expectedTotalCount) * 100) }
      : { progress: `${totalImported} imported so far` };

    this.logger.info({
      page: {
        size: savedCountResult.value,
        validationErrors,
        skips,
        cursorAdvanceTimeMs: cursorAdvanceTime
      },
      session: {
        totalImported,
        hasMore,
        nextCursor: cursor?.value,
        ...progressInfo  // ✨ NEW - show progress
      }
    });
  }

  // Finalize session (with warnings if items were skipped)
  const finalStatus = skips > 0 ? 'completed_with_warnings' : 'completed';
  await this.sessionRepository.finalize(
    dataSourceId,
    finalStatus,
    Date.now(),
    totalImported,
    0,
    { skippedItems: skips }
  );

  return ok({ imported: totalImported, dataSourceId, skipped: skips });
}

async processRawDataToTransactions(
  sourceId: string,
  sourceType: 'exchange' | 'blockchain',
  filters?: LoadRawDataFilters
): Promise<Result<ProcessResult, Error>> {
  // Load raw data
  const rawDataItemsResult = await this.rawDataRepository.load({
    processingStatus: 'pending',
    sourceId,
    ...filters,
  });

  if (rawDataItemsResult.isErr()) return err(rawDataItemsResult.error);
  const rawDataItems = rawDataItemsResult.value;

  // ✨ NEW: Normalized data already available - NO normalization needed
  const normalizedData = rawDataItems.map(item =>
    typeof item.normalized_data === 'string'
      ? JSON.parse(item.normalized_data)
      : item.normalized_data
  );

  // Process normalized data
  const processor = await this.processorFactory.create(sourceId, sourceType);
  const transactionsResult = await processor.process(normalizedData, sessionMetadata);

  if (transactionsResult.isErr()) return err(transactionsResult.error);

  const transactions = transactionsResult.value;

  // Save transactions
  const saveResults = await Promise.all(
    transactions.map(tx => this.transactionRepository.save(tx, sessionId))
  );

  const combinedResult = Result.combineWithAllErrors(saveResults);
  if (combinedResult.isErr()) return err(new Error('Failed to save transactions'));

  // Mark as processed
  const allRawDataIds = rawDataItems.map(item => item.id);
  await this.rawDataRepository.markAsProcessed(sourceId, allRawDataIds);

  return ok({
    processed: transactions.length,
    failed: 0,
    errors: []
  });
}
```

---

## 6. Implementation Plan

### Phase 1: Schema & Core Interfaces (3 hours)

**Tasks:**

1. ✅ Add `normalized_data` column to `external_transaction_data` table
2. ✅ Add `dedup_key` column (unique index) to `external_transaction_data` table
3. ✅ Add `pagination_cursor` column to `data_sources` table
4. ✅ Add `expected_total_count` column to `data_sources` table (for progress tracking)
5. ✅ Create `CursorType` enum in `packages/import/src/app/ports/importers.ts`
6. ✅ Create `PaginationCursor` type with semantic/opaque distinction
7. ✅ Create `NormalizedRawPair` interface with `dedupKey` field
8. ✅ Update `ImportRunResult` to include `nextCursor` and `hasMore`
9. ✅ **REMOVE `since` from `ImportParams`** - Server-owned, not client-controlled
10. ✅ Update `ImportParams` to include `cursor` and `limit`
11. ✅ Add `supportedCursorTypes` to `ProviderCapabilities` interface
12. ✅ Create `PaginatedProviderResponse<T>` in provider types
13. ✅ **REMOVE `since` from `ProviderOperationParams`** - Mark as `_internalSince` for provider use only
14. ✅ Update `ProviderOperationParams` to include typed `cursor`, `limit`, and new `getTransactionCount` operation
15. ✅ Update `DataSourceRepository.create()` to accept `expectedTotalCount` parameter
16. ✅ Add `DataSourceRepository.getLastSuccessful()` method to retrieve last cursor for resume

**Files Modified:**

- `packages/platform/data/src/schema/database-schema.ts`
- `packages/import/src/app/ports/importers.ts`
- `packages/platform/providers/src/core/blockchain/types/capabilities.ts`
- `packages/platform/providers/src/core/blockchain/types/operations.ts`

### Phase 2: Update Repositories (1.5 hours)

**Tasks:**

1. ✅ Update `RawDataRepository.saveBatch()` to accept `{ normalized, raw, metadata, dedupKey }`
2. ✅ Add deduplication logic using `dedupKey` in saveBatch (upsert on conflict)
3. ✅ Add `DataSourceRepository.updateCursor()` method
4. ✅ Update `RawDataRepository.load()` to return `normalized_data` field

**Files Modified:**

- `packages/import/src/infrastructure/persistence/raw-data-repository.ts`
- `packages/import/src/app/ports/raw-data-repository.ts`
- (Session repository location TBD - check imports)

### Phase 3: Update Provider Manager (1.5 hours)

**Tasks:**

1. ✅ Update `executeWithFailover()` to filter providers by cursor compatibility
2. ✅ Add cursor type checking logic before provider selection
3. ✅ Add observability logging for compatible vs total providers
4. ✅ Handle case where no providers support the cursor type

**Files Modified:**

- `packages/platform/providers/src/core/blockchain/provider-manager.ts`

### Phase 4: Update One API Client + Provider Registration (2 hours)

**Tasks:**

1. ✅ Start with Mempool.space (has both pagination and count support)
2. ✅ Annotate provider with `operations: ['getAddressTransactions', 'getTransactionCount']`
3. ✅ Annotate provider with `supportedCursorTypes: ['txHash']`
4. ✅ Remove internal `while` loop from `getAddressTransactions`
5. ✅ Accept typed `cursor` and `limit` parameters
6. ✅ Return `PaginatedProviderResponse<MempoolTransaction[]>`
7. ✅ Extract typed `nextCursor: { type: 'txHash', value: lastTxid }`
8. ✅ Implement `getTransactionCount()` using `/api/address/:address` endpoint (chain_stats.tx_count + mempool_stats.tx_count)

**Files Modified:**

- `packages/platform/providers/src/blockchain/bitcoin/mempool/mempool-api-client.ts`
- Provider registration file (where `@BlockchainProvider` decorator is used)

### Phase 5: Update One Importer (2.5 hours)

**Tasks:**

1. ✅ Update Bitcoin importer with normalization
2. ✅ Add Zod validation step (use existing schemas)
3. ✅ Generate `dedupKey` for each transaction: `${providerId}:${txHash}:${index}`
4. ✅ Handle skip vs error semantics (skip saves raw, error fails page)
5. ✅ Return `NormalizedRawPair[]` with typed pagination cursor
6. ✅ Extract cursor from response and type it correctly

**Files Modified:**

- `packages/import/src/infrastructure/blockchains/bitcoin/importer.ts`

### Phase 6: Update Ingestion Service (3.5 hours)

**Tasks:**

1. ✅ **Implement server-owned start cursor logic** - Derive from session state, not client params
2. ✅ Add `mode` parameter: `'incremental'` (resume from cursor) or `'reindex'` (admin-only, from genesis)
3. ✅ Query `sessionRepository.getLastSuccessful()` to get last cursor for incremental mode
4. ✅ Try to get transaction count before import (call `getTransactionCount` via provider manager)
5. ✅ Pass `expectedTotalCount` to `sessionRepository.create()`
6. ✅ Add pagination loop in `importFromSource()`
7. ✅ Call `importer.import()` with **server-computed cursor** until `hasMore = false`
8. ✅ Count skips and validation errors per page for observability
9. ✅ Store cursor in session after each page (for resumability)
10. ✅ Log enhanced per-page metrics with progress (percentage if count available, incremental otherwise)
11. ✅ Finalize session with `completed_with_warnings` if skips occurred
12. ✅ Remove normalization logic from `processRawDataToTransactions()`
13. ✅ Load `normalized_data` directly from storage (add INVARIANT comment)
14. ✅ Update processor interface to accept normalized data only

**Files Modified:**

- `packages/import/src/app/services/ingestion-service.ts`
- `packages/import/src/app/ports/transaction-processor.interface.ts` (if needed)

### Phase 7: Update Remaining API Clients + Cursor Annotations (4.5 hours)

**Tasks:**

1. ✅ Alchemy - Remove `getAssetTransfersPaginated` loop, fix `since` parameter, annotate with `['blockNumber', 'pageToken']`
2. ✅ Moralis - Update to return one page, annotate with `['blockNumber']`
3. ✅ Etherscan-family - Update all (Snowtrace, etc.), annotate with `['blockNumber']`
4. ✅ Helius - Support cursor pagination, annotate with `['timestamp', 'pageToken']`
5. ✅ Solscan - Update pagination, annotate with `['timestamp']`
6. ✅ Subscan - Update pagination logic, annotate with `['blockNumber', 'pageToken']`, implement `getTransactionCount()`
7. ✅ Blockstream - Update pagination, annotate with `['txHash']`
8. ✅ Other providers - Apply same pattern, annotate cursor types

**Files Modified:**

- `packages/platform/providers/src/blockchain/evm/providers/alchemy/alchemy.api-client.ts`
- `packages/platform/providers/src/blockchain/evm/providers/moralis/moralis.api-client.ts`
- `packages/platform/providers/src/blockchain/solana/helius/helius.api-client.ts`
- `packages/platform/providers/src/blockchain/solana/solscan/solscan.api-client.ts`
- `packages/platform/providers/src/blockchain/substrate/providers/subscan/subscan.api-client.ts`
- All provider registration files to add `supportedCursorTypes`

### Phase 8: Update Remaining Importers (3 hours)

**Tasks:**

1. ✅ Apply normalization + dedup pattern to EVM importer
2. ✅ Apply normalization + dedup pattern to Solana importer
3. ✅ Apply normalization + dedup pattern to Substrate importer
4. ✅ Apply normalization + dedup pattern to Cosmos importer
5. ✅ Update exchange importers (CSV-based - simpler, may skip normalization)
6. ✅ Ensure typed cursor extraction for all importers

**Files Modified:**

- `packages/import/src/infrastructure/blockchains/evm/importer.ts`
- `packages/import/src/infrastructure/blockchains/solana/importer.ts`
- `packages/import/src/infrastructure/blockchains/substrate/importer.ts`
- `packages/import/src/infrastructure/blockchains/cosmos/importer.ts`
- `packages/import/src/infrastructure/exchanges/*/importer.ts`

### Phase 9: Testing & Validation (3.5 hours)

**Tasks:**

1. ✅ Test Bitcoin import end-to-end with pagination and dedup
2. ✅ Test progress tracking with transaction count (Mempool.space, Subscan)
3. ✅ Test progress fallback when count unavailable (incremental display)
4. ✅ Test cross-provider cursor failover (Blockstream → Mempool.space with txHash)
5. ✅ Test cross-provider cursor failover (Alchemy → Moralis with blockNumber)
6. ✅ Test pageToken cursor stays provider-locked (Alchemy cannot resume on Moralis)
7. ✅ Test resumable imports with cursor persistence
8. ✅ Test validation failures (ensure fail-fast, page-level failure)
9. ✅ Test skip semantics (raw saved, transaction continues)
10. ✅ Test observability metrics (per-page logs with progress, skip counts, cursor advance time)
11. ✅ Test all blockchains (EVM, Solana, Substrate, Cosmos)
12. ✅ Performance testing (memory bounded, dedup working)
13. ✅ Test replay window on failover (verify rewind applied, duplicates absorbed by dedup)
14. ✅ Test replay window observability (logs show fromProvider, windowApplied)
15. ✅ Test txHash cursor rewind (provider translates to block/timestamp-based rewind)

**Total Estimated Time:** 22 hours (increased from 21.5 due to server-owned cursor implementation)

---

## 7. Migration Strategy

### 7.1 Database Migration

**Approach:** Drop and recreate (no migration path)

```sql
-- Drop existing database
rm apps/cli/data/transactions.db

-- Restart app - migrations will auto-run
pnpm dev -- import --blockchain bitcoin --address bc1q...
```

**Why no migration:**

- Schema changes are breaking (new required columns)
- Raw data needs re-normalization with new logic
- Fresh import ensures data quality
- Development phase - acceptable to drop data

### 7.2 Code Migration

**Approach:** Big-bang refactor (no legacy support)

**Rationale:**

- Pipeline is self-contained, limited external dependencies
- No deployed production system
- Clean break ensures consistency
- Maintaining dual code paths adds complexity

### 7.3 Rollback Plan

If critical issues arise:

1. **Revert commits** - Git revert to pre-refactor state
2. **Restore old pipeline** - Re-enable original import flow
3. **Data loss acceptable** - In development, can re-import

---

## 8. Testing Strategy

### 8.1 Unit Tests

**Coverage:**

- [ ] Pagination cursor extraction (all provider types)
- [ ] Zod validation in importers
- [ ] Normalization during import
- [ ] Repository methods (`saveBatch` with normalized data)
- [ ] Session cursor persistence

**Example Test:**

```typescript
describe('BitcoinTransactionImporter', () => {
  it('should validate and normalize during import', async () => {
    const importer = new BitcoinTransactionImporter(mockProviderManager);

    const result = await importer.import({
      address: 'bc1q...',
      limit: 10,
    });

    expect(result.isOk()).toBe(true);
    expect(result.value.data).toHaveLength(10);
    expect(result.value.data[0]).toHaveProperty('normalized');
    expect(result.value.data[0]).toHaveProperty('raw');
    expect(result.value.nextCursor).toBeDefined();
    expect(result.value.hasMore).toBe(true);
  });
});
```

### 8.2 Integration Tests

**Coverage:**

- [ ] End-to-end import with pagination (Bitcoin)
- [ ] Provider failover during pagination
- [ ] Resume import from cursor after crash
- [ ] Process normalized data (skip normalization step)
- [ ] Multiple blockchains (EVM, Solana, Substrate)

**Example Test:**

```typescript
describe('Import Pipeline Integration', () => {
  it('should import with pagination and failover', async () => {
    const service = new TransactionIngestionService(...);

    // Simulate provider failure mid-pagination
    mockProvider1.failAfterPages(5);
    mockProvider2.succeedAlways();

    const result = await service.importFromSource(
      'bitcoin',
      'blockchain',
      { address: 'bc1q...', limit: 100 }
    );

    expect(result.isOk()).toBe(true);
    expect(result.value.imported).toBeGreaterThan(500);

    // Verify failover occurred
    expect(mockProvider2.callCount).toBeGreaterThan(0);

    // Verify normalized data stored
    const rawData = await rawDataRepo.load({ sessionId: result.value.dataSourceId });
    expect(rawData[0]).toHaveProperty('normalized_data');
  });
});
```

### 8.3 E2E Tests

**Coverage:**

- [ ] Import from real Bitcoin API (with API key)
- [ ] Import from real Ethereum API (Alchemy)
- [ ] Process and verify balances
- [ ] Export transactions

**Example:**

```bash
# E2E test with real Bitcoin API
pnpm test:e2e -- bitcoin-import.e2e.test.ts
```

---

## 9. Risk Assessment

### 9.1 High-Risk Areas

| Risk                       | Likelihood | Impact | Mitigation                                                   |
| -------------------------- | ---------- | ------ | ------------------------------------------------------------ |
| **Pagination bugs**        | Medium     | High   | Extensive testing, start with simple providers (Blockstream) |
| **Normalization failures** | Medium     | High   | Comprehensive Zod schemas, fail-fast validation              |
| **Performance regression** | Low        | Medium | Benchmark before/after, optimize if needed                   |
| **Data loss**              | Low        | High   | Test resumability, cursor persistence                        |
| **Provider compatibility** | Medium     | Medium | Test all providers, document cursor formats                  |

### 9.2 Success Criteria

**Must Have:**

- ✅ All imports validate data before storage (no invalid raw data)
- ✅ Pagination works across provider failover
- ✅ Imports resumable from cursor after interruption
- ✅ **Server-owned start cursor** - No client-controlled `since` parameter; server derives from session state
- ✅ **Two explicit modes:** `incremental` (resume from cursor) and `reindex` (admin-only, start from genesis)
- ✅ Memory usage bounded (no loading 10K+ transactions)

**Nice to Have:**

- ✅ Parallel pagination (multiple providers simultaneously)
- ✅ Performance improvement over current pipeline
- ✅ Reduced database size (skip invalid transactions)

### 9.3 Rollback Triggers

Revert if:

1. **Critical data corruption** - Transactions lost or duplicated
2. **Performance degradation >50%** - Import speed significantly slower
3. **Provider compatibility issues** - Multiple providers broken
4. **Unrecoverable bugs** - Cannot fix within 2 days

---

## 10. Architectural Review Insights

### 10.1 Design Decisions from Review

This plan incorporates feedback from an architectural review that validated the approach against the existing codebase and identified critical enhancements:

**✅ Validated Design Elements:**

- Normalization merging into import phase aligns with existing `DefaultNormalizer` and mapper factory patterns
- Service-level pagination orchestration fits the provider manager's failover architecture
- Storing both normalized and raw data matches current audit trail requirements
- Plan doesn't fight existing abstractions—it extends them correctly

**✨ Enhanced Design Elements (from review):**

1. **Cross-Provider Cursor Compatibility**
   - Original plan: Provider-locked cursors (too restrictive)
   - Enhanced: Semantic cursor types enable failover across compatible providers
   - Impact: Alchemy → Moralis failover now possible mid-import with `blockNumber` cursor

2. **Deduplication Contract**
   - Original plan: Implicit dedup via external_id
   - Enhanced: Explicit `dedupKey` field with canonical format: `${providerId}:${txHash}:${index}`
   - Impact: Prevents duplicates across provider switches and re-imports

3. **Skip vs Error Semantics**
   - Original plan: Unclear handling of normalization skips
   - Enhanced: Skip saves raw + logs reason (observability), Error fails page (fail-fast)
   - Impact: Operators can distinguish expected skips from data quality issues

4. **Observability Metrics**
   - Original plan: Basic import logging
   - Enhanced: Per-page metrics (validation errors, skips, cursor advance time)
   - Impact: SREs can diagnose where imports stall and why

5. **Processing Invariant**
   - Original plan: Assumed processing would skip normalization
   - Enhanced: Explicit INVARIANT comment enforcing "no normalizer on processing path"
   - Impact: Prevents regression where processing re-normalizes (performance + correctness)

6. **Session Completion Policy**
   - Original plan: Mark all sessions as 'completed'
   - Enhanced: Use `completed_with_warnings` when skips occurred
   - Impact: Operators know which imports had data quality issues

### 10.2 Design Contracts (Acceptance Criteria)

These contracts must hold for the refactoring to be considered successful:

**Cursor Contract:**

```
- Semantic cursors (blockNumber, timestamp, txHash) are opaque but cross-provider compatible
- PageToken cursors are opaque and provider-scoped (cannot cross providers)
- Cursors are persisted per session for crash recovery
- Provider manager filters by cursor type before selecting providers
- On provider change, new provider MUST apply replayWindow before executing (soaks off-by-one gaps)
- Session tracks lastSuccessfulProvider; providers detect failover by comparing against own name
- START POSITION IS SERVER-OWNED: Clients never control via 'since' parameter
  - Server derives from session state (last successful cursor OR genesis)
  - Two modes: 'incremental' (resume) and 'reindex' (admin-only, from genesis)
```

**Deduplication Contract:**

```
- Every normalized item has a canonical dedupKey: `${providerId}:${txHash}:${index}`
- Database enforces uniqueness on dedupKey (UNIQUE index)
- Retries/re-imports are idempotent (upsert on conflict)
```

**Normalization Contract:**

```
- Normalization happens ONLY during import phase
- Processing phase reads normalized_data field directly
- Skip normalization errors save raw data + reason
- True normalization errors fail the entire page (fail-fast)
```

**Observability Contract:**

```
- Per-page metrics: size, validationErrors, skips, cursorAdvanceTime
- Session metrics: totalImported, skippedItems, finalStatus, progress (with percentage if count available)
- Logs include: compatible vs total providers, cursor type, provider failover events
- Progress tracking: percentage when expectedTotalCount available, incremental count otherwise
- Replay window events: log {fromProvider, toProvider, cursorType, windowApplied} when rewind triggers
```

**Idempotency Contract:**

```
- Re-importing same data (same dedupKey) is safe (upsert)
- Resuming from cursor after crash produces same final state
- Provider failover mid-import does not create duplicates
```

### 10.3 Blind Spots to Monitor

Areas identified during review that require careful attention during implementation:

1. **Cursor fidelity across heterogeneous providers**
   - Some providers page by block height, others by opaque tokens
   - Must ensure cursor type mismatches are caught at provider selection, not execution

2. **Backwards compatibility in ingestion service**
   - Current service expects to normalize during processing
   - Phase 6 must completely remove normalizer invocation to prevent regressions

3. **Conflict policy on dedup collisions**
   - Current plan: Drop duplicates silently (INSERT OR IGNORE)
   - Consider: Should we update metadata on conflict? Log collisions?

4. **Partial page failures**
   - Current plan: One normalization error fails entire page
   - Consider: Should we support "best effort" mode where page can be partially saved?

---

## 11. Conclusion

This refactoring addresses fundamental architectural issues in the import pipeline while introducing cross-provider cursor compatibility for intelligent failover:

**Core Improvements:**

1. **Fail-fast validation** - Reject invalid data during import, not processing
2. **Cross-provider pagination** - Enable provider failover mid-import using semantic cursors
3. **Resumable imports** - Store typed cursors for crash recovery
4. **Progress tracking** - Optional transaction count queries for percentage-based progress
5. **Standardized `since` support** - All providers respect timestamp/block parameters
6. **Audit trail** - Store both normalized and raw data with dedup keys

**Key Innovations:**

1. **Cursor Compatibility**
   - Semantic cursors (`blockNumber`, `timestamp`, `txHash`) enable cross-provider failover
   - Alchemy → Moralis failover now possible mid-import using shared `blockNumber` cursor
   - Opaque `pageToken` cursors remain provider-locked (correct behavior)
   - Provider manager enforces cursor type compatibility at selection time

2. **Progress Tracking**
   - New `getTransactionCount` operation for providers that support it
   - Mempool.space (Bitcoin) and Subscan (Substrate) provide upfront counts
   - Display: `"150/500 (30%)"` when available, `"150 imported so far..."` otherwise
   - Stored in `data_sources.expected_total_count` for session-level visibility

**Benefits:**

- ✅ **Higher data quality** - Validated before storage, fail-fast on errors
- ✅ **Maximum uptime** - Cross-provider failover during pagination (not just pre-import)
- ✅ **Better reliability** - Resumable with cursor persistence, idempotent with dedup keys
- ✅ **Better UX** - Progress indicators when supported, graceful fallback when not
- ✅ **Full observability** - Per-page metrics, progress tracking, skip counts, cursor advance time
- ✅ **Cleaner architecture** - Single-responsibility per phase, explicit contracts

**Timeline:** 22 hours estimated (7 hours added for cursor compatibility + progress tracking + server-owned cursors)
**Team Required:** 1 developer
**Dependencies:** None (self-contained)

**Next Steps:**

1. Review and approve design document
2. Begin Phase 1 (schema updates)
3. Incremental implementation following plan
4. Comprehensive testing at each phase
5. Production deployment (drop DB, fresh import)

---

## Appendix A: File Checklist

### Files to Modify (25 total)

**Core Schemas & Interfaces (3 files):**

- [ ] `packages/platform/data/src/schema/database-schema.ts`
- [ ] `packages/import/src/app/ports/importers.ts`
- [ ] `packages/platform/providers/src/core/blockchain/types/operations.ts`

**Repositories (2 files):**

- [ ] `packages/platform/data/src/repositories/raw-data-repository.ts`
- [ ] `packages/platform/data/src/repositories/import-session-repository.ts`

**Services (1 file):**

- [ ] `packages/import/src/app/services/ingestion-service.ts`

**API Clients (10 files):**

- [ ] `packages/platform/providers/src/blockchain/bitcoin/blockstream/blockstream-api-client.ts`
- [ ] `packages/platform/providers/src/blockchain/bitcoin/mempool/mempool-api-client.ts`
- [ ] `packages/platform/providers/src/blockchain/bitcoin/blockcypher/blockcypher.api-client.ts`
- [ ] `packages/platform/providers/src/blockchain/evm/providers/alchemy/alchemy.api-client.ts`
- [ ] `packages/platform/providers/src/blockchain/evm/providers/moralis/moralis.api-client.ts`
- [ ] `packages/platform/providers/src/blockchain/solana/helius/helius.api-client.ts`
- [ ] `packages/platform/providers/src/blockchain/solana/solscan/solscan.api-client.ts`
- [ ] `packages/platform/providers/src/blockchain/substrate/providers/subscan/subscan.api-client.ts`
- [ ] `packages/platform/providers/src/blockchain/substrate/providers/taostats/taostats.api-client.ts`
- [ ] `packages/platform/providers/src/blockchain/cosmos/providers/injective-explorer/injective-explorer.api-client.ts`

**Importers (9 files):**

- [ ] `packages/import/src/infrastructure/blockchains/bitcoin/importer.ts`
- [ ] `packages/import/src/infrastructure/blockchains/evm/importer.ts`
- [ ] `packages/import/src/infrastructure/blockchains/solana/importer.ts`
- [ ] `packages/import/src/infrastructure/blockchains/substrate/importer.ts`
- [ ] `packages/import/src/infrastructure/blockchains/cosmos/importer.ts`
- [ ] `packages/import/src/infrastructure/exchanges/kraken/importer.ts`
- [ ] `packages/import/src/infrastructure/exchanges/kucoin/importer.ts`
- [ ] `packages/import/src/infrastructure/exchanges/ledgerlive/importer.ts`
- [ ] `packages/import/src/infrastructure/exchanges/coinbase/importer.ts`

---

**Document Version:** 1.0
**Last Updated:** 2025-10-04
**Status:** Ready for Implementation
