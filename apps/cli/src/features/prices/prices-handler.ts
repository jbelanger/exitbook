// Imperative shell for prices command
// Manages resources (database, price providers) and orchestrates business logic

import { enrichMovementsWithPrices } from '@exitbook/accounting';
import type { UniversalTransactionData } from '@exitbook/core';
import { Currency } from '@exitbook/core';
import type { TransactionQueries } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/http';
import { getLogger } from '@exitbook/logger';
import { type PriceProviderManager } from '@exitbook/price-providers';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PriceEvent } from './events.js';
import type { PriceFetchStats, PricesFetchCommandOptions, PricesFetchResult } from './prices-utils.js';
import {
  createDefaultPriceProviderManager,
  createPriceQuery,
  extractAssetsNeedingPrices,
  initializeStats,
  validateAssetFilter,
} from './prices-utils.js';

const logger = getLogger('PricesHandler');

/**
 * Handler for prices fetch command
 */
export class PricesFetchHandler {
  private priceManager: PriceProviderManager | undefined;
  private errors: string[] = [];

  constructor(
    private transactionRepo: TransactionQueries,
    private readonly instrumentation: InstrumentationCollector,
    private readonly eventBus?: EventBus<PriceEvent>
  ) {}

  /**
   * Execute prices fetch command
   *
   * @param options - Command options
   * @param providedPriceManager - Optional pre-initialized price manager (avoids double initialization)
   */
  async execute(
    options: PricesFetchCommandOptions,
    providedPriceManager?: PriceProviderManager
  ): Promise<Result<PricesFetchResult, Error>> {
    // Use provided price manager if available, otherwise create new one
    if (providedPriceManager) {
      this.priceManager = providedPriceManager;
    } else {
      const managerResult = await createDefaultPriceProviderManager(this.instrumentation);

      if (managerResult.isErr()) {
        return err(managerResult.error);
      }

      this.priceManager = managerResult.value;
    }

    // Validate asset filter
    const assetFilterResult = validateAssetFilter(options.asset);
    if (assetFilterResult.isErr()) {
      return err(assetFilterResult.error);
    }
    const assetFilter = assetFilterResult.value?.map((c) => c.toString());

    // Query transactions needing prices using repository
    const transactionsResult = await this.transactionRepo.findTransactionsNeedingPrices(assetFilter);
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

    // Process transactions with progress reporting
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
        this.errors.push(`Stopped early: ${remaining} transactions not processed due to provider unavailability`);

        // Emit final progress event before breaking (captures partial work)
        this.eventBus?.emit({
          type: 'stage.progress',
          stage: 'marketPrices',
          processed,
          total: transactions.length,
        });
        break;
      }

      // Extract unique assets from transaction movements
      const assetsResult = extractAssetsNeedingPrices(tx);
      if (assetsResult.isErr()) {
        logger.warn(`Skipping transaction ${tx.id}: ${assetsResult.error.message}`);
        this.errors.push(`Transaction ${tx.id}: ${assetsResult.error.message}`);
        stats.skipped++;
        continue;
      }

      const assetsNeedingPrices = assetsResult.value;
      if (assetsNeedingPrices.length === 0) {
        // All movements already have prices
        stats.skipped++;
        continue;
      }

      if (!this.priceManager) {
        return err(new Error('Price manager not initialized'));
      }

      // Fetch prices for each asset in this transaction
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
          this.errors.push(`Transaction ${tx.id}, asset ${asset}: ${queryResult.error.message}`);
          txHadFailure = true;
          continue;
        }

        const priceResult = await this.priceManager.fetchPrice(queryResult.value);

        if (priceResult.isErr()) {
          logger.warn(`Failed to fetch price for ${asset} in transaction ${tx.id}: ${priceResult.error.message}`);
          this.errors.push(`Transaction ${tx.id}, asset ${asset}: ${priceResult.error.message}`);
          consecutiveFailures++;
          txHadFailure = true;

          if (options.onMissing === 'fail') {
            return this.buildAbortReport(asset, tx, stats);
          }

          continue;
        }

        // Reset consecutive failures on success
        consecutiveFailures = 0;

        const priceData = priceResult.value.data;
        stats.pricesFetched++;

        // Track granularity
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

      // Update transaction movements with all fetched prices
      if (fetchedPrices.length > 0) {
        // Build price map from fetched prices
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

        // Enrich all movements (inflows, outflows, and fees) with priority rules
        const enrichedInflows = enrichMovementsWithPrices(tx.movements.inflows ?? [], pricesMap);
        const enrichedOutflows = enrichMovementsWithPrices(tx.movements.outflows ?? [], pricesMap);

        // Enrich fees with prices (applying same priority rules as movements)
        const enrichedFees = tx.fees.map((fee) => {
          const newPrice = pricesMap.get(fee.assetSymbol);
          if (!newPrice) {
            return fee;
          }

          // Apply same priority logic as enrichMovementWithPrice
          if (!fee.priceAtTxTime) {
            return { ...fee, priceAtTxTime: newPrice };
          }

          // Helper to get priority (same as in movement-enrichment-utils.js)
          const getPriority = (source: string): number => {
            const priorities: Record<string, number> = {
              'exchange-execution': 3,
              'derived-ratio': 2,
              'link-propagated': 2,
              'fiat-execution-tentative': 0,
            };
            return priorities[source] ?? 1;
          };

          const existingPriority = getPriority(fee.priceAtTxTime.source);
          const newPriority = getPriority(newPrice.source);

          if (newPriority > existingPriority) {
            return { ...fee, priceAtTxTime: newPrice };
          }

          // Allow derived sources to refresh at same priority
          const isDerivedSource = (s: string) => s === 'derived-ratio' || s === 'link-propagated';
          if (
            newPriority === existingPriority &&
            isDerivedSource(newPrice.source) &&
            isDerivedSource(fee.priceAtTxTime.source)
          ) {
            return { ...fee, priceAtTxTime: newPrice };
          }

          return fee;
        });

        // Build enriched transaction
        const enrichedTx = {
          ...tx,
          movements: {
            inflows: enrichedInflows,
            outflows: enrichedOutflows,
          },
          fees: enrichedFees,
        };

        const updateResult = await this.transactionRepo.updateMovementsWithPrices(enrichedTx);

        if (updateResult.isErr()) {
          logger.error(`Failed to update movements for transaction ${tx.id}: ${updateResult.error.message}`);
          this.errors.push(`Transaction ${tx.id}: ${updateResult.error.message}`);
          stats.failures++;
        } else {
          stats.movementsUpdated += fetchedPrices.length;
        }
      }

      if (txHadFailure) {
        stats.failures++;
      }

      // Increment processed counter and report progress
      processed++;

      // Emit progress event periodically and at end
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

    return ok({ stats, errors: this.errors, runStats });
  }

  /**
   * Cleanup resources
   *
   * Idempotent: safe to call multiple times.
   */
  async destroy(): Promise<void> {
    if (this.priceManager) {
      await this.priceManager.destroy();
      this.priceManager = undefined;
    }
  }

  /**
   * Build abort report when missing price is encountered in fail mode
   */
  private buildAbortReport(
    asset: string,
    tx: UniversalTransactionData,
    stats: PriceFetchStats
  ): Result<PricesFetchResult, Error> {
    const errorMessage = [
      `Price enrichment aborted: missing price for ${asset}`,
      '',
      'Missing Price Details:',
      `  Asset: ${asset}`,
      `  Transaction ID: ${tx.id}`,
      `  Transaction Date: ${tx.datetime}`,
      `  Source: ${tx.source}`,
      '',
      'Suggested Actions:',
      `  1. Manually set price for this asset:`,
      `     pnpm run dev prices set --asset ${asset} --date "${tx.datetime}" --price <amount> --currency USD`,
      '',
      `  2. View all transactions needing prices for this asset:`,
      `     pnpm run dev prices view --asset ${asset} --missing-only`,
      '',
      `  3. View this specific transaction:`,
      `     pnpm run dev transactions view --id ${tx.id}`,
      '',
      'Progress Before Abort:',
      `  Transactions processed: ${stats.movementsUpdated}/${stats.transactionsFound}`,
      `  Prices fetched: ${stats.pricesFetched}`,
      `  Manual entries: ${stats.manualEntries}`,
      `  Failures: ${stats.failures}`,
    ].join('\n');

    return err(new Error(errorMessage));
  }
}
