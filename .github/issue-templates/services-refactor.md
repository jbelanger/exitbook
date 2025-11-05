## Problem

`TransactionImportService` and `TransactionProcessService` violate the **Functional Core, Imperative Shell** pattern by mixing business logic with resource management.

## Current Issues

### TransactionImportService (`packages/ingestion/src/services/import-service.ts`)
- Lines 43-184: `importFromBlockchain()` contains:
  - Address normalization logic
  - Data source deduplication logic
  - Import orchestration logic
- Lines 191-342: `importFromExchange()` contains:
  - Partial import handling
  - Cursor management
  - Error recovery logic

### TransactionProcessService (`packages/ingestion/src/services/process-service.ts`)
- Lines 66-137: `processAllPending()` contains aggregation and grouping logic
- Lines 142-358: `processRawDataToTransactions()` contains:
  - Raw data grouping by session (lines 181-209)
  - Complex filtering and mapping logic
  - Transaction batching logic

## Proposed Solution

Create utility files with pure functions:

### `import-service-utils.ts`
```typescript
export function shouldReuseExistingImport(
  existingSource: DataSource | null,
  params: ImportParams
): boolean;

export function normalizeBlockchainImportParams(
  sourceId: string,
  params: ImportParams,
  config: BlockchainConfig
): Result<NormalizedParams, Error>;

export function prepareImportSession(
  sourceId: string,
  params: ImportParams
): ImportSessionConfig;
```

### `process-service-utils.ts`
```typescript
export function groupRawDataBySession(
  rawData: ExternalTransactionData[]
): Map<number, ExternalTransactionData[]>;

export function filterSessionsWithPendingData(
  sessions: DataSource[],
  rawDataBySession: Map<number, ExternalTransactionData[]>
): SessionProcessingData[];

export function buildSessionProcessingQueue(
  sessions: SessionProcessingData[]
): ProcessingQueue;
```

## Benefits
- ✅ Pure functions can be unit tested without mocking repositories
- ✅ Business logic reusable across contexts
- ✅ Clear separation of computation from side effects
- ✅ Service classes become thin orchestrators

## Acceptance Criteria
- [ ] Extract pure functions to `*-utils.ts` files
- [ ] Service classes delegate to pure functions
- [ ] Add unit tests for extracted functions (no mocks)
- [ ] All existing tests pass

## Priority
**HIGH** - Foundation for other processor refactorings

## Related Issues
Part of Functional Core / Imperative Shell audit
