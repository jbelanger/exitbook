import type { Result } from '@exitbook/foundation';

import type { IAccountLookup } from './account-lookup.js';
import type { IImportSessionLookup } from './import-session-guard.js';
import type { INearBatchSource } from './near-batch-source.js';
import type { IProcessedTransactionSink } from './processed-transaction-sink.js';
import type { IProcessingBatchSource } from './processing-batch-source.js';

export interface ITransactionNoteProjection {
  materializeStoredNotes(
    scope?: import('@exitbook/core').TransactionMaterializationScope
  ): Promise<Result<number, Error>>;
}

/**
 * All driven ports required by the processing pipeline.
 * Constructed in the composition root (CLI) and injected into ProcessingWorkflow.
 */
export interface ProcessingPorts {
  batchSource: IProcessingBatchSource;
  nearBatchSource: INearBatchSource;
  transactionSink: IProcessedTransactionSink;
  accountLookup: IAccountLookup;
  importSessionLookup: IImportSessionLookup;
  transactionNotes: ITransactionNoteProjection;

  /** Mark processed-transactions projection as building. */
  markProcessedTransactionsBuilding(): Promise<Result<void, Error>>;

  /** Mark processed-transactions projection as fresh. Computes account hash and cascades downstream invalidation. */
  markProcessedTransactionsFresh(accountIds: number[]): Promise<Result<void, Error>>;

  /** Mark processed-transactions projection as failed. */
  markProcessedTransactionsFailed(): Promise<Result<void, Error>>;

  /** Rebuild the dependent asset-review projection for the processed account scope. */
  rebuildAssetReviewProjection(accountIds: number[]): Promise<Result<void, Error>>;

  /** Execute a callback where all port operations share a single atomic transaction. */
  withTransaction<T>(fn: (txPorts: ProcessingPorts) => Promise<Result<T, Error>>): Promise<Result<T, Error>>;
}
