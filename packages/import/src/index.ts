// Auto-register all providers when package is imported
import './infrastructure/blockchains/registry/register-apis.js';
import './infrastructure/blockchains/registry/register-mappers.js';

export { TransactionIngestionService } from './app/services/ingestion-service.ts';

// Port interfaces
export type { ImportResult } from './app/ports/importers.ts';
export type { ITransactionRepository } from './app/ports/transaction-repository.ts';
export type { LoadRawDataFilters } from './app/ports/raw-data-repository.ts';
export type { IRawDataRepository } from './app/ports/raw-data-repository.ts';

export { BlockchainProviderManager } from './infrastructure/blockchains/shared/blockchain-provider-manager.ts';
export { ProviderRegistry, type ProviderInfo } from './infrastructure/blockchains/shared/registry/provider-registry.ts';

// Infrastructure exports
export { TransactionRepository } from './infrastructure/persistence/transaction-repository.ts';
export { RawDataRepository } from './infrastructure/persistence/raw-data-repository.ts';
export { ImportSessionRepository } from './infrastructure/persistence/import-session-repository.ts';

export { DefaultNormalizer } from './infrastructure/shared/normalizers/normalizer.ts';
export { ImporterFactory } from './infrastructure/shared/importers/importer-factory.ts';
export { ProcessorFactory } from './infrastructure/shared/processors/processor-factory.ts';
