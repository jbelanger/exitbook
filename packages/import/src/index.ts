export { TransactionIngestionService } from './app/services/ingestion-service.ts';

// Import-related types
export type { ImportResult } from './app/ports/importers.ts';

// Port interfaces
export type { ITransactionRepository } from './app/ports/transaction-repository.ts';

export { BlockchainProviderManager } from './infrastructure/blockchains/shared/blockchain-provider-manager.ts';

// Infrastructure exports
export { createTransactionRepository } from './infrastructure/persistence/transaction-repository-factory.ts';
export { createRawDataRepository } from './infrastructure/persistence/raw-data-repository-factory.ts';
export type { LoadRawDataFilters, SaveRawDataOptions } from './app/ports/raw-data-repository.ts';
export type { IRawDataRepository } from './app/ports/raw-data-repository.ts';
