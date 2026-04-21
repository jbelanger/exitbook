import type { Result } from '@exitbook/foundation';
import { resultDoAsync } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { KyselyDB } from './database.js';
import { closeDatabase, initializeDatabase } from './database.js';
import { AccountRepository } from './repositories/account-repository.js';
import { AccountingIssueRepository } from './repositories/accounting-issue-repository.js';
import { AssetReviewRepository } from './repositories/asset-review-repository.js';
import { BalanceSnapshotRepository } from './repositories/balance-snapshot-repository.js';
import { CostBasisFailureSnapshotRepository } from './repositories/cost-basis-failure-snapshot-repository.js';
import { CostBasisSnapshotRepository } from './repositories/cost-basis-snapshot-repository.js';
import { ImportSessionRepository } from './repositories/import-session-repository.js';
import { NearRawTransactionRepository } from './repositories/near-raw-transaction-repository.js';
import { ProfileRepository } from './repositories/profile-repository.js';
import { ProjectionStateRepository } from './repositories/projection-state-repository.js';
import { RawTransactionRepository } from './repositories/raw-transaction-repository.js';
import { TransactionLinkRepository } from './repositories/transaction-link-repository.js';
import { TransactionRepository } from './repositories/transaction-repository.js';
import { TransactionAnnotationStore } from './transaction-interpretation/transaction-annotation-store.js';
import { TransactionInterpretationSourceReader } from './transaction-interpretation/transaction-interpretation-source-reader.js';
import { withControlledTransaction } from './utils/controlled-transaction.js';

const logger = getLogger('data-session');

export class DataSession {
  static async initialize(dbPath: string): Promise<Result<DataSession, Error>> {
    return resultDoAsync(async function* () {
      const connection = yield* await initializeDatabase(dbPath);
      return new DataSession(connection);
    });
  }

  readonly accounts: AccountRepository;
  readonly accountingIssues: AccountingIssueRepository;
  readonly assetReview: AssetReviewRepository;
  readonly balanceSnapshots: BalanceSnapshotRepository;
  readonly costBasisFailureSnapshots: CostBasisFailureSnapshotRepository;
  readonly costBasisSnapshots: CostBasisSnapshotRepository;
  readonly transactions: TransactionRepository;
  readonly transactionLinks: TransactionLinkRepository;
  readonly transactionAnnotations: TransactionAnnotationStore;
  readonly transactionInterpretationSource: TransactionInterpretationSourceReader;
  readonly rawTransactions: RawTransactionRepository;
  readonly importSessions: ImportSessionRepository;
  readonly profiles: ProfileRepository;
  readonly nearRawTransactions: NearRawTransactionRepository;
  readonly projectionState: ProjectionStateRepository;

  private readonly connection: KyselyDB;
  private readonly isTransactionScoped: boolean;

  constructor(connection: KyselyDB, isTransactionScoped = false) {
    this.connection = connection;
    this.isTransactionScoped = isTransactionScoped;
    this.accounts = new AccountRepository(connection);
    this.accountingIssues = new AccountingIssueRepository(connection);
    this.assetReview = new AssetReviewRepository(connection);
    this.balanceSnapshots = new BalanceSnapshotRepository(connection);
    this.costBasisFailureSnapshots = new CostBasisFailureSnapshotRepository(connection);
    this.costBasisSnapshots = new CostBasisSnapshotRepository(connection);
    this.transactions = new TransactionRepository(connection);
    this.transactionLinks = new TransactionLinkRepository(connection);
    this.transactionAnnotations = new TransactionAnnotationStore(connection);
    this.transactionInterpretationSource = new TransactionInterpretationSourceReader(this.transactions, this.accounts);
    this.rawTransactions = new RawTransactionRepository(connection);
    this.importSessions = new ImportSessionRepository(connection);
    this.profiles = new ProfileRepository(connection);
    this.nearRawTransactions = new NearRawTransactionRepository(connection);
    this.projectionState = new ProjectionStateRepository(connection);
  }

  /**
   * Execute a callback inside a single DB transaction (Unit of Work).
   * The callback receives a transaction-scoped DataSession whose repos
   * are all bound to the same transaction. Commits on ok(), rolls back on err() or throw.
   *
   * If this DataSession is already transaction-scoped (created by an outer
   * executeInTransaction), the callback runs directly on this context — no
   * nested transaction is opened. This lets port methods that internally use
   * executeInTransaction participate in a caller's transaction transparently.
   */
  async executeInTransaction<T>(fn: (tx: DataSession) => Promise<Result<T, Error>>): Promise<Result<T, Error>> {
    if (this.isTransactionScoped) {
      return fn(this);
    }

    return withControlledTransaction(
      this.connection,
      logger,
      async (trx) => {
        const txContext = new DataSession(trx, true);
        return fn(txContext);
      },
      'Transaction failed'
    );
  }

  close(): Promise<Result<void, Error>> {
    return closeDatabase(this.connection);
  }
}
