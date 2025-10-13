import type { AssetMovement, Currency, PriceAtTxTime } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { StoredTransaction } from '@exitbook/data';
import type { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import {
  calculatePriceFromTrade,
  extractTradeMovements,
  findClosestPrice,
  inferPriceFromTrade,
} from './price-calculation-utils.ts';

const logger = getLogger('PriceEnrichmentService');

export interface PriceEnrichmentConfig {
  /**
   * Maximum time delta in milliseconds to consider a price "close enough"
   * Default: 1 hour (3600000ms)
   */
  maxTimeDeltaMs: number;

  /**
   * Maximum number of inference passes to prevent infinite loops
   * Default: 10
   */
  maxIterations: number;
}

/**
 * Service for enriching transaction movements with price data
 * derived from the transaction data itself.
 *
 * Implements a multi-pass inference algorithm:
 * 1. Extract known prices from fiat/stablecoin trades
 * 2. Iteratively infer prices from crypto-crypto trades
 * 3. Fill remaining gaps using temporal proximity
 */
export class PriceEnrichmentService {
  private readonly config: Required<PriceEnrichmentConfig>;

  constructor(
    private readonly transactionRepository: TransactionRepository,
    config?: PriceEnrichmentConfig
  ) {
    this.config = {
      maxTimeDeltaMs: config?.maxTimeDeltaMs ?? 3_600_000, // 1 hour
      maxIterations: config?.maxIterations ?? 10,
    };
  }

  /**
   * Main entry point: enrich prices for all transactions needing prices
   */
  async enrichPrices(): Promise<Result<{ transactionsUpdated: number }, Error>> {
    try {
      logger.info('Starting price enrichment process');

      // Find all transactions needing prices
      const needingPricesResult = await this.transactionRepository.findTransactionsNeedingPrices();

      if (needingPricesResult.isErr()) {
        return err(needingPricesResult.error);
      }

      const transactions = needingPricesResult.value;

      if (transactions.length === 0) {
        logger.info('No transactions need price enrichment');
        return ok({ transactionsUpdated: 0 });
      }

      logger.info({ count: transactions.length }, 'Found transactions needing prices');

      // Get full transaction data (we need ALL transactions to build price index,
      // not just the ones needing prices, because already-priced fiat/stable trades
      // serve as anchors for multi-pass inference)
      const allTransactionsResult = await this.transactionRepository.getTransactions();
      if (allTransactionsResult.isErr()) {
        return err(allTransactionsResult.error);
      }

      const allTransactions = allTransactionsResult.value;

      // Track which transactions need price updates (but process all for index building)
      const txIdsNeedingPrices = new Set(transactions.map((tx) => tx.id));

      // Separate by source type (keep all transactions for proper price index building)
      const exchangeTxs = allTransactions.filter((tx) => tx.source_type === 'exchange');
      const blockchainTxs = allTransactions.filter((tx) => tx.source_type === 'blockchain');

      let updatedCount = 0;

      // Process exchanges (grouped by source_id)
      if (exchangeTxs.length > 0) {
        const exchangeResult = await this.enrichExchangePrices(exchangeTxs, txIdsNeedingPrices);
        if (exchangeResult.isErr()) {
          return err(exchangeResult.error);
        }
        updatedCount += exchangeResult.value;
      }

      // Process blockchains (simple swaps only)
      if (blockchainTxs.length > 0) {
        const blockchainResult = await this.enrichBlockchainPrices(blockchainTxs, txIdsNeedingPrices);
        if (blockchainResult.isErr()) {
          return err(blockchainResult.error);
        }
        updatedCount += blockchainResult.value;
      }

      logger.info({ transactionsUpdated: updatedCount }, 'Price enrichment completed');
      return ok({ transactionsUpdated: updatedCount });
    } catch (error) {
      return wrapError(error, 'Failed to enrich prices');
    }
  }

  /**
   * Process exchange transactions with multi-pass inference
   * Groups by exchange (source_id) for independent processing
   */
  private async enrichExchangePrices(
    transactions: StoredTransaction[],
    txIdsNeedingPrices: Set<number>
  ): Promise<Result<number, Error>> {
    try {
      // Group by exchange
      const txsByExchange = this.groupByExchange(transactions);

      logger.info({ exchanges: txsByExchange.size }, 'Processing exchanges');

      let totalUpdated = 0;

      for (const [exchange, txs] of txsByExchange.entries()) {
        logger.debug({ exchange, transactionCount: txs.length }, 'Processing exchange');

        const updated = await this.enrichExchangeGroup(exchange, txs, txIdsNeedingPrices);
        if (updated.isErr()) {
          logger.error({ exchange, error: updated.error }, 'Failed to enrich exchange prices');
          continue;
        }

        totalUpdated += updated.value;
      }

      return ok(totalUpdated);
    } catch (error) {
      return wrapError(error, 'Failed to enrich exchange prices');
    }
  }

  /**
   * Enrich prices for a single exchange using multi-pass inference
   */
  private async enrichExchangeGroup(
    exchange: string,
    transactions: StoredTransaction[],
    txIdsNeedingPrices: Set<number>
  ): Promise<Result<number, Error>> {
    try {
      // Sort by timestamp for temporal processing
      const sortedTxs = [...transactions].sort((a, b) => {
        const timeA = new Date(a.transaction_datetime).getTime();
        const timeB = new Date(b.transaction_datetime).getTime();
        return timeA - timeB;
      });

      // Pass 1: Extract known prices from fiat/stablecoin trades
      const priceIndex = this.extractKnownPrices(sortedTxs);
      logger.debug({ exchange, pricesExtracted: priceIndex.size }, 'Extracted known prices');

      // Pass 2-N: Iterative inference
      const enrichedTxs = this.inferMultiPass(sortedTxs, priceIndex);

      // Update database with enriched prices (only for transactions that need prices)
      let updatedCount = 0;
      let skippedCount = 0;
      for (const tx of enrichedTxs) {
        // Only update transactions that originally needed prices
        if (!txIdsNeedingPrices.has(tx.id)) {
          continue;
        }

        // Check if transaction has any prices to update
        const inflows = this.parseMovements(tx.movements_inflows as string | null);
        const outflows = this.parseMovements(tx.movements_outflows as string | null);
        const hasPrices = [...inflows, ...outflows].some((m) => m.priceAtTxTime);

        if (!hasPrices) {
          skippedCount++;
          continue;
        }

        const updateResult = await this.updateTransactionPrices(tx);
        if (updateResult.isOk()) {
          updatedCount++;
        }
      }

      if (skippedCount > 0) {
        logger.debug({ exchange, skippedCount }, 'Transactions skipped (no prices could be derived)');
      }

      return ok(updatedCount);
    } catch (error) {
      return wrapError(error, `Failed to enrich prices for exchange: ${exchange}`);
    }
  }

  /**
   * Extract known prices from fiat/stablecoin trades
   * Returns a price index: Map<asset, PriceAtTxTime[]>
   */
  private extractKnownPrices(transactions: StoredTransaction[]): Map<string, PriceAtTxTime[]> {
    const priceIndex = new Map<string, PriceAtTxTime[]>();

    for (const tx of transactions) {
      const inflows = this.parseMovements(tx.movements_inflows as string | null);
      const outflows = this.parseMovements(tx.movements_outflows as string | null);
      const timestamp = new Date(tx.transaction_datetime).getTime();

      const trade = extractTradeMovements(inflows, outflows, timestamp);
      if (!trade) {
        continue;
      }

      const prices = calculatePriceFromTrade(trade);

      for (const { asset, priceAtTxTime } of prices) {
        if (!priceIndex.has(asset)) {
          priceIndex.set(asset, []);
        }
        const assetPrices = priceIndex.get(asset);
        if (assetPrices) {
          assetPrices.push(priceAtTxTime);
        }
      }
    }

    return priceIndex;
  }

  /**
   * Multi-pass inference: iteratively infer prices from crypto-crypto trades
   */
  private inferMultiPass(
    transactions: StoredTransaction[],
    priceIndex: Map<string, PriceAtTxTime[]>
  ): StoredTransaction[] {
    // Track which transactions have been enriched with new movements
    const enrichedMovements = new Map<number, { inflows: string; outflows: string }>();

    // Pass 0: Apply exchange-execution prices from fiat/stable trades to their source movements
    // This ensures these movements retain their 'exchange-execution' source instead of being
    // overwritten later with 'derived-history' from Pass N+1 temporal proximity
    for (const tx of transactions) {
      const inflows = this.parseMovements(tx.movements_inflows as string | null);
      const outflows = this.parseMovements(tx.movements_outflows as string | null);
      const timestamp = new Date(tx.transaction_datetime).getTime();

      const trade = extractTradeMovements(inflows, outflows, timestamp);
      if (!trade) {
        continue;
      }

      const prices = calculatePriceFromTrade(trade);

      if (prices.length > 0) {
        const updatedInflows = this.enrichMovements(inflows, prices);
        const updatedOutflows = this.enrichMovements(outflows, prices);

        enrichedMovements.set(tx.id, {
          inflows: JSON.stringify(updatedInflows),
          outflows: JSON.stringify(updatedOutflows),
        });
      }
    }

    logger.debug({ transactionsEnriched: enrichedMovements.size }, 'Pass 0: Applied exchange-execution prices');

    let iteration = 0;
    let pricesAddedInLastPass = 0;

    do {
      pricesAddedInLastPass = 0;
      iteration++;

      if (iteration > this.config.maxIterations) {
        logger.warn({ iteration }, 'Reached max iterations, stopping inference');
        break;
      }

      // Try to infer prices for each transaction
      for (const tx of transactions) {
        // Use enriched movements if available, otherwise use original
        const enriched = enrichedMovements.get(tx.id);
        const currentInflows = (enriched?.inflows ?? tx.movements_inflows) as string | null;
        const currentOutflows = (enriched?.outflows ?? tx.movements_outflows) as string | null;

        const inflows = this.parseMovements(currentInflows);
        const outflows = this.parseMovements(currentOutflows);
        const timestamp = new Date(tx.transaction_datetime).getTime();

        const trade = extractTradeMovements(inflows, outflows, timestamp);
        if (!trade) {
          continue;
        }

        const inferredPrices = inferPriceFromTrade(trade, priceIndex, this.config.maxTimeDeltaMs);

        if (inferredPrices.length > 0) {
          // Add to price index for next iteration
          for (const { asset, priceAtTxTime } of inferredPrices) {
            if (!priceIndex.has(asset)) {
              priceIndex.set(asset, []);
            }
            const assetPrices = priceIndex.get(asset);
            if (assetPrices) {
              assetPrices.push(priceAtTxTime);
              pricesAddedInLastPass++;
            }
          }

          // Update movements with new prices
          const updatedInflows = this.enrichMovements(inflows, inferredPrices);
          const updatedOutflows = this.enrichMovements(outflows, inferredPrices);

          enrichedMovements.set(tx.id, {
            inflows: JSON.stringify(updatedInflows),
            outflows: JSON.stringify(updatedOutflows),
          });
        }
      }

      logger.debug({ iteration, pricesAdded: pricesAddedInLastPass }, 'Inference pass completed');
    } while (pricesAddedInLastPass > 0);

    // Pass N+1: Fill remaining gaps using temporal proximity
    for (const tx of transactions) {
      const enriched = enrichedMovements.get(tx.id);
      const currentInflows = (enriched?.inflows ?? tx.movements_inflows) as string | null;
      const currentOutflows = (enriched?.outflows ?? tx.movements_outflows) as string | null;

      const inflows = this.parseMovements(currentInflows);
      const outflows = this.parseMovements(currentOutflows);
      const timestamp = new Date(tx.transaction_datetime).getTime();

      const allMovements = [...inflows, ...outflows];
      const proximityPrices: { asset: string; priceAtTxTime: PriceAtTxTime }[] = [];

      for (const movement of allMovements) {
        if (movement.priceAtTxTime) {
          continue; // Already has price
        }

        const closestPrice = findClosestPrice(movement.asset, timestamp, priceIndex, this.config.maxTimeDeltaMs);
        if (closestPrice) {
          proximityPrices.push({
            asset: movement.asset,
            priceAtTxTime: closestPrice,
          });
        }
      }

      if (proximityPrices.length > 0) {
        const updatedInflows = this.enrichMovements(inflows, proximityPrices);
        const updatedOutflows = this.enrichMovements(outflows, proximityPrices);

        enrichedMovements.set(tx.id, {
          inflows: JSON.stringify(updatedInflows),
          outflows: JSON.stringify(updatedOutflows),
        });
      }
    }

    // Return transactions with enriched movements
    return transactions.map((tx) => {
      const enriched = enrichedMovements.get(tx.id);
      if (enriched) {
        return {
          ...tx,
          movements_inflows: enriched.inflows,
          movements_outflows: enriched.outflows,
        };
      }
      return tx;
    });
  }

  /**
   * Process blockchain transactions (simple stablecoin swaps only)
   */
  private async enrichBlockchainPrices(
    transactions: StoredTransaction[],
    txIdsNeedingPrices: Set<number>
  ): Promise<Result<number, Error>> {
    try {
      logger.info({ transactionCount: transactions.length }, 'Processing blockchain transactions');

      let updatedCount = 0;

      for (const tx of transactions) {
        // Only process transactions that need prices
        if (!txIdsNeedingPrices.has(tx.id)) {
          continue;
        }

        const inflows = this.parseMovements(tx.movements_inflows as string | null);
        const outflows = this.parseMovements(tx.movements_outflows as string | null);
        const timestamp = new Date(tx.transaction_datetime).getTime();

        const trade = extractTradeMovements(inflows, outflows, timestamp);
        if (!trade) {
          continue;
        }

        // Only process if one side is fiat/stablecoin
        const prices = calculatePriceFromTrade(trade);

        if (prices.length > 0) {
          const updateResult = await this.updateTransactionPrices({
            ...tx,
            movements_inflows: JSON.stringify(this.enrichMovements(inflows, prices)),
            movements_outflows: JSON.stringify(this.enrichMovements(outflows, prices)),
          });

          if (updateResult.isOk()) {
            updatedCount++;
          }
        }
      }

      return ok(updatedCount);
    } catch (error) {
      return wrapError(error, 'Failed to enrich blockchain prices');
    }
  }

  /**
   * Update transaction in database with enriched price data
   */
  private async updateTransactionPrices(tx: StoredTransaction): Promise<Result<void, Error>> {
    try {
      const inflows = this.parseMovements(tx.movements_inflows as string | null);
      const outflows = this.parseMovements(tx.movements_outflows as string | null);

      // Collect all price data for update
      const priceData: {
        asset: string;
        fetchedAt: Date;
        granularity?: 'exact' | 'minute' | 'hour' | 'day' | undefined;
        price: { amount: Decimal; currency: Currency };
        source: string;
      }[] = [];

      for (const movement of [...inflows, ...outflows]) {
        if (movement.priceAtTxTime) {
          priceData.push({
            asset: movement.asset,
            price: movement.priceAtTxTime.price as { amount: Decimal; currency: Currency },
            source: movement.priceAtTxTime.source,
            fetchedAt: movement.priceAtTxTime.fetchedAt,
            granularity: movement.priceAtTxTime.granularity,
          });
        }
      }

      if (priceData.length === 0) {
        return ok();
      }

      return await this.transactionRepository.updateMovementsWithPrices(tx.id, priceData);
    } catch (error) {
      return wrapError(error, `Failed to update transaction ${tx.id}`);
    }
  }

  /**
   * Group transactions by exchange (source_id)
   */
  private groupByExchange(transactions: StoredTransaction[]): Map<string, StoredTransaction[]> {
    const grouped = new Map<string, StoredTransaction[]>();

    for (const tx of transactions) {
      const exchange = tx.source_id;
      if (!grouped.has(exchange)) {
        grouped.set(exchange, []);
      }
      grouped.get(exchange)!.push(tx);
    }

    return grouped;
  }

  /**
   * Parse movements from JSON string
   */
  private parseMovements(movementsJson: string | null): AssetMovement[] {
    if (!movementsJson) {
      return [];
    }

    try {
      return JSON.parse(movementsJson) as AssetMovement[];
    } catch {
      return [];
    }
  }

  /**
   * Enrich movements with price data
   */
  private enrichMovements(
    movements: AssetMovement[],
    prices: { asset: string; priceAtTxTime: PriceAtTxTime }[]
  ): AssetMovement[] {
    const priceMap = new Map(prices.map((p) => [p.asset, p.priceAtTxTime]));

    return movements.map((movement) => {
      const price = priceMap.get(movement.asset);
      if (price && !movement.priceAtTxTime) {
        return { ...movement, priceAtTxTime: price };
      }
      return movement;
    });
  }
}
