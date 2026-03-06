import type { TransactionLink, UniversalTransactionData } from '@exitbook/core';
import type { Result } from '@exitbook/core';

/**
 * All data needed to run a cost basis calculation.
 */
export interface CostBasisContext {
  /** All transactions (full history needed for lot pool) */
  transactions: UniversalTransactionData[];
  /** Confirmed transaction links for transfer detection */
  confirmedLinks: TransactionLink[];
}

/**
 * Port for cost basis calculation persistence.
 *
 * Domain-shaped: loads the full context in one call rather than
 * exposing separate findAllTransactions() + findConfirmedLinks().
 */
export interface ICostBasisPersistence {
  /** Load all data needed for cost basis calculation */
  loadCostBasisContext(): Promise<Result<CostBasisContext, Error>>;
}
