export { TransactionIngestionService } from './app/services/ingestion-service.ts';

// Import-related types
export type { ImportResult } from './app/ports/importers.ts';

// Port interfaces
export type { ITransactionRepository } from './app/ports/transaction-repository.ts';

export { BlockchainProviderManager } from './infrastructure/blockchains/shared/blockchain-provider-manager.ts';
