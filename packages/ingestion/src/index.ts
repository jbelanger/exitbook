// Initialize blockchain configs by importing the registry
import './infrastructure/blockchains';

export { TransactionImportService } from './services/import-service.ts';
export { TransactionProcessService } from './services/process-service.ts';
export {
  PriceEnrichmentService,
  type PriceEnrichmentConfig,
} from './services/price-enrichment/price-enrichment-service.ts';

// Token metadata services
export { TokenMetadataService } from './services/token-metadata/token-metadata-service.ts';
export type { ITokenMetadataService } from './services/token-metadata/token-metadata-service.interface.ts';

// Balance services
export { calculateBalances } from './services/balance/balance-calculator.ts';
export {
  fetchExchangeBalance,
  fetchBlockchainBalance,
  fetchBitcoinXpubBalance,
  convertBalancesToDecimals,
  type UnifiedBalanceSnapshot,
} from './services/balance/balance-utils.ts';
export {
  compareBalances,
  createVerificationResult,
  generateVerificationReport,
} from './services/balance/balance-verifier.ts';
export type { BalanceComparison, BalanceVerificationResult } from './services/balance/balance-verifier.types.ts';

// Types
export type { ImportResult, ImportParams } from './types/importers.ts';
export type { IRawDataRepository, IDataSourceRepository, LoadRawDataFilters } from './types/repositories.ts';

// Concrete implementations
export { RawDataRepository } from './persistence/raw-data-repository.ts';
export { DataSourceRepository } from './persistence/data-source-repository.ts';

// Blockchain configuration
export {
  getBlockchainConfig,
  getAllBlockchains,
  hasBlockchainConfig,
  type BlockchainConfig,
} from './infrastructure/blockchains/shared/blockchain-config.ts';

// Exchange factories
export { createExchangeImporter } from './infrastructure/exchanges/shared/exchange-importer-factory.ts';
export { createExchangeProcessor } from './infrastructure/exchanges/shared/exchange-processor-factory.ts';
