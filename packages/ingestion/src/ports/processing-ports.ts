import type { IAccountLookup } from './account-lookup.js';
import type { IDerivedDataCleaner } from './derived-data-cleaner.js';
import type { IImportSessionLookup } from './import-session-guard.js';
import type { INearBatchSource } from './near-batch-source.js';
import type { IProcessedTransactionSink } from './processed-transaction-sink.js';
import type { IProcessingBatchSource } from './processing-batch-source.js';

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
  derivedDataCleaner: IDerivedDataCleaner;
}
