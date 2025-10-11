// Imperative shell for prices command
// Manages resources (database, price providers) and orchestrates business logic

import { TransactionRepository } from '@exitbook/data';
import type { KyselyDB } from '@exitbook/data';
import { createPriceProviders, PriceProviderManager } from '@exitbook/platform-price-providers';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PricesFetchCommandOptions, PricesFetchResult } from './prices-utils.ts';
import { validateAssetFilter, transactionToPriceQuery, initializeStats } from './prices-utils.ts';

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
    // Initialize price providers
    // Note: API keys are read from process.env by the factory
    // We explicitly pass them here to ensure they're available even if env loading has issues
    const providersResult = await createPriceProviders({
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
    });

    if (providersResult.isErr()) {
      return err(providersResult.error);
    }

    const providers = providersResult.value;

    // Create price manager
    this.priceManager = new PriceProviderManager({
      defaultCurrency: 'USD',
      maxConsecutiveFailures: 3,
      cacheTtlSeconds: 3600,
    });

    this.priceManager.registerProviders(providers);

    // Validate asset filter
    const assetFilterResult = validateAssetFilter(options.asset);
    if (assetFilterResult.isErr()) {
      return err(assetFilterResult.error);
    }
    const assetFilter = assetFilterResult.value;

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
            `(${stats.pricesUpdated} updated, ${stats.failures} failures)`
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

      // Convert transaction to price query
      const queryResult = transactionToPriceQuery(tx);
      if (queryResult.isErr()) {
        logger.warn(`Skipping transaction ${tx.id}: ${queryResult.error.message}`);
        this.errors.push(`Transaction ${tx.id}: ${queryResult.error.message}`);
        stats.skipped++;
        continue;
      }

      // Fetch price for this transaction
      if (!this.priceManager) {
        return err(new Error('Price manager not initialized'));
      }

      const priceResult = await this.priceManager.fetchPrice(queryResult.value);

      if (priceResult.isErr()) {
        logger.warn(`Failed to fetch price for transaction ${tx.id}: ${priceResult.error.message}`);
        this.errors.push(`Transaction ${tx.id}: ${priceResult.error.message}`);
        stats.failures++;
        consecutiveFailures++;
        continue;
      }

      // Reset consecutive failures on success
      consecutiveFailures = 0;

      const priceData = priceResult.value.data;
      stats.pricesFetched++;

      // Update transaction using repository
      const updateResult = await this.transactionRepo.updateTransactionPrice(tx.id, {
        priceAtTxTime: priceData.price.toString(),
        priceAtTxTimeCurrency: priceData.currency,
        priceAtTxTimeSource: priceData.source,
        priceAtTxTimeFetchedAt: priceData.fetchedAt.toISOString(),
      });

      if (updateResult.isErr()) {
        logger.error(`Failed to update transaction ${tx.id}: ${updateResult.error.message}`);
        this.errors.push(`Transaction ${tx.id}: ${updateResult.error.message}`);
        stats.failures++;
      } else {
        stats.pricesUpdated++;
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
}
