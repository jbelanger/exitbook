// Driven ports (secondary / output) — implemented by the data adapter layer
export type { IProcessingBatchSource } from './processing-batch-source.js';
export type { INearBatchSource } from './near-batch-source.js';
export type { IProcessedTransactionSink } from './processed-transaction-sink.js';
export type { IAccountLookup, ProcessingAccountInfo } from './account-lookup.js';
export type { IImportSessionLookup, ImportSessionLookupStatus } from './import-session-guard.js';
export type { IIngestionDataPurge, IngestionPurgeImpact } from './ingestion-data-purge.js';
export type {
  IProcessedTransactionsFreshness,
  ProcessedTransactionsFreshnessResult,
} from './processed-transactions-freshness.js';
export type { IProcessedTransactionsReset, ProcessedTransactionsResetImpact } from './processed-transactions-reset.js';
export type {
  AssetReviewProjectionFreshnessResult,
  AssetReviewProjectionWorkflowPorts,
  AssetReviewProjectionRuntimePorts,
} from './asset-review-projection-ports.js';

// Aggregate dependency types
export type { ITransactionNoteProjection, ProcessingPorts } from './processing-ports.js';
export type {
  CreateImportAccountInput,
  FinalizeImportSessionInput,
  ImportAccountFilters,
  ImportPorts,
  UpdateImportAccountInput,
  UpdateImportSessionInput,
} from './import-ports.js';
export type { BalancePorts, BalanceTransactionQuery } from './balance-ports.js';
export {
  loadBalanceScopeContext,
  loadBalanceScopeMemberAccounts,
  resolveBalanceScopeAccount,
  resolveBalanceScopeAccountId,
} from './balance-scope.js';
export type {
  BalanceScopeAccount,
  BalanceScopeContext,
  IBalanceScopeAccountLookup,
  IBalanceScopeHierarchyLookup,
  ResolveBalanceScopeOptions,
} from './balance-scope.js';
