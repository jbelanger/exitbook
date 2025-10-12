// Pure business logic for prices command
// All functions are pure and testable

import { Currency, type AssetMovement } from '@exitbook/core';
import type { TransactionNeedingPrice } from '@exitbook/data';
import type { PriceQuery } from '@exitbook/platform-price-providers';
import { err, ok, type Result } from 'neverthrow';

/**
 * Command options for prices fetch
 */
export interface PricesFetchCommandOptions {
  /** Optional asset filter (e.g., 'BTC', 'ETH') */
  asset?: string | string[] | undefined;
}

/**
 * Price fetch statistics
 */
export interface PriceFetchStats {
  transactionsFound: number;
  pricesFetched: number;
  movementsUpdated: number;
  failures: number;
  skipped: number;
}

/**
 * Result data for prices fetch command
 */
export interface PricesFetchResult {
  stats: PriceFetchStats;
  errors: string[];
}

/**
 * Validate asset filter
 */
export function validateAssetFilter(asset: string | string[] | undefined): Result<Currency[] | undefined, Error> {
  if (!asset) {
    return ok([]);
  }

  const assets = Array.isArray(asset) ? asset : [asset];

  // Validate each asset is a valid currency string
  for (const a of assets) {
    if (typeof a !== 'string' || a.trim().length === 0) {
      return err(new Error(`Invalid asset: ${String(a)}`));
    }
    // Basic validation - uppercase letters only
    if (!/^[A-Z0-9]+$/.test(a.toUpperCase())) {
      return err(new Error(`Invalid asset format: ${a}. Must contain only letters and numbers.`));
    }
  }

  return ok(assets.map((a) => Currency.create(a)));
}

/**
 * Extract unique assets from a transaction's movements that need prices
 * Filters out fiat currencies as they don't need price fetching
 */
export function extractAssetsNeedingPrices(tx: TransactionNeedingPrice): Result<string[], Error> {
  const allMovements: AssetMovement[] = [...(tx.movementsInflows ?? []), ...(tx.movementsOutflows ?? [])];

  if (allMovements.length === 0) {
    return err(new Error(`Transaction ${tx.id} has no movements`));
  }

  // Get unique assets that don't already have prices
  const assetsNeedingPrices = new Set<string>();
  for (const movement of allMovements) {
    if (!movement.priceAtTxTime) {
      // Skip fiat currencies - they don't need price fetching
      const currency = Currency.create(movement.asset);
      if (!currency.isFiat()) {
        assetsNeedingPrices.add(movement.asset);
      }
    }
  }

  return ok([...assetsNeedingPrices]);
}

/**
 * Convert transaction and asset to PriceQuery
 * Always fetches prices in USD regardless of transaction currency
 */
export function createPriceQuery(
  tx: TransactionNeedingPrice,
  asset: string,
  targetCurrency = 'USD'
): Result<PriceQuery, Error> {
  if (!tx.transactionDatetime) {
    return err(new Error(`Transaction ${tx.id} has no transaction datetime`));
  }

  // Parse datetime
  const timestamp = new Date(tx.transactionDatetime);
  if (isNaN(timestamp.getTime())) {
    return err(new Error(`Transaction ${tx.id} has invalid datetime: ${tx.transactionDatetime}`));
  }

  return ok({
    asset: Currency.create(asset),
    timestamp,
    currency: Currency.create(targetCurrency),
  });
}

/**
 * Initialize empty stats
 */
export function initializeStats(): PriceFetchStats {
  return {
    transactionsFound: 0,
    pricesFetched: 0,
    movementsUpdated: 0,
    failures: 0,
    skipped: 0,
  };
}
