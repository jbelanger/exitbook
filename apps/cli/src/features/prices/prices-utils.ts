// Pure business logic for prices command
// All functions are pure and testable

import { Currency } from '@exitbook/core';
import type { TransactionNeedingPrice } from '@exitbook/data';
import type { PriceQuery } from '@exitbook/platform-price-providers';
import { err, ok, type Result } from 'neverthrow';

/**
 * Command options for prices fetch
 */
export interface PricesFetchCommandOptions {
  /** Optional asset filter (e.g., 'BTC', 'ETH') */
  asset?: string | string[] | undefined;
  /** Process in batches */
  batchSize?: number | undefined;
}

/**
 * Price fetch statistics
 */
export interface PriceFetchStats {
  transactionsFound: number;
  pricesFetched: number;
  pricesUpdated: number;
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
 * Convert database transaction to PriceQuery
 * Always fetches prices in USD regardless of transaction currency
 */
export function transactionToPriceQuery(
  tx: TransactionNeedingPrice,
  targetCurrency = 'USD'
): Result<PriceQuery, Error> {
  // Validate required fields
  if (!tx.movementsPrimaryAsset) {
    return err(new Error(`Transaction ${tx.id} has no primary asset`));
  }

  if (!tx.transactionDatetime) {
    return err(new Error(`Transaction ${tx.id} has no transaction datetime`));
  }

  // Parse datetime
  const timestamp = new Date(tx.transactionDatetime);
  if (isNaN(timestamp.getTime())) {
    return err(new Error(`Transaction ${tx.id} has invalid datetime: ${tx.transactionDatetime}`));
  }

  return ok({
    asset: Currency.create(tx.movementsPrimaryAsset),
    timestamp,
    currency: Currency.create(targetCurrency), // Always use target currency (default USD)
  });
}

/**
 * Create batches from an array
 */
export function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Initialize empty stats
 */
export function initializeStats(): PriceFetchStats {
  return {
    transactionsFound: 0,
    pricesFetched: 0,
    pricesUpdated: 0,
    failures: 0,
    skipped: 0,
  };
}

/**
 * Update stats with batch results
 */
export function updateStats(
  stats: PriceFetchStats,
  batchResults: { failed: number; fetched: number; skipped: number; updated: number }
): PriceFetchStats {
  return {
    ...stats,
    pricesFetched: stats.pricesFetched + batchResults.fetched,
    pricesUpdated: stats.pricesUpdated + batchResults.updated,
    failures: stats.failures + batchResults.failed,
    skipped: stats.skipped + batchResults.skipped,
  };
}
