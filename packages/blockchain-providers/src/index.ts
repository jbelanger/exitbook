/**
 * @exitbook/blockchain-providers
 *
 * Public package API for blockchain provider runtimes, contracts, and discovery.
 * Chain-specific models and helpers are exported from explicit subpaths.
 */

export type { ProviderEvent } from './events.js';
export type {
  BlockchainBalanceQueryOptions,
  BlockchainProviderSelectionOptions,
  BlockchainTransactionStreamOptions,
  IBlockchainProviderManager,
} from './contracts/provider-manager.js';

export {
  createAssetReviewProviderSupport,
  findLatestTokenMetadataRefreshAt,
} from './token-metadata/asset-review-provider-support.js';
export {
  createBlockchainProviderRuntime,
  type BlockchainProviderRuntime,
  type BlockchainProviderRuntimeOptions,
} from './runtime/create-blockchain-provider-runtime.js';
export { listBlockchainProviders, type BlockchainProviderDescriptor } from './catalog/list-blockchain-providers.js';
export { loadBlockchainProviderHealthStats } from './catalog/load-provider-stats.js';
export { loadBlockchainExplorerConfig, type BlockchainExplorersConfig } from './catalog/load-explorer-config.js';
export {
  openBlockchainProviderBenchmarkSession,
  type BenchmarkableBlockchainProvider,
  type OpenBlockchainProviderBenchmarkSessionOptions,
  type BlockchainProviderBenchmarkSession,
} from './runtime/provider-benchmark-session.js';

export type { ProviderStatsSnapshot } from './provider-stats/index.js';

export type { TokenMetadataRecord } from './token-metadata/contracts.js';
export type { TokenReferenceLookupResult } from './token-metadata/reference/index.js';

export type { RawBalanceData, TransactionWithRawData } from './contracts/common.js';
export { ProviderError } from './contracts/errors.js';
export type { NormalizedTransactionBase } from './contracts/normalized-transaction.js';
export type { FailoverExecutionResult, ProviderOperationType } from './contracts/operations.js';
export type { IBlockchainProvider } from './contracts/provider.js';
