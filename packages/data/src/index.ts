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

export { generateDeterministicTransactionHash } from './utils/transaction-id-utils.js';
export type { DatabaseSchema, TransactionLinksTable, RawTransactionTable } from './database-schema.js';
export { toRawTransaction, withControlledTransaction } from './utils/db-utils.js';

export * from './overrides/index.js';
