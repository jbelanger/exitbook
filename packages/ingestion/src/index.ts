export { TransactionIngestionService } from './app/services/ingestion-service.ts';
export {
  PriceEnrichmentService,
  type PriceEnrichmentConfig,
} from './services/price-enrichment/price-enrichment-service.ts';

// Balance services
export { calculateBalances } from './services/balance-calculator.ts';
export {
  fetchExchangeBalance,
  fetchBlockchainBalance,
  fetchBitcoinXpubBalance,
  convertBalancesToDecimals,
  type UnifiedBalanceSnapshot,
} from './services/balance-utils.ts';
export { compareBalances, createVerificationResult, generateVerificationReport } from './services/balance-verifier.ts';
export type { BalanceComparison, BalanceVerificationResult } from './services/balance-verifier.types.ts';

export type { ImportResult } from './app/ports/importers.ts';
export type { LoadRawDataFilters } from './app/ports/raw-data-repository.ts';
export type { IRawDataRepository } from './app/ports/raw-data-repository.ts';

export { RawDataRepository } from './infrastructure/persistence/raw-data-repository.ts';
export { DataSourceRepository } from './infrastructure/persistence/data-source-repository.ts';

export { ImporterFactory } from './infrastructure/shared/importers/importer-factory.ts';
export { ProcessorFactory } from './infrastructure/shared/processors/processor-factory.ts';
