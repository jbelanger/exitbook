import type { Currency, Result, Transaction, TransactionLink } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

/**
 * FX rate data with metadata
 */
export interface FxRateData {
  /** Exchange rate (e.g., 1.08 for EUR→USD) */
  rate: Decimal;

  /** Source of the rate (e.g., 'ecb', 'bank-of-canada', 'user-provided') */
  source: string;

  /** When the rate was fetched or provided */
  fetchedAt: Date;
}

/**
 * Provider for FX rates used by price normalization and reporting.
 */
export interface IFxRateProvider {
  /**
   * Get FX rate to convert from source currency to USD.
   */
  getRateToUSD(sourceCurrency: Currency, timestamp: Date): Promise<Result<FxRateData, Error>>;

  /**
   * Get FX rate to convert from USD to target currency.
   */
  getRateFromUSD(targetCurrency: Currency, timestamp: Date): Promise<Result<FxRateData, Error>>;
}

/**
 * A group of transitively linked transactions
 * Built using Union-Find algorithm to group all connected transactions together
 */
export interface LinkedTransactionGroup {
  /**
   * Unique identifier for this group
   */
  groupId: string;

  /**
   * All transactions in this group (may span multiple exchanges/blockchains)
   */
  transactions: Transaction[];

  /**
   * Set of unique source IDs in this group
   * e.g., ['kraken', 'bitcoin', 'ethereum']
   */
  sources: Set<string>;

  /**
   * All confirmed links within this group
   */
  linkChain: TransactionLink[];
}
