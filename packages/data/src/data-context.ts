import type { Result } from '@exitbook/core';
import { resultDoAsync } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type { KyselyDB } from './database.js';
import { closeDatabase, initializeDatabase } from './database.js';
import { AccountRepository } from './repositories/account-repository.js';
import { ImportSessionRepository } from './repositories/import-session-repository.js';
import { LinkableMovementRepository } from './repositories/linkable-movement-repository.js';
import { NearRawTransactionRepository } from './repositories/near-raw-data-repository.js';
import { ProjectionStateRepository } from './repositories/projection-state-repository.js';
import { RawDataProcessedStateRepository } from './repositories/raw-data-processed-state-repository.js';
import { RawTransactionRepository } from './repositories/raw-transaction-repository.js';
import { TransactionLinkRepository } from './repositories/transaction-link-repository.js';
import { TransactionRepository } from './repositories/transaction-repository.js';
import { UserRepository } from './repositories/user-repository.js';
import { UtxoConsolidatedMovementRepository } from './repositories/utxo-consolidated-movement-repository.js';
import { withControlledTransaction } from './utils/db-utils.js';

const logger = getLogger('data-context');

export class DataContext {
  static async initialize(dbPath: string): Promise<Result<DataContext, Error>> {
    return resultDoAsync(async function* () {
      const connection = yield* await initializeDatabase(dbPath);
      return new DataContext(connection);
    });
  }

  readonly accounts: AccountRepository;
  readonly transactions: TransactionRepository;
  readonly transactionLinks: TransactionLinkRepository;
  readonly linkableMovements: LinkableMovementRepository;
  readonly rawTransactions: RawTransactionRepository;
  readonly importSessions: ImportSessionRepository;
  readonly users: UserRepository;
  readonly nearRawData: NearRawTransactionRepository;
  readonly projectionState: ProjectionStateRepository;
  readonly rawDataProcessedState: RawDataProcessedStateRepository;
  readonly utxoConsolidatedMovements: UtxoConsolidatedMovementRepository;

  private readonly connection: KyselyDB;
  private readonly isTransactionScoped: boolean;

  constructor(connection: KyselyDB, isTransactionScoped = false) {
    this.connection = connection;
    this.isTransactionScoped = isTransactionScoped;
    this.accounts = new AccountRepository(connection);
    this.transactions = new TransactionRepository(connection);
    this.transactionLinks = new TransactionLinkRepository(connection);
    this.linkableMovements = new LinkableMovementRepository(connection);
    this.rawTransactions = new RawTransactionRepository(connection);
    this.importSessions = new ImportSessionRepository(connection);
    this.users = new UserRepository(connection);
    this.nearRawData = new NearRawTransactionRepository(connection);
    this.projectionState = new ProjectionStateRepository(connection);
    this.rawDataProcessedState = new RawDataProcessedStateRepository(connection);
    this.utxoConsolidatedMovements = new UtxoConsolidatedMovementRepository(connection);
  }

  /**
   * Execute a callback inside a single DB transaction (Unit of Work).
   * The callback receives a transaction-scoped DataContext whose repos
   * are all bound to the same transaction. Commits on ok(), rolls back on err() or throw.
   *
   * If this DataContext is already transaction-scoped (created by an outer
   * executeInTransaction), the callback runs directly on this context — no
   * nested transaction is opened. This lets port methods that internally use
   * executeInTransaction participate in a caller's transaction transparently.
   */
  async executeInTransaction<T>(fn: (tx: DataContext) => Promise<Result<T, Error>>): Promise<Result<T, Error>> {
    if (this.isTransactionScoped) {
      return fn(this);
    }

    return withControlledTransaction(
      this.connection,
      logger,
      async (trx) => {
        const txContext = new DataContext(trx, true);
        return fn(txContext);
      },
      'Transaction failed'
    );
  }

  async close(): Promise<Result<void, Error>> {
    return closeDatabase(this.connection);
  }
}
