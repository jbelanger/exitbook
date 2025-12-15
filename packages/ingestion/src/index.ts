// Initialize blockchain and exchange configs by importing the registries
import './sources/blockchains';
import './sources/exchanges';

export { ImportOrchestrator } from './core/import/import-orchestrator.ts';
// TransactionImportService is internal - used only by ImportOrchestrator
export { TransactionProcessService } from './core/process/process-service.ts';
export { ClearService } from './core/clear/clear-service.js';
export type { ClearResult } from './core/clear/clear-service.js';
export type { ClearServiceParams, DeletionPreview } from './core/clear/clear-service-utils.js';
export { AccountService } from './core/accounts/account-service.js';
export type { ViewAccountsParams } from './core/accounts/account-service.js';
export type {
  AccountQueryParams,
  AccountQueryResult,
  FormattedAccount,
  SessionSummary,
} from './core/accounts/account-service-utils.js';

// Token metadata services
export { TokenMetadataService } from './core/token-metadata/token-metadata-service.js';
export type { ITokenMetadataService } from './core/token-metadata/token-metadata-service.interface.js';

// Balance services
export { BalanceService, type BalanceServiceParams } from './core/balance/balance-service.js';
export { calculateBalances } from './core/balance/balance-calculator.js';
export {
  fetchExchangeBalance,
  fetchBlockchainBalance,
  fetchChildAccountsBalance,
  convertBalancesToDecimals,
  type UnifiedBalanceSnapshot,
} from './core/balance/balance-utils.js';
export {
  compareBalances,
  createVerificationResult,
  generateVerificationReport,
} from './core/balance/balance-verifier.js';
export type { BalanceComparison, BalanceVerificationResult } from './core/balance/balance-verifier.types.js';

// Types
export type { ImportParams } from './core/types/importers.ts';

// Concrete implementations

// Blockchain configuration
export {
  getBlockchainAdapter,
  getAllBlockchains,
  hasBlockchainAdapter as hasBlockchainConfig,
  type BlockchainAdapter as BlockchainConfig,
} from './core/types/blockchain-adapter.js';

// Exchange configuration
export {
  getExchangeAdapter,
  getAllExchanges,
  hasExchangeAdapter,
  type ExchangeAdapter,
} from './core/types/exchange-adapter.js';
