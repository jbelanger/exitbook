// Export registration functions for explicit initialization
export { registerAllBlockchains } from './sources/blockchains/index.ts';
export { registerAllExchanges } from './sources/exchanges/index.ts';

export { ImportOrchestrator } from './features/importing/import-orchestrator.ts';
export { TransactionProcessService } from './features/processing/process-service.ts';
export { ClearService } from './features/deletion/clear-service.js';
export type { ClearResult } from './features/deletion/clear-service.js';
export type { ClearServiceParams, DeletionPreview } from './features/deletion/clear-service-utils.js';
export { AccountService } from './features/accounts/account-service.js';
export type { ViewAccountsParams } from './features/accounts/account-service.js';
export type {
  AccountQueryParams,
  AccountQueryResult,
  FormattedAccount,
  SessionSummary,
} from './features/accounts/account-service-utils.js';

// Token metadata services
export { TokenMetadataService } from './features/token-metadata/token-metadata-service.js';
export type { ITokenMetadataService } from './features/token-metadata/token-metadata-service.interface.js';

// Balance services
export { BalanceService, type BalanceServiceParams } from './features/balances/balance-service.js';
export { calculateBalances } from './features/balances/balance-calculator.js';
export {
  fetchExchangeBalance,
  fetchBlockchainBalance,
  fetchChildAccountsBalance,
  convertBalancesToDecimals,
  type UnifiedBalanceSnapshot,
} from './features/balances/balance-utils.js';
export {
  compareBalances,
  createVerificationResult,
  generateVerificationReport,
} from './features/balances/balance-verifier.js';
export type { BalanceComparison, BalanceVerificationResult } from './features/balances/balance-verifier.types.js';

// Types
export type { ImportParams } from './shared/types/importers.ts';

// Concrete implementations

// Blockchain configuration
export {
  getBlockchainAdapter,
  getAllBlockchains,
  hasBlockchainAdapter as hasBlockchainConfig,
  clearBlockchainAdapters,
  type BlockchainAdapter as BlockchainConfig,
} from './shared/types/blockchain-adapter.js';

// Exchange configuration
export {
  getExchangeAdapter,
  getAllExchanges,
  hasExchangeAdapter,
  clearExchangeAdapters,
  type ExchangeAdapter,
} from './shared/types/exchange-adapter.js';
