import type { TransactionLink, UniversalTransactionData } from '@exitbook/core';
import type { Result } from '@exitbook/core';

/**
 * All data needed for the price derivation stage.
 */
export interface PricingContext {
  /** All transactions */
  transactions: UniversalTransactionData[];
  /** Confirmed transaction links for cross-platform price propagation */
  confirmedLinks: TransactionLink[];
}

/**
 * Port for price enrichment persistence.
 *
 * Domain-shaped: bundles related reads into context-loading methods
 * rather than exposing individual repository queries.
 */
export interface IPricingPersistence {
  /** Load all data needed for price derivation (all transactions + confirmed links) */
  loadPricingContext(): Promise<Result<PricingContext, Error>>;

  /** Load transactions that still need prices, optionally filtered by asset */
  loadTransactionsNeedingPrices(assetFilter?: string[]): Promise<Result<UniversalTransactionData[], Error>>;

  /** Persist updated prices for a single transaction */
  saveTransactionPrices(tx: UniversalTransactionData): Promise<Result<void, Error>>;
}
