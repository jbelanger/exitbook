// Imperative shell for prices command
// Manages resources (database, price providers) and orchestrates business logic

import type { TransactionNeedingPrice } from '@exitbook/data';
import { TransactionRepository } from '@exitbook/data';
import type { KyselyDB } from '@exitbook/data';
import { createPriceProviders, PriceProviderManager } from '@exitbook/platform-price-providers';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PricesFetchCommandOptions, PricesFetchResult } from './prices-utils.ts';
import { validateAssetFilter, transactionToPriceQuery, createBatches, initializeStats } from './prices-utils.ts';

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
    const providers = await createPriceProviders({
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

    if (providers.length === 0) {
      return err(new Error('No price providers available'));
    }

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

    // Process in batches
    const batchSize = options.batchSize || 50;
    const batches = createBatches(transactions, batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      if (batch) {
        logger.debug(`Processing batch ${i + 1}/${batches.length} (${batch.length} transactions)`);
      } else {
        logger.warn(`Batch ${i + 1} is undefined`);
        continue;
      }

      const batchResult = await this.processBatch(batch);
      if (batchResult.isErr()) {
        // Log error but continue with next batch
        const errorMsg = `Batch ${i + 1} failed: ${batchResult.error.message}`;
        logger.error(errorMsg);
        this.errors.push(errorMsg);
        stats.failures += batch.length;
        continue;
      }

      // Update stats
      const batchStats = batchResult.value;
      stats.pricesFetched += batchStats.fetched;
      stats.pricesUpdated += batchStats.updated;
      stats.failures += batchStats.failed;
      stats.skipped += batchStats.skipped;
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
   * Process a batch of transactions
   */
  private async processBatch(
    transactions: TransactionNeedingPrice[]
  ): Promise<Result<{ failed: number; fetched: number; skipped: number; updated: number }, Error>> {
    if (!this.priceManager) {
      return err(new Error('Price manager not initialized'));
    }

    let fetched = 0;
    let updated = 0;
    let failed = 0;
    let skipped = 0;
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 5; // Stop after 5 consecutive failures

    // Process each transaction individually - fetch and update immediately
    for (const tx of transactions) {
      // Stop early if all providers are consistently failing
      if (consecutiveFailures >= maxConsecutiveFailures) {
        logger.warn(
          `Stopping batch processing after ${consecutiveFailures} consecutive failures. ` +
            `This likely indicates all providers are unavailable or data is outside allowed range.`
        );
        // Mark remaining transactions as failed
        const remaining = transactions.length - (fetched + failed + skipped);
        failed += remaining;
        this.errors.push(`Batch stopped early: ${remaining} transactions not processed due to provider unavailability`);
        break;
      }

      // Convert transaction to price query
      const queryResult = transactionToPriceQuery(tx);
      if (queryResult.isErr()) {
        logger.warn(`Skipping transaction ${tx.id}: ${queryResult.error.message}`);
        this.errors.push(`Transaction ${tx.id}: ${queryResult.error.message}`);
        skipped++;
        continue;
      }

      // Fetch price for this transaction
      const priceResult = await this.priceManager.fetchPrice(queryResult.value);

      if (priceResult.isErr()) {
        logger.warn(`Failed to fetch price for transaction ${tx.id}: ${priceResult.error.message}`);
        this.errors.push(`Transaction ${tx.id}: ${priceResult.error.message}`);
        failed++;
        consecutiveFailures++;
        continue;
      }

      // Reset consecutive failures on success
      consecutiveFailures = 0;

      const priceData = priceResult.value.data;
      fetched++;

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
        failed++;
      } else {
        updated++;
      }
    }

    return ok({ fetched, updated, failed, skipped });
  }
}
