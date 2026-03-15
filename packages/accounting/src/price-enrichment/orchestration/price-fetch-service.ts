import { type Currency, type PriceAtTxTime } from '@exitbook/core';
import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector } from '@exitbook/observability';
import { type PriceProviderManager } from '@exitbook/price-providers';
import type { Decimal } from 'decimal.js';

import type { AccountingExclusionPolicy } from '../../cost-basis/standard/validation/accounting-exclusion-policy.js';
import type { IPricingPersistence } from '../../ports/pricing-persistence.js';
import {
  enrichFeesWithPricesByAssetId,
  enrichMovementsWithPricesByAssetId,
} from '../enrichment/movement-enrichment-utils.js';
import type { PriceFetchStats, PriceFetchOptions, PricesFetchResult } from '../enrichment/price-fetch-utils.js';
import {
  createPriceQuery,
  extractPriceFetchCandidates,
  initializeStats,
  validateAssetFilter,
} from '../enrichment/price-fetch-utils.js';
import type { PriceEvent } from '../shared/price-events.js';

const logger = getLogger('PriceFetchService');

/**
 * Structured error for when --on-missing=fail triggers an abort.
 * Carries structured data so callers can format their own messages.
 */
class PriceFetchAbortError extends Error {
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
    private readonly store: IPricingPersistence,
    private readonly instrumentation: InstrumentationCollector,
    private readonly eventBus?: EventBus<PriceEvent>,
    private readonly accountingExclusionPolicy?: AccountingExclusionPolicy
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
    const transactionsResult = await this.store.loadTransactionsNeedingPrices(assetFilter);
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

      const candidatesResult = extractPriceFetchCandidates(tx, this.accountingExclusionPolicy);
      if (candidatesResult.isErr()) {
        logger.warn(`Skipping transaction ${tx.id}: ${candidatesResult.error.message}`);
        errors.push(`Transaction ${tx.id}: ${candidatesResult.error.message}`);
        stats.skipped++;
        continue;
      }

      const priceFetchCandidates = candidatesResult.value;
      if (priceFetchCandidates.length === 0) {
        stats.skipped++;
        continue;
      }

      const assetIdsBySymbol = new Map<string, Set<string>>();
      for (const candidate of priceFetchCandidates) {
        const assetIds = assetIdsBySymbol.get(candidate.assetSymbol) ?? new Set<string>();
        assetIds.add(candidate.assetId);
        assetIdsBySymbol.set(candidate.assetSymbol, assetIds);
      }

      const fetchedPricesByAssetId = new Map<string, PriceAtTxTime>();
      const fetchedSymbols: {
        assetSymbol: string;
        fetchedAt: Date;
        granularity?: 'exact' | 'minute' | 'hour' | 'day' | undefined;
        price: { amount: Decimal; currency: Currency };
        source: string;
      }[] = [];

      let txHadFailure = false;

      for (const [assetSymbol, targetAssetIds] of assetIdsBySymbol) {
        const queryResult = createPriceQuery(tx, assetSymbol);
        if (queryResult.isErr()) {
          logger.warn(`Skipping asset ${assetSymbol} for transaction ${tx.id}: ${queryResult.error.message}`);
          errors.push(`Transaction ${tx.id}, asset ${assetSymbol}: ${queryResult.error.message}`);
          txHadFailure = true;
          continue;
        }

        const priceResult = await priceManager.fetchPrice(queryResult.value);

        if (priceResult.isErr()) {
          logger.warn(`Failed to fetch price for ${assetSymbol} in transaction ${tx.id}: ${priceResult.error.message}`);
          errors.push(`Transaction ${tx.id}, asset ${assetSymbol}: ${priceResult.error.message}`);
          consecutiveFailures++;
          txHadFailure = true;

          if (options.onMissing === 'fail') {
            return err(new PriceFetchAbortError(assetSymbol, String(tx.id), tx.datetime, tx.source, { ...stats }));
          }

          continue;
        }

        consecutiveFailures = 0;

        const priceData = priceResult.value.data;
        stats.pricesFetched++;

        if (priceData.granularity) {
          stats.granularity[priceData.granularity]++;
        }

        const fetchedPrice: PriceAtTxTime = {
          fetchedAt: priceData.fetchedAt,
          price: {
            amount: priceData.price,
            currency: priceData.currency,
          },
          source: priceData.source,
          ...(priceData.granularity ? { granularity: priceData.granularity } : {}),
        };

        for (const assetId of targetAssetIds) {
          fetchedPricesByAssetId.set(assetId, fetchedPrice);
        }

        fetchedSymbols.push({
          assetSymbol,
          fetchedAt: priceData.fetchedAt,
          granularity: priceData.granularity,
          price: {
            amount: priceData.price,
            currency: priceData.currency,
          },
          source: priceData.source,
        });
      }

      if (fetchedSymbols.length > 0) {
        const enrichedInflows = enrichMovementsWithPricesByAssetId(tx.movements.inflows ?? [], fetchedPricesByAssetId);
        const enrichedOutflows = enrichMovementsWithPricesByAssetId(
          tx.movements.outflows ?? [],
          fetchedPricesByAssetId
        );
        const enrichedFees = enrichFeesWithPricesByAssetId(tx.fees, fetchedPricesByAssetId);

        const enrichedTx = {
          ...tx,
          movements: { inflows: enrichedInflows, outflows: enrichedOutflows },
          fees: enrichedFees,
        };

        const updateResult = await this.store.saveTransactionPrices(enrichedTx);

        if (updateResult.isErr()) {
          logger.error(`Failed to update movements for transaction ${tx.id}: ${updateResult.error.message}`);
          errors.push(`Transaction ${tx.id}: ${updateResult.error.message}`);
          stats.failures++;
        } else {
          stats.movementsUpdated += fetchedPricesByAssetId.size;
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
