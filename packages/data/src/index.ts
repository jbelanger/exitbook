// DataContext — primary entry point for consumers
export { DataContext } from './data-context.js';

// Repositories
export {
  AccountRepository,
  ImportSessionRepository,
  NearRawTransactionRepository,
  RawTransactionRepository,
  TransactionLinkRepository,
  TransactionRepository,
  UserRepository,
} from './repositories/index.js';
export type {
  FindOrCreateAccountParams,
  UpdateAccountParams,
  RawDataQueryParams,
  TransactionLinkRow,
  TransactionQueryParams,
  FullTransactionQueryParams,
  SummaryTransactionQueryParams,
  TransactionSummary,
} from './repositories/index.js';

// Storage / initialization
export { createDatabase, closeDatabase, initializeDatabase, type KyselyDB } from './storage/initialization.js';
export { runMigrations, getMigrationStatus } from './storage/migrations.js';

export { generateDeterministicTransactionHash } from './repositories/transaction-id-utils.js';
export {
  createTokenMetadataPersistence,
  type TokenMetadataPersistenceDeps,
} from './persistence/token-metadata/factory.js';
export { createTokenMetadataQueries, type TokenMetadataQueries } from './persistence/token-metadata/queries.js';
export type { TokenMetadataDatabase } from './persistence/token-metadata/schema.js';
export type { DatabaseSchema, TransactionLinksTable, RawTransactionTable } from './schema/database-schema.js';
export { toRawTransaction, withControlledTransaction } from './repositories/db-utils.js';

export * from './overrides/index.js';
export { createTestDatabase, createTestDataContext } from './test-utils.js';
