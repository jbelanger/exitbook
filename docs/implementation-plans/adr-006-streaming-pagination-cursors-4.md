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
