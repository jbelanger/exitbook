// Driven ports (secondary / output) — implemented by the data adapter layer
export type { IProcessingBatchSource } from './processing-batch-source.js';
export type { INearBatchSource } from './near-batch-source.js';
export type { IProcessedTransactionSink } from './processed-transaction-sink.js';
export type { IAccountLookup, ProcessingAccountInfo } from './account-lookup.js';
export type { IImportSessionLookup, ImportSessionStatus } from './import-session-guard.js';
export type { IDerivedDataCleaner, DerivedDataDeletionResult } from './derived-data-cleaner.js';

// Aggregate dependency types
export type { ProcessingPorts } from './processing-ports.js';
export type {
  ImportPorts,
  IImportUserLookup,
  IImportAccountStore,
  IImportSessionStore,
  IImportRawTransactionSink,
  FindOrCreateAccountParams,
} from './import-ports.js';
