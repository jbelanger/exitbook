import type { AssetMovement, Currency, PriceAtTxTime, UniversalTransaction } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { TransactionLinkRepository } from '../persistence/transaction-link-repository.js';

import { LinkGraphBuilder } from './link-graph-builder.js';
import {
  calculatePriceFromTrade,
  extractTradeMovements,
  findClosestPrice,
  inferPriceFromTrade,
} from './price-calculation-utils.js';
import type { TransactionGroup } from './types.js';

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
 *
 * Phase 2 Enhancement (Link-Aware):
 * - Uses TransactionLinkRepository to fetch confirmed transaction links
 * - Groups linked transactions together via Union-Find algorithm
 * - Enables price propagation across platforms (exchange ↔ blockchain)
 */
export class PriceEnrichmentService {
  private readonly config: Required<PriceEnrichmentConfig>;
  private readonly linkGraphBuilder: LinkGraphBuilder;

  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly linkRepository: TransactionLinkRepository,
    config?: PriceEnrichmentConfig
  ) {
    this.config = {
      maxTimeDeltaMs: config?.maxTimeDeltaMs ?? 3_600_000, // 1 hour
      maxIterations: config?.maxIterations ?? 10,
    };
    this.linkGraphBuilder = new LinkGraphBuilder();
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

      // Fetch confirmed transaction links
      const linksResult = await this.linkRepository.findAll('confirmed');
      if (linksResult.isErr()) {
        return err(linksResult.error);
      }

      const confirmedLinks = linksResult.value;
      logger.info({ linkCount: confirmedLinks.length }, 'Fetched confirmed transaction links');

      // Build link graph: groups transitively linked transactions together
      // This enables price propagation across platforms (exchange → blockchain → exchange)
      const transactionGroups = this.linkGraphBuilder.buildLinkGraph(allTransactions, confirmedLinks);
      logger.info({ groupCount: transactionGroups.length }, 'Built transaction groups from links');

      let updatedCount = 0;

      // Process each transaction group independently
      for (const group of transactionGroups) {
        const groupResult = await this.enrichTransactionGroup(group, txIdsNeedingPrices);
        if (groupResult.isErr()) {
          logger.error(
            { groupId: group.groupId, sources: Array.from(group.sources), error: groupResult.error },
            'Failed to enrich transaction group'
          );
          continue;
        }

        updatedCount += groupResult.value;
      }

      logger.info({ transactionsUpdated: updatedCount }, 'Price enrichment completed');
      return ok({ transactionsUpdated: updatedCount });
    } catch (error) {
      return wrapError(error, 'Failed to enrich prices');
    }
  }

  /**
   * Enrich prices for a transaction group using multi-pass inference
   *
   * Transaction groups can contain:
   * - Single exchange transactions (no links)
   * - Single blockchain transactions (no links)
   * - Mixed cross-platform transactions (linked via Union-Find)
   *
   * The multi-pass inference algorithm works the same regardless of group composition,
   * but linked groups enable price propagation across platforms.
   */
  private async enrichTransactionGroup(
    group: TransactionGroup,
    txIdsNeedingPrices: Set<number>
  ): Promise<Result<number, Error>> {
    try {
      const { groupId, transactions, sources, linkChain } = group;

      // Log group details for debugging
      logger.debug(
        {
          groupId,
          transactionCount: transactions.length,
          sources: Array.from(sources),
          linkCount: linkChain.length,
        },
        'Processing transaction group'
      );

      // Sort by timestamp for temporal processing
      const sortedTxs = [...transactions].sort((a, b) => {
        const timeA = new Date(a.datetime).getTime();
        const timeB = new Date(b.datetime).getTime();
        return timeA - timeB;
      });

      // Pass 1: Extract known prices from fiat/stablecoin trades
      const priceIndex = this.extractKnownPrices(sortedTxs);
      logger.debug({ groupId, pricesExtracted: priceIndex.size }, 'Extracted known prices');

      // Pass 2-N: Iterative inference
      const inferredTxs = this.inferMultiPass(sortedTxs, priceIndex);

      // Pass N+1: Propagate prices across confirmed links (NEW)
      // This enables cross-platform price flow (exchange → blockchain → exchange)
      // This happens AFTER multi-pass inference so transactions have all possible derived prices
      const { pricesFromLinks, enrichedTransactions } = this.propagatePricesAcrossLinks(group, inferredTxs);

      let enrichedTxs = enrichedTransactions;

      if (pricesFromLinks.length > 0) {
        logger.debug({ groupId, linkPricesPropagated: pricesFromLinks.length }, 'Propagated prices across links');

        // Add link-propagated prices to index so they can help other transactions in this run
        for (const { asset, priceAtTxTime } of pricesFromLinks) {
          if (!priceIndex.has(asset)) {
            priceIndex.set(asset, []);
          }
          priceIndex.get(asset)!.push(priceAtTxTime);
        }

        // Run one more temporal proximity pass to use the newly propagated prices
        enrichedTxs = this.fillGapsWithTemporalProximity(enrichedTransactions, priceIndex);
      }

      // Update database with enriched prices (only for transactions that need prices)
      let updatedCount = 0;
      let skippedCount = 0;
      for (const tx of enrichedTxs) {
        // Only update transactions that originally needed prices
        if (!txIdsNeedingPrices.has(tx.id)) {
          continue;
        }

        // Check if transaction has any prices to update
        const inflows = tx.movements.inflows ?? [];
        const outflows = tx.movements.outflows ?? [];
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
        logger.debug({ groupId, skippedCount }, 'Transactions skipped (no prices could be derived)');
      }

      return ok(updatedCount);
    } catch (error) {
      return wrapError(error, `Failed to enrich prices for transaction group: ${group.groupId}`);
    }
  }

  /**
   * Extract known prices from fiat/stablecoin trades
   * Returns a price index: Map<asset, PriceAtTxTime[]>
   */
  private extractKnownPrices(transactions: UniversalTransaction[]): Map<string, PriceAtTxTime[]> {
    const priceIndex = new Map<string, PriceAtTxTime[]>();

    for (const tx of transactions) {
      const timestamp = new Date(tx.datetime).getTime();

      const trade = extractTradeMovements(tx.movements.inflows ?? [], tx.movements.outflows ?? [], timestamp);
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
   * Propagate prices across confirmed transaction links
   *
   * This enables cross-platform price flow:
   * - Exchange withdrawal → Blockchain deposit
   * - Blockchain transfer → Blockchain receive
   * - Exchange withdrawal → Exchange deposit
   *
   * Logic:
   * 1. For each confirmed link, find source and target transactions
   * 2. Match movements by asset (source outflow → target inflow)
   * 3. Copy price from source movement to target movement
   * 4. Set source to 'link-propagated'
   *
   * @param group - Transaction group with linkChain
   * @param transactions - All transactions in the group
   * @returns Object with propagated prices and enriched transactions
   */
  private propagatePricesAcrossLinks(
    group: TransactionGroup,
    transactions: UniversalTransaction[]
  ): {
    enrichedTransactions: UniversalTransaction[];
    pricesFromLinks: { asset: string; priceAtTxTime: PriceAtTxTime }[];
  } {
    const { linkChain } = group;
    const propagatedPrices: { asset: string; priceAtTxTime: PriceAtTxTime }[] = [];

    // Build transaction lookup map for fast access
    const txMap = new Map(transactions.map((tx) => [tx.id, tx]));

    // Track enriched movements for each transaction
    const enrichedMovements = new Map<number, { inflows: AssetMovement[]; outflows: AssetMovement[] }>();

    for (const link of linkChain) {
      const sourceTx = txMap.get(link.sourceTransactionId);
      const targetTx = txMap.get(link.targetTransactionId);

      if (!sourceTx || !targetTx) {
        logger.warn(
          {
            linkId: link.id,
            sourceId: link.sourceTransactionId,
            targetId: link.targetTransactionId,
          },
          'Link references transactions not in group, skipping'
        );
        continue;
      }

      // Match movements: source outflows → target inflows
      const sourceOutflows = sourceTx.movements.outflows ?? [];
      const targetInflows = targetTx.movements.inflows ?? [];

      // Track which target movements got prices
      const targetMovementPrices: { asset: string; priceAtTxTime: PriceAtTxTime }[] = [];

      for (const sourceMovement of sourceOutflows) {
        // Skip if source movement doesn't have a price
        if (!sourceMovement.priceAtTxTime) {
          continue;
        }

        // Find matching target movement by asset
        for (const targetMovement of targetInflows) {
          if (targetMovement.asset === sourceMovement.asset) {
            // Check if amounts are reasonably close (allow up to 10% difference for fees)
            const sourceAmount = sourceMovement.amount.toNumber();
            const targetAmount = targetMovement.amount.toNumber();
            const amountDiff = Math.abs(sourceAmount - targetAmount);
            const amountTolerance = sourceAmount * 0.1; // 10% tolerance

            if (amountDiff <= amountTolerance) {
              // Propagate price with 'link-propagated' source
              // Preserve original fetchedAt to maintain temporal proximity for future runs
              const propagatedPrice: PriceAtTxTime = {
                ...sourceMovement.priceAtTxTime,
                source: 'link-propagated',
              };

              propagatedPrices.push({
                asset: targetMovement.asset,
                priceAtTxTime: propagatedPrice,
              });

              targetMovementPrices.push({
                asset: targetMovement.asset,
                priceAtTxTime: propagatedPrice,
              });

              logger.debug(
                {
                  sourceTransactionId: sourceTx.id,
                  targetTransactionId: targetTx.id,
                  asset: targetMovement.asset,
                  price: sourceMovement.priceAtTxTime.price,
                  linkType: link.linkType,
                },
                'Propagated price across link'
              );

              // Only match each target movement once
              break;
            }
          }
        }
      }

      // Apply propagated prices to target transaction movements
      if (targetMovementPrices.length > 0) {
        const enrichedInflows = this.enrichMovements(targetInflows, targetMovementPrices);
        const targetOutflows = targetTx.movements.outflows ?? [];

        enrichedMovements.set(targetTx.id, {
          inflows: enrichedInflows,
          outflows: targetOutflows,
        });
      }
    }

    // Return enriched transactions (with link-propagated prices applied)
    const enrichedTransactions = transactions.map((tx) => {
      const enriched = enrichedMovements.get(tx.id);
      if (enriched) {
        return {
          ...tx,
          movements: {
            inflows: enriched.inflows,
            outflows: enriched.outflows,
          },
        };
      }
      return tx;
    });

    return {
      pricesFromLinks: propagatedPrices,
      enrichedTransactions,
    };
  }

  /**
   * Fill remaining price gaps using temporal proximity
   */
  private fillGapsWithTemporalProximity(
    transactions: UniversalTransaction[],
    priceIndex: Map<string, PriceAtTxTime[]>
  ): UniversalTransaction[] {
    const enrichedMovements = new Map<number, { inflows: AssetMovement[]; outflows: AssetMovement[] }>();

    for (const tx of transactions) {
      const inflows = tx.movements.inflows ?? [];
      const outflows = tx.movements.outflows ?? [];
      const timestamp = new Date(tx.datetime).getTime();

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
          inflows: updatedInflows,
          outflows: updatedOutflows,
        });
      }
    }

    // Return transactions with enriched movements
    return transactions.map((tx) => {
      const enriched = enrichedMovements.get(tx.id);
      if (enriched) {
        return {
          ...tx,
          movements: {
            inflows: enriched.inflows,
            outflows: enriched.outflows,
          },
        };
      }
      return tx;
    });
  }

  /**
   * Multi-pass inference: iteratively infer prices from crypto-crypto trades
   */
  private inferMultiPass(
    transactions: UniversalTransaction[],
    priceIndex: Map<string, PriceAtTxTime[]>
  ): UniversalTransaction[] {
    // Track which transactions have been enriched with new movements
    const enrichedMovements = new Map<number, { inflows: AssetMovement[]; outflows: AssetMovement[] }>();

    // Pass 0: Apply exchange-execution prices from fiat/stable trades to their source movements
    // This ensures these movements retain their 'exchange-execution' source instead of being
    // overwritten later with 'derived-history' from Pass N+1 temporal proximity
    for (const tx of transactions) {
      const timestamp = new Date(tx.datetime).getTime();
      const inflows = tx.movements.inflows ?? [];
      const outflows = tx.movements.outflows ?? [];

      const trade = extractTradeMovements(inflows, outflows, timestamp);
      if (!trade) {
        continue;
      }

      const prices = calculatePriceFromTrade(trade);

      if (prices.length > 0) {
        const updatedInflows = this.enrichMovements(inflows, prices);
        const updatedOutflows = this.enrichMovements(outflows, prices);

        enrichedMovements.set(tx.id, {
          inflows: updatedInflows,
          outflows: updatedOutflows,
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
        const inflows = enriched ? enriched.inflows : (tx.movements.inflows ?? []);
        const outflows = enriched ? enriched.outflows : (tx.movements.outflows ?? []);
        const timestamp = new Date(tx.datetime).getTime();

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
            inflows: updatedInflows,
            outflows: updatedOutflows,
          });
        }
      }

      logger.debug({ iteration, pricesAdded: pricesAddedInLastPass }, 'Inference pass completed');
    } while (pricesAddedInLastPass > 0);

    // Pass N+1: Fill remaining gaps using temporal proximity
    for (const tx of transactions) {
      const enriched = enrichedMovements.get(tx.id);
      const inflows = enriched ? enriched.inflows : (tx.movements.inflows ?? []);
      const outflows = enriched ? enriched.outflows : (tx.movements.outflows ?? []);
      const timestamp = new Date(tx.datetime).getTime();

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
          inflows: updatedInflows,
          outflows: updatedOutflows,
        });
      }
    }

    // Return transactions with enriched movements
    return transactions.map((tx) => {
      const enriched = enrichedMovements.get(tx.id);
      if (enriched) {
        return {
          ...tx,
          movements: {
            inflows: enriched.inflows,
            outflows: enriched.outflows,
          },
        };
      }
      return tx;
    });
  }

  /**
   * Update transaction in database with enriched price data
   */
  private async updateTransactionPrices(tx: UniversalTransaction): Promise<Result<void, Error>> {
    try {
      const inflows = tx.movements.inflows ?? [];
      const outflows = tx.movements.outflows ?? [];

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
