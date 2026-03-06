// Driven ports (secondary / output) — implemented by the data adapter layer
export type { IProcessingBatchSource } from './processing-batch-source.js';
export type { INearBatchSource } from './near-batch-source.js';
export type { IProcessedTransactionSink } from './processed-transaction-sink.js';
export type { IAccountLookup, ProcessingAccountInfo } from './account-lookup.js';
export type { IImportSessionLookup, ImportSessionStatus } from './import-session-guard.js';

// Aggregate dependency type for the processing service
export type { ProcessingPorts } from './processing-ports.js';
