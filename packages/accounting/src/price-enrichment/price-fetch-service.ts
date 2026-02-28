import { type Currency } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector } from '@exitbook/observability';
import { type PriceProviderManager } from '@exitbook/price-providers';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { enrichMovementsWithPrices, enrichWithPrice } from './movement-enrichment-utils.js';
import type { PriceEvent } from './price-events.js';
import type { PriceFetchStats, PriceFetchOptions, PricesFetchResult } from './price-fetch-utils.js';
import {
  createPriceQuery,
  extractAssetsNeedingPrices,
  initializeStats,
  validateAssetFilter,
} from './price-fetch-utils.js';

const logger = getLogger('PriceFetchService');

/**
 * Structured error for when --on-missing=fail triggers an abort.
 * Carries structured data so callers can format their own messages.
 */
export class PriceFetchAbortError extends Error {
  constructor(
    public readonly asset: string,
    public readonly transactionId: string,
    public readonly transactionDate: string,
    public readonly source: string,
    public readonly stats: PriceFetchStats
  ) {
    super(`Missing price for ${asset} in transaction ${transactionId}`);
    this.name = 'PriceFetchAbortError';
  }
}

/**
 * Service for fetching and persisting market prices for transactions
 */
export class PriceFetchService {
  constructor(
    private readonly db: DataContext,
    private readonly instrumentation: InstrumentationCollector,
    private readonly eventBus?: EventBus<PriceEvent>
  ) {}

  /**
   * Fetch prices for transactions.
   *
   * @param options - Fetch options
   * @param priceManager - Initialized price provider manager (caller is responsible for lifecycle)
   */
  async fetchPrices(
    options: PriceFetchOptions,
    priceManager: PriceProviderManager
  ): Promise<Result<PricesFetchResult, Error>> {
    const errors: string[] = [];

    // Validate asset filter
    const assetFilterResult = validateAssetFilter(options.asset);
    if (assetFilterResult.isErr()) {
      return err(assetFilterResult.error);
    }
    const assetFilter = assetFilterResult.value?.map((c) => c.toString());

    // Query transactions needing prices
    const transactionsResult = await this.db.transactions.findTransactionsNeedingPrices(assetFilter);
    if (transactionsResult.isErr()) {
      return err(transactionsResult.error);
    }

    const transactions = transactionsResult.value;
    const stats = initializeStats();
    stats.transactionsFound = transactions.length;

    if (transactions.length === 0) {
      logger.info('No transactions found needing prices');
      return ok({ stats, errors: [] });
    }

    logger.info(`Found ${transactions.length} transactions needing prices`);

    const progressInterval = 50;
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 5;
    let processed = 0;

    for (const tx of transactions) {
      // Stop early if all providers are consistently failing
      if (consecutiveFailures >= maxConsecutiveFailures) {
        logger.warn(
          `Stopping after ${consecutiveFailures} consecutive failures. ` +
            `This likely indicates all providers are unavailable or data is outside allowed range.`
        );
        const remaining = transactions.length - processed;
        stats.failures += remaining;
        errors.push(`Stopped early: ${remaining} transactions not processed due to provider unavailability`);

        this.eventBus?.emit({
          type: 'stage.progress',
          stage: 'marketPrices',
          processed,
          total: transactions.length,
        });
        break;
      }

      const assetsResult = extractAssetsNeedingPrices(tx);
      if (assetsResult.isErr()) {
        logger.warn(`Skipping transaction ${tx.id}: ${assetsResult.error.message}`);
        errors.push(`Transaction ${tx.id}: ${assetsResult.error.message}`);
        stats.skipped++;
        continue;
      }

      const assetsNeedingPrices = assetsResult.value;
      if (assetsNeedingPrices.length === 0) {
        stats.skipped++;
        continue;
      }

      const fetchedPrices: {
        asset: string;
        fetchedAt: Date;
        granularity?: 'exact' | 'minute' | 'hour' | 'day' | undefined;
        price: { amount: Decimal; currency: Currency };
        source: string;
      }[] = [];

      let txHadFailure = false;

      for (const asset of assetsNeedingPrices) {
        const queryResult = createPriceQuery(tx, asset);
        if (queryResult.isErr()) {
          logger.warn(`Skipping asset ${asset} for transaction ${tx.id}: ${queryResult.error.message}`);
          errors.push(`Transaction ${tx.id}, asset ${asset}: ${queryResult.error.message}`);
          txHadFailure = true;
          continue;
        }

        const priceResult = await priceManager.fetchPrice(queryResult.value);

        if (priceResult.isErr()) {
          logger.warn(`Failed to fetch price for ${asset} in transaction ${tx.id}: ${priceResult.error.message}`);
          errors.push(`Transaction ${tx.id}, asset ${asset}: ${priceResult.error.message}`);
          consecutiveFailures++;
          txHadFailure = true;

          if (options.onMissing === 'fail') {
            return err(new PriceFetchAbortError(asset, String(tx.id), tx.datetime, tx.source, { ...stats }));
          }

          continue;
        }

        consecutiveFailures = 0;

        const priceData = priceResult.value.data;
        stats.pricesFetched++;

        if (priceData.granularity) {
          stats.granularity[priceData.granularity]++;
        }

        fetchedPrices.push({
          asset,
          fetchedAt: priceData.fetchedAt,
          granularity: priceData.granularity,
          price: {
            amount: priceData.price,
            currency: priceData.currency,
          },
          source: priceData.source,
        });
      }

      if (fetchedPrices.length > 0) {
        const pricesMap = new Map(
          fetchedPrices.map((fp) => [
            fp.asset,
            {
              price: fp.price,
              source: fp.source,
              fetchedAt: fp.fetchedAt,
              granularity: fp.granularity,
            },
          ])
        );

        const enrichedInflows = enrichMovementsWithPrices(tx.movements.inflows ?? [], pricesMap);
        const enrichedOutflows = enrichMovementsWithPrices(tx.movements.outflows ?? [], pricesMap);
        const enrichedFees = tx.fees.map((fee) => {
          const newPrice = pricesMap.get(fee.assetSymbol);
          return newPrice ? enrichWithPrice(fee, newPrice) : fee;
        });

        const enrichedTx = {
          ...tx,
          movements: { inflows: enrichedInflows, outflows: enrichedOutflows },
          fees: enrichedFees,
        };

        const updateResult = await this.db.executeInTransaction((txCtx) =>
          txCtx.transactions.updateMovementsWithPrices(enrichedTx)
        );

        if (updateResult.isErr()) {
          logger.error(`Failed to update movements for transaction ${tx.id}: ${updateResult.error.message}`);
          errors.push(`Transaction ${tx.id}: ${updateResult.error.message}`);
          stats.failures++;
        } else {
          stats.movementsUpdated += fetchedPrices.length;
        }
      }

      if (txHadFailure) {
        stats.failures++;
      }

      processed++;

      if (processed % progressInterval === 0 || processed === transactions.length) {
        logger.info(
          `Progress: ${processed}/${transactions.length} transactions processed ` +
            `(${stats.movementsUpdated} movements updated, ${stats.failures} failures)`
        );
        this.eventBus?.emit({
          type: 'stage.progress',
          stage: 'marketPrices',
          processed,
          total: transactions.length,
        });
      }
    }

    const runStats = this.instrumentation?.getSummary();

    return ok({ stats, errors, runStats });
  }
}
