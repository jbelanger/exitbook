import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { AccountRepository } from './repositories/account-repository.js';
import { withControlledTransaction } from './repositories/db-utils.js';
import { ImportSessionRepository } from './repositories/import-session-repository.js';
import { NearRawTransactionRepository } from './repositories/near-raw-data-repository.js';
import { RawTransactionRepository } from './repositories/raw-transaction-repository.js';
import { TransactionLinkRepository } from './repositories/transaction-link-repository.js';
import { TransactionRepository } from './repositories/transaction-repository.js';
import { UserRepository } from './repositories/user-repository.js';
import type { KyselyDB } from './storage/initialization.js';
import { closeDatabase, initializeDatabase } from './storage/initialization.js';

const logger = getLogger('data-context');

export class DataContext {
  static async initialize(dbPath: string): Promise<Result<DataContext, Error>> {
    const initResult = await initializeDatabase(dbPath);
    if (initResult.isErr()) return err(initResult.error);
    return ok(new DataContext(initResult.value));
  }

  readonly accounts: AccountRepository;
  readonly transactions: TransactionRepository;
  readonly transactionLinks: TransactionLinkRepository;
  readonly rawTransactions: RawTransactionRepository;
  readonly importSessions: ImportSessionRepository;
  readonly users: UserRepository;
  readonly nearRawData: NearRawTransactionRepository;

  private readonly connection: KyselyDB;

  constructor(connection: KyselyDB) {
    this.connection = connection;
    this.accounts = new AccountRepository(connection);
    this.transactions = new TransactionRepository(connection);
    this.transactionLinks = new TransactionLinkRepository(connection);
    this.rawTransactions = new RawTransactionRepository(connection);
    this.importSessions = new ImportSessionRepository(connection);
    this.users = new UserRepository(connection);
    this.nearRawData = new NearRawTransactionRepository(connection);
  }

  /**
   * Execute a callback inside a single DB transaction (Unit of Work).
   * The callback receives a transaction-scoped DataContext whose repos
   * are all bound to the same transaction. Commits on ok(), rolls back on err() or throw.
   */
  async executeInTransaction<T>(fn: (tx: DataContext) => Promise<Result<T, Error>>): Promise<Result<T, Error>> {
    return withControlledTransaction(
      this.connection,
      logger,
      async (trx) => {
        const txContext = new DataContext(trx);
        return fn(txContext);
      },
      'Transaction failed'
    );
  }

  async close(): Promise<Result<void, Error>> {
    return closeDatabase(this.connection);
  }
}
