/**
 * @exitbook/blockchain-providers
 *
 * Public package API for blockchain provider runtimes, contracts, and normalized chain models.
 */

export { BlockchainProviderManager } from './runtime/index.js';

export type { ProviderEvent } from './events.js';

export {
  createAssetReviewProviderSupport,
  findLatestTokenMetadataRefreshAt,
} from './token-metadata/asset-review-provider-support.js';
export {
  createBlockchainProviderRuntime,
  type BlockchainProviderRuntime,
  type BlockchainProviderRuntimeOptions,
} from './runtime/create-blockchain-provider-runtime.js';
export {
  loadBlockchainProviderCatalog,
  type BlockchainProviderCatalog,
  type ProviderCatalogEntry,
} from './catalog/provider-catalog.js';
export {
  openProviderBenchmarkSession,
  type BenchmarkableBlockchainProvider,
  type OpenProviderBenchmarkSessionOptions,
  type ProviderBenchmarkSession,
} from './runtime/provider-benchmark-session.js';

export type { ProviderStatsSnapshot } from './provider-stats/index.js';

export type { TokenMetadataRecord } from './token-metadata/contracts.js';
export type { TokenReferenceLookupResult } from './token-metadata/reference/index.js';

export type { RawBalanceData, TransactionWithRawData } from './contracts/common.js';
export { ProviderError } from './contracts/errors.js';
export type { NormalizedTransactionBase } from './contracts/normalized-transaction.js';
export type { FailoverExecutionResult, ProviderOperationType } from './contracts/operations.js';
export type { IBlockchainProvider } from './contracts/provider.js';
export type { BlockchainExplorersConfig } from './catalog/explorer-config.js';

export {
  BITCOIN_CHAINS,
  getBitcoinChainConfig,
  BitcoinTransactionSchema,
  canonicalizeBitcoinAddress,
  initializeBitcoinXpubWallet,
  isBitcoinXpub,
  satoshisToBtcString,
  type BitcoinChainConfig,
  type BitcoinTransaction,
  type BitcoinWalletAddress,
} from './blockchains/bitcoin/index.js';

export {
  CardanoTransactionSchema,
  initializeCardanoXpubWallet,
  isCardanoXpub,
  isValidCardanoAddress,
  normalizeCardanoAddress,
  type CardanoTransaction,
  type CardanoTransactionInput,
  type CardanoTransactionOutput,
  type CardanoWalletAddress,
} from './blockchains/cardano/index.js';

export {
  COSMOS_CHAINS,
  getCosmosChainConfig,
  CosmosTransactionSchema,
  validateBech32Address,
  type CosmosChainConfig,
  type CosmosTransaction,
} from './blockchains/cosmos/index.js';

export {
  EVM_CHAINS,
  getEvmChainConfig,
  EvmTransactionSchema,
  isValidEvmAddress,
  normalizeEvmAddress,
  type EvmChainConfig,
  type EvmTransaction,
} from './blockchains/evm/index.js';

export {
  NearStreamEventSchema,
  NearStreamTypeSchema,
  isValidNearAccountId,
  type NearActionType,
  type NearBalanceChange,
  type NearBalanceChangeCause,
  type NearReceipt,
  type NearReceiptAction,
  type NearStreamEvent,
  type NearStreamType,
  type NearTokenTransfer,
  type NearTransaction,
} from './blockchains/near/index.js';

export { SolanaTransactionSchema, isValidSolanaAddress, type SolanaTransaction } from './blockchains/solana/index.js';

export {
  SUBSTRATE_CHAINS,
  getSubstrateChainConfig,
  SubstrateTransactionSchema,
  derivePolkadotAddressVariants,
  isValidSS58Address,
  type SubstrateChainConfig,
  type SubstrateTransaction,
} from './blockchains/substrate/index.js';

export { THETA_CHAINS, getThetaChainConfig, type ThetaChainConfig } from './blockchains/theta/index.js';

export {
  XRP_CHAINS,
  getXrpChainConfig,
  XrpTransactionSchema,
  isValidXrpAddress,
  normalizeXrpAddress,
  type XrpBalanceChange,
  type XrpChainConfig,
  type XrpTransaction,
} from './blockchains/xrp/index.js';
