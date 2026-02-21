// Pure business logic for prices command
// All functions are pure and testable

import path from 'node:path';

import { isFiat, parseCurrency, type Currency, type UniversalTransactionData } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector, MetricsSummary } from '@exitbook/http';
import { createPriceProviderManager, type PriceProviderManager } from '@exitbook/price-providers';
import type { PriceProviderEvent } from '@exitbook/price-providers';
import type { PriceQuery } from '@exitbook/price-providers';
import { err, ok, type Result } from 'neverthrow';

import { getDataDir } from '../shared/data-dir.js';

import type { PriceEvent } from './events.js';

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
    day: number; // Daily only
    exact: number; // Exact price at timestamp (manual, trade execution)
    hour: number; // Hourly intraday
    minute: number; // Minute-level intraday
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

  const results: Currency[] = [];
  for (const a of assets) {
    const result = parseCurrency(a);
    if (result.isErr()) return err(result.error);
    results.push(result.value);
  }
  return ok(results);
}

/**
 * Extract unique assets from a transaction's movements that need prices
 * Filters out fiat currencies as they don't need price fetching
 * Treats 'fiat-execution-tentative' prices as still needing fetch (fallback for Stage 2 failures)
 */
export function extractAssetsNeedingPrices(tx: UniversalTransactionData): Result<string[], Error> {
  // Check movements
  const inflows = tx.movements.inflows ?? [];
  const outflows = tx.movements.outflows ?? [];
  const fees = tx.fees ?? [];

  if (inflows.length === 0 && outflows.length === 0 && fees.length === 0) {
    return err(new Error(`Transaction ${tx.id} has no movements`));
  }

  // Get unique assets that don't already have prices or have tentative non-USD prices
  const assetsNeedingPrices = new Set<string>();

  // Check asset movements (inflows/outflows)
  for (const movement of [...inflows, ...outflows]) {
    // Movement needs price if:
    // 1. No price at all, OR
    // 2. Price source is 'fiat-execution-tentative' (not yet normalized to USD)
    // This ensures Stage 3 fetch runs as fallback if Stage 2 FX normalization fails
    const needsPrice = !movement.priceAtTxTime || movement.priceAtTxTime.source === 'fiat-execution-tentative';

    if (needsPrice) {
      // Skip fiat currencies - they don't need price fetching
      if (!isFiat(movement.assetSymbol)) {
        assetsNeedingPrices.add(movement.assetSymbol);
      }
    }
  }

  // Check fee movements (different structure: has 'amount' instead of 'grossAmount')
  for (const fee of fees) {
    const needsPrice = !fee.priceAtTxTime || fee.priceAtTxTime.source === 'fiat-execution-tentative';

    if (needsPrice) {
      // Skip fiat currencies - they don't need price fetching
      if (!isFiat(fee.assetSymbol)) {
        assetsNeedingPrices.add(fee.assetSymbol);
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
  tx: UniversalTransactionData,
  assetSymbol: string,
  targetCurrency = 'USD'
): Result<PriceQuery, Error> {
  if (!tx.datetime) {
    return err(new Error(`Transaction ${tx.id} has no transaction datetime`));
  }

  // Parse datetime
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
 * Determine which enrichment stages should run based on command options
 *
 * Stage selection logic:
 * - If only one stage flag is set, only that stage runs
 * - If no stage flags are set, all stages run (default pipeline)
 * - Multiple stage flags are mutually exclusive
 *
 * Examples:
 * - {} → { normalize: true, derive: true, fetch: true } (all stages)
 * - { deriveOnly: true } → { normalize: false, derive: true, fetch: false }
 * - { fetchOnly: true } → { normalize: false, derive: false, fetch: true }
 */
export function determineEnrichmentStages(options: EnrichmentStageOptions): EnrichmentStages {
  return {
    normalize: !options.deriveOnly && !options.fetchOnly,
    derive: !options.normalizeOnly && !options.fetchOnly,
    fetch: !options.normalizeOnly && !options.deriveOnly,
  };
}

/**
 * Create default price provider manager with all providers enabled
 *
 * This factory centralizes the provider configuration to eliminate duplication
 * between PricesEnrichHandler and PricesFetchHandler.
 *
 * @returns Result with initialized price provider manager
 */
export async function createDefaultPriceProviderManager(
  instrumentation?: InstrumentationCollector,
  // PriceEvent is a superset of PriceProviderEvent; cast is safe because the
  // price-providers package only ever calls bus.emit(PriceProviderEvent)
  eventBus?: EventBus<PriceEvent>
): Promise<Result<PriceProviderManager, Error>> {
  const dataDir = getDataDir();
  return createPriceProviderManager({
    providers: {
      databasePath: path.join(dataDir, 'prices.db'),
      // Crypto price providers
      coingecko: {
        enabled: true,
        apiKey: process.env['COINGECKO_API_KEY'],
        useProApi: process.env['COINGECKO_USE_PRO_API'] === 'true',
      },
      cryptocompare: {
        enabled: true,
        apiKey: process.env['CRYPTOCOMPARE_API_KEY'],
      },
      // FX rate providers
      ecb: {
        enabled: true,
      },
      'bank-of-canada': {
        enabled: true,
      },
      frankfurter: {
        enabled: true,
      },
    },
    manager: {
      defaultCurrency: 'USD',
      maxConsecutiveFailures: 3,
      cacheTtlSeconds: 3600,
    },
    instrumentation,
    eventBus: eventBus as EventBus<PriceProviderEvent> | undefined,
  });
}
