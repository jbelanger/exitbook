// Adapter registry and all registered adapters
export { AdapterRegistry } from './shared/types/adapter-registry.js';
export { allBlockchainAdapters } from './sources/blockchains/index.js';
export { allExchangeAdapters } from './sources/exchanges/index.js';

// Workflows
export { ImportWorkflow } from './features/import/import-workflow.js';
export type {
  ImportParams,
  ImportResult,
  ImportBlockchainParams,
  ImportExchangeApiParams,
  ImportExchangeCsvParams,
} from './features/import/import-workflow.js';
export { ProcessingWorkflow } from './features/process/process-workflow.js';
export type { ReprocessPlan } from './features/process/process-workflow.js';
export { BalanceWorkflow } from './features/balance/balance-workflow.js';
export type { BalanceParams } from './features/balance/balance-workflow.js';
export {
  buildAssetReviewSummaries,
  type AssetReviewDecisionInput,
  type AssetReviewReferenceResolver,
  type AssetReviewTokenMetadataReader,
  type BuildAssetReviewSummariesOptions,
} from './features/asset-review/index.js';
export {
  calculateBalances,
  compareBalances,
  convertBalancesToDecimals,
  createVerificationResult,
  generateVerificationReport,
  type BalanceCalculationResult,
  type BalanceComparison,
  type BalanceVerificationResult,
} from './features/balance/balance-utils.js';
export {
  fetchBlockchainBalance,
  fetchChildAccountsBalance,
  fetchExchangeBalance,
  type UnifiedBalanceSnapshot,
} from './features/balance/balance-fetch-utils.js';

// Types
export type { IImporter, StreamingImportParams } from './shared/types/importers.js';

// Events
export type { ImportEvent, ProcessEvent, IngestionEvent } from './events.js';

// Blockchain adapter types
export {
  isUtxoAdapter,
  type BlockchainAdapter,
  type UtxoBlockchainAdapter,
} from './shared/types/blockchain-adapter.js';

// Exchange adapter types
export { type ExchangeAdapter } from './shared/types/exchange-adapter.js';

// Ports (re-export for convenience — canonical location is @exitbook/ingestion/ports)
export type { ProcessingPorts, ImportPorts, BalancePorts } from './ports/index.js';
export type { IIngestionDataPurge, IngestionPurgeImpact } from './ports/index.js';
