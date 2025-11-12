// Imperative shell for prices command
// Manages resources (database, price providers) and orchestrates business logic

import { Currency } from '@exitbook/core';
import { TransactionRepository } from '@exitbook/data';
import type { KyselyDB } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { CoinNotFoundError, PriceDataUnavailableError, type PriceProviderManager } from '@exitbook/price-providers';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { promptManualPrice } from './prices-prompts.js';
import type { PricesFetchCommandOptions, PricesFetchResult } from './prices-utils.js';
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
  private transactionRepo: TransactionRepository;
  private priceManager: PriceProviderManager | undefined;
  private errors: string[] = [];

  constructor(private db: KyselyDB) {
    this.transactionRepo = new TransactionRepository(db);
  }

  /**
   * Execute prices fetch command
   */
  async execute(options: PricesFetchCommandOptions): Promise<Result<PricesFetchResult, Error>> {
    // Initialize price provider manager using shared factory
    const managerResult = await createDefaultPriceProviderManager();

    if (managerResult.isErr()) {
      return err(managerResult.error);
    }

    this.priceManager = managerResult.value;

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
      // Progress reporting
      if (processed > 0 && processed % progressInterval === 0) {
        logger.info(
          `Progress: ${processed}/${transactions.length} transactions processed ` +
            `(${stats.movementsUpdated} movements updated, ${stats.failures} failures)`
        );
      }

      processed++;

      // Stop early if all providers are consistently failing
      if (consecutiveFailures >= maxConsecutiveFailures) {
        logger.warn(
          `Stopping after ${consecutiveFailures} consecutive failures. ` +
            `This likely indicates all providers are unavailable or data is outside allowed range.`
        );
        const remaining = transactions.length - processed;
        stats.failures += remaining;
        this.errors.push(`Stopped early: ${remaining} transactions not processed due to provider unavailability`);
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
        price: { amount: import('decimal.js').Decimal; currency: import('@exitbook/core').Currency };
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
          // Handle error with optional interactive prompt
          const errorResult = await this.handlePriceFetchError(
            priceResult.error,
            asset,
            tx.id,
            queryResult.value,
            options
          );

          if (errorResult.success && errorResult.fetchedPrice) {
            // Manual price entered successfully - treat as SUCCESS
            consecutiveFailures = 0;
            stats.manualEntries++;

            // Track granularity for manual entries (always 'exact')
            if (errorResult.fetchedPrice.granularity) {
              stats.granularity[errorResult.fetchedPrice.granularity]++;
            }

            fetchedPrices.push(errorResult.fetchedPrice);
          } else {
            // Error not resolved - treat as FAILURE
            if (errorResult.errorMessage) {
              this.errors.push(errorResult.errorMessage);
            }
            consecutiveFailures++;
            txHadFailure = true;
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
        const { enrichMovementsWithPrices } = await import('@exitbook/accounting');
        const enrichedInflows = enrichMovementsWithPrices(tx.movements.inflows ?? [], pricesMap);
        const enrichedOutflows = enrichMovementsWithPrices(tx.movements.outflows ?? [], pricesMap);

        // Enrich fees with prices (applying same priority rules as movements)
        const enrichedFees = tx.fees.map((fee) => {
          const newPrice = pricesMap.get(fee.asset);
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
    }

    return ok({ stats, errors: this.errors });
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    // Price manager cleanup if needed
  }

  /**
   * Handle price fetch error with optional interactive prompt
   *
   * Pure-ish function - performs logging and I/O but doesn't mutate instance state.
   * Caller is responsible for adding errorMessage to this.errors if present.
   *
   * @returns Result indicating success, optional fetched price, and optional error message
   */
  private async handlePriceFetchError(
    error: Error,
    asset: string,
    txId: number,
    query: import('@exitbook/price-providers').PriceQuery,
    options: PricesFetchCommandOptions
  ): Promise<{
    errorMessage?: string;
    fetchedPrice?: {
      asset: string;
      fetchedAt: Date;
      granularity?: 'exact' | 'minute' | 'hour' | 'day' | undefined;
      price: { amount: import('decimal.js').Decimal; currency: Currency };
      source: string;
    };
    success: boolean;
  }> {
    // Debug logging
    logger.debug(
      {
        errorType: error.constructor.name,
        isCoinNotFoundError: error instanceof CoinNotFoundError,
        isPriceDataUnavailableError: error instanceof PriceDataUnavailableError,
        onMissing: options.onMissing,
        errorMessage: error.message,
      },
      'Price fetch error details'
    );

    // Check if this is a recoverable error and prompt mode is enabled
    const isRecoverableError = error instanceof CoinNotFoundError || error instanceof PriceDataUnavailableError;

    if (isRecoverableError && options.onMissing === 'prompt') {
      const errorReason = error instanceof CoinNotFoundError ? 'Coin not found' : 'Price data unavailable';
      logger.info(`${errorReason}: ${asset}. Prompting for manual price entry...`);

      const manualPrice = await promptManualPrice(asset, query.timestamp, query.currency.toString());

      if (manualPrice) {
        // User provided manual price - treat as SUCCESS
        logger.info(`Manual price recorded for ${asset}: ${manualPrice.price.toString()} ${manualPrice.currency}`);

        return {
          fetchedPrice: {
            asset,
            fetchedAt: new Date(),
            granularity: 'exact', // Manual entries are exact prices
            price: {
              amount: manualPrice.price,
              currency: Currency.create(manualPrice.currency),
            },
            source: manualPrice.source,
          },
          success: true,
        };
      } else {
        // User skipped - treat as FAILURE
        logger.info(`Manual price entry skipped for ${asset}`);

        return {
          success: false,
          errorMessage: `Transaction ${txId}, asset ${asset}: ${error.message} (manual entry skipped)`,
        };
      }
    }

    // Regular error (not recoverable or not in interactive mode)
    logger.warn(`Failed to fetch price for ${asset} in transaction ${txId}: ${error.message}`);

    return {
      success: false,
      errorMessage: `Transaction ${txId}, asset ${asset}: ${error.message}`,
    };
  }
}
