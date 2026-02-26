// Pure business logic for price fetch operations

import { isFiat, parseCurrency, type Currency, type UniversalTransactionData } from '@exitbook/core';
import type { MetricsSummary } from '@exitbook/http';
import type { PriceQuery } from '@exitbook/price-providers';
import { err, ok, type Result } from 'neverthrow';

/**
 * Command options for prices fetch
 */
export interface PricesFetchCommandOptions {
  /** Optional asset filter (e.g., 'BTC', 'ETH') */
  asset?: string | string[] | undefined;
  /** How to handle missing prices/FX rates */
  onMissing?: 'fail' | undefined;
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
  manualEntries: number;
  /** Granularity breakdown */
  granularity: {
    day: number;
    exact: number;
    hour: number;
    minute: number;
  };
}

/**
 * Result data for prices fetch command
 */
export interface PricesFetchResult {
  stats: PriceFetchStats;
  errors: string[];
  runStats?: MetricsSummary | undefined;
}

/**
 * Validate asset filter
 */
export function validateAssetFilter(asset: string | string[] | undefined): Result<Currency[] | undefined, Error> {
  if (!asset) {
    return ok([]);
  }

  const assets = Array.isArray(asset) ? asset : [asset];

  for (const a of assets) {
    if (typeof a !== 'string' || a.trim().length === 0) {
      return err(new Error(`Invalid asset: ${String(a)}`));
    }
    if (!/^[A-Z0-9]+$/.test(a.toUpperCase())) {
      return err(new Error(`Invalid asset format: ${a}. Must contain only letters and numbers.`));
    }
  }

  const results: Currency[] = [];
  for (const a of assets) {
    const result = parseCurrency(a);
    if (result.isErr()) return err(result.error);
    results.push(result.value);
  }
  return ok(results);
}

/**
 * Extract unique assets from a transaction's movements that need prices.
 * Filters out fiat currencies and movements that already have non-tentative prices.
 */
export function extractAssetsNeedingPrices(tx: UniversalTransactionData): Result<string[], Error> {
  const inflows = tx.movements.inflows ?? [];
  const outflows = tx.movements.outflows ?? [];
  const fees = tx.fees ?? [];

  if (inflows.length === 0 && outflows.length === 0 && fees.length === 0) {
    return err(new Error(`Transaction ${tx.id} has no movements`));
  }

  const assetsNeedingPrices = new Set<string>();

  for (const movement of [...inflows, ...outflows]) {
    const needsPrice = !movement.priceAtTxTime || movement.priceAtTxTime.source === 'fiat-execution-tentative';

    if (needsPrice) {
      if (!isFiat(movement.assetSymbol)) {
        assetsNeedingPrices.add(movement.assetSymbol);
      }
    }
  }

  for (const fee of fees) {
    const needsPrice = !fee.priceAtTxTime || fee.priceAtTxTime.source === 'fiat-execution-tentative';

    if (needsPrice) {
      if (!isFiat(fee.assetSymbol)) {
        assetsNeedingPrices.add(fee.assetSymbol);
      }
    }
  }

  return ok([...assetsNeedingPrices]);
}

/**
 * Convert transaction and asset to PriceQuery.
 * Always fetches prices in USD regardless of transaction currency.
 */
export function createPriceQuery(
  tx: UniversalTransactionData,
  assetSymbol: string,
  targetCurrency = 'USD'
): Result<PriceQuery, Error> {
  if (!tx.datetime) {
    return err(new Error(`Transaction ${tx.id} has no transaction datetime`));
  }

  const timestamp = new Date(tx.datetime);
  if (isNaN(timestamp.getTime())) {
    return err(new Error(`Transaction ${tx.id} has invalid datetime: ${tx.datetime}`));
  }

  const assetResult = parseCurrency(assetSymbol);
  if (assetResult.isErr()) return err(assetResult.error);

  const currencyResult = parseCurrency(targetCurrency);
  if (currencyResult.isErr()) return err(currencyResult.error);

  return ok({
    assetSymbol: assetResult.value,
    timestamp,
    currency: currencyResult.value,
  });
}

/**
 * Initialize empty stats
 */
export function initializeStats(): PriceFetchStats {
  return {
    failures: 0,
    granularity: {
      day: 0,
      exact: 0,
      hour: 0,
      minute: 0,
    },
    manualEntries: 0,
    movementsUpdated: 0,
    pricesFetched: 0,
    skipped: 0,
    transactionsFound: 0,
  };
}

/**
 * Options for determining enrichment stages
 */
export interface EnrichmentStageOptions {
  normalizeOnly?: boolean | undefined;
  deriveOnly?: boolean | undefined;
  fetchOnly?: boolean | undefined;
}

/**
 * Enrichment stages configuration
 */
export interface EnrichmentStages {
  normalize: boolean;
  derive: boolean;
  fetch: boolean;
}

/**
 * Determine which enrichment stages should run based on command options.
 *
 * - No flags set → all stages run (default pipeline)
 * - Single stage flag → only that stage runs
 * - Multiple stage flags are mutually exclusive
 */
export function determineEnrichmentStages(options: EnrichmentStageOptions): EnrichmentStages {
  return {
    normalize: !options.deriveOnly && !options.fetchOnly,
    derive: !options.normalizeOnly && !options.fetchOnly,
    fetch: !options.normalizeOnly && !options.deriveOnly,
  };
}
