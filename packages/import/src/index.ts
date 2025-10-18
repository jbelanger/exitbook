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
  convertBalancesToDecimals,
  type UnifiedBalanceSnapshot,
} from './services/balance-utils.ts';
export {
  compareBalances,
  createVerificationResult,
  generateVerificationReport,
  type BalanceComparison,
  type BalanceVerificationResult,
} from './services/balance-verifier.ts';

export type { ImportResult } from './app/ports/importers.ts';
export type { LoadRawDataFilters } from './app/ports/raw-data-repository.ts';
export type { IRawDataRepository } from './app/ports/raw-data-repository.ts';
export type { IImportSessionErrorRepository } from './app/ports/import-session-error-repository.interface.ts';

export { RawDataRepository } from './infrastructure/persistence/raw-data-repository.ts';
export { ImportSessionRepository } from './infrastructure/persistence/import-session-repository.ts';
export { ImportSessionErrorRepository } from './infrastructure/persistence/import-session-error-repository.ts';

export { ImporterFactory } from './infrastructure/shared/importers/importer-factory.ts';
export { ProcessorFactory } from './infrastructure/shared/processors/processor-factory.ts';
