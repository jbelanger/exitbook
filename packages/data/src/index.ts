// DataContext — primary entry point for consumers
export { DataContext } from './data-context.js';

// Repositories
export {
  AccountRepository,
  ImportSessionRepository,
  NearRawTransactionRepository,
  ProjectionStateRepository,
  RawTransactionRepository,
  TransactionLinkRepository,
  TransactionRepository,
  UserRepository,
  UtxoConsolidatedMovementRepository,
} from './repositories/index.js';
export type {
  FindOrCreateAccountParams,
  ProjectionStateRow,
  UpdateAccountParams,
  RawDataQueryParams,
  TransactionLinkRow,
  TransactionQueryParams,
  FullTransactionQueryParams,
  SummaryTransactionQueryParams,
  TransactionSummary,
} from './repositories/index.js';

export { generateDeterministicTransactionHash } from './utils/transaction-id-utils.js';
export type {
  DatabaseSchema,
  ProjectionStateTable,
  TransactionLinksTable,
  RawTransactionTable,
  UtxoConsolidatedMovementsTable,
} from './database-schema.js';
export { toRawTransaction, withControlledTransaction } from './utils/db-utils.js';

export * from './overrides/index.js';

// Adapters — bridge DataContext to capability-owned port interfaces
export { buildAccountQueryPorts } from './adapters/account-query-ports-adapter.js';
export { buildCostBasisPorts } from './adapters/cost-basis-ports-adapter.js';
export { buildImportPorts } from './adapters/import-ports-adapter.js';
export { buildIngestionPurgePorts } from './adapters/ingestion-purge-adapter.js';
export { buildLinkingPorts } from './adapters/linking-ports-adapter.js';
export { buildLinksFreshnessPorts } from './adapters/links-freshness-adapter.js';
export { buildLinksResetPorts } from './adapters/links-reset-adapter.js';
export { buildPricingPorts } from './adapters/pricing-ports-adapter.js';
export { buildProcessedTransactionsFreshnessPorts } from './adapters/processed-transactions-freshness-adapter.js';
export { buildProcessedTransactionsResetPorts } from './adapters/processed-transactions-reset-adapter.js';
export { buildPriceCoverageDataPorts } from './adapters/transaction-price-coverage-adapter.js';
export { buildBalancePorts } from './adapters/balance-ports-adapter.js';
export { buildProcessingPorts } from './adapters/processing-ports-adapter.js';
