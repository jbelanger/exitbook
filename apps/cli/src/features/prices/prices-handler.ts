// Imperative shell for prices command
// Manages resources (database, price providers) and orchestrates business logic

import { Currency } from '@exitbook/core';
import { TransactionRepository } from '@exitbook/data';
import type { KyselyDB } from '@exitbook/data';
import {
  CoinNotFoundError,
  createPriceProviderManager,
  type PriceProviderManager,
} from '@exitbook/platform-price-providers';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { promptManualPrice } from './prices-prompts.ts';
import type { PricesFetchCommandOptions, PricesFetchResult } from './prices-utils.ts';
import { validateAssetFilter, extractAssetsNeedingPrices, createPriceQuery, initializeStats } from './prices-utils.ts';

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
    // Initialize price provider manager with combined factory
    // Note: API keys are read from process.env by the factory
    // We explicitly pass them here to ensure they're available even if env loading has issues
    const managerResult = await createPriceProviderManager({
      providers: {
        databasePath: './data/prices.db',
        coingecko: {
          enabled: true,
          apiKey: process.env.COINGECKO_API_KEY,
          useProApi: process.env.COINGECKO_USE_PRO_API === 'true',
        },
        cryptocompare: {
          enabled: true,
          apiKey: process.env.CRYPTOCOMPARE_API_KEY,
        },
      },
      manager: {
        defaultCurrency: 'USD',
        maxConsecutiveFailures: 3,
        cacheTtlSeconds: 3600,
      },
    });

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

        // Enrich fees if present
        const enrichedPlatformFee = tx.fees.platform
          ? enrichMovementsWithPrices([tx.fees.platform], pricesMap)[0]
          : undefined;
        const enrichedNetworkFee = tx.fees.network
          ? enrichMovementsWithPrices([tx.fees.network], pricesMap)[0]
          : undefined;

        // Build enriched transaction
        const enrichedTx = {
          ...tx,
          movements: {
            inflows: enrichedInflows,
            outflows: enrichedOutflows,
          },
          fees: {
            platform: enrichedPlatformFee,
            network: enrichedNetworkFee,
          },
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
    query: import('@exitbook/platform-price-providers').PriceQuery,
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
        interactiveMode: options.interactive,
        errorMessage: error.message,
      },
      'Price fetch error details'
    );

    // Check if this is a CoinNotFoundError and interactive mode is enabled
    if (error instanceof CoinNotFoundError && options.interactive) {
      logger.info(`Coin not found: ${asset}. Prompting for manual price entry...`);

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

    // Regular error (not CoinNotFoundError or not in interactive mode)
    logger.warn(`Failed to fetch price for ${asset} in transaction ${txId}: ${error.message}`);

    return {
      success: false,
      errorMessage: `Transaction ${txId}, asset ${asset}: ${error.message}`,
    };
  }
}
